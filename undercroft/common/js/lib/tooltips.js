// Bootstrap renders a tooltip's actual popup as a sibling appended to
// <body> (via Popper), not inside the trigger element — abruptly wiping out
// a trigger (e.g. innerHTML = "" on an ancestor, as any re-rendering widget
// does) without disposing its Tooltip instance first leaves that popup
// orphaned on <body> forever, since Bootstrap's own cleanup path never runs
// for it. Call this on a container's current content right before replacing
// it, not just refreshTooltips() on the new content afterward.
// A tooltip whose trigger was just clicked (this codebase's own toolbar
// toggle buttons, e.g. Orrery's "hidden from players" and combat-tracker.js's
// visibility switches, re-render — and so dispose/recreate their own
// tooltips — from inside their own click handler) can still be mid-hide-
// transition when dispose() runs here: Bootstrap's own internal
// _isWithActiveTrigger reads `this._activeTrigger` via Object.values(),
// which a transition callback firing after dispose() has already nulled out
// throws on (confirmed real console error: "Cannot convert undefined or
// null to object" at tooltip.js's own _isWithActiveTrigger). Bootstrap's
// public API gives no way to await/cancel that in-flight transition first —
// try/catch is the only way to make a best-effort teardown call safe
// against a timing race entirely inside a UI library nothing here controls,
// same "don't let this crash the render for a purely cosmetic cleanup step"
// reasoning as the no-raw-server-errors-in-toasts convention elsewhere.
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

export function disposeTooltips(root = document) {
  if (!window.bootstrap || typeof window.bootstrap.Tooltip !== "function") return;
  root.querySelectorAll('[data-bs-toggle="tooltip"]').forEach((element) => {
    safeDispose(window.bootstrap.Tooltip.getInstance(element));
  });
}

export function refreshTooltips(root = document) {
  if (!window.bootstrap || typeof window.bootstrap.Tooltip !== "function") return;
  const tooltipTriggers = root.querySelectorAll('[data-bs-toggle="tooltip"]');
  tooltipTriggers.forEach((element) => {
    safeDispose(window.bootstrap.Tooltip.getInstance(element));
    // eslint-disable-next-line no-new
    new window.bootstrap.Tooltip(element);
  });
}
