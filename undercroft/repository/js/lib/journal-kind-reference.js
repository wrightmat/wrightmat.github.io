// Generic `` `kindId:Name` `` inline code blocks — the same "post-process a
// rendered <code> element" treatment journal-dice.js/journal-encounter.js/
// journal-macro.js already use for their own three special-cased prefixes,
// extended to every OTHER real Library kind (npc, location, monster,
// character, system, map, template, ...) instead of leaving those with no
// reference syntax of their own. `dice`/`encounter`/`macro` keep their
// existing, richer chips (a die roller, a multi-creature combat starter, a
// runnable action) — this module only ever handles what's left over after
// markdown.js's own applyDiceRollers/applyEncounterBlocks/applyMacroBlocks
// have already consumed their own code spans, so there's no risk of double
// handling the same block. `journal`/`kind` are excluded too: a page-to-page
// reference already has its own, richer syntax ([[Wiki Link]]), and `kind`
// is the meta-kind describing kinds themselves, not something an author
// would reference directly.
//
// The actual chip-building/hover-preview mechanism lives in the shared,
// tool-agnostic common/js/lib/library-reference.js (two other consumers,
// board.js and markdown.js on handout.js's behalf, were already reaching
// across into this file to get it) — this module keeps only what's
// genuinely markdown-specific: recognizing the `` `kindId:Name` `` code-span
// syntax itself and scanning a page's raw body for every reference it makes.
import { fetchKindEntriesWithIds, fetchKindEntrySummaries } from "../../../common/js/lib/content-fetch.js";
import { EXCLUDED_KINDS, createReferenceChip } from "../../../common/js/lib/library-reference.js";
import { parseEncounterBlock, findMatch } from "./journal-encounter.js";
import { findMacro } from "./journal-macro.js";

const KIND_REF_CODE_PATTERN = /^([a-z][a-z0-9-]*)\s*:\s*(.+)$/i;

// Runs after applyDiceRollers/applyEncounterBlocks/applyMacroBlocks —
// CommonMark's own backtick syntax already turned every `` `kindId:Name` ``
// span into a plain <code>...</code>; those three passes already replaced
// (removed) their own dice/encounter/macro spans, so this only ever sees
// whatever's left. `kindLabels` is a {id: label} map (loadLibraryKinds'
// own display labels) — falls back to the raw kindId when a caller hasn't
// loaded it yet. Resolution stays lazy (renderMarkdown itself stays fully
// synchronous, same reasoning journal-macro.js's own buildMacroChip already
// documents) — the chip renders from the literal typed text alone, and only
// looks up the real record once hovered/clicked (createReferenceChip's own
// attachReferencePreview, or onOpenReference).
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

// Scans raw markdown text (not rendered HTML — same "no dependency on
// marked/DOMPurify" reasoning journal-links.js's own findBacklinks
// documents) for every code-span reference this page's body actually
// makes, resolves each against the real Library record it names, and
// returns the deduped result — what Repository's own Related panel renders
// directly (app.js's renderRelated), instead of a manually maintained
// `refs` list. An `encounter:` block resolves to one ref per matched
// creature (exactly what journal-encounter.js's own findMatch would use to
// build a real encounter from it); dice blocks are skipped entirely (a die
// roll references nothing). Unmatched/unresolvable text is silently
// dropped, same "an unmatched reference just doesn't do anything" spirit
// every chip already follows — Related only ever shows real, resolved
// links, never a guess.
export async function extractContentReferences(body, dataManager, validKindIds) {
  const text = String(body || "");
  const spans = [];
  let spanMatch;
  while ((spanMatch = CODE_SPAN_PATTERN.exec(text))) {
    spans.push(spanMatch[1].trim());
  }
  if (!spans.length || !dataManager) return [];

  // Fetched at most once per kind actually referenced on this page, shared
  // across every span that needs it — not once per span. Two separate
  // caches, not one: findMatch's own encounter-matching (below) genuinely
  // needs each candidate's FULL payload (real stats, to actually start a
  // combat from), but the generic `kindId:Name` matching further down only
  // ever needs id+name to build a Related-panel ref — fetchKindEntrySummaries
  // (no per-record fetch at all) covers that one for free.
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
