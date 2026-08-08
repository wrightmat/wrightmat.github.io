// Markdown → sanitized HTML, via the `marked`/`DOMPurify` CDN globals loaded
// by repository/index.html (deferred, after this page's own module script —
// see that file's own script-ordering comment). Both are only ever touched
// inside renderMarkdown itself, never at module load time, so it's safe for
// this module to be imported before those scripts finish fetching.
//
// [[Page Title]] wiki-links are NOT part of CommonMark, so they're rewritten
// into plain markdown links *before* handing the text to marked — each
// becomes `[Page Title](#journal:<id-or-title>)`, resolved via the caller's
// own `resolveWikiLink(title)` (journal-links.js's buildTitleIndex, kept
// entirely out of this module — this file only knows how to render text, not
// how to look pages up). A title that doesn't resolve still becomes a link
// so it's clickable in the rendered preview — see applyWikiLinkStyling below
// for how a missing target gets flagged visually (and why the "#").
//
// `dice:1d4`-style inline code spans get the same after-the-fact treatment —
// see journal-dice.js's own header comment.
import { applyDiceRollers } from "./journal-dice.js";
// `- [ ]`/`- [x]` task-list checkboxes are standard GFM, already rendered by
// marked itself (disabled by default) — see journal-tasks.js's own header
// comment for what enabling them after the fact does.
import { applyTaskCheckboxes } from "./journal-tasks.js";
// `` `encounter:...` `` inline code spans, same "post-process a rendered
// <code> element" treatment as dice: blocks — see journal-encounter.js's own
// header comment and applyEncounterBlocks below.
import { parseEncounterBlock } from "./journal-encounter.js";
// `` `macro:...` `` inline code spans — fully self-contained (parsing,
// chip, AND resolution/execution all live in journal-macro.js), same shape
// journal-dice.js already uses, unlike encounter blocks (which need this
// page's own id, so their execution is a caller-supplied callback instead —
// see journal-macro.js's own header comment for why macros don't need that).
import { applyMacroBlocks } from "./journal-macro.js";
// Every OTHER Library kind's own `` `kindId:Name` `` inline code spans —
// same treatment, but generic instead of one bespoke module per kind; see
// journal-kind-reference.js's own header comment for why dice/encounter/
// macro (and journal/kind) are excluded from it.
import { applyKindReferenceBlocks } from "./journal-kind-reference.js";
// `> [!type]` callout blockquotes — parsing/color-icon lookup lives in
// journal-callouts.js (same split as journal-encounter.js's own
// parseEncounterBlock: that module parses, this one renders); see
// ensureCalloutRenderer/applyCalloutStyling below for how the two halves fit
// together.
import { parseCallout, resolveCalloutStyle } from "./journal-callouts.js";
// `^blockId` marker lines under a named, rollable table — stripped from the
// raw text before rendering, same stage as rewriteWikiLinks below, since
// CommonMark doesn't know that syntax and would otherwise render a stray
// paragraph for it. See journal-tables.js's own header comment for the
// feature this supports (`dice:[[Page#^blockId]]`, resolved by dice-roll.js).
import { stripNamedTableMarkers } from "./journal-tables.js";
import { el } from "../../../common/js/lib/dom.js";
import { wikiLinkPattern } from "./wiki-link-syntax.js";

// Two independent things have to survive between here and applyWikiLinkStyling
// actually finding this anchor again below:
//   1. CommonMark link destinations without angle brackets can't contain a
//      raw space (or unbalanced parens) — a title like "Maris Wavedeep"
//      turned straight into `journal-missing:Maris Wavedeep` isn't a valid
//      destination at all, so marked doesn't parse it as a link and just
//      leaves the literal `[label](journal-missing:Maris Wavedeep)` text
//      sitting there unrendered. encodeURIComponent keeps the destination a
//      single space-free token.
//   2. DOMPurify's default allowed-URI check only recognizes a fixed list of
//      real schemes (http, mailto, tel, ...) — an arbitrary custom scheme
//      like a bare "journal:" is exactly the shape of URI that check exists
//      to reject, so it strips the `href` attribute entirely before this
//      code ever runs. Leading with "#" sidesteps that: DOMPurify treats
//      anything starting with a non-letter as a same-page fragment, always
//      allowed, regardless of what follows. The "#" is never actually used
//      as a fragment navigation — applyWikiLinkStyling strips `href`
//      entirely (and wires a real click handler) before a user could ever
//      click it.
// `heading` (from a `[[Page#Heading]]` link) rides along as a second
// colon-separated encoded segment — safe to split on a raw `:` afterward
// since encodeURIComponent always escapes `:` to `%3A` within each segment
// itself, so it can never appear un-encoded except as the delimiter this
// function itself inserts.
function buildLinkTarget(prefix, value, heading) {
  const base = `#${prefix}:${encodeURIComponent(value)}`;
  return heading ? `${base}:${encodeURIComponent(heading)}` : base;
}

// Single-backtick inline code spans (`` `dice:...` ``, `` `encounter:...` ``)
// — split out and left untouched by rewriteWikiLinks below, so a literal
// `[[Page#^blockId]]` table reference inside a `` `dice:...` `` span survives
// as-is instead of being rewritten into a markdown link before
// journal-dice.js/dice-roll.js ever see the original syntax (confirmed bug:
// a `dice:[[...]]` chip silently turned into `dice:[Title](#journal:...)`,
// which the numeric dice parser then choked on). Doesn't attempt full
// CommonMark code-span fidelity (multi-backtick delimiters, escaped
// backticks) — single backticks are the only kind any convention in this
// suite actually uses.
const CODE_SPAN_SPLIT_PATTERN = /(`[^`\n]*`)/g;

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
    // a not-yet-created page has nothing to jump to inside it.
    const target = resolved?.id
      ? buildLinkTarget("journal", resolved.id, (heading || "").trim())
      : buildLinkTarget("journal-missing", trimmedTitle);
    return `[${label}](${target})`;
  });
}

// Runs after marked+DOMPurify have already turned the rewritten links above
// into real `<a href="#journal:...">`/`<a href="#journal-missing:...">` tags
// — this is what actually makes them behave like internal links instead of
// the browser trying to jump to a same-page fragment.
//
// Wikipedia-style: a link to a page that exists reads as a normal (blue)
// link; a link to a page that doesn't exist yet reads red, with a tooltip
// naming what's missing, and clicking it starts a new page pre-filled with
// that title — same "redlink" convention Wikipedia itself uses. Removing
// `href` below drops the browser's own default link styling entirely, so
// both cases get their color/underline set inline here (not just via the
// `.journal-link`/`.journal-link-missing` classes in repository/css/
// styles.css) — this module is also imported by handout.js to render a
// journal page inside a Dashboard widget, a page that never loads
// Repository's own stylesheet, so the classes alone wouldn't be enough
// there.
function applyWikiLinkStyling(container, { onNavigate } = {}) {
  container.querySelectorAll('a[href^="#journal:"], a[href^="#journal-missing:"]').forEach((anchor) => {
    const href = anchor.getAttribute("href") || "";
    const isMissing = href.startsWith("#journal-missing:");
    // "<encodedValue>" or "<encodedValue>:<encodedHeading>" — see
    // buildLinkTarget's own comment for why splitting on the first
    // remaining raw ":" is safe here.
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
      anchor.title = `journal missing: ${value}`;
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

const ENCOUNTER_CODE_PATTERN = /^encounter:\s*(.+)$/i;

// Same "inline styles, not CSS classes" reasoning as journal-dice.js's own
// chip — this can render inside handout.js's Dashboard widget, a page that
// never loads Repository's own stylesheet.
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
    button.title = "Click to start this encounter";
    button.addEventListener("click", () => onStartEncounter?.(creatures, blockIndex));
  }
  return button;
}

// Runs after marked+DOMPurify — CommonMark's own backtick syntax already
// turned `` `encounter: 1: Giant Shark, 2: Merfolk` `` into a plain
// <code>...</code>; this finds those and swaps each one for a chip. The chip
// always renders (a readable summary), but only gets a click handler when
// `interactive` is true — starting combat (unlike rolling dice) is a GM-only
// action, so a player viewing a shown-to-the-table page must never be able
// to trigger it, while still seeing something more useful than raw
// `encounter:` code text. `blockIndex` (0-based, among encounter blocks on
// THIS page only, in document order) is handed back to `onStartEncounter` so
// the caller can derive a stable id for this specific block — see
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
// this file's own top-of-file comment: `marked` may not have finished
// loading yet when this module is first imported.
let calloutRendererRegistered = false;
function ensureCalloutRenderer(marked) {
  if (calloutRendererRegistered) return;
  calloutRendererRegistered = true;
  marked.use({
    renderer: {
      // Token-based renderer API (marked v5+) — `token.text` is this
      // blockquote's own dedented raw markdown source (every leading `>`
      // and the one space after it already stripped, multi-line structure
      // otherwise intact), exactly what journal-callouts.js's parseCallout
      // expects. Falling through to the default rendering (via the
      // already-parsed `token.tokens`) for anything that isn't a callout
      // leaves ordinary blockquotes completely untouched — this only ever
      // fires for a blockquote whose very first line is a `[!type]` marker.
      //
      // Deliberately no color/icon baked into this HTML — this string still
      // has to pass through DOMPurify.sanitize() below, and (same reasoning
      // applyWikiLinkStyling/styleAsChip already document) this module also
      // renders inside handout.js's Dashboard widget, which never loads
      // Repository's own stylesheet — so the actual look is applied as
      // inline styles by applyCalloutStyling, after sanitization, exactly
      // like every other cross-tool-reused piece of this renderer.
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
// color (resolveCalloutStyle, keyed off the `data-callout` attribute), the
// actual icon (same "build an iconify span via DOM API" convention
// buildEncounterChip uses, not baked into the HTML string), and — for a
// foldable callout only — the rotating chevron and its `toggle` listener.
// `<details>`/`<summary>` already provide the actual open/close behavior
// natively, no click handling needed here at all.
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
      if (calloutEl.tagName === "DETAILS") {
        titleEl.style.cursor = "pointer";
        const chevron = el("span", "iconify");
        chevron.dataset.icon = "tabler:chevron-right";
        chevron.setAttribute("aria-hidden", "true");
        chevron.style.marginLeft = "auto";
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
// dataManager}) → a detached DOM node ready to append
// (not an HTML string) — building the click handlers here, once, is simpler
// than the caller re-querying the rendered markup afterward. `status` is
// only used for the dice-roller toast (rollExpression's own — see
// journal-dice.js). `dataManager` is likewise only needed for a
// `` `dice:[[Page#^blockId]]` `` rollable-table reference — a plain
// `` `dice:2d6` `` chip never touches it; omitted, a table-reference chip
// still renders, just permanently shows "—" (rollExpression's own "not
// available here" case). `interactiveCheckboxes`/`interactiveEncounters`/
// `interactiveDice`/`interactiveMacros` are NOT user-facing settings —
// Repository's own editor always passes all four true (checking a box off,
// starting an encounter, rolling dice, or running a macro always works
// there); handout.js's read-only Dashboard rendering leaves
// interactiveCheckboxes false always, and
// interactiveEncounters/interactiveDice/interactiveMacros true only for the
// owning GM's own dashboard (same gate as the eye-icon visibility toggle) —
// a player looking at a shown-to-the-table page must never be able to edit
// the GM's note source, start combat, roll dice, or fire a macro (WLED
// commands, table-wide sound/handouts, ...) by clicking something in it.
// `groupContext` is only needed for `` `macro:...` `` — see
// journal-macro.js's own runMacroReference for what it's used for.
// `validKindIds`/`kindLabels`/`onOpenReference` are for every OTHER kind's
// own `` `kindId:Name` `` chip (journal-kind-reference.js) — `validKindIds`
// a Set, `kindLabels` a {id: label} map (both from loadLibraryKinds(),
// fetched once by the caller, never by this module itself — renderMarkdown
// stays fully synchronous). Interactive unconditionally (unlike
// interactiveEncounters/interactiveDice/interactiveMacros above) — opening
// a reference is read-only, the same as clicking a wiki-link, not a GM-only
// action like starting combat or firing a macro.
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
  } = {}
) {
  const container = document.createElement("div");
  const withLinks = stripNamedTableMarkers(rewriteWikiLinks(rawBody, resolveWikiLink));
  const marked = window.marked;
  const DOMPurify = window.DOMPurify;
  if (!marked || !DOMPurify) {
    // CDN scripts (marked/DOMPurify) haven't finished loading yet — extremely
    // unlikely in practice (they're tiny and this only ever runs from a user
    // clicking "Preview", well after page load), but render the raw text
    // rather than either silently showing nothing or risking unsanitized
    // HTML.
    container.textContent = rawBody || "";
    return container;
  }
  ensureCalloutRenderer(marked);
  const html = DOMPurify.sanitize(marked.parse(withLinks, { async: false }));
  container.innerHTML = html;
  applyWikiLinkStyling(container, { onNavigate });
  applyDiceRollers(container, { status, interactive: interactiveDice, dataManager });
  applyEncounterBlocks(container, { interactive: interactiveEncounters, onStartEncounter });
  applyMacroBlocks(container, { status, interactive: interactiveMacros, dataManager, groupContext, ensureWidget, onWledDevicesChange });
  applyKindReferenceBlocks(container, { validKindIds, kindLabels, interactive: Boolean(onOpenReference), onOpenReference });
  applyCalloutStyling(container);
  // Off by default at this layer — Repository's own editor always opts in;
  // handout.js's player-facing rendering leaves this false so a checkbox on
  // a shown-to-the-table page can't silently edit the GM's own note source.
  if (interactiveCheckboxes) {
    applyTaskCheckboxes(container, { body: rawBody, onToggle: onToggleTask });
  }
  return container;
}
