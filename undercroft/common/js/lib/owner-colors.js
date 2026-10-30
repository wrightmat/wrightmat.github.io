// The Player color of whoever owns a linked record, for tokens that follow it ("player" as a marker's outline color).
// Resolved by the server per record the viewer may read; a record with no owner color simply has none here.
export const OWNER_COLOR_OUTLINE = "player";

let colors = new Map();
const asked = new Set();
let pending = null;

export function peekOwnerColor(kind, id) {
  return colors.get(`${kind}:${id}`) || "";
}

// A color change anywhere invalidates every cached owner color.
export function resetOwnerColors() {
  colors = new Map();
  asked.clear();
}

// `onResolved()` fires once, after a fetch for records not seen before; never synchronously, so it is safe to call
// from inside a render pass.
export function primeOwnerColors(dataManager, refs, onResolved) {
  if (pending || !dataManager?.isAuthenticated?.()) return;
  const wanted = [];
  const seen = new Set();
  (refs || []).forEach((ref) => {
    const key = `${ref.kind}:${ref.id}`;
    if (ref.kind && ref.id && !asked.has(key) && !seen.has(key)) {
      seen.add(key);
      wanted.push({ kind: ref.kind, id: ref.id });
    }
  });
  if (!wanted.length) return;
  pending = dataManager
    .getOwnerColors(wanted)
    .then((result) => {
      wanted.forEach((ref) => asked.add(`${ref.kind}:${ref.id}`));
      Object.entries(result?.colors || {}).forEach(([key, color]) => colors.set(key, color));
      pending = null;
      onResolved?.();
    })
    .catch(() => {
      pending = null;
    });
}

export function markerOwnerColorRefs(map) {
  const refs = [];
  (map?.layers || []).forEach((layer) => {
    if (layer.type !== "marker") return;
    (layer.elements || []).forEach((marker) => {
      if (marker.kind === "marker" && marker.outlineColor === OWNER_COLOR_OUTLINE && marker.refKind && marker.refId) {
        refs.push({ kind: marker.refKind, id: marker.refId });
      }
    });
  });
  return refs;
}
