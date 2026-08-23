// A `` `macro:`/`encounter:`/`dice:` `` — and now every other Library
// kind's own `` `kindId:` `` — autocomplete dropdown for the plain
// <textarea> body editor — same style/mechanics as wiki-link-autocomplete.js
// (mirror-<div> caret measurement, a positioned list-group dropdown,
// arrow/Enter/Tab/Escape keyboard nav, mousedown-to-select), just detecting
// a different in-progress syntax: an unclosed single-backtick code span
// starting with one of the recognized prefixes, instead of an unclosed
// `[[`. Reuses measureCaretPosition from that module rather than a second
// copy of the same non-trivial measurement technique.
import { measureCaretPosition } from "./wiki-link-autocomplete.js";
import { fetchKindEntrySummaries, loadLibraryKinds } from "../../../common/js/lib/content-fetch.js";
import { QUICK_DICE } from "../../../common/js/lib/widgets/dice-roll.js";
import { EXCLUDED_KINDS, iconFor } from "../../../common/js/lib/library-reference.js";

// macro/encounter/dice/date are always recognized, even before the full
// kind list below has loaded — the special-cased prefixes this dropdown
// (and markdown.js's own rendering) already understand outside the generic
// kind-reference system. `date` is never a Library kind (journal-date.js's
// own header comment — there's no "date" entity to look up), so it can
// never come from loadLibraryKinds() the way every other kind's own prefix
// does; it has to be hardcoded here alongside macro/encounter/dice.
// Rebuilt once loadLibraryKinds() resolves (see attachCodeBlockAutocomplete
// below) to also recognize every real kind.
let PREFIX_PATTERN = /^(macro|encounter|dice|date)\s*:\s*/i;

function buildPrefixPattern(kindIds) {
  const extra = (kindIds || []).filter(
    (id) => !EXCLUDED_KINDS.has(id) && id !== "macro" && id !== "encounter" && id !== "dice" && id !== "date"
  );
  const alternation = ["macro", "encounter", "dice", "date", ...extra].join("|");
  return new RegExp(`^(${alternation})\\s*:\\s*`, "i");
}

// Detects an in-progress `` `type:...` `` span ending exactly at the
// cursor — nothing closing it (a "`") and no newline crossed (this suite's
// code spans, per markdown.js's own CODE_SPAN_SPLIT_PATTERN, are always
// single-line). `encounter:` gets its own sub-parse: its content is a
// comma-separated `qty: Name` list (journal-encounter.js's own
// parseEncounterBlock), so completion has to target just the segment
// currently being typed — the last comma-separated piece, and within that,
// just the name part if a "qty:" has already been typed — not the whole
// block's text.
function parseInProgressCodeBlock(textBeforeCursor) {
  const backtickIndex = textBeforeCursor.lastIndexOf("`");
  if (backtickIndex === -1) return null;
  const afterBacktick = textBeforeCursor.slice(backtickIndex + 1);
  if (afterBacktick.includes("`") || afterBacktick.includes("\n")) return null;
  const prefixMatch = PREFIX_PATTERN.exec(afterBacktick);
  if (!prefixMatch) return null;
  const type = prefixMatch[1].toLowerCase();
  const afterColon = afterBacktick.slice(prefixMatch[0].length);
  const colonEnd = backtickIndex + 1 + prefixMatch[0].length;

  if (type === "encounter") {
    const lastCommaIndex = afterColon.lastIndexOf(",");
    const segment = lastCommaIndex === -1 ? afterColon : afterColon.slice(lastCommaIndex + 1);
    const segmentStart = colonEnd + (lastCommaIndex === -1 ? 0 : lastCommaIndex + 1);
    const qtyMatch = /^(\s*\d+\s*:\s*)(.*)$/.exec(segment);
    const leadingWhitespace = qtyMatch ? "" : /^\s*/.exec(segment)[0];
    const namePart = qtyMatch ? qtyMatch[2] : segment.slice(leadingWhitespace.length);
    const nameStart = segmentStart + (qtyMatch ? qtyMatch[1].length : leadingWhitespace.length);
    return { type, query: namePart, replaceFrom: nameStart, needsQtyPrefix: !qtyMatch };
  }

  return { type, query: afterColon, replaceFrom: colonEnd, needsQtyPrefix: false };
}

async function macroCandidates(dataManager, query) {
  if (!dataManager) return [];
  // Only ever needs a name/id lookup for the dropdown label — never
  // executes or reads a macro's own actions here (runMacroReference does
  // that separately once one is picked) — so the metadata-only /list fetch
  // is enough, unlike journal-macro.js's own findMacro.
  const entries = await fetchKindEntrySummaries(dataManager, "macro").catch(() => []);
  const q = query.trim().toLowerCase();
  const seen = new Set();
  const results = [];
  entries.forEach(({ id, name: entryName }) => {
    const name = String(entryName || id || "").trim();
    if (!name || seen.has(name.toLowerCase())) return;
    if (q && !name.toLowerCase().includes(q)) return;
    seen.add(name.toLowerCase());
    results.push({ kind: "macro", label: name, insertText: name });
  });
  return results.slice(0, 20);
}

// Matches journal-encounter.js's own findMatch exactly — monsters AND npcs,
// both resolvable as an encounter block's own creature names — so what
// autocompletes here is exactly what would actually resolve when the block
// runs, not a narrower guess.
async function encounterCandidates(dataManager, query) {
  if (!dataManager) return [];
  const [monsters, npcs] = await Promise.all([
    fetchKindEntrySummaries(dataManager, "monster").catch(() => []),
    fetchKindEntrySummaries(dataManager, "npc").catch(() => []),
  ]);
  const q = query.trim().toLowerCase();
  const seen = new Set();
  const results = [];
  [
    ...monsters.map((entry) => ({ kind: "monster", entry })),
    ...npcs.map((entry) => ({ kind: "npc", entry })),
  ].forEach(({ kind, entry }) => {
    const name = String(entry.name || entry.id || "").trim();
    if (!name || seen.has(name.toLowerCase())) return;
    if (q && !name.toLowerCase().includes(q)) return;
    seen.add(name.toLowerCase());
    results.push({ kind, label: name, insertText: name });
  });
  return results.slice(0, 20);
}

function diceCandidates(query) {
  const q = query.trim().toLowerCase();
  return QUICK_DICE.filter((die) => !q || die.includes(q)).map((die) => ({
    kind: "dice",
    label: die,
    insertText: `1${die}`,
  }));
}

// The only real completion `date:` has — a fixed day index isn't something
// to complete from a list, but `current` (the ambient campaign date) is
// worth surfacing since it's easy to forget exists otherwise.
function dateCandidates(query) {
  const q = query.trim().toLowerCase();
  if (q && !"current".startsWith(q)) return [];
  return [{ kind: "date", label: "current", insertText: "current" }];
}

// Every kind that isn't macro/encounter/dice — same shape as macroCandidates
// above, just parameterized on which kind's own saved entries to offer.
async function genericCandidates(dataManager, kindId, query) {
  if (!dataManager) return [];
  const entries = await fetchKindEntrySummaries(dataManager, kindId).catch(() => []);
  const q = query.trim().toLowerCase();
  const seen = new Set();
  const results = [];
  entries.forEach(({ id, name: entryName }) => {
    const name = String(entryName || id || "").trim();
    if (!name || seen.has(name.toLowerCase())) return;
    if (q && !name.toLowerCase().includes(q)) return;
    seen.add(name.toLowerCase());
    results.push({ kind: kindId, label: name, insertText: name });
  });
  return results.slice(0, 20);
}

// macro/monster/npc/dice keep their own specific icons (a bolt, paws, a
// person, dice pips) even though monster/npc/macro also have a shared
// library-reference.js entry — iconFor's own fallback covers every
// other kind so this map doesn't need one entry per Library kind.
const KIND_ICON = {
  macro: "tabler:bolt",
  monster: "tabler:paw",
  npc: "tabler:user",
  dice: "tabler:dice-5",
  date: "tabler:calendar-star",
};

export function attachCodeBlockAutocomplete(textarea, { dataManager } = {}) {
  if (!textarea) return { destroy() {} };

  const dropdown = document.createElement("div");
  dropdown.className = "list-group shadow-theme";
  dropdown.style.position = "fixed";
  dropdown.style.zIndex = "1090";
  dropdown.style.maxHeight = "12rem";
  dropdown.style.overflowY = "auto";
  dropdown.style.minWidth = "12rem";
  dropdown.style.display = "none";
  document.body.appendChild(dropdown);

  // Fetched once per attach (Repository only ever has the one body
  // textarea) — until this resolves, PREFIX_PATTERN stays at its
  // macro/encounter/dice-only default, so typing one of those still works
  // immediately; every other kind's own prefix becomes recognized the
  // moment the list loads, with no reload/re-attach needed.
  void loadLibraryKinds()
    .then((kinds) => {
      PREFIX_PATTERN = buildPrefixPattern((kinds || []).map((kind) => kind.id));
    })
    .catch(() => {});

  let candidates = [];
  let activeIndex = -1;
  let currentParse = null;
  let suppressNextRefresh = false;
  // Bumped on every refresh() call — an in-flight async candidate fetch
  // (macro/encounter lookups both hit the server) that resolves after a
  // newer keystroke already moved on must not clobber the dropdown with
  // stale results, same "ignore a superseded async response" guard every
  // other debounced-fetch UI in this suite uses.
  let requestToken = 0;

  function hide() {
    dropdown.style.display = "none";
    candidates = [];
    activeIndex = -1;
    currentParse = null;
  }

  function renderCandidates() {
    dropdown.innerHTML = "";
    candidates.forEach((candidate, index) => {
      const item = document.createElement("button");
      item.type = "button";
      item.className = `list-group-item list-group-item-action py-1 px-2 small d-flex align-items-center gap-2${
        index === activeIndex ? " active" : ""
      }`;
      const iconSpan = document.createElement("span");
      iconSpan.className = "iconify flex-shrink-0";
      iconSpan.dataset.icon = KIND_ICON[candidate.kind] || iconFor(candidate.kind);
      iconSpan.setAttribute("aria-hidden", "true");
      item.append(iconSpan, document.createTextNode(candidate.label));
      // mousedown+preventDefault (not click) — same reasoning
      // wiki-link-autocomplete.js's own dropdown gives: no focus-loss race
      // with a separate blur handler.
      item.addEventListener("mousedown", (event) => {
        event.preventDefault();
        selectCandidate(index);
      });
      dropdown.appendChild(item);
    });
  }

  function positionDropdown() {
    const caret = measureCaretPosition(textarea, textarea.selectionStart);
    const rect = textarea.getBoundingClientRect();
    const caretTop = rect.top + (caret.top - textarea.scrollTop);
    const caretLeft = rect.left + (caret.left - textarea.scrollLeft);
    dropdown.style.display = "block";
    const dropdownRect = dropdown.getBoundingClientRect();
    const clampedLeft = Math.min(caretLeft, window.innerWidth - dropdownRect.width - 8);
    const belowTop = caretTop + caret.lineHeight;
    const showAbove = belowTop + dropdownRect.height > window.innerHeight - 8;
    dropdown.style.left = `${Math.max(8, clampedLeft)}px`;
    dropdown.style.top = showAbove ? `${Math.max(8, caretTop - dropdownRect.height)}px` : `${belowTop}px`;
  }

  function selectCandidate(index) {
    const candidate = candidates[index];
    if (!candidate || !currentParse) return;
    const value = textarea.value;
    const cursor = textarea.selectionStart;
    const before = value.slice(0, currentParse.replaceFrom);
    const after = value.slice(cursor);
    let insertText = candidate.insertText;
    if (currentParse.type === "encounter" && currentParse.needsQtyPrefix) {
      insertText = `1: ${insertText}`;
    }
    let newCursor = currentParse.replaceFrom + insertText.length;
    // macro/dice are single-value blocks — a selection completes the whole
    // span, so it's auto-closed with a backtick (unless one's already
    // sitting right there, e.g. editing an existing block), same
    // "don't double up the closer" reasoning wiki-link-autocomplete.js's
    // own `]]` handling uses. encounter is a multi-segment list — closing
    // it automatically after just one creature would fight anyone adding a
    // second, so it's left open for a `, ` to continue, or a manual
    // closing backtick when the GM is actually done.
    if (currentParse.type !== "encounter" && !after.startsWith("`")) {
      insertText = `${insertText}\``;
      newCursor = currentParse.replaceFrom + insertText.length - 1;
    }
    textarea.value = `${before}${insertText}${after}`;
    textarea.setSelectionRange(newCursor, newCursor);
    // Same same-tick-echo suppression wiki-link-autocomplete.js's own
    // selectCandidate uses — the dispatched "input" event below would
    // otherwise immediately have refresh() see this same edit and reopen
    // the dropdown against text this function itself just inserted.
    suppressNextRefresh = true;
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
    hide();
    textarea.focus();
  }

  async function refresh() {
    if (suppressNextRefresh) {
      suppressNextRefresh = false;
      return;
    }
    if (textarea.selectionStart !== textarea.selectionEnd) {
      hide();
      return;
    }
    const parsed = parseInProgressCodeBlock(textarea.value.slice(0, textarea.selectionStart));
    if (!parsed) {
      hide();
      return;
    }
    const token = (requestToken += 1);
    let nextCandidates;
    if (parsed.type === "macro") nextCandidates = await macroCandidates(dataManager, parsed.query);
    else if (parsed.type === "encounter") nextCandidates = await encounterCandidates(dataManager, parsed.query);
    else if (parsed.type === "dice") nextCandidates = diceCandidates(parsed.query);
    else if (parsed.type === "date") nextCandidates = dateCandidates(parsed.query);
    else nextCandidates = await genericCandidates(dataManager, parsed.type, parsed.query);
    if (token !== requestToken) return; // superseded by a later keystroke
    if (!nextCandidates.length) {
      hide();
      return;
    }
    currentParse = parsed;
    candidates = nextCandidates;
    activeIndex = 0;
    renderCandidates();
    positionDropdown();
  }

  function handleKeydown(event) {
    if (dropdown.style.display === "none") return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      activeIndex = (activeIndex + 1) % candidates.length;
      renderCandidates();
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      activeIndex = (activeIndex - 1 + candidates.length) % candidates.length;
      renderCandidates();
    } else if (event.key === "Enter" || event.key === "Tab") {
      event.preventDefault();
      selectCandidate(activeIndex);
    } else if (event.key === "Escape") {
      event.preventDefault();
      hide();
    }
  }

  function handleScroll() {
    if (dropdown.style.display !== "none") positionDropdown();
  }

  const handleInput = () => void refresh();
  textarea.addEventListener("input", handleInput);
  textarea.addEventListener("keydown", handleKeydown);
  textarea.addEventListener("blur", hide);
  document.addEventListener("scroll", handleScroll, true);

  return {
    destroy() {
      hide();
      dropdown.remove();
      textarea.removeEventListener("input", handleInput);
      textarea.removeEventListener("keydown", handleKeydown);
      textarea.removeEventListener("blur", hide);
      document.removeEventListener("scroll", handleScroll, true);
    },
  };
}
