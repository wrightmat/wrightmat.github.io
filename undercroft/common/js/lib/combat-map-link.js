// The ONE place both directions of "which marker represents this
// combatant" / "which combatant does this marker represent" are resolved —
// Combat Tracker's own visibility toggle, the Map widget's marker popup,
// and Orrery's own selection-toolbar toggle all need the exact same
// matching (including the linkedCombatantId disambiguation rule below), so
// this lives here once rather than drifting across three call sites.
//
// Combat Tracker visibility and Map marker visibility are otherwise fully
// independent facts (see combat-tracker.js's own `hidden` field vs.
// map-model.js's View.hiddenElementIds) — these helpers exist only to
// support the optional "also toggle the other?" cross-link prompt, never to
// derive one from the other.

// Every marker on `mapPayload` (the `{id, payload}` shape getCachedActiveMap
// callers already use) that represents `combatant` — refKind+refId matched,
// disambiguated by marker.linkedCombatantId when more than one pairing
// shares a refId (map-viewer.js's resolveMarkerLinkedCombatant, inverted).
// Returns [] — not an error — when there's no map data yet or genuinely no
// marker placed; callers treat an empty result as "nothing to offer."
export function resolveCombatantMarkers(combatant, map) {
  if (!map?.payload || !combatant?.refId) return [];
  const matches = [];
  (map.payload.layers || []).forEach((layer) => {
    if (layer.type !== "marker") return;
    (layer.elements || []).forEach((marker) => {
      if (marker.kind === "marker" && marker.refKind === combatant.refKind && marker.refId === combatant.refId) {
        matches.push({ layer, marker });
      }
    });
  });
  if (matches.length <= 1) return matches;
  const linked = matches.filter(({ marker }) => marker.linkedCombatantId === combatant.id);
  return linked; // genuinely ambiguous with none linked to THIS combatant — [] rather than guessing
}

// The inverse — which combatant(s) in `combatants` (an encounter's own
// combatants array) this marker represents. Same disambiguation rule
// mirrored: if more than one combatant shares the marker's refKind/refId,
// only a linkedCombatantId match counts, never a guess.
export function resolveMarkerCombatants(marker, combatants) {
  if (!marker?.refKind || !marker?.refId || !Array.isArray(combatants)) return [];
  const matches = combatants.filter((c) => c.refKind === marker.refKind && c.refId === marker.refId);
  if (matches.length <= 1) return matches;
  if (!marker.linkedCombatantId) return [];
  return matches.filter((c) => c.id === marker.linkedCombatantId);
}

// Fetch-fresh/mutate/save against the *latest persisted* encounter, not a
// stale in-memory copy — same reasoning as combat-tracker.js's own
// writeThroughToCharacter and map-live-sync.js's persistElementUpdate.
// Returns the fresh payload, or null if the combatant is no longer there
// (deleted from the encounter since the caller last looked).
export async function persistCombatantHidden({ dataManager, encounterId, combatantId, hidden }) {
  const result = await dataManager.get("encounter", encounterId, { preferLocal: false });
  const freshPayload = result.payload;
  const combatant = (freshPayload.combatants || []).find((c) => c.id === combatantId);
  if (!combatant) return null;
  combatant.hidden = hidden;
  await dataManager.save("encounter", encounterId, freshPayload);
  return freshPayload;
}
