// Tiny, generic DOM helpers shared across widgets/pages.

export function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
}

// Parses untrusted markup into an inert document (no images load, no handlers run) and returns its body.
export function parseHtmlBody(html) {
  const body = new DOMParser().parseFromString(String(html ?? ""), "text/html").body;
  body.querySelectorAll("script, style").forEach((node) => node.remove());
  return body;
}

// Sets markup that may be user- or imported-authored: sanitized when DOMPurify is loaded, plain text otherwise.
export function setSanitizedHtml(element, html) {
  if (window.DOMPurify) element.innerHTML = window.DOMPurify.sanitize(String(html ?? ""));
  else element.textContent = String(html ?? "");
}

export function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

// Plain `element.hidden = value` silently does nothing on an element that
// also carries an author-origin CSS `display` rule (e.g. Bootstrap's
// `!important` `.d-flex`) — origin+importance beats specificity in the
// cascade, so the UA `[hidden]` rule always loses. Setting `display` inline
// with `!important` is the one thing guaranteed to win either way.
export function setElementVisible(element, visible, displayValue = "flex") {
  if (!element) return;
  element.style.setProperty("display", visible ? displayValue : "none", "important");
}

// Suite-wide "this is required and currently unset" marker — toggles
// Bootstrap's own `.border-danger` utility class. `isSatisfied` is whatever
// the caller already knows counts as "filled in"; this just applies/removes
// the marker, with no opinion on what "satisfied" means.
export function markRequiredControl(element, isSatisfied) {
  if (!element) return;
  element.classList.toggle("border-danger", !isSatisfied);
}

export function disableForm(form, disabled) {
  if (!form) return;
  Array.from(form.elements).forEach((element) => {
    if (typeof element.disabled !== "undefined") {
      element.disabled = disabled;
    }
  });
}
