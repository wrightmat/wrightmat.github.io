// A generic "connect a third-party service" modal — an optional display
// label, a server URL, an optional model/identifier field, and an
// optional-or-required key/token, Save/Disconnect/Cancel — shared by
// home-assistant.js's own HA connection and audio-recorder.js's own
// transcription server list, rather than each keeping its own near-
// identical modal-building/promise-wiring code. Purely a UI/interaction
// concern: the caller supplies the current config and the actual save/
// disconnect calls (its own dataManager methods); this module never talks
// to dataManager directly, so it has no idea which service it's connecting.
//
// Built and torn down fresh per call (a unique id, removed from the DOM on
// close) rather than the single cached-singleton-element pattern this
// suite's other one-shape modals use (wled.js's own alias-prompt modal,
// e.g.) — this one's actual copy (title/labels/which optional fields even
// show) differs per caller, so a cached element would leak one caller's
// copy into the next.
let modalCounter = 0;

function buildModal(
  modalId,
  {
    title,
    description,
    showLabel,
    labelLabel,
    labelPlaceholder,
    urlLabel,
    urlPlaceholder,
    showModel,
    modelLabel,
    modelPlaceholder,
    keyLabel,
    keyPlaceholder,
    showDisconnect,
  }
) {
  const wrapper = document.createElement("div");
  wrapper.innerHTML = `
    <div class="modal fade" id="${modalId}" tabindex="-1" aria-hidden="true">
      <div class="modal-dialog modal-dialog-centered">
        <div class="modal-content">
          <div class="modal-header">
            <h1 class="modal-title fs-5">${title}</h1>
            <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Close"></button>
          </div>
          <div class="modal-body d-flex flex-column gap-2">
            <p class="small text-body-secondary mb-0">${description}</p>
            ${
              showLabel
                ? `<div class="d-flex flex-column gap-1">
              <label class="form-label small mb-0" for="${modalId}-label">${labelLabel}</label>
              <input type="text" class="form-control form-control-sm" id="${modalId}-label" placeholder="${labelPlaceholder}">
            </div>`
                : ""
            }
            <div class="d-flex flex-column gap-1">
              <label class="form-label small mb-0" for="${modalId}-url">${urlLabel}</label>
              <input type="text" class="form-control form-control-sm" id="${modalId}-url" placeholder="${urlPlaceholder}">
            </div>
            ${
              showModel
                ? `<div class="d-flex flex-column gap-1">
              <label class="form-label small mb-0" for="${modalId}-model">${modelLabel}</label>
              <input type="text" class="form-control form-control-sm" id="${modalId}-model" placeholder="${modelPlaceholder}">
            </div>`
                : ""
            }
            <div class="d-flex flex-column gap-1">
              <label class="form-label small mb-0" for="${modalId}-key">${keyLabel}</label>
              <input type="password" class="form-control form-control-sm" id="${modalId}-key" placeholder="${keyPlaceholder}">
            </div>
          </div>
          <div class="modal-footer">
            ${showDisconnect ? '<button type="button" class="btn btn-outline-danger me-auto" data-connection-modal-disconnect>Disconnect</button>' : ""}
            <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Cancel</button>
            <button type="button" class="btn btn-primary" data-connection-modal-confirm>Save</button>
          </div>
        </div>
      </div>
    </div>
  `;
  const element = wrapper.firstElementChild;
  document.body.appendChild(element);
  return element;
}

// `existing` — {configured, baseUrl, label?, model?} from the caller's own
// already-fetched config, so this module doesn't need to know how to fetch
// it. The key field always starts blank regardless of `existing.configured`
// — never re-populated from a real secret (there's nothing to re-populate
// it with; the server never sends a saved key back, see integrations.py's
// own header comment) — `keyPlaceholder` is how a caller communicates
// "leave blank to keep what's already saved" vs. "leave blank for no key at
// all" to the person filling this in. The label/model fields only render at
// all when `showLabel`/`showModel` are set (HA's own single-per-account
// connection has no use for either). `onSave(baseUrl, token, label, model)`
// — a caller that didn't ask for label/model just ignores those arguments
// (always "" when their own show flag is false). Resolves true if something
// was saved or disconnected, false if cancelled.
export async function promptConnectionModal({
  existing,
  title,
  description,
  showLabel = false,
  labelLabel = "Label",
  labelPlaceholder = "",
  urlLabel = "Server URL",
  urlPlaceholder = "",
  showModel = false,
  modelLabel = "Model",
  modelPlaceholder = "",
  keyLabel = "API key",
  keyPlaceholder = "",
  keyRequired = false,
  onSave,
  onDisconnect,
  status,
}) {
  const modalId = `undercroft-connection-modal-${++modalCounter}`;
  const modalElement = buildModal(modalId, {
    title,
    description,
    showLabel,
    labelLabel,
    labelPlaceholder,
    urlLabel,
    urlPlaceholder,
    showModel,
    modelLabel,
    modelPlaceholder,
    keyLabel,
    keyPlaceholder,
    showDisconnect: Boolean(existing?.configured && onDisconnect),
  });
  const modal =
    window.bootstrap && typeof window.bootstrap.Modal === "function"
      ? window.bootstrap.Modal.getOrCreateInstance(modalElement)
      : null;
  const labelInput = modalElement.querySelector(`#${modalId}-label`);
  const urlInput = modalElement.querySelector(`#${modalId}-url`);
  const modelInput = modalElement.querySelector(`#${modalId}-model`);
  const keyInput = modalElement.querySelector(`#${modalId}-key`);
  const confirmButton = modalElement.querySelector("[data-connection-modal-confirm]");
  const disconnectButton = modalElement.querySelector("[data-connection-modal-disconnect]");
  if (labelInput) labelInput.value = existing?.label || "";
  urlInput.value = existing?.baseUrl || "";
  if (modelInput) modelInput.value = existing?.model || "";
  keyInput.value = "";

  return new Promise((resolve) => {
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      confirmButton?.removeEventListener("click", onConfirm);
      disconnectButton?.removeEventListener("click", onDisconnectClick);
      modalElement.removeEventListener("hidden.bs.modal", onHidden);
      modalElement.remove();
      resolve(result);
    };
    const onConfirm = async () => {
      const label = labelInput ? labelInput.value.trim() : "";
      const baseUrl = urlInput.value.trim();
      const model = modelInput ? modelInput.value.trim() : "";
      const token = keyInput.value.trim();
      if (!baseUrl) {
        status?.show?.("A server URL is required.", { type: "warning", timeout: 2400 });
        return;
      }
      if (keyRequired && !token && !existing?.configured) {
        status?.show?.("A key/token is required.", { type: "warning", timeout: 2400 });
        return;
      }
      try {
        await onSave(baseUrl, token, label, model);
        modal?.hide();
        finish(true);
      } catch (error) {
        status?.show?.(error?.message || "Unable to save that connection.", { type: "error" });
      }
    };
    const onDisconnectClick = async () => {
      try {
        await onDisconnect();
        modal?.hide();
        finish(true);
      } catch (error) {
        status?.show?.(error?.message || "Unable to disconnect.", { type: "error" });
      }
    };
    const onHidden = () => finish(false);
    confirmButton?.addEventListener("click", onConfirm);
    disconnectButton?.addEventListener("click", onDisconnectClick);
    modalElement.addEventListener("hidden.bs.modal", onHidden);
    if (modal) {
      modal.show();
    } else {
      // No Bootstrap JS on the page (shouldn't happen anywhere in this
      // suite, but stay defensive rather than silently doing nothing) —
      // same fallback shape wled.js's own promptForWledAlias uses.
      finish(false);
    }
  });
}
