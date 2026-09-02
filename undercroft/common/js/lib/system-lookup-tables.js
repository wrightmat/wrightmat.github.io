import { fieldByKey } from "./bindings.js";

// Reshapes a D&D 5e System record's `fields` (authored/edited in Loom) into
// the exact object/array shapes the DDB-import pipeline used to get from the
// static common/js/lib/lookup-tables.js — so mapping-custom-functions.js's
// internal logic (.find(entry => entry.id === ...), positional access, etc.)
// and loom/mappings/ddb-character.json's/ddb-monster.json's `lookup('table',
// key)` calls need zero changes; only the *source* of the data changes, from
// a hardcoded module to the System record edited in Loom. See
// undercroft/README.md's Code Conventions section for the full disposition.
//
// This is the one place that has to know "sys.dnd5e's `conditions` field is
// lookup-tables.js's old CONDITIONS table" etc. — unavoidable, appropriately
// -scoped DDB-import glue (same category as mapping-custom-functions.js
// itself), not a reintroduction of hardcoded schema: the actual vocabulary
// values live in and come from the System record, addressed here only by
// each field's own `key`.
//
// mapping-engine.js's makeLookupFn is untouched: every object produced below
// carries an `id` (copied from the System's own `sourceId` convention,
// established by the pre-existing `alignments` field) so its existing
// `entry.id === key` match keeps working unmodified.

function valuesOf(fields, key) {
  const field = fieldByKey(fields, key);
  return Array.isArray(field?.values) ? field.values : [];
}

function childrenOf(fields, key) {
  const field = fieldByKey(fields, key);
  return Array.isArray(field?.children) ? field.children : [];
}

function slug(name) {
  return String(name || "").toLowerCase().replace(/\s+/g, "-");
}

// lookup-tables.js's ACTIVATIONS/COMPONENTS/CONDITIONS were plain, positional
// string arrays (`lookup('conditions', @value)` returns the bare name
// string, not an object) — reproduced here by placing each value at its own
// `sourceId` index, defaulting every other slot (including 0, the "no value"
// placeholder DDB sometimes sends) to "" so a lookup miss behaves exactly
// like the old table's gaps instead of returning `undefined`.
function positional(values, pluck) {
  const maxId = values.reduce((max, entry) => Math.max(max, entry.sourceId || 0), 0);
  const arr = new Array(maxId + 1).fill("");
  values.forEach((entry) => {
    if (typeof entry.sourceId === "number") arr[entry.sourceId] = pluck(entry);
  });
  return arr;
}

const positionalNames = (values) => positional(values, (entry) => entry.name);

export function deriveLookupTables(systemPayload) {
  const fields = Array.isArray(systemPayload?.fields) ? systemPayload.fields : [];

  const abilities = childrenOf(fields, "abilities").map((child) => ({
    id: child.sourceId,
    name: String(child.key || "").split(".").pop(),
    friendlyName: child.label,
    shortName: child.shortName,
  }));

  const skills = valuesOf(fields, "skills").map((entry) => ({
    id: entry.sourceId,
    name: slug(entry.name),
    friendlyName: entry.name,
    // Legacy shape indexed ABILITIES by position (stat: 0-5); the System's
    // own skills field instead names the ability directly, so resolve it to
    // the matching position in `abilities` above for any consumer still
    // doing positional access (mapping-custom-functions.js's `ABILITIES[skill.stat]`).
    stat: abilities.findIndex((ability) => ability.name === entry.ability),
  }));

  const savingThrowSubtypes = {};
  childrenOf(fields, "saves").forEach((child) => {
    const name = String(child.key || "").split(".").pop();
    if (name && child.ddbSubtype) savingThrowSubtypes[name] = child.ddbSubtype;
  });

  return {
    // Original ACTIVATIONS values were short DDB casting-time codes ("A",
    // "BA", "R", "s", "m", "h", "S"), not the full-word `name`s Undercroft
    // authors see in Loom — those codes are preserved on each entry's own
    // `shortName` property (see sys.dnd5e.json's "activation" field).
    activations: positional(valuesOf(fields, "activation"), (entry) => entry.shortName),
    components: positional(valuesOf(fields, "components"), (entry) => entry.shortName),
    conditions: positionalNames(valuesOf(fields, "conditions")),
    // sys.dnd5e.json's own "creatureTypes" field (Crucible's own generation
    // vocabulary — see crucible/CLAUDE.md) — each value's own `sourceId`
    // (added specifically for this) ties it to D&D Beyond's own numeric
    // typeId (e.g. 14 = Ooze). `name` here carries the value's own semantic
    // `id` string ("ooze"), matching Crucible's own generated monsters' and
    // the DDB/Fantasy Statblocks monster mappings' shared top-level `type`
    // field, NOT the value's display `name` — same "`.name` is the thing
    // this lookup is actually for" convention `sizes`/`alignments` already
    // establish in this file.
    creatureTypes: valuesOf(fields, "creatureTypes").map((entry) => ({ id: entry.sourceId, name: entry.id })),
    // sys.dnd5e.json's own "environment" field (Sanctum's own generator-
    // property vocabulary, reused here) — each value's own `sourceId`
    // (added specifically for this) ties it to D&D Beyond's own numeric
    // environment id.
    environments: valuesOf(fields, "environment").map((entry) => ({ id: entry.sourceId, name: entry.name })),
    // Only a fallback source for attacksTable (mapping-custom-functions.js)
    // — DDB's own friendly damage-type strings (weapon items'
    // `definition.damageType`, spell-backed actions' own `type:"damage"`
    // modifier) are always preferred when present; this only resolves the
    // rarer case where an action carries just a numeric `damageTypeId`
    // with no string anywhere nearby. sourceId 0-3 (None/Bludgeoning/
    // Piercing/Slashing) are user-confirmed; 4-13 are a best-effort guess
    // (see sys.dnd5e.json's own damageTypes field) — correct there if
    // wrong, nothing here depends on the specific numbers.
    damageTypes: valuesOf(fields, "damageTypes").map((entry) => ({ id: entry.sourceId, name: entry.name })),
    // Positional (index = sourceId), matching DDB's own numeric
    // limitedUse.resetType codes directly — confirmed against a live
    // export: `resetType: 2` there is "Long Rest".
    durations: positionalNames(valuesOf(fields, "durations")),
    abilities,
    alignments: valuesOf(fields, "alignments").map((entry) => ({
      id: entry.sourceId,
      name: slug(entry.name),
      friendlyName: entry.name,
      shortName: entry.shortName,
    })),
    savingThrowSubtypes,
    // sys.dnd5e.json's own field is "challengeRating" (D&D's specific name
    // for its own Combat Scaling data — see that field's own comment) —
    // `shortName` is the real, portable CR value ("1/2") ddb-monster.json's
    // own `lookup('challengeRatings', @challengeRatingId)` resolves to;
    // `id` (sourceId) matches DDB's own numeric challengeRatingId directly.
    challengeRatings: valuesOf(fields, "challengeRating").map((entry) => ({
      id: entry.sourceId,
      name: entry.name,
      shortName: entry.shortName,
    })),
    senses: valuesOf(fields, "senses").map((entry) => ({ id: entry.sourceId, name: String(entry.name || "").toLowerCase() })),
    // sys.dnd5e.json's own "rarity"/"form"/"activation" fields — Vault's
    // own generator-property vocabulary (see vault/CLAUDE.md). Plain
    // value-name lists (no sourceId — nothing in DDB's own numeric scheme
    // needs these), resolved live off the System record so mapping-custom-
    // functions.js's own srdItemProperties can match SRD source text
    // against whatever this System's own author actually named each value
    // TODAY, rather than a second, hardcoded copy of the same vocabulary
    // going stale the moment someone renames/adds/removes a value in Loom.
    rarities: valuesOf(fields, "rarity").map((entry) => entry.name),
    itemForms: valuesOf(fields, "form").map((entry) => entry.name),
    activationTypes: valuesOf(fields, "activation").map((entry) => entry.name),
    // Same reasoning, for the sub-classification fields that sit BENEATH
    // one Item Form value each — a Weapon's own Simple/Martial+Melee/Ranged
    // split, an Armor's own Light/Medium/Heavy/Shield split, and (once a
    // System author adds it — see sys.dnd5e.json's own "equipmentCategories"
    // field) an ordinary Equipment item's own Tools/Instrument/Gaming-Set/
    // Mounts-and-Vehicles/Ammunition split — srdEquipmentStats
    // (mapping-custom-functions.js) reads all three the same way
    // srdItemProperties already reads itemForms/rarities/activationTypes.
    weaponCategories: valuesOf(fields, "weaponCategories").map((entry) => entry.name),
    armorCategories: valuesOf(fields, "armorCategories").map((entry) => entry.name),
    equipmentCategories: valuesOf(fields, "equipmentCategories").map((entry) => entry.name),
    // Legacy SIZES exposed the short DDB size code ("tiny"/"sm"/"med"/...) as
    // `value` (matched directly against DDB's own raw size strings in
    // mapping-custom-functions.js's determineSize) — the System's own field
    // now calls this `shortName` for naming consistency with every other
    // vocabulary field, translated back to `value` here since that's what
    // the consumer actually checks.
    sizes: valuesOf(fields, "sizes").map((entry) => ({ id: entry.sourceId, name: entry.name, value: entry.shortName })),
    skills,
    speeds: valuesOf(fields, "speeds").map((entry) => ({
      id: entry.sourceId,
      name: String(entry.name || "").toLowerCase(),
      shortName: entry.shortName,
    })),
    // Passed straight through (not reshaped — createMappingCustomFunctions'
    // own evaluateDerivedFormula reads the reserved-key shape directly,
    // {role, formula}, same as every other consumer of this field) so
    // getProficiencyBonusRaw resolves via the System's own authored
    // formula instead of a hardcoded one — see derived-formulas.js.
    derivedFormulas: Array.isArray(fieldByKey(fields, "derivedFormulas")?.values) ? fieldByKey(fields, "derivedFormulas").values : [],
  };
}
