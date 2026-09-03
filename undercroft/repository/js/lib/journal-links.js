// Pure functions over an already-fetched entry list — no fetching of their
// own, so callers can reuse them against whatever page list they already
// have in memory.
import { wikiLinkPattern } from "./wiki-link-syntax.js";

// Obsidian-style: case-insensitive, first match wins on a title collision
// (rare enough in one GM's notes to not warrant a disambiguation UI).
export function buildTitleIndex(entries) {
  const index = new Map();
  (entries || []).forEach((entry) => {
    const title = String(entry?.payload?.title || "").trim();
    if (!title) return;
    const key = title.toLowerCase();
    if (!index.has(key)) {
      index.set(key, { id: entry.id, title });
    }
  });
  return {
    resolve(title) {
      return index.get(String(title || "").trim().toLowerCase()) || null;
    },
  };
}

// A [[Page#Heading]] link still counts as a link to "Page" — the heading
// fragment is discarded.
function extractWikiLinkTitles(body) {
  const titles = [];
  const text = String(body || "");
  let match;
  const pattern = wikiLinkPattern();
  while ((match = pattern.exec(text))) {
    const title = match[1].trim();
    if (title) titles.push(title);
  }
  return titles;
}

// Scans raw markdown, not rendered HTML — no dependency on marked/DOMPurify.
export function findBacklinks(entries, forTitle) {
  const target = String(forTitle || "").trim().toLowerCase();
  if (!target) return [];
  return (entries || []).filter((entry) => {
    const titles = extractWikiLinkTitles(entry?.payload?.body);
    return titles.some((title) => title.toLowerCase() === target);
  });
}
