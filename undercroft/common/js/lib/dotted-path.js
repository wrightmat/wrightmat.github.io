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
  const segments = String(path || "").split(".");
  return segments.reduce((acc, key) => {
    if (acc && typeof acc === "object" && key in acc) {
      return acc[key];
    }
    return undefined;
  }, context);
}
