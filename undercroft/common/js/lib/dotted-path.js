// Shared dotted-path walk used by formula-engine.js, bindings.js, and
// mapping-custom-functions.js. Deliberately excludes `@`-prefix stripping
// and missing-path coercion — those differ per caller (formula-engine.js
// wants 0 for math; bindings.js wants raw `undefined`) and must stay that way.
export function resolveDottedPath(context, path) {
  // "classes[0].name" -> "classes.0.name" so a fixed array index reads like
  // any other segment (JS treats `array["0"]` same as `array[0]`) — without
  // this, array-index bindings (e.g. Daggerheart's Class[0].name) silently
  // resolve to undefined.
  const segments = String(path || "").replace(/\[(\d+)\]/g, ".$1").split(".");
  return segments.reduce((acc, key) => {
    if (acc && typeof acc === "object" && key in acc) {
      return acc[key];
    }
    return undefined;
  }, context);
}

// Write-side companion to resolveDottedPath — no `@`/`=` sigil handling
// here either, same reasoning: a caller whose field is unambiguously
// always a path (never a literal, never a formula) has no disambiguation
// to do, so it calls this directly instead of going through bindings.js's
// setAtBinding (which exists for the genuinely ambiguous case — a
// Template/component binding that could be a literal, a path, or a
// formula typed into the same box). Auto-vivifies intermediate objects,
// same as setAtBinding, which now delegates here for its own plain-path case.
export function setAtDottedPath(context, path, value) {
  if (!context || typeof context !== "object") return false;
  const segments = String(path || "").replace(/\[(\d+)\]/g, ".$1").split(".").filter(Boolean);
  if (!segments.length) return false;
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
