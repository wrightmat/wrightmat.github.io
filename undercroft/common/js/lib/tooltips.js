// =============================================================================
// CANONICAL TOOLTIP SYSTEM — the ONE module every Bootstrap tooltip in this
// suite goes through. No file anywhere else may call `new bootstrap.Tooltip`,
// `bootstrap.Tooltip.getInstance`, or `bootstrap.Tooltip.getOrCreateInstance`
// directly — always call one of the functions exported here instead, even
// when the need seems trivial or one-off. This was a hard suite-wide rule
// established 2026-08-30 after the same two bug classes below were
// independently reintroduced at least 6 times across the codebase (shop.js,
// generator-kit.js, orrery.js, combat-tracker.js, spotlight-panel.js,
// workbench-character-view.js, both Workbench canvases, clipboard.js,
// press.js — see the audit that produced this module for the full list).
//
// -----------------------------------------------------------------------
// The two bug classes every function here exists to prevent
// -----------------------------------------------------------------------
//
// BUG CLASS 1 — "the tooltip never shows" (disabled blocks hover)
// A native `disabled` attribute — and, just as much, a CSS class meant to
// visually approximate one via `pointer-events: none` — blocks ALL pointer
// events on that element per the HTML/CSS spec, not just clicks. That
// includes the mouseenter/mouseleave/focus/blur events Bootstrap's Tooltip
// needs to ever show at all. Putting a tooltip trigger on the SAME element
// you're disabling silently never works, regardless of how correct the
// data-bs-toggle/data-bs-title attributes look. This is confirmed real, not
// a guess — Bootstrap's own docs call it out and recommend the fix used
// here: keep the control genuinely `disabled`, and put the tooltip trigger
// on a separate, never-disabled wrapper around it. See setDisabledTooltip
// below — this is the ONE place that pattern is allowed to exist.
//
// BUG CLASS 2 — "the tooltip lingers after hover exits" (dispose-after-mutate)
// Bootstrap renders a tooltip's actual popup as a sibling appended to
// <body> (via Popper), not inside the trigger element. Two ways this leaves
// a popup orphaned, still visible, with nothing left to hide it:
//   (a) Wiping out a trigger's container (innerHTML = "", a full re-render)
//       WITHOUT disposing every tooltip inside it first. The old popup(s)
//       never get torn down; only the fresh content's own tooltips (if any)
//       get created going forward. ALWAYS call disposeTooltips(container)
//       (or disposeTooltip(element) for one specific element) immediately
//       BEFORE the wipe/removal — not refreshTooltips() after, which only
//       re-arms whatever's still present, not what's already gone.
//   (b) Removing/changing a trigger's data-bs-toggle/data-bs-title AFTER
//       disposing is fine; doing it BEFORE disposing is not — disposal only
//       ever finds elements that still carry data-bs-toggle="tooltip"
//       (root-scoped sweeps query for that attribute; single-element calls
//       still need the instance to exist). Mutate/remove the attribute
//       first and the disposal call that would have cleaned it up finds
//       nothing to clean up. Always: dispose → then mutate/remove.
//
// -----------------------------------------------------------------------
// Which function to use
// -----------------------------------------------------------------------
// - Building ONE element and want its tooltip live right now?
//     initTooltip(element, { title, placement?, html? })
// - Building MANY elements in a loop, then done?
//     Set data-bs-toggle="tooltip" / data-bs-title on each yourself (or via
//     initTooltip with no immediate need — either is fine), then call
//     refreshTooltips(containerYouJustBuilt) ONCE after the loop. Cheaper
//     than instantiating one at a time.
// - About to wipe/replace a container's content (innerHTML = "", a
//   re-render, hiding then rebuilding)?
//     disposeTooltips(container) — BEFORE the wipe. Then, once the new
//     content exists, refreshTooltips(container) to arm it.
// - Own exactly ONE element directly and don't want to risk touching any
//   sibling tooltip that happens to be open?
//     disposeTooltip(element) / refreshTooltip(element) — single-element,
//     zero collateral scope. Prefer this over the root-scoped pair whenever
//     you're not actually sweeping a whole container.
// - Need to disable a control but still show an explanatory tooltip on
//   hover (a Generate button with insufficient data, a toggle that's
//   temporarily unavailable, ...)?
//     setDisabledTooltip(control, reason, { wrapper? }) — THE canonical
//     disabled-but-hoverable pattern. Never hand-build this yourself.
// - Need to live-update an EXISTING tooltip's displayed text frequently
//   (a byte count, a live preview value, a computed label) without the
//   visible flicker a dispose+recreate cycle causes?
//     updateTooltipContent(element, title)
// - Need a temporary confirmation flash ("Copied!", "Saved!", ...) that
//   reverts back to the resting tooltip text after a moment?
//     flashTooltipMessage(element, message, { duration? })
//
// -----------------------------------------------------------------------
// Deliberately out of scope
// -----------------------------------------------------------------------
// - `common/js/lib/help.js`'s data-help-topic trigger system is NOT a
//   separate implementation — it sets the same data-bs-toggle="tooltip"
//   declaratively and calls refreshTooltips(root) from this module at the
//   end of initHelpSystem(). Already fully in scope, nothing to change.
// - `common/js/lib/library-reference.js`'s hover preview is NOT a Bootstrap
//   tooltip at all — it's a fully custom, hand-positioned `pointer-events:
//   none` popup div with its own show/hide/positioning logic, serving a
//   genuinely different purpose (a rich content preview, not a short
//   text label). Not migrated here; a different system on purpose.
// - `common/js/lib/property-schema-editor.js` takes refreshTooltips as an
//   injected `ctx` callback rather than importing this module directly, by
//   deliberate design (the module stays host-app-agnostic). The one real
//   caller (loom/js/app.js) supplies the genuine function from here, so
//   this still funnels through the same single implementation — the
//   injection is a wiring detail, not a duplicate.

// Bootstrap renders a tooltip's actual popup as a sibling appended to
// <body> (via Popper) — see BUG CLASS 2 above for why disposal ordering
// matters. A tooltip whose trigger was just clicked (this codebase's own
// toolbar toggle buttons, e.g. Orrery's "hidden from players" and
// combat-tracker.js's visibility switches, re-render — and so
// dispose/recreate their own tooltips — from inside their own click
// handler) can still be mid-hide-transition when dispose() runs here:
// Bootstrap's own internal _isWithActiveTrigger reads `this._activeTrigger`
// via Object.values(), which a transition callback firing after dispose()
// has already nulled out throws on (confirmed real console error: "Cannot
// convert undefined or null to object" at tooltip.js's own
// _isWithActiveTrigger). Bootstrap's public API gives no way to
// await/cancel that in-flight transition first — try/catch is the only way
// to make a best-effort teardown call safe against a timing race entirely
// inside a UI library nothing here controls, same "don't let this crash
// the render for a purely cosmetic cleanup step" reasoning as the
// no-raw-server-errors-in-toasts convention elsewhere.
function safeDispose(instance) {
  try {
    instance?.dispose();
  } catch (error) {
    // Best-effort — the tooltip's own popup element still gets torn down
    // along with its trigger by the caller's own innerHTML replacement
    // either way; this only ever fails on Bootstrap's own internal
    // bookkeeping, never in a way that leaves something visibly orphaned.
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
// Prefer these over the root-scoped pair above whenever you already have a
// direct reference to the one element you care about — using the
// root-scoped versions for a single element means passing some ancestor as
// `root`, which also disposes/recreates every OTHER tooltip inside that
// ancestor: real risk of tearing down (and not reliably rebuilding, per BUG
// CLASS 2) an unrelated tooltip that happens to be open at that moment.

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
// For a tooltip whose text changes frequently (a live byte count, a
// computed preview value, ...) where a dispose+recreate cycle on every
// change would cause visible flicker (and briefly hide an open tooltip).
// Safe to call before any tooltip has been created yet for this element —
// getOrCreateInstance makes one on first call. Always also sets
// data-bs-toggle="tooltip"/data-bs-title (not just content) — getOrCreate
// works without the attribute (Bootstrap's JS API doesn't need it), but a
// LATER root-scoped disposeTooltips(ancestor)/refreshTooltips(ancestor)
// sweep from some unrelated re-render only ever finds elements THAT carry
// it; without it, this element's instance would be invisible to that sweep
// — never disposed, a stale duplicate risk if something else later tries
// to create a fresh one on the same element.
export function updateTooltipContent(element, title) {
  if (!element || !title) return;
  element.setAttribute("data-bs-toggle", "tooltip");
  element.setAttribute("data-bs-title", title);
  if (!hasBootstrapTooltip()) return;
  window.bootstrap.Tooltip.getOrCreateInstance(element).setContent?.({ ".tooltip-inner": title });
}

// --- Temporary confirmation flash ---
// Swaps data-bs-title/title/aria-label to `message`, forces the tooltip to
// show immediately (this is feedback for an action just taken, not
// something waiting on the next hover), then reverts to whatever the
// resting title actually was — captured fresh at the START of this call,
// before it gets overwritten, not a value cached once at bind time, since
// the resting title can itself be live (e.g. a byte count that changes
// while the flash is showing). A second call before the first one's timer
// fires (rapid double-click) cancels and restarts the timer rather than
// stacking two reverts.
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
// See BUG CLASS 1 at the top of this file for why a tooltip can never live
// on the same element you're disabling. The fix: `control` keeps a REAL
// `disabled` attribute (correct, fully-inert semantics — no click, no
// keyboard activation, no focus) while a separate, never-disabled wrapper
// around it carries the tooltip trigger instead. The wrapper still
// receives hover/focus even though the disabled control inside it doesn't.
//
// `reason` — falsy marks `control` ready (enabled; wrapper's tooltip
// removed). A non-empty string marks it blocked (disabled; wrapper's
// tooltip shows that string).
//
// `wrapper` (optional) — pass an element that's ALREADY sitting in static
// HTML around `control` (e.g. a `<span data-draw-toggle-wrap>` authored
// directly in a tool's own index.html) to use it as-is instead of building
// one. Omit it to lazily create-and-reuse a `<span class="d-inline-block">`
// automatically. The auto-created wrapper only ever exists in the DOM
// while `reason` is truthy — `control` gets moved back out and the wrapper
// removed the moment it isn't — so a control that's never actually
// disabled never gains a second, permanently-focusable tab stop sitting on
// top of it once re-enabled, and one that toggles disabled/enabled
// repeatedly doesn't accumulate garbage wrapper elements either. A
// caller-provided wrapper is never removed/unwrapped (it's not this
// function's to delete) — only its tooltip attributes get toggled.
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
