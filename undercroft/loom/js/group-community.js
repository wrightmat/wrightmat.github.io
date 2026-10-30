// Loom Groups tab — the community sections of the selected Group: its Campaigns,
// its Players, and its Recruitment listings. Campaigns and Players are small
// lists in the center; Recruitment follows the Sessions shape (list in the
// center, the editor in the right-pane inspector). Starting values in the
// forms are visible inputs, and whatever is saved is that record's own data;
// the server supplies no defaults.
import { el, setElementVisible } from "../../common/js/lib/dom.js";
import { createCollapsibleSection, createIconButton, createListRow } from "../../common/js/lib/ui-components.js";
import { initPropertySortable } from "../../common/js/lib/property-schema-editor.js";
import { showConfirmModal } from "../../common/js/lib/confirm-modal.js";
import { disposeTooltips, refreshTooltips } from "../../common/js/lib/tooltips.js";
import { initHelpSystem } from "../../common/js/lib/help.js";
import { buildTagInputRow, renderTagBadges, renderTagDatalist } from "../../common/js/lib/widgets/tag-editor.js";
import { loadCommunityReference, loadSystemChoices, systemTitle } from "../../common/js/lib/community/reference.js";
import { createScaleControl } from "../../common/js/lib/community/scale-control.js";
import { renderListingCard } from "../../common/js/lib/community/listing-card.js";
import { formatSessionDate } from "../../common/js/lib/sessions/format.js";

const CAMPAIGN_STATUSES = [
  ["active", "Active"],
  ["on_hiatus", "On hiatus"],
  ["completed", "Completed"],
];

function control(tag, attrs = {}) {
  const node = el(tag, tag === "select" ? "form-select form-select-sm" : "form-control form-control-sm");
  Object.entries(attrs).forEach(([key, value]) => {
    if (value === false || value == null) return;
    if (key === "value") node.value = value;
    else node.setAttribute(key, value === true ? "" : String(value));
  });
  return node;
}

function select(options, value) {
  const node = control("select");
  options.forEach(([optionValue, label]) => node.appendChild(new Option(label, optionValue)));
  if (value != null) node.value = value;
  return node;
}

function field(label, node) {
  const wrap = el("div", "d-flex flex-column gap-1");
  wrap.append(el("label", "form-label small text-body-secondary fw-semibold mb-0", label), node);
  return wrap;
}

function heading(text) {
  return el("h3", "fs-6 fw-semibold text-body-secondary mb-0 mt-1", text);
}

function badge(text, variant = "secondary") {
  return el("span", `badge text-bg-${variant}`, text);
}

function wholeNumber(node, label, minimum) {
  const value = Number(node.value);
  if (node.value === "" || !Number.isInteger(value) || value < minimum) {
    throw new Error(`${label} must be a whole number of at least ${minimum}.`);
  }
  return value;
}

export function initGroupCommunity({ dataManager, getStatus, campaignsMount, playersMount, recruitmentMount, inspectorMount, onGroupChanged, onCampaignsChanged, onInspect }) {
  let group = null;
  let campaigns = [];
  let listings = [];
  let selection = null;
  let reference = null;
  let systems = [];
  let loadToken = 0;
  let profileIsPublic = null;

  const say = (message, type = "success") => getStatus?.()?.show(message, { type, timeout: type === "danger" ? 4000 : 1600 });

  // --- Campaigns ---
  const campaignList = el("div", "d-flex flex-column gap-2");
  const campaignContent = el("div", "d-flex flex-column gap-2 border rounded-3 p-2");
  campaignContent.appendChild(campaignList);
  const campaignSection = createCollapsibleSection({
    label: "Campaigns",
    collapsed: false,
    helpTopic: "community.campaigns",
    actions: [{ icon: "tabler:plus", label: "Add campaign", onClick: () => addCampaignRow() }],
    content: campaignContent,
    className: "d-flex flex-column gap-2",
    panelClassName: "d-flex flex-column gap-2",
  });
  campaignsMount.appendChild(campaignSection.section);
  initPropertySortable(
    campaignList,
    {
      commitDragSnapshot: async () => {
        try {
          const ids = Array.from(campaignList.children).map((row) => row.dataset.entryId).filter(Boolean);
          campaigns = (await dataManager.reorderGroupCampaigns(group.id, ids)).campaigns;
          onCampaignsChanged?.(campaigns);
          say("Order saved.");
        } catch (error) {
          say(error.message || "Unable to save the order.", "danger");
        }
      },
    },
    { handle: "[data-sortable-handle]" },
  );

  function campaignRow(campaign) {
    const row = el("div", "d-flex flex-nowrap align-items-center gap-2");
    if (campaign) row.dataset.entryId = campaign.id;
    const grip = el("span", "flex-shrink-0 text-body-secondary d-inline-flex");
    grip.style.cursor = "grab";
    grip.dataset.sortableHandle = "";
    const gripIcon = el("span", "iconify");
    gripIcon.dataset.icon = "tabler:grip-vertical";
    gripIcon.setAttribute("aria-hidden", "true");
    grip.appendChild(gripIcon);
    const name = control("input", { type: "text", maxlength: 120, value: campaign?.name || "", placeholder: "Campaign name" });
    name.classList.add("flex-grow-1");
    name.style.minWidth = "0";
    const statusSelect = select(CAMPAIGN_STATUSES, campaign?.status || "active");
    statusSelect.classList.add("w-auto", "flex-shrink-0");
    const save = createIconButton({
      icon: "tabler:device-floppy",
      label: campaign ? "Save campaign" : "Create campaign",
      variant: "outline-primary",
      onClick: async () => {
        try {
          if (campaign) await dataManager.updateGroupCampaign(group.id, campaign.id, { name: name.value, status: statusSelect.value });
          else await dataManager.createGroupCampaign(group.id, { name: name.value, status: statusSelect.value });
          say(campaign ? "Campaign saved." : "Campaign created.");
          await reloadCampaigns();
          onCampaignsChanged?.(campaigns);
        } catch (error) {
          say(error.message || "Unable to save the campaign.", "danger");
        }
      },
    });
    row.append(grip, name, statusSelect, save);
    if (campaign) {
      row.appendChild(
        createIconButton({
          icon: "tabler:trash",
          label: "Delete campaign",
          variant: "outline-danger",
          onClick: async () => {
            const confirmed = await showConfirmModal({
              title: "Delete this campaign?",
              bodyHtml: '<p class="mb-0">Its sessions are kept and simply stop belonging to a campaign. Recorded history is unaffected.</p>',
              confirmLabel: "Delete campaign",
              confirmVariant: "danger",
            });
            if (!confirmed) return;
            try {
              await dataManager.deleteGroupCampaign(group.id, campaign.id);
              say("Campaign deleted.");
              await reloadCampaigns();
              onCampaignsChanged?.(campaigns);
            } catch (error) {
              say(error.message || "Unable to delete the campaign.", "danger");
            }
          },
        }),
      );
    }
    return row;
  }

  function renderCampaigns() {
    disposeTooltips(campaignList);
    campaignList.textContent = "";
    if (!campaigns.length) campaignList.appendChild(el("p", "small text-body-secondary mb-0", "No campaigns. Sessions can still belong to the group on their own."));
    campaigns.forEach((campaign) => campaignList.appendChild(campaignRow(campaign)));
    refreshTooltips(campaignList);
  }

  function addCampaignRow() {
    if (!group) return;
    campaignList.prepend(campaignRow(null));
    refreshTooltips(campaignList);
  }

  async function reloadCampaigns() {
    if (!group) return;
    try {
      campaigns = (await dataManager.getGroupCampaigns(group.id)).campaigns;
    } catch (error) {
      campaigns = [];
      say(error.message || "Unable to load campaigns.", "danger");
    }
    renderCampaigns();
  }

  // --- Players ---
  const playerList = el("div", "d-flex flex-column gap-1");
  const playerContent = el("div", "d-flex flex-column gap-1 border rounded-3 p-2");
  playerContent.appendChild(playerList);
  const playerSection = createCollapsibleSection({
    label: "Players",
    collapsed: false,
    helpTopic: "community.players",
    actions: [{ icon: "tabler:plus", label: "Add player", onClick: () => openAddPlayer() }],
    content: playerContent,
    className: "d-flex flex-column gap-2",
    panelClassName: "d-flex flex-column gap-2",
  });
  playersMount.appendChild(playerSection.section);

  async function openAddPlayer() {
    if (!group || playerContent.querySelector("[data-add-player]")) return;
    let usernames;
    try {
      usernames = (await dataManager.getAddableGroupPlayers(group.id)).players;
    } catch (error) {
      say(error.message || "Unable to load accounts.", "danger");
      return;
    }
    const row = el("div", "d-flex flex-nowrap align-items-center gap-2");
    row.dataset.addPlayer = "";
    // Typing filters the suggestions; the server still checks the name is a real account.
    const suggestions = el("datalist");
    suggestions.id = `add-player-options-${group.id}`;
    usernames.forEach((username) => suggestions.appendChild(new Option(username)));
    const name = control("input", {
      type: "text",
      maxlength: 80,
      list: suggestions.id,
      placeholder: usernames.length ? "Choose or type a username" : "No other accounts to add",
      "aria-label": "Player to add",
      autocomplete: "off",
    });
    name.disabled = !usernames.length;
    if (!usernames.length) name.title = "Every active account is already in this group.";
    name.classList.add("flex-grow-1");
    name.style.minWidth = "0";
    const submit = async () => {
      try {
        const added = await dataManager.addGroupPlayer(group.id, name.value);
        say(`${added.player.username} added to the group.`);
        onGroupChanged?.();
      } catch (error) {
        say(error.message || "Unable to add the player.", "danger");
      }
    };
    name.addEventListener("keydown", (event) => {
      if (event.key === "Enter") void submit();
    });
    row.append(
      name,
      suggestions,
      createIconButton({ icon: "tabler:user-plus", label: "Add player", variant: "outline-primary", onClick: submit }),
      createIconButton({ icon: "tabler:x", label: "Cancel", variant: "outline-secondary", onClick: () => row.remove() }),
    );
    playerContent.prepend(row);
    refreshTooltips(row);
    name.focus();
  }

  function renderPlayers() {
    disposeTooltips(playerList);
    playerList.textContent = "";
    const players = group?.players || [];
    if (!players.length) {
      playerList.appendChild(el("p", "small text-body-secondary mb-0", "No players yet. They join by being accepted from a listing, or when a character they own is added to the roster."));
    }
    players.forEach((player) => {
      const row = el("div", "d-flex align-items-center justify-content-between gap-2 small");
      row.append(el("span", "fw-semibold", player.username), el("span", "text-body-secondary flex-grow-1", `joined ${formatSessionDate(player.joined_at)}`));
      row.appendChild(
        createIconButton({
          icon: "tabler:user-minus",
          label: "Remove player",
          variant: "outline-danger",
          onClick: async () => {
            const confirmed = await showConfirmModal({
              title: `Remove ${player.username}?`,
              bodyHtml: "<p class=\"mb-0\">They leave the group and their characters come off the roster. A removal doesn't count against anyone's retention.</p>",
              confirmLabel: "Remove player",
              confirmVariant: "danger",
            });
            if (!confirmed) return;
            try {
              await dataManager.removeGroupPlayer(group.id, player.user_id);
              say("Player removed.");
              onGroupChanged?.();
            } catch (error) {
              say(error.message || "Unable to remove the player.", "danger");
            }
          },
        }),
      );
      playerList.appendChild(row);
    });
    refreshTooltips(playerList);
  }

  // --- Recruitment: list ---
  const listingList = el("div", "d-flex flex-column gap-2");
  const publicNote = el("p", "small text-warning mb-0");
  const listingContent = el("div", "d-flex flex-column gap-2 border rounded-3 p-2");
  listingContent.append(publicNote, listingList);
  const recruitmentSection = createCollapsibleSection({
    label: "Recruitment",
    collapsed: false,
    helpTopic: "community.recruiting",
    actions: [{ icon: "tabler:plus", label: "Add listing", onClick: () => select_({ kind: "new" }) }],
    content: listingContent,
    className: "d-flex flex-column gap-2",
    panelClassName: "d-flex flex-column gap-2",
  });
  recruitmentMount.appendChild(recruitmentSection.section);

  const inspectorBody = el("div", "d-flex flex-column gap-3");
  const inspectorParts = createCollapsibleSection({
    label: "Listing Inspector",
    collapsed: false,
    content: inspectorBody,
    className: "d-flex flex-column gap-3",
    panelClassName: "d-flex flex-column gap-3",
  });
  inspectorMount.appendChild(inspectorParts.section);
  setElementVisible(inspectorParts.section, false, "flex");

  function listingTitle(listing) {
    const name = listing.systemId ? systemTitle(systems, listing.systemId) : listing.systemName;
    return `${listing.targetKind === "campaign" ? listing.campaignName || "Campaign" : listing.schedule[0]?.title || "Session"} · ${name}`;
  }

  function renderListings() {
    disposeTooltips(listingList);
    listingList.textContent = "";
    publicNote.textContent =
      profileIsPublic === false ? "Your profile must be public before you can list a game. Make it public in Account Settings → Profile." : "";
    publicNote.hidden = !publicNote.textContent;
    if (!listings.length) listingList.appendChild(el("p", "small text-body-secondary mb-0", "No listings. Use + to advertise a session or campaign."));
    listings.forEach((listing) => {
      // The same row as a session's, so the two lists highlight alike.
      const row = createListRow({
        title: listingTitle(listing),
        description: `${listing.openSeats} of ${listing.seatsOffered} seats open`,
        onSelect: () => select_({ kind: "listing", id: listing.id }),
      });
      row.classList.add("loom-session-row");
      if (selection?.id === listing.id) row.classList.add("border-primary");
      const chips = el("div", "d-flex flex-wrap gap-1 mt-1");
      chips.appendChild(badge(listing.status === "open" ? "Open" : listing.status === "filled" ? "Filled" : "Closed", listing.status === "open" ? "success" : "secondary"));
      row.querySelector(".flex-grow-1").appendChild(chips);
      listingList.appendChild(row);
    });
    refreshTooltips(listingList);
  }

  async function reloadListings() {
    if (!group) return;
    const token = ++loadToken;
    try {
      const result = await dataManager.listCommunityListings({ groupId: group.id });
      if (token !== loadToken) return;
      listings = result.listings;
    } catch (error) {
      listings = [];
      say(error.message || "Unable to load listings.", "danger");
    }
    renderListings();
    renderInspector();
  }

  function select_(next) {
    selection = next;
    if (next) onInspect?.();
    renderListings();
    renderInspector();
  }

  // --- Recruitment: inspector ---
  let toolbarGroup = null;
  function setToolbar(buttons) {
    disposeTooltips(toolbarGroup);
    toolbarGroup.textContent = "";
    toolbarGroup.append(...buttons);
    refreshTooltips(toolbarGroup);
  }
  const toolbarButton = (config) => createIconButton({ variant: "outline-secondary", kind: "toolbar", tooltipPlacement: "top", ...config });

  async function buildListingForm(initial) {
    const root = el("div", "d-flex flex-column gap-2");
    const sessionData = await dataManager.getGroupSessions(group.id).catch(() => ({ series: [] }));
    const openSeries = (sessionData.series || []).filter((series) => !series.endedAt);
    const openCampaigns = campaigns.filter((campaign) => campaign.status !== "completed" || campaign.id === initial?.campaignId);
    const targetKind = select([["campaign", "A whole campaign"], ["session", "A single session"]], initial?.targetKind || (openCampaigns.length ? "campaign" : "session"));
    const campaignSelect = select(openCampaigns.map((campaign) => [campaign.id, campaign.name]), initial?.campaignId || openCampaigns[0]?.id || "");
    const sessionSelect = select(openSeries.map((series) => [series.id, series.title]), initial?.sessionId || openSeries[0]?.id || "");
    const systemSelect = select([["", "Another system (type below)"], ...systems.map((system) => [system.id, system.title])], initial ? initial.systemId || "" : group.system_id || "");
    const systemName = control("input", { type: "text", maxlength: 120, value: initial?.systemName || "", placeholder: "System name" });
    const seats = control("input", { type: "number", min: 1, value: initial?.seatsOffered ?? 1 });
    const decline = control("input", { type: "number", min: 1, value: initial?.autoDeclineDays ?? 7 });
    const sessionLength = select([["", "Not stated"], ...reference.options.sessionLength.map((o) => [o.id, o.label])], initial?.sessionLength || "");
    const ageRange = select([["", "Not stated"], ...reference.options.ageRange.map((o) => [o.id, o.label])], initial?.ageRange || "");
    const platform = select([["", "Not stated"], ...reference.options.platform.map((o) => [o.id, o.label])], initial?.platform || "");
    const description = control("textarea", { rows: 4, value: initial?.description || "" });
    const statusSelect = select([["open", "Open"], ["closed", "Closed"]], initial?.status === "closed" ? "closed" : "open");

    const scales = { ...(initial?.scales || {}) };
    const scaleBox = el("div", "d-flex flex-column gap-2");
    reference.scales.forEach((scale) => {
      scaleBox.appendChild(
        createScaleControl(scale, scales[scale.id], {
          points: reference.points,
          onChange: (value) => {
            if (value == null) delete scales[scale.id];
            else scales[scale.id] = value;
          },
        }).element,
      );
    });

    const tools = new Set(initial?.safetyTools || []);
    const toolBox = el("div", "d-flex flex-column gap-1");
    reference.safetyTools.forEach((tool) => {
      const wrap = el("label", "form-check small d-flex align-items-center gap-2 mb-0");
      const box = el("input", "form-check-input mt-0");
      box.type = "checkbox";
      box.checked = tools.has(tool.id);
      box.addEventListener("change", () => (box.checked ? tools.add(tool.id) : tools.delete(tool.id)));
      wrap.append(box, el("span", "form-check-label", tool.name));
      toolBox.appendChild(wrap);
    });

    const usage = await dataManager.getCommunityTags().catch(() => ([]));
    const tagEditor = (kind, label, start) => {
      const values = [...start];
      const host = el("div", "d-flex flex-column gap-1");
      const datalistId = `loom-listing-${kind}-tags`;
      renderTagDatalist(datalistId, usage.map((entry) => ({ label: entry.tag })));
      const draw = () => {
        host.textContent = "";
        host.appendChild(renderTagBadges(values, [], { removable: true, onRemove: (tag) => { values.splice(values.indexOf(tag), 1); draw(); } }));
        const { row, visibilityButton } = buildTagInputRow(datalistId, {
          placeholder: "Add a tag…",
          onAdd: (tag) => {
            if (!values.some((existing) => existing.toLowerCase() === tag.toLowerCase())) values.push(tag);
            draw();
          },
        });
        visibilityButton.remove();
        host.appendChild(row);
      };
      draw();
      return { values, node: field(label, host) };
    };
    const tagList = tagEditor("tags", "Tags", initial?.tags || []);

    const targetRow = el("div", "d-flex flex-column gap-2");
    const syncTarget = () => {
      setElementVisible(campaignField, targetKind.value === "campaign", "flex");
      setElementVisible(sessionField, targetKind.value === "session", "flex");
      systemName.hidden = Boolean(systemSelect.value);
    };
    const campaignField = field("Campaign", campaignSelect);
    const sessionField = field("Session", sessionSelect);
    targetKind.addEventListener("change", syncTarget);
    systemSelect.addEventListener("change", syncTarget);
    targetRow.append(field("Advertise", targetKind), campaignField, sessionField);
    const seatRow = el("div", "row g-2");
    [field("Seats offered", seats), field("Auto-decline after (days)", decline)].forEach((node) => {
      const col = el("div", "col-6");
      col.appendChild(node);
      seatRow.appendChild(col);
    });
    const systemBox = el("div", "d-flex flex-column gap-1");
    systemBox.append(systemSelect, systemName);
    root.append(
      heading("Target"),
      targetRow,
      heading("Game"),
      field("System", systemBox),
      seatRow,
      field("Session length", sessionLength),
      field("Age range", ageRange),
      field("Platform", platform),
      heading("What it's like"),
      scaleBox,
      tagList.node,
      field("Safety tools", toolBox),
      field("Description", description),
      heading("Status"),
      field("Listing is", statusSelect),
    );
    syncTarget();

    return {
      element: root,
      read() {
        const data = {
          groupId: group.id,
          targetKind: targetKind.value,
          sessionId: targetKind.value === "session" ? sessionSelect.value : null,
          campaignId: targetKind.value === "campaign" ? campaignSelect.value : null,
          systemId: systemSelect.value || null,
          systemName: systemSelect.value ? null : systemName.value.trim(),
          seatsOffered: wholeNumber(seats, "Seats offered", 1),
          autoDeclineDays: wholeNumber(decline, "The auto-decline period", 1),
          sessionLength: sessionLength.value || null,
          ageRange: ageRange.value || null,
          platform: platform.value || null,
          scales,
          tags: tagList.values,
          safetyTools: [...tools],
          description: description.value.trim(),
          status: statusSelect.value,
        };
        if (!data.systemId && !data.systemName) throw new Error("Choose or name the game system.");
        if (data.targetKind === "campaign" && !data.campaignId) throw new Error("Choose a campaign, or add one first.");
        if (data.targetKind === "session" && !data.sessionId) throw new Error("Choose a session, or add one first.");
        return data;
      },
    };
  }

  async function showListing(selected) {
    const existing = selected.kind === "listing" ? listings.find((listing) => listing.id === selected.id) : null;
    if (selected.kind === "listing" && !existing) return select_(null);
    const token = loadToken;
    const form = await buildListingForm(existing);
    if (selection !== selected || token !== loadToken) return;
    const buttons = [
      toolbarButton({
        icon: "tabler:device-floppy",
        label: existing ? "Save listing" : "Create listing",
        variant: "primary",
        onClick: async () => {
          try {
            const data = form.read();
            if (existing) {
              await dataManager.saveCommunityListing({ ...data, id: existing.id });
            } else {
              await dataManager.saveCommunityListing(data);
            }
            say("Listing saved.");
            selection = null;
            await reloadListings();
          } catch (error) {
            say(error.message || "Unable to save the listing.", "danger");
          }
        },
      }),
      toolbarButton({ icon: "tabler:x", label: "Close", onClick: () => select_(null) }),
    ];
    if (existing) {
      buttons.push(
        toolbarButton({
          icon: "tabler:trash",
          label: "Delete listing",
          variant: "outline-danger",
          onClick: async () => {
            const confirmed = await showConfirmModal({
              title: "Delete this listing?",
              bodyHtml: '<p class="mb-0">Applications already made are kept in their conversations.</p>',
              confirmLabel: "Delete listing",
              confirmVariant: "danger",
            });
            if (!confirmed) return;
            try {
              await dataManager.deleteCommunityListing(existing.id);
              say("Listing deleted.");
              selection = null;
              await reloadListings();
            } catch (error) {
              say(error.message || "Unable to delete the listing.", "danger");
            }
          },
        }),
      );
    }
    setToolbar(buttons);
    inspectorBody.append(el("h3", "h6 mb-0", existing ? "Edit listing" : "New listing"));
    if (existing) inspectorBody.appendChild(renderListingCard(existing, { reference, systems }));
    inspectorBody.appendChild(form.element);
  }

  function renderInspector() {
    disposeTooltips(inspectorBody);
    inspectorBody.textContent = "";
    const toolbar = el("div", "btn-toolbar justify-content-center overflow-x-auto");
    toolbar.setAttribute("role", "toolbar");
    toolbar.setAttribute("aria-label", "Listing actions");
    toolbarGroup = el("div", "btn-group");
    toolbar.appendChild(toolbarGroup);
    inspectorBody.appendChild(toolbar);
    if (!selection || !group) {
      setElementVisible(inspectorParts.section, false, "flex");
      return;
    }
    setElementVisible(inspectorParts.section, true, "flex");
    void showListing(selection).then(() => {
      void initHelpSystem({ root: inspectorBody });
      refreshTooltips(inspectorBody);
    });
  }

  async function ensureReference() {
    if (reference) return;
    [reference, systems] = await Promise.all([loadCommunityReference(), loadSystemChoices(dataManager)]);
  }

  return {
    async showGroup(nextGroup) {
      const changed = !group || group.id !== nextGroup.id;
      group = nextGroup;
      if (changed) {
        selection = null;
        listings = [];
        campaigns = [];
      }
      renderPlayers();
      try {
        await ensureReference();
        const profile = await dataManager.getCommunityProfile().catch(() => null);
        profileIsPublic = profile ? Boolean(profile.profile?.public) : null;
      } catch (error) {
        say(error.message || "Unable to load the community data.", "danger");
        return;
      }
      await Promise.all([reloadCampaigns(), reloadListings()]);
      onCampaignsChanged?.(campaigns);
    },
    deselect() {
      if (selection) {
        selection = null;
        renderListings();
        renderInspector();
      }
    },
    clear() {
      group = null;
      selection = null;
      campaigns = [];
      listings = [];
      campaignList.textContent = "";
      playerList.textContent = "";
      listingList.textContent = "";
      renderInspector();
    },
    addListing() {
      if (group) select_({ kind: "new" });
    },
  };
}
