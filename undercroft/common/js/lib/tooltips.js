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
// BUG CLASS 3 — "tooltip stays after the pointer leaves, with no way to clear
// it": (a) Bootstrap's default trigger is "hover focus", so a button you
// CLICKED keeps focus and its tooltip survives the mouse leaving; (b) a
// trigger removed, hidden, or re-rendered while its tooltip is up (a list
// refreshing on a poll, a modal closing, a pane collapsing) strands the
// <body>-level popup with nothing left to dismiss it. Per-call-site discipline
// can't cover every render path, so installTooltipAutoInit installs a
// page-wide guarantee instead: pointer-driven tooltips hide when the pointer
// leaves or presses their trigger, removed triggers are disposed, and a sweep
// removes any popup whose trigger is gone or no longer visible.
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
// - A plain button carrying data-bs-toggle/data-bs-title needs nothing more:
//   installTooltipAutoInit (see below) creates a missing instance on first
//   hover and shows a disabled control's tooltip too.
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
    // One bad trigger must not abort the sweep — every later trigger in the
    // container would silently never get its tooltip.
    try {
      safeDispose(window.bootstrap.Tooltip.getInstance(element));
      // eslint-disable-next-line no-new
      new window.bootstrap.Tooltip(element);
    } catch (error) {
      console.warn("tooltips: unable to initialise a tooltip", element, error);
    }
  });
}

// Safety net, installed once per page by initAppShell, for two cases no
// per-call-site discipline can fully cover:
// (1) a trigger with no tooltip instance (a render path that forgot its
//     refreshTooltips, or an instance that got lost) — the first hover/focus
//     builds and shows it, since the mouseenter that would normally do so has
//     already fired by then.
// (2) a natively `disabled` control (Save/Delete before a record exists, a
//     stepper at its limit). Bootstrap's .btn:disabled is pointer-events:none,
//     so the control never sees the hover (BUG CLASS 1) — and its `disabled`
//     flips long after build time, so wrapping it up front can't keep up.
//     Instead the pointer is hit-tested against every disabled trigger and
//     its tooltip is shown/hidden manually. No DOM is moved, so callers
//     holding the control as an insertBefore reference or toggling its
//     d-none class are unaffected.
let autoInitInstalled = false;
export function installTooltipAutoInit() {
  if (autoInitInstalled) return;
  autoInitInstalled = true;

  const ensure = (event) => {
    if (!hasBootstrapTooltip() || !(event.target instanceof Element)) return;
    const trigger = event.target.closest('[data-bs-toggle="tooltip"]');
    if (!trigger || window.bootstrap.Tooltip.getInstance(trigger)) return;
    try {
      window.bootstrap.Tooltip.getOrCreateInstance(trigger).show();
    } catch (error) {
      console.warn("tooltips: unable to initialise a tooltip", trigger, error);
    }
  };
  document.addEventListener("pointerover", ensure, true);
  document.addEventListener("focusin", ensure, true);

  let hoveredDisabled = null;
  let lastPoint = null;
  let frameQueued = false;

  const setHoveredDisabled = (next) => {
    if (next === hoveredDisabled) return;
    if (hoveredDisabled) {
      try {
        window.bootstrap.Tooltip.getInstance(hoveredDisabled)?.hide();
      } catch (error) {
        // Best-effort — same timing race safeDispose guards against.
      }
    }
    hoveredDisabled = next;
    if (!next) return;
    try {
      window.bootstrap.Tooltip.getOrCreateInstance(next).show();
    } catch (error) {
      console.warn("tooltips: unable to show a disabled control's tooltip", next, error);
    }
  };

  const syncDisabledHover = () => {
    frameQueued = false;
    if (!hasBootstrapTooltip() || !lastPoint) return;
    const { x, y } = lastPoint;
    // elementFromPoint skips pointer-events:none, so it lands on whatever is
    // beneath the disabled control — which must still be inside the control's
    // own parent, otherwise a modal/popover is covering that spot.
    const top = document.elementFromPoint(x, y);
    let hit = null;
    if (top) {
      hit =
        Array.from(document.querySelectorAll('[data-bs-toggle="tooltip"]:disabled')).find((control) => {
          const rect = control.getBoundingClientRect();
          return (
            rect.width > 0 &&
            rect.height > 0 &&
            x >= rect.left &&
            x <= rect.right &&
            y >= rect.top &&
            y <= rect.bottom &&
            control.parentElement?.contains(top) &&
            // Already shown by a setDisabledTooltip/provided wrapper above it.
            !control.parentElement.closest('[data-bs-toggle="tooltip"]')
          );
        }) || null;
    }
    if (hoveredDisabled && !hoveredDisabled.isConnected) hoveredDisabled = null;
    setHoveredDisabled(hit);
  };

  document.addEventListener(
    "pointermove",
    (event) => {
      lastPoint = { x: event.clientX, y: event.clientY };
      if (frameQueued) return;
      frameQueued = true;
      window.requestAnimationFrame(syncDisabledHover);
    },
    { passive: true }
  );
  // The pointer leaving the window sends no further pointermove to clear it.
  document.documentElement.addEventListener("mouseleave", () => setHoveredDisabled(null));

  installOrphanGuards();
}

// --- Orphan prevention (BUG CLASS 3) ---

const TOOLTIP_TRIGGER = '[data-bs-toggle="tooltip"]';

function hideTooltipNow(trigger) {
  try {
    window.bootstrap.Tooltip.getInstance(trigger)?.hide();
  } catch (error) {
    // Best-effort — same timing race safeDispose guards against.
  }
}

// Removes any tooltip popup whose trigger is gone, detached, or no longer laid
// out. Bootstrap links popup and trigger through aria-describedby, which is
// what makes "whose trigger?" answerable from the popup alone.
function sweepOrphanTooltips() {
  document.querySelectorAll("body > .tooltip").forEach((tip) => {
    const trigger = tip.id ? document.querySelector(`[aria-describedby~="${CSS.escape(tip.id)}"]`) : null;
    if (trigger && trigger.isConnected && trigger.getClientRects().length > 0) return;
    if (trigger) hideTooltipNow(trigger);
    tip.remove();
  });
}

function installOrphanGuards() {
  // (a) A pointer leaving a trigger, or pressing it, ends its tooltip even if
  // the click left it focused. Keyboard focus (:focus-visible) keeps its
  // tooltip until blur, as intended.
  const hideForPointer = (event) => {
    if (!hasBootstrapTooltip() || !(event.target instanceof Element)) return;
    const trigger = event.target.closest(TOOLTIP_TRIGGER);
    if (!trigger) return;
    if (event.type === "pointerout" && event.relatedTarget instanceof Node && trigger.contains(event.relatedTarget)) return;
    if (event.type === "pointerout" && trigger.matches(":focus-visible")) return;
    hideTooltipNow(trigger);
  };
  document.addEventListener("pointerout", hideForPointer, true);
  document.addEventListener("pointerdown", hideForPointer, true);

  // (b) Triggers removed from the page: dispose their instances (which also
  // removes the popup), then sweep for anything dispose couldn't reach. A node
  // that was only moved is still connected and keeps its tooltip.
  let sweepQueued = false;
  const queueSweep = () => {
    if (sweepQueued) return;
    sweepQueued = true;
    window.requestAnimationFrame(() => {
      sweepQueued = false;
      sweepOrphanTooltips();
    });
  };
  new MutationObserver((records) => {
    if (!hasBootstrapTooltip()) return;
    let removed = false;
    records.forEach((record) => {
      record.removedNodes.forEach((node) => {
        if (!(node instanceof Element) || node.isConnected) return;
        removed = true;
        if (node.matches(TOOLTIP_TRIGGER)) safeDispose(window.bootstrap.Tooltip.getInstance(node));
        node.querySelectorAll(TOOLTIP_TRIGGER).forEach((element) => safeDispose(window.bootstrap.Tooltip.getInstance(element)));
      });
    });
    if (removed) queueSweep();
  }).observe(document.documentElement, { childList: true, subtree: true });

  // (c) Triggers hidden rather than removed (display:none, a collapsed pane)
  // fire no mutation we can cheaply watch; a slow sweep plus the events that
  // usually precede such changes covers them.
  window.setInterval(sweepOrphanTooltips, 1000);
  ["scroll", "keydown", "click"].forEach((type) => document.addEventListener(type, queueSweep, { capture: true, passive: true }));
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
