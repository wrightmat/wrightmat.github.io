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
