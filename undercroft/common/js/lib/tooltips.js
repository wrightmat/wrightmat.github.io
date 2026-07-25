// Bootstrap renders a tooltip's actual popup as a sibling appended to
// <body> (via Popper), not inside the trigger element — abruptly wiping out
// a trigger (e.g. innerHTML = "" on an ancestor, as any re-rendering widget
// does) without disposing its Tooltip instance first leaves that popup
// orphaned on <body> forever, since Bootstrap's own cleanup path never runs
// for it. Call this on a container's current content right before replacing
// it, not just refreshTooltips() on the new content afterward.
export function disposeTooltips(root = document) {
  if (!window.bootstrap || typeof window.bootstrap.Tooltip !== "function") return;
  root.querySelectorAll('[data-bs-toggle="tooltip"]').forEach((element) => {
    window.bootstrap.Tooltip.getInstance(element)?.dispose();
  });
}

export function refreshTooltips(root = document) {
  if (!window.bootstrap || typeof window.bootstrap.Tooltip !== "function") return;
  const tooltipTriggers = root.querySelectorAll('[data-bs-toggle="tooltip"]');
  tooltipTriggers.forEach((element) => {
    const existing = window.bootstrap.Tooltip.getInstance(element);
    if (existing) {
      existing.dispose();
    }
    // eslint-disable-next-line no-new
    new window.bootstrap.Tooltip(element);
  });
}
