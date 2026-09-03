// Renders one specific library entity as a real Press print card — reuses
// Workbench's own "Now Showing" panel render path (createTemplate +
// template.createPage), not a parallel reimplementation.
//
// Also replaces the old "Show to table" buttons that used to live in
// Sanctum/Forge/Crucible/Vault: a GM adds a Handout to their own dashboard
// (picking the record + a print template via openHandoutPicker below) and
// toggles visibility from here — the dashboard is now the one place that
// shows what's currently visible to the table, instead of a separate,
// easy-to-forget action buried in whichever tool the GM happened to be in.
import { createTemplate, getFormatById, getPageSize } from "../../../../press/js/templates.js";
import {
  applyAutoWidthCaps,
  applyAutoFontSizing,
  applyOverflowIndicators,
} from "../../../../press/js/template-renderer.js";
import { loadLibraryData, fetchKindEntriesWithIds, loadLibraryKinds } from "../content-fetch.js";
import { resolveIsSpotlighted, listPrintTemplates } from "../spotlight.js";
import { resolveToolContextPath } from "../app-shell.js";
import { el } from "../dom.js";
import { disposeTooltips, refreshTooltips } from "../tooltips.js";
// Journal pages are plain markdown text, never a Press template, so they get
// a completely different render path below (renderJournalEntry).
import { renderMarkdown } from "../../../../repository/js/lib/markdown.js";
import { buildTitleIndex } from "../../../../repository/js/lib/journal-links.js";
import { startEncounter, deterministicEncounterId } from "../../../../repository/js/lib/journal-encounter.js";
import { extractOutline, findHeadingByText } from "../../../../repository/js/lib/journal-outline.js";
import { extractQuests } from "../../../../repository/js/lib/journal-quests.js";
import { buildCalloutRaw } from "../../../../repository/js/lib/journal-story-board.js";

// Kinds with an actual print-card rendering, plus "journal" (renders as
// formatted markdown instead of a Press card). Maps/encounters have no
// single-entity card shape and stay out of this widget entirely; every other
// registered kind (character, system, template, taxonomy entries) isn't
// something a GM hands to the table as a card.
// Exported for macro-runner.js/loom's Macro editor — a Handout macro
// action's contentRef.kind should only offer a kind this widget can render.
export const HANDOUT_KINDS = ["npc", "location", "monster", "wonder", "journal"];

// Same labels game-log.js's SPOTLIGHT_KIND_LABELS uses, kept separate since
// this needs the bare noun ("NPC"), not the "an NPC" article form.
export const KIND_LABELS = {
  npc: "NPC",
  location: "Location",
  monster: "Monster",
  wonder: "Wonder",
  journal: "Journal",
};

// Kinds with no Press template at all — the picker's Template field is
// irrelevant for these.
const NO_TEMPLATE_KINDS = new Set(["journal"]);

const MODAL_ID = "undercroft-handout-picker-modal";

function ensurePickerModal() {
  let modal = document.getElementById(MODAL_ID);
  if (modal) return modal;
  const wrapper = document.createElement("div");
  wrapper.innerHTML = `
    <div class="modal fade" id="${MODAL_ID}" tabindex="-1" aria-hidden="true">
      <div class="modal-dialog modal-dialog-centered">
        <div class="modal-content">
          <div class="modal-header">
            <h1 class="modal-title fs-5">Add a handout</h1>
            <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Close"></button>
          </div>
          <div class="modal-body d-flex flex-column gap-3">
            <div>
              <label class="form-label" for="undercroft-handout-kind">Kind</label>
              <select class="form-select" id="undercroft-handout-kind" data-handout-kind></select>
            </div>
            <div>
              <label class="form-label" for="undercroft-handout-item">Item</label>
              <select class="form-select" id="undercroft-handout-item" data-handout-item></select>
            </div>
            <div data-handout-template-group>
              <label class="form-label" for="undercroft-handout-template">Template</label>
              <select class="form-select" id="undercroft-handout-template" data-handout-template></select>
            </div>
            <div class="d-none" data-handout-anchor-group>
              <label class="form-label" for="undercroft-handout-anchor">Show</label>
              <select class="form-select" id="undercroft-handout-anchor" data-handout-anchor></select>
            </div>
            <div class="text-danger small min-h-1" data-handout-error></div>
          </div>
          <div class="modal-footer">
            <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Cancel</button>
            <button type="button" class="btn btn-primary" data-handout-confirm>Add</button>
          </div>
        </div>
      </div>
    </div>
  `;
  const element = wrapper.firstElementChild;
  document.body.appendChild(element);
  return element;
}

function labelForEntry(entry) {
  const record = entry?.entity ?? entry?.payload ?? {};
  return record?.data?.name || record?.name || record?.title || entry?.id || "Untitled";
}

// openHandoutPicker({dataManager}) => Promise<{kind,id,templateId}|null> —
// resolves the chosen record + template, or null if cancelled.
export async function openHandoutPicker({ dataManager } = {}) {
  if (!dataManager) return null;

  const registeredKinds = await loadLibraryKinds().catch(() => []);
  const kindOptions = HANDOUT_KINDS.map((id) => registeredKinds.find((entry) => entry.id === id) || { id, label: id });

  const modalElement = ensurePickerModal();
  const modal =
    window.bootstrap && typeof window.bootstrap.Modal === "function"
      ? window.bootstrap.Modal.getOrCreateInstance(modalElement)
      : null;
  const kindSelect = modalElement.querySelector("[data-handout-kind]");
  const itemSelect = modalElement.querySelector("[data-handout-item]");
  const templateSelect = modalElement.querySelector("[data-handout-template]");
  const templateGroup = modalElement.querySelector("[data-handout-template-group]");
  const anchorSelect = modalElement.querySelector("[data-handout-anchor]");
  const anchorGroup = modalElement.querySelector("[data-handout-anchor-group]");
  const errorBox = modalElement.querySelector("[data-handout-error]");
  const confirmButton = modalElement.querySelector("[data-handout-confirm]");

  if (errorBox) errorBox.textContent = "";
  if (kindSelect) {
    kindSelect.innerHTML = "";
    kindOptions.forEach((entry) => kindSelect.appendChild(new Option(entry.label || entry.id, entry.id)));
  }
  function updateTemplateGroupVisibility() {
    templateGroup?.classList.toggle("d-none", NO_TEMPLATE_KINDS.has(kindSelect?.value || ""));
  }
  updateTemplateGroupVisibility();

  // Anchor options (Whole Page / a heading / a quest) only make sense for
  // journal selections, and depend on the currently-selected item's own
  // body — repopulated whenever either the kind or the item changes.
  let currentEntries = [];
  function updateAnchorSelect() {
    if (!anchorSelect || !anchorGroup) return;
    const isJournal = (kindSelect?.value || "") === "journal";
    anchorGroup.classList.toggle("d-none", !isJournal);
    anchorSelect.innerHTML = "";
    anchorSelect.appendChild(new Option("Whole page", ""));
    if (!isJournal) return;
    const entry = currentEntries.find((candidate) => candidate.id === itemSelect?.value);
    const record = entry?.entity ?? entry?.payload ?? null;
    const body = record?.body || "";
    extractOutline(body).forEach((heading) => {
      anchorSelect.appendChild(new Option(`${"— ".repeat(heading.depth)}${heading.text}`, `heading:${heading.text}`));
    });
    extractQuests(body).forEach((quest) => {
      anchorSelect.appendChild(new Option(`Quest: ${quest.title}`, `quest:${quest.title}`));
    });
  }

  let templates = [];
  try {
    templates = await listPrintTemplates(dataManager);
  } catch (error) {
    templates = [];
  }
  function populateTemplateSelect() {
    if (!templateSelect) return;
    templateSelect.innerHTML = "";
    templateSelect.appendChild(new Option("No template (plain)", ""));
    templates
      .slice()
      .sort((a, b) => (a.title || a.name || a.id).localeCompare(b.title || b.name || b.id))
      .forEach((template) => templateSelect.appendChild(new Option(template.title || template.name || template.id, template.id)));
  }
  populateTemplateSelect();

  async function populateItemSelect() {
    if (!itemSelect || !kindSelect) return;
    itemSelect.innerHTML = "";
    itemSelect.appendChild(new Option("Loading…", ""));
    let entries = [];
    try {
      entries = await fetchKindEntriesWithIds(dataManager, kindSelect.value);
    } catch (error) {
      entries = [];
    }
    const remoteIds = new Set(entries.map((entry) => entry.id));
    const local = (dataManager.listLocalEntries(kindSelect.value) || []).filter((entry) => !remoteIds.has(entry.id));
    const combined = [...entries, ...local];
    currentEntries = combined;
    itemSelect.innerHTML = "";
    if (!combined.length) {
      itemSelect.appendChild(new Option(`No saved ${kindSelect.value} entries yet`, ""));
      updateAnchorSelect();
      return;
    }
    combined
      .slice()
      .sort((a, b) => labelForEntry(a).localeCompare(labelForEntry(b)))
      .forEach((entry) => itemSelect.appendChild(new Option(labelForEntry(entry), entry.id)));
    updateAnchorSelect();
  }

  const onKindChange = () => {
    updateTemplateGroupVisibility();
    void populateItemSelect();
  };
  const onItemChange = () => updateAnchorSelect();
  kindSelect?.addEventListener("change", onKindChange);
  itemSelect?.addEventListener("change", onItemChange);
  await populateItemSelect();

  return new Promise((resolve) => {
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      kindSelect?.removeEventListener("change", onKindChange);
      itemSelect?.removeEventListener("change", onItemChange);
      confirmButton?.removeEventListener("click", onConfirm);
      modalElement.removeEventListener("hidden.bs.modal", onHidden);
      resolve(result);
    };
    const onConfirm = () => {
      const kind = kindSelect?.value || "";
      const id = itemSelect?.value || "";
      if (!kind || !id) {
        if (errorBox) errorBox.textContent = "Choose an item to add.";
        return;
      }
      let anchor = null;
      const anchorValue = kind === "journal" ? anchorSelect?.value || "" : "";
      if (anchorValue) {
        const separatorIndex = anchorValue.indexOf(":");
        anchor = { type: anchorValue.slice(0, separatorIndex), value: anchorValue.slice(separatorIndex + 1) };
      }
      modal?.hide();
      finish({ kind, id, templateId: templateSelect?.value || "", anchor });
    };
    const onHidden = () => finish(null);
    confirmButton?.addEventListener("click", onConfirm);
    modalElement.addEventListener("hidden.bs.modal", onHidden);
    if (modal) {
      modal.show();
    } else {
      onConfirm();
    }
  });
}

export function initHandoutWidget(
  container,
  {
    dataManager,
    status,
    contentRef,
    groupId = "",
    shareToken = "",
    canToggleVisibility = false,
    setRightAction,
    setTitle,
    forcePlayerView = false,
    plainMountContainer = null,
    ensureWidget,
  } = {}
) {
  const kind = contentRef?.kind;
  const id = contentRef?.id;
  const templateId = contentRef?.templateId || "";
  const anchor = contentRef?.anchor || null;
  if (!container || !dataManager || !kind || !id) {
    return { destroy() {} };
  }
  // A journal page renders as plain markdown prose (renderJournalEntry) —
  // ordinary flow layout, no conflict with a per-widget CSS zoom
  // (dashboard.js). Every other kind renders as a Press-templated or plain
  // card, which does its own JS-measurement-based scale-to-fit (applyScale)
  // — CSS zoom's layout-affecting nature breaks that math, so those always
  // render into the never-zoomed sibling container instead, when available.
  const renderTarget = kind !== "journal" && plainMountContainer ? plainMountContainer : container;
  if (renderTarget !== container) {
    container.classList.add("d-none");
    renderTarget.classList.remove("d-none");
    renderTarget.classList.add("d-flex");
  }
  let destroyed = false;
  let visible = false;
  // Re-applied whenever renderTarget resizes (selecting this widget opens
  // the Widget Inspector pane, narrowing the dashboard column) — set fresh
  // by renderTemplatedCard each time it draws, cleared by the other render*
  // states since there's nothing to rescale while loading/erroring/plain.
  let applyScale = null;
  const resizeObserver = typeof ResizeObserver !== "undefined" ? new ResizeObserver(() => applyScale?.()) : null;
  resizeObserver?.observe(renderTarget);

  function renderLoading() {
    applyScale = null;
    renderTarget.innerHTML = "";
    renderTarget.appendChild(el("p", "text-body-secondary small mb-0", "Loading…"));
  }

  function renderError(message) {
    applyScale = null;
    renderTarget.innerHTML = "";
    renderTarget.appendChild(el("p", "text-danger small mb-0", message));
  }

  function renderPlain(entity) {
    applyScale = null;
    renderTarget.innerHTML = "";
    const card = el("div", "border rounded-3 bg-body p-3 d-flex flex-column gap-2");
    card.appendChild(el("div", "fw-semibold", entity?.name || "Untitled"));
    if (entity?.description) {
      card.appendChild(el("p", "small text-body-secondary mb-0", entity.description));
    }
    renderTarget.appendChild(card);
  }

  // Slices a journal page's raw body down to just one anchored fragment — a
  // heading's own section, or a single quest's standalone callout
  // (reconstructed via journal-story-board.js's buildCalloutRaw, the same
  // primitive that file's own read-modify-write cycle uses). Falls back to
  // the whole body if the anchor can no longer be found (a stale reference
  // — the page was edited since this Handout was configured).
  function sliceBodyByAnchor(body, entryAnchor) {
    if (!entryAnchor || !entryAnchor.value) return body;
    if (entryAnchor.type === "heading") {
      const outline = extractOutline(body);
      const index = findHeadingByText(body, entryAnchor.value);
      if (index === -1) return body;
      const target = outline[index];
      const lines = body.split("\n");
      let endLine = lines.length;
      for (let i = index + 1; i < outline.length; i += 1) {
        if (outline[i].level <= target.level) {
          endLine = outline[i].line;
          break;
        }
      }
      return lines.slice(target.line, endLine).join("\n");
    }
    if (entryAnchor.type === "quest") {
      const targetKey = entryAnchor.value.trim().toLowerCase();
      const quest = extractQuests(body).find((candidate) => candidate.title.trim().toLowerCase() === targetKey);
      if (!quest) return body;
      return buildCalloutRaw({ type: "quest", fold: quest.fold, title: quest.title }, quest.bodyRaw);
    }
    return body;
  }

  // Journal pages are plain markdown prose, not a fixed-size print card —
  // they need scrolling, not applyScale's width-based scale-to-fit.
  // Wiki-links resolve for display only (a real link doesn't render with
  // "missing page" styling) — never clickable, since a player link-hopping
  // through the GM's whole notebook would defeat the point of choosing what
  // to show (renderMarkdown's onNavigate is deliberately left unset).
  async function renderJournalEntry(entity) {
    applyScale = null;
    let titleIndex = null;
    // `validKindIds`/`kindLabels` let a `` `npc:Name` ``/`` `location:Name` ``
    // span turn into a real icon+name chip, matching how Repository itself
    // shows the page. `onOpenReference` stays unset — chips render but stay
    // non-interactive here, same reasoning as wiki-links above.
    let validKindIds = new Set();
    let kindLabels = {};
    try {
      const [journalEntries, kinds] = await Promise.all([
        fetchKindEntriesWithIds(dataManager, "journal"),
        loadLibraryKinds(),
      ]);
      titleIndex = buildTitleIndex(journalEntries.map((entry) => ({ id: entry.id, payload: entry.entity })));
      validKindIds = new Set((kinds || []).map((kind) => kind.id));
      kindLabels = Object.fromEntries((kinds || []).map((kind) => [kind.id, kind.label || kind.id]));
    } catch (error) {
      titleIndex = null;
    }
    if (destroyed) return;
    disposeTooltips(container);
    container.innerHTML = "";
    const card = el("div", "border rounded-3 bg-body p-3 d-flex flex-column gap-2");
    // Always fills the widget's own mount point (a flex column sized to
    // this grid cell) rather than just in forcePlayerView — every card gets
    // a real, resizable grid cell now, so a fixed height cap here would mean
    // resizing a Handout widget's cell taller never actually grows the
    // visible text area.
    card.style.flex = "1 1 0";
    card.style.minHeight = "0";
    card.style.overflowY = "auto";
    card.appendChild(el("div", "fw-semibold fs-5", entity?.title || "Untitled page"));
    card.appendChild(
      renderMarkdown(sliceBodyByAnchor(entity?.body || "", anchor), {
        resolveWikiLink: titleIndex ? (title) => titleIndex.resolve(title) : undefined,
        status,
        dataManager,
        // Same gate as the eye-icon visibility toggle below — true only for
        // the owning GM's own dashboard: starting combat, rolling dice, and
        // firing a macro are all GM-only actions here.
        interactiveEncounters: canToggleVisibility,
        onStartEncounter: (creatures, blockIndex) =>
          void startEncounter({
            dataManager,
            status,
            title: entity?.title || "Untitled page",
            creatures,
            groupId,
            currentSection: resolveToolContextPath(),
            id: deterministicEncounterId(id, blockIndex),
          }),
        interactiveDice: canToggleVisibility,
        interactiveMacros: canToggleVisibility,
        groupContext: { groupId, shareToken },
        ensureWidget,
        validKindIds,
        kindLabels,
      })
    );
    container.appendChild(card);
    refreshTooltips(container);
  }

  // Crops a rendered page down to just its one drawn tile — createPage still
  // lays the tile out on a full print-sheet-sized page even with
  // singleCardIndex forcing a 1x1 render, so without this the tile ends up
  // as a small offset block inside a much wider invisible page. Cropping the
  // stage to the tile's own measured box is what makes the visible card
  // fill (and later center within) its stage.
  function cropToTile(page, stage) {
    const tile = page.querySelector(".card-tile, .chip-tile");
    if (!tile) return;
    const stageRect = stage.getBoundingClientRect();
    const tileRect = tile.getBoundingClientRect();
    const currentLeft = parseFloat(page.style.left) || 0;
    const currentTop = parseFloat(page.style.top) || 0;
    page.style.position = "absolute";
    page.style.left = `${currentLeft - (tileRect.left - stageRect.left)}px`;
    page.style.top = `${currentTop - (tileRect.top - stageRect.top)}px`;
    stage.style.width = `${tileRect.width}px`;
    stage.style.height = `${tileRect.height}px`;
  }

  // The same render Workbench's "Now Showing" panel already proved works
  // outside Press's own page — but showing every side (front AND back, for a
  // two-sided card) side by side, cropped to just each tile, the way Press's
  // Grid View tab shows a card. No trim/bleed/safe guide overlay — those are
  // print-specific guides a table-facing handout should never show.
  function renderTemplatedCard(templateRecord, entity) {
    const template = createTemplate(templateRecord);
    const format = getFormatById(template);
    const orientation = format?.defaultOrientation || "portrait";
    const size = getPageSize(template, format?.id, orientation);
    const sides = template.sides?.length ? template.sides : ["front"];

    // `inline-flex`/`nowrap` — the row must size to its own tiles' natural
    // width for the scale-to-fit measurement below to reflect real content,
    // and must never let flex-wrap stack front above back when the widget
    // narrows; applyScale is what shrinks the whole row instead.
    const row = el("div");
    row.style.display = "inline-flex";
    row.style.flexWrap = "nowrap";
    row.style.justifyContent = "center";
    row.style.alignItems = "flex-start";
    row.style.gap = "1rem";

    // A plain wrapper sized to its own content and centered — `row` gets the
    // scale transform below, and a transformed element keeps contributing
    // its PRE-transform box size to layout, so this outer box's width must
    // be set to the POST-scale size or the container would still reserve
    // (and overflow past) the untransformed footprint.
    const scaleBox = el("div");
    scaleBox.style.width = "fit-content";
    scaleBox.style.margin = "0 auto";
    scaleBox.appendChild(row);
    renderTarget.innerHTML = "";
    renderTarget.appendChild(scaleBox);

    // Attached to the live document before any of this — getBoundingClientRect
    // reads real, laid-out geometry and returns zeros for anything detached.
    sides.forEach((side) => {
      const page = template.createPage(side, {
        size,
        format,
        data: entity,
        page: template.pages?.[side] || {},
        singleCardIndex: 0,
      });
      const stage = el("div");
      stage.style.position = "relative";
      stage.style.overflow = "hidden";
      stage.appendChild(page);
      row.appendChild(stage);
      applyAutoWidthCaps(page, { safeInsetIn: template.card?.safeInset ?? 0 });
      applyAutoFontSizing(page);
      applyOverflowIndicators(page);
      cropToTile(page, stage);
    });

    // Measured once, before any transform is applied — row's own rect reads
    // as post-transform on every call after the first, so this natural size
    // must be captured here and reused by every later applyScale() call.
    const rowRect = row.getBoundingClientRect();
    const naturalWidth = rowRect.width;
    const naturalHeight = rowRect.height;

    applyScale = () => {
      const availableWidth = renderTarget.clientWidth || naturalWidth;
      const scale = naturalWidth > 0 ? Math.min(1, availableWidth / naturalWidth) : 1;
      if (scale < 1) {
        row.style.transformOrigin = "top left";
        row.style.transform = `scale(${scale})`;
        scaleBox.style.width = `${naturalWidth * scale}px`;
        scaleBox.style.height = `${naturalHeight * scale}px`;
        scaleBox.style.overflow = "hidden";
      } else {
        row.style.transform = "";
        scaleBox.style.width = "fit-content";
        scaleBox.style.height = "";
        scaleBox.style.overflow = "";
      }
    };
    applyScale();
  }

  async function refresh() {
    renderLoading();
    let entity;
    try {
      entity = await loadLibraryData(`${kind}/${id}`, dataManager, shareToken);
    } catch (error) {
      if (!destroyed) renderError("Unable to load this item.");
      return;
    }
    if (destroyed) return;
    const kindLabel = KIND_LABELS[kind] || kind;
    setTitle?.(`${entity?.title || entity?.name || "Untitled"} (${kindLabel})`);
    if (kind === "journal") {
      void renderJournalEntry(entity);
      return;
    }
    if (!templateId) {
      renderPlain(entity);
      return;
    }
    try {
      // "templates" (plural) — the legacy bucket alias Workbench's own
      // template loads use.
      const result = await dataManager.get("templates", templateId, { shareToken });
      if (destroyed) return;
      renderTemplatedCard(result.payload, entity);
    } catch (error) {
      // A private/unshared template (or one since deleted) shouldn't block
      // showing the entity itself — fall back to plain.
      if (!destroyed) renderPlain(entity);
    }
  }

  function updateVisibilityAction() {
    if (!canToggleVisibility) return;
    setRightAction?.({
      icon: visible ? "tabler:eye" : "tabler:eye-off",
      tooltip: visible ? "Showing to table — click to hide" : "Hidden from table — click to show",
      active: visible,
      onClick: () => void toggleVisibility(),
    });
  }

  async function refreshVisibility() {
    if (!canToggleVisibility || !groupId) {
      visible = false;
      return;
    }
    // Per-instance, not just per-kind — a second Handout of the same kind
    // must stay independently toggleable.
    visible = await resolveIsSpotlighted(dataManager, { groupId, shareToken, kind, id });
    updateVisibilityAction();
  }

  async function toggleVisibility() {
    if (!groupId) {
      status?.show("No active campaign to show this to.", { type: "warning", timeout: 2500 });
      return;
    }
    try {
      if (visible) {
        await dataManager.clearSpotlight({ groupId, kind, id });
        status?.show("Stopped showing to the table.", { type: "success", timeout: 2000 });
      } else {
        await dataManager.spotlightToGroup({
          groupId,
          contentType: kind,
          contentId: id,
          templateId: templateId || undefined,
        });
        status?.show("Showing to the table.", { type: "success", timeout: 2000 });
      }
    } catch (error) {
      status?.show(error.message || "Unable to update visibility.", { type: "error" });
    }
    await refreshVisibility();
  }

  void refresh();
  void refreshVisibility();

  return {
    // Exposed for the Widget Inspector's Refresh action — a GM editing the
    // underlying record doesn't push a live update here.
    refresh: () => {
      void refresh();
      void refreshVisibility();
    },
    // `removed` (dashboard.js's removeWidget passes true) — this instance's
    // own spotlight (if any) needs clearing, or removing a currently-shown
    // Handout orphans that spotlight entry as still "active" with no way to
    // toggle it off. Without this, a new Handout for the same record would
    // find the orphaned entry and show "Show to Table" already ON, but since
    // nothing posted a new spotlight entry, players' watcher never notified
    // anyone. Same shape as clocks.js/browser.js/soundboard.js/calendar.js's
    // own destroy(removed).
    async destroy(removed) {
      destroyed = true;
      resizeObserver?.disconnect();
      disposeTooltips(renderTarget);
      renderTarget.innerHTML = "";
      if (removed && visible && groupId) {
        try {
          await dataManager.clearSpotlight({ groupId, kind, id });
        } catch (error) {
          // Best-effort cleanup — nothing meaningful to do if this fails.
        }
      }
    },
  };
}
