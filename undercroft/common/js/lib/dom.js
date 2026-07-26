// Tiny, generic DOM helpers shared across widgets/pages. Extracted from
// several byte-identical copies (el() in character-summary.js,
// combat-tracker.js, game-log.js, now-showing.js, dashboard.js;
// disableForm() in account.js, auth-ui.js, share-modal.js) — see
// common/docs/code-audit.md.

export function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

export function disableForm(form, disabled) {
  if (!form) return;
  Array.from(form.elements).forEach((element) => {
    if (typeof element.disabled !== "undefined") {
      element.disabled = disabled;
    }
  });
}
