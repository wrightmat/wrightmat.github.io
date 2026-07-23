// Optional location-note synthesis (mirrors Crucible's/Vault's llm-note.js) — a GM
// can generate and save a Location with no LLM involvement whatsoever. Sends the
// resolved Type/Purpose/Environment and full feature/asset/need lists to the
// server-side proxy at POST /sanctum/generate-note, which talks to Anthropic
// directly. `details.name` may be blank — the server asks Claude to invent one in
// that case, returned alongside the note so the caller can fill the Name field in.
export async function generateLocationNote(details) {
  const response = await fetch("/sanctum/generate-note", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      location: {
        name: details.name,
        typeLabel: details.typeLabel,
        purposeLabel: details.purposeLabel,
        environmentLabel: details.environmentLabel,
        features: details.features,
        assets: details.assets,
        needs: details.needs,
      },
    }),
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(payload?.error || `HTTP ${response.status}`);
  }
  return { name: payload.name || "", note: payload.note || "" };
}
