// Generic "pick one of my/shared/public records of a given Library kind"
// modal — used by the Dashboard's Add-widget toolbar for widget types that
// need a specific record chosen before they can be added (Map, Character
// sheet), since neither has anything meaningful to show from a blind
// "add one" click the way Combat/Game Log/Character-summary do. Uses
// fetchKindEntrySummaries (content-fetch.js), not fetchKindEntriesWithIds —
// this picker only ever needs a name to show and an id to return, never a
// record's own fields to filter on, so there's no reason to pull every
// candidate's full body (irrelevant for `kind` values like `feature`/
// `effect`, which can run into the thousands) just to populate a <select>.
// Works for any kind unconditionally, since a record's title (what the
// summary's `name` comes from) is a real library_items column populated at
// save time, not something a kind has to opt into via metadataFields.
import { fetchKindEntrySummaries } from "../content-fetch.js";

const MODAL_ID = "undercroft-content-picker-modal";

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
            <h1 class="modal-title fs-5" data-content-picker-title>Choose an item</h1>
            <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Close"></button>
          </div>
          <div class="modal-body d-flex flex-column gap-3">
            <select class="form-select" data-content-picker-select></select>
            <div class="text-body-secondary small" data-content-picker-empty hidden></div>
          </div>
          <div class="modal-footer">
            <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Cancel</button>
            <button type="button" class="btn btn-primary" data-content-picker-confirm>Add</button>
          </div>
        </div>
      </div>
    </div>
  `;
  const element = wrapper.firstElementChild;
  document.body.appendChild(element);
  return element;
}

// Handles every list shape this picker's two sources return: fetchKindEntrySummaries'
// own flat `{id, name}` (remote), listLocalEntries' `{payload}` (local), and
// both name conventions records in this suite use (a flat `name`, or
// Workbench characters' nested `data.name`), falling back to the id itself
// so nothing renders blank.
function nameOf(entry) {
  const record = entry?.payload ?? {};
  return record?.data?.name || record?.name || record?.title || entry?.name || entry?.id || "Untitled";
}

// openContentPicker({dataManager, kind, title, emptyMessage, excludeIds}) =>
// Promise resolving the chosen record's id, or null if cancelled/nothing to
// pick. `excludeIds` (optional) leaves specific ids out of the list entirely
// — e.g. a record that can't reference itself, like Repository's own
// "choose a parent page" picker excluding the page being edited.
export async function openContentPicker({
  dataManager,
  kind,
  title = "Choose an item",
  emptyMessage = "",
  excludeIds = [],
} = {}) {
  if (!dataManager || !kind) {
    return null;
  }

  let remoteEntries = [];
  try {
    remoteEntries = await fetchKindEntrySummaries(dataManager, kind);
  } catch (error) {
    remoteEntries = [];
  }
  const remoteIds = new Set(remoteEntries.map((entry) => entry.id));
  const localEntries = (dataManager.listLocalEntries(kind) || []).filter((entry) => !remoteIds.has(entry.id));
  const excluded = new Set(excludeIds);
  const entries = [...remoteEntries, ...localEntries].filter((entry) => !excluded.has(entry.id));

  const modalElement = ensureModal();
  const modal =
    window.bootstrap && typeof window.bootstrap.Modal === "function"
      ? window.bootstrap.Modal.getOrCreateInstance(modalElement)
      : null;
  const titleEl = modalElement.querySelector("[data-content-picker-title]");
  const select = modalElement.querySelector("[data-content-picker-select]");
  const emptyBox = modalElement.querySelector("[data-content-picker-empty]");
  const confirmButton = modalElement.querySelector("[data-content-picker-confirm]");

  if (titleEl) titleEl.textContent = title;
  const hasEntries = entries.length > 0;
  if (select) {
    select.innerHTML = "";
    select.hidden = !hasEntries;
    entries
      .slice()
      .sort((a, b) => nameOf(a).localeCompare(nameOf(b)))
      .forEach((entry) => {
        const option = document.createElement("option");
        option.value = entry.id;
        option.textContent = nameOf(entry);
        select.appendChild(option);
      });
  }
  if (emptyBox) {
    emptyBox.hidden = hasEntries;
    emptyBox.textContent = emptyMessage || `You don't have any saved ${kind} entries yet.`;
  }
  if (confirmButton) confirmButton.disabled = !hasEntries;

  return new Promise((resolve) => {
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      confirmButton?.removeEventListener("click", onConfirm);
      modalElement.removeEventListener("hidden.bs.modal", onHidden);
      resolve(result);
    };
    const onConfirm = () => {
      const chosen = select?.value || null;
      modal?.hide();
      finish(chosen);
    };
    const onHidden = () => finish(null);
    confirmButton?.addEventListener("click", onConfirm);
    modalElement.addEventListener("hidden.bs.modal", onHidden);
    if (modal) {
      modal.show();
    } else {
      // No Bootstrap JS on the page (shouldn't happen anywhere in this
      // suite, but stay defensive rather than silently doing nothing).
      finish(hasEntries ? entries[0].id : null);
    }
  });
}
