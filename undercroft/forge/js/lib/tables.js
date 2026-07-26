// dice.js lives under workbench/js/lib, not common/js/lib — it's a generic
// NdM-notation parser with no workbench-specific logic of its own, but it
// hasn't been promoted to common yet (it depends on workbench's own
// component-data.js for @-variable substitution, a feature Forge doesn't
// use but still needs to resolve at import time). Reusing it in place here
// rather than duplicating a second dice parser.
import { rollDiceExpression } from "../../../workbench/js/lib/dice.js";
import { fetchLibraryEntry, fetchKindEntriesWithIds } from "../../../common/js/lib/content-fetch.js";
import { abilityModifier } from "../../../common/js/lib/dnd-rules.js";

// Alignment (d10, 9 alignments + Unaligned, equal weighting) and Gender (d8,
// Male x3 / Female x3 / Androgynous x1 / Non-Binary x1) are genuinely uniform
// die rolls with a fixed face->outcome mapping — CLAUDE.md gives the full
// face list for both, so they're plain constants here rather than JSON (they
// never vary by location or system, unlike Archetype).
export const ALIGNMENT_FACES = [
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

// CLAUDE.md only names the two endpoints (Hostile 1 / Helpful 6) for the
// numeric Attitude scale; these fill in 2-5 so every roll has a
// human-readable label to display alongside its number.
export const ATTITUDE_LABELS = ["Hostile", "Unfriendly", "Wary", "Neutral", "Friendly", "Helpful"];

export function getAttitudeLabel(value) {
  return ATTITUDE_LABELS[Number(value) - 1] || "";
}

let tablesPromise = null;

// Loads the system-agnostic/system-specific table files once and caches the
// parsed result — these never change at runtime, unlike Locations (which
// the GM can add/edit via the Location Builder panel) and Species Name
// Profiles (edited via Manage Species, loaded separately below since which
// ones are needed depends on which Location is selected).
export async function loadForgeTables() {
  if (!tablesPromise) {
    tablesPromise = (async () => {
      const base = new URL("../../data/", import.meta.url);
      const [fourD, archetype, stats] = await Promise.all([
        fetch(new URL("tables-4d.json", base)).then((r) => r.json()),
        fetch(new URL("archetypes-dnd5e.json", base)).then((r) => r.json()),
        fetch(new URL("stats-dnd5e.json", base)).then((r) => r.json()),
      ]);
      return { fourD, archetype, stats };
    })();
  }
  return tablesPromise;
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
    .filter((entry) => entry.entity.systemId === systemId)
    .map((entry) => ({ id: entry.id, name: entry.entity.name || entry.id }));
}

export async function listLocationsForSetting(dataManager, settingId) {
  if (!settingId) return [];
  const entries = await fetchKindEntriesWithIds(dataManager, "location");
  return entries
    .filter((entry) => entry.entity.settingId === settingId)
    .map((entry) => ({ id: entry.id, name: entry.entity.name || entry.id }));
}

// The location's own id doesn't live in the JSON body (same convention as
// every other library kind — the filename is the id), so it's stamped onto
// the returned object here; the rest of Forge (export-template ids, the
// per-Location name-generator model cache) already expects `currentLocation.id`.
export async function loadLocation(id) {
  const entity = await fetchLibraryEntry("location", id);
  return { id, ...entity };
}

export async function loadSetting(id) {
  const entity = await fetchLibraryEntry("setting", id);
  return { id, ...entity };
}

// Species used to be a Forge-only "Species Name Profile" file, entirely
// separate from the shared Library's own species/*.json (DDB trait data).
// They're now the same file — a species entity's `names` section — so this
// caches {id, label, nameMode, lastNameForm, firstNames, lastNames} derived
// from whichever species entities a Location's population actually
// references, instead of loading a Forge-only profile store.
const speciesProfileCache = new Map();

export async function loadSpeciesProfilesForLocation(location) {
  const ids = Array.from(
    new Set((location?.speciesWeights || []).map((entry) => entry.entityId).filter(Boolean))
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

export function rollAlignment({ random = Math.random, override = "" } = {}) {
  if (override) {
    return { label: override, roll: null, manual: true };
  }
  const { face, notation } = rollUniformD(10, "1d10", { random });
  return { label: ALIGNMENT_FACES[face - 1], roll: face, notation };
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

// Numeric scale, Hostile (1) to Helpful (6) — the record keeps the raw
// number as canonical data (rerolls/comparisons stay simple), with `label`
// alongside it purely for display.
export function rollAttitude({ random = Math.random } = {}) {
  const { face, notation } = rollUniformD(6, "1d6", { random });
  return { value: face, label: getAttitudeLabel(face), notation };
}

// Basic combat stats (ability scores, AC, HP) come straight from the D&D5e
// Monster Manual NPC stat block matching this archetype — CLAUDE.md: "using
// D&D 5e Monster Manual NPC stat blocks." There's nothing to roll here, it's
// a deterministic lookup by name, so it's a plain function rather than a
// rollX helper. Setting-specific archetypes (rolls 22/23) and Wildcard (24)
// have no fixed identity, so no stat block exists for them — callers get
// null and should show a graceful fallback rather than blank/zeroed stats.
// stats-dnd5e.json stores hitPoints as a flat number (the archetype's max) —
// wrapped into { max, current } here to match the shape every kind's
// stats.hitPoints uses (see combat-tracker.js#addCombatant). A freshly
// rolled NPC is undamaged, so current starts at max.
export function getStatsForArchetype(statsTable, archetypeName) {
  const entry = statsTable?.archetypes?.[archetypeName];
  if (!entry) return null;
  const maxHp = Number(entry.hitPoints ?? 0);
  return {
    ...entry,
    hitPoints: { max: maxHp, current: maxHp },
    // Combat Tracker's "Roll Initiative" button reads this via the System's
    // combatBindings rather than deriving it itself — the D&D-specific math
    // stays here in the 5e generator, not in system-agnostic tracker code.
    initiativeBonus: abilityModifier(entry.abilities?.dexterity),
  };
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
