// Repository's "Relationships" view — a read-only lens over content that's
// already been written, scanning every journal page for the wikilinks and
// code-block references already present and assembling a generic
// {nodes, edges} shape for common/js/lib/graph-view.js. It answers "what
// connects to what in a campaign that already exists"; it requires no
// separate data of its own, and deliberately does NOT ingest a
// [!story-board] callout's internal planning structure (see
// journal-story-board.js's own header comment for that two-mode split).
//
// Computed on demand (buildRelationshipsGraph), not kept live — the caller
// (repository/js/app.js) decides when to (re)compute it and caches the
// result for the session; this module itself has no state.
import { fetchKindEntriesWithIds } from "../../../common/js/lib/content-fetch.js";
import { wikiLinkPattern } from "./wiki-link-syntax.js";
import { extractContentReferences } from "./journal-kind-reference.js";
import { extractQuests } from "./journal-quests.js";

// Every [[Title]]/[[Title#Heading]] target on a page, title only (the
// heading fragment is discarded — a link to "Page#Heading" still counts as
// a link to "Page" here, same convention journal-links.js's findBacklinks
// uses).
function wikiLinkTitles(body) {
  const titles = [];
  const text = String(body || "");
  let match;
  const pattern = wikiLinkPattern();
  while ((match = pattern.exec(text))) {
    const title = (match[1] || "").trim();
    if (title) titles.push(title);
  }
  return titles;
}

// `validKindIds` — the same Set loadLibraryKinds() produces
// (repository/js/app.js's ensureLibraryKinds), passed through to
// extractContentReferences exactly as renderMarkdown's kind-reference chips
// require it.
export async function buildRelationshipsGraph(dataManager, { validKindIds } = {}) {
  const entries = await fetchKindEntriesWithIds(dataManager, "journal").catch(() => []);
  const pages = entries.map((entry) => ({ id: entry.id, payload: entry.entity || {} }));

  const nodes = new Map(); // nodeId -> {id, label, kind}
  const edges = [];
  const edgeSeen = new Set();

  // `extra` carries whatever a caller (repository/js/app.js's own
  // click-to-navigate) needs without re-parsing `id` — a quest title could
  // itself contain a colon, so the fields the click handler needs
  // (pageId, questTitle, refKind/refId) are attached directly instead.
  function addNode(id, label, kind, extra) {
    if (!nodes.has(id)) nodes.set(id, { id, label: label || id, kind, ...extra });
  }
  // Deduped per (unordered pair, type) — the same page linking the same
  // target twice still draws one edge, same "one edge however many times
  // it's written" convention Sanctum's "Connected to" dedup uses.
  function addEdge(a, b, type) {
    if (!a || !b || a === b) return;
    const key = `${[a, b].sort().join("|")}|${type}`;
    if (edgeSeen.has(key)) return;
    edgeSeen.add(key);
    edges.push({ a, b, type });
  }

  // Page nodes, and a title→nodeId index for resolving wikilinks — page
  // titles win first, same order repository/js/app.js's
  // resolveWikiLinkTarget resolves a bare [[Title]] link with.
  const titleIndex = new Map();
  pages.forEach((page) => {
    const pageNodeId = `journal:${page.id}`;
    addNode(pageNodeId, page.payload.title || page.id, "journal", { pageId: page.id });
    const title = String(page.payload.title || "").trim().toLowerCase();
    if (title && !titleIndex.has(title)) titleIndex.set(title, pageNodeId);
  });

  // Quest nodes, scoped to their own page (a quest is never its own Library
  // record — see journal-quests.js), plus a quest-title index for the
  // wikilink fallback pass below.
  const questIndex = new Map();
  pages.forEach((page) => {
    extractQuests(page.payload.body || "").forEach((quest) => {
      const questNodeId = `quest:${page.id}:${quest.title}`;
      addNode(questNodeId, quest.title, "quest", { pageId: page.id, questTitle: quest.title });
      addEdge(`journal:${page.id}`, questNodeId, "quest");
      const key = quest.title.trim().toLowerCase();
      if (key && !questIndex.has(key)) questIndex.set(key, questNodeId);
    });
  });

  // Wikilink edges — page→page, or page→quest when the title only matches a
  // quest, not any page (same fallback order as resolveWikiLinkTarget).
  pages.forEach((page) => {
    const fromId = `journal:${page.id}`;
    wikiLinkTitles(page.payload.body || "").forEach((title) => {
      const key = title.trim().toLowerCase();
      const targetPage = titleIndex.get(key);
      if (targetPage) {
        addEdge(fromId, targetPage, "wikilink");
        return;
      }
      const targetQuest = questIndex.get(key);
      if (targetQuest) addEdge(fromId, targetQuest, "wikilink");
    });
  });

  // Code-block references (npc:/location:/monster:/.../macro:) — one scan
  // per page's full raw body; deliberately doesn't distinguish "inside a
  // quest callout" from "elsewhere," attributing every reference to the
  // page node either way. Run in parallel across pages since each call
  // fetches its own referenced kinds' entries independently.
  const referenceLists = await Promise.all(
    pages.map((page) => extractContentReferences(page.payload.body || "", dataManager, validKindIds).catch(() => []))
  );
  pages.forEach((page, index) => {
    const fromId = `journal:${page.id}`;
    (referenceLists[index] || []).forEach((ref) => {
      const entityNodeId = `${ref.kind}:${ref.id}`;
      addNode(entityNodeId, ref.name, ref.kind, { refKind: ref.kind, refId: ref.id });
      addEdge(fromId, entityNodeId, "reference");
    });
  });

  return { nodes: Array.from(nodes.values()), edges };
}
