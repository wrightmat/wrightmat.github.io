// Resolves a System's own `fieldRoles` declarations — the single explicit,
// Loom-authored answer to "which field plays this role" (ability scores,
// combat bindings, creature type, archetype table, ...), replacing the
// per-tool name-guessing/shape-sniffing and per-browser Settings-modal
// overrides those tools used to rely on. A System's `fieldRoles` is itself
// an ordinary reserved-key array field: values shaped
// `{sourceField, role, ...role-specific extras}` (e.g. `targetPath`), same
// convention as `buildSteps`/`combatBindings`. `sourceField` is the same
// "names a sibling top-level field on this System" concept combatBindings'
// own tags-role `sourceField` already used — one name for one concept,
// not a second one (`field`) for the identical idea. See README.md's
// "Reserved-key System fields" for the full role enum.
import { fieldByKey } from "./bindings.js";

function fieldRolesList(systemDefinition) {
  const fields = Array.isArray(systemDefinition?.fields) ? systemDefinition.fields : [];
  const fieldRolesField = fieldByKey(fields, "fieldRoles");
  return Array.isArray(fieldRolesField?.values) ? fieldRolesField.values : [];
}

// Returns the fieldRoles entry itself — `sourceField`/`role`/any
// role-specific extras (e.g. `targetPath`) — merged with `fieldDef`, the
// resolved System field record (`fieldByKey`'s own return shape), so a
// caller never needs a second lookup for the common case of just wanting
// the field's data. Null when the System declares no such role, or names a
// field that doesn't exist — either way, "not configured," never a thrown
// error.
export function resolveFieldRole(systemDefinition, role) {
  const entry = fieldRolesList(systemDefinition).find((candidate) => candidate?.role === role);
  if (!entry?.sourceField) return null;
  const fields = Array.isArray(systemDefinition?.fields) ? systemDefinition.fields : [];
  const fieldDef = fieldByKey(fields, entry.sourceField);
  if (!fieldDef) return null;
  return { ...entry, fieldDef };
}

// Plural sibling for roles more than one field can carry at once (Vault's
// `generatorProperty` — one entry per property-bearing field).
export function resolveFieldRoles(systemDefinition, role) {
  const fields = Array.isArray(systemDefinition?.fields) ? systemDefinition.fields : [];
  return fieldRolesList(systemDefinition)
    .filter((entry) => entry?.role === role && entry?.sourceField)
    .map((entry) => {
      const fieldDef = fieldByKey(fields, entry.sourceField);
      return fieldDef ? { ...entry, fieldDef } : null;
    })
    .filter(Boolean);
}
