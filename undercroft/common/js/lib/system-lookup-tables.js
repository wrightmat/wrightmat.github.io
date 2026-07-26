// Reshapes a D&D 5e System record's `fields` (authored/edited in Loom) into
// the exact object/array shapes the DDB-import pipeline used to get from the
// static common/js/lib/lookup-tables.js — so mapping-custom-functions.js's
// internal logic (.find(entry => entry.id === ...), positional access, etc.)
// and loom/mappings/ddb-character.json's/ddb-monster.json's `lookup('table',
// key)` calls need zero changes; only the *source* of the data changes, from
// a hardcoded module to the System record edited in Loom. See
// common/docs/lookup-tables-migration.md and common/docs/code-audit.md.
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

function fieldByKey(fields, key) {
  return Array.isArray(fields) ? fields.find((entry) => entry.key === key) : null;
}

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
    abilities,
    alignments: valuesOf(fields, "alignments").map((entry) => ({
      id: entry.sourceId,
      name: slug(entry.name),
      friendlyName: entry.name,
      shortName: entry.shortName,
    })),
    savingThrowSubtypes,
    senses: valuesOf(fields, "senses").map((entry) => ({ id: entry.sourceId, name: String(entry.name || "").toLowerCase() })),
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
  };
}
