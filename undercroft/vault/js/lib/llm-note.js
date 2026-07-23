// Optional effect-note synthesis (mirrors Crucible's llm-note.js) — a GM can
// generate and save an effect with no LLM involvement whatsoever. Sends the
// resolved property values and full feature list to the server-side proxy at
// POST /vault/generate-note, which talks to Anthropic directly. `details.name`
// may be blank (Vault's Name field has no default) — the server asks Claude
// to invent one in that case, returned alongside the note so the caller can
// fill the Name field in too.
export async function generateEffectNote(details) {
  const response = await fetch("/vault/generate-note", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      effect: {
        name: details.name,
        properties: details.properties,
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
