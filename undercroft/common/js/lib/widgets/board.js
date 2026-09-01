// A private GM reference/macro board — buckets (columns) of cards, each
// card carrying its own {icon, color, text} — generalized enough to cover
// two use cases that used to be two separate widgets:
//   1. A hand-curated reference board (buckets of short "wiki-link style"
//      cards — an external URL, a `[[Journal Page]]`, a `` `npc:Name` ``
//      Library reference, or just plain text).
//   2. A grid of one-click macro-runner buttons (the old, now-retired Macro
//      board widget — macro-board.js). A card whose ENTIRE text is a single
//      `` `macro:Name` `` reference renders as a big icon+color button that
//      runs it, same visual/behavioral shape the old widget's own
//      renderMacroButton had; see isPureMacroCard/renderMacroButtonCard
//      below. Everything else renders through the same shared markdown
//      pipeline a plain reference card uses, where a `macro:` reference
//      embedded in longer text still becomes a (smaller, inline) runnable
//      chip — see journal-macro.js's own buildMacroChip.
// Deliberately NOT a Library kind of its own, same reasoning clocks.js's
// own header comment gives: {name, buckets:[{id, title, cards:[{id, icon,
// color, text}]}]} is small enough to live entirely in this widget
// instance's own persisted contentRef. `multiple: true` in the dashboard
// catalog — add the widget again for another board.
//
// Never shown on the second-screen table mirror — this widget type is
// absent from dashboard.js's own TABLE_WIDGET_TYPES on purpose. It's a
// private GM tool, not something meant to be spotlighted to players, so it
// carries none of Clock's/Handout's visibility-toggle/follower machinery.
//
// Card text renders through Repository's own shared markdown pipeline
// (renderMarkdown) with every interactive feature that pipeline offers
// turned on — `[[Journal Page]]` wiki-links, `` `dice:1d6` `` rollers,
// `` `encounter:...` `` starters, `` `macro:Name` `` runners, and
// `` `kindId:Name` `` Library references — so this widget never needs to
// know or care which kind of reference a card actually holds. Cross-tool
// import (repository/js/lib/*), same established pattern handout.js's own
// Journal-kind rendering already uses.
import { el } from "../dom.js";
import { createSortable } from "../dnd.js";
import { refreshTooltips, disposeTooltips } from "../tooltips.js";
import { createIconButton, createIconPickerField } from "../ui-components.js";
import { fetchKindEntriesWithIds, loadLibraryKinds } from "../content-fetch.js";
import { resolveToolHref, resolveToolContextPath } from "../app-shell.js";
import { renderMarkdown } from "../../../../repository/js/lib/markdown.js";
import { buildTitleIndex } from "../../../../repository/js/lib/journal-links.js";
import { startEncounter, deterministicEncounterId } from "../../../../repository/js/lib/journal-encounter.js";
import { findKindReferenceRecord, EXCLUDED_KINDS } from "../library-reference.js";
import { findMacro, runMacroReference } from "../../../../repository/js/lib/journal-macro.js";
// Same `` `macro:`/`encounter:`/`dice:`/`kindId:` `` filtered autocomplete
// dropdown Repository's own Journal body editor uses — attached to both the
// bucket's quick "Add a card" input and the edit modal's own text field
// (below) so this widget never needs a bespoke "pick a macro" control of
// its own; typing `` `macro: `` just works the same way it does in a
// Journal page, here or anywhere else in the suite.
import { attachCodeBlockAutocomplete } from "../../../../repository/js/lib/code-block-autocomplete.js";
// Same `[[Page Title]]` filtered autocomplete Journal's own body editor
// uses — a card is just as likely to be a plain wiki-link as a macro/dice/
// kind reference, so both autocompletes attach to the same inputs
// side by side (below), matching Journal exactly rather than only covering
// the backtick-prefixed half of it.
import { attachWikiLinkAutocomplete } from "../../../../repository/js/lib/wiki-link-autocomplete.js";

function randomId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `${Math.random().toString(16).slice(2)}-${Date.now()}`;
}

// A function, not a static object — a shared literal would hand every
// brand-new board the exact same bucket id (module-load-time evaluation),
// same pitfall this suite's own createMarkerElement-style factories all
// avoid by generating ids inside the factory call itself.
function createDefaultConfig() {
  return { name: "New Board", buckets: [{ id: randomId(), title: "New Bucket", cards: [] }] };
}

// A card whose entire trimmed text is ONE `` `macro:Name` `` code span and
// nothing else — the "this card IS a macro button" case, rendered as a big
// icon+color button (renderMacroButtonCard) instead of the normal small
// reference-card body. A macro reference embedded alongside other text
// still renders as the smaller inline chip via the normal markdown path.
const PURE_MACRO_CARD_PATTERN = /^`\s*macro:\s*(.+?)\s*`$/i;
function isPureMacroCard(text) {
  const match = PURE_MACRO_CARD_PATTERN.exec((text || "").trim());
  return match ? match[1].trim() : null;
}

export function initBoardWidget(
  container,
  {
    contentRef,
    setContentRef,
    setTitle,
    dataManager,
    status,
    groupContext,
    instanceId = "",
    ensureWidget,
    isEditing,
    // Optional — see macro-runner.js's own runMacro header comment. Only
    // meaningful for a caller (dashboard.js) that keeps its own live copy
    // of the WLED device list around; undefined everywhere else.
    onWledDevicesChange,
  } = {}
) {
  if (!container) {
    return { destroy() {} };
  }

  let config = { ...createDefaultConfig(), ...(contentRef || {}) };
  let destroyed = false;
  let activeSortables = [];
  // attachCodeBlockAutocomplete's own destroy handles (the "Add a card"
  // input, and whichever's currently attached to the edit modal's text
  // field) — torn down and re-attached fresh every render, same lifecycle
  // activeSortables already follows.
  let activeAutocompletes = [];
  let pendingFocusBucketId = null;

  // Own Sortable "group" name per widget INSTANCE — cards must be able to
  // drag between any bucket within THIS board, but never leap into a
  // different Board widget sitting elsewhere on the same dashboard.
  const cardGroupName = `board-cards-${instanceId || randomId()}`;

  // Resolved once at mount (journal titles for wiki-links, valid Library
  // kind ids + labels for `` `kindId:Name` `` chips) — a brief "chips/links
  // just don't resolve yet" window on the very first render, same grace
  // period repository/js/app.js's own ensureLibraryKinds already accepts,
  // rather than blocking the first paint on two fetches.
  let titleIndex = null;
  let validKindIds = new Set();
  let kindLabelsMap = {};
  // {id, payload} shape attachWikiLinkAutocomplete's own getEntries expects
  // — the exact same list titleIndex is built from just below, kept around
  // separately since buildTitleIndex only returns a resolver, not the raw
  // list back out.
  let journalEntriesForAutocomplete = [];

  async function loadReferenceData() {
    try {
      const [journalEntries, kinds] = await Promise.all([
        fetchKindEntriesWithIds(dataManager, "journal").catch(() => []),
        loadLibraryKinds().catch(() => []),
      ]);
      const normalizedJournalEntries = journalEntries.map((entry) => ({ id: entry.id, payload: entry.entity }));
      titleIndex = buildTitleIndex(normalizedJournalEntries);
      journalEntriesForAutocomplete = normalizedJournalEntries;
      validKindIds = new Set((kinds || []).map((kind) => kind.id).filter((id) => !EXCLUDED_KINDS.has(id)));
      kindLabelsMap = Object.fromEntries((kinds || []).map((kind) => [kind.id, kind.label || kind.id]));
    } catch (error) {
      titleIndex = null;
    }
    if (!destroyed) render();
  }

  // Opens in a new tab rather than navigating this tab away (Repository's
  // own equivalent handler uses a same-tab redirect — right there, since
  // Repository IS the browsing tool; wrong here, since the whole point of a
  // reference board is to look something up WITHOUT losing the dashboard
  // you're running the game from).
  function handleWikiLinkNavigate(target) {
    if (target.missing) {
      status?.show(`No journal page named "${target.title}" yet.`, { type: "warning", timeout: 3000 });
      return;
    }
    const url = `${resolveToolHref("repository", resolveToolContextPath())}?page=${encodeURIComponent(target.id)}`;
    window.open(url, "_blank", "noopener");
  }

  async function handleOpenReference(kindId, name) {
    const record = await findKindReferenceRecord(dataManager, kindId, name);
    if (!record) {
      status?.show(`Couldn't find that ${kindLabelsMap[kindId] || kindId}.`, { type: "error", timeout: 3000 });
      return;
    }
    // Same special case Repository's own handleOpenReference makes — a map
    // has real content worth opening, not just a name/description worth a
    // toast.
    if (kindId === "map") {
      window.open(`${resolveToolHref("orrery", resolveToolContextPath())}?map=${encodeURIComponent(record.id)}`, "_blank", "noopener");
      return;
    }
    status?.show(`${kindLabelsMap[kindId] || kindId}: ${record.name}`, { type: "info", timeout: 3000 });
  }

  function renderCardMarkdown(card) {
    return renderMarkdown(card.text || "", {
      resolveWikiLink: titleIndex ? (title) => titleIndex.resolve(title) : undefined,
      onNavigate: handleWikiLinkNavigate,
      status,
      interactiveEncounters: true,
      onStartEncounter: (creatures, blockIndex) =>
        void startEncounter({
          dataManager,
          status,
          title: (card.text || "Encounter").slice(0, 60),
          creatures,
          groupId: groupContext?.groupId || "",
          currentSection: resolveToolContextPath(),
          id: deterministicEncounterId(card.id, blockIndex),
        }),
      interactiveDice: true,
      interactiveMacros: true,
      groupContext: { groupId: groupContext?.groupId || "", shareToken: groupContext?.shareToken || "" },
      dataManager,
      ensureWidget,
      onWledDevicesChange,
      validKindIds,
      kindLabels: kindLabelsMap,
      onOpenReference: (kindId, name) => void handleOpenReference(kindId, name),
    });
  }

  // The old Macro board widget's own big-button rendering, generalized —
  // icon/color now come from the card's own authored properties instead of
  // the referenced macro's `.icon` field, and clicking while the dashboard
  // is in Edit-layout mode redirects to Loom's macro editor instead of
  // running it for real, exactly matching that widget's own click handler
  // (real lights/sound/handouts firing while the GM is just rearranging
  // cards would be surprising, not helpful).
  function renderMacroButtonCard(card, macroRef) {
    const button = el("button", "btn btn-outline-secondary d-flex flex-column align-items-center gap-1 p-2 w-100");
    button.type = "button";
    if (card.color) {
      button.style.borderColor = card.color;
      button.style.color = card.color;
    }
    // Read live by dashboard.js's own applyEditingState (queries
    // [data-macro-run-button] on every Edit-layout toggle) to keep this
    // title in sync without needing a full widget re-render — same
    // convention the old Macro board widget's own button used.
    button.dataset.macroRunButton = "";
    button.setAttribute("data-bs-toggle", "tooltip");
    button.setAttribute("data-bs-title", isEditing?.() ? "Edit in Loom" : "Run macro");
    const iconEl = el("span", "iconify fs-4");
    iconEl.dataset.icon = card.icon || "tabler:bolt";
    iconEl.setAttribute("aria-hidden", "true");
    button.appendChild(iconEl);
    button.appendChild(el("span", "small text-center", macroRef));
    button.addEventListener("click", () => {
      if (isEditing?.()) {
        void findMacro(dataManager, macroRef).then((macro) => {
          if (macro) window.location.href = `loom/index.html?macro=${encodeURIComponent(macro.id)}`;
        });
        return;
      }
      void runMacroReference(macroRef, { dataManager, groupContext, status, ensureWidget, onWledDevicesChange });
    });
    return button;
  }

  function persist(next) {
    config = next;
    setContentRef?.(config);
    setTitle?.(config.name);
    render();
  }

  function updateBucket(bucketId, mutate) {
    persist({ ...config, buckets: config.buckets.map((bucket) => (bucket.id === bucketId ? mutate(bucket) : bucket)) });
  }

  function updateCardField(bucketId, cardId, patch) {
    updateBucket(bucketId, (bucket) => ({ ...bucket, cards: bucket.cards.map((card) => (card.id === cardId ? { ...card, ...patch } : card)) }));
  }

  // A modal, not an inline in-card form — a card in a 14rem-wide bucket
  // column has nowhere near enough room to usably hold an icon picker,
  // color swatch, and text field at once. Singleton element (like
  // content-picker.js's own ensureModal), lives outside `container`
  // entirely — every field commit below re-renders the WHOLE widget (same
  // persist()->render() every other field in this widget already goes
  // through), but that only touches `container`'s own subtree, so the
  // modal stays open and undisturbed across edits.
  const CARD_EDIT_MODAL_ID = "undercroft-board-card-edit-modal";
  function ensureCardEditModal() {
    let modal = document.getElementById(CARD_EDIT_MODAL_ID);
    if (modal) return modal;
    const wrapper = document.createElement("div");
    wrapper.innerHTML = `
      <div class="modal fade" id="${CARD_EDIT_MODAL_ID}" tabindex="-1" aria-hidden="true">
        <div class="modal-dialog modal-dialog-centered">
          <div class="modal-content">
            <div class="modal-header">
              <h1 class="modal-title fs-5">Edit card</h1>
              <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Close"></button>
            </div>
            <div class="modal-body d-flex flex-column gap-3" data-board-card-edit-body></div>
            <div class="modal-footer">
              <button type="button" class="btn btn-outline-danger me-auto" data-board-card-edit-delete>
                <span class="iconify" data-icon="tabler:trash" aria-hidden="true"></span> Delete card
              </button>
              <button type="button" class="btn btn-primary" data-bs-dismiss="modal">Done</button>
            </div>
          </div>
        </div>
      </div>
    `;
    const element = wrapper.firstElementChild;
    document.body.appendChild(element);
    return element;
  }

  function openCardEditModal(bucket, card) {
    const modalElement = ensureCardEditModal();
    const modal =
      window.bootstrap && typeof window.bootstrap.Modal === "function"
        ? window.bootstrap.Modal.getOrCreateInstance(modalElement)
        : null;
    const body = modalElement.querySelector("[data-board-card-edit-body]");
    const deleteButton = modalElement.querySelector("[data-board-card-edit-delete]");
    body.innerHTML = "";

    // Re-reads the live card from `config` rather than trusting the `card`
    // argument — every field commit below re-renders this whole widget
    // (rebuilding a fresh `bucket`/`card` object each time), so the
    // ORIGINAL closure argument goes stale the instant the GM changes a
    // second field.
    function currentCard() {
      const liveBucket = config.buckets.find((entry) => entry.id === bucket.id);
      return liveBucket?.cards.find((entry) => entry.id === card.id) || card;
    }

    const propsRow = el("div", "d-flex gap-2 align-items-end");
    // sources: ["tabler"] — this card's `icon` is a `tabler:*` Iconify
    // identifier (the same convention every other icon in this widget, and
    // the macro kind's own `.icon` field authored in Loom, already use),
    // not the bi-*/ddb-* CSS-class vocabulary this shared field searches by
    // default (Press/Workbench's own content-icon convention). Restricting
    // the search is what makes both the dropdown suggestions AND the
    // preview swatch actually match what this field can render — see
    // icon-picker.js's own header comment for why the default excludes
    // "tabler" (a bi-*/ddb-* suggestion here would be a value nothing in
    // this widget's own render pipeline could ever display).
    const iconField = createIconPickerField({
      label: "Icon",
      value: currentCard().icon || "",
      placeholder: "Search Tabler icons…",
      sources: ["tabler"],
      onSelect: (value) => updateCardField(bucket.id, card.id, { icon: value }),
    });
    iconField.classList.add("flex-grow-1");
    const colorField = el("div", "d-flex flex-column gap-1");
    colorField.appendChild(el("label", "form-label small text-body-secondary fw-semibold", "Color"));
    const colorInput = document.createElement("input");
    colorInput.type = "color";
    colorInput.className = "form-control form-control-color";
    colorInput.setAttribute("aria-label", "Card color");
    colorInput.value = currentCard().color || "#6c757d";
    colorInput.addEventListener("change", () => updateCardField(bucket.id, card.id, { color: colorInput.value }));
    colorField.appendChild(colorInput);
    propsRow.append(iconField, colorField);
    body.appendChild(propsRow);

    const textWrap = el("div", "d-flex flex-column gap-1");
    textWrap.appendChild(el("label", "form-label small text-body-secondary fw-semibold", "Text"));
    const textInput = document.createElement("textarea");
    textInput.className = "form-control";
    textInput.rows = 3;
    textInput.value = currentCard().text || "";
    textInput.placeholder = "[[Journal Page]], a URL, `macro:Name`, `dice:1d6`, `npc:Name`…";
    const commitText = () => updateCardField(bucket.id, card.id, { text: textInput.value.trim() });
    textInput.addEventListener("blur", commitText);
    // Attached BEFORE this input's own keydown listener below, same
    // ordering (and same reason) as the "Add a card" input in renderBucket
    // — each autocomplete's own keydown handler needs to run FIRST so
    // event.defaultPrevented is already set by the time this input's own
    // Enter-to-commit handler checks it.
    const codeAutocomplete = attachCodeBlockAutocomplete(textInput, { dataManager });
    const wikiAutocomplete = attachWikiLinkAutocomplete(textInput, { getEntries: () => journalEntriesForAutocomplete });
    modalElement.addEventListener(
      "hidden.bs.modal",
      () => {
        codeAutocomplete.destroy();
        wikiAutocomplete.destroy();
      },
      { once: true }
    );
    // Same defer-to-the-autocomplete guard the "Add a card" input uses —
    // Enter here both selects a candidate (either autocomplete) AND would
    // commit the field (this handler); event.defaultPrevented means one of
    // them already claimed this keystroke.
    textInput.addEventListener("keydown", (event) => {
      if (event.defaultPrevented) return;
      if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        commitText();
      }
    });
    textWrap.appendChild(textInput);
    body.appendChild(textWrap);

    deleteButton.onclick = () => {
      modal?.hide();
      updateBucket(bucket.id, (b) => ({ ...b, cards: b.cards.filter((c) => c.id !== card.id) }));
    };

    if (modal) {
      modal.show();
    } else {
      // No Bootstrap JS on the page (shouldn't happen anywhere in this
      // suite, but stay defensive rather than silently doing nothing).
      modalElement.classList.add("show");
      modalElement.style.display = "block";
    }
  }

  function handleBucketSortEnd(event) {
    const bucketId = event.item.dataset.bucketId;
    const buckets = config.buckets.slice();
    const fromIndex = buckets.findIndex((bucket) => bucket.id === bucketId);
    if (fromIndex === -1) return;
    const [moved] = buckets.splice(fromIndex, 1);
    buckets.splice(event.newIndex, 0, moved);
    persist({ ...config, buckets });
  }

  // Reads stable ids off the dragged item/source/destination rather than
  // trusting raw index math across two independently-managed lists — safe
  // regardless of how SortableJS's own oldIndex/newIndex line up with this
  // widget's own array indices.
  function handleCardSortEnd(event) {
    const cardId = event.item.dataset.cardId;
    const fromBucketId = event.from.dataset.bucketId;
    const toBucketId = event.to.dataset.bucketId;
    if (!cardId || !fromBucketId || !toBucketId) return;
    const buckets = config.buckets.map((bucket) => ({ ...bucket, cards: bucket.cards.slice() }));
    const fromBucket = buckets.find((bucket) => bucket.id === fromBucketId);
    const toBucket = buckets.find((bucket) => bucket.id === toBucketId);
    if (!fromBucket || !toBucket) return;
    const cardIndex = fromBucket.cards.findIndex((card) => card.id === cardId);
    if (cardIndex === -1) return;
    const [card] = fromBucket.cards.splice(cardIndex, 1);
    toBucket.cards.splice(event.newIndex, 0, card);
    persist({ ...config, buckets });
  }

  function renderCard(bucket, card) {
    const cardEl = el("div", "border rounded-2 bg-body-tertiary p-2 d-flex align-items-start gap-2");
    cardEl.dataset.cardId = card.id;
    if (card.color) {
      cardEl.style.borderLeftColor = card.color;
      cardEl.style.borderLeftWidth = "3px";
    }

    const grip = el("span", "iconify text-body-secondary mt-1");
    grip.dataset.icon = "tabler:grip-vertical";
    grip.dataset.sortableHandle = "";
    grip.style.cursor = "grab";
    grip.setAttribute("aria-hidden", "true");

    const body = el("div", "flex-grow-1");
    body.style.minWidth = "0";

    const macroRef = card.text ? isPureMacroCard(card.text) : null;
    if (macroRef) {
      body.appendChild(renderMacroButtonCard(card, macroRef));
    } else if (card.text && card.text.trim()) {
      if (card.icon) {
        const header = el("div", "d-flex align-items-center gap-1 mb-1");
        const iconEl = el("span", "iconify");
        iconEl.dataset.icon = card.icon;
        iconEl.setAttribute("aria-hidden", "true");
        if (card.color) iconEl.style.color = card.color;
        header.appendChild(iconEl);
        body.appendChild(header);
      }
      body.appendChild(renderCardMarkdown(card));
    } else {
      body.appendChild(el("span", "text-body-secondary small fst-italic", "Empty card"));
    }

    const actions = el("div", "d-flex flex-column gap-1");
    actions.appendChild(
      createIconButton({
        icon: "tabler:pencil",
        label: "Edit card",
        // A modal, not an inline swap — the card itself is far too small to
        // usably hold an icon picker + color swatch + text field + preview
        // all at once (confirmed real complaint, not a hypothetical).
        onClick: () => openCardEditModal(bucket, card),
      })
    );
    actions.appendChild(
      createIconButton({
        icon: "tabler:trash",
        label: "Delete card",
        onClick: () => updateBucket(bucket.id, (b) => ({ ...b, cards: b.cards.filter((c) => c.id !== card.id) })),
      })
    );

    cardEl.append(grip, body, actions);
    return cardEl;
  }

  function renderBucket(bucket) {
    const column = el("div", "d-flex flex-column gap-2 border rounded-3 p-2 bg-body");
    column.style.minWidth = "14rem";
    column.style.maxWidth = "14rem";
    column.dataset.bucketId = bucket.id;

    const header = el("div", "d-flex align-items-center gap-1");
    const grip = el("span", "iconify text-body-secondary");
    grip.dataset.icon = "tabler:grip-vertical";
    grip.dataset.sortableHandle = "";
    grip.style.cursor = "grab";
    grip.setAttribute("aria-hidden", "true");

    const titleInput = document.createElement("input");
    titleInput.type = "text";
    titleInput.className = "form-control form-control-sm fw-semibold flex-grow-1";
    titleInput.value = bucket.title;
    titleInput.addEventListener("change", () => {
      updateBucket(bucket.id, (b) => ({ ...b, title: titleInput.value.trim() || "Untitled" }));
    });

    header.append(
      grip,
      titleInput,
      createIconButton({
        icon: "tabler:trash",
        label: "Delete bucket",
        onClick: () => persist({ ...config, buckets: config.buckets.filter((b) => b.id !== bucket.id) }),
      })
    );
    column.appendChild(header);

    const cardList = el("div", "d-flex flex-column gap-2 flex-grow-1 overflow-auto");
    cardList.style.minHeight = "3rem";
    cardList.dataset.bucketId = bucket.id;
    bucket.cards.forEach((card) => cardList.appendChild(renderCard(bucket, card)));
    column.appendChild(cardList);
    activeSortables.push(createSortable(cardList, { group: { name: cardGroupName, pull: true, put: true }, onEnd: handleCardSortEnd }));

    const addRow = el("div", "d-flex gap-1");
    const addInput = document.createElement("input");
    addInput.type = "text";
    addInput.className = "form-control form-control-sm";
    addInput.placeholder = "Add a card… [[Page]] or `macro:";
    addInput.dataset.addInput = bucket.id;
    const commitAdd = () => {
      const text = addInput.value.trim();
      if (!text) return;
      pendingFocusBucketId = bucket.id;
      updateBucket(bucket.id, (b) => ({ ...b, cards: [...b.cards, { id: randomId(), icon: "", color: "", text }] }));
    };
    // Both autocompletes attached BEFORE this input's own keydown listener
    // — see event.defaultPrevented below. Only ever one of the two open at
    // once (mutually exclusive trigger patterns: an unclosed backtick vs.
    // an unclosed double-open-bracket), so there's no conflict between
    // them, just between whichever's open and this input's own
    // Enter-to-add behavior.
    activeAutocompletes.push(attachCodeBlockAutocomplete(addInput, { dataManager }));
    activeAutocompletes.push(attachWikiLinkAutocomplete(addInput, { getEntries: () => journalEntriesForAutocomplete }));
    // event.defaultPrevented is only ever true here when one of the two
    // dropdowns above is open and just consumed this exact keypress
    // (selecting a candidate, navigating, or closing itself) — this
    // input's own Enter-to-add-the-card behavior must NOT also fire on
    // that same keystroke.
    addInput.addEventListener("keydown", (event) => {
      if (event.defaultPrevented) return;
      if (event.key === "Enter") {
        event.preventDefault();
        commitAdd();
      }
    });
    addRow.append(addInput, createIconButton({ icon: "tabler:plus", label: "Add card", onClick: commitAdd }));
    column.appendChild(addRow);

    return column;
  }

  function render() {
    if (destroyed) return;
    activeSortables.forEach((sortable) => sortable?.destroy?.());
    activeSortables = [];
    activeAutocompletes.forEach((autocomplete) => autocomplete?.destroy?.());
    activeAutocompletes = [];
    disposeTooltips(container);
    container.innerHTML = "";

    const wrap = el("div", "d-flex flex-column gap-2 h-100");
    wrap.style.minHeight = "0";

    const headerRow = el("div", "d-flex align-items-center gap-2");
    const nameInput = document.createElement("input");
    nameInput.type = "text";
    nameInput.className = "form-control form-control-sm fw-semibold flex-grow-1";
    nameInput.placeholder = "Board name";
    nameInput.value = config.name;
    nameInput.addEventListener("change", () => persist({ ...config, name: nameInput.value.trim() || "New Board" }));
    headerRow.append(
      nameInput,
      createIconButton({
        icon: "tabler:plus",
        label: "Add bucket",
        onClick: () => persist({ ...config, buckets: [...config.buckets, { id: randomId(), title: "New Bucket", cards: [] }] }),
      })
    );
    wrap.appendChild(headerRow);

    const bucketsRow = el("div", "d-flex gap-2 flex-grow-1 overflow-auto align-items-start");
    bucketsRow.style.minHeight = "0";
    if (!config.buckets.length) {
      bucketsRow.appendChild(el("div", "text-body-secondary small", "No buckets yet — add one to get started."));
    } else {
      config.buckets.forEach((bucket) => bucketsRow.appendChild(renderBucket(bucket)));
    }
    wrap.appendChild(bucketsRow);

    container.appendChild(wrap);

    if (config.buckets.length > 1) {
      activeSortables.push(createSortable(bucketsRow, { direction: "horizontal", onEnd: handleBucketSortEnd }));
    }

    refreshTooltips(container);

    if (pendingFocusBucketId) {
      container.querySelector(`[data-add-input="${pendingFocusBucketId}"]`)?.focus();
      pendingFocusBucketId = null;
    }
  }

  render();
  setTitle?.(config.name);
  // First mount with nothing saved yet — persist the default immediately so
  // a reload doesn't silently regenerate/lose it (same reasoning clocks.js's
  // own equivalent line documents).
  if (!contentRef) setContentRef?.(config);
  void loadReferenceData();

  return {
    refresh: () => render(),
    destroy() {
      destroyed = true;
      activeSortables.forEach((sortable) => sortable?.destroy?.());
      activeSortables = [];
      activeAutocompletes.forEach((autocomplete) => autocomplete?.destroy?.());
      activeAutocompletes = [];
      disposeTooltips(container);
      container.innerHTML = "";
    },
  };
}
