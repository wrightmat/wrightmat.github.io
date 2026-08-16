// Renders one specific library entity as a real Press print card — the
// successor to the old Card widget, which only ever showed a plain name/
// description placeholder (rendering an arbitrary Press template outside
// Press's own page was flagged there as future work). That work turns out to
// already be done: Workbench's own "Now Showing" panel
// (workbench-character-view.js's renderNowShowingCard) already proved
// createTemplate + template.createPage renders correctly outside Press's own
// page — this widget reuses that exact function, not a parallel
// reimplementation.
//
// This also replaces the old "Show to table" buttons that used to live in
// Sanctum/Forge/Crucible/Vault: a GM now adds a Handout directly to their own
// dashboard (picking the record + a print template via openHandoutPicker
// below) and toggles visibility from here — spotlightToGroup/clearSpotlight
// called directly, no modal, the same pair combat-tracker.js's own
// autoShowOnStart/hideFromTable and clocks.js's toggleVisibility already
// call the same way. The point: the dashboard itself is now the one place
// that shows what's currently visible to the table, instead of a separate,
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
// Repository's own markdown renderer — journal pages are plain markdown
// text, never a Press template, so they get a completely different render
// path below (renderJournalEntry) than every other Handout kind.
import { renderMarkdown } from "../../../../repository/js/lib/markdown.js";
import { buildTitleIndex } from "../../../../repository/js/lib/journal-links.js";
import { startEncounter, deterministicEncounterId } from "../../../../repository/js/lib/journal-encounter.js";
import { extractOutline, findHeadingByText } from "../../../../repository/js/lib/journal-outline.js";
import { extractQuests } from "../../../../repository/js/lib/journal-quests.js";
import { buildCalloutRaw } from "../../../../repository/js/lib/journal-story-board.js";

// Kinds with an actual print-card rendering of their own — mirrors the exact
// set the old Card widget's KIND_WIDGET_MAP entries covered (npc/location/
// monster/effect) — plus "journal" (Repository's own kind), which renders as
// formatted markdown instead of a Press card (see renderJournalEntry).
// Maps/encounters (spotlight.js's own LINK_ONLY_KINDS) have no single-entity
// card shape and stay out of this widget entirely; every other registered
// kind (character, system, template, taxonomy entries like class/species/...)
// isn't something a GM hands to the table as a card.
// Exported for macro-runner.js/loom's Macro editor — a Handout macro
// action's contentRef.kind should only ever offer a kind this widget can
// actually render, not every Library kind that exists (see loom/js/app.js's
// own MACRO_ACTION_TYPES.handout).
export const HANDOUT_KINDS = ["npc", "location", "monster", "effect", "journal"];

// Same labels SPOTLIGHT_KIND_LABELS (game-log.js) uses for the log line —
// kept as its own small table here rather than importing that one, since
// this needs the bare noun ("NPC"), not the "an NPC" article form the log
// sentence wants. Exported alongside HANDOUT_KINDS for the same reason.
export const KIND_LABELS = {
  npc: "NPC",
  location: "Location",
  monster: "Monster",
  effect: "Effect",
  journal: "Journal",
};

// Kinds with no Press template at all — the picker's Template field is
// irrelevant for these (same reasoning as spotlight.js's own LINK_ONLY_KINDS
// hiding its template select, applied here for a different kind of content).
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
  // journal-kind selections, and depend on the currently-selected item's own
  // body — repopulated from `currentEntries` (kept in sync by
  // populateItemSelect below) whenever either the kind or the item changes.
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
  // `kind` is fixed for this widget instance's whole lifetime (contentRef
  // never changes after mount — same reasoning map.js's own mapId comment
  // gives), so this is a one-time decision, not something re-evaluated per
  // render. A journal page renders as plain markdown prose (renderJournalEntry
  // below) — ordinary flow layout, no conflict with a per-widget zoom
  // (dashboard.js). Every other kind renders as a Press-templated or plain
  // print CARD (renderTemplatedCard/renderPlain), which does its own
  // JS-measurement-based scale-to-fit (applyScale) — CSS zoom's layout-
  // affecting nature broke that math outright (confirmed directly), so those
  // always render into the never-zoomed sibling container instead, when one's
  // available (dashboard.js only ever supplies one for widget types that would
  // otherwise conflict — see its own ZOOM_EXCLUDED_WIDGET_TYPES comment).
  const renderTarget = kind !== "journal" && plainMountContainer ? plainMountContainer : container;
  if (renderTarget !== container) {
    container.classList.add("d-none");
    renderTarget.classList.remove("d-none");
    renderTarget.classList.add("d-flex");
  }
  let destroyed = false;
  let visible = false;
  // Re-applied whenever `renderTarget` itself resizes (selecting this widget
  // opens the Widget Inspector pane, narrowing the dashboard column — see
  // the ResizeObserver below) — set fresh by renderTemplatedCard each time
  // it draws a card, cleared by the other render* states below since
  // there's nothing to rescale while loading/erroring/plain.
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

  // Slices a journal page's raw body down to just one anchored fragment —
  // a heading's own section (through the next same-or-higher-level heading,
  // or end of doc) or a single quest's own standalone callout (reconstructed
  // via journal-story-board.js's own buildCalloutRaw, the same primitive
  // that file's read-modify-write cycle already uses, rather than a second
  // "rebuild one callout's raw text" implementation here). Falls back to the
  // whole body if the anchor can no longer be found (a stale reference —
  // the page was edited since this Handout was configured), same tolerance
  // Repository's own selectPage scroll-resolution already gives a missing
  // heading/quest anchor.
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
  // they need scrolling for whatever length the GM wrote, not the
  // width-based scale-to-fit renderTemplatedCard's applyScale handles below,
  // so this doesn't touch that machinery at all. Wiki-links resolve for
  // *display* only (so a real link to another page doesn't render with the
  // "missing page" styling) — never clickable here, since a player
  // link-hopping through the GM's whole notebook would defeat the point of
  // choosing what to show; renderMarkdown's onNavigate is deliberately left
  // unset, which already makes every link a no-op click.
  async function renderJournalEntry(entity) {
    applyScale = null;
    let titleIndex = null;
    // `validKindIds`/`kindLabels` — the same pair Repository's own
    // renderPreview fetches once via loadLibraryKinds() and passes through
    // to renderMarkdown so a `` `npc:Name` ``/`` `location:Name` `` span
    // turns into a real icon+name chip. Missing here entirely was a
    // confirmed real bug — every kind-reference span in a Handout journal
    // page rendered as plain unconverted inline code (literally
    // "npc:Berosalia Hart") instead of matching how Repository itself
    // shows the exact same page. `onOpenReference` is deliberately left
    // unset — chips render correctly but stay non-interactive here, same
    // as wiki-links a few lines below (a player clicking through into
    // another tool entirely would defeat the point of a spotlighted
    // fragment, the same reasoning that comment already gives).
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
    container.innerHTML = "";
    const card = el("div", "border rounded-3 bg-body p-3 d-flex flex-column gap-2");
    // Always fills the widget's own mount point (a flex column sized to
    // this grid cell's own colSpan/rowSpan-driven footprint — dashboard.js's
    // card chain propagates that height down via flex/min-height:0, see
    // mountWidget) rather than just in forcePlayerView — every card gets a
    // real, resizable grid cell now (GM view included), so a fixed 24rem cap
    // here previously meant resizing a Handout widget's grid cell taller
    // never actually grew the visible text area (confirmed directly: it
    // stayed capped with its own internal scrollbar).
    card.style.flex = "1 1 0";
    card.style.minHeight = "0";
    card.style.overflowY = "auto";
    card.appendChild(el("div", "fw-semibold fs-5", entity?.title || "Untitled page"));
    card.appendChild(
      renderMarkdown(sliceBodyByAnchor(entity?.body || "", anchor), {
        resolveWikiLink: titleIndex ? (title) => titleIndex.resolve(title) : undefined,
        status,
        dataManager,
        // Same gate as the eye-icon visibility toggle just below — true only
        // for the owning GM's own dashboard, never a player/shared viewer:
        // starting combat, rolling dice, and firing a macro are all GM-only
        // actions here (checkboxes are never interactive in Handout at all —
        // see interactiveCheckboxes' own default above).
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
  }

  // Crops a rendered page down to just its one drawn tile — ported straight
  // from Press's own cropPageToSingleTile (press/js/app.js's Grid View):
  // createPage still lays the tile out on a full print-sheet-sized page
  // (margins and all) even with singleCardIndex forcing a 1x1 render, so
  // without this the tile ends up as a small offset block inside a much
  // wider invisible page — exactly the "empty space on the left, overhangs
  // on the right" symptom. Cropping the stage to the tile's own measured
  // box is what actually makes the visible card fill (and later center
  // within) its stage, not a separate centering fix on top.
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

  // Same render Workbench's own "Now Showing" panel already proved works
  // outside Press's own page (renderNowShowingCard) — createTemplate +
  // template.createPage, the exact function Press's own Grid View uses for a
  // single-card render — but showing every side (front AND back, for a
  // two-sided card) side by side, cropped to just each tile, the way Press's
  // own Grid View tab shows a card — not one side alone. No trim/bleed/safe
  // guide overlay call (Press's own applyOverlays) at all — those are print-
  // specific guide lines Grid View itself only draws for the print-preview
  // tabs, not something a table-facing handout should ever show.
  function renderTemplatedCard(templateRecord, entity) {
    const template = createTemplate(templateRecord);
    const format = getFormatById(template);
    const orientation = format?.defaultOrientation || "portrait";
    const size = getPageSize(template, format?.id, orientation);
    const sides = template.sides?.length ? template.sides : ["front"];

    // `inline-flex` (not `d-flex`, which is block and stretches to fill
    // container) — row needs to size itself to its own tiles' natural
    // combined width so the scale-to-fit measurement below reflects the
    // actual content, not the container it's about to be centered in.
    // `nowrap` — narrowing the widget (e.g. selecting it opens the Widget
    // Inspector pane, shrinking this column) must never let the browser's
    // own flex-wrap stack front above back; applyScale below is what
    // shrinks the whole row to fit instead, at any width.
    const row = el("div");
    row.style.display = "inline-flex";
    row.style.flexWrap = "nowrap";
    row.style.justifyContent = "center";
    row.style.alignItems = "flex-start";
    row.style.gap = "1rem";

    // A plain wrapper, sized to fit its own content and centered within
    // whatever width the widget actually has — `row` itself is what gets the
    // scale transform below, since a transformed element keeps contributing
    // its *pre*-transform box size to layout; without this outer box's own
    // width being set to the *post*-scale size, the container would still
    // reserve (and could overflow past) the untransformed footprint even
    // though the card visually shrank, which was the "overhangs the right"
    // half of the original bug alongside the missing crop below.
    const scaleBox = el("div");
    scaleBox.style.width = "fit-content";
    scaleBox.style.margin = "0 auto";
    scaleBox.appendChild(row);
    renderTarget.innerHTML = "";
    renderTarget.appendChild(scaleBox);

    // Attached to the live document BEFORE any of this — getBoundingClientRect
    // (both here and inside applyAutoWidthCaps/applyOverflowIndicators) reads
    // real, laid-out geometry, and returns nothing but zeros for anything
    // still detached — same ordering constraint Press's own renderGridView
    // follows (build/attach the stage, then measure).
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

    // Measured once, before any transform is ever applied — row's own rect
    // reads as post-transform (already-scaled) on every call after the
    // first, so this natural size has to be captured here and reused by
    // every later applyScale() call, not re-measured from row each time.
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
      // "templates" (plural) — the same legacy bucket alias Workbench's own
      // template loads use (server/storage.py's _LEGACY_BUCKET_SPECS).
      const result = await dataManager.get("templates", templateId, { shareToken });
      if (destroyed) return;
      renderTemplatedCard(result.payload, entity);
    } catch (error) {
      // A private/unshared template (or one since deleted) shouldn't block
      // showing the entity itself — fall back to plain, same as Workbench's
      // own refreshNowShowing.
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
    // (two NPCs, both kind "npc") must stay independently toggleable, see
    // resolveIsSpotlighted's own comment.
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
    // underlying record doesn't push a live update here, so a manual refresh
    // is the only way to pick up a change without removing and re-adding.
    refresh: () => {
      void refresh();
      void refreshVisibility();
    },
    // `removed` (dashboard.js's removeWidget passes true) — this instance's
    // own spotlight (if any) needs clearing, or removing a currently-shown
    // Handout orphans that spotlight entry as still "active" with no way to
    // toggle it off again. Confirmed real bug this fixes: adding a NEW
    // Handout for the same record after the old, spotlighted instance was
    // removed this way found that orphaned entry via resolveIsSpotlighted
    // and correctly showed "Show to Table" already ON — but since nothing
    // ever posted a NEW spotlight entry, players' spotlight-inbox watcher
    // had nothing new to notify about, so the toggle looked on but nobody
    // was actually told. Same shape as clocks.js/browser.js/soundboard.js/
    // calendar.js's own destroy(removed).
    async destroy(removed) {
      destroyed = true;
      resizeObserver?.disconnect();
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
