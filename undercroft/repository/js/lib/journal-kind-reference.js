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
// Unlike wiki-links (resolved eagerly, via a caller-supplied title index, so
// a missing page can render as a red "redlink"), a kind reference is
// resolved LAZILY — the rendered chip is built from the literal typed text
// alone, with no fetch at render time (renderMarkdown itself stays fully
// synchronous, same reasoning journal-macro.js's own buildMacroChip already
// documents) — actually looking the name up against that kind's real saved
// entries only happens once the chip is clicked (findKindReferenceRecord)
// or when extractContentReferences below scans a page's raw body to build
// its Related panel.
import { fetchKindEntriesWithIds } from "../../../common/js/lib/content-fetch.js";
import { el } from "../../../common/js/lib/dom.js";
import { parseEncounterBlock, findMatch } from "./journal-encounter.js";
import { findMacro } from "./journal-macro.js";

// Kinds this module (and its caller's autocomplete/extraction) never treats
// as a generic `kindId:Name` reference — either because they already have
// their own dedicated syntax/handling (encounter, macro), or because
// referencing them this way wouldn't make sense (journal pages use
// [[Wiki Links]] instead; `kind` describes kinds, it isn't itself
// referenceable content).
export const EXCLUDED_KINDS = new Set(["journal", "kind", "encounter", "macro"]);

const KIND_REF_CODE_PATTERN = /^([a-z][a-z0-9-]*)\s*:\s*(.+)$/i;

const KIND_ICON = {
  npc: "tabler:user",
  character: "tabler:user-circle",
  monster: "tabler:paw",
  "monster-archetype": "tabler:paw",
  "monster-role": "tabler:paw",
  location: "tabler:map-pin",
  "location-type": "tabler:map-pin",
  "location-purpose": "tabler:map-pin",
  setting: "tabler:world",
  system: "tabler:settings",
  map: "tabler:map",
  template: "tabler:layout",
  effect: "tabler:sparkles",
  resource: "tabler:package",
  class: "tabler:sword",
  subclass: "tabler:sword",
  background: "tabler:book",
  species: "tabler:paw",
  variant: "tabler:adjustments",
  feature: "tabler:star",
};

// Exported for code-block-autocomplete.js's own dropdown, which needs the
// exact same kind->icon mapping — one lookup table, not two that could
// quietly drift apart.
export function iconFor(kindId) {
  return KIND_ICON[kindId] || "tabler:link";
}

// Same "inline styles, not CSS classes" reasoning as journal-dice.js's own
// chip and journal-macro.js's buildMacroChip — this can render inside
// handout.js's Dashboard widget, a page that never loads Repository's own
// stylesheet.
function styleAsChip(button, interactive) {
  button.style.display = "inline-flex";
  button.style.alignItems = "center";
  button.style.gap = "0.25rem";
  button.style.padding = "0.05rem 0.4rem";
  button.style.border = "1px solid var(--bs-border-color, #dee2e6)";
  button.style.borderRadius = "0.375rem";
  button.style.background = "var(--bs-tertiary-bg, #f8f9fa)";
  button.style.color = "inherit";
  button.style.font = "inherit";
  button.style.lineHeight = "1.4";
  button.style.cursor = interactive ? "pointer" : "default";
}

function buildKindReferenceChip(kindId, name, { kindLabel, interactive, onOpenReference } = {}) {
  const button = el("button", "repository-kind-reference-chip");
  button.type = "button";
  styleAsChip(button, interactive);
  const icon = el("span", "iconify");
  icon.dataset.icon = iconFor(kindId);
  icon.setAttribute("aria-hidden", "true");
  button.append(icon, el("span", null, `${kindLabel || kindId}: ${name}`));
  if (interactive) {
    button.title = `View ${name}`;
    button.addEventListener("click", () => onOpenReference?.(kindId, name));
  }
  return button;
}

// Runs after applyDiceRollers/applyEncounterBlocks/applyMacroBlocks —
// CommonMark's own backtick syntax already turned every `` `kindId:Name` ``
// span into a plain <code>...</code>; those three passes already replaced
// (removed) their own dice/encounter/macro spans, so this only ever sees
// whatever's left. `kindLabels` is a {id: label} map (loadLibraryKinds'
// own display labels) — falls back to the raw kindId when a caller hasn't
// loaded it yet, same "never block rendering on a fetch" reasoning as the
// lazy-resolution comment up top.
export function applyKindReferenceBlocks(container, { validKindIds, kindLabels = {}, interactive = false, onOpenReference } = {}) {
  if (!validKindIds || !validKindIds.size) return;
  container.querySelectorAll("code").forEach((codeEl) => {
    const match = KIND_REF_CODE_PATTERN.exec(codeEl.textContent.trim());
    if (!match) return;
    const kindId = match[1].toLowerCase();
    if (EXCLUDED_KINDS.has(kindId) || !validKindIds.has(kindId)) return;
    const name = match[2].trim();
    if (!name) return;
    codeEl.replaceWith(buildKindReferenceChip(kindId, name, { kindLabel: kindLabels[kindId], interactive, onOpenReference }));
  });
}

// Case-insensitive match against either the record's own id or its display
// name — same "no fuzzy matching" convention journal-encounter.js's own
// findMatch/journal-macro.js's own findMacro establish.
export async function findKindReferenceRecord(dataManager, kindId, name) {
  if (!dataManager) return null;
  const entries = await fetchKindEntriesWithIds(dataManager, kindId).catch(() => []);
  const normalized = String(name || "").trim().toLowerCase();
  const match = entries.find(({ id, entity }) => {
    if (String(id).toLowerCase() === normalized) return true;
    const entryName = String(entity?.name || entity?.title || "").trim().toLowerCase();
    return entryName === normalized;
  });
  return match
    ? { kind: kindId, id: match.id, name: match.entity?.name || match.entity?.title || match.id, payload: match.entity || {} }
    : null;
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
// every chip in this file already follows — Related only ever shows real,
// resolved links, never a guess.
export async function extractContentReferences(body, dataManager, validKindIds) {
  const text = String(body || "");
  const spans = [];
  let spanMatch;
  while ((spanMatch = CODE_SPAN_PATTERN.exec(text))) {
    spans.push(spanMatch[1].trim());
  }
  if (!spans.length || !dataManager) return [];

  // Fetched at most once per kind actually referenced on this page, shared
  // across every span that needs it — not once per span.
  const kindEntriesCache = new Map();
  const loadKind = (kindId) => {
    if (!kindEntriesCache.has(kindId)) {
      kindEntriesCache.set(kindId, fetchKindEntriesWithIds(dataManager, kindId).catch(() => []));
    }
    return kindEntriesCache.get(kindId);
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
    const entries = await loadKind(kindId);
    const normalized = name.toLowerCase();
    const found = entries.find(({ id, entity }) => {
      if (String(id).toLowerCase() === normalized) return true;
      const entryName = String(entity?.name || entity?.title || "").trim().toLowerCase();
      return entryName === normalized;
    });
    if (found) addRef(kindId, found.id, found.entity?.name || found.entity?.title || name);
  }
  return refs;
}
