// "Show to table" — lets Sanctum/Forge/Crucible/Vault post a spotlight entry
// to the active campaign group's game log (server/groups.py's
// group_logs.entry_type = "spotlight", payload = {kind, id, templateId}), so
// a GM can put one entity's card up for the table without leaving the tool
// they're already working in. One shared module rather than four near-
// identical implementations, the same reasoning auth-ui.js's campaign
// control already applies to per-tool header chrome.
const MODAL_ID = "undercroft-spotlight-modal";

function ensureModal() {
  let modal = document.getElementById(MODAL_ID);
  if (modal) {
    return modal;
  }
  const wrapper = document.createElement("div");
  wrapper.innerHTML = `
    <div class="modal fade" id="${MODAL_ID}" tabindex="-1" aria-hidden="true">
      <div class="modal-dialog modal-dialog-centered">
        <div class="modal-content">
          <div class="modal-header">
            <h1 class="modal-title fs-5">Show to table</h1>
            <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Close"></button>
          </div>
          <div class="modal-body d-flex flex-column gap-3">
            <p class="small text-body-secondary mb-0" data-spotlight-target></p>
            <div data-spotlight-template-group>
              <label class="form-label" for="undercroft-spotlight-template-select">Template</label>
              <select class="form-select" id="undercroft-spotlight-template-select" data-spotlight-template-select></select>
            </div>
            <div class="text-danger small min-h-1" data-spotlight-error></div>
          </div>
          <div class="modal-footer">
            <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Cancel</button>
            <button type="button" class="btn btn-primary" data-spotlight-confirm>Show</button>
          </div>
        </div>
      </div>
    </div>
  `;
  const element = wrapper.firstElementChild;
  document.body.appendChild(element);
  return element;
}

// Same "category === print" filter Press's own listPrintTemplateEntries
// applies (undercroft/press/js/templates.js) — kept as a small, standalone
// duplicate here rather than importing across tool boundaries, since it's
// the only piece of Press-specific knowledge this shared module needs.
async function listPrintTemplates(dataManager) {
  const listing = await dataManager.list("templates", { refresh: true });
  const entries = dataManager.collectListEntries(listing.remote, ["owned", "shared", "public", "items"]);
  return entries.filter((entry) => (entry.category || "character") === "print");
}

// Kinds with no print-card rendering of their own — Orrery's maps are a
// spatial, pannable canvas, not a single-entity card Press can lay out.
// Spotlighting one is just a link back into the owning tool (see
// workbench-character-view.js's refreshNowShowing, which renders these as
// an "Open" link instead of fetching+rendering a card), so the template
// picker is irrelevant and skipped entirely rather than shown as a confusing
// dropdown with nothing appropriate to pick.
export const LINK_ONLY_KINDS = new Set(["map", "encounter"]);

// Resolves once the modal closes: true if a spotlight entry was posted,
// false if the GM cancelled. Callers generally don't need the result — it's
// there mainly so a caller COULD chain a follow-up action if it ever needs to.
export async function openSpotlightModal({ dataManager, status, kind, id, label } = {}) {
  if (!dataManager) {
    return false;
  }
  const active = dataManager.getActiveGroup();
  if (!active || !active.groupId) {
    status?.show("Pick an active campaign first (see the Campaign menu in the header).", {
      type: "warning",
      timeout: 3000,
    });
    return false;
  }
  if (!kind || !id) {
    status?.show("Save or load a record first.", { type: "warning", timeout: 2500 });
    return false;
  }

  const isLinkOnly = LINK_ONLY_KINDS.has(kind);
  let templates = [];
  if (!isLinkOnly) {
    try {
      templates = await listPrintTemplates(dataManager);
    } catch (error) {
      status?.show("Unable to load templates.", { type: "error", timeout: 3000 });
      return false;
    }
  }

  const modalElement = ensureModal();
  const modal =
    window.bootstrap && typeof window.bootstrap.Modal === "function"
      ? window.bootstrap.Modal.getOrCreateInstance(modalElement)
      : null;
  const targetLine = modalElement.querySelector("[data-spotlight-target]");
  const templateGroup = modalElement.querySelector("[data-spotlight-template-group]");
  const templateSelect = modalElement.querySelector("[data-spotlight-template-select]");
  const errorBox = modalElement.querySelector("[data-spotlight-error]");
  const confirmButton = modalElement.querySelector("[data-spotlight-confirm]");

  if (targetLine) {
    targetLine.textContent = `Show "${label || id}" to ${active.name || "the table"}.`;
  }
  if (errorBox) {
    errorBox.textContent = "";
  }
  if (templateGroup) {
    templateGroup.classList.toggle("d-none", isLinkOnly);
  }
  if (templateSelect) {
    templateSelect.innerHTML = "";
    if (!isLinkOnly) {
      // A template is a nice-to-have, not a requirement — the "Now showing"
      // viewer falls back to a plain name/description display when
      // templateId is empty, so a GM with no Press print templates yet (or
      // who just wants a quick plain reveal) can still use this without a
      // hard blocker.
      const plainOption = document.createElement("option");
      plainOption.value = "";
      plainOption.textContent = "No template (plain)";
      templateSelect.appendChild(plainOption);
      templates
        .slice()
        .sort((a, b) => (a.title || a.name || a.id).localeCompare(b.title || b.name || b.id))
        .forEach((template) => {
          const option = document.createElement("option");
          option.value = template.id;
          option.textContent = template.title || template.name || template.id;
          templateSelect.appendChild(option);
        });
    }
  }

  return new Promise((resolve) => {
    let settled = false;
    const finish = (result) => {
      if (settled) {
        return;
      }
      settled = true;
      confirmButton?.removeEventListener("click", onConfirm);
      modalElement.removeEventListener("hidden.bs.modal", onHidden);
      resolve(result);
    };
    const onConfirm = async () => {
      const templateId = templateSelect?.value || "";
      try {
        // spotlightToGroup (not a plain createGroupLogEntry) — it also
        // shares the entity (and template, if one was picked) with the
        // group first. That's what makes an authenticated group member's
        // own normal access resolution (is_shared, in storage.py) see this
        // record, on top of the narrower anonymous-share-link exception
        // get_item grants for exactly whatever's currently spotlighted.
        await dataManager.spotlightToGroup({
          groupId: active.groupId,
          contentType: kind,
          contentId: id,
          templateId,
        });
        status?.show(`Showing "${label || id}" to ${active.name || "the table"}.`, {
          type: "success",
          timeout: 2500,
        });
        modal?.hide();
        finish(true);
      } catch (error) {
        if (errorBox) {
          errorBox.textContent = error.message || "Unable to show this to the table.";
        }
      }
    };
    const onHidden = () => finish(false);
    confirmButton?.addEventListener("click", onConfirm);
    modalElement.addEventListener("hidden.bs.modal", onHidden);
    if (modal) {
      modal.show();
    } else {
      // No Bootstrap JS on the page (shouldn't happen anywhere in this
      // suite, but stay defensive rather than silently doing nothing).
      onConfirm();
    }
  });
}

