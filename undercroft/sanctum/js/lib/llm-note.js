import { sessionAuthHeaders } from "../../../common/js/lib/data-manager.js";
import { NOTE_USED_EVENT } from "../../../common/js/lib/note-button.js";
import { apiUrl } from "../../../common/js/lib/api.js";

// Optional location-note synthesis (mirrors Crucible's/Vault's llm-note.js) —
// posts resolved Type/Purpose/Environment + feature/asset/need lists to
// POST /sanctum/generate-note (server-side Anthropic proxy). A blank
// `details.name` asks Claude to invent one, returned for the caller to fill in.
export async function generateLocationNote(details) {
  const response = await fetch(apiUrl("/sanctum/generate-note"), {
    method: "POST",
    headers: { "Content-Type": "application/json", ...sessionAuthHeaders() },
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
  window.dispatchEvent(new Event(NOTE_USED_EVENT));
  if (!response.ok) {
    throw new Error(payload?.error || `HTTP ${response.status}`);
  }
  return { name: payload.name || "", note: payload.note || "" };
}
