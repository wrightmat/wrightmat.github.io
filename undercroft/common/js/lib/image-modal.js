// Shows one image at full size in a Bootstrap modal with a close button. Built and torn down per call,
// like confirm-modal.js, so any page can use it with no markup of its own.
export function showImageModal({ src, alt = "" } = {}) {
  if (!src || !window.bootstrap || typeof window.bootstrap.Modal !== "function") {
    return;
  }
  const overlay = document.createElement("div");
  overlay.className = "modal fade";
  overlay.tabIndex = -1;
  overlay.setAttribute("aria-hidden", "true");
  overlay.innerHTML = `
    <div class="modal-dialog modal-dialog-centered modal-xl">
      <div class="modal-content">
        <div class="modal-header">
          <h2 class="modal-title fs-6"></h2>
          <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Close"></button>
        </div>
        <div class="modal-body text-center">
          <img class="img-fluid" style="max-height: 75vh; object-fit: contain;" />
        </div>
      </div>
    </div>
  `;
  overlay.querySelector(".modal-title").textContent = alt;
  const image = overlay.querySelector("img");
  image.src = src;
  image.alt = alt;
  document.body.appendChild(overlay);
  const instance = window.bootstrap.Modal.getOrCreateInstance(overlay);
  overlay.addEventListener("hidden.bs.modal", () => {
    instance.dispose();
    overlay.remove();
  });
  instance.show();
}
