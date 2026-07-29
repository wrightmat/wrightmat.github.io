// Pure functions over an already-fetched list of journal entries
// ({id, payload: {title, body, ...}}) — no fetching of their own, so callers
// (app.js, and eventually handout.js for a "related pages" feature) can
// reuse them against whatever page list they already have in memory.
import { wikiLinkPattern } from "./wiki-link-syntax.js";

// Obsidian-style: case-insensitive, first match wins on a title collision
// (rare in a single GM's own campaign notes — not worth a disambiguation UI
// for it). Titles are trimmed before comparing since a page's own title
// field could have stray whitespace.
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

// A [[Page#Heading]] link still counts as a link to "Page" for backlink
// purposes — the heading fragment (if any) is just discarded here.
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

// Every other page whose body contains a [[forTitle]] link — scans raw
// markdown text directly (not the rendered/rewritten HTML renderMarkdown
// produces), so this has no dependency on marked/DOMPurify at all.
export function findBacklinks(entries, forTitle) {
  const target = String(forTitle || "").trim().toLowerCase();
  if (!target) return [];
  return (entries || []).filter((entry) => {
    const titles = extractWikiLinkTitles(entry?.payload?.body);
    return titles.some((title) => title.toLowerCase() === target);
  });
}
