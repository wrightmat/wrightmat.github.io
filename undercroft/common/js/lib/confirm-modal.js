// A Bootstrap-modal-based confirm() replacement — same "resolve true once
// confirmed, false otherwise" contract as window.confirm(), but with a real
// title, a rich HTML body (a bulleted diff list, a warning icon, whatever a
// caller needs — not plain text mangled through \n line breaks), and
// suite-consistent button styling instead of the browser's own unstyled,
// unstyleable native dialog. ownership.js's own confirmDelete() intentionally
// stays on window.confirm() for its one narrow, suite-wide-consistent use —
// this is for callers that need to show the user something richer than a
// yes/no sentence can carry (see workbench-character-view.js's own
// reimportCurrentCharacter for the case this was built for).
//
// Built and torn down fresh per call (appended to document.body, removed
// once resolved) rather than a static per-page element some HTML file has
// to pre-declare — any page can call this with zero markup of its own.
// `extraLabel` (optional) adds a THIRD footer button, between Cancel and
// Confirm, for a caller with a genuine three-way choice (e.g. "Sell
// one"/"Sell all"/"Cancel" — see the Shop widget's own Sell confirm). Its
// own click resolves the promise with the literal string `"extra"` — NOT
// `true` — so an existing caller that never passes `extraLabel` (the
// button then never renders at all) keeps its exact original two-way
// `true`/`false` contract unchanged; only a caller that explicitly opts in
// needs to check for the third value at all.
export function showConfirmModal({
  title = "Are you sure?",
  bodyHtml = "",
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  confirmVariant = "primary",
  extraLabel = "",
  extraVariant = "outline-primary",
} = {}) {
  return new Promise((resolve) => {
    if (!window.bootstrap || typeof window.bootstrap.Modal !== "function") {
      // Bootstrap not loaded (shouldn't happen in practice — every page
      // loads it before this could ever be reachable) — fail safe to a
      // plain confirm() rather than silently resolving one way or the other.
      // No three-way equivalent for the native dialog — a caller relying on
      // `extraLabel` in this fallback path just never sees that option.
      resolve(window.confirm(bodyHtml.replace(/<[^>]+>/g, "") || title));
      return;
    }
    const overlay = document.createElement("div");
    overlay.className = "modal fade";
    overlay.tabIndex = -1;
    overlay.setAttribute("aria-hidden", "true");
    overlay.innerHTML = `
      <div class="modal-dialog">
        <div class="modal-content">
          <div class="modal-header">
            <h2 class="modal-title fs-5"></h2>
            <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Close"></button>
          </div>
          <div class="modal-body"></div>
          <div class="modal-footer">
            <button type="button" class="btn btn-outline-secondary" data-confirm-modal-cancel></button>
            <button type="button" class="btn d-none" data-confirm-modal-extra></button>
            <button type="button" class="btn" data-confirm-modal-confirm></button>
          </div>
        </div>
      </div>
    `;
    overlay.querySelector(".modal-title").textContent = title;
    overlay.querySelector(".modal-body").innerHTML = bodyHtml;
    const cancelButton = overlay.querySelector("[data-confirm-modal-cancel]");
    cancelButton.textContent = cancelLabel;
    const confirmButton = overlay.querySelector("[data-confirm-modal-confirm]");
    confirmButton.classList.add(`btn-${confirmVariant}`);
    confirmButton.textContent = confirmLabel;
    const extraButton = overlay.querySelector("[data-confirm-modal-extra]");
    if (extraLabel) {
      extraButton.classList.remove("d-none");
      extraButton.classList.add(`btn-${extraVariant}`);
      extraButton.textContent = extraLabel;
    }
    document.body.appendChild(overlay);
    const instance = window.bootstrap.Modal.getOrCreateInstance(overlay);
    let settled = false;
    function finish(result) {
      if (settled) return;
      settled = true;
      resolve(result);
      instance.hide();
    }
    confirmButton.addEventListener("click", () => finish(true));
    extraButton.addEventListener("click", () => finish("extra"));
    cancelButton.addEventListener("click", () => finish(false));
    // Escape/backdrop click/the header's own close button all dismiss via
    // Bootstrap directly, none of which route through the two explicit
    // handlers above — this is what actually catches every one of those and
    // treats each exactly like Cancel. Also where the overlay itself gets
    // torn down, regardless of which path got here.
    overlay.addEventListener("hidden.bs.modal", () => {
      finish(false);
      overlay.remove();
    });
    instance.show();
  });
}
