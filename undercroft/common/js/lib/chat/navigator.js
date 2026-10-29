// Channel/thread picker for the chat widget, plus the GM's (and delegated
// thread creators') channel and thread management. The widget is narrow
// (Workbench mounts it in a side pane), so this is one drill-down dropdown
// rather than a side-by-side list.
import { el } from "../dom.js";
import { createIconButton } from "../ui-components.js";
import { showConfirmModal } from "../confirm-modal.js";
import { createReferenceChip } from "../library-reference.js";
import { buildKindToolUrl } from "../kind-tool-route.js";
import { fetchKindEntrySummaries, loadLibraryKinds } from "../content-fetch.js";
import { formatThreadLabel } from "./target.js";
import { formField, openFormModal } from "./form-modal.js";

const MODE_LABELS = { ic: "In-character", ooc: "Out-of-character" };
const MODE_BADGES = { ic: "IC", ooc: "OOC" };

function iconButton(icon, label, onClick) {
  return createIconButton({ icon, label, variant: "link", className: "p-0 px-1 text-body-secondary", onClick });
}

function groupByCategory(channels) {
  const groups = new Map();
  channels.forEach((channel) => {
    const key = channel.category || "";
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(channel);
  });
  // Uncategorized channels first, then categories in the order they first appear.
  return [...groups.entries()].sort(([a], [b]) => (a === "" ? -1 : b === "" ? 1 : 0));
}

export function createChatNavigator({ dataManager, status, groupId, roster = [], ownerId = null, onSelectThread, onChanged } = {}) {
  let overview = null;
  let currentThreadId = "";

  const element = el("div", "d-flex align-items-center gap-1");
  const dropdown = el("div", "dropdown flex-grow-1");
  dropdown.style.minWidth = "0";
  const toggle = el("button", "btn btn-outline-secondary btn-sm w-100 text-start text-truncate dropdown-toggle");
  toggle.type = "button";
  toggle.setAttribute("data-bs-toggle", "dropdown");
  toggle.setAttribute("data-bs-auto-close", "outside");
  const menu = el("div", "dropdown-menu w-100 p-1");
  menu.style.maxHeight = "20rem";
  menu.style.overflowY = "auto";
  dropdown.append(toggle, menu);
  const linkedHost = el("div", "flex-shrink-0");
  element.append(dropdown, linkedHost);

  function closeMenu() {
    window.bootstrap?.Dropdown?.getInstance(toggle)?.hide();
  }

  function isGm() {
    return Boolean(overview?.viewer?.isGm);
  }

  function canCreateThread(channel) {
    return isGm() || (channel.threadCreatorIds || []).includes(overview?.viewer?.userId);
  }

  function canArchive(thread) {
    return !thread.isDefault && !thread.archivedAt && (isGm() || thread.createdBy === overview?.viewer?.userId);
  }

  async function run(action, failure) {
    try {
      await action();
      await onChanged?.();
    } catch (error) {
      status?.show(error.message || failure, { type: "error" });
    }
  }

  async function newThread(channel) {
    const values = await openFormModal({
      title: `New thread in ${channel.name}`,
      submitLabel: "Create",
      build(body) {
        const input = el("input", "form-control");
        input.type = "text";
        input.maxLength = 120;
        body.appendChild(formField("Title", input));
        return () => (input.value.trim() ? { title: input.value.trim() } : null);
      },
    });
    if (!values) return;
    await run(async () => {
      const thread = await dataManager.createChatThread({ groupId, channelId: channel.id, title: values.title });
      await onChanged?.();
      onSelectThread?.(thread, channel);
    }, "Unable to create the thread.");
  }

  async function archiveThread(thread, channel) {
    const confirmed = await showConfirmModal({
      title: "Archive thread?",
      bodyHtml: "<p class=\"mb-0\">The messages move into a Repository page and the thread becomes read-only.</p>",
      confirmLabel: "Archive",
    });
    if (!confirmed) return;
    await run(async () => {
      await dataManager.archiveChatThread({ groupId, threadId: thread.id });
      status?.show(`Archived "${thread.title}" to a Repository page.`, { type: "success" });
    }, "Unable to archive the thread.");
    if (thread.id === currentThreadId) {
      const fallback = overview?.channels?.flatMap((c) => c.threads).find((t) => t.id === overview.defaultThreadId);
      if (fallback) onSelectThread?.(fallback, channel);
    }
  }

  // Channel create/edit share one form. `channel` is null when creating.
  async function editChannel(channel) {
    const kinds = await loadLibraryKinds().catch(() => []);
    const members = [];
    const seen = new Set();
    roster.forEach((entry) => {
      if (entry?.owner_id == null || entry.owner_id === ownerId || seen.has(entry.owner_id)) return;
      seen.add(entry.owner_id);
      members.push({ id: entry.owner_id, name: entry.owner_username || entry.label || `User ${entry.owner_id}` });
    });
    const values = await openFormModal({
      title: channel ? `Edit ${channel.name}` : "New channel",
      submitLabel: channel ? "Save" : "Create",
      build(body) {
        const name = el("input", "form-control");
        name.type = "text";
        name.maxLength = 80;
        name.value = channel?.name || "";
        const category = el("input", "form-control");
        category.type = "text";
        category.maxLength = 80;
        category.value = channel?.category || "";
        const mode = el("select", "form-select");
        [["", "Either (no restriction)"], ["ic", MODE_LABELS.ic], ["ooc", MODE_LABELS.ooc]].forEach(([value, label]) => {
          const option = el("option", null, label);
          option.value = value;
          mode.appendChild(option);
        });
        mode.value = channel?.mode || "";
        const kindSelect = el("select", "form-select");
        kindSelect.appendChild(Object.assign(el("option", null, "No linked record"), { value: "" }));
        kinds
          .filter((kind) => !["kind", "group"].includes(kind.id))
          .forEach((kind) => {
            const option = el("option", null, kind.label || kind.id);
            option.value = kind.id;
            kindSelect.appendChild(option);
          });
        const recordSelect = el("select", "form-select mt-1");
        recordSelect.style.display = "none";
        async function loadRecords(kindId, selectedId) {
          recordSelect.textContent = "";
          recordSelect.style.display = kindId ? "" : "none";
          if (!kindId) return;
          const entries = await fetchKindEntrySummaries(dataManager, kindId).catch(() => []);
          entries
            .slice()
            .sort((a, b) => a.name.localeCompare(b.name))
            .forEach((entry) => {
              const option = el("option", null, entry.name);
              option.value = entry.id;
              recordSelect.appendChild(option);
            });
          if (selectedId) recordSelect.value = selectedId;
        }
        kindSelect.addEventListener("change", () => void loadRecords(kindSelect.value));
        if (channel?.linked) {
          kindSelect.value = channel.linked.kind;
          void loadRecords(channel.linked.kind, channel.linked.id);
        }
        // A new channel starts with one thread, so ask for its name up front.
        const firstThread = el("input", "form-control");
        firstThread.type = "text";
        firstThread.maxLength = 120;
        firstThread.value = "General";
        body.append(
          formField("Name", name),
          ...(channel ? [] : [formField("First thread", firstThread)]),
          formField("Category", category),
          formField("Mode", mode),
          formField("Linked record", kindSelect)
        );
        body.appendChild(recordSelect);
        const creatorChecks = [];
        if (channel && members.length) {
          const wrap = el("div", "d-flex flex-column gap-1");
          members.forEach((member) => {
            const label = el("label", "form-check small");
            const box = el("input", "form-check-input");
            box.type = "checkbox";
            box.checked = (channel.threadCreatorIds || []).includes(member.id);
            label.append(box, el("span", "form-check-label", member.name));
            creatorChecks.push({ id: member.id, box });
            wrap.appendChild(label);
          });
          body.appendChild(formField("Players who can start threads", wrap));
        }
        return () => {
          if (!name.value.trim()) return null;
          return {
            name: name.value.trim(),
            threadTitle: firstThread.value.trim(),
            category: category.value.trim(),
            mode: mode.value,
            linked: kindSelect.value && recordSelect.value ? { kind: kindSelect.value, id: recordSelect.value } : {},
            threadCreatorIds: creatorChecks.filter((entry) => entry.box.checked).map((entry) => entry.id),
          };
        };
      },
    });
    if (!values) return;
    await run(async () => {
      if (channel) {
        await dataManager.updateChatChannel({ groupId, channelId: channel.id, fields: values });
      } else {
        await dataManager.createChatChannel({
          groupId,
          name: values.name,
          category: values.category,
          threadTitle: values.threadTitle,
          mode: values.mode,
          linked: values.linked.kind ? values.linked : undefined,
        });
      }
    }, "Unable to save the channel.");
  }

  function threadRow(thread, channel, indent) {
    const row = el("div", "d-flex align-items-center gap-1");
    const button = el("button", `dropdown-item small d-flex justify-content-between align-items-center gap-2 ${indent}${thread.id === currentThreadId ? " active" : ""}`);
    button.type = "button";
    button.appendChild(el("span", "text-truncate", thread.title));
    if (thread.unread) button.appendChild(el("span", "badge text-bg-primary chat-unread-badge", String(thread.unread)));
    button.addEventListener("click", () => {
      closeMenu();
      onSelectThread?.(thread, channel);
    });
    row.appendChild(button);
    if (canArchive(thread)) row.appendChild(iconButton("tabler:archive", "Archive thread", () => void archiveThread(thread, channel)));
    return row;
  }

  function renderMenu() {
    menu.textContent = "";
    // Channels without a category come first, unlabelled. Each category then
    // reads as a section: a divider, an uppercase label, and its channels
    // indented beneath.
    groupByCategory(overview.channels).forEach(([category, channels], groupIndex) => {
      const hasCategories = Boolean(category);
      if (hasCategories) {
        if (groupIndex > 0) menu.appendChild(el("hr", "dropdown-divider"));
        menu.appendChild(el("h6", "dropdown-header text-uppercase fw-bold", category));
      }
      channels.forEach((channel) => {
        const header = el("div", `d-flex align-items-center gap-1 pt-2 ${hasCategories ? "ps-3 pe-2" : "px-2"}`);
        const hash = el("span", "iconify text-body-secondary");
        hash.dataset.icon = "tabler:hash";
        hash.setAttribute("aria-hidden", "true");
        header.appendChild(hash);
        header.appendChild(el("span", "small flex-grow-1 text-truncate", channel.name));
        if (channel.mode) header.appendChild(el("span", "badge text-bg-secondary", MODE_BADGES[channel.mode]));
        if (channel.unread) header.appendChild(el("span", "badge text-bg-primary chat-unread-badge", String(channel.unread)));
        if (canCreateThread(channel)) header.appendChild(iconButton("tabler:plus", "New thread", () => void newThread(channel)));
        if (isGm()) header.appendChild(iconButton("tabler:settings", "Edit channel", () => void editChannel(channel)));
        menu.appendChild(header);
        const active = channel.threads.filter((thread) => !thread.archivedAt);
        const archived = channel.threads.filter((thread) => thread.archivedAt);
        const threadIndent = hasCategories ? "ps-5" : "ps-4";
        active.forEach((thread) => menu.appendChild(threadRow(thread, channel, threadIndent)));
        if (archived.length) {
          const details = el("details", threadIndent);
          details.appendChild(el("summary", "small text-body-secondary", `Archived (${archived.length})`));
          archived.forEach((thread) => details.appendChild(threadRow(thread, channel, "ps-2")));
          menu.appendChild(details);
        }
      });
    });
    if (isGm()) {
      menu.appendChild(el("hr", "dropdown-divider"));
      const add = el("button", "dropdown-item small", "New channel");
      add.type = "button";
      add.addEventListener("click", () => void editChannel(null));
      menu.appendChild(add);
    }
  }

  function renderToggle() {
    const found = overview.channels.flatMap((channel) => channel.threads.map((thread) => ({ channel, thread }))).find(({ thread }) => thread.id === currentThreadId);
    toggle.textContent = found ? formatThreadLabel(found.channel.name, found.thread.title) : "Choose a thread";
    const elsewhere = overview.channels.reduce(
      (sum, channel) => sum + channel.threads.filter((thread) => thread.id !== currentThreadId && !thread.archivedAt).reduce((n, thread) => n + thread.unread, 0),
      0
    );
    if (elsewhere) toggle.appendChild(el("span", "badge text-bg-primary chat-unread-badge ms-2", String(elsewhere)));
    linkedHost.textContent = "";
    if (found?.channel.linked) {
      linkedHost.appendChild(
        createReferenceChip({
          kind: found.channel.linked.kind,
          id: found.channel.linked.id,
          name: "Linked",
          dataManager,
          interactive: true,
          onOpen: (kind, id) => {
            const url = buildKindToolUrl(kind, id);
            if (url) window.open(url, "_blank", "noopener");
          },
        })
      );
    }
  }

  return {
    element,
    update(nextOverview, threadId) {
      overview = nextOverview;
      currentThreadId = threadId || "";
      renderToggle();
      renderMenu();
    },
  };
}
