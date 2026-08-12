// dice.js lives under workbench/js/lib, not common/js/lib — it's a generic
// NdM-notation parser with no workbench-specific logic of its own, but it
// hasn't been promoted to common yet (it depends on workbench's own
// component-data.js for @-variable substitution, a feature Forge doesn't
// use but still needs to resolve at import time). Reusing it in place here
// rather than duplicating a second dice parser.
import { rollDiceExpression } from "../../../workbench/js/lib/dice.js";
import { fetchLibraryEntry, fetchKindEntriesWithIds, listLocationsForSetting } from "../../../common/js/lib/content-fetch.js";
import { abilityModifier } from "../../../common/js/lib/dnd-rules.js";

// Re-exported so undercroft/forge/js/app.js's own import (from this file)
// keeps working unchanged — the implementation moved to content-fetch.js
// since Sanctum's own copy was byte-identical (both list Locations for a
// Setting, both need the same pre-migration scalar-settingId fallback).
export { listLocationsForSetting };

// Gender (d8, Male x3 / Female x3 / Androgynous x1 / Non-Binary x1) is a
// genuinely uniform die roll with a fixed face->outcome mapping — CLAUDE.md
// gives the full face list, so it's a plain constant here rather than JSON
// (it never varies by location or system, unlike Archetype). Alignment,
// unlike Gender, IS game-specific (a System with no alignment concept at all
// is entirely plausible) — its face list is loaded from the active System's
// own "alignments" field (see loadAlignmentFaces below) instead of being a
// second hardcoded copy of data sys.dnd5e.json already defines. This
// fallback is only used if the active System defines no "alignments" field
// of its own (so NPC generation never hard-fails for a System with no
// alignment vocabulary authored yet).
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

// Same reasoning as DEFAULT_ALIGNMENT_FACES above — the six ability score
// keys/short labels are read from the active System's own "abilities" field
// (see loadAbilityFieldDefs below), falling back to this default only if the
// System defines none.
const DEFAULT_ABILITY_FIELD_DEFS = [
  { key: "strength", label: "STR" },
  { key: "dexterity", label: "DEX" },
  { key: "constitution", label: "CON" },
  { key: "intelligence", label: "INT" },
  { key: "wisdom", label: "WIS" },
  { key: "charisma", label: "CHA" },
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

// Attitude used to be a hardcoded Hostile(1)-Helpful(6) label list here —
// now real System data (see loadNpcAttitudes below), read from whichever
// array field Forge's own "Attitude field" Settings preference points at
// (getAttitudeFieldPreference in app.js), same "per-tool preference, not
// System data" pattern as Archetype's own npcTypes field. This constant is
// only the last-resort fallback for a System that defines no such field at
// all, so NPC generation never hard-fails for lack of one — mirrors
// DEFAULT_ALIGNMENT_FACES exactly.
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
// — never changes at runtime, unlike Locations (which the GM can add/edit
// via the Location Builder panel) and Species Name Profiles (edited via
// Manage Species, loaded separately below since which ones are needed
// depends on which Location is selected). Archetype (and its per-name
// Stats) used to live here too as a second hardcoded D&D-5e-only file
// (archetypes-dnd5e.json, fetched unconditionally regardless of System) —
// it's now System-scoped data, loaded by loadArchetypeTable below and
// refreshed by refreshSystemVocabulary (forge/js/app.js) whenever the
// active System changes, the same way Alignment/Ability labels already
// work.
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
// of duplicating it as a second hardcoded copy in this file, mirroring
// Sanctum's own loadEnvironmentPropertyType (sanctum/js/app.js) exactly.
// Cache is keyed by systemId so switching Systems (via the System select)
// re-fetches rather than serving a stale record.
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
// Forge's own tool preference (getAttitudeFieldPreference in app.js), same
// pattern as Archetype's own npcTypes field — defaults to the conventional
// "npcAttitudes" key when unset. Each value's `name` is the attitude's own
// description (e.g. "Hostile") and `value` is the numeric scale position
// (see sys.dnd5e.json's own npcAttitudes field) — falls back to
// DEFAULT_ATTITUDES if the System defines no such field, or its entries
// don't resolve to a valid {value, label} shape.
export async function loadNpcAttitudes(dataManager, systemId, attitudeField = "npcAttitudes") {
  const system = await fetchSystemRecord(dataManager, systemId);
  const fields = Array.isArray(system?.fields) ? system.fields : [];
  const field = fields.find((entry) => entry.type === "array" && entry.key === attitudeField);
  const attitudes = (field?.values || [])
    .map((value) => ({ value: Number(value.value), label: value.name || "" }))
    .filter((entry) => entry.label && Number.isFinite(entry.value));
  return attitudes.length ? attitudes : DEFAULT_ATTITUDES;
}

// The active System's own "abilities" object field's children (key +
// shortName) — same fallback reasoning as loadAlignmentFaces above. Strips
// the "abilities." key prefix so callers get bare keys (e.g. "strength")
// matching the flat keys a System's own npcTypes entries use for their own
// Stats (see loadArchetypeTable below).
export async function loadAbilityFieldDefs(dataManager, systemId) {
  const system = await fetchSystemRecord(dataManager, systemId);
  const fields = Array.isArray(system?.fields) ? system.fields : [];
  const field = fields.find((entry) => entry.type === "object" && entry.key === "abilities");
  const defs = (field?.children || [])
    .map((child) => ({
      key: String(child.key || "").replace(/^abilities\./, ""),
      label: child.shortName || child.label || "",
    }))
    .filter((entry) => entry.key && entry.label);
  return defs.length ? defs : DEFAULT_ABILITY_FIELD_DEFS;
}

// Every top-level array field on the active System, so Forge's Settings
// modal (Archetype field picker) can list all real candidates —
// deliberately unfiltered (unlike Vault's own cost/targetBudget-shaped
// field lister), same reasoning and same preferLocal: false as Crucible's
// own listArrayFieldOptions (crucible/js/lib/tables.js): a live Loom edit
// to the System's fields must be visible immediately, not hidden behind a
// stale local cache.
export async function listArrayFieldOptions(dataManager, systemId) {
  if (!dataManager || !systemId) return [];
  try {
    const result = await dataManager.get("systems", systemId, { preferLocal: false });
    const fields = Array.isArray(result?.payload?.fields) ? result.payload.fields : [];
    return fields
      .filter((entry) => entry.type === "array")
      .map((entry) => ({ key: entry.key, label: entry.label || entry.key }));
  } catch (error) {
    return [];
  }
}

// Archetype — one System-defined array field ("NPC Types") carries
// everything: each value's `name` (the roll table) AND whatever other keys
// that entry has (Stats, whatever shape a System wants — see
// statsKeyOptionsFrom/getStatsForArchetype). One field, not two — a name
// and its own stat block are one concept, not two things a GM would ever
// want to bind separately. Which array field supplies it is Forge's own
// tool preference (see getArchetypeFieldPreference in app.js), defaulting
// to "npcTypes" so an existing System (D&D) works with no configuration.
// Values are read in order and zipped to rolls 2-21; a value with no name
// is skipped rather than producing a blank/"undefined" entry, so an
// under-authored System just has gaps (resolved to "Unknown" by
// rollArchetype's own existing fallback) instead of a broken display.
// Rolls 22/23 (location override) and 24 (Wildcard) are a fixed Forge
// convention layered on top of every System's own table, not per-system
// data — unchanged from the original hardcoded shape.
//
// Returns `{ entries, statsByName }`: `entries` is the roll table
// (getArchetypeOptions/rollArchetype's existing shape, unchanged), and
// `statsByName` is every value keyed by its own name, every key intact
// (unfiltered) — which of those keys actually become a generated NPC's
// Stats is a *separate* Forge tool preference (see getStatsKeysPreference/
// resolveArchetypeStats in app.js), since a System might carry extra
// per-archetype metadata that isn't meant to be shown as a Stat at all.
export async function loadArchetypeTable(dataManager, systemId, archetypeField = "npcTypes") {
  const rawValues = [];
  if (dataManager && systemId && archetypeField) {
    try {
      const result = await dataManager.get("systems", systemId, { preferLocal: false });
      const fields = Array.isArray(result?.payload?.fields) ? result.payload.fields : [];
      const field = fields.find((entry) => entry.type === "array" && entry.key === archetypeField);
      (field?.values || []).slice(0, 20).forEach((value) => {
        if (value?.name) rawValues.push(value);
      });
    } catch (error) {
      // No System record, or a transient fetch failure — fall through with
      // whatever entries were already resolved (none) plus the fixed
      // 22/23/24 entries below, same graceful-degrade as every other
      // System-field reader in this file.
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
// generic Library kinds (setting/location/species) rather than Forge-only
// files — fetchKindEntriesWithIds (common/js/lib/content-fetch.js) fetches
// each kind's saved entries and pairs them with their id, since the generic
// listing route only returns ids/filenames, not full bodies.
export async function listSettingsForSystem(dataManager, systemId) {
  if (!systemId) return [];
  const entries = await fetchKindEntriesWithIds(dataManager, "setting");
  return entries
    .filter((entry) => {
      // systemIds (plural) is the only System-association field a Setting
      // carries — same convention every other Library kind uses (see
      // sanctum/CLAUDE.md: "There is no separate systemId field anywhere —
      // an earlier pass introduced one before this was corrected"). An
      // empty/absent array means universally compatible, same as
      // Crucible's listKindForSystem.
      const ids = Array.isArray(entry.entity.systemIds) ? entry.entity.systemIds : [];
      return !ids.length || ids.includes(systemId);
    })
    .map((entry) => ({ id: entry.id, name: entry.entity.name || entry.id }));
}

// Forge's own generated-output kind — lets the NPC picker (app.js) offer
// every previously-saved NPC at the currently selected Location, the same
// way Sanctum's Location picker lists saved Locations for a Setting.
// generator.js stamps every generated NPC with `locationId` (the Location it
// was rolled for), which is what this filters on.
export async function listNpcsForLocation(dataManager, locationId) {
  if (!locationId) return [];
  const entries = await fetchKindEntriesWithIds(dataManager, "npc");
  return entries
    .filter((entry) => entry.entity.locationId === locationId)
    .map((entry) => ({ id: entry.id, name: entry.entity.name || entry.id }));
}

// Every saved NPC belonging to a Setting — the NPC picker's own fallback
// for when a Setting is selected but no one specific Location is (Location
// is optional now). Filters on the NPC's own settingIds directly (same
// plural-array membership convention listLocationsForSetting/
// listSettingsForSystem already use for their own kinds — see
// generateNpc's own settingIds stamp, generator.js) rather than
// cross-referencing through locationId, since an NPC generated with no
// Location at all still has a real settingIds of its own to filter on.
// Confirmed real bug this fixes twice over: first, auto-selecting a
// campaign's System/Setting (the active-group default, see app.js's own
// init()) never auto-selects a Location, so a GM's own previously-saved
// NPCs never appeared in the picker until that exact Location was
// reselected by hand; second, an earlier version of this function filtered
// via locationId cross-referenced against the Setting's own Locations,
// which silently excluded any NPC with no locationId at all (e.g. one
// whose Location reference was cleared, rather than corrected, once
// Location became optional).
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

// The location's own id doesn't live in the JSON body (same convention as
// every other library kind — the filename is the id), so it's stamped onto
// the returned object here; the rest of Forge (export-template ids, the
// per-Location name-generator model cache) already expects `currentLocation.id`.
//
// Goes through dataManager (authenticated) — NOT fetchLibraryEntry's
// deliberately-anonymous /content/ route, which 401s on anything the
// signed-in GM owns but hasn't published. Most Locations aren't public, so
// this is the common case, not an edge case. Confirmed real bug this fixes:
// every real Location silently failed to load once Forge stopped
// auto-selecting the two seeded PUBLIC starter Locations (Sword Coast/
// Sharn) and the GM started picking their own instead.
export async function loadLocation(dataManager, id) {
  // preferLocal: false — a Location's own Species Weights/Properties
  // (edited in Sanctum, possibly on a different device/browser) must be
  // visible here immediately, not hidden behind whatever this browser
  // happened to cache on an earlier load. Same class of staleness bug as
  // loadSetting above.
  const result = await dataManager.get("location", id, { preferLocal: false });
  return { id, ...(result?.payload || {}) };
}

// Goes through dataManager (authenticated) — NOT fetchLibraryEntry's
// deliberately-anonymous /content/ route, matching loadLocation above (same
// bug this fixed there: a private, unpublished Setting 401'd on the
// anonymous route). Now used to read a Setting's own general Species
// Weights (effectiveSpeciesLocation, forge/js/app.js) — previously unused
// dead code, so this bug had never actually surfaced. preferLocal: false
// for the same reason Sanctum's own Setting Properties editor needs it — a
// Setting's Species Weights edited elsewhere must be visible here
// immediately, not hidden behind whatever this browser happened to cache
// on an earlier load.
export async function loadSetting(dataManager, id) {
  const result = await dataManager.get("setting", id, { preferLocal: false });
  return { id, ...(result?.payload || {}) };
}

// Species used to be a Forge-only "Species Name Profile" file, entirely
// separate from the shared Library's own species/*.json (DDB trait data).
// They're now the same file — a species entity's `names` section — so this
// caches {id, label, nameMode, lastNameForm, firstNames, lastNames} derived
// from whichever species entities a Location's population actually
// references, instead of loading a Forge-only profile store.
const speciesProfileCache = new Map();

export async function loadSpeciesProfilesForLocation(location) {
  // "other" is the population-weighting catchall (rollWeightedSpecies'
  // own fallback below, also a real, selectable speciesWeights row per the
  // Location builder's "Other" bucket) — a sentinel, not a real species
  // Library entry, so it's never fetched. Skipping it here (rather than
  // just swallowing the resulting fetchLibraryEntry 404 in the catch
  // below) avoids a needless failed request on every location that uses it.
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
// weight, out of the total) for GM-facing transparency, but the actual
// selection is a plain Math.random() draw scaled to the location's total
// weight. `override` is now a speciesId (the override <select>'s options
// are keyed by id), not a free-text label — resolving the display label
// always goes through `speciesProfiles` so it can never disagree with the
// name generator about which profile a given roll actually means.
export function rollWeightedSpecies(location, speciesProfiles, { random = Math.random, override = "" } = {}) {
  const labelFor = (entityId) => speciesProfiles?.get(entityId)?.label || entityId;
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

// Numeric scale (Hostile 1 to Helpful 6 for D&D's own default, but the die
// size follows however many levels the active System's npcAttitudes field
// actually defines — same flexible-count convention rollAlignment already
// uses for its own faces list) — the record keeps the raw number as
// canonical data (rerolls/comparisons stay simple), with `label` alongside
// it purely for display. `attitudes` is the already-loaded list from
// loadNpcAttitudes above (or DEFAULT_ATTITUDES if omitted/empty).
export function rollAttitude(attitudes, { random = Math.random } = {}) {
  const list = Array.isArray(attitudes) && attitudes.length ? attitudes : DEFAULT_ATTITUDES;
  const { face, notation } = rollUniformD(list.length, `1d${list.length}`, { random });
  const entry = list[face - 1];
  return { value: entry?.value ?? face, label: entry?.label || "", roll: face, notation };
}

// Basic combat stats for this archetype, whatever shape the active
// System's own npcTypes entries happen to define (ability scores/AC/HP
// for D&D, an Adversary-style block for another System, or nothing at
// all). `statsMap` here is already filtered down to just the keys
// Forge's own "Stats" tool preference selected (see resolveArchetypeStats
// in app.js) — this function doesn't know or care which keys those are,
// except for `abilityKeys` (below), needed to tell an ability score apart
// from any other kind of stat. There's nothing to roll here, it's a
// deterministic lookup by name, so it's a plain function rather than a
// rollX helper. Setting-specific archetypes (rolls 22/23), Wildcard (24),
// and any System with no Stats keys selected at all have no fixed
// identity/no stat concept — callers get null and should show a graceful
// fallback rather than blank/zeroed stats.
//
// Three things get special handling so a generated NPC can be added to
// Combat Tracker and show up correctly, matching the exact shape Crucible's
// own generated monsters and Characters both already use (see
// crucible/js/lib/stats.js#deriveStats and sys.dnd5e.json's own "abilities"
// object field — confirmed the suite-wide standard, not a Forge-specific
// choice, after this shape's own bug report): `abilityKeys` (the active
// System's own ability field keys, e.g. strength/dexterity/...) get pulled
// out of the raw npcTypes entry's flat keys and bundled into a nested
// `abilities` object rather than left sitting flat on `stats` — a flat
// ability key on `stats` isn't just wrong shape, it renders as a jumbled
// mess (confirmed real bug — see Belimmar/Berosalia's own saved records,
// undercroft/common/data/npc/*.json, both corrected back to this nested
// shape directly). `hitPoints` is authored as a flat number (the
// archetype's max), wrapped here into { max, current } — a freshly rolled
// NPC is undamaged, so current starts at max. `initiative.bonus` isn't
// authored data at all — it's derived from `abilities.dexterity` (D&D's own
// ability key, same hardcoded assumption Crucible's own stats.js makes for
// its generated monsters) via the standard ability-modifier formula,
// whenever dexterity is present in the resolved Stats subset — `{bonus}`,
// this suite's one shared initiative shape (see the monster-data-alignment
// plan), matching Monster/Character exactly. Every other
// key (armorClass, ...) passes through verbatim at the top level; Combat
// Tracker resolves AC/etc. through the System's own combatBindings
// directly.
export function getStatsForArchetype(statsMap, archetypeName, abilityKeys) {
  const entry = statsMap?.[archetypeName];
  if (!entry) return null;
  const { name, ...rest } = entry;
  const keySet = abilityKeys instanceof Set ? abilityKeys : new Set(abilityKeys || []);
  const abilities = {};
  const result = {};
  Object.entries(rest).forEach(([key, value]) => {
    if (keySet.has(key)) {
      abilities[key] = value;
    } else {
      result[key] = value;
    }
  });
  if (Object.keys(abilities).length) {
    result.abilities = abilities;
  }
  if (result.hitPoints !== undefined && typeof result.hitPoints !== "object") {
    const maxHp = Number(result.hitPoints) || 0;
    result.hitPoints = { max: maxHp, current: maxHp };
  }
  if (typeof abilities.dexterity === "number") {
    result.initiative = { bonus: abilityModifier(abilities.dexterity) };
  }
  return result;
}

// Resolves every archetype entry to its final display name for a given
// location (overridable rolls 22/23 substituted, or "Setting Specific" if
// the location hasn't filled them in) — shared by the roll itself, the
// manual-override <select>, and the Press template export, so all three can
// never disagree about what a given roll resolves to.
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
