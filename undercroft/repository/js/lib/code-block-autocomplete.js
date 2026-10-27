// A `` `macro:`/`encounter:`/`dice:` `` — and every other Library kind's own
// `` `kindId:` `` — autocomplete dropdown for the body textarea, same style/
// mechanics as wiki-link-autocomplete.js, just detecting an unclosed
// backtick code span starting with a recognized prefix instead of `[[`.
// Reuses that module's measureCaretPosition rather than a second copy.
import { measureCaretPosition } from "./wiki-link-autocomplete.js";
import { fetchKindEntrySummaries, loadLibraryKinds } from "../../../common/js/lib/content-fetch.js";
import { QUICK_DICE } from "../../../common/js/lib/widgets/dice-roll.js";
import { EXCLUDED_KINDS, iconFor } from "../../../common/js/lib/library-reference.js";

// macro/encounter/dice/date are always recognized, even before the full
// kind list below loads. `date` is never a real Library kind (no "date"
// entity to look up), so it can't come from loadLibraryKinds() the way
// every other prefix does — it's hardcoded here. Rebuilt once
// loadLibraryKinds() resolves to also recognize every real kind.
let PREFIX_PATTERN = /^(macro|encounter|dice|date)\s*:\s*/i;

function buildPrefixPattern(kindIds) {
  const extra = (kindIds || []).filter(
    (id) => !EXCLUDED_KINDS.has(id) && id !== "macro" && id !== "encounter" && id !== "dice" && id !== "date"
  );
  const alternation = ["macro", "encounter", "dice", "date", ...extra].join("|");
  return new RegExp(`^(${alternation})\\s*:\\s*`, "i");
}

// Detects an in-progress `` `type:...` `` span ending at the cursor —
// unclosed, no newline crossed (code spans are always single-line).
// `encounter:` gets its own sub-parse: its content is a comma-separated
// `qty: Name` list, so completion targets just the segment being typed —
// and within that, just the name part once a "qty:" has been typed.
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

// Free-text mode (`freeSearch: true`) — for an input whose whole line is
// meant to be ONE reference (a Board card), so nobody has to know a prefix:
// the line so far is the search, matched against every kind at once, and
// picking a result writes whichever syntax that kind needs. A line already
// inside explicit syntax (`[[…` or a backtick) belongs to the prefix flow
// above and wiki-link-autocomplete.js, never this one.
const FREE_SEARCH_MIN_LENGTH = 2;
const FREE_SEARCH_DEBOUNCE_MS = 150;

function parseFreeText(textBeforeCursor) {
  const lineStart = textBeforeCursor.lastIndexOf("\n") + 1;
  const line = textBeforeCursor.slice(lineStart);
  if (line.includes("`") || line.lastIndexOf("[[") > line.lastIndexOf("]]")) return null;
  // A typed "macro:Go" still works — it just narrows the search to that kind.
  const prefixMatch = PREFIX_PATTERN.exec(line.trimStart());
  const kind = prefixMatch ? prefixMatch[1].toLowerCase() : null;
  if (kind === "encounter") return null; // needs its own creature-list syntax
  const query = (prefixMatch ? line.trimStart().slice(prefixMatch[0].length) : line).trim();
  if (!kind && query.length < FREE_SEARCH_MIN_LENGTH) return null;
  return { type: "free", kind, query, replaceFrom: lineStart, free: true };
}

async function macroCandidates(dataManager, query) {
  if (!dataManager) return [];
  // Only needs a name/id lookup for the dropdown label — a metadata-only
  // fetch is enough, unlike journal-macro.js's own findMacro.
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

// Matches journal-encounter.js's findMatch exactly — monsters AND npcs —
// so what autocompletes is exactly what would resolve when the block runs.
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

// A fixed day index isn't completable from a list, but `current` is worth
// surfacing since it's easy to forget exists otherwise.
function dateCandidates(query) {
  const q = query.trim().toLowerCase();
  if (q && !"current".startsWith(q)) return [];
  return [{ kind: "date", label: "current", insertText: "current" }];
}

// Every kind that isn't macro/encounter/dice — same shape as macroCandidates
// above, parameterized on which kind's entries to offer.
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

// Journal pages are wiki links; every other kind is a backticked
// `kind:Name` reference — the one place that decides which a free-text pick
// writes.
function referenceSyntax(kind, name) {
  return kind === "journal" ? `[[${name}]]` : `\`${kind}:${name}\``;
}

const FREE_KIND_LABELS = { journal: "Journal Page", macro: "Macro", dice: "Dice", date: "Date" };

// Everything a card can reference, matched on title across every kind in one
// server search (the same one the header search uses), plus dice and the
// `date:current` reference. `referenceKindIds` is the set of Library kinds
// that make valid `kind:Name` references (loadLibraryKinds, minus
// EXCLUDED_KINDS) — a search hit of any other kind has no syntax to write.
async function freeCandidates(dataManager, { kind, query }, { referenceKindIds, kindLabels }) {
  const labelFor = (candidateKind) => kindLabels[candidateKind] || FREE_KIND_LABELS[candidateKind] || candidateKind;
  const make = (candidateKind, name, insertText = referenceSyntax(candidateKind, name)) => ({
    kind: candidateKind,
    label: name,
    kindLabel: labelFor(candidateKind),
    insertText,
  });
  const dice = () => {
    const fullExpression = /^\d+d\d+$/i.test(query) ? [make("dice", query, referenceSyntax("dice", query))] : [];
    const partial = diceCandidates(query).map((die) => make("dice", die.label, referenceSyntax("dice", die.insertText)));
    return [...fullExpression, ...partial];
  };
  const date = () => {
    const q = query.toLowerCase();
    return !q || "current".startsWith(q) || "date".startsWith(q) ? [make("date", "current", referenceSyntax("date", "current"))] : [];
  };

  if (kind === "dice") return dice();
  if (kind === "date") return date();
  if (kind) {
    const found = kind === "macro" ? await macroCandidates(dataManager, query) : await genericCandidates(dataManager, kind, query);
    return found.map((candidate) => make(kind, candidate.label));
  }

  const needle = query.toLowerCase();
  const rows = await dataManager.searchContent(query).catch(() => []);
  const results = rows
    .filter((row) => row.match_type === "title" && (row.kind === "journal" || row.kind === "macro" || referenceKindIds.has(row.kind)))
    .map((row) => make(row.kind, String(row.title || row.id)));
  // Prefix matches first; the sort is stable, so the server's own order holds within each group.
  results.sort((a, b) => Number(b.label.toLowerCase().startsWith(needle)) - Number(a.label.toLowerCase().startsWith(needle)));
  if (/^\d*d\d*$/i.test(query)) results.push(...dice());
  results.push(...date());
  const seen = new Set();
  return results.filter((candidate) => !seen.has(candidate.insertText) && seen.add(candidate.insertText)).slice(0, 20);
}

// macro/monster/npc/dice keep their own specific icons — iconFor's fallback
// covers every other kind, so this map doesn't need one entry per kind.
const KIND_ICON = {
  journal: "tabler:notebook",
  macro: "tabler:bolt",
  monster: "tabler:paw",
  npc: "tabler:user",
  dice: "tabler:dice-5",
  date: "tabler:calendar-star",
};

export function attachCodeBlockAutocomplete(textarea, { dataManager, freeSearch = false } = {}) {
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

  // Until this resolves, PREFIX_PATTERN stays at its macro/encounter/dice
  // default, so those still work immediately; every other prefix becomes
  // recognized the moment the list loads, no reload needed.
  const freeKindInfo = { referenceKindIds: new Set(), kindLabels: {} };
  void loadLibraryKinds()
    .then((kinds) => {
      PREFIX_PATTERN = buildPrefixPattern((kinds || []).map((kind) => kind.id));
      freeKindInfo.referenceKindIds = new Set((kinds || []).map((kind) => kind.id).filter((id) => !EXCLUDED_KINDS.has(id)));
      freeKindInfo.kindLabels = Object.fromEntries((kinds || []).map((kind) => [kind.id, kind.label || kind.id]));
    })
    .catch(() => {});

  let candidates = [];
  let activeIndex = -1;
  let currentParse = null;
  let suppressNextRefresh = false;
  // Bumped on every refresh() — guards against an in-flight fetch resolving
  // after a newer keystroke and clobbering the dropdown with stale results.
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
      // Free-text results span every kind, so each says which it is.
      if (candidate.kindLabel) {
        const kindSpan = document.createElement("span");
        kindSpan.className = "ms-auto ps-2 opacity-75 text-nowrap";
        kindSpan.textContent = candidate.kindLabel;
        item.appendChild(kindSpan);
      }
      // mousedown+preventDefault, not click — avoids a focus-loss race with blur.
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
    // macro/dice are single-value blocks — auto-closed with a backtick
    // (unless one's already there). encounter is a multi-segment list —
    // closing it after one creature would fight adding a second, so it's
    // left open for `, ` or a manual closing backtick. A free-text pick
    // already carries its complete syntax.
    if (currentParse.type !== "encounter" && !currentParse.free && !after.startsWith("`")) {
      insertText = `${insertText}\``;
      newCursor = currentParse.replaceFrom + insertText.length - 1;
    }
    textarea.value = `${before}${insertText}${after}`;
    textarea.setSelectionRange(newCursor, newCursor);
    // Suppresses refresh() from reopening the dropdown against the text
    // this function itself just inserted, once the "input" event below fires.
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
    const textBeforeCursor = textarea.value.slice(0, textarea.selectionStart);
    const parsed = parseInProgressCodeBlock(textBeforeCursor) || (freeSearch ? parseFreeText(textBeforeCursor) : null);
    if (!parsed) {
      hide();
      return;
    }
    const token = (requestToken += 1);
    let nextCandidates;
    if (parsed.free) {
      // Debounced — every keystroke is otherwise a server search. A newer
      // keystroke bumps the token, which cancels this one.
      await new Promise((resolve) => window.setTimeout(resolve, FREE_SEARCH_DEBOUNCE_MS));
      if (token !== requestToken) return;
      nextCandidates = await freeCandidates(dataManager, parsed, freeKindInfo);
    } else if (parsed.type === "macro") nextCandidates = await macroCandidates(dataManager, parsed.query);
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
    // Free text starts with nothing highlighted so Enter still adds what was
    // typed as an ordinary card — a suggestion needs an arrow key or Tab.
    activeIndex = parsed.free ? -1 : 0;
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
      activeIndex = activeIndex <= 0 ? candidates.length - 1 : activeIndex - 1;
      renderCandidates();
    } else if (event.key === "Enter" && activeIndex < 0) {
      // Nothing highlighted (free text) — leave Enter to the host input.
      hide();
    } else if (event.key === "Enter" || event.key === "Tab") {
      event.preventDefault();
      selectCandidate(Math.max(activeIndex, 0));
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
