// Strict shape validation for a System's reserved-key fields — the true
// reserved keys (category 1: buildSteps, levelUpBindings, derivedFormulas,
// dice, rolls, decks, currency, inventory, travelMeans, levels, casterTypes)
// plus fieldRoles itself, per common/data/reserved-keys.json. A category-2/3
// concept (saves, spellSlotProgression's old string vocabulary, ...) needs
// no special-cased validation here any more — either retired as a literal
// key, or now expressed through the one already-validated fieldRoles
// mechanism. Absence of an optional key is always valid, never a finding —
// a System that hasn't authored a concept yet just has nothing eligible.
import { fieldByKey } from "./bindings.js";
import { resolveFieldRole } from "./field-roles.js";

const EMPTY_SCHEMA = { bindings: {}, keys: [] };

let schemaPromise = null;
// Filled in once loadReservedKeysSchema's fetch resolves — lets a caller
// that can't await (e.g. undo/redo's synchronous row-rebuild) still
// classify a key as reserved, correctly, as long as the schema has already
// been fetched once (it's always kicked off well before any such call —
// see loom/js/app.js). Empty until then, which just means "nothing is
// reserved yet," never a thrown error.
let resolvedSchema = EMPTY_SCHEMA;

export async function loadReservedKeysSchema() {
  if (!schemaPromise) {
    schemaPromise = fetch(new URL("../../data/reserved-keys.json", import.meta.url))
      .then((response) => {
        if (!response.ok) throw new Error(`Failed to load reserved-keys.json: ${response.status}`);
        return response.json();
      })
      .catch(() => EMPTY_SCHEMA);
    schemaPromise.then((schema) => {
      resolvedSchema = schema;
    });
  }
  return schemaPromise;
}

// Synchronous membership check against the last-resolved schema — see
// resolvedSchema above for why this can't just always await.
export function isReservedKeyName(key) {
  return (resolvedSchema.keys || []).some((entry) => entry.key === key);
}

function describeValue(value, index) {
  return value?.name || value?.step || value?.role || value?.id || value?.sourceField || `#${index + 1}`;
}

// One entry's own required-key check — `valueRequires` are all mandatory;
// `valueRequiresOneOf`, when present, needs at least one of its names.
function validateValueShape(schemaEntry, value, index, findings) {
  (schemaEntry.valueRequires || []).forEach((requiredKey) => {
    if (value?.[requiredKey] === undefined || value?.[requiredKey] === null || value?.[requiredKey] === "") {
      findings.push({
        level: "error",
        key: schemaEntry.key,
        message: `${schemaEntry.key}[${describeValue(value, index)}] is missing its own required "${requiredKey}".`,
      });
    }
  });
  if (Array.isArray(schemaEntry.valueRequiresOneOf) && schemaEntry.valueRequiresOneOf.length) {
    const hasOne = schemaEntry.valueRequiresOneOf.some((key) => value?.[key] !== undefined && value?.[key] !== null && value?.[key] !== "");
    if (!hasOne) {
      findings.push({
        level: "error",
        key: schemaEntry.key,
        message: `${schemaEntry.key}[${describeValue(value, index)}] needs one of: ${schemaEntry.valueRequiresOneOf.join(", ")}.`,
      });
    }
  }
}

function validateFieldRoles(fields, fieldRolesField, bindingList, findings) {
  const knownRoles = new Set(bindingList.map((entry) => entry.name));
  const otherFieldKeys = new Set(fields.filter((entry) => entry !== fieldRolesField).map((entry) => entry?.key));
  (fieldRolesField.values || []).forEach((value, index) => {
    if (!knownRoles.has(value?.role)) {
      findings.push({
        level: "error",
        key: "fieldRoles",
        message: `fieldRoles[${describeValue(value, index)}] has an unrecognized role "${value?.role}".`,
      });
    }
    if (value?.sourceField && !otherFieldKeys.has(value.sourceField)) {
      findings.push({
        level: "error",
        key: "fieldRoles",
        message: `fieldRoles[${describeValue(value, index)}] names a field "${value.sourceField}" this System doesn't declare.`,
      });
    }
  });
}

// Same "does this value's role match a name the registry actually knows
// about" check as fieldRoles gets, generalized to every other binding
// vocabulary (combatBindings/derivedFormulas/levelUpBindings) now that
// they're all documented in reserved-keys.json's `bindings` map instead of
// only fieldRoles having one. No sourceField-existence check here — that's
// fieldRoles-specific (its role points at a field; these don't).
function validateBindingRoles(key, field, bindingList, findings) {
  if (!bindingList?.length) return;
  const knownRoles = new Set(bindingList.map((entry) => entry.name));
  (field.values || []).forEach((value, index) => {
    if (value?.role && !knownRoles.has(value.role)) {
      findings.push({
        level: "error",
        key,
        message: `${key}[${describeValue(value, index)}] has an unrecognized role "${value.role}".`,
      });
    }
  });
}

// `fields` — a System record's own top-level `fields` array. Returns a flat
// findings list (empty when nothing's wrong); each finding is
// {level: "error", key, message}. Wrong shape on a PRESENT key is a real
// bug (error); a key that's simply absent produces no finding at all.
export async function validateSystemFields(fields) {
  const list = Array.isArray(fields) ? fields : [];
  const schema = await loadReservedKeysSchema();
  const findings = [];
  schema.keys.forEach((schemaEntry) => {
    const field = fieldByKey(list, schemaEntry.key);
    if (!field) return;
    // buildSteps' one documented alternate shape (workbench-character-view.js's
    // getDeclaredBuildSteps): type "object", keyed by Template id, each value
    // an ordinary buildSteps array — for a System with more than one
    // creatable Template needing a different wizard each (Blades in the
    // Dark: Character vs. Crew).
    if (schemaEntry.perTemplateMapType && field.type === schemaEntry.perTemplateMapType) {
      const map = field.values && typeof field.values === "object" && !Array.isArray(field.values) ? field.values : {};
      Object.entries(map).forEach(([templateId, perTemplateValues]) => {
        if (!Array.isArray(perTemplateValues)) {
          findings.push({
            level: "error",
            key: schemaEntry.key,
            message: `"${schemaEntry.key}[${templateId}]" should be an array of steps, found "${typeof perTemplateValues}".`,
          });
          return;
        }
        perTemplateValues.forEach((value, index) => validateValueShape(schemaEntry, value, index, findings));
      });
      return;
    }
    if (field.type !== schemaEntry.type) {
      findings.push({
        level: "error",
        key: schemaEntry.key,
        message: `"${schemaEntry.key}" should be type "${schemaEntry.type}", found "${field.type}".`,
      });
      return;
    }
    const values = Array.isArray(field.values) ? field.values : [];
    values.forEach((value, index) => {
      if (schemaEntry.key === "fieldRoles") return; // handled separately below, needs the full fields list
      validateValueShape(schemaEntry, value, index, findings);
    });
    // derivedFormulas/levelUpBindings each have their own documented binding
    // vocabulary now (reserved-keys.json's `bindings` map) — flag a role
    // that matches nothing the engine actually looks for, same as fieldRoles
    // already does for its own role property.
    validateBindingRoles(schemaEntry.key, field, schema.bindings?.[schemaEntry.key], findings);
  });
  const fieldRolesField = fieldByKey(list, "fieldRoles");
  if (fieldRolesField && Array.isArray(fieldRolesField.values)) {
    fieldRolesField.values.forEach((value, index) => validateValueShape(schema.keys.find((k) => k.key === "fieldRoles"), value, index, findings));
    validateFieldRoles(list, fieldRolesField, schema.bindings?.fieldRoles || [], findings);
  }
  // combatBindings isn't a literal top-level key (matched via fieldRoles'
  // own "combatBindings" role, not a fixed name) — resolve it the same way
  // every other consumer does before checking its values' own binding roles.
  const combatBindingsField = resolveFieldRole({ fields: list }, "combatBindings")?.fieldDef;
  if (combatBindingsField) {
    validateBindingRoles("combatBindings", combatBindingsField, schema.bindings?.combatBindings, findings);
  }
  return findings;
}
