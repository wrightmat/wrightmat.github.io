// CANONICAL TOOLTIP SYSTEM — the ONE module every Bootstrap tooltip in this
// suite goes through. No file anywhere else may call `new bootstrap.Tooltip`,
// `getInstance`, or `getOrCreateInstance` directly. Established 2026-08-30
// after the two bug classes below were independently reintroduced 6+ times
// across the codebase.
//
// BUG CLASS 1 — "tooltip never shows": a native `disabled` attribute (or a
// `pointer-events: none` class approximating one) blocks ALL pointer events,
// including the ones Bootstrap's Tooltip needs to show at all. A tooltip
// trigger on the SAME element you're disabling silently never works. Fix:
// keep `control` genuinely disabled, put the tooltip trigger on a separate,
// never-disabled wrapper — see setDisabledTooltip, the one place this
// pattern is allowed.
//
// BUG CLASS 2 — "tooltip lingers after hover exits": Bootstrap renders the
// popup as a <body> sibling (via Popper), not inside the trigger. Two ways
// this orphans a popup: (a) wiping a container's innerHTML without disposing
// tooltips inside it first — always disposeTooltips(container) BEFORE the
// wipe, not refreshTooltips() after; (b) mutating/removing a trigger's
// data-bs-toggle/data-bs-title BEFORE disposing — disposal only finds
// elements still carrying that attribute. Always: dispose → then mutate.
//
// Which function to use:
// - One element, tooltip live now: initTooltip(element, {title, placement?, html?})
// - Many elements in a loop: set data-bs-toggle/data-bs-title on each, then
//   refreshTooltips(container) ONCE after the loop.
// - About to wipe/replace a container: disposeTooltips(container) BEFORE the
//   wipe, refreshTooltips(container) after the new content exists.
// - One element, no risk to sibling tooltips: disposeTooltip(element) /
//   refreshTooltip(element) — prefer over the root-scoped pair when you
//   already have a direct reference.
// - Disabled control that still needs an explanatory hover: setDisabledTooltip(control, reason, {wrapper?}).
// - Live-updating an existing tooltip's text with no flicker: updateTooltipContent(element, title).
// - Temporary confirmation flash ("Copied!"): flashTooltipMessage(element, message, {duration?}).
//
// Deliberately out of scope: help.js's data-help-topic system sets the same
// data-bs-toggle="tooltip" declaratively and calls refreshTooltips from here
// — already in scope. library-reference.js's hover preview is a fully
// custom pointer-events:none popup, a different system on purpose.
// property-schema-editor.js takes refreshTooltips as an injected callback
// (stays host-app-agnostic) but the one real caller supplies this module's
// function — still funnels through the same implementation.
//
// Confirmed exceptions (native title/aria-label-only, NOT bugs) — any new
// exception must be confirmed with the user first (AskUserQuestion), then
// listed here:
// - map-viewer.js's map marker/badge hover text and template-renderer.js's
//   applyOverflowIndicators — both rerun on a hot render path across
//   potentially hundreds of non-interactive elements; user confirmed native
//   `title` over a real Tooltip instance per element (2026-08-30).
// - Bootstrap's own `.btn-close` modal-dismiss button (used across every
//   modal in the suite) — `aria-label="Close"` is Bootstrap's own complete,
//   documented treatment for this standardized idiom; user confirmed
//   keeping it tooltip-free (2026-08-30).

// A tooltip whose trigger was just clicked (a toolbar toggle re-rendering
// from inside its own click handler) can still be mid-hide-transition when
// dispose() runs — Bootstrap's internal _isWithActiveTrigger throws on a
// transition callback firing after dispose() nulls out `_activeTrigger`
// (confirmed console error, no public API to await/cancel it first).
// try/catch makes this best-effort teardown safe against that timing race.
function safeDispose(instance) {
  try {
    instance?.dispose();
  } catch (error) {
    // Best-effort — the popup element is torn down with its trigger by the
    // caller's own innerHTML replacement regardless.
  }
}

function hasBootstrapTooltip() {
  return Boolean(window.bootstrap && typeof window.bootstrap.Tooltip === "function");
}

// --- Root-scoped sweep pair — a whole container's worth of triggers ---

export function disposeTooltips(root = document) {
  if (!hasBootstrapTooltip()) return;
  root.querySelectorAll('[data-bs-toggle="tooltip"]').forEach((element) => {
    safeDispose(window.bootstrap.Tooltip.getInstance(element));
  });
}

export function refreshTooltips(root = document) {
  if (!hasBootstrapTooltip()) return;
  root.querySelectorAll('[data-bs-toggle="tooltip"]').forEach((element) => {
    safeDispose(window.bootstrap.Tooltip.getInstance(element));
    // eslint-disable-next-line no-new
    new window.bootstrap.Tooltip(element);
  });
}

// --- Single-element pair — one specific trigger, zero collateral scope ---
// Prefer over the root-scoped pair whenever you have a direct reference to
// one element — passing an ancestor as `root` also disposes/recreates every
// OTHER tooltip inside it, risking an unrelated open tooltip (BUG CLASS 2).

export function disposeTooltip(element) {
  if (!element || !hasBootstrapTooltip()) return;
  safeDispose(window.bootstrap.Tooltip.getInstance(element));
}

export function refreshTooltip(element) {
  if (!element || !hasBootstrapTooltip()) return;
  disposeTooltip(element);
  // eslint-disable-next-line no-new
  new window.bootstrap.Tooltip(element);
}

// --- One-shot declarative setup ---
// Sets the data-bs-toggle/data-bs-title(/data-bs-placement/data-bs-html)
// attributes AND instantiates the tooltip immediately, in one call. Use for
// a single element built or updated in isolation. Passing a falsy `title`
// removes the tooltip entirely (disposes first, then strips the
// attributes) — the correct way to turn a tooltip OFF, not just leaving a
// stale data-bs-title sitting on an element nothing points at anymore.
export function initTooltip(element, { title, placement, html = false } = {}) {
  if (!element) return;
  if (!title) {
    disposeTooltip(element);
    element.removeAttribute("data-bs-toggle");
    element.removeAttribute("data-bs-title");
    element.removeAttribute("data-bs-html");
    element.removeAttribute("data-bs-placement");
    return;
  }
  element.setAttribute("data-bs-toggle", "tooltip");
  element.setAttribute("data-bs-title", title);
  if (placement) element.setAttribute("data-bs-placement", placement);
  if (html) element.setAttribute("data-bs-html", "true");
  refreshTooltip(element);
}

// --- Live content update, no dispose/recreate ---
// For text that changes frequently (a live byte count) where dispose+
// recreate would cause visible flicker. Safe before any tooltip exists yet
// — getOrCreateInstance makes one on first call. Always also sets
// data-bs-toggle/data-bs-title (not just content) — without it, a LATER
// root-scoped disposeTooltips/refreshTooltips sweep from an unrelated
// re-render can't find this element's instance to dispose it.
export function updateTooltipContent(element, title) {
  if (!element || !title) return;
  element.setAttribute("data-bs-toggle", "tooltip");
  element.setAttribute("data-bs-title", title);
  if (!hasBootstrapTooltip()) return;
  window.bootstrap.Tooltip.getOrCreateInstance(element).setContent?.({ ".tooltip-inner": title });
}

// --- Temporary confirmation flash ---
// Swaps data-bs-title/title/aria-label to `message`, forces the tooltip to
// show immediately, then reverts to the resting title — captured fresh at
// the START of this call since the resting title can itself be live (e.g. a
// byte count). A second call before the first timer fires restarts it
// rather than stacking two reverts.
export function flashTooltipMessage(element, message, { duration = 1500 } = {}) {
  if (!element || !message) return;
  const restoreTitle = element.getAttribute("data-bs-title") || element.getAttribute("title") || "";
  const apply = (text) => {
    element.setAttribute("data-bs-title", text);
    element.setAttribute("title", text);
    element.setAttribute("aria-label", text);
    if (hasBootstrapTooltip()) {
      window.bootstrap.Tooltip.getOrCreateInstance(element).setContent?.({ ".tooltip-inner": text });
    }
  };
  apply(message);
  if (hasBootstrapTooltip()) {
    window.bootstrap.Tooltip.getOrCreateInstance(element).show?.();
  }
  if (element._tooltipFlashTimer) window.clearTimeout(element._tooltipFlashTimer);
  element._tooltipFlashTimer = window.setTimeout(() => {
    delete element._tooltipFlashTimer;
    apply(restoreTitle);
  }, duration);
}

// --- THE canonical disabled-but-hoverable control ---
// See BUG CLASS 1 — `control` keeps a REAL `disabled` attribute while a
// separate, never-disabled wrapper carries the tooltip trigger instead.
//
// `reason` — falsy marks `control` ready (enabled, wrapper's tooltip
// removed); a non-empty string marks it blocked (disabled, wrapper shows it).
//
// `wrapper` (optional) — pass an element already sitting in static HTML
// around `control` to use as-is; omit to lazily create-and-reuse a
// `<span class="d-inline-block">`. The auto-created wrapper only exists in
// the DOM while `reason` is truthy, so a re-enabled control doesn't gain a
// second permanent tab stop and toggling doesn't accumulate wrapper
// elements. A caller-provided wrapper is never removed — only its tooltip
// attributes toggle.
export function setDisabledTooltip(control, reason, { wrapper: providedWrapper } = {}) {
  if (!control) return;
  const autoWrap = !providedWrapper;
  const existingAutoWrap = autoWrap && control.parentElement?.dataset?.tooltipDisabledWrap === "true" ? control.parentElement : null;
  const existingWrap = providedWrapper || existingAutoWrap;

  if (!reason) {
    control.disabled = false;
    if (existingWrap) {
      // Dispose BEFORE removing/clearing the wrap's tooltip, never after —
      // see BUG CLASS 2 at the top of this file.
      disposeTooltip(existingWrap);
      if (autoWrap) {
        existingWrap.parentElement?.insertBefore(control, existingWrap);
        existingWrap.remove();
      } else {
        existingWrap.removeAttribute("data-bs-toggle");
        existingWrap.removeAttribute("data-bs-title");
      }
    }
    return;
  }

  let wrap = existingWrap;
  if (autoWrap && !wrap) {
    wrap = document.createElement("span");
    wrap.className = "d-inline-block";
    wrap.tabIndex = 0;
    wrap.dataset.tooltipDisabledWrap = "true";
    control.parentElement?.insertBefore(wrap, control);
    wrap.appendChild(control);
  }
  // Dispose BEFORE mutating data-bs-title/toggling disabled, never after —
  // see BUG CLASS 2 at the top of this file.
  disposeTooltip(wrap);
  control.disabled = true;
  wrap.setAttribute("data-bs-toggle", "tooltip");
  wrap.setAttribute("data-bs-title", reason);
  refreshTooltip(wrap);
}
