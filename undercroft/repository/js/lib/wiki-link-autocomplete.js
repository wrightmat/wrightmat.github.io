// A `[[` autocomplete dropdown for the plain <textarea> body editor — lists
// page titles, `page#Heading` sections, and `page#^blockId` named tables
// (journal-tables.js), all insertable directly. Vanilla, no rich-text editor
// dependency (this suite's body editor is a plain textarea). Caret
// positioning uses the same mirror-<div> measurement technique app.js's own
// heading-scroll-sync already proves out (measureTextareaContentHeight) — a
// small, self-contained duplicate here rather than exporting app.js's
// private one, since app.js is this page's own bootstrap script, not
// designed to be imported from.
import { extractOutline } from "./journal-outline.js";
import { extractNamedTables } from "./journal-tables.js";
import { extractQuests } from "./journal-quests.js";

const MIRROR_STYLE_PROPS = [
  "boxSizing",
  "width",
  "paddingTop",
  "paddingRight",
  "paddingBottom",
  "paddingLeft",
  "borderTopWidth",
  "borderRightWidth",
  "borderBottomWidth",
  "borderLeftWidth",
  "fontFamily",
  "fontSize",
  "fontWeight",
  "fontStyle",
  "letterSpacing",
  "lineHeight",
  "tabSize",
];

let mirrorEl = null;
function ensureMirror() {
  if (mirrorEl) return mirrorEl;
  mirrorEl = document.createElement("div");
  mirrorEl.style.position = "absolute";
  mirrorEl.style.visibility = "hidden";
  mirrorEl.style.top = "0";
  mirrorEl.style.left = "-9999px";
  mirrorEl.style.whiteSpace = "pre-wrap";
  mirrorEl.style.wordWrap = "break-word";
  mirrorEl.style.height = "auto";
  document.body.appendChild(mirrorEl);
  return mirrorEl;
}

// The caret's own (top, left) within the textarea's unscrolled content box,
// found by mirroring everything before it, a marker span, then everything
// after — the standard technique since textareas expose no native "pixel
// position of character N" API. Exported — reused as-is by
// code-block-autocomplete.js (the `` `macro:`/`encounter:`/`dice:` ``
// autocomplete), which needs the same caret-to-pixel measurement.
export function measureCaretPosition(textarea, caretIndex) {
  const mirror = ensureMirror();
  const computed = getComputedStyle(textarea);
  MIRROR_STYLE_PROPS.forEach((prop) => {
    mirror.style[prop] = computed[prop];
  });
  const value = textarea.value;
  mirror.innerHTML = "";
  mirror.appendChild(document.createTextNode(value.slice(0, caretIndex)));
  const marker = document.createElement("span");
  // A non-empty marker — an empty <span> can collapse to zero width/height
  // in a way that makes its own offsetTop/offsetLeft unreliable right at a
  // wrapped line boundary. Content is irrelevant (never rendered visibly).
  marker.textContent = String.fromCharCode(8203);
  mirror.appendChild(marker);
  // A trailing space so a caret at the very end of the content still
  // measures correctly (same reasoning measureTextareaContentHeight uses).
  mirror.appendChild(document.createTextNode(value.slice(caretIndex) || " "));
  return {
    top: marker.offsetTop,
    left: marker.offsetLeft,
    lineHeight: parseFloat(computed.lineHeight) || marker.offsetHeight || 16,
  };
}

// Detects an in-progress `[[...` sequence ending exactly at the cursor —
// nothing after the LAST unclosed `[[` yet that would mean it's already
// finished (a `]` closing it) or moved past the target (a `|` starting a
// custom alias). Returns null when the cursor isn't inside one.
// `title`/`heading`/`table` mirror the three insertable pieces this suite's
// wiki-link syntax supports (wiki-link-syntax.js, journal-tables.js's own
// `#^blockId` convention).
function parseInProgressLink(textBeforeCursor) {
  const bracketIndex = textBeforeCursor.lastIndexOf("[[");
  if (bracketIndex === -1) return null;
  const afterBracket = textBeforeCursor.slice(bracketIndex + 2);
  if (afterBracket.includes("]") || afterBracket.includes("|")) return null;
  const hashIndex = afterBracket.indexOf("#");
  if (hashIndex === -1) {
    return { stage: "title", title: "", query: afterBracket, replaceFrom: bracketIndex + 2 };
  }
  const title = afterBracket.slice(0, hashIndex).trim();
  const afterHash = afterBracket.slice(hashIndex + 1);
  if (afterHash.startsWith("^")) {
    return { stage: "table", title, query: afterHash.slice(1), replaceFrom: bracketIndex + 2 + hashIndex + 2 };
  }
  return { stage: "heading", title, query: afterHash, replaceFrom: bracketIndex + 2 + hashIndex + 1 };
}

function findEntryByTitle(entries, title) {
  const target = title.trim().toLowerCase();
  return entries.find((entry) => String(entry?.payload?.title || "").trim().toLowerCase() === target) || null;
}

// Case-insensitive substring match, deduped by title (a title collision
// across owners is rare enough in one GM's own journal not to need a
// disambiguation UI, same call journal-links.js's buildTitleIndex makes),
// capped so a large journal doesn't render an unbounded dropdown.
function titleCandidates(entries, query) {
  const q = query.trim().toLowerCase();
  const seen = new Set();
  const results = [];
  entries.forEach((entry) => {
    const title = String(entry?.payload?.title || "").trim();
    if (!title || seen.has(title.toLowerCase())) return;
    if (q && !title.toLowerCase().includes(q)) return;
    seen.add(title.toLowerCase());
    results.push({ kind: "title", label: title, insertText: title });
  });
  return results.slice(0, 20);
}

function headingCandidates(entries, title, query) {
  const entry = findEntryByTitle(entries, title);
  if (!entry) return [];
  const q = query.trim().toLowerCase();
  return extractOutline(entry.payload?.body)
    .filter((heading) => !q || heading.text.toLowerCase().includes(q))
    .slice(0, 20)
    .map((heading) => ({ kind: "heading", label: heading.text, insertText: heading.text }));
}

// A bare [[Quest Title]] resolves at the same top-level "title" stage a page
// title does (repository/js/app.js's resolveWikiLinkTarget falls back to
// the quest index) — quest titles aren't a separate parse stage, they're a
// second candidate list merged into "title"/"heading"'s own results.
// Workspace-wide, same scope journal-quests.js's buildQuestIndex uses.
function questTitleCandidates(entries, query) {
  const q = query.trim().toLowerCase();
  const seen = new Set();
  const results = [];
  entries.forEach((entry) => {
    extractQuests(entry?.payload?.body).forEach((quest) => {
      const key = quest.title.toLowerCase();
      if (seen.has(key)) return;
      if (q && !key.includes(q)) return;
      seen.add(key);
      results.push({ kind: "quest", label: quest.title, insertText: quest.title });
    });
  });
  return results.slice(0, 20);
}

// The [[Page#...]] equivalent — quests scoped to just that page, alongside
// headingCandidates' own real headings.
function questHeadingCandidates(entries, title, query) {
  const entry = findEntryByTitle(entries, title);
  if (!entry) return [];
  const q = query.trim().toLowerCase();
  return extractQuests(entry.payload?.body)
    .filter((quest) => !q || quest.title.toLowerCase().includes(q))
    .slice(0, 20)
    .map((quest) => ({ kind: "quest", label: quest.title, insertText: quest.title }));
}

function tableCandidates(entries, title, query) {
  const entry = findEntryByTitle(entries, title);
  if (!entry) return [];
  const q = query.trim().toLowerCase();
  return extractNamedTables(entry.payload?.body)
    .filter((table) => !q || table.blockId.toLowerCase().includes(q))
    .slice(0, 20)
    .map((table) => ({ kind: "table", label: `^${table.blockId}`, insertText: table.blockId }));
}

// "quest" reuses the same icon journal-callouts.js's own CALLOUT_TYPES.quest
// entry uses, for visual consistency with the callout it comes from.
const KIND_ICON = { title: "tabler:file-text", heading: "tabler:heading", table: "tabler:table", quest: "tabler:map-2" };

// attachWikiLinkAutocomplete(textarea, {getEntries}) — `getEntries` is a
// callback (not a plain array) since app.js's own `entries` list is
// reassigned after its async load; reading it fresh on every keystroke
// avoids a stale-closure snapshot from whenever this was first attached.
export function attachWikiLinkAutocomplete(textarea, { getEntries } = {}) {
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

  let candidates = [];
  let activeIndex = -1;
  let currentParse = null;
  let suppressNextRefresh = false;

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
      iconSpan.dataset.icon = KIND_ICON[candidate.kind] || "tabler:file-text";
      iconSpan.setAttribute("aria-hidden", "true");
      item.append(iconSpan, document.createTextNode(candidate.label));
      // mousedown+preventDefault (not click) — stops the textarea from
      // losing focus on a selection click, so there's no race with a
      // separate blur handler deciding whether this click still "counts."
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
    // Measured AFTER display:block — needs real layout for the clamping below.
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
    // Don't double up `]]` when completing a heading/table inside a link
    // that was already closed (editing an existing one) — only append it
    // when it isn't already sitting right after the cursor.
    const alreadyClosed = after.startsWith("]]");
    const insertText = alreadyClosed ? candidate.insertText : `${candidate.insertText}]]`;
    textarea.value = `${before}${insertText}${after}`;
    // "title" lands the cursor right before the `]]` (whether just appended
    // or already there) so typing `#` continues straight into the
    // heading/table stage; "heading"/"table" lands after `]]`, completing
    // the whole link in one action.
    const cursorOffset = currentParse.stage === "title" ? candidate.insertText.length : insertText.length;
    const newCursor = currentParse.replaceFrom + cursorOffset;
    textarea.setSelectionRange(newCursor, newCursor);
    // A "title" selection deliberately leaves the cursor inside an unclosed
    // `[[Title` (see the offset comment above) — the dispatched "input"
    // event below would otherwise immediately have refresh() see that same
    // still-open bracket and reopen the dropdown against itself. Suppressed
    // once, since this is only ever a same-tick echo of this function's own
    // change, never a real subsequent keystroke.
    suppressNextRefresh = true;
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
    hide();
    textarea.focus();
  }

  function refresh() {
    if (suppressNextRefresh) {
      suppressNextRefresh = false;
      return;
    }
    if (textarea.selectionStart !== textarea.selectionEnd) {
      hide();
      return;
    }
    const parsed = parseInProgressLink(textarea.value.slice(0, textarea.selectionStart));
    if (!parsed) {
      hide();
      return;
    }
    const entries = getEntries?.() || [];
    let nextCandidates;
    // "title"/"heading" each merge in quest titles alongside their own real
    // candidates — a quest resolves through the same [[Quest Title]]/
    // [[Page#Quest Title]] syntax pages and headings already use (see
    // resolveWikiLinkTarget in app.js).
    if (parsed.stage === "title") nextCandidates = [...titleCandidates(entries, parsed.query), ...questTitleCandidates(entries, parsed.query)];
    else if (parsed.stage === "heading")
      nextCandidates = [...headingCandidates(entries, parsed.title, parsed.query), ...questHeadingCandidates(entries, parsed.title, parsed.query)];
    else nextCandidates = tableCandidates(entries, parsed.title, parsed.query);
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

  // `input` (not `keyup`) — fires for typing, paste, and programmatic value
  // changes alike, same event this page's own body-change handler listens for.
  textarea.addEventListener("input", refresh);
  textarea.addEventListener("keydown", handleKeydown);
  textarea.addEventListener("blur", hide);
  document.addEventListener("scroll", handleScroll, true);

  return {
    destroy() {
      hide();
      dropdown.remove();
      textarea.removeEventListener("input", refresh);
      textarea.removeEventListener("keydown", handleKeydown);
      textarea.removeEventListener("blur", hide);
      document.removeEventListener("scroll", handleScroll, true);
    },
  };
}
