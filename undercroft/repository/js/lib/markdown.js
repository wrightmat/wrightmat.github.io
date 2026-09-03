// Markdown → sanitized HTML, via the `marked`/`DOMPurify` CDN globals loaded
// by repository/index.html (deferred, after this page's own module script).
// Both are only ever touched inside renderMarkdown itself, never at module
// load time, so it's safe for this module to be imported before those
// scripts finish fetching.
//
// [[Page Title]] wiki-links are NOT part of CommonMark, so they're rewritten
// into plain markdown links *before* handing the text to marked — each
// becomes `[Page Title](#journal:<id-or-title>)`, resolved via the caller's
// own `resolveWikiLink(title)` (journal-links.js's buildTitleIndex, kept
// entirely out of this module — this file only renders text, it doesn't
// look pages up). A title that doesn't resolve still becomes a link so it's
// clickable in the preview — see applyWikiLinkStyling for how a missing
// target gets flagged (and why the "#").
//
// `dice:1d4`-style inline code spans get the same after-the-fact treatment —
// see journal-dice.js's own header comment.
import { applyDiceRollers } from "./journal-dice.js";
// `- [ ]`/`- [x]` task-list checkboxes are standard GFM, already rendered by
// marked itself (disabled by default) — see journal-tasks.js for what
// enabling them after the fact does.
import { applyTaskCheckboxes } from "./journal-tasks.js";
// `` `encounter:...` `` inline code spans, same post-process treatment as
// dice: blocks — see journal-encounter.js and applyEncounterBlocks below.
import { parseEncounterBlock } from "./journal-encounter.js";
// `` `macro:...` `` inline code spans — fully self-contained (parsing, chip,
// AND resolution/execution all live in journal-macro.js), unlike encounter
// blocks (which need this page's own id, so execution is a caller-supplied
// callback instead).
import { applyMacroBlocks } from "./journal-macro.js";
// Every OTHER Library kind's own `` `kindId:Name` `` inline code spans —
// same treatment, generic instead of one bespoke module per kind; see
// journal-kind-reference.js for why dice/encounter/macro (and journal/kind)
// are excluded from it.
import { applyKindReferenceBlocks } from "./journal-kind-reference.js";
// `` `date:<dayIndex>` `` inline code spans — same treatment, but not a kind
// reference (there's no "date" Library entity); see journal-date.js.
import { applyDateReferences } from "./journal-date.js";
// `> [!type]` callout blockquotes — parsing/color-icon lookup lives in
// journal-callouts.js (same split as journal-encounter.js: that module
// parses, this one renders); see ensureCalloutRenderer/applyCalloutStyling.
import { parseCallout, resolveCalloutStyle, resolveColor } from "./journal-callouts.js";
// Quest-specific decoration for a `[!quest]` callout's own title row —
// everything else about a quest callout renders through the same generic
// path every other callout type does.
import { computeQuestStatus, QUEST_STATUS_META } from "./journal-quests.js";
// `^blockId` marker lines under a named, rollable table — stripped from the
// raw text before rendering, same stage as rewriteWikiLinks below, since
// CommonMark doesn't know that syntax and would render a stray paragraph.
// See journal-tables.js (`dice:[[Page#^blockId]]`, resolved by dice-roll.js).
import { stripNamedTableMarkers } from "./journal-tables.js";
import { el } from "../../../common/js/lib/dom.js";
import { wikiLinkPattern } from "./wiki-link-syntax.js";

// Two things have to survive between here and applyWikiLinkStyling finding
// this anchor again below:
//   1. CommonMark link destinations without angle brackets can't contain a
//      raw space (or unbalanced parens) — a title like "Maris Wavedeep"
//      turned straight into `journal-missing:Maris Wavedeep` isn't a valid
//      destination, so marked leaves the literal `[label](journal-missing:
//      Maris Wavedeep)` text unrendered. encodeURIComponent keeps the
//      destination a single space-free token.
//   2. DOMPurify's default allowed-URI check only recognizes a fixed list of
//      real schemes (http, mailto, tel, ...) — a bare "journal:" scheme gets
//      its `href` stripped before this code ever runs. Leading with "#"
//      sidesteps that: DOMPurify treats anything starting with a non-letter
//      as a same-page fragment, always allowed. The "#" is never actually
//      used for navigation — applyWikiLinkStyling strips `href` entirely
//      (and wires a real click handler) before a user could click it.
// `heading` (from `[[Page#Heading]]`) rides along as a second colon-
// separated encoded segment — safe to split on a raw `:` since
// encodeURIComponent always escapes `:` within each segment itself.
function buildLinkTarget(prefix, value, heading) {
  const base = `#${prefix}:${encodeURIComponent(value)}`;
  return heading ? `${base}:${encodeURIComponent(heading)}` : base;
}

// Single-backtick inline code spans (`` `dice:...` ``, `` `encounter:...` ``)
// — split out and left untouched by rewriteWikiLinks below, so a literal
// `[[Page#^blockId]]` table reference inside a `` `dice:...` `` span
// survives as-is instead of being rewritten into a markdown link before
// journal-dice.js/dice-roll.js ever see the original syntax. Doesn't attempt
// full CommonMark code-span fidelity (multi-backtick delimiters, escaped
// backticks) — single backticks are the only kind this suite uses.
const CODE_SPAN_SPLIT_PATTERN = /(`[^`\n]*`)/g;

// A GFM task-list line with nothing (or only trailing whitespace) after its
// `[ ]`/`[x]` marker can fail to render an actual checkbox `<input>` in
// marked's GFM extension, falling back to plain list text instead (Obsidian
// renders these fine — this is a marked-specific edge case). Appending a
// zero-width space gives marked real inline content to anchor the
// checkbox+text rendering to; invisible to the reader, and this only ever
// runs on the render-time copy — the stored source is never touched.
// Tolerates the same optional blockquote prefix (`> - [ ]`, inside a
// `[!quest]` callout) journal-tasks.js's TASK_LINE_PATTERN does.
const EMPTY_TASK_LINE_PATTERN = /^((?:>\s?)*\s*[-*+]\s+\[[ xX]\])\s*$/;
// U+200B zero-width space, via String.fromCharCode so it's unambiguous on
// disk and in any future diff.
const ZERO_WIDTH_SPACE = String.fromCharCode(0x200b);
function ensureNonEmptyTaskContent(rawBody) {
  return String(rawBody || "")
    .split("\n")
    .map((line) => (EMPTY_TASK_LINE_PATTERN.test(line) ? `${line.replace(/\s+$/, "")} ${ZERO_WIDTH_SPACE}` : line))
    .join("\n");
}

function rewriteWikiLinks(rawBody, resolveWikiLink) {
  return String(rawBody || "")
    .split(CODE_SPAN_SPLIT_PATTERN)
    .map((segment, index) => (index % 2 === 1 ? segment : rewriteWikiLinksInSegment(segment, resolveWikiLink)))
    .join("");
}

function rewriteWikiLinksInSegment(rawBody, resolveWikiLink) {
  return String(rawBody || "").replace(wikiLinkPattern(), (match, title, heading, aliasLabel) => {
    const trimmedTitle = title.trim();
    if (!trimmedTitle) return match;
    const resolved = typeof resolveWikiLink === "function" ? resolveWikiLink(trimmedTitle) : null;
    const label = (aliasLabel || trimmedTitle).trim();
    // A heading anchor only makes sense for a link that actually resolves —
    // a not-yet-created page has nothing to jump to. The link's own explicit
    // `#Heading` always wins; `resolved.heading` is a resolver supplying an
    // IMPLICIT one — e.g. a bare [[Quest Title]] that only matched via the
    // quest-title index (repository/js/app.js's resolveWikiLinkTarget)
    // carries the quest's own title here, so the link lands on that quest's
    // callout, not just the top of its page.
    const effectiveHeading = (heading || resolved?.heading || "").trim();
    const target = resolved?.id
      ? buildLinkTarget("journal", resolved.id, effectiveHeading)
      : buildLinkTarget("journal-missing", trimmedTitle);
    return `[${label}](${target})`;
  });
}

// Runs after marked+DOMPurify have already turned the rewritten links above
// into real `<a href="#journal:...">`/`<a href="#journal-missing:...">` tags
// — this is what makes them behave like internal links instead of the
// browser trying to jump to a same-page fragment.
//
// Wikipedia-style: a link to a page that exists reads as normal (blue); a
// link to a page that doesn't exist yet reads red, with a tooltip naming
// what's missing, and clicking it starts a new page pre-filled with that
// title — the "redlink" convention. Removing `href` drops the browser's
// default link styling, so both cases get their color/underline set inline
// here (not just via the `.journal-link`/`.journal-link-missing` classes in
// repository/css/styles.css) — this module is also imported by handout.js
// to render a journal page inside a Dashboard widget, which never loads
// Repository's own stylesheet.
function applyWikiLinkStyling(container, { onNavigate } = {}) {
  container.querySelectorAll('a[href^="#journal:"], a[href^="#journal-missing:"]').forEach((anchor) => {
    const href = anchor.getAttribute("href") || "";
    const isMissing = href.startsWith("#journal-missing:");
    // "<encodedValue>" or "<encodedValue>:<encodedHeading>" — see
    // buildLinkTarget for why splitting on the first remaining raw ":" is
    // safe here.
    const rest = href.slice(href.indexOf(":") + 1);
    const headingSplit = rest.indexOf(":");
    const value = decodeURIComponent(headingSplit === -1 ? rest : rest.slice(0, headingSplit));
    const heading = headingSplit === -1 ? "" : decodeURIComponent(rest.slice(headingSplit + 1));
    anchor.removeAttribute("href");
    anchor.setAttribute("role", "link");
    anchor.style.cursor = "pointer";
    anchor.style.textDecoration = "underline";
    if (isMissing) {
      anchor.classList.add("journal-link-missing");
      anchor.style.color = "var(--bs-danger, #dc3545)";
      anchor.setAttribute("data-bs-toggle", "tooltip");
      anchor.setAttribute("data-bs-title", `journal missing: ${value}`);
    } else {
      anchor.classList.add("journal-link");
      anchor.style.color = "var(--bs-link-color, #0d6efd)";
    }
    anchor.addEventListener("click", (event) => {
      event.preventDefault();
      onNavigate?.(isMissing ? { missing: true, title: value } : { missing: false, id: value, heading });
    });
  });
}

// Runs AFTER applyWikiLinkStyling — every internal wiki-link anchor already
// had its `href` removed by that point, so a plain `a[href]` selector here
// only ever finds genuine external links, never re-touches an internal one.
// `rel="noopener noreferrer"` is the standard required pairing with
// `target="_blank"` — without it, the opened page gets a live
// `window.opener` reference back to this one.
function applyExternalLinkTargets(container) {
  container.querySelectorAll("a[href]").forEach((anchor) => {
    const href = anchor.getAttribute("href") || "";
    if (!href || href.startsWith("#")) return;
    anchor.target = "_blank";
    anchor.rel = "noopener noreferrer";
  });
}

const ENCOUNTER_CODE_PATTERN = /^encounter:\s*(.+)$/i;

// Same "inline styles, not CSS classes" reasoning as journal-dice.js's own
// chip — this can render inside handout.js's Dashboard widget, which never
// loads Repository's own stylesheet.
function styleAsChip(button) {
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
}

function buildEncounterChip(creatures, blockIndex, { interactive, onStartEncounter }) {
  const details = creatures.map((creature) => `${creature.qty}× ${creature.name}`).join(", ");
  const button = el("button", "repository-encounter-chip");
  button.type = "button";
  styleAsChip(button);
  button.style.cursor = interactive ? "pointer" : "default";
  const label = el("span", null, `Encounter: ${details}`);
  const icon = el("span", "iconify");
  icon.dataset.icon = "tabler:swords";
  icon.setAttribute("aria-hidden", "true");
  button.append(icon, label);
  if (interactive) {
    button.setAttribute("data-bs-toggle", "tooltip");
    button.setAttribute("data-bs-title", "Click to start this encounter");
    button.addEventListener("click", () => onStartEncounter?.(creatures, blockIndex));
  }
  return button;
}

// Runs after marked+DOMPurify — CommonMark's backtick syntax already turned
// `` `encounter: 1: Giant Shark, 2: Merfolk` `` into a plain <code>...</code>;
// this finds those and swaps each for a chip. The chip always renders, but
// only gets a click handler when `interactive` is true — starting combat
// (unlike rolling dice) is GM-only, so a player viewing a shown-to-the-table
// page must never be able to trigger it. `blockIndex` (0-based, among
// encounter blocks on THIS page only) is handed back to `onStartEncounter`
// so the caller can derive a stable id for this block — see
// journal-encounter.js's deterministicEncounterId.
function applyEncounterBlocks(container, { interactive = false, onStartEncounter } = {}) {
  let blockIndex = 0;
  container.querySelectorAll("code").forEach((codeEl) => {
    const match = ENCOUNTER_CODE_PATTERN.exec(codeEl.textContent.trim());
    if (!match) return;
    const creatures = parseEncounterBlock(match[1]);
    if (!creatures.length) return;
    codeEl.replaceWith(buildEncounterChip(creatures, blockIndex, { interactive, onStartEncounter }));
    blockIndex += 1;
  });
}

// Registers the `> [!type]` → callout transform on marked's shared global
// renderer, once — guarded so every renderMarkdown call (every keystroke in
// Preview, every widget mount) doesn't keep re-registering the same
// override. Deferred to first call rather than module load, same reason as
// this file's own top comment: `marked` may not have finished loading yet.
let calloutRendererRegistered = false;
function ensureCalloutRenderer(marked) {
  if (calloutRendererRegistered) return;
  calloutRendererRegistered = true;
  marked.use({
    renderer: {
      // Token-based renderer API (marked v5+) — `token.text` is this
      // blockquote's own dedented raw markdown source, exactly what
      // journal-callouts.js's parseCallout expects. Falling through to the
      // default rendering for anything that isn't a callout leaves ordinary
      // blockquotes untouched — this only fires when the blockquote's very
      // first line is a `[!type]` marker.
      //
      // Deliberately no color/icon baked into this HTML — it still has to
      // pass through DOMPurify.sanitize() below, and this module also
      // renders inside handout.js's Dashboard widget (no stylesheet loaded
      // there) — so the actual look is applied as inline styles by
      // applyCalloutStyling, after sanitization.
      blockquote(token) {
        const parsed = parseCallout(token.text);
        if (!parsed) {
          return `<blockquote>\n${this.parser.parse(token.tokens)}</blockquote>\n`;
        }
        // `type` only ever contains [A-Za-z0-9_-] (see parseCallout's own
        // pattern) — safe to embed directly into the attribute.
        const titleHtml = marked.parseInline(parsed.title, { async: false });
        const bodyHtml = parsed.bodyRaw.trim() ? marked.parse(parsed.bodyRaw, { async: false }) : "";
        const foldable = parsed.fold === "+" || parsed.fold === "-";
        const wrapperTag = foldable ? "details" : "div";
        const titleTag = foldable ? "summary" : "div";
        const openAttr = foldable && parsed.fold === "+" ? " open" : "";
        const contentHtml = bodyHtml ? `<div class="callout-content">${bodyHtml}</div>` : "";
        return (
          `<${wrapperTag} class="callout" data-callout="${parsed.type}"${openAttr}>` +
          `<${titleTag} class="callout-title">` +
          `<span class="callout-icon-slot"></span>` +
          `<span class="callout-title-text">${titleHtml}</span>` +
          `</${titleTag}>` +
          `${contentHtml}` +
          `</${wrapperTag}>\n`
        );
      },
    },
  });
}

// Runs after DOMPurify — fills in what the renderer override above
// deliberately left as bare structure: per-type border/background/title
// color (resolveCalloutStyle, keyed off `data-callout`), the actual icon
// (same "build an iconify span via DOM API" convention buildEncounterChip
// uses, not baked into the HTML string), and — for a foldable callout only —
// the rotating chevron and its `toggle` listener. `<details>`/`<summary>`
// already provide native open/close behavior, no click handling needed here.
// Quest-specific: a status badge (Not Started/Active/Complete), derived from
// the checkboxes already rendered inside this callout's content — reuses
// computeQuestStatus (journal-quests.js) rather than re-deriving that rule.
// Factored out of applyCalloutStyling's own loop so app.js's
// handleToggleTask can also call it directly after toggling one checkbox —
// checking a box doesn't trigger a full renderPreview (would disturb scroll
// position), so without this the badge would sit stale until the next full
// render. Reuses the existing badge element (by its own stable class) after
// the first call rather than rebuilding it.
export function refreshQuestBadge(calloutEl) {
  if (!calloutEl || calloutEl.dataset.callout !== "quest") return;
  const titleEl = calloutEl.firstElementChild;
  if (!titleEl) return;
  const contentEl = calloutEl.querySelector(":scope > .callout-content");
  const checkboxes = Array.from(contentEl?.querySelectorAll('input[type="checkbox"]') || []);
  const status = computeQuestStatus(checkboxes.map((checkbox) => ({ checked: checkbox.checked })));
  const meta = QUEST_STATUS_META[status] || QUEST_STATUS_META["not-started"];
  const badgeColor = resolveColor(meta.color);
  let badge = titleEl.querySelector(":scope > .callout-quest-badge");
  if (!badge) {
    badge = el("span", "callout-quest-badge");
    badge.style.display = "inline-flex";
    badge.style.alignItems = "center";
    badge.style.marginLeft = "auto";
    badge.style.padding = "0.05rem 0.5rem";
    badge.style.borderRadius = "999px";
    badge.style.fontSize = "0.72em";
    badge.style.fontWeight = "600";
    // Inserted before the chevron (if this callout is foldable and already
    // has one) so a foldable quest reads [title] [badge] [chevron]; matters
    // only on a later call — on the very first call (before the chevron is
    // ever added) this just appends, same net order either way.
    const chevron = titleEl.querySelector(":scope > .iconify[data-icon^='tabler:chevron']");
    if (chevron) titleEl.insertBefore(badge, chevron);
    else titleEl.appendChild(badge);
  }
  badge.textContent = meta.label;
  badge.style.color = badgeColor.value;
  badge.style.background = `rgba(${badgeColor.rgbValue}, 0.15)`;
  badge.style.border = `1px solid rgba(${badgeColor.rgbValue}, 0.35)`;
}

function applyCalloutStyling(container) {
  container.querySelectorAll("[data-callout]").forEach((calloutEl) => {
    const style = resolveCalloutStyle(calloutEl.dataset.callout);
    calloutEl.style.display = "block";
    calloutEl.style.borderRadius = "0.5rem";
    calloutEl.style.border = `1px solid ${style.value}`;
    calloutEl.style.borderLeftWidth = "0.25rem";
    calloutEl.style.background = `rgba(${style.rgbValue}, 0.08)`;
    calloutEl.style.margin = "0.75rem 0";
    calloutEl.style.padding = "0";
    calloutEl.style.overflow = "hidden";

    const titleEl = calloutEl.firstElementChild;
    if (titleEl) {
      // Switching a <summary>'s display away from its UA-default
      // `list-item` is what suppresses the native disclosure triangle in
      // every current browser — no `::marker`/`::-webkit-details-marker`
      // CSS rule needed (which couldn't be applied inline anyway).
      titleEl.style.display = "flex";
      titleEl.style.alignItems = "center";
      titleEl.style.gap = "0.4rem";
      titleEl.style.padding = "0.5rem 0.75rem";
      titleEl.style.fontWeight = "600";
      titleEl.style.color = style.value;
      if (calloutEl.dataset.callout === "quest") {
        refreshQuestBadge(calloutEl);
      }
      // A generic, always-reserved slot for a compact View toggle
      // (ui-components.js's createCycleToggleButton) any callout-specific
      // mounting code wants in its own title bar — Story Board's
      // Corkboard/Swimlane toggle (repository/js/app.js's
      // mountStoryBoardsInPreview) is the first consumer, but this function
      // has no knowledge of story boards or any specific callout type; it's
      // callout-type-agnostic by design, same as `.callout-icon-slot`
      // below. An empty span costs nothing when no caller fills it.
      // Inserted before the fold chevron. Carries `marginLeft: auto` itself
      // (not the chevron) — in a flex row, whichever element has the auto
      // margin gets pushed to the far right, dragging anything after it
      // along; putting it here pins [mode-slot, chevron] together at the
      // title bar's right edge, rather than leaving the mode slot right
      // after the title text with the chevron alone pushed away.
      const modeSlot = el("span", "callout-mode-slot d-inline-flex align-items-center gap-1");
      modeSlot.style.marginLeft = "auto";
      titleEl.appendChild(modeSlot);
      if (calloutEl.tagName === "DETAILS") {
        titleEl.style.cursor = "pointer";
        const chevron = el("span", "iconify");
        chevron.dataset.icon = "tabler:chevron-right";
        chevron.setAttribute("aria-hidden", "true");
        chevron.style.transition = "transform 0.15s ease";
        chevron.style.transform = calloutEl.open ? "rotate(90deg)" : "rotate(0deg)";
        titleEl.appendChild(chevron);
        calloutEl.addEventListener("toggle", () => {
          chevron.style.transform = calloutEl.open ? "rotate(90deg)" : "rotate(0deg)";
        });
      }
      const iconSlot = titleEl.querySelector(".callout-icon-slot");
      if (iconSlot) {
        const icon = el("span", "iconify");
        icon.dataset.icon = style.icon;
        icon.setAttribute("aria-hidden", "true");
        icon.style.color = style.value;
        icon.style.fontSize = "1.1em";
        icon.style.flex = "0 0 auto";
        iconSlot.replaceWith(icon);
      }
    }

    const contentEl = calloutEl.querySelector(":scope > .callout-content");
    if (contentEl) {
      contentEl.style.padding = "0 0.75rem 0.75rem 0.75rem";
    }
  });
}

// renderMarkdown(rawBody, {resolveWikiLink, onNavigate, status,
// interactiveCheckboxes, onToggleTask, interactiveEncounters,
// onStartEncounter, interactiveDice, interactiveMacros, groupContext,
// dataManager}) → a detached DOM node ready to append (not an HTML string) —
// building the click handlers here, once, is simpler than the caller
// re-querying the rendered markup afterward. `status` is only used for the
// dice-roller toast (see journal-dice.js). `dataManager` is only needed for
// a `` `dice:[[Page#^blockId]]` `` rollable-table reference — omitted, that
// chip still renders, just permanently shows "—". `interactiveCheckboxes`/
// `interactiveEncounters`/`interactiveDice`/`interactiveMacros` are NOT
// user-facing settings — Repository's own editor always passes all four
// true; handout.js's read-only Dashboard rendering leaves
// interactiveCheckboxes false always, and the other three true only for the
// owning GM's own dashboard (same gate as the eye-icon visibility toggle) —
// a player looking at a shown-to-the-table page must never be able to edit
// the GM's note source, start combat, roll dice, or fire a macro by
// clicking something in it. `groupContext` is only needed for
// `` `macro:...` `` (see journal-macro.js's runMacroReference).
// `validKindIds`/`kindLabels`/`onOpenReference` are for every OTHER kind's
// `` `kindId:Name` `` chip (journal-kind-reference.js) — `validKindIds` a
// Set, `kindLabels` a {id: label} map, both fetched once by the caller via
// loadLibraryKinds(), never by this module — renderMarkdown stays fully
// synchronous. Interactive unconditionally (unlike the GM-only flags above)
// — opening a reference is read-only, like a wiki-link click, not a GM-only
// action. `activeCalendar` is the active Setting's own `.calendar` field
// (or omitted), used only by `` `date:...` `` chips; omitted, a date chip
// renders as a plain "Day <N>" reading. `currentDayIndex` is the ambient
// campaign date, consulted only by `` `date:current` ``/`` `date:today` ``;
// omitted, that chip reads "No campaign date set".
export function renderMarkdown(
  rawBody,
  {
    resolveWikiLink,
    onNavigate,
    status,
    interactiveCheckboxes = false,
    onToggleTask,
    interactiveEncounters = false,
    onStartEncounter,
    interactiveDice = false,
    interactiveMacros = false,
    groupContext,
    dataManager,
    ensureWidget,
    onWledDevicesChange,
    validKindIds,
    kindLabels,
    onOpenReference,
    activeCalendar,
    currentDayIndex,
  } = {}
) {
  const container = document.createElement("div");
  const withLinks = ensureNonEmptyTaskContent(stripNamedTableMarkers(rewriteWikiLinks(rawBody, resolveWikiLink)));
  const marked = window.marked;
  const DOMPurify = window.DOMPurify;
  if (!marked || !DOMPurify) {
    // CDN scripts haven't finished loading yet — unlikely in practice (tiny
    // files, and this only runs from a user clicking "Preview" well after
    // page load), but render the raw text rather than showing nothing or
    // risking unsanitized HTML.
    container.textContent = rawBody || "";
    return container;
  }
  ensureCalloutRenderer(marked);
  // `breaks: true` — plain CommonMark treats a single newline inside a
  // paragraph as a soft wrap (invisible), only a blank line starts a new
  // paragraph. Every Notes-style field in this suite is typed like a casual
  // text box (hit Enter, expect a line break), not authored CommonMark
  // prose, so without this a note that looks multi-line in Edit mode
  // silently runs together in View mode.
  const html = DOMPurify.sanitize(marked.parse(withLinks, { async: false, breaks: true }));
  container.innerHTML = html;
  applyWikiLinkStyling(container, { onNavigate });
  applyExternalLinkTargets(container);
  applyDiceRollers(container, { status, interactive: interactiveDice, dataManager });
  applyEncounterBlocks(container, { interactive: interactiveEncounters, onStartEncounter });
  applyMacroBlocks(container, { status, interactive: interactiveMacros, dataManager, groupContext, ensureWidget, onWledDevicesChange });
  applyKindReferenceBlocks(container, { validKindIds, kindLabels, interactive: Boolean(onOpenReference), onOpenReference, dataManager });
  applyDateReferences(container, { activeCalendar, currentDayIndex });
  applyCalloutStyling(container);
  // Off by default at this layer — Repository's own editor always opts in;
  // handout.js's player-facing rendering leaves this false so a checkbox on
  // a shown-to-the-table page can't silently edit the GM's own note source.
  if (interactiveCheckboxes) {
    applyTaskCheckboxes(container, { body: rawBody, onToggle: onToggleTask });
  }
  return container;
}
