import { fieldByKey } from "./bindings.js";

// Reshapes a D&D 5e System record's `fields` (authored/edited in Loom) into
// the exact object/array shapes the DDB-import pipeline used to get from the
// old static lookup-tables.js — so mapping-custom-functions.js's internal
// logic and loom/mappings/ddb-*.json's `lookup('table', key)` calls need
// zero changes; only the *source* changes, from a hardcoded module to the
// System record edited in Loom.
//
// This is the one place that has to know "sys.dnd5e's `conditions` field is
// the old CONDITIONS table" etc. — appropriately-scoped DDB-import glue
// (same category as mapping-custom-functions.js), not hardcoded schema: the
// vocabulary values live in the System record, addressed here only by key.
//
// Every object produced below carries an `id` (from the System's own
// `sourceId` convention) so mapping-engine.js's makeLookupFn `entry.id ===
// key` match keeps working unmodified.

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

// ACTIVATIONS/COMPONENTS/CONDITIONS used to be plain, positional string
// arrays (`lookup('conditions', @value)` returns the bare name, not an
// object) — reproduced here by placing each value at its own `sourceId`
// index, defaulting other slots (including 0, DDB's "no value" placeholder)
// to "" so a lookup miss behaves like the old table's gaps, not `undefined`.
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
    // Legacy shape indexed abilities by position (stat: 0-5); resolved here
    // for mapping-custom-functions.js's `ABILITIES[skill.stat]` consumers.
    stat: abilities.findIndex((ability) => ability.name === entry.ability),
  }));

  const savingThrowSubtypes = {};
  childrenOf(fields, "saves").forEach((child) => {
    const name = String(child.key || "").split(".").pop();
    if (name && child.ddbSubtype) savingThrowSubtypes[name] = child.ddbSubtype;
  });

  return {
    // Original ACTIVATIONS values were short DDB casting-time codes ("A",
    // "BA", "R"...), preserved on each entry's `shortName` (sys.dnd5e.json's
    // "activation" field).
    activations: positional(valuesOf(fields, "activation"), (entry) => entry.shortName),
    components: positional(valuesOf(fields, "components"), (entry) => entry.shortName),
    conditions: positionalNames(valuesOf(fields, "conditions")),
    // `sourceId` ties each creatureTypes value to D&D Beyond's numeric
    // typeId (14 = Ooze); `name` here is the value's semantic id ("ooze"),
    // matching Crucible's generated monsters' shared top-level `type` field.
    creatureTypes: valuesOf(fields, "creatureTypes").map((entry) => ({ id: entry.sourceId, name: entry.id })),
    // `sourceId` ties each environments value to DDB's numeric environment id.
    environments: valuesOf(fields, "environment").map((entry) => ({ id: entry.sourceId, name: entry.name })),
    // Fallback source only for attacksTable — DDB's own friendly damage-type
    // strings are preferred when present; this resolves the rarer case of a
    // bare numeric `damageTypeId`. sourceId 0-3 confirmed; 4-13 best-effort.
    damageTypes: valuesOf(fields, "damageTypes").map((entry) => ({ id: entry.sourceId, name: entry.name })),
    // Positional (index = sourceId), matching DDB's numeric
    // limitedUse.resetType directly (resetType: 2 = "Long Rest").
    durations: positionalNames(valuesOf(fields, "durations")),
    abilities,
    alignments: valuesOf(fields, "alignments").map((entry) => ({
      id: entry.sourceId,
      name: slug(entry.name),
      friendlyName: entry.name,
      shortName: entry.shortName,
    })),
    savingThrowSubtypes,
    // sys.dnd5e.json's field is "challengeRating" (D&D's name for its own
    // Combat Scaling data) — `shortName` is the portable CR value ("1/2")
    // ddb-monster.json's lookup resolves to; `id` matches DDB's numeric
    // challengeRatingId.
    challengeRatings: valuesOf(fields, "challengeRating").map((entry) => ({
      id: entry.sourceId,
      name: entry.name,
      shortName: entry.shortName,
    })),
    senses: valuesOf(fields, "senses").map((entry) => ({ id: entry.sourceId, name: String(entry.name || "").toLowerCase() })),
    // Vault's own rarity/form/activation generator-property vocabulary
    // (vault/CLAUDE.md). Plain value-name lists, resolved live off the
    // System record so srdItemProperties matches SRD text against whatever
    // an author actually named each value today, not a hardcoded copy.
    rarities: valuesOf(fields, "rarity").map((entry) => entry.name),
    itemForms: valuesOf(fields, "form").map((entry) => entry.name),
    activationTypes: valuesOf(fields, "activation").map((entry) => entry.name),
    // Same reasoning for the sub-classification fields beneath one Item Form
    // each (Weapon's Simple/Martial split, Armor's Light/Medium/Heavy/Shield
    // split, Equipment's own categories) — srdEquipmentStats reads all three
    // the way srdItemProperties reads the fields above.
    weaponCategories: valuesOf(fields, "weaponCategories").map((entry) => entry.name),
    armorCategories: valuesOf(fields, "armorCategories").map((entry) => entry.name),
    equipmentCategories: valuesOf(fields, "equipmentCategories").map((entry) => entry.name),
    // Legacy SIZES exposed the short DDB size code as `value` (matched
    // against DDB's raw size strings in determineSize); the System's field
    // calls this `shortName` for naming consistency, translated back here.
    sizes: valuesOf(fields, "sizes").map((entry) => ({ id: entry.sourceId, name: entry.name, value: entry.shortName })),
    skills,
    speeds: valuesOf(fields, "speeds").map((entry) => ({
      id: entry.sourceId,
      name: String(entry.name || "").toLowerCase(),
      shortName: entry.shortName,
    })),
    // Passed straight through (not reshaped) so getProficiencyBonusRaw
    // resolves via the System's authored formula — see derived-formulas.js.
    derivedFormulas: Array.isArray(fieldByKey(fields, "derivedFormulas")?.values) ? fieldByKey(fields, "derivedFormulas").values : [],
  };
}
