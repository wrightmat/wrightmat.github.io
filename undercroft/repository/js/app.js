import { initAppShell, resolveToolContextPath, resolveToolHref } from "../../common/js/lib/app-shell.js";
import { initAuthControls } from "../../common/js/lib/auth-ui.js";
import { initHelpSystem } from "../../common/js/lib/help.js";
import { refreshTooltips } from "../../common/js/lib/tooltips.js";
import { DataManager } from "../../common/js/lib/data-manager.js";
import { resolveApiBase } from "../../common/js/lib/api.js";
import { fetchKindEntriesWithIds, loadLibraryKinds } from "../../common/js/lib/content-fetch.js";
import { openContentPicker } from "../../common/js/lib/widgets/content-picker.js";
import { allowsDelete, refreshOwnershipCatalog, confirmDelete } from "../../common/js/lib/ownership.js";
import { renderTagBadges, renderTagDatalist, buildTagInputRow } from "../../common/js/lib/widgets/tag-editor.js";
import { renderMarkdown } from "./lib/markdown.js";
import { buildTitleIndex, findBacklinks } from "./lib/journal-links.js";
import { buildGroupTree, getDisplayPills, parseTag } from "./lib/journal-tags.js";
import { extractOutline } from "./lib/journal-outline.js";
import { toggleTaskLine, taskLineText, updateCheckboxLineText } from "./lib/journal-tasks.js";
import { startEncounter, deterministicEncounterId } from "./lib/journal-encounter.js";
import { extractContentReferences, findKindReferenceRecord, EXCLUDED_KINDS } from "./lib/journal-kind-reference.js";
import { attachWikiLinkAutocomplete } from "./lib/wiki-link-autocomplete.js";
import { attachCodeBlockAutocomplete } from "./lib/code-block-autocomplete.js";
import { createToolbarButtonGroup, createCollapsibleSection, createEmptyStateCard } from "../../common/js/lib/ui-components.js";
import { initToolSettings } from "../../common/js/lib/tool-settings.js";
import { el } from "../../common/js/lib/dom.js";

const KIND = "journal";
const TAG_DATALIST_ID = "repository-tag-datalist";

const { status, undoStack, undo, redo } = initAppShell({
  namespace: "repository",
  storagePrefix: "undercroft.repository.undo",
  leftPaneLabel: "Toggle page list",
  rightPaneLabel: "Toggle page details",
  settingsSlotAttr: "data-repository-settings-slot",
  onUndo: (entry) => {
    if (!entry) return null;
    applyPayloadSnapshot(entry.before);
    return { message: entry.label ? `Undid ${entry.label}` : "Undid last action" };
  },
  onRedo: (entry) => {
    if (!entry) return null;
    applyPayloadSnapshot(entry.after);
    return { message: entry.label ? `Redid ${entry.label}` : "Redid last action" };
  },
});
const dataManager = new DataManager({ baseUrl: resolveApiBase(), storagePrefix: "undercroft.repository" });
initAuthControls({ root: document, status, dataManager });

// The card itself (not a wrapper — unlike the other generator tools'
// data-*-empty-state divs, this attribute lives directly on the card, same
// as its sibling data-repository-editor) carries the empty-state attribute
// this file's own editorEmptyEl below expects to find, so it's built and
// swapped in for the plain mount marker before that query runs.
{
  const emptyCard = createEmptyStateCard({ message: "Select a page from the list, or create a new one." });
  emptyCard.setAttribute("data-repository-editor-empty", "");
  document.querySelector("[data-editor-empty-mount]")?.replaceWith(emptyCard);
}

const searchInput = document.querySelector("[data-repository-search]");
const pageTreeEl = document.querySelector("[data-repository-page-tree]");
const editorEmptyEl = document.querySelector("[data-repository-editor-empty]");
const editorEl = document.querySelector("[data-repository-editor]");
const titleInput = document.querySelector("[data-repository-title]");
const bodyTextarea = document.querySelector("[data-repository-body]");
const previewEl = document.querySelector("[data-repository-preview]");
const tagsBadgesEl = document.querySelector("[data-repository-tags-badges]");
const tagsInputEl = document.querySelector("[data-repository-tags-input]");
const parentContentEl = document.querySelector("[data-repository-parent-content]");
const relatedListEl = document.querySelector("[data-repository-related-list]");
const backlinksListEl = document.querySelector("[data-repository-backlinks-list]");
const outlineListEl = document.querySelector("[data-repository-outline-list]");
const settingsSlotEl = document.querySelector("[data-repository-settings-slot]");

// A generic, reusable settings modal (common/js/lib/tool-settings.js) — the
// gear button it builds mounts into settingsSlotEl (the header, to the left
// of the pane-collapse toggle — see index.html), which is this tool's own
// choice of placement; another tool adopting the same module could put its
// button somewhere else entirely.
//
// Checking a task box off is always interactive (see markdown.js/
// journal-tasks.js) — that part isn't a setting. The one thing this
// controls is whether doing so *also* appends a "✅ YYYY-MM-DD" completion
// stamp (read live in handleToggleTask below) — on by default, matching
// Obsidian's own Tasks plugin.
const toolSettings = initToolSettings({
  toolId: "repository",
  dataManager,
  status,
  title: "Repository Settings",
  definitions: [
    {
      key: "appendCompletionStamp",
      label: "Add completion date to checked tasks",
      helpTopic: "repository.completionStamp",
      default: true,
    },
  ],
  mountButton: (button) => settingsSlotEl?.appendChild(button),
});

// Adopts each section's existing static `[data-xxx-panel]` markup (its own
// content stays hand-authored HTML — only the header+chevron wrapper is
// JS-built) as the collapsible section's content; createCollapsibleSection's
// own internal bindCollapsibleToggle replaces the old standalone calls this
// block used to make directly.
//
// Outline defaults open regardless of content (it's navigation, not a
// content-dependent section like Tags/Related/Backlinks below) — still
// user-collapsible via the same toggle, just no programmatic re-collapsing.
{
  const outlineSection = createCollapsibleSection({
    label: "Outline",
    collapsed: false,
    content: document.querySelector("[data-repository-outline-panel]"),
  });
  document.querySelector("[data-repository-outline-mount]")?.appendChild(outlineSection.section);
}
// Tags/Parent/Related/Backlinks start collapsed — each is opened
// programmatically the moment it actually has something to show (see
// renderTags/renderParent/renderRelated/renderBacklinks below), not left to
// a fixed initial state.
const tagsSection = createCollapsibleSection({
  label: "Tags",
  helpTopic: "repository.tags",
  collapsed: true,
  content: document.querySelector("[data-repository-tags-panel]"),
});
document.querySelector("[data-repository-tags-mount]")?.appendChild(tagsSection.section);
const setTagsCollapsed = tagsSection.setCollapsed;
const parentSection = createCollapsibleSection({
  label: "Parent",
  helpTopic: "repository.parent",
  collapsed: true,
  content: document.querySelector("[data-repository-parent-panel]"),
});
document.querySelector("[data-repository-parent-mount]")?.appendChild(parentSection.section);
const setParentCollapsed = parentSection.setCollapsed;
const relatedSection = createCollapsibleSection({
  label: "Related",
  collapsed: true,
  content: document.querySelector("[data-repository-related-panel]"),
});
document.querySelector("[data-repository-related-mount]")?.appendChild(relatedSection.section);
const setRelatedCollapsed = relatedSection.setCollapsed;
const backlinksSection = createCollapsibleSection({
  label: "Backlinks",
  collapsed: true,
  content: document.querySelector("[data-repository-backlinks-panel]"),
});
document.querySelector("[data-repository-backlinks-mount]")?.appendChild(backlinksSection.section);
const setBacklinksCollapsed = backlinksSection.setCollapsed;

// Built and inserted (in order) before the static toggle-mode button
// (bespoke dual-icon-swap markup the shared factory doesn't model), so every
// existing data-action selector below keeps working unchanged.
{
  const pageButtons = createToolbarButtonGroup([
    { action: "undo", label: "Undo", attrs: { "data-action": "undo-page" } },
    { action: "redo", label: "Redo", attrs: { "data-action": "redo-page" } },
    { action: "new", label: "New Page", attrs: { "data-action": "new-page" } },
    { action: "duplicate", variant: "outline-secondary", label: "Duplicate Page", disabled: true, attrs: { "data-action": "duplicate-page" } },
    { action: "save", label: "Save Page", disabled: true, attrs: { "data-action": "save-page" } },
    { action: "delete", label: "Delete Page", disabled: true, attrs: { "data-action": "delete-page" } },
  ]);
  const toggleModeButton = document.querySelector('[data-page-toolbar-mount] [data-action="toggle-mode"]');
  if (toggleModeButton) {
    toggleModeButton.before(...pageButtons);
  } else {
    document.querySelector("[data-page-toolbar-mount]")?.append(...pageButtons);
  }
}

const undoButton = document.querySelector('[data-action="undo-page"]');
const redoButton = document.querySelector('[data-action="redo-page"]');
const newButton = document.querySelector('[data-action="new-page"]');
const duplicateButton = document.querySelector('[data-action="duplicate-page"]');
const saveButton = document.querySelector('[data-action="save-page"]');
const deleteButton = document.querySelector('[data-action="delete-page"]');
const modeToggleButton = document.querySelector('[data-action="toggle-mode"]');
// `data-repository-mode-icon` lives on a plain wrapper *around* each
// `.iconify` span, not on the icon span itself — root cause of the actual
// bug (confirmed, not guessed): Iconify replaces every `.iconify` element
// it scans with a rendered `<svg>`, and that replacement doesn't carry
// arbitrary custom data-* attributes over to the new node. Querying/toggling
// `[data-repository-mode-icon]` directly on the icon span itself was
// therefore finding (or, after Iconify ran, silently failing to find) the
// wrong/stale element — nothing was actually broken about the toggle logic
// itself. The wrapper is never touched by Iconify, so it's a stable,
// permanent target for `d-none` regardless of what Iconify does inside it.
const modeEyeIconEl = modeToggleButton?.querySelector('[data-repository-mode-icon="view"]');
const modePencilIconEl = modeToggleButton?.querySelector('[data-repository-mode-icon="edit"]');
const modeLabelEl = modeToggleButton?.querySelector("[data-repository-mode-label]");

// The whole in-memory saved-page list — re-fetched after every save/delete
// rather than patched in place, since backlinks/the group tree/wiki-link
// resolution all need to reflect the *other* pages' current state too, not
// just the one being edited.
let entries = [];
// Ownership metadata for every currently-listed page (owner id/username,
// share permissions, local-only) — refreshed alongside `entries`, and what
// the Delete button's tier-gating (allowsDelete) actually reads.
let ownershipCatalog = new Map();
let selectedId = "";
// A page that's been created (New/Duplicate) but never actually persisted —
// not part of `entries` until the first successful Save, at which point this
// clears and the refetched `entries` takes over. Never deletable (nothing
// exists server-side yet to delete) and never subject to ownership gating.
let draftEntry = null;
// The in-memory edit state of whichever page is selected — mutated directly
// by the title/body/tags controls, compared against `cleanSnapshot` to
// drive Save's dirty-gating. Deliberately NOT auto-saved on every keystroke
// (see Save's own button) — same explicit-Save convention Press/Orrery both
// use, not a parallel autosave model.
let workingPayload = null;
let cleanSnapshot = null;
let currentMode = "edit";
// The "before" half of a pending, not-yet-committed title/body undo entry —
// captured at the start of a burst of typing, cleared once that burst is
// committed (debounced, or flushed early by blur/Ctrl+Z — see
// scheduleFieldCommit/commitFieldEdit near the bottom of this file).
let fieldEditBaseline = null;

function generateId() {
  return `journal_${Math.random().toString(36).slice(2, 10)}`;
}

function cloneTags(tags) {
  return [...(tags || [])];
}

// Every Library kind this page's own `` `kindId:Name` `` references/
// autocomplete can target, minus the ones journal-kind-reference.js's own
// EXCLUDED_KINDS already carves out (journal/kind/encounter/macro — the
// first two don't make sense as a generic reference, the latter two have
// their own richer, dedicated syntax already). Fetched once and cached —
// this suite's kind list doesn't change mid-session. `validKindIds`/
// `kindLabelsMap` are read SYNCHRONOUSLY by renderPreview (renderMarkdown
// itself never fetches anything, see its own header comment) — empty until
// this resolves, same "chips just don't appear yet" grace period every
// other fetch-then-render path in this file already accepts, rather than
// blocking the first render on it.
let libraryKindsPromise = null;
let validKindIds = new Set();
let kindLabelsMap = {};
function ensureLibraryKinds() {
  if (!libraryKindsPromise) {
    libraryKindsPromise = loadLibraryKinds()
      .then((kinds) => {
        const list = kinds || [];
        validKindIds = new Set(list.map((kind) => kind.id).filter((id) => !EXCLUDED_KINDS.has(id)));
        kindLabelsMap = Object.fromEntries(list.map((kind) => [kind.id, kind.label || kind.id]));
        return list;
      })
      .catch(() => []);
  }
  return libraryKindsPromise;
}

// Merges the remote list (fetchKindEntriesWithIds — {id, entity}) with
// whatever's local-only (listLocalEntries — {id, payload}), normalizing both
// into the same {id, payload} shape everything else in this file expects.
// Same merge pattern handout.js's own openHandoutPicker already uses for its
// item dropdown.
async function fetchAllEntries() {
  let remote = [];
  try {
    remote = await fetchKindEntriesWithIds(dataManager, KIND);
  } catch (error) {
    remote = [];
  }
  const remoteNormalized = remote.map((entry) => ({ id: entry.id, payload: entry.entity || {} }));
  const remoteIds = new Set(remoteNormalized.map((entry) => entry.id));
  const local = (dataManager.listLocalEntries(KIND) || [])
    .filter((entry) => !remoteIds.has(entry.id))
    .map((entry) => ({ id: entry.id, payload: entry.payload || {} }));
  return [...remoteNormalized, ...local];
}

function findEntry(id) {
  if (draftEntry?.id === id) return draftEntry;
  return entries.find((entry) => entry.id === id) || null;
}

function titleOf(entry) {
  return entry?.payload?.title?.trim() || "Untitled page";
}

function matchesSearch(entry, query) {
  if (!query) return true;
  const haystack = `${titleOf(entry)} ${(entry.payload?.tags || []).join(" ")}`.toLowerCase();
  return haystack.includes(query);
}

function buildPageRow(entry, depth) {
  const row = el("div", "repository-page-row d-flex align-items-center gap-1 small");
  row.dataset.repositoryPageId = entry.id;
  row.style.paddingLeft = `${depth * 0.75 + 0.5}rem`;
  if (entry.id === selectedId) row.setAttribute("data-repository-page-selected", "true");
  row.appendChild(el("span", "flex-grow-1 text-truncate", titleOf(entry)));
  getDisplayPills(entry).forEach((label) => {
    row.appendChild(el("span", "badge text-bg-secondary", label));
  });
  row.addEventListener("click", () => selectPage(entry.id));
  return row;
}

// `pageNode` is {entry, children} — buildGroupTree's own page-with-children
// wrapper (journal-tags.js), children built from parentId relationships.
// Renders the page's own row, then recurses into its children one level
// deeper, so a parent set via the right pane's "Parent" section shows its
// children nested directly underneath it here, at any depth.
function renderPageNode(pageNode, container, depth) {
  container.appendChild(buildPageRow(pageNode.entry, depth));
  pageNode.children
    .slice()
    .sort((a, b) => titleOf(a.entry).localeCompare(titleOf(b.entry)))
    .forEach((child) => renderPageNode(child, container, depth + 1));
}

function renderGroupNode(node, container, depth) {
  if (node.label) {
    const label = el("div", "repository-group-label", node.label);
    label.style.paddingLeft = `${depth * 0.75}rem`;
    container.appendChild(label);
  }
  node.pages
    .slice()
    .sort((a, b) => titleOf(a.entry).localeCompare(titleOf(b.entry)))
    .forEach((pageNode) => renderPageNode(pageNode, container, depth));
  Array.from(node.children.values())
    .sort((a, b) => a.label.localeCompare(b.label))
    .forEach((child) => renderGroupNode(child, container, depth + 1));
}

// Deliberately just `entries` (persisted pages), never draftEntry — a
// brand-new/duplicated page that hasn't been saved yet doesn't show up here
// at all until Save actually creates it, so the list never shows something
// clicking it can't actually re-select (or a phantom entry that vanishes
// the moment you look at a different page). The editor itself is still the
// obvious "you're on a new page" indicator meanwhile — title/body focused,
// Save lit up.
function renderPageTree() {
  if (!pageTreeEl) return;
  pageTreeEl.innerHTML = "";
  const query = (searchInput?.value || "").trim().toLowerCase();
  const visible = entries.filter((entry) => matchesSearch(entry, query));
  if (!visible.length) {
    pageTreeEl.appendChild(el("p", "text-body-secondary small mb-0", entries.length ? "No pages match." : "No pages yet."));
    return;
  }
  const tree = buildGroupTree(visible);
  renderGroupNode(tree, pageTreeEl, 0);
}

function updateTagDatalist() {
  const seen = new Map();
  entries.forEach((entry) => {
    (entry.payload?.tags || []).forEach((tag) => {
      if (!seen.has(tag)) seen.set(tag, { id: tag, label: tag });
    });
  });
  renderTagDatalist(TAG_DATALIST_ID, Array.from(seen.values()));
}

async function refreshEntries() {
  entries = await fetchAllEntries();
  ownershipCatalog = await refreshOwnershipCatalog(dataManager, KIND, entries.map((entry) => entry.id));
  updateTagDatalist();
  renderPageTree();
  if (selectedId && !draftEntry && !findEntry(selectedId)) {
    // Whatever was selected got removed elsewhere (deleted, or this is the
    // first load after a delete) — fall back to the empty state rather than
    // silently keep showing a stale editor for a page that no longer exists.
    clearSelection();
  }
}

// Same shape/reasoning as Orrery's own recordHistory: snapshot before,
// apply the change, snapshot after, push an undo entry only if something
// actually changed. Scoped to whichever page is currently selected — same
// single, session-wide undo stack Orrery uses for its one map at a time
// (switching pages doesn't clear it), not a separate history per page.
function recordHistory(label, applyChange) {
  if (!workingPayload) {
    applyChange();
    return;
  }
  const before = JSON.stringify(workingPayload);
  applyChange();
  const after = JSON.stringify(workingPayload);
  if (before !== after) {
    undoStack.push({ label, before, after });
  }
}

function applyPayloadSnapshot(json) {
  if (!json) return;
  window.clearTimeout(fieldCommitTimer);
  fieldCommitTimer = 0;
  workingPayload = JSON.parse(json);
  fieldEditBaseline = null;
  renderEditor();
  if (currentMode === "view") renderPreview();
  updateToolbarState();
}

function isDirty() {
  if (!selectedId || !workingPayload) return false;
  return JSON.stringify(workingPayload) !== cleanSnapshot;
}

function currentAllowsDelete() {
  if (!selectedId || draftEntry) return false;
  return allowsDelete(ownershipCatalog, selectedId, { dataManager });
}

function updateToolbarState() {
  const hasSelection = Boolean(selectedId);
  if (duplicateButton) duplicateButton.disabled = !hasSelection;
  if (saveButton) saveButton.disabled = !hasSelection || !isDirty();
  if (deleteButton) deleteButton.disabled = !currentAllowsDelete();
  if (modeToggleButton) modeToggleButton.disabled = !hasSelection;
}

// One button, not a two-way radio group — clicking it steps to the OTHER
// mode each time, same toggle-not-select idiom as Handout/Map/Combat
// Tracker's own visibility button (setRightAction) elsewhere in this suite.
// Icon/label/tooltip always describe what clicking will switch TO.
function applyMode(mode) {
  currentMode = mode;
  const isView = mode === "view";
  bodyTextarea?.classList.toggle("d-none", isView);
  previewEl?.classList.toggle("d-none", !isView);
  previewEl?.classList.toggle("d-flex", isView);
  // Showing the eye while in Edit mode (the icon describes what clicking
  // switches TO, not the current state) and vice versa.
  modeEyeIconEl?.classList.toggle("d-none", isView);
  modePencilIconEl?.classList.toggle("d-none", !isView);
  if (modeLabelEl) modeLabelEl.textContent = isView ? "Edit" : "View";
  modeToggleButton?.setAttribute("data-bs-title", isView ? "Edit" : "View");
  refreshTooltips();
  if (isView) renderPreview();
}

// Switching modes shouldn't dump you back at the top of a long page — this
// finds which heading (if any) governs whatever's currently scrolled to the
// top of the active view, switches modes, then scrolls the newly-visible
// view to that same heading via jumpToHeading (same function the Outline
// panel's own clicks already use — one "go to this heading" implementation,
// not two). Falls back to matching scroll *position as a fraction of the
// scrollable range* when there's no heading to anchor to at all (a doc with
// no headings, or scrolled above the first one) — cruder, but still keeps
// you in the same general area rather than snapping to the top.
function findCurrentHeadingIndex(outline) {
  if (!outline.length) return -1;
  if (currentMode === "view") {
    if (!previewEl) return -1;
    const containerTop = previewEl.getBoundingClientRect().top;
    let bestIndex = -1;
    outline.forEach((heading, index) => {
      const headingEl = previewEl.querySelector(`#repo-heading-${index}`);
      if (!headingEl) return;
      // The last heading whose top has scrolled up to (or past) the
      // container's own top edge is "what you're currently reading" —
      // matches how a sticky table-of-contents highlight usually works.
      if (headingEl.getBoundingClientRect().top - containerTop <= 24) bestIndex = index;
    });
    return bestIndex;
  }
  if (!bodyTextarea) return -1;
  // Same wrapped-line accounting as jumpToHeading's own edit-mode branch —
  // this is its exact inverse (given a scroll position, which heading is at
  // the top; jumpToHeading goes the other way, given a heading, what
  // scrollTop puts it at the top), so it needs the same mirror-measured
  // pixel heights, not a line-count × line-height guess that ignores
  // wrapping.
  const paddingBottom = parseFloat(getComputedStyle(bodyTextarea).paddingBottom) || 0;
  const lines = (workingPayload?.body || "").split("\n");
  let bestIndex = -1;
  outline.forEach((heading, index) => {
    const textBeforeHeading = lines.slice(0, heading.line).join("\n");
    const headingTop = measureTextareaContentHeight(bodyTextarea, textBeforeHeading) - paddingBottom;
    if (headingTop <= bodyTextarea.scrollTop + 24) bestIndex = index;
  });
  return bestIndex;
}

function activeScrollEl() {
  return currentMode === "view" ? previewEl : bodyTextarea;
}

function computeScrollFraction() {
  const target = activeScrollEl();
  if (!target) return 0;
  const scrollable = target.scrollHeight - target.clientHeight;
  return scrollable > 0 ? target.scrollTop / scrollable : 0;
}

function applyScrollFraction(fraction) {
  const target = activeScrollEl();
  if (!target) return;
  const scrollable = target.scrollHeight - target.clientHeight;
  target.scrollTop = scrollable * fraction;
}

// Polls (via rAF, not a fixed frame count) until `target` genuinely has
// layout — clientHeight > 0 — before running `callback`. A fixed "wait two
// frames" guess turned out not to be enough for the very first time
// bodyTextarea/previewEl are ever measured in a session (consistently
// reproducible: first switch lands wrong, every switch after that is
// correct) — whatever the browser actually needs that first time, this
// waits for the concrete signal that layout happened instead of guessing
// how many frames that takes. Gives up after ~10 frames (roughly 160ms) and
// runs the callback anyway rather than waiting forever if something else is
// wrong.
function whenLaidOut(target, callback, attemptsLeft = 10) {
  if (!target || target.clientHeight > 0 || attemptsLeft <= 0) {
    callback();
    return;
  }
  requestAnimationFrame(() => whenLaidOut(target, callback, attemptsLeft - 1));
}

function toggleMode() {
  const outline = workingPayload ? extractOutline(workingPayload.body) : [];
  const headingIndex = findCurrentHeadingIndex(outline);
  const scrollFraction = computeScrollFraction();
  applyMode(currentMode === "view" ? "edit" : "view");
  whenLaidOut(activeScrollEl(), () => {
    if (headingIndex >= 0 && outline[headingIndex]) {
      jumpToHeading(outline[headingIndex], headingIndex);
    } else {
      applyScrollFraction(scrollFraction);
    }
  });
}

function renderPreview() {
  if (!previewEl || !workingPayload) return;
  previewEl.innerHTML = "";
  const titleIndex = buildTitleIndex(entries);
  const node = renderMarkdown(workingPayload.body, {
    resolveWikiLink: (title) => titleIndex.resolve(title),
    onNavigate: (target) => handleWikiLinkNavigate(target),
    status,
    interactiveCheckboxes: true,
    onToggleTask: (lineIndex, checkboxEl) => handleToggleTask(lineIndex, checkboxEl),
    interactiveEncounters: true,
    onStartEncounter: (creatures, blockIndex) => void handleStartEncounter(creatures, blockIndex),
    interactiveDice: true,
    interactiveMacros: true,
    // Same source Combat Tracker's own autoShowOnStart and this file's own
    // handleStartEncounter use for the equivalent action — this GM's own
    // active campaign, not a per-page setting.
    groupContext: { groupId: dataManager.getActiveGroup()?.groupId || "" },
    dataManager,
    // Empty until ensureLibraryKinds resolves — renderMarkdown stays fully
    // synchronous (see its own header comment), so a `` `kindId:Name` ``
    // block simply doesn't turn into a chip on the very first render of the
    // very first page opened this session; every later render (kinds are
    // fetched once, cached module-wide) has them.
    validKindIds,
    kindLabels: kindLabelsMap,
    onOpenReference: (kindId, name) => void handleOpenReference(kindId, name),
  });
  previewEl.appendChild(node);
  // Positional pairing with the Outline panel's own entries (extractOutline
  // scans the same raw text top-to-bottom) — an id per rendered heading, in
  // order, is what jumpToHeading scrolls to in View mode.
  previewEl.querySelectorAll("h1, h2, h3, h4, h5, h6").forEach((heading, index) => {
    heading.id = `repo-heading-${index}`;
  });
}

function handleWikiLinkNavigate(target) {
  if (target.missing) {
    createDraftEntry({ title: target.title });
    return;
  }
  // Arriving via a link is never "remember where I left this page" — a
  // [[Page#Heading]] link jumps straight to that heading; a plain [[Page]]
  // link lands at the top, regardless of whatever scroll position happened
  // to be sitting there from a previous visit (see scrollMemory).
  selectPage(target.id, { heading: target.heading || "", remember: false });
}

// Checking a task box is a real content edit (unlike the dice-roller's
// ephemeral re-rolls) — it goes through recordHistory like any other body
// change, and updates the checkbox's own rendered <li> text directly rather
// than re-rendering the whole preview, so it doesn't disturb scroll
// position the way a full renderPreview() would.
function handleToggleTask(lineIndex, checkboxEl) {
  if (!workingPayload) return;
  const appendStamp = Boolean(toolSettings.get("appendCompletionStamp"));
  recordHistory("toggle task", () => {
    workingPayload.body = toggleTaskLine(workingPayload.body, lineIndex, { appendStamp });
  });
  if (checkboxEl) updateCheckboxLineText(checkboxEl, taskLineText(workingPayload.body, lineIndex));
  updateToolbarState();
}

// Clicking an `encounter:` chip in the preview — builds and starts a real
// Combat Tracker encounter from the parsed creature list (journal-encounter.js
// owns the whole flow: match against the Library, resolve stats, save,
// spotlight, then navigate to/reload the Dashboard so Combat Tracker picks
// it up). groupId comes from this GM's own active campaign, same source
// Combat Tracker's own autoShowOnStart uses for the equivalent action.
function handleStartEncounter(creatures, blockIndex) {
  if (!workingPayload || !selectedId) return;
  void startEncounter({
    dataManager,
    status,
    title: workingPayload.title,
    creatures,
    groupId: dataManager.getActiveGroup()?.groupId || "",
    currentSection: resolveToolContextPath(),
    id: deterministicEncounterId(selectedId, blockIndex),
  });
}

// True if setting `candidateParentId` as `forId`'s parent would create a
// cycle — i.e. `forId` is already somewhere in `candidateParentId`'s own
// ancestor chain, which would make `candidateParentId` a descendant of
// `forId`. Walks `entries` (the last-saved payloads), not workingPayload —
// a candidate parent has to already exist as a real page to begin with
// (openContentPicker only ever offers saved/local KIND entries).
function wouldCreateCycle(candidateParentId, forId) {
  const byId = new Map(entries.map((entry) => [entry.id, entry]));
  let cursor = candidateParentId;
  const seen = new Set();
  while (cursor) {
    if (cursor === forId) return true;
    if (seen.has(cursor)) return true;
    seen.add(cursor);
    cursor = byId.get(cursor)?.payload?.parentId || null;
  }
  return false;
}

// A more pronounced relationship than a Related reference or a backlink —
// one page can have exactly one parent, which is what nests it under that
// page in the left-pane list (see buildPageNode/buildGroupTree in
// journal-tags.js and renderPageNode above). Kept as its own section rather
// than folded into Related since it's a structured single-value field
// (`workingPayload.parentId`), not a `` `kindId:Name` `` reference extracted
// from the body.
function renderParent() {
  if (!parentContentEl || !workingPayload) return;
  parentContentEl.innerHTML = "";
  const parentId = workingPayload.parentId || "";
  const parentEntry = parentId ? findEntry(parentId) : null;
  if (!parentEntry) {
    parentContentEl.appendChild(el("p", "text-body-secondary small mb-0", "No parent set."));
  } else {
    const row = el("div", "d-flex align-items-center justify-content-between gap-2 small");
    const link = el("button", "btn btn-link btn-sm p-0 text-start text-truncate", titleOf(parentEntry));
    link.type = "button";
    link.addEventListener("click", () => selectPage(parentEntry.id));
    row.appendChild(link);
    parentContentEl.appendChild(row);
  }
  const actions = el("div", "d-flex gap-2 mt-2");
  const setButton = el("button", "btn btn-outline-secondary btn-sm", parentEntry ? "Change" : "Set parent");
  setButton.type = "button";
  setButton.addEventListener("click", () => void handleSetParent());
  actions.appendChild(setButton);
  if (parentEntry) {
    const clearButton = el("button", "btn btn-outline-secondary btn-sm", "Clear");
    clearButton.type = "button";
    clearButton.addEventListener("click", () => handleClearParent());
    actions.appendChild(clearButton);
  }
  parentContentEl.appendChild(actions);
  setParentCollapsed(!parentEntry);
}

async function handleSetParent() {
  if (!workingPayload || !selectedId) return;
  const chosenId = await openContentPicker({
    dataManager,
    kind: KIND,
    title: "Choose a parent page",
    excludeIds: [selectedId],
  });
  if (!chosenId) return;
  if (wouldCreateCycle(chosenId, selectedId)) {
    status?.show("That page is already nested under this one.", { type: "error" });
    return;
  }
  const parentEntry = findEntry(chosenId);
  const inheritedGroupTags = (parentEntry?.payload?.tags || []).filter((tag) => parseTag(tag).prefix === "group");
  recordHistory("set parent", () => {
    workingPayload.parentId = chosenId;
    inheritedGroupTags.forEach((tag) => {
      if (!workingPayload.tags.includes(tag)) workingPayload.tags = [...workingPayload.tags, tag];
    });
  });
  updateToolbarState();
  renderParent();
  renderTags();
}

function handleClearParent() {
  if (!workingPayload) return;
  recordHistory("clear parent", () => {
    workingPayload.parentId = "";
  });
  updateToolbarState();
  renderParent();
  renderTags();
}

// No longer a manually maintained `refs` list with its own Add/Remove
// controls — Related is fully derived from the page's own body, same as
// Outline/Backlinks below, by scanning for `` `kindId:Name` ``/
// `` `encounter:...` ``/`` `macro:...` `` references and resolving each
// against the real Library record it names (extractContentReferences).
// Re-render is debounced off the same body-input listener that already
// drives Outline (see the textarea's "input" handler below), so this stays
// in sync as the author types rather than only refreshing on save.
let relatedRequestToken = 0;
let relatedRenderTimer = null;

// Debounced the same FIELD_COMMIT_DEBOUNCE_MS beat as scheduleFieldCommit —
// unlike renderOutline (a pure local scan), each pass here fetches every
// referenced kind's own entries, so firing it on every raw keystroke would
// mean a fetch burst per character typed rather than once per pause.
function scheduleRelatedRender() {
  window.clearTimeout(relatedRenderTimer);
  relatedRenderTimer = window.setTimeout(() => void renderRelated(), FIELD_COMMIT_DEBOUNCE_MS);
}

async function renderRelated() {
  if (!relatedListEl || !workingPayload) return;
  await ensureLibraryKinds();
  const token = (relatedRequestToken += 1);
  const refs = await extractContentReferences(workingPayload.body, dataManager, validKindIds);
  // A newer keystroke already kicked off another pass — this one's result
  // is stale, drop it rather than let it clobber the newer render.
  if (token !== relatedRequestToken) return;
  relatedListEl.innerHTML = "";
  if (!refs.length) {
    relatedListEl.appendChild(el("p", "text-body-secondary small mb-0", "Nothing referenced yet."));
    setRelatedCollapsed(true);
    return;
  }
  refs.forEach((ref) => {
    const link = el(
      "button",
      "btn btn-link btn-sm p-0 d-block text-start",
      `${kindLabelsMap[ref.kind] || ref.kind}: ${ref.name}`
    );
    link.type = "button";
    link.addEventListener("click", () => void handleOpenReference(ref.kind, ref.id));
    relatedListEl.appendChild(link);
  });
  setRelatedCollapsed(false);
}

const REFERENCE_PREVIEW_MODAL_ID = "repository-reference-preview-modal";

// A page's Related links can point into any of the other 20-odd Library
// kinds (NPCs live in Forge, monsters in Crucible, systems in Loom, ...) —
// there's no single "open this record's editor" route to jump to across
// tools, so this shows a lightweight read-only preview in place instead,
// same reasoning journal-macro.js's/journal-encounter.js's own chips stay
// self-contained rather than navigating away from the page being read.
//
// `map` is the one exception: unlike every other kind, a map IS a whole
// live view (Orrery's own pan/zoom/layers/fog), not a few lines of
// description worth a static preview — so this navigates straight to
// Orrery with that map loaded (`?map=<id>`, same deep link a spotlighted
// map's own link already uses — see journal-encounter.js's own
// resolveToolHref usage for the identical cross-tool navigation pattern)
// instead of opening the read-only modal.
async function handleOpenReference(kindId, id) {
  const record = await findKindReferenceRecord(dataManager, kindId, id);
  if (!record) {
    status?.show(`Couldn't find that ${kindLabelsMap[kindId] || kindId}.`, { type: "error", timeout: 3000 });
    return;
  }
  if (kindId === "map") {
    window.location.href = `${resolveToolHref("orrery", resolveToolContextPath())}?map=${encodeURIComponent(record.id)}`;
    return;
  }
  showReferencePreview(record);
}

function showReferencePreview(record) {
  let modal = document.getElementById(REFERENCE_PREVIEW_MODAL_ID);
  if (!modal) {
    const wrapper = document.createElement("div");
    wrapper.innerHTML = `
      <div class="modal fade" id="${REFERENCE_PREVIEW_MODAL_ID}" tabindex="-1" aria-hidden="true">
        <div class="modal-dialog modal-dialog-centered">
          <div class="modal-content">
            <div class="modal-header">
              <h1 class="modal-title fs-5" data-repository-reference-title></h1>
              <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Close"></button>
            </div>
            <div class="modal-body">
              <p class="text-body-secondary small mb-0" data-repository-reference-body></p>
            </div>
          </div>
        </div>
      </div>
    `;
    modal = wrapper.firstElementChild;
    document.body.appendChild(modal);
  }
  modal.querySelector("[data-repository-reference-title]").textContent = record.name;
  modal.querySelector("[data-repository-reference-body]").textContent =
    record.payload?.description || record.payload?.summary || "No description.";
  const bsModal =
    window.bootstrap && typeof window.bootstrap.Modal === "function"
      ? window.bootstrap.Modal.getOrCreateInstance(modal)
      : null;
  bsModal?.show();
}

function renderBacklinks() {
  if (!backlinksListEl || !workingPayload) return;
  backlinksListEl.innerHTML = "";
  const links = findBacklinks(
    entries.filter((entry) => entry.id !== selectedId),
    workingPayload.title
  );
  if (!links.length) {
    backlinksListEl.appendChild(el("p", "text-body-secondary small mb-0", "Nothing links here yet."));
    setBacklinksCollapsed(true);
    return;
  }
  links.forEach((entry) => {
    const link = el("button", "btn btn-link btn-sm p-0 d-block text-start", titleOf(entry));
    link.type = "button";
    link.addEventListener("click", () => selectPage(entry.id));
    backlinksListEl.appendChild(link);
  });
  setBacklinksCollapsed(false);
}

// The current parent's own group: tag(s) — a child inherits these (see
// handleSetParent) and they stay locked in the child's own Tags section for
// as long as the parent still carries them (checked live here against
// `entries`, not a static copy captured at set-parent time — if the parent's
// own group tag later changes, the child's lock follows it).
function parentGroupTags() {
  if (!workingPayload?.parentId) return new Set();
  const parentEntry = findEntry(workingPayload.parentId);
  const parentTags = parentEntry?.payload?.tags || [];
  return new Set(parentTags.filter((tag) => parseTag(tag).prefix === "group"));
}

function renderTags() {
  if (!tagsBadgesEl || !tagsInputEl || !workingPayload) return;
  const tags = workingPayload.tags || [];
  const lockedTags = parentGroupTags();
  tagsBadgesEl.innerHTML = "";
  tagsBadgesEl.appendChild(
    renderTagBadges(tags, null, {
      removable: true,
      isLocked: (value) => lockedTags.has(value),
      onRemove: (value) => {
        recordHistory("remove tag", () => {
          workingPayload.tags = tags.filter((tag) => tag !== value);
        });
        updateToolbarState();
        renderTags();
      },
    })
  );
  tagsInputEl.innerHTML = "";
  tagsInputEl.appendChild(
    buildTagInputRow(TAG_DATALIST_ID, {
      placeholder: "Add a tag…",
      onAdd: (value) => {
        if ((workingPayload.tags || []).includes(value)) return;
        recordHistory("add tag", () => {
          workingPayload.tags = [...(workingPayload.tags || []), value];
        });
        updateToolbarState();
        renderTags();
      },
    })
  );
  setTagsCollapsed(tags.length === 0);
}

// Clicking an entry jumps to that heading wherever it's currently showing —
// the body textarea in Edit mode, the rendered preview in View mode —
// rather than forcing a mode switch first.
function renderOutline() {
  if (!outlineListEl || !workingPayload) return;
  outlineListEl.innerHTML = "";
  const outline = extractOutline(workingPayload.body);
  if (!outline.length) {
    outlineListEl.appendChild(el("p", "text-body-secondary small mb-0", "No headings yet."));
    return;
  }
  outline.forEach((heading, index) => {
    const item = el("button", "repository-outline-item", heading.text || "Untitled heading");
    item.type = "button";
    item.style.paddingLeft = `${heading.depth}rem`;
    item.addEventListener("click", () => jumpToHeading(heading, index));
    outlineListEl.appendChild(item);
  });
}

// A `<textarea>` wraps long lines to fit its width — a single \n-separated
// "line" in the raw text can span several visual rows. Estimating scroll
// position from raw line count × line-height (the previous approach here)
// silently assumes 1 line = 1 row, which is only true for short lines —
// real prose wraps, and the error compounds with every wrapped paragraph
// before the target heading. This mirrors the textarea's own text into an
// offscreen, identically-styled/identically-wide div and measures its
// actual rendered height instead of guessing.
const TEXTAREA_MIRROR_STYLE_PROPS = [
  "boxSizing",
  "width",
  "paddingTop",
  "paddingRight",
  "paddingBottom",
  "paddingLeft",
  "borderTopWidth",
  "borderRightWidth",
  "borderBottomWidth",
  "borderLeftWidth",
  "fontFamily",
  "fontSize",
  "fontWeight",
  "fontStyle",
  "letterSpacing",
  "lineHeight",
  "tabSize",
];

// Created once, immediately, rather than lazily on first use — a div
// created and measured in the very same synchronous call it's first
// inserted into the document was the actual cause of "the first jump lands
// at the bottom, every jump after that is correct": its first-ever
// getBoundingClientRect() (right after appendChild, same tick) wasn't
// trustworthy yet, even though every *later* call against the same
// already-settled element measured correctly. Existing in the DOM well
// before anyone actually needs a real measurement sidesteps that
// "brand new this exact tick" state entirely, rather than trying to prove
// out exactly which part of a fresh insertion was unreliable.
const textareaMirror = document.createElement("div");
textareaMirror.style.position = "absolute";
textareaMirror.style.visibility = "hidden";
textareaMirror.style.top = "0";
textareaMirror.style.left = "-9999px";
textareaMirror.style.whiteSpace = "pre-wrap";
textareaMirror.style.wordWrap = "break-word";
textareaMirror.style.height = "auto";
document.body.appendChild(textareaMirror);

function measureTextareaContentHeight(textarea, text) {
  const computed = getComputedStyle(textarea);
  TEXTAREA_MIRROR_STYLE_PROPS.forEach((prop) => {
    textareaMirror.style[prop] = computed[prop];
  });
  // A trailing space so a heading that's the very last line still measures
  // a full line of height, not zero.
  textareaMirror.textContent = `${text} `;
  return textareaMirror.getBoundingClientRect().height;
}

function jumpToHeading(heading, index) {
  if (currentMode === "view") {
    previewEl?.querySelector(`#repo-heading-${index}`)?.scrollIntoView({ block: "start" });
    return;
  }
  if (!bodyTextarea) return;
  const lines = (workingPayload?.body || "").split("\n");
  const offset = lines.slice(0, heading.line).reduce((sum, line) => sum + line.length + 1, 0);
  // setSelectionRange alone doesn't reliably auto-scroll a textarea in
  // every browser — it moves the caret, but "scroll to reveal it" is a
  // separate, inconsistently-applied heuristic. Setting scrollTop directly
  // is deterministic instead of hoping focus-follows-scroll kicks in.
  const textBeforeHeading = lines.slice(0, heading.line).join("\n");
  const paddingBottom = parseFloat(getComputedStyle(bodyTextarea).paddingBottom) || 0;
  const measuredHeight = measureTextareaContentHeight(bodyTextarea, textBeforeHeading);
  // The mirror includes both paddings; the heading's own unscrolled
  // position is paddingTop + (wrapped height of the text before it), which
  // works out to measuredHeight - paddingBottom. Scrolling to exactly that
  // puts the heading's own line flush at the top of the visible box
  // (matching View mode's scrollIntoView({block:"start"})), with the same
  // normal top padding above it that line 1 gets at scrollTop 0 — not
  // flush against the border with no breathing room.
  const target = measuredHeight - paddingBottom;
  const maxScrollTop = Math.max(0, bodyTextarea.scrollHeight - bodyTextarea.clientHeight);
  const finalScrollTop = Math.min(Math.max(0, target), maxScrollTop);
  // scrollTop assigned LAST, after focus()/setSelectionRange() rather than
  // before — confirmed via logging that focus() on a textarea whose value
  // was just set programmatically (never actually typed/clicked into by the
  // user) scrolls to reveal a caret at the *end* of the content the first
  // time it's ever focused, overriding whatever scrollTop was set right
  // before it; setSelectionRange's own scroll-to-reveal doesn't reliably
  // override that either. Once the textarea has a real focus/selection
  // history, that default-to-end behavior doesn't recur — exactly why this
  // only ever showed up on the very first jump. Setting scrollTop last means
  // nothing runs after it that could re-scroll the box.
  bodyTextarea.focus();
  bodyTextarea.setSelectionRange(offset, offset + lines[heading.line].length);
  bodyTextarea.scrollTop = finalScrollTop;
}

function renderEditor() {
  const hasSelection = Boolean(selectedId) && Boolean(workingPayload);
  editorEmptyEl?.classList.toggle("d-none", hasSelection);
  editorEl?.classList.toggle("d-none", !hasSelection);
  if (!hasSelection) return;
  if (titleInput) titleInput.value = workingPayload.title || "";
  if (bodyTextarea) bodyTextarea.value = workingPayload.body || "";
  renderTags();
  renderParent();
  renderRelated();
  renderBacklinks();
  renderOutline();
}

// previewEl's own scrollTop for whichever page is currently selected, keyed
// by page id — captured just before switching away (captureScrollMemory)
// and restored on a later "remember"-mode return to that same page (list
// clicks, the browser back/forward buttons), so leaving and coming back
// feels like nothing moved. A link-driven navigation (handleWikiLinkNavigate)
// deliberately opts out of restoring this — see selectPage's own comment.
const scrollMemory = new Map();

function captureScrollMemory() {
  if (selectedId && currentMode === "view" && previewEl) {
    scrollMemory.set(selectedId, previewEl.scrollTop);
  }
}

function findHeadingByText(body, headingText) {
  const target = (headingText || "").trim().toLowerCase();
  if (!target) return -1;
  const outline = extractOutline(body);
  return outline.findIndex((heading) => (heading.text || "").trim().toLowerCase() === target);
}

// history.pushState/replaceState both go through here — `?page=<id>` (or no
// param at all once nothing's selected) is the whole of Repository's
// navigable state, mirroring the same "URL identifies the current record"
// convention Dashboard's own `?encounter=<id>` already uses.
function pageUrl(id) {
  const url = new URL(window.location.href);
  if (id) url.searchParams.set("page", id);
  else url.searchParams.delete("page");
  return url;
}

function pushPageHistory(id) {
  history.pushState({ repositoryPageId: id || "" }, "", pageUrl(id));
}

function replacePageHistory(id) {
  history.replaceState({ repositoryPageId: id || "" }, "", pageUrl(id));
}

function clearSelection() {
  captureScrollMemory();
  draftEntry = null;
  selectedId = "";
  workingPayload = null;
  cleanSnapshot = null;
  renderPageTree();
  renderEditor();
  updateToolbarState();
}

// Switching away from whatever's currently selected discards any unsaved
// draft outright — same as this suite's existing tools (Orrery's own map
// switcher has no "unsaved changes" guard either); Save's dirty-gating is
// what tells you something needs saving, not a navigation block.
//
// `heading`/`remember` control where the newly-shown page lands scrolled to:
// a `heading` (from a [[Page#Heading]] link) always wins when it actually
// matches one of the page's own headings; otherwise `remember: true`
// (the default — list clicks, backlinks, the Parent link, and the browser
// back/forward buttons) restores wherever this same page was last left
// scrolled to (scrollMemory), falling back to the top for a page that's
// never been visited this session; `remember: false` (plain [[Page]] link
// clicks) always lands at the top instead, regardless of any remembered
// position — arriving via a link is a fresh "read from the start," not a
// "continue where I left off."
//
// `pushHistory: false` is only ever passed by the popstate handler itself —
// every other caller is a genuine new navigation step the browser's own
// back/forward buttons should be able to retrace.
function selectPage(id, { heading = "", remember = true, pushHistory = true } = {}) {
  const entry = findEntry(id);
  if (!entry) return;
  captureScrollMemory();
  draftEntry = null;
  selectedId = id;
  workingPayload = {
    ...entry.payload,
    tags: cloneTags(entry.payload?.tags),
  };
  cleanSnapshot = JSON.stringify(workingPayload);
  renderPageTree();
  renderEditor();
  // Defaults to View for a page that already exists — there's presumably
  // already-written content worth reading, not a blank page waiting to be
  // typed into. Renders the preview synchronously, so repo-heading-<index>
  // ids already exist by the time the scroll-outcome logic below runs.
  applyMode("view");
  updateToolbarState();
  if (pushHistory) pushPageHistory(id);
  const headingIndex = findHeadingByText(workingPayload.body, heading);
  if (headingIndex >= 0) {
    previewEl?.querySelector(`#repo-heading-${headingIndex}`)?.scrollIntoView({ block: "start" });
  } else if (remember && scrollMemory.has(id)) {
    if (previewEl) previewEl.scrollTop = scrollMemory.get(id);
  } else if (previewEl) {
    previewEl.scrollTop = 0;
  }
}

function createDraftEntry({ title = "", body = "", tags = [], parentId = "" } = {}) {
  captureScrollMemory();
  const id = generateId();
  draftEntry = {
    id,
    payload: { title: title || "Untitled page", body, tags: cloneTags(tags), parentId },
  };
  selectedId = id;
  workingPayload = { ...draftEntry.payload, tags: cloneTags(draftEntry.payload.tags) };
  // Never equal to any real JSON.stringify(workingPayload) — a draft is
  // dirty from the moment it exists, since nothing has been saved yet.
  cleanSnapshot = null;
  renderPageTree();
  renderEditor();
  // Defaults to Edit for a brand new page — nothing written yet to preview.
  applyMode("edit");
  updateToolbarState();
  titleInput?.focus();
  titleInput?.select();
}

async function handleSave() {
  if (!selectedId || !workingPayload || saveButton?.disabled) return;
  try {
    await dataManager.save(KIND, selectedId, workingPayload);
  } catch (error) {
    status?.show(error?.message || "Unable to save this page.", { type: "error" });
    return;
  }
  draftEntry = null;
  cleanSnapshot = JSON.stringify(workingPayload);
  await refreshEntries();
  updateToolbarState();
  status?.show("Saved.", { type: "success", timeout: 1500 });
}

async function handleDelete() {
  if (!selectedId || deleteButton?.disabled) return;
  const entry = findEntry(selectedId);
  if (!confirmDelete({ label: `"${titleOf(entry)}"` })) return;
  try {
    await dataManager.delete(KIND, selectedId);
  } catch (error) {
    status?.show(error?.message || "Unable to delete this page.", { type: "error" });
    return;
  }
  clearSelection();
  await refreshEntries();
  status?.show("Deleted.", { type: "success", timeout: 1500 });
}

function handleDuplicate() {
  if (!selectedId || !workingPayload || duplicateButton?.disabled) return;
  createDraftEntry({
    title: `${workingPayload.title || "Untitled page"} Copy`,
    body: workingPayload.body || "",
    tags: workingPayload.tags,
    parentId: workingPayload.parentId || "",
  });
}

searchInput?.addEventListener("input", () => renderPageTree());
undoButton?.addEventListener("click", () => undo());
redoButton?.addEventListener("click", () => redo());
// Same dirty check updateToolbarState already uses for the Save button —
// Repository had no guard at all against navigating/closing away from
// unsaved edits (unlike Workbench, which already had this).
window.addEventListener("beforeunload", (event) => {
  if (!isDirty()) return;
  event.preventDefault();
  event.returnValue = "";
});

newButton?.addEventListener("click", () => createDraftEntry());
duplicateButton?.addEventListener("click", () => handleDuplicate());
saveButton?.addEventListener("click", () => void handleSave());
deleteButton?.addEventListener("click", () => void handleDelete());
modeToggleButton?.addEventListener("click", () => toggleMode());

// Live (every keystroke) for dirty-gating feedback — Save should enable the
// instant you type, not just once you blur. The undo entry itself is
// coarser: one entry per burst of typing (debounced — see
// FIELD_COMMIT_DEBOUNCE_MS), not one per keystroke, roughly matching how a
// browser's own native textarea undo batches consecutive typing.
//
// That native undo is exactly what's NOT available here, though: the app
// shell's own Ctrl+Z handler (app-shell.js) is a single global `keydown`
// listener with no exception for focused text fields, so it always
// intercepts and calls preventDefault before the browser's native undo ever
// gets a chance to run — same behavior every other tool in this suite
// already has. That means whatever's sitting in the debounce window (typed
// but not yet committed to undoStack) has to be flushed synchronously the
// moment Ctrl+Z is pressed, or performUndo finds the stack still missing
// the very edit the user is trying to undo. Attaching a plain (bubbling,
// not capturing) keydown listener directly on the field does this — it
// runs before the same keydown reaches app-shell's document-level listener,
// since DOM dispatch visits the target's own listeners first.
const FIELD_COMMIT_DEBOUNCE_MS = 600;
let fieldCommitTimer = 0;
let fieldCommitLabel = "";

function commitFieldEdit() {
  window.clearTimeout(fieldCommitTimer);
  fieldCommitTimer = 0;
  if (!workingPayload || fieldEditBaseline === null) return;
  const after = JSON.stringify(workingPayload);
  if (after !== fieldEditBaseline) undoStack.push({ label: fieldCommitLabel, before: fieldEditBaseline, after });
  fieldEditBaseline = null;
}

function scheduleFieldCommit(label) {
  if (fieldEditBaseline === null) fieldEditBaseline = JSON.stringify(workingPayload);
  fieldCommitLabel = label;
  window.clearTimeout(fieldCommitTimer);
  fieldCommitTimer = window.setTimeout(commitFieldEdit, FIELD_COMMIT_DEBOUNCE_MS);
}

function flushFieldCommitOnUndoRedo(event) {
  const key = (event.key || "").toLowerCase();
  if ((event.ctrlKey || event.metaKey) && key === "z") commitFieldEdit();
}

titleInput?.addEventListener("keydown", flushFieldCommitOnUndoRedo);
titleInput?.addEventListener("input", () => {
  if (!workingPayload) return;
  // Baseline has to be captured (inside scheduleFieldCommit) before this
  // mutation, since it's the "before" half of the undo entry.
  scheduleFieldCommit("page title");
  workingPayload.title = titleInput.value;
  updateToolbarState();
});
titleInput?.addEventListener("change", () => commitFieldEdit());

bodyTextarea?.addEventListener("keydown", flushFieldCommitOnUndoRedo);
bodyTextarea?.addEventListener("input", () => {
  if (!workingPayload) return;
  scheduleFieldCommit("page body");
  workingPayload.body = bodyTextarea.value;
  updateToolbarState();
  renderOutline();
  scheduleRelatedRender();
});
bodyTextarea?.addEventListener("change", () => commitFieldEdit());

// `[[` autocomplete — lists page titles, `page#Heading` sections, and
// `page#^blockId` named tables (journal-tables.js), all insertable
// directly. `entries` is read fresh on every keystroke (a callback, not a
// snapshot) since it's reassigned once the page's own async load resolves.
attachWikiLinkAutocomplete(bodyTextarea, { getEntries: () => entries });
// `` `macro:`/`encounter:`/`dice:` `` autocomplete — same textarea, a
// second independent attachment (each only ever reacts to its own trigger
// syntax, so both listening on the same element causes no conflict).
attachCodeBlockAutocomplete(bodyTextarea, { dataManager });

// The browser's own back/forward buttons — without this, they fall through
// to app-shell's page-level history (landing on whichever tool page was
// open before Repository) instead of stepping back through pages viewed
// inside Repository itself. `event.state.repositoryPageId` (set by
// pushPageHistory/replacePageHistory) is preferred when present; falling
// back to parsing the URL's own `?page=` covers the browser-default `null`
// state a plain page load's own initial history entry always has.
window.addEventListener("popstate", (event) => {
  const id =
    typeof event.state?.repositoryPageId === "string"
      ? event.state.repositoryPageId
      : new URLSearchParams(window.location.search).get("page") || "";
  if (id && findEntry(id)) {
    selectPage(id, { remember: true, pushHistory: false });
  } else {
    clearSelection();
  }
});

updateToolbarState();
refreshTooltips();
void initHelpSystem({ root: document });
// Fetched once, up front — validKindIds/kindLabelsMap need to be populated
// before the FIRST renderPreview/renderRelated call can turn a
// `` `kindId:Name` `` block into a chip. If a page's already selected and
// rendered by the time this resolves (unlikely — loadLibraryKinds is a
// single small fetch — but not impossible on a slow connection), refresh
// it once so those chips don't wait for the next keystroke to appear.
void ensureLibraryKinds().then(() => {
  if (currentMode === "view") renderPreview();
  void renderRelated();
});
void refreshEntries().then(() => {
  // A bookmarked/reloaded `?page=<id>` deep-links straight to that page —
  // resolved AFTER entries load, since findEntry needs the fetched list.
  // replacePageHistory (not push) either way, establishing a clean baseline
  // state object for this initial load rather than relying purely on the
  // popstate handler's own URL-parsing fallback above.
  const requestedId = new URLSearchParams(window.location.search).get("page") || "";
  const resolvedId = requestedId && findEntry(requestedId) ? requestedId : "";
  if (resolvedId) selectPage(resolvedId, { remember: true, pushHistory: false });
  replacePageHistory(resolvedId);
});
