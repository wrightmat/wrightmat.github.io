// Generic per-record sharing UI (public share link + per-user/per-group
// grants) — originally built into the retired Admin tool, now shared so both
// the account page (Owned Content) and Loom (the Library table) can each
// open the same modal for whatever record a Share button was clicked on,
// without every caller re-implementing this ~500 lines of modal wiring.
const MODAL_ID = "undercroft-share-modal";
const SHARE_SPECIAL_ALL_USERS = "all-users";
const SHARE_ALL_USERS_LABEL = "All Users";

function ensureModal() {
  let modal = document.getElementById(MODAL_ID);
  if (modal) {
    return modal;
  }
  const wrapper = document.createElement("div");
  wrapper.innerHTML = `
    <div class="modal fade" id="${MODAL_ID}" tabindex="-1" aria-hidden="true" data-share-modal>
      <div class="modal-dialog modal-lg modal-dialog-scrollable">
        <div class="modal-content">
          <div class="modal-header">
            <h2 class="modal-title h5 mb-0" data-share-title>Manage access</h2>
            <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Close"></button>
          </div>
          <div class="modal-body">
            <div class="d-flex flex-column gap-4">
              <section class="d-flex flex-column gap-3">
                <div>
                  <h3 class="h6 mb-1">Share link</h3>
                  <p class="text-body-secondary mb-0" data-share-link-help>
                    Anyone with the link can view this resource but cannot edit it on the server.
                  </p>
                </div>
                <div class="d-flex flex-column gap-2">
                  <div class="input-group" data-share-link-group hidden>
                    <input type="text" class="form-control" data-share-link readonly />
                    <button class="btn btn-outline-secondary" type="button" data-share-copy>Copy</button>
                    <button class="btn btn-outline-danger" type="button" data-share-disable>Disable link</button>
                  </div>
                  <div class="d-flex flex-wrap gap-2 align-items-center">
                    <button class="btn btn-primary" type="button" data-share-generate>Create link</button>
                    <span class="text-body-secondary small" data-share-link-status></span>
                  </div>
                </div>
              </section>
              <hr class="my-0" />
              <section class="d-flex flex-column gap-3">
                <div>
                  <h3 class="h6 mb-1">Shared with people</h3>
                  <p class="text-body-secondary mb-0">
                    Add registered users to grant ongoing access. Choose "Can edit" to allow saves.
                  </p>
                </div>
                <div class="d-flex align-items-center gap-2 mb-2" data-share-quick hidden>
                  <button class="btn btn-outline-primary btn-sm" type="button" data-share-quick-button></button>
                </div>
                <form class="row g-2 align-items-end" data-share-add-form>
                  <div class="col-12 col-lg">
                    <label class="form-label" for="undercroft-share-username">Username</label>
                    <input
                      class="form-control"
                      type="text"
                      id="undercroft-share-username"
                      list="undercroft-share-username-options"
                      name="username"
                      autocomplete="off"
                      data-share-username
                      required
                    />
                    <datalist id="undercroft-share-username-options" data-share-username-options></datalist>
                  </div>
                  <div class="col-6 col-lg-auto">
                    <label class="form-label" for="undercroft-share-permission">Permission</label>
                    <select class="form-select" id="undercroft-share-permission" data-share-permission>
                      <option value="view">Can view</option>
                      <option value="edit">Can edit</option>
                    </select>
                  </div>
                  <div class="col-6 col-lg-auto">
                    <button class="btn btn-primary" type="submit">Share</button>
                  </div>
                </form>
                <div class="table-responsive" data-share-table hidden>
                  <table class="table table-sm align-middle mb-0">
                    <thead>
                      <tr>
                        <th scope="col">User</th>
                        <th scope="col" class="text-end">Permission</th>
                      </tr>
                    </thead>
                    <tbody data-share-rows></tbody>
                  </table>
                </div>
                <div class="alert alert-secondary mb-0" data-share-empty hidden>No one else has access.</div>
              </section>
            </div>
          </div>
          <div class="modal-footer">
            <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Close</button>
          </div>
        </div>
      </div>
    </div>
  `;
  const element = wrapper.firstElementChild;
  document.body.appendChild(element);
  modal = document.getElementById(MODAL_ID);
  return modal;
}

function disableForm(form, disabled) {
  const elements = form ? Array.from(form.elements) : [];
  elements.forEach((el) => {
    if (typeof el.disabled !== "undefined") {
      el.disabled = disabled;
    }
  });
}

// `bucket` (from list_owned_content's `item.bucket`) is already the Library
// `kind` id directly — no bucket-name-to-content-type translation needed.
function contentTypeFromBucket(bucket) {
  return bucket || "";
}

// initShareModal({dataManager, status}) — call once per page; returns
// { open(record) } where record is
// { bucket, id, label, typeLabel } — typeLabel is whatever the caller wants
// shown in the modal title (e.g. "Character", "NPC"); bucket/id identify the
// record for the share API calls.
export function initShareModal({ dataManager, status = null } = {}) {
  if (!dataManager) {
    throw new Error("initShareModal requires a DataManager instance");
  }
  const modalElement = ensureModal();
  const elements = {
    shareModalTitle: modalElement.querySelector("[data-share-title]"),
    shareLinkGroup: modalElement.querySelector("[data-share-link-group]"),
    shareLinkInput: modalElement.querySelector("[data-share-link]"),
    shareLinkCopy: modalElement.querySelector("[data-share-copy]"),
    shareLinkGenerate: modalElement.querySelector("[data-share-generate]"),
    shareLinkDisable: modalElement.querySelector("[data-share-disable]"),
    shareLinkStatus: modalElement.querySelector("[data-share-link-status]"),
    shareQuick: modalElement.querySelector("[data-share-quick]"),
    shareQuickButton: modalElement.querySelector("[data-share-quick-button]"),
    shareAddForm: modalElement.querySelector("[data-share-add-form]"),
    shareUsername: modalElement.querySelector("[data-share-username]"),
    shareUsernameOptions: modalElement.querySelector("[data-share-username-options]"),
    sharePermission: modalElement.querySelector("[data-share-permission]"),
    shareTable: modalElement.querySelector("[data-share-table]"),
    shareRows: modalElement.querySelector("[data-share-rows]"),
    shareEmpty: modalElement.querySelector("[data-share-empty]"),
  };

  const shareState = {
    modal: null,
    record: null,
    shares: [],
    link: null,
    loading: false,
    linkStatus: "",
    eligibleUsers: [],
  };

  function buildShareUrl(bucket, id, token = "") {
    // Workbench's own bootstrap (workbench.js) is what actually reads
    // ?record=<bucket>:<id>&share=<token> to pick a view and load the shared
    // record — only Characters and Templates have a Workbench view that
    // consumes this, so every other kind falls back to the current page
    // (there's no other public "click this link" viewer for it yet).
    const pageMap = {
      character: "../workbench/index.html",
      template: "../workbench/index.html",
    };
    const page = pageMap[bucket];
    if (!page) {
      return window.location.href;
    }
    const record = `${bucket}:${id}`;
    const url = new URL(page, window.location.href);
    url.searchParams.set("record", record);
    if (token) {
      url.searchParams.set("share", token);
    } else {
      url.searchParams.delete("share");
    }
    return url.toString();
  }

  async function copyShareLink(url) {
    try {
      if (navigator.clipboard && typeof navigator.clipboard.writeText === "function") {
        await navigator.clipboard.writeText(url);
        if (status) status.show("Copied share link to clipboard", { type: "success", timeout: 1800 });
        return true;
      }
    } catch (error) {
      console.warn("Clipboard write failed", error);
    }
    try {
      const textarea = document.createElement("textarea");
      textarea.value = url;
      textarea.setAttribute("readonly", "true");
      textarea.style.position = "fixed";
      textarea.style.left = "-9999px";
      document.body.appendChild(textarea);
      textarea.select();
      const successful = document.execCommand("copy");
      document.body.removeChild(textarea);
      if (successful && status) status.show("Copied share link to clipboard", { type: "success", timeout: 1800 });
      return successful;
    } catch (error) {
      console.warn("Fallback clipboard copy failed", error);
      if (status) status.show("Unable to copy link", { type: "danger" });
      return false;
    }
  }

  function ensureShareModalInstance() {
    if (shareState.modal || !modalElement) {
      return shareState.modal;
    }
    if (window.bootstrap && typeof window.bootstrap.Modal === "function") {
      shareState.modal = window.bootstrap.Modal.getOrCreateInstance(modalElement);
      modalElement.addEventListener("hidden.bs.modal", resetShareModal);
      return shareState.modal;
    }
    return null;
  }

  function resetShareModal() {
    shareState.record = null;
    shareState.shares = [];
    shareState.link = null;
    shareState.loading = false;
    shareState.linkStatus = "";
    shareState.eligibleUsers = null;
    if (elements.shareAddForm) {
      elements.shareAddForm.reset();
    }
    renderShareModal();
  }

  // The datalist-driven text input holds one merged namespace of typeable
  // values — usernames and campaign group names — since a group is just
  // another kind of share target. Group options are visually distinguished
  // by a "(Campaign Group)" label suffix; findEligibleShareEntry below
  // resolves whichever matched by checking `type`.
  function updateShareUsernameOptions() {
    if (!elements.shareUsernameOptions) return;
    const options = Array.isArray(shareState.eligibleUsers) ? shareState.eligibleUsers : [];
    const ordered = [];
    let allUsersOption = null;
    options.forEach((entry) => {
      if (entry && entry.special === SHARE_SPECIAL_ALL_USERS && !allUsersOption) {
        allUsersOption = entry;
        return;
      }
      ordered.push(entry);
    });
    const finalOptions = allUsersOption ? [allUsersOption, ...ordered] : ordered;
    const fragment = document.createDocumentFragment();
    const seen = new Set();
    finalOptions
      .filter((entry) => entry && (entry.type === "group" ? entry.name : entry.username))
      .forEach((entry) => {
        const isGroup = entry.type === "group";
        const value = isGroup ? entry.name : entry.username;
        const key = `${entry.type || "user"}:${value.toLowerCase()}`;
        if (seen.has(key)) return;
        seen.add(key);
        const option = document.createElement("option");
        option.value = value;
        if (entry.special) option.dataset.special = entry.special;
        let label;
        if (isGroup) {
          label = `${value} (Campaign Group)`;
        } else if (entry.special === SHARE_SPECIAL_ALL_USERS) {
          label = `${SHARE_ALL_USERS_LABEL} (View only)`;
          option.value = SHARE_ALL_USERS_LABEL;
        } else {
          const tier = dataManager.describeTier ? dataManager.describeTier(entry.tier) : entry.tier || "";
          label = tier ? `${value} (${tier})` : value;
        }
        option.label = label;
        option.textContent = label;
        fragment.appendChild(option);
      });
    elements.shareUsernameOptions.replaceChildren(fragment);
  }

  function findEligibleShareEntry(value = "") {
    const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";
    if (!normalized) return null;
    const options = Array.isArray(shareState.eligibleUsers) ? shareState.eligibleUsers : [];
    return (
      options.find((entry) => {
        const entryValue = entry?.type === "group" ? entry?.name : entry?.username;
        return (entryValue || "").toLowerCase() === normalized;
      }) || null
    );
  }

  function enforceSharePermissionConstraints() {
    if (!elements.sharePermission) return;
    const usernameValue = elements.shareUsername ? elements.shareUsername.value : "";
    const match = findEligibleShareEntry(usernameValue);
    const isAllUsers = Boolean(match && match.special === SHARE_SPECIAL_ALL_USERS);
    const options = Array.from(elements.sharePermission.options || []);
    options.forEach((option) => {
      if (!option) return;
      option.disabled = isAllUsers && option.value !== "view";
    });
    if (isAllUsers) {
      elements.sharePermission.value = "view";
    }
  }

  // One click instead of picking the same campaign from the full list every
  // time — only shown once a GM has an active campaign (auth-ui.js's header
  // control) and only makes sense once a record is actually selected here.
  function renderShareQuickButton() {
    if (!elements.shareQuick || !elements.shareQuickButton) return;
    const active = dataManager.getActiveGroup();
    const show = Boolean(shareState.record && active && active.groupId);
    elements.shareQuick.hidden = !show;
    if (show) {
      elements.shareQuickButton.textContent = `Share with ${active.name || "active campaign"}`;
      elements.shareQuickButton.disabled = shareState.loading;
    }
  }

  function renderShareModal() {
    const record = shareState.record;
    const hasRecord = Boolean(record);
    updateShareUsernameOptions();
    renderShareQuickButton();
    if (elements.shareModalTitle) {
      if (hasRecord) {
        const typeLabel = record.typeLabel || "Content";
        const nameLabel = record.label || record.id;
        elements.shareModalTitle.textContent = `${typeLabel} • ${nameLabel}`;
      } else {
        elements.shareModalTitle.textContent = "Manage access";
      }
    }
    const hasLink = Boolean(shareState.link?.token && hasRecord);
    if (elements.shareLinkGroup) elements.shareLinkGroup.hidden = !hasLink;
    if (elements.shareLinkInput) {
      elements.shareLinkInput.value = hasLink ? buildShareUrl(record.bucket, record.id, shareState.link.token) : "";
    }
    if (elements.shareLinkCopy) elements.shareLinkCopy.disabled = !hasLink;
    if (elements.shareLinkDisable) {
      elements.shareLinkDisable.hidden = !hasLink;
      elements.shareLinkDisable.disabled = shareState.loading;
    }
    if (elements.shareLinkGenerate) {
      elements.shareLinkGenerate.disabled = !hasRecord || shareState.loading;
      elements.shareLinkGenerate.textContent = hasLink ? "Reset link" : "Create link";
    }
    if (elements.shareLinkStatus) {
      elements.shareLinkStatus.textContent = shareState.linkStatus || "";
    }
    const isLoading = shareState.loading;
    if (elements.shareAddForm) {
      Array.from(elements.shareAddForm.elements).forEach((el) => {
        if (typeof el.disabled === "boolean") el.disabled = !hasRecord || isLoading;
      });
    }
    if (elements.sharePermission) {
      elements.sharePermission.value = elements.sharePermission.value || "view";
    }
    if (elements.shareUsername) {
      const hasEligible = Array.isArray(shareState.eligibleUsers) && shareState.eligibleUsers.length > 0;
      const eligibleLoading = hasRecord && shareState.eligibleUsers === null;
      if (!hasRecord) {
        elements.shareUsername.placeholder = "Select an item to manage access.";
      } else if (eligibleLoading) {
        elements.shareUsername.placeholder = "Loading eligible users…";
      } else if (!hasEligible) {
        elements.shareUsername.placeholder = "No eligible users available.";
      } else {
        elements.shareUsername.placeholder = "Start typing a username…";
      }
      enforceSharePermissionConstraints();
    }
    if (!hasRecord) {
      if (elements.shareTable) elements.shareTable.hidden = true;
      if (elements.shareRows) elements.shareRows.innerHTML = "";
      if (elements.shareEmpty) {
        elements.shareEmpty.hidden = false;
        elements.shareEmpty.textContent = "Select an item to manage access.";
      }
      return;
    }
    if (isLoading) {
      if (elements.shareTable) elements.shareTable.hidden = true;
      if (elements.shareRows) elements.shareRows.innerHTML = "";
      if (elements.shareEmpty) {
        elements.shareEmpty.hidden = false;
        elements.shareEmpty.textContent = "Loading access…";
      }
      return;
    }
    const shareEntries = Array.isArray(shareState.shares) ? shareState.shares : [];
    if (elements.shareTable) elements.shareTable.hidden = shareEntries.length === 0;
    if (elements.shareEmpty) {
      elements.shareEmpty.hidden = shareEntries.length !== 0;
      if (shareEntries.length === 0) elements.shareEmpty.textContent = "No one else has access.";
    }
    if (elements.shareRows) {
      const fragment = document.createDocumentFragment();
      const contentType = contentTypeFromBucket(record.bucket);
      shareEntries.forEach((entry) => {
        const row = document.createElement("tr");
        const userCell = document.createElement("td");
        const special = entry?.special || "";
        const isAllUsers = special === SHARE_SPECIAL_ALL_USERS;
        const isGroup = entry?.type === "group";
        const displayName = isGroup ? `${entry.group_name} (Campaign Group)` : isAllUsers ? SHARE_ALL_USERS_LABEL : entry.username;
        userCell.textContent = displayName;
        const actionCell = document.createElement("td");
        actionCell.className = "text-end";

        const permissionSelect = document.createElement("select");
        permissionSelect.className = "form-select form-select-sm d-inline-flex w-auto";
        [
          { value: "view", label: "Can view" },
          { value: "edit", label: "Can edit" },
        ].forEach((option) => {
          const opt = document.createElement("option");
          opt.value = option.value;
          opt.textContent = option.label;
          permissionSelect.appendChild(opt);
        });
        permissionSelect.value = entry.permissions === "edit" ? "edit" : "view";
        if (isAllUsers) {
          permissionSelect.value = "view";
          Array.from(permissionSelect.options).forEach((option) => {
            if (option.value !== "view") option.disabled = true;
          });
          permissionSelect.disabled = true;
        }

        const removeButton = document.createElement("button");
        removeButton.type = "button";
        removeButton.className = "btn btn-outline-danger btn-sm ms-2";
        removeButton.textContent = "Remove";

        permissionSelect.addEventListener("change", async () => {
          if (isAllUsers) {
            permissionSelect.value = "view";
            return;
          }
          const selected = permissionSelect.value;
          permissionSelect.disabled = true;
          removeButton.disabled = true;
          try {
            if (isGroup) {
              await dataManager.shareWithGroup({ contentType, contentId: record.id, groupId: entry.group_id, permissions: selected });
            } else {
              await dataManager.shareWithUser({ contentType, contentId: record.id, username: entry.username, permissions: selected });
            }
            if (status) status.show(`Updated access for ${displayName}.`, { type: "success", timeout: 1800 });
            await refreshShareModal();
          } catch (error) {
            console.error("Failed to update share permissions", error);
            if (status) status.show(error.message || "Unable to update permissions", { type: "danger" });
            permissionSelect.disabled = false;
            removeButton.disabled = false;
          }
        });

        removeButton.addEventListener("click", async () => {
          if (!window.confirm(`Remove access for ${displayName}?`)) return;
          permissionSelect.disabled = true;
          removeButton.disabled = true;
          try {
            if (isGroup) {
              await dataManager.revokeGroupShare({ contentType, contentId: record.id, groupId: entry.group_id });
            } else {
              await dataManager.revokeShare({ contentType, contentId: record.id, username: entry.username });
            }
            if (status) status.show(`Removed ${displayName}.`, { type: "success", timeout: 1800 });
            await refreshShareModal();
          } catch (error) {
            console.error("Failed to revoke share", error);
            if (status) status.show(error.message || "Unable to revoke access", { type: "danger" });
            permissionSelect.disabled = false;
            removeButton.disabled = false;
          }
        });

        actionCell.appendChild(permissionSelect);
        actionCell.appendChild(removeButton);
        row.appendChild(userCell);
        row.appendChild(actionCell);
        fragment.appendChild(row);
      });
      elements.shareRows.replaceChildren(fragment);
    }
  }

  async function refreshShareModal() {
    const modal = ensureShareModalInstance();
    if (!modal || !shareState.record) return;
    shareState.loading = true;
    renderShareModal();
    try {
      const contentType = contentTypeFromBucket(shareState.record.bucket);
      const result = await dataManager.listShares(contentType, shareState.record.id);
      shareState.shares = Array.isArray(result?.shares) ? result.shares : [];
      shareState.link = result?.link || null;
    } catch (error) {
      console.error("Failed to load share details", error);
      if (status) status.show(error.message || "Unable to load access", { type: "danger" });
      shareState.shares = [];
      shareState.link = null;
    } finally {
      shareState.loading = false;
      renderShareModal();
    }
  }

  async function refreshShareEligibleUsers() {
    if (!shareState.record) {
      shareState.eligibleUsers = [];
      renderShareModal();
      return;
    }
    const contentType = contentTypeFromBucket(shareState.record.bucket);
    if (!contentType) {
      shareState.eligibleUsers = [];
      renderShareModal();
      return;
    }
    shareState.eligibleUsers = null;
    renderShareModal();
    try {
      const result = await dataManager.listEligibleShareUsers({ contentType, contentId: shareState.record.id });
      const targets = Array.isArray(result?.targets) ? result.targets : [];
      shareState.eligibleUsers = targets.map((entry) =>
        entry.type === "group"
          ? { type: "group", id: entry.id, name: entry.name }
          : { type: "user", username: entry.username, tier: entry.tier || "", special: entry.special || "" }
      );
    } catch (error) {
      console.error("Failed to load eligible users", error);
      if (status) status.show(error.message || "Unable to load eligible users", { type: "danger" });
      shareState.eligibleUsers = [];
    } finally {
      renderShareModal();
    }
  }

  function openShareModal(record) {
    const modal = ensureShareModalInstance();
    if (!modal || !record) return;
    shareState.record = record;
    shareState.shares = [];
    shareState.link = null;
    shareState.loading = true;
    shareState.eligibleUsers = null;
    renderShareModal();
    modal.show();
    void refreshShareEligibleUsers();
    void refreshShareModal();
  }

  if (elements.shareLinkCopy) {
    elements.shareLinkCopy.addEventListener("click", () => {
      if (!shareState.record || !shareState.link?.token) return;
      const url = buildShareUrl(shareState.record.bucket, shareState.record.id, shareState.link.token);
      void copyShareLink(url);
    });
  }

  if (elements.shareLinkGenerate) {
    elements.shareLinkGenerate.addEventListener("click", async () => {
      if (!shareState.record) return;
      const contentType = contentTypeFromBucket(shareState.record.bucket);
      elements.shareLinkGenerate.disabled = true;
      if (elements.shareLinkDisable) elements.shareLinkDisable.disabled = true;
      shareState.linkStatus = "Generating link…";
      renderShareModal();
      try {
        await dataManager.createShareLink({ contentType, contentId: shareState.record.id });
        if (status) status.show("Share link ready.", { type: "success", timeout: 1800 });
      } catch (error) {
        console.error("Failed to generate share link", error);
        if (status) status.show(error.message || "Unable to create link", { type: "danger" });
        shareState.linkStatus = error?.message || "Unable to create link.";
      } finally {
        await refreshShareModal();
        shareState.linkStatus = "";
        renderShareModal();
      }
    });
  }

  if (elements.shareLinkDisable) {
    elements.shareLinkDisable.addEventListener("click", async () => {
      if (!shareState.record) return;
      const contentType = contentTypeFromBucket(shareState.record.bucket);
      elements.shareLinkDisable.disabled = true;
      if (elements.shareLinkGenerate) elements.shareLinkGenerate.disabled = true;
      shareState.linkStatus = "Disabling link…";
      renderShareModal();
      try {
        await dataManager.revokeShareLink({ contentType, contentId: shareState.record.id });
        if (status) status.show("Share link disabled.", { type: "success", timeout: 1800 });
      } catch (error) {
        console.error("Failed to disable share link", error);
        if (status) status.show(error.message || "Unable to disable link", { type: "danger" });
        shareState.linkStatus = error?.message || "Unable to disable link.";
      } finally {
        await refreshShareModal();
        shareState.linkStatus = "";
        renderShareModal();
      }
    });
  }

  if (elements.shareQuickButton) {
    elements.shareQuickButton.addEventListener("click", async () => {
      if (!shareState.record) return;
      const active = dataManager.getActiveGroup();
      if (!active || !active.groupId) return;
      const contentType = contentTypeFromBucket(shareState.record.bucket);
      elements.shareQuickButton.disabled = true;
      try {
        await dataManager.shareWithGroup({ contentType, contentId: shareState.record.id, groupId: active.groupId, permissions: "view" });
        if (status) status.show(`Shared with ${active.name || "active campaign"}.`, { type: "success", timeout: 1800 });
      } catch (error) {
        console.error("Failed to share with active campaign", error);
        if (status) status.show(error.message || "Unable to share", { type: "danger" });
      } finally {
        elements.shareQuickButton.disabled = false;
        await refreshShareModal();
      }
    });
  }

  if (elements.shareAddForm) {
    elements.shareAddForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      if (!shareState.record) return;
      const typedValue = (elements.shareUsername?.value || "").trim();
      let permissions = elements.sharePermission?.value || "view";
      if (!typedValue) {
        if (status) status.show("Enter a username or campaign group to share with.", { type: "warning", timeout: 1800 });
        return;
      }
      const match = findEligibleShareEntry(typedValue);
      const isGroup = Boolean(match && match.type === "group");
      const isAllUsers = Boolean(match && match.special === SHARE_SPECIAL_ALL_USERS);
      const targetUsername = isAllUsers ? SHARE_ALL_USERS_LABEL : typedValue;
      if (isAllUsers) permissions = "view";
      const contentType = contentTypeFromBucket(shareState.record.bucket);
      disableForm(elements.shareAddForm, true);
      try {
        if (isGroup) {
          await dataManager.shareWithGroup({ contentType, contentId: shareState.record.id, groupId: match.id, permissions });
        } else {
          await dataManager.shareWithUser({ contentType, contentId: shareState.record.id, username: targetUsername, permissions });
        }
        elements.shareAddForm.reset();
        if (elements.sharePermission) elements.sharePermission.value = "view";
        enforceSharePermissionConstraints();
        if (status) status.show(`Shared with ${isGroup ? match.name : targetUsername}.`, { type: "success", timeout: 1800 });
      } catch (error) {
        console.error("Failed to share", error);
        if (status) status.show(error.message || "Unable to share", { type: "danger" });
      } finally {
        disableForm(elements.shareAddForm, false);
        await refreshShareModal();
      }
    });
  }

  if (elements.shareUsername) {
    const handler = () => enforceSharePermissionConstraints();
    elements.shareUsername.addEventListener("input", handler);
    elements.shareUsername.addEventListener("change", handler);
  }

  // Keep the "Share with [active campaign]" quick button in sync if the
  // active campaign changes elsewhere (the header's signed-in menu) while
  // this modal happens to be open — self-contained so no caller needs to
  // wire this up itself.
  window.addEventListener("workbench:active-group-changed", () => {
    renderShareQuickButton();
  });

  return { open: openShareModal };
}
