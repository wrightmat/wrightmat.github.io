// dice.js lives under workbench/js/lib, not common/js/lib — a generic
// NdM-notation parser not yet promoted to common (it depends on workbench's
// own component-data.js for @-variable substitution, which Forge doesn't
// use but still needs to resolve at import time).
import { rollDiceExpression } from "../../../workbench/js/lib/dice.js";
import { fetchLibraryEntry, fetchKindEntriesWithIds, listLocationsForSetting } from "../../../common/js/lib/content-fetch.js";
import { evaluateDerivedFormula } from "../../../common/js/lib/derived-formulas.js";
import { loadAbilityFieldDefs } from "../../../common/js/lib/generator-kit.js";
export { loadAbilityFieldDefs };
import { setAtBinding, findBindingByRole, findBindingsByRole } from "../../../common/js/lib/bindings.js";
import { setAtDottedPath } from "../../../common/js/lib/dotted-path.js";
import { resolveFieldRole } from "../../../common/js/lib/field-roles.js";

// Re-exported so forge/js/app.js's own import (from this file) keeps
// working unchanged — the implementation moved to content-fetch.js since
// Sanctum's own copy was byte-identical.
export { listLocationsForSetting };

// Same filtering shape as Crucible's own listFeaturesForSystem — every
// Feature that's either untagged for a System (universally compatible) or
// explicitly tagged for the active one. Kept as Forge's own small copy
// rather than a cross-tool import: a handful of lines, not worth centralizing.
export async function listFeaturesForSystem(dataManager, systemId) {
  const entries = await fetchKindEntriesWithIds(dataManager, "feature");
  return entries
    .map((entry) => ({ id: entry.id, ...entry.entity }))
    .filter((entry) => {
      const ids = Array.isArray(entry.systemIds) ? entry.systemIds : [];
      return !systemId || !ids.length || ids.includes(systemId);
    });
}

// Gender (d8, Male x3 / Female x3 / Androgynous x1 / Non-Binary x1) is a
// genuinely uniform die roll with a fixed face->outcome mapping, so it's a
// plain constant (never varies by location or system, unlike Archetype).
// Alignment IS game-specific — its face list loads from the active System's
// own "alignments" field (see loadAlignmentFaces below); this is only the
// fallback for a System with no "alignments" field authored.
const DEFAULT_ALIGNMENT_FACES = [
  "Lawful Good",
  "Neutral Good",
  "Chaotic Good",
  "Lawful Neutral",
  "True Neutral",
  "Chaotic Neutral",
  "Lawful Evil",
  "Neutral Evil",
  "Chaotic Evil",
  "Unaligned",
];

export const GENDER_FACES = [
  "Male",
  "Male",
  "Male",
  "Female",
  "Female",
  "Female",
  "Androgynous",
  "Non-Binary",
];

// Life-stage groupings rather than a specific number — evenly weighted d5.
export const AGE_FACES = ["Young Adult", "Adult", "Middle Aged", "Older Adult", "Elderly"];

// Relationship status (d8) and sexual orientation (d6) roll independently
// and combine into the single "Relationship" Identity field.
export const RELATIONSHIP_STATUS_FACES = [
  "Single",
  "Dating",
  "Engaged",
  "Married",
  "Separated",
  "Divorced",
  "Widowed",
  "It's Complicated",
];

export const ORIENTATION_FACES = ["Heterosexual", "Homosexual", "Bisexual", "Asexual", "Pansexual", "Questioning"];

// Attitude is real System data (see loadNpcAttitudes below), read from
// whichever array field Forge's "Attitude field" Settings preference points
// at. This constant is only the last-resort fallback for a System with no
// such field authored, mirroring DEFAULT_ALIGNMENT_FACES.
export const DEFAULT_ATTITUDES = [
  { value: 1, label: "Hostile" },
  { value: 2, label: "Unfriendly" },
  { value: 3, label: "Wary" },
  { value: 4, label: "Neutral" },
  { value: 5, label: "Friendly" },
  { value: 6, label: "Helpful" },
];

export function getAttitudeLabel(attitudes, value) {
  const list = Array.isArray(attitudes) && attitudes.length ? attitudes : DEFAULT_ATTITUDES;
  return list.find((entry) => entry.value === Number(value))?.label || "";
}

let tablesPromise = null;

// Loads the system-agnostic 4D table file once and caches the parsed result
// — never changes at runtime, unlike Locations and Species Name Profiles
// (loaded separately below, since which ones are needed depends on the
// selected Location). Archetype is System-scoped data, loaded by
// loadArchetypeTable below instead of a second hardcoded file.
export async function loadForgeTables() {
  if (!tablesPromise) {
    tablesPromise = (async () => {
      const base = new URL("../../data/", import.meta.url);
      const fourD = await fetch(new URL("tables-4d.json", base)).then((r) => r.json());
      return { fourD };
    })();
  }
  return tablesPromise;
}

// Fetches and caches the active System's own record — reads game-specific
// vocabulary (alignments, ability names) directly from System data instead
// of a second hardcoded copy. Cache is keyed by systemId so switching
// Systems re-fetches rather than serving a stale record.
let systemRecordPromise = null;
let systemRecordId = null;
async function fetchSystemRecord(dataManager, systemId) {
  if (!systemId) return null;
  if (!systemRecordPromise || systemRecordId !== systemId) {
    systemRecordId = systemId;
    systemRecordPromise = dataManager
      .get("systems", systemId)
      .then((result) => result?.payload || null)
      .catch(() => null);
  }
  return systemRecordPromise;
}

// The active System's own "alignments" array field, in order — falls back
// to DEFAULT_ALIGNMENT_FACES if the System defines none (e.g. a homebrew
// System with no alignment concept at all), so NPC generation never hard-
// fails for lack of one.
export async function loadAlignmentFaces(dataManager, systemId) {
  const system = await fetchSystemRecord(dataManager, systemId);
  const fields = Array.isArray(system?.fields) ? system.fields : [];
  const field = fields.find((entry) => entry.type === "array" && entry.key === "alignments");
  const faces = (field?.values || []).map((value) => value.name).filter(Boolean);
  return faces.length ? faces : DEFAULT_ALIGNMENT_FACES;
}

// Which array field on the active System supplies NPC Attitude levels is
// the System's own explicit `fieldRoles` declaration (role "npcAttitude") —
// see field-roles.js. Falls back to DEFAULT_ATTITUDES if nothing resolves
// to a valid {value, label} shape.
export async function loadNpcAttitudes(dataManager, systemId) {
  const system = await fetchSystemRecord(dataManager, systemId);
  const field = resolveFieldRole(system, "npcAttitude")?.fieldDef;
  const attitudes = (field?.values || [])
    .map((value) => ({ value: Number(value.value), label: value.name || "" }))
    .filter((entry) => entry.label && Number.isFinite(entry.value));
  return attitudes.length ? attitudes : DEFAULT_ATTITUDES;
}

// {key, min, max} for every stat Forge can roll WITHOUT it coming from the
// active Archetype table entry — used as a fallback for a System whose
// stats genuinely don't vary by Archetype (CoC: every Occupation rolls the
// same Characteristics/HP/Move independently). Two sources, both plain
// System data: abilityFieldDefs' own children with a minimum/maximum, and
// any other top-level `type: "number"` field with both (not limited to the
// ability object, since HP/Move roll the same way). A System whose
// Archetype table already supplies every key never needs this.
export async function loadIndependentStatRanges(dataManager, systemId, abilityFieldDefs) {
  if (!dataManager || !systemId) return [];
  try {
    const result = await dataManager.get("systems", systemId, { preferLocal: false });
    const fields = Array.isArray(result?.payload?.fields) ? result.payload.fields : [];
    const ranges = [];
    (abilityFieldDefs || []).forEach((def) => {
      if (typeof def.minimum === "number" && typeof def.maximum === "number") {
        ranges.push({ key: def.key, min: def.minimum, max: def.maximum });
      }
    });
    fields
      .filter((entry) => entry.type === "number" && typeof entry.minimum === "number" && typeof entry.maximum === "number")
      .forEach((entry) => ranges.push({ key: entry.key, min: entry.minimum, max: entry.maximum }));
    return ranges;
  } catch (error) {
    return [];
  }
}

// The active System's own skillGeneration config field, plus the skill
// vocabulary it points at — backs the "Key Expertise Skills roll higher,
// everything else rolls lower" feature. A System with no skillGeneration
// field never generates a `skills` block this way; nothing here is
// hardcoded to CoC specifically, any System can opt in with the same shape.
export async function loadSkillGenerationConfig(dataManager, systemId) {
  if (!dataManager || !systemId) return null;
  try {
    const result = await dataManager.get("systems", systemId, { preferLocal: false });
    const fields = Array.isArray(result?.payload?.fields) ? result.payload.fields : [];
    const configField = fields.find((entry) => entry.type === "object" && entry.key === "skillGeneration");
    if (!configField) return null;
    const numOf = (suffix, fallback) => {
      const child = (configField.children || []).find((entry) => String(entry.key || "").endsWith(`.${suffix}`));
      return typeof child?.value === "number" ? child.value : fallback;
    };
    const skillsFieldKey = (configField.children || []).find((entry) => String(entry.key || "").endsWith(".skillsField"))?.value || "skills";
    const skillsField = fields.find((entry) => entry.type === "object" && entry.key === skillsFieldKey);
    const skillKeys = (skillsField?.children || [])
      .map((child) => {
        const raw = String(child.key || "");
        return {
          key: raw.startsWith(`${skillsFieldKey}.`) ? raw.slice(skillsFieldKey.length + 1) : raw,
          label: child.shortName || child.label || "",
        };
      })
      .filter((entry) => entry.key && entry.label);
    if (!skillKeys.length) return null;
    return {
      skillsFieldKey,
      skillKeys,
      keyCount: numOf("keyCount", 4),
      keyMin: numOf("keyMin", 50),
      keyMax: numOf("keyMax", 70),
      otherMin: numOf("otherMin", 20),
      otherMax: numOf("otherMax", 30),
    };
  } catch (error) {
    return null;
  }
}

// Archetype — one System-defined array field ("NPC Types") carries
// everything: each value's `name` (the roll table) AND whatever other keys
// that entry has (Stats). One field, not two — a name and its stat block
// are one concept. Which field supplies it is the System's own explicit
// `fieldRoles` declaration (role "archetypeTable") — see field-roles.js.
// Values are zipped to rolls 2-21; a value with no name is skipped rather
// than producing a blank entry. Rolls 22/23 (location override) and 24
// (Wildcard) are a fixed Forge convention layered on top of every System's
// own table, not per-system data.
//
// Returns `{ entries, statsByName }`: `entries` is the roll table, and
// `statsByName` is every value keyed by its own name, unfiltered — which
// keys actually become a generated NPC's Stats is a separate Forge tool
// preference, since a System might carry extra metadata not meant as a Stat.
export async function loadArchetypeTable(dataManager, systemId) {
  const rawValues = [];
  if (dataManager && systemId) {
    try {
      const result = await dataManager.get("systems", systemId, { preferLocal: false });
      const field = resolveFieldRole(result?.payload, "archetypeTable")?.fieldDef;
      (field?.values || []).slice(0, 20).forEach((value) => {
        if (value?.name) rawValues.push(value);
      });
    } catch (error) {
      // No System record, or a transient fetch failure — fall through with
      // whatever entries were already resolved plus the fixed 22/23/24
      // entries below.
    }
  }
  const entries = rawValues.map((value, index) => ({ roll: index + 2, name: value.name }));
  entries.push({ roll: 22, name: null, overridable: true });
  entries.push({ roll: 23, name: null, overridable: true });
  entries.push({ roll: 24, name: "Wildcard" });
  const statsByName = {};
  rawValues.forEach((value) => {
    statsByName[value.name] = value;
  });
  return { entries, statsByName };
}

// Setting/Location are authored in Sanctum and Species in Loom, both as
// generic Library kinds rather than Forge-only files — fetchKindEntriesWithIds
// fetches each kind's saved entries and pairs them with their id, since the
// generic listing route only returns ids/filenames, not full bodies.
export async function listSettingsForSystem(dataManager, systemId) {
  if (!systemId) return [];
  const entries = await fetchKindEntriesWithIds(dataManager, "setting");
  return entries
    .filter((entry) => {
      // systemIds (plural) is the only System-association field a Setting
      // carries. An empty/absent array means universally compatible, same
      // as Crucible's listKindForSystem.
      const ids = Array.isArray(entry.entity.systemIds) ? entry.entity.systemIds : [];
      return !ids.length || ids.includes(systemId);
    })
    .map((entry) => ({ id: entry.id, name: entry.entity.name || entry.id }));
}

// Lets the NPC picker offer every previously-saved NPC at the currently
// selected Location, same as Sanctum's Location picker. generator.js stamps
// every generated NPC with `locationId`, which is what this filters on.
export async function listNpcsForLocation(dataManager, locationId) {
  if (!locationId) return [];
  const entries = await fetchKindEntriesWithIds(dataManager, "npc");
  return entries
    .filter((entry) => entry.entity.locationId === locationId)
    .map((entry) => ({ id: entry.id, name: entry.entity.name || entry.id }));
}

// Every saved NPC belonging to a Setting — the NPC picker's fallback for
// when a Setting is selected but no specific Location is (Location is
// optional). Filters on the NPC's own settingIds directly, rather than
// cross-referencing through locationId, since an NPC generated with no
// Location still has a real settingIds to filter on.
export async function listNpcsForSetting(dataManager, settingId) {
  if (!settingId) return [];
  const entries = await fetchKindEntriesWithIds(dataManager, "npc");
  return entries
    .filter((entry) => {
      const ids = Array.isArray(entry.entity.settingIds)
        ? entry.entity.settingIds
        : entry.entity.settingId
          ? [entry.entity.settingId]
          : [];
      return ids.includes(settingId);
    })
    .map((entry) => ({ id: entry.id, name: entry.entity.name || entry.id }));
}

// The location's own id doesn't live in the JSON body (the filename is the
// id), so it's stamped onto the returned object here.
//
// Goes through dataManager (authenticated) — NOT fetchLibraryEntry's
// deliberately-anonymous /content/ route, which 401s on anything the
// signed-in GM owns but hasn't published. Most Locations aren't public, so
// this is the common case, not an edge case.
export async function loadLocation(dataManager, id) {
  const result = await dataManager.get("location", id, { preferLocal: false });
  return { id, ...(result?.payload || {}) };
}

// Goes through dataManager (authenticated) — NOT fetchLibraryEntry's
// deliberately-anonymous /content/ route, matching loadLocation above (a
// private, unpublished Setting 401s on the anonymous route). Used to read a
// Setting's own general Species Weights (effectiveSpeciesLocation, app.js).
export async function loadSetting(dataManager, id) {
  const result = await dataManager.get("setting", id, { preferLocal: false });
  return { id, ...(result?.payload || {}) };
}

// Species is a species entity's own `names` section — this caches
// {id, label, nameMode, lastNameForm, firstNames, lastNames} derived from
// whichever species entities a Location's population actually references.
const speciesProfileCache = new Map();

export async function loadSpeciesProfilesForLocation(location) {
  // "other" is the population-weighting catchall — a sentinel, not a real
  // species Library entry, so it's never fetched. Skipping it here avoids a
  // needless failed request on every location that uses it.
  const ids = Array.from(
    new Set(
      (location?.speciesWeights || [])
        .map((entry) => entry.entityId)
        .filter((id) => id && id !== "other")
    )
  );
  const profiles = await Promise.all(
    ids.map(async (id) => {
      if (speciesProfileCache.has(id)) return speciesProfileCache.get(id);
      try {
        const entity = await fetchLibraryEntry("species", id);
        const names = entity.names || {};
        const profile = {
          id,
          label: entity.name || id,
          nameMode: names.nameMode || "blend",
          lastNameForm: names.lastNameForm || "none",
          firstNames: names.firstNames || [],
          lastNames: names.lastNames || [],
        };
        speciesProfileCache.set(id, profile);
        return profile;
      } catch (error) {
        return null;
      }
    })
  );
  const map = new Map();
  ids.forEach((id, index) => {
    if (profiles[index]) map.set(id, profiles[index]);
  });
  return map;
}

// Display options for a Location's population — {speciesId, label} pairs,
// used by the Species override select and anywhere else that needs to show
// a location's species by name rather than by id.
export function getSpeciesOptions(location, speciesProfiles) {
  return (location?.speciesWeights || []).map((entry) => ({
    speciesId: entry.entityId,
    label: speciesProfiles?.get(entry.entityId)?.label || entry.entityId,
  }));
}

function rollUniformD(sides, notation, { random = Math.random } = {}) {
  const result = rollDiceExpression(notation, { random });
  return { face: result.total, notation: result.notation };
}

// Species weighting is a genuine weighted-random draw, not a uniform d20
// lookup — a fair die can't itself produce a non-uniform population
// distribution. Reported as a "roll" (position within the cumulative
// weight) for GM-facing transparency, but the actual selection is a plain
// Math.random() draw scaled to the location's total weight. `override` is a
// speciesId, not a free-text label — resolving the display label always
// goes through `speciesProfiles` so it can never disagree with the name generator.
export function rollWeightedSpecies(location, speciesProfiles, { random = Math.random, override = "" } = {}) {
  // "other" is never in speciesProfiles (deliberately skipped when
  // fetching), so falling through to the bare entityId below would produce
  // the literal lowercase string "other" for a real weighted row —
  // special-cased here so it agrees with the zero-weights fallback below,
  // which already produces the correctly-capitalized "Other" label.
  const labelFor = (entityId) => (entityId === "other" ? "Other" : speciesProfiles?.get(entityId)?.label || entityId);
  if (override) {
    return { label: labelFor(override), speciesId: override, roll: null, total: null, manual: true };
  }
  const weights = Array.isArray(location?.speciesWeights) ? location.speciesWeights : [];
  const total = weights.reduce((sum, entry) => sum + (Number(entry.weight) || 0), 0);
  if (!weights.length || total <= 0) {
    return { label: "Other", speciesId: "other", roll: 0, total: 0 };
  }
  const draw = random() * total;
  let cumulative = 0;
  for (const entry of weights) {
    cumulative += Number(entry.weight) || 0;
    if (draw < cumulative) {
      return { label: labelFor(entry.entityId), speciesId: entry.entityId, roll: Math.ceil(draw), total };
    }
  }
  const last = weights[weights.length - 1];
  return { label: labelFor(last.entityId), speciesId: last.entityId, roll: total, total };
}

export function rollAlignment({ random = Math.random, override = "", faces = DEFAULT_ALIGNMENT_FACES } = {}) {
  if (override) {
    return { label: override, roll: null, manual: true };
  }
  const dieSize = faces.length || DEFAULT_ALIGNMENT_FACES.length;
  const { face, notation } = rollUniformD(dieSize, `1d${dieSize}`, { random });
  return { label: faces[face - 1], roll: face, notation };
}

export function rollGender({ random = Math.random, override = "" } = {}) {
  if (override) {
    return { label: override, roll: null, manual: true };
  }
  const { face, notation } = rollUniformD(8, "1d8", { random });
  return { label: GENDER_FACES[face - 1], roll: face, notation };
}

export function rollAge({ random = Math.random } = {}) {
  const { face, notation } = rollUniformD(5, "1d5", { random });
  return { label: AGE_FACES[face - 1], roll: face, notation };
}

// Status and orientation roll independently (d8 and d6) and combine into a
// single display string — presented as one Identity field, one reroll.
export function rollRelationship({ random = Math.random } = {}) {
  const status = rollUniformD(8, "1d8", { random });
  const orientation = rollUniformD(6, "1d6", { random });
  const statusLabel = RELATIONSHIP_STATUS_FACES[status.face - 1];
  const orientationLabel = ORIENTATION_FACES[orientation.face - 1];
  return {
    label: `${statusLabel}, ${orientationLabel}`,
    status: { label: statusLabel, roll: status.face, notation: status.notation },
    orientation: { label: orientationLabel, roll: orientation.face, notation: orientation.notation },
  };
}

// Numeric scale (Hostile 1 to Helpful 6 for D&D's default, but the die size
// follows however many levels the active System's npcAttitudes field
// defines) — the record keeps the raw number as canonical data, with
// `label` alongside it purely for display.
export function rollAttitude(attitudes, { random = Math.random } = {}) {
  const list = Array.isArray(attitudes) && attitudes.length ? attitudes : DEFAULT_ATTITUDES;
  const { face, notation } = rollUniformD(list.length, `1d${list.length}`, { random });
  const entry = list[face - 1];
  return { value: entry?.value ?? face, label: entry?.label || "", roll: face, notation };
}

// The archetype entry's own raw key that feeds a `resource`-role
// combatBindings entry (HP-like) — derived from the binding's OWN declared
// path, never a hardcoded "hitPoints" literal. A resource with `maxPath` is
// nested (`stats.hp.current`/`stats.hp.max`) — the archetype's raw entry
// only ever authors the single max value, so the key to look for is the
// PARENT segment shared by both paths. A resource with a literal `max`
// instead has no such parent — the entry's key is the binding's last segment.
function resourceArchetypeKey(binding) {
  const path = String(binding?.recordField || "").trim();
  if (!path) return "";
  const segments = path.split(".").filter(Boolean);
  if (binding.maxPath && segments.length >= 2) return segments[segments.length - 2];
  return segments[segments.length - 1] || "";
}

// Same idea for a `value`/`modifier`-role binding (AC-like, always a single
// flat value, never nested) — the archetype entry's key is simply the
// binding's last path segment.
function flatArchetypeKey(binding) {
  const path = String(binding?.recordField || "").trim();
  if (!path) return "";
  const segments = path.split(".").filter(Boolean);
  return segments[segments.length - 1] || "";
}

// Basic combat stats for this archetype, whatever shape the active
// System's npcTypes entries define. `statsMap` is already filtered down to
// just the keys Forge's "Stats" tool preference selected — this function
// only cares about `abilityKeys`, needed to tell an ability score apart
// from any other stat. Deterministic lookup by name, not a rollX helper.
// Setting-specific archetypes, Wildcard, and any System with no Stats keys
// selected have no fixed stat concept — callers get null.
//
// Every value is written through `setAtBinding` against a path always
// starting "@stats." — never a hardcoded key beyond that prefix.
// `abilityFieldKey`/`combatBindings` are resolved upstream from the active
// System's own settings/fields, so this function never hardcodes
// "abilities", "hitPoints", or any other System-specific field name.
export function getStatsForArchetype(statsMap, archetypeName, abilityKeys, abilityFieldKey, combatBindings, derivedFormulas) {
  const entry = statsMap?.[archetypeName];
  if (!entry) return null;
  const { name, ...rest } = entry;
  const keySet = abilityKeys instanceof Set ? abilityKeys : new Set(abilityKeys || []);
  const abilities = {};
  const otherKeys = {};
  Object.entries(rest).forEach(([key, value]) => {
    if (keySet.has(key)) {
      abilities[key] = value;
    } else {
      otherKeys[key] = value;
    }
  });

  const scratch = {};

  // Ability scores/Traits — the ONE structural nesting this function always
  // applies (stats.*); the sub-key underneath is 100% dynamic (abilityFieldKey).
  if (Object.keys(abilities).length) {
    setAtBinding(`@stats.${abilityFieldKey || "abilities"}`, scratch, abilities);
  }

  // Every resource-role binding this System defines (HP, and for a System
  // like Daggerheart that tracks more than one), not just the first — a
  // freshly generated NPC is undamaged, so whichever the archetype entry
  // authors a value for seeds both current and max. A resource the entry
  // doesn't author anything for is simply left unset.
  findBindingsByRole(combatBindings, "resource").forEach((resource) => {
    const archetypeKey = resourceArchetypeKey(resource);
    if (!archetypeKey || otherKeys[archetypeKey] === undefined) return;
    const maxValue = Number(otherKeys[archetypeKey]) || 0;
    setAtDottedPath(scratch, resource.recordField, maxValue);
    if (resource.maxPath) setAtDottedPath(scratch, resource.maxPath, maxValue);
    delete otherKeys[archetypeKey];
  });

  // AC-like single value.
  const valueBinding = findBindingByRole(combatBindings, "value");
  if (valueBinding) {
    const archetypeKey = flatArchetypeKey(valueBinding);
    if (archetypeKey && otherKeys[archetypeKey] !== undefined) {
      setAtDottedPath(scratch, valueBinding.recordField, otherKeys[archetypeKey]);
      delete otherKeys[archetypeKey];
    }
  }

  // Initiative — not authored data, derived from `abilities.dexterity` via
  // the System's own `derivedFormulas` role "abilityModifier". WHICH
  // ability drives Initiative is still a D&D-specific assumption (no
  // data-driven home for that), but the FORMULA itself isn't hardcoded.
  // WHERE this gets written comes from the System's combatBindings; no
  // `modifier`-role binding (Daggerheart) means this is skipped.
  const modifierBinding = findBindingByRole(combatBindings, "modifier");
  if (modifierBinding && typeof abilities.dexterity === "number") {
    const modifier = evaluateDerivedFormula(derivedFormulas, "abilityModifier", { score: abilities.dexterity }) || 0;
    setAtDottedPath(scratch, modifierBinding.recordField, modifier);
  }

  // Anything else the archetype entry defines with no matching
  // combatBindings role still lands under stats.*, same structural convention.
  Object.entries(otherKeys).forEach(([key, value]) => {
    setAtBinding(`@stats.${key}`, scratch, value);
  });

  return scratch.stats || {};
}

// Resolves every archetype entry to its final display name for a given
// location (overridable rolls 22/23 substituted, or "Setting Specific")
// — shared by the roll itself, the manual-override <select>, and the Press
// template export, so all three can never disagree.
export function getArchetypeOptions(archetypeTable, location) {
  return (archetypeTable?.entries || []).map((entry) => {
    if (entry.overridable) {
      const override = location?.archetypeOverrides?.[String(entry.roll)];
      return { roll: entry.roll, name: override?.name || entry.name || "Setting Specific" };
    }
    return { roll: entry.roll, name: entry.name };
  });
}

// Archetype is a real 2d12 sum — the bell-curve weighting CLAUDE.md wants
// falls out of the dice math itself, no artificial weighting needed.
// `override` (a GM-picked archetype name) skips the roll entirely.
export function rollArchetype(archetypeTable, location, { random = Math.random, override = "" } = {}) {
  if (override) {
    return { name: override, roll: null, manual: true };
  }
  const result = rollDiceExpression("2d12", { random });
  const roll = result.total;
  const resolved = getArchetypeOptions(archetypeTable, location).find((item) => item.roll === roll);
  if (!resolved) {
    return { name: "Unknown", roll, notation: result.notation };
  }
  return { name: resolved.name, roll, notation: result.notation };
}

export function rollFourDTable(tableEntries, { random = Math.random } = {}) {
  const { face, notation } = rollUniformD(20, "1d20", { random });
  const entries = Array.isArray(tableEntries) ? tableEntries : [];
  return { label: entries[face - 1] || "", roll: face, notation };
}

export function rollFourD(fourDTables, { random = Math.random } = {}) {
  return {
    description: rollFourDTable(fourDTables?.description, { random }),
    demeanor: rollFourDTable(fourDTables?.demeanor, { random }),
    drive: rollFourDTable(fourDTables?.drive, { random }),
    direction: rollFourDTable(fourDTables?.direction, { random }),
  };
}
