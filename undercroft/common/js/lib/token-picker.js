// A labeled image-URL field with a live thumbnail preview and a "Browse
// Library" dropdown over the shared Token Library (token-library.js,
// common/data/token-library.json) — the picture equivalent of
// icon-picker.js's attachIconAutocomplete (same "type a value directly, OR
// pick a shared saved one" shape), reused identically by every "this record
// gets a token/portrait image" field in the suite (Orrery's marker Image
// field, Forge's NPC Image field, Crucible's Monster Image field) so they
// can never drift into three separately-built pickers.
//
// Values here are always a literal external URL (paste your own, or pick a
// saved one) — no upload, no file hosting by this app, same philosophy as
// the font/soundboard pickers this mirrors.
import { getAllTokens, registerToken, removeTokenLocally, loadTokenLibrary, saveToken, deleteToken } from "./token-library.js";

// Matches server/app.py's own gate on POST /token-library.
const ADD_TOKEN_TIERS = new Set(["gm", "creator", "admin"]);

let libraryLoadPromise = null;
function ensureLibraryLoaded() {
  if (!libraryLoadPromise) {
    libraryLoadPromise = loadTokenLibrary();
  }
  return libraryLoadPromise;
}

function randomId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `${Math.random().toString(16).slice(2)}-${Date.now()}`;
}

// `dataManager`/`status` are optional — a caller that only wants the plain
// URL-field-with-preview half (no library browsing/saving) can omit them and
// the Browse button simply won't be built. Every real caller in this suite
// passes both.
//
// `boxed: true` wraps the field in the same bordered "field box" every other
// center-pane property now uses (see ui-components.js's createFieldBox) —
// border/rounded corners/padding, and the same small-uppercase-secondary
// label style — so Image sits visually consistent next to Name/Identity
// instead of standing out with plain Bootstrap input-group styling. Default
// stays unboxed for any caller (Orrery's marker Image field) that isn't
// rendering inside a field-box grid.
export function createTokenImageField({
  id,
  label = "Image",
  labelClass,
  value = "",
  dataManager,
  status,
  onSelect,
  boxed = false,
} = {}) {
  const wrapper = document.createElement("div");
  wrapper.className = boxed ? "d-flex flex-column gap-1 border rounded-3 p-2 h-100" : "d-flex flex-column gap-1";

  const labelEl = document.createElement("label");
  labelEl.className = labelClass || (boxed ? "small text-uppercase text-body-secondary" : "form-label small text-body-secondary fw-semibold");
  if (id) labelEl.htmlFor = id;
  labelEl.textContent = label;

  const group = document.createElement("div");
  group.className = "input-group input-group-sm position-relative";

  const previewWrap = document.createElement("span");
  previewWrap.className = "input-group-text p-1";
  const preview = document.createElement("img");
  preview.alt = "";
  preview.style.width = "1.5rem";
  preview.style.height = "1.5rem";
  preview.style.objectFit = "cover";
  preview.style.borderRadius = "50%";
  preview.style.display = "none";
  preview.addEventListener("error", () => {
    preview.style.display = "none";
  });
  previewWrap.appendChild(preview);

  const input = document.createElement("input");
  input.type = "text";
  input.className = "form-control";
  input.placeholder = "Image URL";
  if (id) input.id = id;
  input.value = value;

  group.append(previewWrap, input);

  function updatePreview(url) {
    if (url) {
      preview.src = url;
      preview.style.display = "";
    } else {
      preview.removeAttribute("src");
      preview.style.display = "none";
    }
  }
  updatePreview(value);

  function commit(nextValue) {
    updatePreview(nextValue);
    onSelect?.(nextValue);
  }

  input.addEventListener("change", () => commit(input.value.trim()));

  wrapper.append(labelEl, group);

  if (!dataManager) {
    return wrapper;
  }

  const browseButton = document.createElement("button");
  browseButton.type = "button";
  browseButton.className = "btn btn-outline-secondary";
  browseButton.setAttribute("aria-label", "Browse token library");
  browseButton.setAttribute("data-bs-toggle", "tooltip");
  browseButton.setAttribute("data-bs-placement", "top");
  browseButton.setAttribute("data-bs-title", "Browse token library");
  browseButton.innerHTML = '<span class="iconify" data-icon="tabler:photo-search" aria-hidden="true"></span>';
  group.appendChild(browseButton);

  const dropdown = document.createElement("div");
  dropdown.className = "list-group position-absolute top-100 start-0 w-100 shadow-sm bg-body border mt-1 d-none";
  dropdown.style.zIndex = "1300";
  dropdown.style.maxHeight = "18rem";
  dropdown.style.overflowY = "auto";
  group.appendChild(dropdown);

  const userTier = dataManager.getUserTier?.() || "free";
  const canAdd = ADD_TOKEN_TIERS.has(userTier);
  const canDelete = userTier === "admin";

  function renderTokenRow(token) {
    const row = document.createElement("div");
    row.className = "list-group-item list-group-item-action d-flex align-items-center gap-2 py-1";

    const thumb = document.createElement("img");
    thumb.src = token.url;
    thumb.alt = "";
    thumb.style.width = "1.5rem";
    thumb.style.height = "1.5rem";
    thumb.style.objectFit = "cover";
    thumb.style.borderRadius = "50%";
    thumb.style.flexShrink = "0";

    const name = document.createElement("span");
    name.className = "text-truncate flex-grow-1";
    name.textContent = token.name;

    row.append(thumb, name);

    if (canDelete) {
      const removeButton = document.createElement("button");
      removeButton.type = "button";
      removeButton.className = "btn btn-sm btn-link text-body-secondary p-0";
      removeButton.setAttribute("aria-label", `Remove ${token.name} from the library`);
      removeButton.innerHTML = "&times;";
      removeButton.addEventListener("mousedown", (event) => event.preventDefault());
      removeButton.addEventListener("click", (event) => {
        event.stopPropagation();
        if (!window.confirm(`Remove "${token.name}" from the shared token library?`)) return;
        removeTokenLocally(token.id);
        renderList();
        void deleteToken(token.id, dataManager.session?.token).catch((error) => {
          registerToken(token);
          renderList();
          status?.show(error.message || "Unable to delete token.", { type: "error" });
        });
      });
      row.appendChild(removeButton);
    }

    row.addEventListener("mousedown", (event) => event.preventDefault());
    row.addEventListener("click", () => {
      input.value = token.url;
      commit(token.url);
      close();
    });
    return row;
  }

  const listHost = document.createElement("div");
  listHost.className = "d-flex flex-column";
  dropdown.appendChild(listHost);

  const searchInput = document.createElement("input");
  searchInput.type = "search";
  searchInput.className = "form-control form-control-sm border-0 border-bottom rounded-0";
  searchInput.placeholder = "Search tokens…";
  searchInput.addEventListener("mousedown", (event) => event.stopPropagation());
  searchInput.addEventListener("input", () => renderList());
  dropdown.insertBefore(searchInput, listHost);

  function renderList() {
    const query = searchInput.value.trim().toLowerCase();
    const tokens = getAllTokens().filter((token) => !query || token.name.toLowerCase().includes(query));
    listHost.innerHTML = "";
    if (!tokens.length) {
      const empty = document.createElement("div");
      empty.className = "text-body-secondary small p-2";
      empty.textContent = "No saved tokens yet.";
      listHost.appendChild(empty);
    } else {
      tokens.forEach((token) => listHost.appendChild(renderTokenRow(token)));
    }
  }

  if (canAdd) {
    const addForm = document.createElement("div");
    addForm.className = "d-flex align-items-center gap-1 border-top p-2";
    addForm.addEventListener("mousedown", (event) => event.stopPropagation());

    const addNameInput = document.createElement("input");
    addNameInput.type = "text";
    addNameInput.className = "form-control form-control-sm";
    addNameInput.placeholder = "Name";

    const addButton = document.createElement("button");
    addButton.type = "button";
    addButton.className = "btn btn-sm btn-outline-primary flex-shrink-0";
    addButton.textContent = "Save current URL";
    addButton.addEventListener("click", () => {
      const name = addNameInput.value.trim();
      const url = input.value.trim();
      if (!name || !url) {
        status?.show("Enter a name, and set the Image URL above first.", { type: "warning", timeout: 2500 });
        return;
      }
      const token = { id: randomId(), name, url };
      // Optimistic — same "update immediately, persist async" flow every
      // other shared-library add in this suite already uses.
      registerToken(token);
      renderList();
      addNameInput.value = "";
      void saveToken(token, dataManager.session?.token).catch((error) => {
        removeTokenLocally(token.id);
        renderList();
        status?.show(error.message || "Unable to save token.", { type: "error" });
      });
    });

    addForm.append(addNameInput, addButton);
    dropdown.appendChild(addForm);
  }

  let outsideClickHandler = null;
  function open() {
    void ensureLibraryLoaded().then(() => renderList());
    renderList();
    dropdown.classList.remove("d-none");
    outsideClickHandler = (event) => {
      if (!group.contains(event.target)) close();
    };
    window.addEventListener("mousedown", outsideClickHandler);
  }
  function close() {
    dropdown.classList.add("d-none");
    if (outsideClickHandler) {
      window.removeEventListener("mousedown", outsideClickHandler);
      outsideClickHandler = null;
    }
  }
  browseButton.addEventListener("click", () => {
    if (dropdown.classList.contains("d-none")) open();
    else close();
  });

  return wrapper;
}
