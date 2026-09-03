// Optional — a monster can be generated and saved with no LLM involvement.
// `details.name` may be blank; the server invents one and returns it too.
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
