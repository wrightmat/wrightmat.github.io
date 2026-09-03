// Optional — an NPC can be generated and saved with no LLM involvement.
export async function generateCharacterNote(record) {
  const response = await fetch("/forge/generate-note", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      identity: {
        name: record.name,
        alignment: record.identity.alignment,
        gender: record.identity.gender,
        species: record.identity.species,
        archetype: record.identity.archetype,
        age: record.identity.age,
        relationship: record.identity.relationship,
        attitude: record.identity.attitude,
      },
      fourD: record.fourD,
    }),
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(payload?.error || `HTTP ${response.status}`);
  }
  return payload.note;
}
