// Quests as Repository callouts — a `[!quest]` callout IS a quest: title is
// the quest name, body is free markdown with an ordinary GFM checklist for
// objectives. No custom syntax, no separate Library kind. Rendering stays
// markdown.js's job (see journal-callouts.js's CALLOUT_TYPES); this module
// only extracts/derives structure a caller (wikilink resolver, Relationships,
// Handout's fragment spotlight) needs without re-rendering the whole page.
//
// Blockquote discovery uses marked's own lexer (`window.marked.lexer`)
// rather than a hand-rolled regex scanner — this is the exact tokenizer
// markdown.js's callout renderer parses against (see ensureCalloutRenderer),
// so a quest found here is guaranteed to also render as one.
import { parseCallout } from "./journal-callouts.js";
import { extractTaskLines } from "./journal-tasks.js";

// Label + Bootstrap color name (via journal-callouts.js's resolveColor) for
// each derived status — read directly by markdown.js's applyCalloutStyling.
export const QUEST_STATUS_META = {
  "not-started": { label: "Not Started", color: "secondary" },
  active: { label: "Active", color: "blue" },
  complete: { label: "Complete", color: "green" },
};

// Not started (no objectives, or none checked), active (some but not all),
// complete (at least one, all checked) — no status field to keep in sync;
// this IS the status, derived fresh from the checklist every time.
export function computeQuestStatus(objectives) {
  if (!objectives.length) return "not-started";
  const checkedCount = objectives.filter((objective) => objective.checked).length;
  if (checkedCount === 0) return "not-started";
  if (checkedCount === objectives.length) return "complete";
  return "active";
}

// Every `[!quest]` callout on a page, in document order. `objectives` reuses
// extractTaskLines against the callout's OWN bodyRaw, not the whole page —
// line numbers are relative to bodyRaw, matching what a caller mutating just
// this callout (journal-story-board.js's own read-modify-write primitive)
// needs.
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

// Same shape as journal-links.js's buildTitleIndex — case-insensitive, first
// match wins across the workspace on a title collision (a bare [[Quest
// Title]] link is ambiguous then; [[Page#Quest Title]] never is).
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
