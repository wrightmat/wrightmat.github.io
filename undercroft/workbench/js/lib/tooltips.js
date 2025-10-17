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
