import { sessionAuthHeaders } from "../../../common/js/lib/data-manager.js";
import { NOTE_USED_EVENT } from "../../../common/js/lib/note-button.js";
import { apiUrl } from "../../../common/js/lib/api.js";

// Optional — a monster can be generated and saved with no LLM involvement.
// `details.name` may be blank; the server invents one and returns it too.
export async function generateMonsterNote(details) {
  const response = await fetch(apiUrl("/crucible/generate-note"), {
    method: "POST",
    headers: { "Content-Type": "application/json", ...sessionAuthHeaders() },
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
  window.dispatchEvent(new Event(NOTE_USED_EVENT));
  if (!response.ok) {
    throw new Error(payload?.error || `HTTP ${response.status}`);
  }
  return { name: payload.name || "", note: payload.note || "" };
}
