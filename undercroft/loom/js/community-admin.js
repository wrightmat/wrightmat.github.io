// Loom's Community tab (admins): every community-defined list in one place, all edited the
// same way — a collapsible section of one-line rows with a drag grip, Save and Delete, and a +
// to add. Other tiers add to fonts, clips, tokens and page sizes from the tools themselves.
import { el } from "../../common/js/lib/dom.js";
import { createCollapsibleSection, createIconButton } from "../../common/js/lib/ui-components.js";
import { showConfirmModal } from "../../common/js/lib/confirm-modal.js";
import { refreshTooltips } from "../../common/js/lib/tooltips.js";
import { initHelpSystem } from "../../common/js/lib/help.js";
import { initPropertySortable } from "../../common/js/lib/property-schema-editor.js";
import { invalidateCommunityReference, loadCommunityReference, loadSharedList } from "../../common/js/lib/community/reference.js";
import { renderServiceIcon } from "../../common/js/lib/community/service-badge.js";
import { createSystemNamesList } from "./system-names-admin.js";

const PHASES = [
  ["before", "Before play"],
  ["during", "During play"],
  ["after", "After play"],
];
const SERVICE_CATEGORIES = [
  ["play", "Play service"],
  ["social", "Social media"],
];
const APPLIES_TO = [
  ["gm", "GMs"],
  ["player", "Players"],
  ["both", "GMs and players"],
];

function input(attrs = {}) {
  const node = el("input", "form-control form-control-sm");
  Object.entries(attrs).forEach(([key, value]) => (value == null ? null : node.setAttribute(key, String(value))));
  if (attrs.value != null) node.value = attrs.value;
  return node;
}

// Every row in this tab is one line: grip, qualifier, name, description, actions.
const ROW_CLASS = "d-flex flex-nowrap align-items-center gap-2 py-1";
const QUALIFIER_STYLE = "width: 9.5rem; flex: 0 0 9.5rem;";
const NAME_STYLE = "width: 14rem; flex: 0 0 14rem;";
const NARROW_STYLE = "width: 6.5rem; flex: 0 0 6.5rem;";

// An input that fills the rest of the row.
function wide(node) {
  node.classList.add("flex-grow-1");
  node.style.minWidth = "8rem";
  return node;
}

function sized(node, style) {
  node.style.cssText = style;
  return node;
}

function grip() {
  const handle = el("span", "flex-shrink-0 text-body-secondary d-inline-flex");
  handle.style.cursor = "grab";
  handle.dataset.sortableHandle = "";
  const icon = el("span", "iconify");
  icon.dataset.icon = "tabler:grip-vertical";
  icon.setAttribute("aria-hidden", "true");
  handle.appendChild(icon);
  return handle;
}

function select(options, value) {
  const node = el("select", "form-select form-select-sm");
  node.style.cssText = QUALIFIER_STYLE;
  options.forEach(([optionValue, label]) => node.appendChild(new Option(label, optionValue)));
  node.value = value;
  return node;
}

// One collapsible section in a card; `actions` are the header's icon buttons (e.g. add).
function card(title, helpTopic, content, actions = [], collapsed = false) {
  const wrap = el("div", "card shadow-theme");
  const body = el("div", "card-body");
  body.appendChild(
    createCollapsibleSection({
      label: title,
      collapsed,
      helpTopic,
      actions,
      content,
      className: "d-flex flex-column gap-3",
      panelClassName: "d-flex flex-column gap-2",
    }).section,
  );
  wrap.appendChild(body);
  return wrap;
}

export function initCommunityAdmin({ dataManager, getStatus, mount }) {
  const say = (message, type = "success") => getStatus?.()?.show(message, { type, timeout: type === "danger" ? 4000 : 1600 });
  const root = el("div", "d-flex flex-column gap-4");
  mount.appendChild(root);

  async function guard(work, success, failure) {
    try {
      await work();
      if (success) say(success);
    } catch (error) {
      say(error.message || failure, "danger");
    }
  }

  // A reorderable list of saved entries. `load` returns the entries; each has an `id`.
  function listCard({ title, helpTopic, listName, load, makeRow, collapsed = true }) {
    const list = el("div", "d-flex flex-column gap-1");
    const rebuild = async () => {
      invalidateCommunityReference();
      list.replaceChildren(...(await load()).map((entry) => makeRow(entry, rebuild)));
      refreshTooltips(list);
    };
    void rebuild().catch((error) => list.replaceChildren(el("p", "small text-danger mb-0", error.message || "Unable to load the list.")));
    initPropertySortable(
      list,
      {
        commitDragSnapshot: () =>
          guard(
            async () => {
              const ids = Array.from(list.children).map((row) => row.dataset.entryId).filter(Boolean);
              await dataManager.saveCommunityListOrder(listName, ids);
              invalidateCommunityReference();
            },
            "Order saved.",
            "Unable to save the order.",
          ),
      },
      { handle: "[data-sortable-handle]" },
    );
    return card(title, helpTopic, list, [{ icon: "tabler:plus", label: "Add", onClick: () => list.prepend(makeRow(null, rebuild)) }], collapsed);
  }

  function actionButtons({ entry, read, listName, onSaved }) {
    const group = el("div", "d-flex flex-nowrap gap-1 flex-shrink-0");
    group.appendChild(
      createIconButton({
        icon: "tabler:device-floppy",
        label: entry ? "Save" : "Create",
        variant: "outline-primary",
        onClick: () =>
          guard(
            async () => {
              await dataManager.saveCommunityListItem(listName, { ...(entry ? { id: entry.id } : {}), ...read() });
              await onSaved();
            },
            "Saved.",
            "Unable to save.",
          ),
      }),
    );
    if (entry) {
      group.appendChild(
        createIconButton({
          icon: "tabler:trash",
          label: "Delete",
          variant: "outline-danger",
          onClick: async () => {
            const confirmed = await showConfirmModal({
              title: "Delete this entry?",
              bodyHtml: '<p class="mb-0">Anything that already uses it keeps working, but it is no longer offered.</p>',
              confirmLabel: "Delete",
              confirmVariant: "danger",
            });
            if (!confirmed) return;
            await guard(
              async () => {
                await dataManager.deleteCommunityListItem(listName, entry.id);
                await onSaved();
              },
              "Deleted.",
              "Unable to delete.",
            );
          },
        }),
      );
    }
    return group;
  }

  // grip, optional qualifier, the entry's own fields, actions.
  function itemRow({ entry, listName, qualifier, fields, read, onSaved }) {
    const row = el("div", ROW_CLASS);
    if (entry) row.dataset.entryId = entry.id;
    row.append(grip(), ...(qualifier ? [qualifier] : []), ...fields, actionButtons({ entry, read, listName, onSaved }));
    return row;
  }

  const community = (getItems) => async () => getItems(await loadCommunityReference());

  const lists = [
    {
      title: "Safety tools", helpTopic: "community.safetyTools", listName: "safety-tools", collapsed: false,
      load: community((r) => r.safetyTools),
      makeRow: (entry, onSaved) => {
        const phase = select(PHASES, entry?.phase || "before");
        const name = sized(input({ type: "text", maxlength: 120, value: entry?.name || "", placeholder: "Name" }), NAME_STYLE);
        const description = wide(input({ type: "text", maxlength: 500, value: entry?.description || "", placeholder: "Short description" }));
        return itemRow({ entry, listName: "safety-tools", qualifier: phase, fields: [name, description], onSaved,
          read: () => ({ name: name.value, phase: phase.value, description: description.value }) });
      },
    },
    {
      title: "Endorsement tags", helpTopic: "community.endorsements", listName: "endorsements", collapsed: false,
      load: community((r) => r.endorsements),
      makeRow: (entry, onSaved) => {
        const applies = select(APPLIES_TO, entry?.appliesTo || "both");
        const name = wide(input({ type: "text", maxlength: 80, value: entry?.name || "", placeholder: "Tag" }));
        return itemRow({ entry, listName: "endorsements", qualifier: applies, fields: [name], onSaved,
          read: () => ({ name: name.value, appliesTo: applies.value }) });
      },
    },
    {
      title: "External services", helpTopic: "community.services", listName: "services", collapsed: false,
      load: community((r) => r.services),
      makeRow: (entry, onSaved) => {
        const category = select(SERVICE_CATEGORIES, entry?.category || "play");
        const name = sized(input({ type: "text", maxlength: 60, value: entry?.name || "", placeholder: "Name" }), NAME_STYLE);
        const icon = sized(input({ type: "text", maxlength: 300, value: entry?.icon || "", placeholder: "tabler:brand-discord or https://…" }), NAME_STYLE);
        const preview = el("span", "flex-shrink-0 d-inline-flex align-items-center");
        preview.style.cssText = "width: 1.25rem;";
        const drawPreview = () => preview.replaceChildren(renderServiceIcon(icon.value.trim()));
        icon.addEventListener("input", drawPreview);
        drawPreview();
        const link = wide(input({ type: "text", maxlength: 300, value: entry?.linkPattern || "", placeholder: "Profile link, e.g. https://example.com/{username} (optional)" }));
        return itemRow({ entry, listName: "services", qualifier: category, fields: [name, preview, icon, link], onSaved,
          read: () => ({ name: name.value, category: category.value, icon: icon.value, linkPattern: link.value }) });
      },
    },
    {
      title: "Chat reactions", helpTopic: "community.reactions", listName: "reactions",
      load: () => loadSharedList("chat-reactions.json", "emoji"),
      makeRow: (entry, onSaved) => {
        const emoji = sized(input({ type: "text", maxlength: 16, value: entry?.emoji || "", placeholder: "Emoji" }), NARROW_STYLE);
        const description = wide(input({ type: "text", maxlength: 120, value: entry?.description || "", placeholder: "Description (shown as a tooltip)" }));
        return itemRow({ entry, listName: "reactions", fields: [emoji, description], onSaved,
          read: () => ({ emoji: emoji.value, description: description.value }) });
      },
    },
    {
      title: "Fonts", helpTopic: "community.fonts", listName: "fonts",
      load: () => loadSharedList("custom-fonts.json", "fonts"),
      makeRow: (entry, onSaved) => {
        const label = sized(input({ type: "text", maxlength: 120, value: entry?.label || "", placeholder: "Name" }), NAME_STYLE);
        const family = wide(input({ type: "text", maxlength: 300, value: entry?.family || "", placeholder: "CSS font-family" }));
        const google = sized(input({ type: "text", maxlength: 200, value: entry?.googleFont || "", placeholder: "Google Fonts name" }), NAME_STYLE);
        return itemRow({ entry, listName: "fonts", fields: [label, family, google], onSaved,
          read: () => ({ label: label.value, family: family.value, googleFont: google.value }) });
      },
    },
    {
      title: "Audio clips", helpTopic: "community.clips", listName: "clips",
      load: () => loadSharedList("audio-clips.json", "clips"),
      makeRow: (entry, onSaved) => {
        const type = select([["music", "Music"], ["sfx", "Sound effect"]], entry?.type || "music");
        const name = sized(input({ type: "text", maxlength: 200, value: entry?.name || "", placeholder: "Name" }), NAME_STYLE);
        const url = wide(input({ type: "url", maxlength: 2000, value: entry?.url || "", placeholder: "https://" }));
        const loop = el("label", "form-check small d-flex align-items-center gap-1 mb-0 flex-shrink-0");
        const loopBox = el("input", "form-check-input mt-0");
        loopBox.type = "checkbox";
        loopBox.checked = Boolean(entry?.loop);
        loop.append(loopBox, el("span", "form-check-label", "Loop"));
        return itemRow({ entry, listName: "clips", qualifier: type, fields: [name, url, loop], onSaved,
          read: () => ({ name: name.value, url: url.value, type: type.value, loop: loopBox.checked }) });
      },
    },
    {
      title: "Map tokens", helpTopic: "community.tokens", listName: "tokens",
      load: () => loadSharedList("token-library.json", "tokens"),
      makeRow: (entry, onSaved) => {
        const name = sized(input({ type: "text", maxlength: 200, value: entry?.name || "", placeholder: "Name" }), NAME_STYLE);
        const url = wide(input({ type: "url", maxlength: 2000, value: entry?.url || "", placeholder: "https://" }));
        return itemRow({ entry, listName: "tokens", fields: [name, url], onSaved, read: () => ({ name: name.value, url: url.value }) });
      },
    },
    {
      title: "Page sizes", helpTopic: "community.pageSizes", listName: "sizes",
      load: () => loadSharedList("../../press/data/custom-page-sizes.json", "sizes"),
      makeRow: (entry, onSaved) => {
        const label = sized(input({ type: "text", maxlength: 120, value: entry?.label || "", placeholder: "Name" }), NAME_STYLE);
        const width = sized(input({ type: "number", min: 0, step: "any", value: entry?.width ?? "", placeholder: "Width (in)" }), NARROW_STYLE);
        const height = sized(input({ type: "number", min: 0, step: "any", value: entry?.height ?? "", placeholder: "Height (in)" }), NARROW_STYLE);
        return itemRow({ entry, listName: "sizes", fields: [label, width, height, wide(el("span"))], onSaved,
          read: () => ({ label: label.value, width: Number(width.value), height: Number(height.value) }) });
      },
    },
  ];

  // Listing tags: the curated list in its own order, then any tag a listing uses that isn't on it.
  async function tagsCard() {
    const host = el("div", "d-flex flex-column gap-1");
    async function draw() {
      let usage;
      try {
        usage = await dataManager.getCommunityTags();
      } catch (error) {
        host.replaceChildren(el("p", "small text-danger mb-0", error.message || "Unable to load tags."));
        return;
      }
      host.replaceChildren();
      invalidateCommunityReference();
      usage.forEach((entry) => {
        const row = el("div", ROW_CLASS);
        if (entry.id) row.dataset.entryId = entry.id;
        const name = wide(input({ type: "text", maxlength: 40, value: entry.tag }));
        const usageText = el("span", "small text-body-secondary flex-shrink-0", `${entry.count} listing${entry.count === 1 ? "" : "s"}`);
        usageText.style.cssText = "width: 5.5rem;";
        const buttons = el("div", "d-flex flex-nowrap gap-1 flex-shrink-0");
        buttons.append(
          createIconButton({
            icon: "tabler:device-floppy",
            label: "Rename, or merge into an existing tag",
            variant: "outline-primary",
            onClick: () =>
              guard(async () => {
                await dataManager.rewriteCommunityTag({ from: entry.tag, to: name.value.trim() });
                await draw();
              }, "Tag updated.", "Unable to update the tag."),
          }),
          createIconButton({
            icon: "tabler:trash",
            label: "Remove, including from every listing that carries it",
            variant: "outline-danger",
            onClick: async () => {
              const confirmed = await showConfirmModal({
                title: `Remove "${entry.tag}"?`,
                bodyHtml: '<p class="mb-0">It is taken off every listing that carries it.</p>',
                confirmLabel: "Remove",
                confirmVariant: "danger",
              });
              if (!confirmed) return;
              await guard(async () => {
                await dataManager.rewriteCommunityTag({ from: entry.tag, to: "" });
                await draw();
              }, "Tag removed.", "Unable to remove the tag.");
            },
          }),
        );
        row.append(...(entry.id ? [grip()] : [sized(el("span"), "width: 1rem; flex: 0 0 1rem;")]), name, usageText, buttons);
        host.appendChild(row);
      });
      refreshTooltips(host);
    }
    function addRow() {
      const row = el("div", ROW_CLASS);
      const name = wide(input({ type: "text", maxlength: 40, placeholder: "Tag" }));
      const save = createIconButton({
        icon: "tabler:device-floppy",
        label: "Create",
        variant: "outline-primary",
        onClick: () =>
          guard(async () => {
            await dataManager.saveCommunityListItem("tags", { name: name.value });
            await draw();
          }, "Tag added.", "Unable to add the tag."),
      });
      row.append(sized(el("span"), "width: 1rem; flex: 0 0 1rem;"), name, save);
      host.prepend(row);
      refreshTooltips(row);
    }
    initPropertySortable(
      host,
      {
        commitDragSnapshot: () =>
          guard(
            async () => {
              await dataManager.saveCommunityListOrder("tags", Array.from(host.children).map((row) => row.dataset.entryId).filter(Boolean));
              invalidateCommunityReference();
            },
            "Order saved.",
            "Unable to save the order.",
          ),
      },
      { handle: "[data-sortable-handle]" },
    );
    await draw();
    return card("Listing tags", "community.tags", host, [{ icon: "tabler:plus", label: "Add", onClick: addRow }], false);
  }

  // Systems people typed by hand: counted as people, then renamed, merged, or converted to a Library System.
  async function systemNamesCard() {
    const names = createSystemNamesList({ dataManager, say });
    await names.refresh();
    return card(
      "Systems people name",
      "loom.systemNames",
      names.element,
      [{ icon: "tabler:refresh", label: "Refresh", onClick: () => guard(() => names.refresh(), null, "Unable to load the system names.") }],
      false,
    );
  }

  return {
    async show() {
      root.replaceChildren(el("p", "text-body-secondary mb-0", "Loading…"));
      try {
        const [first, second, ...rest] = lists.map(listCard);
        root.replaceChildren(first, second, await tagsCard(), await systemNamesCard(), ...rest);
        void initHelpSystem({ root });
        refreshTooltips(root);
      } catch (error) {
        root.replaceChildren(el("p", "text-danger mb-0", error.message || "Unable to load the community lists."));
      }
    },
  };
}
