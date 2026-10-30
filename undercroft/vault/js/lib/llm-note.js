import { sessionAuthHeaders } from "../../../common/js/lib/data-manager.js";
import { NOTE_USED_EVENT } from "../../../common/js/lib/note-button.js";
import { apiUrl } from "../../../common/js/lib/api.js";

// Optional wonder-note synthesis (mirrors Crucible's llm-note.js) — posts
// resolved property values + feature list to POST /vault/generate-note
// (server-side Anthropic proxy). A blank `details.name` asks Claude to
// invent one, returned for the caller to fill in.
export async function generateWonderNote(details) {
  const response = await fetch(apiUrl("/vault/generate-note"), {
    method: "POST",
    headers: { "Content-Type": "application/json", ...sessionAuthHeaders() },
    body: JSON.stringify({
      wonder: {
        name: details.name,
        properties: details.properties,
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
