// "Mentioned in chat": the messages (live or archived) that @mention or link a
// record, for the Repository's backlinks panel and the reference-chip preview.
import { el } from "../dom.js";
import { openMessageSummary } from "./open-message.js";

const CACHE_MS = 20000;
const cache = new Map();

// Signed-out viewers and failures read as "none" — backlinks are decoration.
// Cached briefly so hovering a chip repeatedly doesn't re-query, but a new
// mention still shows up within a few seconds.
export async function fetchChatBacklinks(dataManager, kind, id) {
  if (!dataManager?.isAuthenticated?.() || !kind || !id) return [];
  const key = `${kind}:${id}`;
  const cached = cache.get(key);
  if (cached && Date.now() - cached.at < CACHE_MS) return cached.promise;
  const promise = dataManager
    .getBacklinks(kind, id)
    .then((result) => (Array.isArray(result?.items) ? result.items : []))
    .catch(() => []);
  cache.set(key, { at: Date.now(), promise });
  return promise;
}

export function describeBacklink(item) {
  return `${item.channelName} › ${item.threadTitle} — ${item.voiceName}: ${item.excerpt}`;
}

// `limit` caps the rendered rows; the rest collapse into "and N more".
export function renderChatBacklinkList(items, { dataManager, limit = Infinity, interactive = true } = {}) {
  const list = el("div", "d-flex flex-column gap-1");
  items.slice(0, limit).forEach((item) => {
    const row = el(interactive ? "button" : "div", `small text-start ${interactive ? "btn btn-link p-0" : ""}`.trim(), describeBacklink(item));
    if (interactive) {
      row.type = "button";
      row.addEventListener("click", () => openMessageSummary(dataManager, item));
    }
    list.appendChild(row);
  });
  if (items.length > limit) list.appendChild(el("div", "small text-body-secondary", `and ${items.length - limit} more`));
  return list;
}
