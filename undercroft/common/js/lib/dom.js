// Tiny, generic DOM helpers shared across widgets/pages.

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

// Mouseover-opens/closes a Bootstrap dropdown — shared by the tool switcher
// (app-shell.js) and the account/campaign menu (auth-ui.js). Resolves the
// Bootstrap Dropdown instance INSIDE each handler rather than once up front:
// every page's module script runs before Bootstrap's own deferred CDN
// <script>, so resolving early loses that race and leaves the menu click-only.
export function attachHoverDropdown(dropdown, toggle, { hideDelay = 200 } = {}) {
  if (!dropdown || !toggle) return;
  let hideTimer = null;
  const cancelHide = () => {
    if (hideTimer !== null) {
      window.clearTimeout(hideTimer);
      hideTimer = null;
    }
  };
  const getInstance = () =>
    window.bootstrap && typeof window.bootstrap.Dropdown === "function"
      ? window.bootstrap.Dropdown.getOrCreateInstance(toggle)
      : null;
  const showMenu = () => {
    cancelHide();
    getInstance()?.show();
  };
  const hideMenu = () => {
    getInstance()?.hide();
    // Bootstrap's hide() only clears the menu's own open state, never blurs
    // the toggle — a mouse-driven close otherwise leaves the trigger's own
    // :focus-visible ring stuck highlighted.
    if (document.activeElement === toggle) toggle.blur();
  };
  // Trigger and menu have a small visual gap; crossing it briefly leaves the
  // pointer over neither. Delaying the hide (canceled on re-entry) gives that
  // crossing room.
  const scheduleHide = () => {
    cancelHide();
    hideTimer = window.setTimeout(() => {
      hideTimer = null;
      hideMenu();
    }, hideDelay);
  };
  dropdown.addEventListener("mouseenter", showMenu);
  dropdown.addEventListener("mouseleave", scheduleHide);
  toggle.addEventListener("focus", showMenu);
  dropdown.addEventListener("focusout", (event) => {
    if (!dropdown.contains(event.relatedTarget)) {
      cancelHide();
      hideMenu();
    }
  });
  // Force-closed (bypassing the hide delay) when the tab loses focus or is
  // torn down: bfcache restores the exact DOM state at navigate-away, so an
  // unfired scheduleHide() timeout at that instant would otherwise reappear
  // as a menu stuck open on return.
  const forceClose = () => {
    cancelHide();
    hideMenu();
  };
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) forceClose();
  });
  window.addEventListener("pagehide", forceClose);
}
