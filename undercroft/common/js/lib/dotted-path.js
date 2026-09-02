// The plain "walk a dotted path against an object" mechanics shared by
// formula-engine.js, bindings.js, and mapping-custom-functions.js — each of
// those independently implemented the exact same walk before this was pulled
// out. Deliberately does NOT include any `@`-prefix stripping or value
// coercion: those differ per caller (formula-engine.js coerces a missing
// path to 0 since it's always a math context; bindings.js returns raw
// `undefined` since a binding can resolve to a string/array/boolean where
// coercing to 0 would be wrong) and must stay that way — see each call
// site's own comment before "fixing" this apparent inconsistency.
export function resolveDottedPath(context, path) {
  // "classes[0].name" -> "classes.0.name" before splitting, so a fixed
  // array index reads exactly like any other segment below (JS already
  // treats `array["0"]` the same as `array[0]`) — without this, "classes[0]"
  // is one literal, never-matching key and every array-index binding
  // (Character.identity.classes[0].name, the ONLY shape Daggerheart's own
  // non-repeated Class/Subclass fields use) silently resolves to undefined.
  const segments = String(path || "").replace(/\[(\d+)\]/g, ".$1").split(".");
  return segments.reduce((acc, key) => {
    if (acc && typeof acc === "object" && key in acc) {
      return acc[key];
    }
    return undefined;
  }, context);
}
