import { evaluateFormula } from "./formula-engine.js";
import { resolveDottedPath } from "./dotted-path.js";

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
  // Deliberately no coerceValue here, unlike formula-engine.js's own getter —
  // a resolved binding can be a string/array/boolean (e.g. a Tags-role
  // value, an Object field) where coercing a missing path to 0 would be
  // wrong; formula-engine.js's coercion only makes sense because it's always
  // a math context.
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

// The write-side companion to resolveBinding()'s plain-path case (a formula
// binding like "=@a+@b" has no single cell to write back to, so only a
// simple "@a.b.c" binding is settable — anything else is a no-op). Mutates
// `context` in place, auto-vivifying intermediate objects the same way
// Workbench's own (now-retired) private setValueAtPath() did, so every
// consumer of a binding path — Press's read-only rendering, Workbench's
// editable sheet, Combat Tracker's write-through to a character record —
// shares one implementation instead of three copies of dotted-path walking.
export function setAtBinding(binding, context, value) {
  if (typeof binding !== "string" || !context || typeof context !== "object") {
    return false;
  }
  const trimmed = binding.trim();
  if (!trimmed.startsWith("@")) {
    return false;
  }
  const segments = trimmed.slice(1).split(".").filter(Boolean);
  if (!segments.length) {
    return false;
  }
  let cursor = context;
  for (let index = 0; index < segments.length - 1; index += 1) {
    const key = segments[index];
    if (!cursor[key] || typeof cursor[key] !== "object") {
      cursor[key] = {};
    }
    cursor = cursor[key];
  }
  cursor[segments[segments.length - 1]] = value;
  return true;
}

function normalizeLookupKey(value) {
  return value === undefined || value === null ? "" : String(value).trim().toLowerCase();
}

// An entry matches a lookup key by whichever of these it actually has —
// a raw sourceId/id (System field metadata's own numbering), the last
// segment of a dotted `key` ("abilities.strength" -> "strength"), or a
// name/shortName/label a template author would more naturally type
// ("strength", "STR", "Strength"). A bare scalar array entry (no object)
// matches directly on its own value, so a plain string/number list works
// as a lookup table too, not just System-shaped {sourceId, name, ...}
// objects.
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

// The generic `lookup(table, key)` formula function — one implementation
// shared by every tool, not a family of one-off ability/skill/whatever
// functions. `table` is a name, resolved two ways depending on what this
// caller has available:
//  1. `fieldDefinitions` (a System's own `fields` array, when the caller
//     has one — Workbench does via state.systemDefinition, Press
//     deliberately never will; see this function's own call sites) — a
//     field whose `key` matches `table` has its `children` or `values`
//     reshaped into a searchable list, the same reshaping already used for
//     DDB-import's own lookup tables (system-lookup-tables.js).
//  2. Failing that, `table` is resolved as a plain dotted path against
//     `context` — the exact same data any other @binding already reads,
//     whatever shape that happens to be for the calling tool. This is
//     what makes `lookup` work identically in Press (no System, only
//     whatever's in the sample data) and Workbench without either one
//     needing its own bespoke lookup logic — the underlying data source
//     differs, the function doesn't.
// Returns the whole matched entry (or undefined, never an invented
// placeholder) so a formula can read any of its properties —
// `lookup("abilities","str").color`, `lookup("skills","athletics").ability`,
// etc. — not just a single hardcoded field.
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

const ROLE_BOUND_ROLES = new Set(["resource", "value", "tags", "modifier"]);

// A System's live play-state (health, AC, conditions, initiative, or
// whatever else a game tracks) lives on an ordinary array field — not a
// dedicated field type or a special marker checkbox — identified purely by
// its values carrying a `role`. Role is a generic structural vocabulary a
// value can use for any purpose (see Loom's "Role" help topic), not
// something reserved for combat; this just finds whichever field happens to
// use it. Combat Tracker and Workbench's character view both resolve the
// same field this way, so a System only has to author Role/Binding once for
// both to pick it up — see their own comments for how each one consumes it.
export function findRoleBoundField(fields) {
  const list = Array.isArray(fields) ? fields : [];
  return (
    list.find(
      (entry) =>
        entry?.type === "array" &&
        Array.isArray(entry.values) &&
        entry.values.some((value) => value && ROLE_BOUND_ROLES.has(value.role))
    ) || null
  );
}

// Finds the one entry of a given role (resource/value/tags/modifier) within
// a role-bound field's own `.values` (the array findRoleBoundField above
// locates) — combat-tracker.js and character-sheet.js both resolve HP/AC/
// Conditions/Initiative this same way, so it lives here rather than as two
// identical local copies.
export function findBindingByRole(bindings, role) {
  return (bindings || []).find((entry) => entry && entry.role === role) || null;
}
