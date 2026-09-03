// A Bootstrap-modal-based confirm() replacement — same "resolve true once
// confirmed, false otherwise" contract as window.confirm(), but with a real
// title, a rich HTML body, and suite-consistent button styling.
// ownership.js's confirmDelete() intentionally stays on window.confirm()
// for its one narrow use; this is for callers needing something richer
// than a yes/no sentence (see workbench-character-view.js's
// reimportCurrentCharacter).
//
// Built and torn down fresh per call rather than a static per-page element
// — any page can call this with zero markup of its own. `extraLabel`
// (optional) adds a THIRD footer button for a genuine three-way choice
// (e.g. Shop's Sell one/Sell all/Cancel). Its click resolves the promise
// with the literal string `"extra"`, not `true` — an existing caller that
// never passes `extraLabel` keeps its original two-way contract unchanged.
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
      // Bootstrap not loaded — fail safe to a plain confirm() rather than
      // silently resolving one way or the other. No three-way equivalent
      // here — a caller relying on `extraLabel` never sees that option.
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
    // Escape/backdrop click/the header's close button all dismiss via
    // Bootstrap directly, not the two explicit handlers above — this
    // catches all of those and treats each like Cancel, and tears down
    // the overlay regardless of which path got here.
    overlay.addEventListener("hidden.bs.modal", () => {
      finish(false);
      overlay.remove();
    });
    instance.show();
  });
}
