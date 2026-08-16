// Quests as Repository callouts — a `[!quest]` callout IS a quest: its
// title is the quest's name, its body is free markdown containing an
// ordinary GFM checklist for objectives. No custom syntax, no separate
// Library kind — a quest rarely deserves to be its own document, and this
// keeps it embedded in whatever page it naturally arises from (a settlement
// note, an adventure outline, ...). Rendering the callout itself stays
// markdown.js's own job (see journal-callouts.js's CALLOUT_TYPES); this
// module only extracts/derives structure a caller (the wikilink resolver,
// Relationships, Handout's fragment spotlight, ...) needs to reason about a
// quest without re-rendering the whole page.
//
// Blockquote discovery uses marked's own lexer (`window.marked.lexer`)
// rather than a hand-rolled regex scanner over raw text — this is the exact
// same tokenizer markdown.js's own callout renderer override parses against
// (see markdown.js's ensureCalloutRenderer), so a quest this module finds is
// guaranteed to be a quest that also actually renders as one, including
// every block-parsing edge case (lazy continuation lines, nested
// blockquotes, ...) a regex scanner would otherwise have to reinvent.
import { parseCallout } from "./journal-callouts.js";
import { extractTaskLines } from "./journal-tasks.js";

// Label + Bootstrap color name (resolved via journal-callouts.js's own
// resolveColor, the same color system a callout's icon/border already use)
// for each derived status — the rendered badge markdown.js's own
// applyCalloutStyling builds for a quest callout reads this directly.
export const QUEST_STATUS_META = {
  "not-started": { label: "Not Started", color: "secondary" },
  active: { label: "Active", color: "blue" },
  complete: { label: "Complete", color: "green" },
};

// Not started (no objectives exist yet, or none are checked), active (some
// but not all checked), complete (at least one objective, all checked) — no
// separate status field to remember to update; this IS the status, derived
// fresh every time from the checklist itself.
export function computeQuestStatus(objectives) {
  if (!objectives.length) return "not-started";
  const checkedCount = objectives.filter((objective) => objective.checked).length;
  if (checkedCount === 0) return "not-started";
  if (checkedCount === objectives.length) return "complete";
  return "active";
}

// Every `[!quest]` callout on a page, in document order. `objectives` reuses
// extractTaskLines (journal-tasks.js) against the callout's OWN bodyRaw, not
// the whole page — line numbers here are relative to bodyRaw, matching what
// a caller mutating just this one callout's own text (a future "toggle this
// objective" action, or journal-story-board.js's own read-modify-write
// primitive for a sibling callout type) needs.
export function extractQuests(body) {
  const marked = window.marked;
  if (!marked || typeof marked.lexer !== "function") return [];
  let tokens;
  try {
    tokens = marked.lexer(String(body || ""));
  } catch (error) {
    return [];
  }
  const quests = [];
  tokens.forEach((token) => {
    if (token.type !== "blockquote") return;
    const parsed = parseCallout(token.text);
    if (!parsed || parsed.type !== "quest") return;
    const objectives = extractTaskLines(parsed.bodyRaw).map((task) => ({
      text: task.text,
      checked: task.checked,
      line: task.line,
    }));
    quests.push({
      title: parsed.title,
      objectives,
      status: computeQuestStatus(objectives),
      bodyRaw: parsed.bodyRaw,
      fold: parsed.fold,
    });
  });
  return quests;
}

// Same shape/reasoning as journal-links.js's own buildTitleIndex — pure
// function over an already-fetched entries list ({id, payload:{body,...}}),
// case-insensitive, first match wins across the whole workspace on a title
// collision (documented limitation: two identically-titled quests on
// different pages, only the first-scanned wins a bare [[Quest Title]] link;
// [[Page#Quest Title]] is always unambiguous regardless of collisions).
export function buildQuestIndex(entries) {
  const index = new Map();
  (entries || []).forEach((entry) => {
    const body = entry?.payload?.body || "";
    extractQuests(body).forEach((quest) => {
      const key = quest.title.toLowerCase();
      if (!index.has(key)) index.set(key, { pageId: entry.id, title: quest.title });
    });
  });
  return {
    resolve(title) {
      return index.get(String(title || "").trim().toLowerCase()) || null;
    },
  };
}
