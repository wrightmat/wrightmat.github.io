// Generic `` `kindId:Name` `` inline code blocks — the same "post-process a
// rendered <code> element" treatment journal-dice.js/journal-encounter.js/
// journal-macro.js use for their own three special-cased prefixes, extended
// to every other real Library kind. `dice`/`encounter`/`macro` keep their
// own richer chips — this only handles what's left after those three passes
// have already consumed their own spans. `journal`/`kind` are excluded:
// page-to-page references already use `[[Wiki Link]]`, and `kind` is the
// meta-kind describing kinds themselves.
//
// The chip-building/hover-preview mechanism lives in the shared
// library-reference.js (board.js and markdown.js also consume it) — this
// module keeps only what's markdown-specific: recognizing the code-span
// syntax and scanning a page's raw body for every reference it makes.
import { fetchKindEntriesWithIds, fetchKindEntrySummaries } from "../../../common/js/lib/content-fetch.js";
import { EXCLUDED_KINDS, createReferenceChip } from "../../../common/js/lib/library-reference.js";
import { parseEncounterBlock, findMatch } from "./journal-encounter.js";
import { findMacro } from "./journal-macro.js";

const KIND_REF_CODE_PATTERN = /^([a-z][a-z0-9-]*)\s*:\s*(.+)$/i;

// Runs after applyDiceRollers/applyEncounterBlocks/applyMacroBlocks, which
// already removed their own dice/encounter/macro spans, so this only sees
// whatever's left. `kindLabels` is a {id: label} map, falling back to the
// raw kindId when unloaded. Resolution stays lazy — renderMarkdown stays
// synchronous; the chip renders from the literal typed text and only looks
// up the real record once hovered/clicked.
export function applyKindReferenceBlocks(container, { validKindIds, kindLabels = {}, interactive = false, onOpenReference, dataManager } = {}) {
  if (!validKindIds || !validKindIds.size) return;
  container.querySelectorAll("code").forEach((codeEl) => {
    const match = KIND_REF_CODE_PATTERN.exec(codeEl.textContent.trim());
    if (!match) return;
    const kindId = match[1].toLowerCase();
    if (EXCLUDED_KINDS.has(kindId) || !validKindIds.has(kindId)) return;
    const name = match[2].trim();
    if (!name) return;
    codeEl.replaceWith(
      createReferenceChip({
        kind: kindId,
        name,
        kindLabel: kindLabels[kindId],
        interactive,
        onOpen: onOpenReference,
        dataManager,
      })
    );
  });
}

const CODE_SPAN_PATTERN = /`([^`\n]+)`/g;
const DICE_CODE_PATTERN = /^dice:\s*(.+)$/i;
const ENCOUNTER_CODE_PATTERN = /^encounter:\s*(.+)$/i;
const MACRO_CODE_PATTERN = /^macro:\s*(.+)$/i;

// Scans raw markdown text (no marked/DOMPurify dependency) for every
// code-span reference a page's body makes, resolves each against the real
// Library record it names, and returns the deduped result — what app.js's
// Related panel renders directly, instead of a manually maintained list. An
// `encounter:` block resolves to one ref per matched creature; dice blocks
// are skipped (a roll references nothing). Unmatched text is silently
// dropped — Related only ever shows real, resolved links.
export async function extractContentReferences(body, dataManager, validKindIds) {
  const text = String(body || "");
  const spans = [];
  let spanMatch;
  while ((spanMatch = CODE_SPAN_PATTERN.exec(text))) {
    spans.push(spanMatch[1].trim());
  }
  if (!spans.length || !dataManager) return [];

  // Fetched at most once per kind referenced on this page. Two caches, not
  // one: encounter-matching (below) needs each candidate's full payload to
  // actually start combat from, but generic `kindId:Name` matching only
  // needs id+name, which fetchKindEntrySummaries covers with no per-record fetch.
  const kindEntriesCache = new Map();
  const loadKind = (kindId) => {
    if (!kindEntriesCache.has(kindId)) {
      kindEntriesCache.set(kindId, fetchKindEntriesWithIds(dataManager, kindId).catch(() => []));
    }
    return kindEntriesCache.get(kindId);
  };
  const kindSummaryCache = new Map();
  const loadKindSummaries = (kindId) => {
    if (!kindSummaryCache.has(kindId)) {
      kindSummaryCache.set(kindId, fetchKindEntrySummaries(dataManager, kindId).catch(() => []));
    }
    return kindSummaryCache.get(kindId);
  };

  const refs = [];
  const seen = new Set();
  const addRef = (kind, id, name) => {
    const key = `${kind}:${id}`;
    if (seen.has(key)) return;
    seen.add(key);
    refs.push({ kind, id, name });
  };

  for (const span of spans) {
    if (DICE_CODE_PATTERN.test(span)) continue;

    const encounterMatch = ENCOUNTER_CODE_PATTERN.exec(span);
    if (encounterMatch) {
      const creatures = parseEncounterBlock(encounterMatch[1]);
      if (!creatures.length) continue;
      const [monsters, npcs] = await Promise.all([loadKind("monster"), loadKind("npc")]);
      creatures.forEach((creature) => {
        const found = findMatch(creature.name, monsters, npcs);
        if (found) addRef(found.kind, found.id, creature.name);
      });
      continue;
    }

    const macroMatch = MACRO_CODE_PATTERN.exec(span);
    if (macroMatch) {
      const ref = macroMatch[1].trim();
      if (!ref) continue;
      const macro = await findMacro(dataManager, ref);
      if (macro) addRef("macro", macro.id, macro.name || ref);
      continue;
    }

    const genericMatch = KIND_REF_CODE_PATTERN.exec(span);
    if (!genericMatch) continue;
    const kindId = genericMatch[1].toLowerCase();
    if (EXCLUDED_KINDS.has(kindId) || !validKindIds?.has(kindId)) continue;
    const name = genericMatch[2].trim();
    if (!name) continue;
    const entries = await loadKindSummaries(kindId);
    const normalized = name.toLowerCase();
    const found = entries.find((entry) => String(entry.id).toLowerCase() === normalized || entry.name.trim().toLowerCase() === normalized);
    if (found) addRef(kindId, found.id, found.name || name);
  }
  return refs;
}
