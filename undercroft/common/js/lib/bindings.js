import { evaluateFormula } from "./formula-engine.js";
import { resolveDottedPath, setAtDottedPath } from "./dotted-path.js";

const SIMPLE_BINDING_PATTERN = /^@[A-Za-z0-9_.]+$/;
const FORMULA_HINT_PATTERN = /[+*/<>=!?&|()-]|\bif\s*\(/;

function hasBalancedQuotes(value) {
  let doubleCount = 0;
  let singleCount = 0;
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];
    if (char === "\\" && index + 1 < value.length) {
      index += 1;
      continue;
    }
    if (char === "\"") {
      doubleCount += 1;
    } else if (char === "'") {
      singleCount += 1;
    }
  }
  return doubleCount % 2 === 0 && singleCount % 2 === 0;
}

function shouldEvaluateFormula(value) {
  if (typeof value !== "string") {
    return false;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return false;
  }
  if (trimmed.startsWith("=")) {
    if (trimmed.length <= 1) {
      return false;
    }
    const body = trimmed.slice(1).trim();
    if (!body) {
      return false;
    }
    if (body.includes("@")) {
      return true;
    }
    if (/["']/.test(body)) {
      return hasBalancedQuotes(trimmed);
    }
    if (/^[0-9+\-*/().\s]+$/.test(body)) {
      return true;
    }
    if (/\b[A-Za-z_][A-Za-z0-9_]*\s*\(/.test(body)) {
      return true;
    }
    return false;
  }
  if (!trimmed.includes("@")) {
    return false;
  }
  if (SIMPLE_BINDING_PATTERN.test(trimmed)) {
    return false;
  }
  return FORMULA_HINT_PATTERN.test(trimmed);
}

// `formulaOptions` is passed straight through to evaluateFormula's `options`
// (e.g. `{ functions: { lookup } }`) — optional and additive, existing two-arg
// callers are unaffected.
export function resolveBinding(binding, context, formulaOptions) {
  if (typeof binding !== "string") {
    return binding;
  }
  const trimmed = binding.trim();
  if (!trimmed) {
    return binding;
  }
  // No coerceValue here, unlike formula-engine.js's getter — a resolved
  // binding can be non-numeric (a Tags value, an Object field), where
  // coercing a missing path to 0 would be wrong.
  const resolvePath = (path) => resolveDottedPath(context, path.slice(1));
  if (shouldEvaluateFormula(trimmed)) {
    try {
      return evaluateFormula(trimmed, context ?? {}, formulaOptions);
    } catch (error) {
      console.warn("bindings: unable to evaluate formula", error);
      if (trimmed.startsWith("@")) {
        return resolvePath(trimmed);
      }
      return "";
    }
  }
  if (trimmed.startsWith("=")) {
    return "";
  }
  if (!trimmed.startsWith("@")) {
    return binding;
  }
  return resolvePath(trimmed);
}

// The write-side companion to resolveBinding()'s plain-path case — a
// formula binding has no single cell to write back to, so only a simple
// "@a.b.c" path is settable. Mutates `context` in place, auto-vivifying
// intermediate objects, so every consumer (Press, Workbench, Combat
// Tracker) shares one implementation instead of three.
export function setAtBinding(binding, context, value) {
  if (typeof binding !== "string") {
    return false;
  }
  const trimmed = binding.trim();
  if (!trimmed.startsWith("@")) {
    return false;
  }
  return setAtDottedPath(context, trimmed.slice(1), value);
}

function normalizeLookupKey(value) {
  return value === undefined || value === null ? "" : String(value).trim().toLowerCase();
}

// An entry matches a lookup key by whichever field it has — sourceId/id,
// the last dotted segment of `key`, or name/shortName/label. A bare
// scalar entry matches directly, so a plain string/number list works as a
// lookup table too, not just System-shaped objects.
function lookupEntryMatches(entry, key) {
  if (entry === undefined || entry === null) return false;
  if (typeof entry !== "object") {
    return normalizeLookupKey(entry) === normalizeLookupKey(key);
  }
  const keySuffix = typeof entry.key === "string" ? entry.key.split(".").pop() : undefined;
  const candidates = [entry.sourceId, entry.id, keySuffix, entry.name, entry.shortName, entry.label];
  return candidates.some(
    (candidate) => candidate !== undefined && normalizeLookupKey(candidate) === normalizeLookupKey(key)
  );
}

function findInLookupTable(table, key) {
  if (Array.isArray(table)) {
    return table.find((entry) => lookupEntryMatches(entry, key));
  }
  if (table && typeof table === "object" && Object.prototype.hasOwnProperty.call(table, key)) {
    return table[key];
  }
  return undefined;
}

// The generic `lookup(table, key)` formula function, shared by every tool.
// `table` resolves two ways: (1) against `fieldDefinitions` (a System's
// `fields` array, when the caller has one) — a field whose `key` matches
// `table` has its `children`/`values` reshaped into a searchable list; (2)
// failing that, as a plain dotted path against `context`, the same data any
// @binding reads. This is what makes `lookup` work identically in Press (no
// System) and Workbench with no tool-specific lookup logic.
// Returns the whole matched entry (never an invented placeholder), so a
// formula can read any of its properties, e.g. `lookup("abilities","str").color`.
export function createLookupFn(context, fieldDefinitions) {
  return (table, key) => {
    if (typeof table !== "string" || !table.trim()) return undefined;
    const name = table.trim();
    if (Array.isArray(fieldDefinitions)) {
      const field = fieldDefinitions.find((entry) => entry && entry.key === name);
      const entries = Array.isArray(field?.children)
        ? field.children
        : Array.isArray(field?.values)
          ? field.values
          : null;
      if (entries) {
        const match = entries.find((entry) => lookupEntryMatches(entry, key));
        if (match !== undefined) return match;
      }
    }
    return findInLookupTable(resolveDottedPath(context, name), key);
  };
}

// `lookup` only matches an entry's identity-ish fields, so it can't find
// e.g. an entry by an arbitrary field like `level`. `lookupField(table,
// matchField, matchValue, targetField)` is the generic version — caller
// names which field to match and which to read back, mirroring the WRITE
// side's adjustField lookup shape (workbench-character-view.js).
// `rootContext` is always the TOP-LEVEL record regardless of the calling
// formula's scope (a lookup table lives outside any one Repeater row).
// `targetField` omitted returns the whole entry; no match returns
// undefined, never an invented 0/false a formula could misread as real.
export function createLookupFieldFn(rootContext) {
  return (table, matchField, matchValue, targetField) => {
    if (typeof table !== "string" || !table.trim()) return undefined;
    if (typeof matchField !== "string" || !matchField.trim()) return undefined;
    const list = resolveDottedPath(rootContext, table.trim());
    if (!Array.isArray(list)) return undefined;
    const field = matchField.trim();
    const match = list.find((entry) => entry && typeof entry === "object" && String(entry[field]) === String(matchValue));
    if (match === undefined) return undefined;
    const target = typeof targetField === "string" ? targetField.trim() : "";
    return target ? match[target] : match;
  };
}

// Every reserved-key System field (dice, combatBindings, derivedFormulas,
// ...) is an entry INSIDE the System's own `fields` array, never a flat
// top-level property — `systemDefinition.derivedFormulas` directly is
// always undefined. A scalar field's value lives at
// `fieldByKey(fields, key)?.default`, an array field's at `?.values`, an
// object field's nested values at `?.children`.
//
// `key` may itself be dot-nested (e.g. "inventory.quantity") — the System's
// own field list is an array-of-keyed-objects at every level (top-level
// `fields`, an object field's own `children`, a records-mode array field's
// `item.children`), so walking a deeper segment means the same
// find-by-key lookup again, one level in, not a plain object-property
// walk (that's what resolveDottedPath is for, against a plain nested
// object like a Character or Library record). Every existing call site
// passes a single, dot-free key, so this is purely additive.
export function fieldByKey(fields, key) {
  const segments = String(key ?? "").split(".");
  let current = (Array.isArray(fields) ? fields : []).find((entry) => entry?.key === segments[0]) || null;
  for (let index = 1; index < segments.length && current; index += 1) {
    const nested = Array.isArray(current.children)
      ? current.children
      : Array.isArray(current.item?.children)
        ? current.item.children
        : null;
    current = nested ? nested.find((entry) => entry?.key === segments[index]) || null : null;
  }
  return current;
}

// A System's live play-state (HP, AC, conditions, initiative) lives on an
// ordinary array field, whose VALUES carry a `role` — a generic vocabulary
// (Loom's "Role" help topic: resource/value/tags/modifier), not
// combat-specific. Which field that is is the System's own explicit
// `fieldRoles` declaration (role "combatBindings") — see field-roles.js's
// resolveFieldRole, which this mirrors locally rather than importing (to
// avoid a circular dependency, since field-roles.js is itself built on
// fieldByKey below) — so a System only authors that mapping once, in Loom,
// for both Combat Tracker and Workbench's character view to pick up.
export function findRoleBoundField(fields) {
  const list = Array.isArray(fields) ? fields : [];
  const fieldRolesField = fieldByKey(list, "fieldRoles");
  const entry = (Array.isArray(fieldRolesField?.values) ? fieldRolesField.values : []).find(
    (candidate) => candidate?.role === "combatBindings"
  );
  return (entry?.field && fieldByKey(list, entry.field)) || null;
}

// Finds one entry of a given role within a role-bound field's `.values`
// (findRoleBoundField above) — shared by combat-tracker.js and
// character-sheet.js rather than duplicated in each.
export function findBindingByRole(bindings, role) {
  return (bindings || []).find((entry) => entry && entry.role === role) || null;
}

// Plural sibling — several Systems share a role across multiple bindings
// (Daggerheart's Hope/Stress/HP all "resource"), which findBindingByRole
// silently reduces to just the first. For a caller that already handles
// more than one; existing single-resource UIs stay on the singular version.
export function findBindingsByRole(bindings, role) {
  return (bindings || []).filter((entry) => entry && entry.role === role);
}
