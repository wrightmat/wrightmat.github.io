// A `[[` autocomplete dropdown for the plain <textarea> body editor —
// lists page titles, `page#Heading` sections, and `page#^blockId` named
// tables (journal-tables.js), all insertable directly. Vanilla, no rich-text
// editor dependency (this suite's body editor is a plain textarea — see
// AGENTS.md's own vanilla-first convention). Caret positioning uses the same
// mirror-<div> measurement technique app.js's own heading-scroll-sync
// already proves out (measureTextareaContentHeight) — a small, self-
// contained duplicate here rather than exporting app.js's private one,
// since app.js is this page's own bootstrap script, not designed to be
// imported from.
import { extractOutline } from "./journal-outline.js";
import { extractNamedTables } from "./journal-tables.js";

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

// The caret's own (top, left) within the textarea's own unscrolled content
// box, found by mirroring everything before it, a marker span, then
// everything after — the standard technique for this since textareas expose
// no native "pixel position of character N" API at all.
function measureCaretPosition(textarea, caretIndex) {
  const mirror = ensureMirror();
  const computed = getComputedStyle(textarea);
  MIRROR_STYLE_PROPS.forEach((prop) => {
    mirror.style[prop] = computed[prop];
  });
  const value = textarea.value;
  mirror.innerHTML = "";
  mirror.appendChild(document.createTextNode(value.slice(0, caretIndex)));
  const marker = document.createElement("span");
  // A non-empty marker (not an empty string) — an empty <span> can collapse
  // to zero width/height in a way that makes its own offsetTop/offsetLeft
  // unreliable right at a wrapped line boundary. What's actually inside it
  // is irrelevant (never rendered visibly — the mirror itself is hidden),
  // only the marker's own start position is read below.
  marker.textContent = String.fromCharCode(8203);
  mirror.appendChild(marker);
  // A trailing space so a caret at the very end of the content still
  // measures correctly (same reasoning measureTextareaContentHeight's own
  // trailing space gives).
  mirror.appendChild(document.createTextNode(value.slice(caretIndex) || " "));
  return {
    top: marker.offsetTop,
    left: marker.offsetLeft,
    lineHeight: parseFloat(computed.lineHeight) || marker.offsetHeight || 16,
  };
}

// Detects an in-progress `[[...` sequence ending exactly at the cursor —
// nothing after the LAST unclosed `[[` yet that would mean it's already
// finished (a `]` closing it) or moved past the target entirely (a `|`
// starting a custom alias label). Returns null when the cursor isn't
// inside one. `title`/`heading`/`table` mirror the three insertable pieces
// this suite's own wiki-link syntax supports (wiki-link-syntax.js,
// journal-tables.js's own `#^blockId` convention).
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
// across owners is rare in one GM's own journal — not worth a
// disambiguation UI here either, same call journal-links.js's own
// buildTitleIndex already makes), capped so a large journal doesn't render
// an unbounded dropdown.
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

function tableCandidates(entries, title, query) {
  const entry = findEntryByTitle(entries, title);
  if (!entry) return [];
  const q = query.trim().toLowerCase();
  return extractNamedTables(entry.payload?.body)
    .filter((table) => !q || table.blockId.toLowerCase().includes(q))
    .slice(0, 20)
    .map((table) => ({ kind: "table", label: `^${table.blockId}`, insertText: table.blockId }));
}

const KIND_ICON = { title: "tabler:file-text", heading: "tabler:heading", table: "tabler:table" };

// attachWikiLinkAutocomplete(textarea, {getEntries}) — `getEntries` is a
// callback (not a plain array) since app.js's own `entries` list is
// reassigned after its own async load; reading it fresh on every keystroke
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
      // mousedown+preventDefault (not click) — stops the textarea from ever
      // actually losing focus on a selection click, so there's no race with
      // a separate blur handler having to decide whether this click still
      // "counts."
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
    // Measured AFTER display:block — needs real layout to know its own
    // width/height for the clamping below.
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
    // "title" lands the cursor right before the `]]` (whether it was just
    // appended or already there) so typing `#` continues straight into the
    // heading/table stage without navigating back inside the brackets;
    // "heading"/"table" lands after the (now-guaranteed-present) `]]`,
    // completing the whole link in one action.
    const cursorOffset = currentParse.stage === "title" ? candidate.insertText.length : insertText.length;
    const newCursor = currentParse.replaceFrom + cursorOffset;
    textarea.setSelectionRange(newCursor, newCursor);
    // A "title" selection deliberately leaves the cursor still inside an
    // unclosed `[[Title` (see the offset comment above) — the dispatched
    // "input" event below would otherwise immediately have refresh() see
    // that same still-open bracket and reopen the dropdown, now showing
    // "Title" matched against itself. Suppressed once, since this is only
    // ever a same-tick echo of the change this function itself just made,
    // never a real subsequent keystroke.
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
    if (parsed.stage === "title") nextCandidates = titleCandidates(entries, parsed.query);
    else if (parsed.stage === "heading") nextCandidates = headingCandidates(entries, parsed.title, parsed.query);
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

  // `input` (not `keyup`) — fires for typing, paste, and programmatic
  // value changes alike, same event this page's own body-change handler
  // already listens for.
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
