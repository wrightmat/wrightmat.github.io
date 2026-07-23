// Optional monster-note synthesis (mirrors Forge's llm-note.js) — a GM can
// generate and save a monster with no LLM involvement whatsoever. Sends the
// resolved Creature Type/Archetype/Role names and the full feature list to
// the server-side proxy at POST /crucible/generate-note, which talks to
// Anthropic directly. `details.name` may be blank (Crucible's Name field has
// no default) — the server asks Claude to invent one in that case, returned
// alongside the note so the caller can fill the Name field in too.
export async function generateMonsterNote(details) {
  const response = await fetch("/crucible/generate-note", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      monster: {
        name: details.name,
        creatureType: details.creatureType,
        archetype: details.archetype,
        role: details.role,
        signatureFeature: details.signatureFeature,
        features: details.features,
      },
    }),
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(payload?.error || `HTTP ${response.status}`);
  }
  return { name: payload.name || "", note: payload.note || "" };
}
