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
