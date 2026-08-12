// Tiny, generic DOM helpers shared across widgets/pages. Extracted from
// several byte-identical copies (el() in character-summary.js,
// combat-tracker.js, game-log.js, now-showing.js, dashboard.js;
// disableForm() in account.js, auth-ui.js, share-modal.js) — see
// undercroft/README.md's Code Conventions section.

export function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

// Plain `element.hidden = value` silently does nothing on an element that
// also carries an explicit CSS `display` (Bootstrap's `.d-flex` — declared
// `!important` — or even a plain, non-important custom class like
// `.dice-quick-grid`'s own `display: grid`): the `[hidden]` UA-stylesheet
// rule always loses to an author-origin rule regardless of specificity or
// `!important` (origin+importance is resolved before specificity in the
// cascade), so the element never actually collapses. Setting `display`
// inline with `!important` is the one thing guaranteed to win over both
// cases — same bug/fix as press/js/app.js's own local `setElementVisible`
// and loom/js/app.js's inline equivalent, promoted here now that a third
// and fourth caller need the identical fix (dice-roller.js,
// workbench-character-view.js) rather than growing a fifth copy.
export function setElementVisible(element, visible, displayValue = "flex") {
  if (!element) return;
  element.style.setProperty("display", visible ? displayValue : "none", "important");
}

// Suite-wide "this is required and currently unset" marker — toggles
// Bootstrap's own `.border-danger` utility class (already loaded everywhere,
// no new CSS needed) rather than a bespoke class. `isSatisfied` is whatever
// the caller already knows counts as "filled in" for that control (a select
// with a real, non-placeholder value; a checked checkbox; etc.) — this just
// applies/removes the marker, it has no opinion on what "satisfied" means.
// The suite's first pass at visually marking required fields at all — see
// Sanctum/Crucible/Forge/Vault's own System (and, where relevant, Setting)
// selects for the first call sites.
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
// (app-shell.js) and the account/campaign menu (auth-ui.js) so both are
// guaranteed to behave identically instead of each carrying its own
// near-identical copy that could quietly drift apart (which is exactly what
// happened before this was factored out: the tool switcher's copy gated
// attaching its hover listeners on `window.bootstrap` already existing at
// setup time, and every page's own module script runs BEFORE Bootstrap's
// own deferred, CDN-loaded <script> tag on purpose — see app-shell.js's own
// script-order comment — so that check lost the race more often than not,
// silently leaving that page's nav panel as click-only for the rest of the
// session). Resolving the Bootstrap Dropdown instance INSIDE each handler,
// not once up front, means a real user mouse/focus event — which can only
// happen well after Bootstrap has had time to load — always finds it ready,
// regardless of which script happened to finish loading first.
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
    // Bootstrap's own hide() only clears the MENU's own open state (the
    // .show class/aria-expanded) — it never blurs the toggle itself, so a
    // mouse-driven close (as opposed to a real click or Escape, both of
    // which already move focus/blur naturally) left the trigger's own
    // :focus/:focus-visible ring visibly "stuck" highlighted after the menu
    // had actually already closed. Confirmed real bug this fixes — every
    // CSS rule keying off :focus/:focus-visible for this trigger (see
    // shell.css's own .undercroft-tool-trigger) has no other way to know
    // the interaction is over.
    if (document.activeElement === toggle) toggle.blur();
  };
  // The trigger and menu are separate boxes with a small visual gap between
  // them — crossing it briefly leaves the pointer over neither, which would
  // otherwise close the menu before it reaches the cards. Delaying the hide
  // (and canceling it on re-entry) gives that crossing room without needing
  // the menu to visually touch the trigger.
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
  // Force-closed (bypassing the hide delay entirely) whenever this tab stops
  // being the one the user is looking at, or is about to be torn down —
  // confirmed real bug this fixes: a page restored from the browser's
  // back-forward cache resumes from whatever DOM state it was ACTUALLY in
  // at the exact instant of navigating away, not a fresh reload. If the
  // pending scheduleHide() timeout above simply hadn't fired yet at that
  // instant (switching tabs/navigating away is exactly the kind of abrupt
  // exit that cuts a mouseleave→200ms-later sequence short), the menu was
  // still genuinely open in the snapshot bfcache preserved — reopening
  // "for no reason" on return was that same still-open state finally
  // becoming visible again, not a fresh bug on return.
  const forceClose = () => {
    cancelHide();
    hideMenu();
  };
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) forceClose();
  });
  window.addEventListener("pagehide", forceClose);
}
