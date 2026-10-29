// A small Bootstrap modal around a caller-built form: `build(body)` fills the
// modal body and returns a function that reads the values (or returns null to
// refuse submitting). Resolves with those values, or null if dismissed. Built
// and torn down per call, like confirm-modal.js.
export function openFormModal({ title = "", submitLabel = "Save", build } = {}) {
  return new Promise((resolve) => {
    if (!window.bootstrap || typeof window.bootstrap.Modal !== "function" || typeof build !== "function") {
      resolve(null);
      return;
    }
    const overlay = document.createElement("div");
    overlay.className = "modal fade";
    overlay.tabIndex = -1;
    overlay.setAttribute("aria-hidden", "true");
    overlay.innerHTML = `
      <div class="modal-dialog modal-dialog-centered">
        <form class="modal-content">
          <div class="modal-header">
            <h2 class="modal-title fs-5"></h2>
            <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Close"></button>
          </div>
          <div class="modal-body d-flex flex-column gap-3"></div>
          <div class="modal-footer">
            <button type="button" class="btn btn-outline-secondary" data-bs-dismiss="modal">Cancel</button>
            <button type="submit" class="btn btn-primary"></button>
          </div>
        </form>
      </div>
    `;
    overlay.querySelector(".modal-title").textContent = title;
    overlay.querySelector("button[type=submit]").textContent = submitLabel;
    const readValues = build(overlay.querySelector(".modal-body"));
    document.body.appendChild(overlay);
    const instance = window.bootstrap.Modal.getOrCreateInstance(overlay);
    let result = null;
    overlay.querySelector("form").addEventListener("submit", (event) => {
      event.preventDefault();
      const values = readValues();
      if (!values) return;
      result = values;
      instance.hide();
    });
    overlay.addEventListener("shown.bs.modal", () => overlay.querySelector("input, select, textarea")?.focus());
    overlay.addEventListener("hidden.bs.modal", () => {
      overlay.remove();
      resolve(result);
    });
    instance.show();
  });
}

// One labeled control for a form built inside openFormModal's `build`.
export function formField(labelText, control) {
  const wrap = document.createElement("div");
  const label = document.createElement("label");
  label.className = "form-label small mb-1";
  label.textContent = labelText;
  wrap.append(label, control);
  return wrap;
}
