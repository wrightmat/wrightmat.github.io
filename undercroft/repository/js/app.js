import { initAppShell, resolveToolContextPath } from "../../common/js/lib/app-shell.js";
import { buildKindToolUrl } from "../../common/js/lib/kind-tool-route.js";
import { initAuthControls } from "../../common/js/lib/auth-ui.js";
import { initHelpSystem } from "../../common/js/lib/help.js";
import { disposeTooltips, refreshTooltips } from "../../common/js/lib/tooltips.js";
import { DataManager } from "../../common/js/lib/data-manager.js";
import { resolveApiBase } from "../../common/js/lib/api.js";
import { fetchKindEntriesWithIds, loadLibraryKinds } from "../../common/js/lib/content-fetch.js";
import { openContentPicker } from "../../common/js/lib/widgets/content-picker.js";
import { allowsDelete, refreshOwnershipCatalog, confirmDelete } from "../../common/js/lib/ownership.js";
import { renderTagBadges, renderTagDatalist, buildTagInputRow } from "../../common/js/lib/widgets/tag-editor.js";
import { renderMarkdown, refreshQuestBadge } from "./lib/markdown.js";
import { buildTitleIndex, findBacklinks } from "./lib/journal-links.js";
import { extractQuests, buildQuestIndex } from "./lib/journal-quests.js";
import { resolveGroupContext } from "../../common/js/lib/widgets/group-context.js";
import { buildGroupTree, getDisplayPills, parseTag } from "./lib/journal-tags.js";
import { extractOutline, findHeadingByText } from "./lib/journal-outline.js";
import { toggleTaskLine, taskLineText, updateCheckboxLineText } from "./lib/journal-tasks.js";
import { startEncounter, deterministicEncounterId } from "./lib/journal-encounter.js";
import { extractContentReferences } from "./lib/journal-kind-reference.js";
import { findKindReferenceRecord, EXCLUDED_KINDS, iconFor } from "../../common/js/lib/library-reference.js";
import { wikiLinkPattern } from "./lib/wiki-link-syntax.js";
import { createForceGraph } from "../../common/js/lib/graph-view.js";
import { buildRelationshipsGraph } from "./lib/relationships-graph.js";
import { extractStoryBoards, updateStoryBoardInPage, serializeStoryBoard } from "./lib/journal-story-board.js";
import { buildTimeline, groupTimelineByDay } from "./lib/journal-timeline.js";
import { describeDate } from "../../common/js/lib/widgets/calendar.js";
import { mountStoryBoard } from "./lib/story-board-canvas.js";
import { attachWikiLinkAutocomplete } from "./lib/wiki-link-autocomplete.js";
import { attachCodeBlockAutocomplete } from "./lib/code-block-autocomplete.js";
import {
  createToolbarButtonGroup,
  createCollapsibleSection,
  createEmptyStateCard,
  createIconButton,
  createModeToggleGroup,
  createCycleToggleButton,
} from "../../common/js/lib/ui-components.js";
import { initToolSettings } from "../../common/js/lib/tool-settings.js";
import { el, attachHoverDropdown } from "../../common/js/lib/dom.js";

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
// Uses the shared "undercroft" local-storage prefix (DataManager's default) —
// Repository's own bucket names already disambiguate its content, so a
// second tool-specific prefix layer would be redundant fragmentation.
const dataManager = new DataManager({ baseUrl: resolveApiBase() });
initAuthControls({ root: document, status, dataManager });

// "inline" variant sits flush in the header row beside the Mode/View toggle,
// same treatment as the other generator tools' "Nothing selected yet" messages.
{
  const emptyCard = createEmptyStateCard({
    message: "Select a page from the list, or create a new one.",
    variant: "inline",
  });
  emptyCard.setAttribute("data-repository-editor-empty", "");
  document.querySelector("[data-editor-empty-mount]")?.replaceWith(emptyCard);
}

const searchInput = document.querySelector("[data-repository-search]");
const pageTreeEl = document.querySelector("[data-repository-page-tree]");
const editorEmptyEl = document.querySelector("[data-repository-editor-empty]");
const editorEl = document.querySelector("[data-repository-editor]");
const titleInput = document.querySelector("[data-repository-title]");
const bodyTextarea = document.querySelector("[data-repository-body]");
const formatToolbarEl = document.querySelector("[data-repository-format-toolbar]");
const previewEl = document.querySelector("[data-repository-preview]");
const tagsBadgesEl = document.querySelector("[data-repository-tags-badges]");
const tagsInputEl = document.querySelector("[data-repository-tags-input]");
const parentContentEl = document.querySelector("[data-repository-parent-content]");
const relatedListEl = document.querySelector("[data-repository-related-list]");
const backlinksListEl = document.querySelector("[data-repository-backlinks-list]");
const outlineListEl = document.querySelector("[data-repository-outline-list]");
const settingsSlotEl = document.querySelector("[data-repository-settings-slot]");

// Page/Relationships/Timeline — three top-level views sharing the main pane,
// switched by the Mode toggle group (applyActiveTab/renderModeToggle), distinct
// from the page toolbar's own View/Edit toggle (renderPageViewToggle).
const relationshipsEl = document.querySelector("[data-repository-relationships]");
const graphContainerEl = document.querySelector("[data-repository-graph-container]");
const graphContentEl = document.querySelector("[data-repository-graph-content]");
const graphSvgEl = document.querySelector("[data-repository-graph-svg]");
const graphControlsEl = document.querySelector("[data-repository-graph-controls]");
const graphToolbarMountEl = document.querySelector("[data-repository-graph-toolbar-mount]");
const graphEmptyEl = document.querySelector("[data-repository-graph-empty]");
const graphFilterEl = document.querySelector("[data-repository-graph-filter]");
const graphFilterMenuEl = document.querySelector("[data-repository-graph-filter-menu]");
const timelineEl = document.querySelector("[data-repository-timeline]");
const timelineListEl = document.querySelector("[data-repository-timeline-list]");
const timelineEmptyEl = document.querySelector("[data-repository-timeline-empty]");

// Checking a task box is always interactive; the one setting here is whether
// that also appends a "✅ YYYY-MM-DD" completion stamp (handleToggleTask below)
// — on by default, matching Obsidian's own Tasks plugin.
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
    {
      key: "searchPageContents",
      label: "Search page contents, not just titles/tags",
      helpTopic: "repository.searchScope",
      default: true,
    },
  ],
  mountButton: (button) => settingsSlotEl?.appendChild(button),
});

// Outline defaults open regardless of content (navigation, not content-dependent
// like Tags/Related/Backlinks below) — still user-collapsible, just no
// programmatic re-collapsing.
{
  const outlineSection = createCollapsibleSection({
    label: "Outline",
    collapsed: false,
    content: document.querySelector("[data-repository-outline-panel]"),
  });
  document.querySelector("[data-repository-outline-mount]")?.appendChild(outlineSection.section);
}
// Tags/Parent/Related/Backlinks start collapsed, opened programmatically the
// moment each actually has something to show (renderTags/renderParent/etc below).
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

// View/Edit lives in the center pane's own header row (data-repository-view-toggle-mount),
// not this toolbar.
document.querySelector("[data-page-toolbar-mount]")?.append(
  ...createToolbarButtonGroup([
    { action: "new", label: "New Page", attrs: { "data-action": "new-page" } },
    { action: "duplicate", variant: "outline-secondary", label: "Duplicate Page", disabled: true, attrs: { "data-action": "duplicate-page" } },
    { action: "save", label: "Save Page", disabled: true, attrs: { "data-action": "save-page" } },
    { action: "delete", label: "Delete Page", disabled: true, attrs: { "data-action": "delete-page" } },
  ])
);
// A visual break only, not functional — same convention every other tool's toolbar uses.
document.querySelector("[data-page-undo-toolbar-mount]")?.append(
  ...createToolbarButtonGroup([
    { action: "undo", label: "Undo", attrs: { "data-action": "undo-page" } },
    { action: "redo", label: "Redo", attrs: { "data-action": "redo-page" } },
  ])
);

const undoButton = document.querySelector('[data-action="undo-page"]');
const redoButton = document.querySelector('[data-action="redo-page"]');
const newButton = document.querySelector('[data-action="new-page"]');
const duplicateButton = document.querySelector('[data-action="duplicate-page"]');
const saveButton = document.querySelector('[data-action="save-page"]');
const deleteButton = document.querySelector('[data-action="delete-page"]');
// createModeToggleGroup/createCycleToggleButton rebuild their mount fresh on every
// call, so these are just the container elements, not individual button refs.
const viewToggleMountEl = document.querySelector("[data-repository-view-toggle-mount]");
const modeToggleMountEl = document.querySelector("[data-repository-mode-toggle-mount]");

// Re-fetched after every save/delete rather than patched in place — backlinks,
// the group tree, and wiki-link resolution all need other pages' current state.
let entries = [];
// Refreshed alongside `entries`; what Delete's tier-gating (allowsDelete) reads.
let ownershipCatalog = new Map();
let selectedId = "";
// Created (New/Duplicate) but not yet persisted — not part of `entries` until
// the first Save. Never deletable or ownership-gated.
let draftEntry = null;
// Mutated directly by the title/body/tags controls, compared against
// `cleanSnapshot` to drive Save's dirty-gating. Deliberately not auto-saved
// (explicit-Save convention, same as Press/Orrery).
let workingPayload = null;
let cleanSnapshot = null;
let currentMode = "edit";
// The "before" half of a pending title/body undo entry, captured at the start
// of a typing burst (scheduleFieldCommit/commitFieldEdit near the bottom).
let fieldEditBaseline = null;
// Enter-to-cycle search state (goToSearchMatch below): matching page-id order,
// current position, and the <mark> elements on whichever page is open.
let lastSearchQuery = null;
let searchMatchPageIds = [];
let searchMatchPageIndex = -1;
let searchMatchTrackedPageId = "";
let searchMatchMarks = [];
let searchMatchMarkIndex = -1;

function generateId() {
  return `journal_${Math.random().toString(36).slice(2, 10)}`;
}

function cloneTags(tags) {
  return [...(tags || [])];
}

// Every Library kind a `` `kindId:Name` `` reference can target, minus
// EXCLUDED_KINDS. Fetched once and cached; read synchronously by renderPreview,
// so chips just don't appear until this resolves rather than blocking the first render.
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

// The active campaign's Setting `.calendar`, read synchronously by renderPreview
// via `` `date:...` `` chips — same resolve-once grace period as validKindIds
// above. Re-resolved when the active campaign changes, not on every date advance.
let activeCalendar = null;
// The ambient campaign date, read synchronously via `` `date:current` ``/`` `date:today` ``
// chips (journal-date.js). Unlike activeCalendar, also refreshed live off the
// "undercroft:campaign-date-changed" event the Calendar widget broadcasts.
let activeCampaignDayIndex = null;
async function refreshActiveCalendar() {
  let groupContext = null;
  try {
    groupContext = await resolveGroupContext(dataManager, {});
  } catch (error) {
    groupContext = null;
  }
  activeCampaignDayIndex = Number.isFinite(groupContext?.campaignDayIndex) ? groupContext.campaignDayIndex : null;
  if (!groupContext?.settingId) {
    activeCalendar = null;
    return;
  }
  try {
    const result = await dataManager.get("setting", groupContext.settingId, { preferLocal: false });
    activeCalendar = result?.payload?.calendar || null;
  } catch (error) {
    activeCalendar = null;
  }
}

// Merges the remote list ({id, entity}) with local-only entries ({id, payload}),
// normalizing both into the {id, payload} shape this file expects — same merge
// pattern handout.js's openHandoutPicker uses.
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
  const parts = [titleOf(entry), (entry.payload?.tags || []).join(" ")];
  // Behind a setting (default on): title/tag-only search is meaningfully
  // narrower once a wiki has enough pages that a common word shows up everywhere.
  if (toolSettings.get("searchPageContents")) parts.push(entry.payload?.body || "");
  return parts.join(" ").toLowerCase().includes(query);
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

// `pageNode` is {entry, children} (buildGroupTree, journal-tags.js), children
// built from parentId relationships — recurses so a page's Parent-section
// children nest directly underneath it, at any depth.
function renderPageNode(pageNode, container, depth) {
  container.appendChild(buildPageRow(pageNode.entry, depth));
  pageNode.children
    .slice()
    .sort((a, b) => titleOf(a.entry).localeCompare(titleOf(b.entry)))
    .forEach((child) => renderPageNode(child, container, depth + 1));
}

// Persisted by the group's full "group:" tag path (buildGroupTree's node.path,
// e.g. "Adventures/Session 1") — stable across reloads regardless of sort order.
// localStorage, same per-browser convention collapsible.js's sections use.
const COLLAPSED_GROUPS_KEY = "undercroft.repository.collapsedGroups";
function loadCollapsedGroups() {
  try {
    const parsed = JSON.parse(localStorage.getItem(COLLAPSED_GROUPS_KEY) || "[]");
    return new Set(Array.isArray(parsed) ? parsed : []);
  } catch (error) {
    return new Set();
  }
}
const collapsedGroups = loadCollapsedGroups();
function saveCollapsedGroups() {
  try {
    localStorage.setItem(COLLAPSED_GROUPS_KEY, JSON.stringify(Array.from(collapsedGroups)));
  } catch (error) {
    // localStorage unavailable — collapse state just won't persist this session.
  }
}

// `forceExpanded` (true during an active search) ignores collapsed state
// without touching it — a collapsed folder shouldn't hide a matching search
// result, but the real persisted state still applies once search clears.
function renderGroupNode(node, container, depth, forceExpanded) {
  if (node.label) {
    const isCollapsed = !forceExpanded && collapsedGroups.has(node.path);
    const header = el("button", "repository-group-label");
    header.type = "button";
    header.style.paddingLeft = `${depth * 0.75}rem`;
    header.setAttribute("aria-expanded", isCollapsed ? "false" : "true");
    const chevron = el("span", "iconify");
    chevron.dataset.icon = isCollapsed ? "tabler:chevron-right" : "tabler:chevron-down";
    chevron.setAttribute("aria-hidden", "true");
    header.append(chevron, el("span", null, node.label));
    header.addEventListener("click", () => {
      if (collapsedGroups.has(node.path)) {
        collapsedGroups.delete(node.path);
      } else {
        collapsedGroups.add(node.path);
      }
      saveCollapsedGroups();
      renderPageTree();
    });
    container.appendChild(header);
    if (isCollapsed) return;
  }
  node.pages
    .slice()
    .sort((a, b) => titleOf(a.entry).localeCompare(titleOf(b.entry)))
    .forEach((pageNode) => renderPageNode(pageNode, container, depth));
  Array.from(node.children.values())
    .sort((a, b) => a.label.localeCompare(b.label))
    .forEach((child) => renderGroupNode(child, container, depth + 1, forceExpanded));
}

// Deliberately just `entries`, never draftEntry — an unsaved new/duplicated
// page shouldn't appear in a list that can't actually re-select it. The editor
// itself (title/body focused, Save lit up) is the "new page" indicator meanwhile.
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
  renderGroupNode(tree, pageTreeEl, 0, Boolean(query));
}

// Reuses pageTreeEl's already-filtered, already-sorted rows rather than
// re-deriving order, so Enter-cycling matches the order you'd see scrolling the list.
function matchingPageIdsInTreeOrder() {
  if (!pageTreeEl) return [];
  return Array.from(pageTreeEl.querySelectorAll("[data-repository-page-id]")).map((row) => row.dataset.repositoryPageId);
}

// Wraps every case-insensitive occurrence of `query` in `root` with a
// <mark data-repo-search-mark>, in document order — goToSearchMatch cycles the
// returned array. Only touches text nodes (safe over rendered wiki-links,
// checkboxes, chips, etc.); collects nodes up front, then mutates, so the walk
// isn't disturbed by its own wrapping. A match split across two text nodes
// (e.g. an inline **bold** boundary) isn't found — same blind spot any
// per-node text scan has.
function highlightTextMatches(root, query) {
  const marks = [];
  if (!root || !query) return marks;
  const lowerQuery = query.toLowerCase();
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: (node) => (node.nodeValue && node.nodeValue.trim() ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP),
  });
  const textNodes = [];
  let node;
  while ((node = walker.nextNode())) textNodes.push(node);
  textNodes.forEach((textNode) => {
    const text = textNode.nodeValue;
    const lowerText = text.toLowerCase();
    if (!lowerText.includes(lowerQuery)) return;
    const frag = document.createDocumentFragment();
    let cursor = 0;
    let matchStart = lowerText.indexOf(lowerQuery, cursor);
    while (matchStart !== -1) {
      if (matchStart > cursor) frag.appendChild(document.createTextNode(text.slice(cursor, matchStart)));
      const mark = document.createElement("mark");
      mark.dataset.repoSearchMark = "";
      mark.textContent = text.slice(matchStart, matchStart + query.length);
      frag.appendChild(mark);
      marks.push(mark);
      cursor = matchStart + query.length;
      matchStart = lowerText.indexOf(lowerQuery, cursor);
    }
    if (cursor < text.length) frag.appendChild(document.createTextNode(text.slice(cursor)));
    textNode.parentNode?.replaceChild(frag, textNode);
  });
  return marks;
}

function clearSearchHighlights() {
  if (!previewEl) return;
  previewEl.querySelectorAll("mark[data-repo-search-mark]").forEach((mark) => {
    mark.replaceWith(document.createTextNode(mark.textContent));
  });
  previewEl.normalize();
}

// Typing anything invalidates the whole cycle rather than remapping an old
// position onto a new result set — next Enter starts fresh, same as a
// browser's own Find when you edit the term mid-search.
function resetSearchCycle() {
  clearSearchHighlights();
  lastSearchQuery = null;
  searchMatchPageIds = [];
  searchMatchPageIndex = -1;
  searchMatchTrackedPageId = "";
  searchMatchMarks = [];
  searchMatchMarkIndex = -1;
}

function setActiveSearchMark(index) {
  searchMatchMarks.forEach((mark, i) => mark.classList.toggle("repository-search-mark-active", i === index));
  searchMatchMarks[index]?.scrollIntoView({ block: "center", behavior: "smooth" });
}

// Enter (direction 1) / Shift+Enter (direction -1) — cycles every occurrence
// on the current page before moving to the next matching page (wrapping both
// ends), same two-level order a browser's own Ctrl+F gives across one long document.
function goToSearchMatch(direction) {
  const query = (searchInput?.value || "").trim();
  if (!query) return;
  const normalized = query.toLowerCase();
  const queryChanged = normalized !== lastSearchQuery;
  lastSearchQuery = normalized;
  if (queryChanged) {
    searchMatchPageIds = matchingPageIdsInTreeOrder();
    searchMatchPageIndex = -1;
    searchMatchTrackedPageId = "";
    searchMatchMarks = [];
    searchMatchMarkIndex = -1;
  }
  if (!searchMatchPageIds.length) {
    status?.show("No pages match.", { type: "warning", timeout: 2000 });
    return;
  }
  // Checked against selectedId, not just "marks left over" — the user could
  // have clicked to a different page by hand between Enter presses.
  if (!queryChanged && selectedId === searchMatchTrackedPageId && searchMatchMarks.length) {
    const nextMarkIndex = searchMatchMarkIndex + direction;
    if (nextMarkIndex >= 0 && nextMarkIndex < searchMatchMarks.length) {
      searchMatchMarkIndex = nextMarkIndex;
      setActiveSearchMark(searchMatchMarkIndex);
      searchInput?.focus();
      return;
    }
  }
  // -1 = "haven't landed on a page yet" — a first Shift+Enter jumps straight to
  // the LAST match rather than wrapping through -1 as "one before index 0".
  searchMatchPageIndex =
    searchMatchPageIndex === -1
      ? (direction >= 0 ? 0 : searchMatchPageIds.length - 1)
      : (searchMatchPageIndex + direction + searchMatchPageIds.length) % searchMatchPageIds.length;
  const pageId = searchMatchPageIds[searchMatchPageIndex];
  selectPage(pageId, { remember: false });
  searchMatchTrackedPageId = pageId;
  // A match landing only in title/tags leaves no marks here — expected, since
  // the title is already visible the moment the page opens.
  searchMatchMarks = highlightTextMatches(previewEl, query);
  searchMatchMarkIndex = direction >= 0 ? 0 : searchMatchMarks.length - 1;
  if (searchMatchMarks.length) setActiveSearchMark(searchMatchMarkIndex);
  searchInput?.focus();
}

// The suite-wide header search's deep link into a body match (suite-search.js's
// `?q=` extraParam) — same highlight+scroll goToSearchMatch gives, seeded from
// the URL instead of a keystroke. Target page is already resolved via `?page=<id>`.
// Still populates every searchMatch* variable so a following Enter continues
// the cycle naturally.
function jumpToSearchQuery(query) {
  if (!query || !searchInput || !selectedId) return;
  searchInput.value = query;
  resetSearchCycle();
  renderPageTree();
  lastSearchQuery = query.toLowerCase();
  searchMatchPageIds = matchingPageIdsInTreeOrder();
  searchMatchPageIndex = searchMatchPageIds.indexOf(selectedId);
  searchMatchTrackedPageId = selectedId;
  searchMatchMarks = highlightTextMatches(previewEl, query);
  if (!searchMatchMarks.length) return;
  searchMatchMarkIndex = 0;
  setActiveSearchMark(searchMatchMarkIndex);
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
    // Selected page got removed elsewhere — fall back to empty state rather
    // than show a stale editor for a page that no longer exists.
    clearSelection();
  }
}

// Same shape as Orrery's own recordHistory: snapshot before/after, push an undo
// entry only if something changed. One session-wide undo stack (not per-page),
// same as Orrery's single stack for its one map at a time.
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
  renderPageViewToggle();
}

// The suite-wide View control (ui-components.js's createCycleToggleButton) — one
// button, icon/tooltip always describing what clicking switches TO, same idiom
// Handout/Map/Combat Tracker's visibility button uses. Only rendered while
// activeTab === "page" — View/Edit isn't meaningful on Relationships/Timeline.
function renderPageViewToggle() {
  if (!viewToggleMountEl) return;
  if (activeTab !== "page") {
    disposeTooltips(viewToggleMountEl);
    viewToggleMountEl.innerHTML = "";
    return;
  }
  const button = createCycleToggleButton({
    container: viewToggleMountEl,
    states: [
      { value: "view", icon: "tabler:eye", label: "View" },
      { value: "edit", icon: "tabler:pencil", label: "Edit" },
    ],
    value: currentMode,
    onSelect: () => toggleMode(),
  });
  button.disabled = !selectedId;
}

function applyMode(mode) {
  currentMode = mode;
  const isView = mode === "view";
  bodyTextarea?.classList.toggle("d-none", isView);
  formatToolbarEl?.classList.toggle("d-none", isView);
  previewEl?.classList.toggle("d-none", !isView);
  previewEl?.classList.toggle("d-flex", isView);
  renderPageViewToggle();
  if (isView) renderPreview();
}

// Switching modes shouldn't dump you back at the top of a long page — finds
// which heading governs the current scroll position, switches modes, then
// scrolls the new view to that heading via jumpToHeading (same function the
// Outline panel uses). Falls back to matching scroll *fraction* when there's
// no heading to anchor to.
function findCurrentHeadingIndex(outline) {
  if (!outline.length) return -1;
  if (currentMode === "view") {
    if (!previewEl) return -1;
    const containerTop = previewEl.getBoundingClientRect().top;
    let bestIndex = -1;
    outline.forEach((heading, index) => {
      const headingEl = previewEl.querySelector(`#repo-heading-${index}`);
      if (!headingEl) return;
      // The last heading scrolled up to (or past) the top edge is "what you're
      // currently reading" — matches a sticky table-of-contents highlight.
      if (headingEl.getBoundingClientRect().top - containerTop <= 24) bestIndex = index;
    });
    return bestIndex;
  }
  if (!bodyTextarea) return -1;
  // Exact inverse of jumpToHeading's edit-mode branch (given scroll position,
  // find the heading; jumpToHeading goes heading -> scrollTop) — needs the same
  // mirror-measured pixel heights, not a line-count guess that ignores wrapping.
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

// Polls via rAF until `target` genuinely has layout (clientHeight > 0) before
// running `callback` — the first time bodyTextarea/previewEl are ever measured
// in a session needs this; a fixed frame-count guess isn't reliably enough.
// Gives up after ~10 frames (~160ms) and runs anyway.
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

// Page titles resolve first; a bare [[Quest Title]] falls back to the quest
// index only when no page has that title. A resolved quest match carries its
// own title as `heading` so the link lands on that quest's callout, not just
// the page top, without the author typing an explicit #Heading. Both indexes
// are built once per render, not per link — buildQuestIndex re-lexes every
// page's body, expensive enough to matter with several links on one page.
function resolveWikiLinkTarget(title, titleIndex, questIndex) {
  const pageMatch = titleIndex.resolve(title);
  if (pageMatch) return pageMatch;
  const questMatch = questIndex.resolve(title);
  if (!questMatch) return null;
  return { id: questMatch.pageId, title: questMatch.title, heading: questMatch.title };
}

function renderPreview() {
  if (!previewEl || !workingPayload) return;
  destroyMountedStoryBoards();
  // Disposed before the wipe, not left to be GC'd — chips inside rendered
  // content carry real tooltips and this reruns on every edit (tooltips.js BUG CLASS 2).
  disposeTooltips(previewEl);
  previewEl.innerHTML = "";
  const titleIndex = buildTitleIndex(entries);
  const questIndex = buildQuestIndex(entries);
  const node = renderMarkdown(workingPayload.body, {
    resolveWikiLink: (title) => resolveWikiLinkTarget(title, titleIndex, questIndex),
    onNavigate: (target) => handleWikiLinkNavigate(target),
    status,
    interactiveCheckboxes: true,
    onToggleTask: (lineIndex, checkboxEl) => handleToggleTask(lineIndex, checkboxEl),
    interactiveEncounters: true,
    onStartEncounter: (creatures, blockIndex) => void handleStartEncounter(creatures, blockIndex),
    interactiveDice: true,
    interactiveMacros: true,
    // This GM's own active campaign, not a per-page setting — same source
    // Combat Tracker's autoShowOnStart uses.
    groupContext: { groupId: dataManager.getActiveGroup()?.groupId || "" },
    dataManager,
    // Empty until ensureLibraryKinds resolves — renderMarkdown stays synchronous,
    // so a `` `kindId:Name` `` chip just doesn't appear on the very first render.
    validKindIds,
    kindLabels: kindLabelsMap,
    onOpenReference: (kindId, name) => void handleOpenReference(kindId, name),
    // Empty until refreshActiveCalendar resolves — a `` `date:...` `` chip
    // reads as a plain "Day <N>" until then.
    activeCalendar,
    currentDayIndex: activeCampaignDayIndex,
  });
  previewEl.appendChild(node);
  // Positional pairing with the Outline panel (extractOutline scans the same
  // raw text top-to-bottom) — an id per heading, in order, is what
  // jumpToHeading scrolls to in View mode.
  previewEl.querySelectorAll("h1, h2, h3, h4, h5, h6").forEach((heading, index) => {
    heading.id = `repo-heading-${index}`;
  });
  // Same pairing convention, so a quest title resolves as a second anchor class
  // (findQuestByTitle/selectPage). extractQuests only finds TOP-LEVEL [!quest]
  // callouts — a nested quest callout would misalign the pairing, but quests
  // aren't expected to be authored that way.
  previewEl.querySelectorAll('[data-callout="quest"]').forEach((questEl, index) => {
    questEl.id = `repo-quest-${index}`;
  });
  mountStoryBoardsInPreview();
  refreshTooltips(previewEl);
}

// Upgrades every `[data-callout="story-board"]` element into a live interactive
// canvas — deliberately not part of markdown.js's renderMarkdown pipeline, so a
// story board is only interactive here in Repository's editor; anywhere else
// (Handout, Sanctum's Notes) it stays a plain read-only callout, matching the
// "GM planning tool, not player-facing" scope.
let mountedStoryBoards = [];

function destroyMountedStoryBoards() {
  mountedStoryBoards.forEach((instance) => instance.destroy());
  mountedStoryBoards = [];
}

// A Ref cell only needs an ICON (depends solely on kind, not the specific
// record) — no fetch needed, stays synchronous. Same iconFor lookup an inline
// `` `kindId:Name` `` chip uses.
function resolveStoryBoardRefIcon(ref) {
  const raw = String(ref || "").trim();
  if (!raw) return null;
  const colonIndex = raw.indexOf(":");
  if (colonIndex === -1) return null;
  const kind = raw.slice(0, colonIndex).trim().toLowerCase();
  if (kind === "quest") return { icon: "tabler:map-2" };
  return { icon: iconFor(kind) };
}

function mountStoryBoardsInPreview() {
  if (!previewEl || !workingPayload) return;
  const boards = extractStoryBoards(workingPayload.body || "");
  // Matched by document-order position, not by comparing rendered title text
  // — a title with inline markdown (e.g. "The *Real* Culprit") renders with
  // that markup stripped, breaking a text-based match. Both walk the same
  // document in the same order, so index correspondence is exact.
  previewEl.querySelectorAll('[data-callout="story-board"]').forEach((calloutEl, index) => {
    const board = boards[index];
    const contentEl = calloutEl.querySelector(":scope > .callout-content");
    if (!board || !contentEl) return;
    contentEl.innerHTML = "";
    const mountPoint = document.createElement("div");
    contentEl.appendChild(mountPoint);
    // markdown.js's applyCalloutStyling reserves this generic slot in every
    // callout's title bar; this is the one place that mounts a Corkboard/Swimlane
    // toggle into it. Plain querySelector is safe — the slot exists once, in
    // the title bar, never inside `.callout-content`.
    const modeSlot = calloutEl.querySelector(".callout-mode-slot");
    // Updates workingPayload/dirty state like any other edit — Repository has
    // no autosave anywhere. `instance` is assigned after mountStoryBoard returns,
    // but onMutate only fires later from a real user action, so the closure
    // always sees the assigned value.
    let instance;
    instance = mountStoryBoard(mountPoint, {
      model: board.model,
      modeSlot,
      resolveRef: resolveStoryBoardRefIcon,
      status,
      onMutate: (mutateFn) => {
        const nextBody = updateStoryBoardInPage(workingPayload.body, board.title, mutateFn);
        if (nextBody === workingPayload.body) return;
        workingPayload.body = nextBody;
        if (bodyTextarea) bodyTextarea.value = nextBody;
        updateToolbarState();
        // Re-syncs just this board's instance with the re-parsed model, rather
        // than a full renderPreview() which would tear down every board mid-interaction.
        const refreshed = extractStoryBoards(nextBody).find(
          (entry) => entry.title.trim().toLowerCase() === board.title.trim().toLowerCase()
        );
        if (refreshed) instance.update(refreshed.model);
      },
    });
    mountedStoryBoards.push(instance);
  });
}

function handleWikiLinkNavigate(target) {
  if (target.missing) {
    createDraftEntry({ title: target.title });
    return;
  }
  // Arriving via a link never restores a remembered scroll position — a
  // [[Page#Heading]] link jumps to that heading; a plain [[Page]] link lands at the top.
  selectPage(target.id, { heading: target.heading || "", remember: false });
}

// A real content edit (unlike the dice-roller's ephemeral re-rolls) — goes
// through recordHistory, and updates the checkbox's <li> text directly rather
// than re-rendering the whole preview, so scroll position isn't disturbed.
function handleToggleTask(lineIndex, checkboxEl) {
  if (!workingPayload) return;
  const appendStamp = Boolean(toolSettings.get("appendCompletionStamp"));
  recordHistory("toggle task", () => {
    workingPayload.body = toggleTaskLine(workingPayload.body, lineIndex, { appendStamp });
  });
  if (checkboxEl) {
    updateCheckboxLineText(checkboxEl, taskLineText(workingPayload.body, lineIndex));
    // A toggled objective inside a [!quest] callout changes that quest's derived
    // status — refreshed directly rather than left stale until the next full render.
    refreshQuestBadge(checkboxEl.closest('[data-callout="quest"]'));
  }
  updateToolbarState();
}

// Clicking an `encounter:` chip — builds and starts a real Combat Tracker
// encounter from the parsed creature list (journal-encounter.js owns the whole
// flow: match, resolve stats, save, spotlight, reload Dashboard). groupId is
// this GM's own active campaign, same source Combat Tracker's autoShowOnStart uses.
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

// True if `forId` is already in `candidateParentId`'s ancestor chain (which
// would make candidateParentId a descendant of forId). Walks `entries`
// (last-saved payloads), not workingPayload — a candidate parent must already
// exist as a real page (openContentPicker only offers saved entries).
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

// A more pronounced relationship than Related/backlink — one page has exactly
// one parent, which nests it in the left-pane list (buildGroupTree,
// journal-tags.js). Its own section since it's a structured single-value field
// (`workingPayload.parentId`), not a body-extracted reference.
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
// self-contained rather than opening a whole other tool. Every kind now
// navigates straight to its own owning tool with that record selected —
// `{tool, param}`, a `?<param>=<id>` deep link the target tool's own
// bootstrap reads (same pattern `map`'s own `?map=<id>` originally
// established for Orrery, generalized to every other kind here). Kinds
// authored through Loom's generic Library editor (no dedicated tool of
// their own) all share Loom's own `?library=<kindId>:<id>` param instead of
// one param per kind — see loom/js/app.js's own bootstrap for why one
// generic param covers all of them. `character`/`template` reuse
// Workbench's existing generic `?record=<bucket>:<id>` param rather than a
// second one — no new bootstrap needed on that end at all.
async function handleOpenReference(kindId, id) {
  const record = await findKindReferenceRecord(dataManager, kindId, id);
  if (!record) {
    status?.show(`Couldn't find that ${kindLabelsMap[kindId] || kindId}.`, { type: "error", timeout: 3000 });
    return;
  }
  const url = buildKindToolUrl(kindId, record.id);
  if (url) {
    window.location.href = url;
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

// A vault migrated into Undercroft (Obsidian requires every referenceable thing
// to be its own page) often has [[Wiki Links]] pointing at what are now real
// Library records instead of pages. Scans the current page for a wikilink whose
// title matches no real page/quest but does match a Library record, and
// rewrites it to `` `kindId:Name` `` chip syntax. One reviewed, single-undo-step
// edit (recordHistory), not silent/automatic — scoped to the current page only.
async function handleConvertWikiLinksToReferences() {
  if (!workingPayload) return;
  await ensureLibraryKinds();
  const body = workingPayload.body || "";
  const titleIndex = buildTitleIndex(entries);
  const questIndex = buildQuestIndex(entries);

  // Same code-span protection markdown.js's rewriteWikiLinks applies at render
  // time — a literal `` `[[Example]]` `` shouldn't rewrite. Splitting on a
  // capturing group keeps code spans at odd indices, skipped below.
  const codeSpanPattern = /(`[^`\n]*`)/g;
  const segments = body.split(codeSpanPattern);

  const kindIds = Array.from(validKindIds).filter((id) => !EXCLUDED_KINDS.has(id));
  const kindEntriesCache = new Map();
  const loadKindEntries = (kindId) => {
    if (!kindEntriesCache.has(kindId)) {
      kindEntriesCache.set(kindId, fetchKindEntriesWithIds(dataManager, kindId).catch(() => []));
    }
    return kindEntriesCache.get(kindId);
  };

  const replacements = new Map(); // raw "[[...]]" text -> replacement text
  for (let i = 0; i < segments.length; i += 2) {
    const segment = segments[i];
    const pattern = wikiLinkPattern();
    let match;
    while ((match = pattern.exec(segment))) {
      const raw = match[0];
      if (replacements.has(raw)) continue;
      const title = (match[1] || "").trim();
      if (!title) continue;
      if (titleIndex.resolve(title) || questIndex.resolve(title)) continue; // real page/quest link — leave alone
      const normalized = title.toLowerCase();
      for (const kindId of kindIds) {
        const list = await loadKindEntries(kindId);
        const found = list.find(({ id, entity }) => {
          if (String(id).toLowerCase() === normalized) return true;
          const name = String(entity?.name || entity?.title || "").trim().toLowerCase();
          return name === normalized;
        });
        if (found) {
          const displayName = found.entity?.name || found.entity?.title || title;
          replacements.set(raw, `\`${kindId}:${displayName}\``);
          break;
        }
      }
    }
  }

  if (!replacements.size) {
    status?.show("No wiki-links matching a saved Library record were found on this page.", { type: "info", timeout: 3500 });
    return;
  }

  recordHistory("convert wiki-links to references", () => {
    let nextBody = workingPayload.body;
    replacements.forEach((replacement, raw) => {
      nextBody = nextBody.split(raw).join(replacement);
    });
    workingPayload.body = nextBody;
  });
  if (bodyTextarea) bodyTextarea.value = workingPayload.body;
  updateToolbarState();
  if (currentMode === "view") renderPreview();
  status?.show(
    `Converted ${replacements.size} wiki-link${replacements.size === 1 ? "" : "s"} to reference${replacements.size === 1 ? "" : "s"}.`,
    { type: "success", timeout: 3000 }
  );
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

// The parent's group: tag(s) — a child inherits these (handleSetParent) and
// stays locked in Tags for as long as the parent carries them, checked live
// against `entries` so a later parent-tag change follows through.
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
  disposeTooltips(tagsBadgesEl);
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
  refreshTooltips(tagsBadgesEl);
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

// Jumps to that heading wherever it's currently showing (textarea in Edit
// mode, preview in View mode) rather than forcing a mode switch first.
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

// A `<textarea>` wraps long lines, so one \n-separated "line" can span several
// visual rows — line count × line-height only works for short lines. This
// mirrors the textarea's text into an offscreen, identically-styled div and
// measures its actual rendered height instead of guessing.
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

// Created once, immediately, rather than lazily on first use — a div measured
// in the same synchronous call it's inserted has an unreliable first
// getBoundingClientRect(), even though later calls against the same settled
// element measure correctly. Existing in the DOM well before use sidesteps that.
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
  // Trailing space so a heading on the very last line still measures a full line, not zero.
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
  // setSelectionRange alone doesn't reliably auto-scroll a textarea in every
  // browser; setting scrollTop directly is deterministic.
  const textBeforeHeading = lines.slice(0, heading.line).join("\n");
  const paddingBottom = parseFloat(getComputedStyle(bodyTextarea).paddingBottom) || 0;
  const measuredHeight = measureTextareaContentHeight(bodyTextarea, textBeforeHeading);
  // The mirror includes both paddings; the heading's unscrolled position works
  // out to measuredHeight - paddingBottom, flush at the top (matching View
  // mode's scrollIntoView({block:"start"})).
  const target = measuredHeight - paddingBottom;
  const maxScrollTop = Math.max(0, bodyTextarea.scrollHeight - bodyTextarea.clientHeight);
  const finalScrollTop = Math.min(Math.max(0, target), maxScrollTop);
  // scrollTop assigned LAST — focus() on a textarea whose value was just set
  // programmatically scrolls to reveal the caret at the *end* the first time
  // it's ever focused, overriding an earlier scrollTop. Only happens before the
  // textarea has a real focus/selection history.
  bodyTextarea.focus();
  bodyTextarea.setSelectionRange(offset, offset + lines[heading.line].length);
  bodyTextarea.scrollTop = finalScrollTop;
}

// "page", "relationships" (workspace-wide read-only graph), or "timeline"
// (workspace-wide day-sorted list) — mutually exclusive, switched by the Mode
// toggle group (renderModeToggle). applyActiveTab decides all three panels'
// visibility together, called from renderEditor and setActiveTab.
let activeTab = "page";

// The suite-wide Mode control — a real button group, all three options always
// visible, deliberately a different shape from renderPageViewToggle's own
// single cycling button.
function renderModeToggle() {
  if (!modeToggleMountEl) return;
  // Relationships stays enabled with nothing loaded — with no page it graphs
  // everything, with one loaded it scopes to that page's connections
  // (scopedRelationshipsData). Timeline has nothing to anchor to without a
  // page, so it keeps the disabled-until-loaded gate.
  const hasPage = Boolean(selectedId) && Boolean(workingPayload);
  createModeToggleGroup({
    container: modeToggleMountEl,
    ariaLabel: "Repository view",
    options: [
      { value: "page", icon: "tabler:notebook", label: "Page" },
      { value: "relationships", icon: "tabler:affiliate", label: "Relationships" },
      {
        value: "timeline",
        icon: "tabler:calendar-event",
        label: "Timeline",
        disabled: !hasPage,
        tooltip: hasPage ? undefined : "Select a page first",
      },
    ],
    value: activeTab,
    onChange: (next) => void setActiveTab(next),
  });
}

// Forces back to "page" only when Timeline becomes disabled out from under
// itself (selection cleared while active) — Relationships has no such gate.
// Called before the tab-visibility toggling below so it sees the corrected
// activeTab, not a stale disabled-but-still-active value.
function applyActiveTab() {
  const hasPage = Boolean(selectedId) && Boolean(workingPayload);
  if (!hasPage && activeTab === "timeline") {
    activeTab = "page";
  }
  relationshipsEl?.classList.toggle("d-none", activeTab !== "relationships");
  timelineEl?.classList.toggle("d-none", activeTab !== "timeline");
  if (activeTab === "page") {
    editorEmptyEl?.classList.toggle("d-none", hasPage);
    editorEl?.classList.toggle("d-none", !hasPage);
  } else {
    editorEmptyEl?.classList.add("d-none");
    editorEl?.classList.add("d-none");
  }
  // Keeps the Relationships graph scoped to whichever page is loaded even when
  // switching pages without leaving the tab — loadAndRenderRelationships only
  // runs on switching INTO the tab, this covers every selection change after.
  if (activeTab === "relationships" && relationshipsData) {
    renderGraphFilterOptions(scopedRelationshipsData());
    redrawRelationshipsGraph();
  }
  renderModeToggle();
  renderPageViewToggle();
}

// Only meaningful for "relationships"/"timeline" — switching to "page" never
// needs a rebuild, and switching away leaves cached data alone for a fast return.
async function setActiveTab(tab) {
  activeTab = tab;
  applyActiveTab();
  if (tab === "relationships") await loadAndRenderRelationships();
  if (tab === "timeline") await loadAndRenderTimeline();
}

function renderEditor() {
  const hasSelection = Boolean(selectedId) && Boolean(workingPayload);
  applyActiveTab();
  if (!hasSelection) return;
  if (titleInput) titleInput.value = workingPayload.title || "";
  if (bodyTextarea) bodyTextarea.value = workingPayload.body || "";
  renderTags();
  renderParent();
  renderRelated();
  renderBacklinks();
  renderOutline();
}

// Journal/quest icons match their callout/reference-chip look elsewhere; every
// other kind reuses iconFor rather than a second hardcoded table.
function relationshipsNodeIcon(node) {
  if (node.kind === "journal") return "tabler:notebook";
  if (node.kind === "quest") return "tabler:map-2";
  return iconFor(node.kind);
}

function relationshipsNodeRadius(node) {
  if (node.kind === "journal") return 22;
  if (node.kind === "quest") return 18;
  return 14;
}

let relationshipsGraph = null;
// Cached for the session, nulled after a save/delete so the view recomputes
// next open rather than showing stale data.
let relationshipsData = null;

// Kinds currently HIDDEN (unchecked) — a Set, not a positive "visible" list, so
// a new kind defaults to visible. Persists across a relationshipsData recompute.
let graphHiddenKinds = new Set();

function kindLabelForFilter(kind) {
  if (kind === "journal") return "Journal Pages";
  if (kind === "quest") return "Quests";
  return kindLabelsMap[kind] || kind;
}

// Node/edge shape only — never touches relationshipsData, so toggling a
// checkbox just re-filters and redraws from the already-computed graph.
function filterGraphData(data, hiddenKinds) {
  const nodes = (data?.nodes || []).filter((node) => !hiddenKinds.has(node.kind));
  const visibleIds = new Set(nodes.map((node) => node.id));
  const edges = (data?.edges || []).filter((edge) => visibleIds.has(edge.a) && visibleIds.has(edge.b));
  return { nodes, edges };
}

// Narrows to pageNodeId's direct connections — itself, its quest sub-nodes,
// and anything linked via wikilink or `kind:Name` reference. One hop only,
// not transitive.
function filterGraphToPage(data, pageNodeId) {
  const edges = (data?.edges || []).filter((edge) => edge.a === pageNodeId || edge.b === pageNodeId);
  const nodeIds = new Set([pageNodeId]);
  edges.forEach((edge) => {
    nodeIds.add(edge.a);
    nodeIds.add(edge.b);
  });
  const nodes = (data?.nodes || []).filter((node) => nodeIds.has(node.id));
  return { nodes, edges };
}

// The one place that decides "everything" vs. "just the loaded page" — every
// caller needing the graph's current scope goes through this so they can never disagree.
function scopedRelationshipsData() {
  if (!selectedId || !workingPayload) return relationshipsData;
  return filterGraphToPage(relationshipsData, `journal:${selectedId}`);
}

function redrawRelationshipsGraph() {
  relationshipsGraph?.setGraph(filterGraphData(scopedRelationshipsData(), graphHiddenKinds));
}

// Rebuilds filter checkboxes from kinds present in `data` — journal/quest
// first, rest alphabetical. Checked state reads from `graphHiddenKinds`, not
// reset here, so re-opening the view doesn't un-hide a kind the GM chose to hide.
function renderGraphFilterOptions(data) {
  if (!graphFilterMenuEl) return;
  const kinds = Array.from(new Set((data?.nodes || []).map((node) => node.kind))).sort((a, b) => {
    const rank = (kind) => (kind === "journal" ? 0 : kind === "quest" ? 1 : 2);
    const rankDiff = rank(a) - rank(b);
    return rankDiff !== 0 ? rankDiff : kindLabelForFilter(a).localeCompare(kindLabelForFilter(b));
  });
  graphFilterMenuEl.innerHTML = "";
  if (!kinds.length) {
    graphFilterMenuEl.appendChild(el("p", "text-body-secondary small mb-0 px-1", "Nothing to filter yet."));
    return;
  }
  kinds.forEach((kind) => {
    const inputId = `repo-graph-filter-${kind}`;
    const wrapper = el("div", "form-check");
    const input = document.createElement("input");
    input.type = "checkbox";
    input.className = "form-check-input";
    input.id = inputId;
    input.checked = !graphHiddenKinds.has(kind);
    input.addEventListener("change", () => {
      if (input.checked) graphHiddenKinds.delete(kind);
      else graphHiddenKinds.add(kind);
      redrawRelationshipsGraph();
    });
    const label = document.createElement("label");
    label.className = "form-check-label small";
    label.setAttribute("for", inputId);
    label.textContent = kindLabelForFilter(kind);
    wrapper.append(input, label);
    graphFilterMenuEl.appendChild(wrapper);
  });
}

function initRelationshipsGraph() {
  if (!graphContainerEl || !graphContentEl || !graphSvgEl) return;
  relationshipsGraph = createForceGraph({
    container: graphContainerEl,
    content: graphContentEl,
    svg: graphSvgEl,
    emptyMount: graphEmptyEl,
    onSelect: (nodeId) => handleRelationshipsNodeSelect(nodeId),
    getNodeRadius: relationshipsNodeRadius,
    getNodeIcon: relationshipsNodeIcon,
    classPrefix: "repository-graph",
    emptyIcon: "tabler:affiliate",
    emptyMessage: "Nothing connected yet — add a [[wikilink]], a [!quest], or a `kind:Name` reference to a page.",
    // Lower than graph-view.js's own 0.75 default — a workspace-wide graph
    // needs to zoom out further than a single record's smaller graph.
    minZoom: 0.2,
  });
  // Stops the event bubbling to `container` — otherwise PanZoomController's
  // setPointerCapture hijacks the click these zoom buttons need.
  graphControlsEl?.addEventListener("pointerdown", (event) => event.stopPropagation());
  graphFilterEl?.addEventListener("pointerdown", (event) => event.stopPropagation());
  [
    { icon: "tabler:zoom-out", label: "Zoom out", onClick: () => relationshipsGraph.zoomBy(-0.25) },
    { icon: "tabler:refresh", label: "Reset zoom", onClick: () => relationshipsGraph.reset() },
    { icon: "tabler:zoom-in", label: "Zoom in", onClick: () => relationshipsGraph.zoomBy(0.25) },
  ].forEach((config) => graphToolbarMountEl?.appendChild(createIconButton(config)));
}

async function loadAndRenderRelationships() {
  if (!relationshipsGraph) return;
  if (!relationshipsData) {
    await ensureLibraryKinds();
    try {
      relationshipsData = await buildRelationshipsGraph(dataManager, { validKindIds });
    } catch (error) {
      relationshipsData = { nodes: [], edges: [] };
      status?.show("Unable to build the Relationships graph.", { type: "error" });
    }
  }
  renderGraphFilterOptions(scopedRelationshipsData());
  redrawRelationshipsGraph();
}

// Same "computed on demand, invalidated on save/delete" convention as
// relationshipsData above (handleSave/handleDelete null both out together).
let timelineData = null;

async function loadAndRenderTimeline() {
  if (!timelineData) {
    try {
      timelineData = await buildTimeline(dataManager);
    } catch (error) {
      timelineData = [];
      status?.show("Unable to build the Timeline.", { type: "error" });
    }
  }
  renderTimeline();
}

// Day-index heading via the active calendar's describeDate (same function
// journal-date.js's chip uses) — falls back to plain "Day <N>" with no calendar defined.
function formatTimelineDayHeading(dayIndex) {
  return describeDate(activeCalendar || {}, dayIndex);
}

// Grouped by day, with a "Today" divider inserted wherever activeCampaignDayIndex
// falls in the sorted list (not just appended at the end), so past and upcoming
// read as genuinely separated.
function renderTimeline() {
  if (!timelineListEl) return;
  timelineListEl.innerHTML = "";
  const groups = groupTimelineByDay(timelineData || [], activeCampaignDayIndex);
  const hasToday = Number.isFinite(activeCampaignDayIndex);
  timelineEmptyEl?.classList.toggle("d-none", Boolean(groups.length));
  if (!groups.length) {
    if (timelineEmptyEl) {
      timelineEmptyEl.innerHTML = "";
      timelineEmptyEl.appendChild(
        createEmptyStateCard({
          icon: "tabler:calendar-event",
          message: "Nothing dated yet — add a `date:<day>` reference to a page.",
        })
      );
    }
    return;
  }
  let todayInserted = !hasToday;
  groups.forEach((group) => {
    if (!todayInserted && group.dayIndex >= activeCampaignDayIndex) {
      timelineListEl.appendChild(el("div", "repository-timeline-today-divider small text-primary fw-semibold", "Today"));
      todayInserted = true;
    }
    const heading = el("div", "small fw-semibold text-body-secondary mt-2", formatTimelineDayHeading(group.dayIndex));
    timelineListEl.appendChild(heading);
    group.items.forEach((item) => {
      const row = document.createElement("button");
      row.type = "button";
      row.className = "btn btn-outline-secondary btn-sm text-start w-100 d-flex flex-column align-items-start mt-1";
      const titleLine = el("span", "fw-semibold", item.label ? `${item.label} — ${item.pageTitle}` : item.pageTitle);
      row.appendChild(titleLine);
      row.addEventListener("click", () => handleTimelineEntrySelect(item.pageId));
      timelineListEl.appendChild(row);
    });
  });
  if (!todayInserted) {
    timelineListEl.appendChild(el("div", "repository-timeline-today-divider small text-primary fw-semibold", "Today"));
  }
}

// A node's {pageId, questTitle, refKind, refId} (attached directly by
// relationships-graph.js, not re-derived from the id string) drives navigation:
// journal/quest nodes switch back to the page editor; any other kind reuses
// handleOpenReference, same as a kind-reference chip's click.
function handleRelationshipsNodeSelect(nodeId) {
  const node = (relationshipsData?.nodes || []).find((entry) => entry.id === nodeId);
  if (!node) return;
  if (node.kind === "journal") {
    void setActiveTab("page");
    selectPage(node.pageId, { remember: false });
    return;
  }
  if (node.kind === "quest") {
    void setActiveTab("page");
    selectPage(node.pageId, { heading: node.questTitle || "", remember: false });
    return;
  }
  void handleOpenReference(node.refKind, node.refId);
}

// Same "switch back to Page tab, then select" shape as
// handleRelationshipsNodeSelect. No heading anchor — a date reference's
// free-text label isn't reliably a real heading/quest title.
function handleTimelineEntrySelect(pageId) {
  void setActiveTab("page");
  selectPage(pageId, { remember: false });
}

// previewEl's scrollTop per page id, captured before switching away and
// restored on a "remember"-mode return (list clicks, back/forward) so leaving
// and coming back feels unchanged. Link-driven navigation opts out of this.
const scrollMemory = new Map();

function captureScrollMemory() {
  if (selectedId && currentMode === "view" && previewEl) {
    scrollMemory.set(selectedId, previewEl.scrollTop);
  }
}

// Same shape as findHeadingByText (journal-outline.js), over quest titles instead.
function findQuestByTitle(body, title) {
  const target = (title || "").trim().toLowerCase();
  if (!target) return -1;
  const quests = extractQuests(body);
  return quests.findIndex((quest) => (quest.title || "").trim().toLowerCase() === target);
}

// `?page=<id>` is the whole of Repository's navigable state — same
// "URL identifies the current record" convention as Dashboard's `?encounter=<id>`.
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

// Switching away discards any unsaved draft outright, same as Orrery's map
// switcher — Save's dirty-gating is what warns of unsaved work, not a nav block.
//
// `heading`/`remember` control scroll landing: a `heading` (from a
// [[Page#Heading]] link) always wins; otherwise `remember: true` (default)
// restores scrollMemory's last position; `remember: false` (plain [[Page]]
// clicks) always lands at the top.
//
// A brief highlight pulse on the link target — scrollIntoView gives no
// feedback when already visible. Inline styles, not a CSS class, since this
// can fire inside handout.js's Dashboard widget, which never loads Repository's stylesheet.
function flashElement(target) {
  if (!target) return;
  target.style.transition = "box-shadow 0.2s ease";
  target.style.boxShadow = "0 0 0 3px var(--bs-primary, #0d6efd)";
  window.setTimeout(() => {
    target.style.boxShadow = "";
    window.setTimeout(() => {
      target.style.transition = "";
    }, 300);
  }, 700);
}

// `pushHistory: false` is only passed by the popstate handler — every other
// caller is a new navigation step the browser's back/forward should retrace.
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
  // Defaults to View for an existing page — presumably already-written content
  // worth reading. Renders synchronously so repo-heading-<index> ids exist
  // by the time the scroll-outcome logic below runs.
  applyMode("view");
  updateToolbarState();
  if (pushHistory) pushPageHistory(id);
  const headingIndex = findHeadingByText(workingPayload.body, heading);
  // A quest title is checked as a second anchor class whenever it doesn't
  // match a real heading — no parallel navigation mechanism.
  const questIndex = headingIndex < 0 ? findQuestByTitle(workingPayload.body, heading) : -1;
  if (headingIndex >= 0) {
    const target = previewEl?.querySelector(`#repo-heading-${headingIndex}`);
    target?.scrollIntoView({ block: "start" });
    flashElement(target);
  } else if (questIndex >= 0) {
    const target = previewEl?.querySelector(`#repo-quest-${questIndex}`);
    target?.scrollIntoView({ block: "start" });
    flashElement(target);
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
  // Never equal to a real JSON.stringify(workingPayload) — a draft is dirty
  // from the moment it exists.
  cleanSnapshot = null;
  renderPageTree();
  renderEditor();
  applyMode("edit"); // nothing written yet to preview

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
  // Stale after any content change — recomputed on demand the next time the
  // Relationships/Timeline tab opens, not eagerly here.
  relationshipsData = null;
  timelineData = null;
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
  relationshipsData = null;
  timelineData = null;
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

searchInput?.addEventListener("input", () => {
  resetSearchCycle();
  renderPageTree();
});
// stopPropagation, not just preventDefault — preventDefault alone doesn't stop
// this keydown from bubbling to document, where app-shell.js's
// KeyboardShortcuts listens; guards against anything reacting to Shift+Enter too.
searchInput?.addEventListener("keydown", (event) => {
  if (event.key !== "Enter") return;
  event.preventDefault();
  event.stopPropagation();
  goToSearchMatch(event.shiftKey ? -1 : 1);
});
undoButton?.addEventListener("click", () => undo());
redoButton?.addEventListener("click", () => redo());
// Same dirty check updateToolbarState uses for Save — Repository had no
// guard against navigating/closing away from unsaved edits before this.
window.addEventListener("beforeunload", (event) => {
  if (!isDirty()) return;
  event.preventDefault();
  event.returnValue = "";
});

newButton?.addEventListener("click", () => createDraftEntry());
duplicateButton?.addEventListener("click", () => handleDuplicate());
saveButton?.addEventListener("click", () => void handleSave());
deleteButton?.addEventListener("click", () => void handleDelete());
// The Mode/View header row's click handling lives inside renderModeToggle/
// renderPageViewToggle themselves — both rebuild fresh on every call, no
// persistent top-level listener needed here.
renderModeToggle();
renderPageViewToggle();

// Live (every keystroke) for dirty-gating feedback. The undo entry is coarser
// — one per burst of typing, debounced (FIELD_COMMIT_DEBOUNCE_MS), roughly
// matching a browser's native textarea undo batching.
//
// Native undo isn't actually available here: app-shell.js's Ctrl+Z handler is
// a global listener with no text-field exception, always intercepting first.
// Whatever's in the debounce window must flush synchronously on Ctrl+Z, via a
// bubbling keydown listener on the field that runs before app-shell's document-level one.
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
  // Baseline captured inside scheduleFieldCommit before this mutation — it's
  // the "before" half of the undo entry.
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

// `[[` autocomplete — page titles, `page#Heading`, `page#^blockId` tables.
// `entries` read fresh via callback since it's reassigned after async load.
attachWikiLinkAutocomplete(bodyTextarea, { getEntries: () => entries });
// `` `macro:`/`encounter:`/`dice:` `` autocomplete — independent attachment on
// the same textarea, each reacting only to its own trigger syntax.
attachCodeBlockAutocomplete(bodyTextarea, { dataManager });

// --- Markdown formatting toolbar ---------------------------------------
// A lightweight toolbar, not rich-text/WYSIWYG — every button inserts/wraps
// real Markdown syntax directly, so the body stays valid plain Markdown.
//
// Insertion goes through document.execCommand("insertText", ...) rather than
// a raw textarea.value assignment — preserves the browser's native undo/redo
// stack and fires the same "input" event real typing does, integrating with
// bodyTextarea's existing input listener with no extra wiring.
function replaceTextareaSelection(textarea, start, end, text) {
  textarea.focus();
  textarea.setSelectionRange(start, end);
  const inserted = typeof document.execCommand === "function" && document.execCommand("insertText", false, text);
  if (!inserted) {
    // execCommand unsupported/blocked — falls back to a direct value mutation
    // and manually fires "input"; loses native undo for this one edit.
    const value = textarea.value;
    textarea.value = `${value.slice(0, start)}${text}${value.slice(end)}`;
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
  }
}

// True when the current selection is exactly surrounded by `before`/`after` —
// shared by applyMarkdownWrap (unwrap vs. wrap-again) and the toolbar's own
// button-active-state tracking below.
function isSelectionWrapped(textarea, before, after = before) {
  const { selectionStart, selectionEnd, value } = textarea;
  const beforeStart = selectionStart - before.length;
  const afterEnd = selectionEnd + after.length;
  return (
    beforeStart >= 0 &&
    afterEnd <= value.length &&
    value.slice(beforeStart, selectionStart) === before &&
    value.slice(selectionEnd, afterEnd) === after
  );
}

// Bold and Italic share the SAME marker character (`*`) — 1 asterisk is
// Italic, 2 is Bold, 3 is both — so toggling one has to know the other's
// current state rather than blindly checking/adding a fixed string. Treating
// Italic as "exactly one `*`" independently of Bold misreads the inner text
// of already-bold `**text**` as italic too, corrupting a Bold click there.
function asteriskRunBefore(value, position) {
  let count = 0;
  for (let i = position - 1; i >= 0 && value[i] === "*"; i--) count++;
  return count;
}
function asteriskRunAfter(value, position) {
  let count = 0;
  for (let i = position; i < value.length && value[i] === "*"; i++) count++;
  return count;
}
// The shorter of the two sides' runs — stays sane against a malformed
// selection (an unmatched stray `*`) by never reporting more than what's
// actually mirrored on both sides.
function currentEmphasisRunLength(textarea) {
  const { selectionStart, selectionEnd, value } = textarea;
  return Math.min(asteriskRunBefore(value, selectionStart), asteriskRunAfter(value, selectionEnd));
}
function isBoldActive(textarea) {
  return currentEmphasisRunLength(textarea) >= 2;
}
function isItalicActive(textarea) {
  const run = currentEmphasisRunLength(textarea);
  return run === 1 || run >= 3;
}
// Rewrites both sides' run to exactly `targetLength` asterisks in one atomic
// edit — the only reliable way to move between italic (1), bold (2), and both
// (3) without the two toggles fighting each other.
function setEmphasisRunLength(textarea, targetLength) {
  const { selectionStart, selectionEnd, value } = textarea;
  const beforeRun = asteriskRunBefore(value, selectionStart);
  const afterRun = asteriskRunAfter(value, selectionEnd);
  const beforeStart = selectionStart - beforeRun;
  const afterEnd = selectionEnd + afterRun;
  const selected = value.slice(selectionStart, selectionEnd);
  const marker = "*".repeat(Math.max(0, targetLength));
  replaceTextareaSelection(textarea, beforeStart, afterEnd, `${marker}${selected}${marker}`);
  textarea.setSelectionRange(beforeStart + marker.length, beforeStart + marker.length + selected.length);
}
// Toggles just the Bold bit of the current run, preserving Italic — so
// Italic(1)+Bold-click → Both(3), Both(3)+Bold-click → Italic(1).
function toggleBold(textarea) {
  const run = currentEmphasisRunLength(textarea);
  const italicOn = run === 1 || run >= 3;
  setEmphasisRunLength(textarea, (isBoldActive(textarea) ? 0 : 2) + (italicOn ? 1 : 0));
}
function toggleItalic(textarea) {
  const run = currentEmphasisRunLength(textarea);
  const boldOn = run >= 2;
  setEmphasisRunLength(textarea, (boldOn ? 2 : 0) + (isItalicActive(textarea) ? 0 : 1));
}

// Wraps the current selection in `before`/`after` (Strikethrough/Code — Bold/
// Italic use the dedicated emphasis functions above since those can't toggle
// independently of a fixed string). Toggles OFF (unwraps) when already
// wrapped; an empty selection wraps anyway, leaving the caret between markers.
//
// Only detects a selection that exactly spans the wrapped text — a cursor
// resting in the middle of a bolded word with nothing selected won't register
// as wrapped. A deliberate scope limit for a lightweight toolbar.
function applyMarkdownWrap(textarea, before, after = before) {
  const { selectionStart, selectionEnd, value } = textarea;
  const selected = value.slice(selectionStart, selectionEnd);
  if (isSelectionWrapped(textarea, before, after)) {
    const beforeStart = selectionStart - before.length;
    const afterEnd = selectionEnd + after.length;
    replaceTextareaSelection(textarea, beforeStart, afterEnd, selected);
    textarea.setSelectionRange(beforeStart, beforeStart + selected.length);
    return;
  }
  replaceTextareaSelection(textarea, selectionStart, selectionEnd, `${before}${selected}${after}`);
  if (selected) {
    textarea.setSelectionRange(selectionStart + before.length, selectionStart + before.length + selected.length);
  } else {
    const caret = selectionStart + before.length;
    textarea.setSelectionRange(caret, caret);
  }
}

// The lines touched by the current selection (or just the current line, for a
// collapsed cursor) — shared by applyMarkdownLinePrefix and its active-state check.
function selectedLineRange(textarea) {
  const { selectionStart, selectionEnd, value } = textarea;
  const lineStart = value.lastIndexOf("\n", selectionStart - 1) + 1;
  const nextBreak = value.indexOf("\n", selectionEnd);
  const lineEnd = nextBreak === -1 ? value.length : nextBreak;
  return { lineStart, lineEnd, lines: value.slice(lineStart, lineEnd).split("\n") };
}

// True when every touched line already starts with its own prefixFor(index) —
// unlike applyMarkdownWrap's boundary-only check, a whole-line prefix has no
// "middle" to miss, so this covers a collapsed cursor anywhere on the line too.
function isSelectionLinePrefixed(textarea, prefixFor) {
  const { lines } = selectedLineRange(textarea);
  return lines.every((line, index) => line.startsWith(prefixFor(index)));
}

// Prefixes every touched line (Heading/Quote/Bullet list) — `prefixFor(index)`
// returns that line's prefix (numbered lists increment; others are fixed).
// Toggles OFF if already prefixed, same idiom as applyMarkdownWrap.
function applyMarkdownLinePrefix(textarea, prefixFor) {
  const { lineStart, lineEnd, lines } = selectedLineRange(textarea);
  const alreadyPrefixed = isSelectionLinePrefixed(textarea, prefixFor);
  const nextText = alreadyPrefixed
    ? lines.map((line, index) => line.slice(prefixFor(index).length)).join("\n")
    : lines.map((line, index) => `${prefixFor(index)}${line}`).join("\n");
  replaceTextareaSelection(textarea, lineStart, lineEnd, nextText);
  textarea.setSelectionRange(lineStart, lineStart + nextText.length);
}

// Six standalone buttons (H1-H6) — each is its own toggle, and clicking a
// different level switches to it directly (H3 line + H2 click → H2, not
// stacked), no two-click remove-then-add. A selection spanning an H1 and H2
// line reports 0 (no single level), and a click sets every line uniformly.
const HEADING_LINE_PATTERN = /^(#{1,6})\s/;
function currentHeadingLevel(textarea) {
  const { lines } = selectedLineRange(textarea);
  let level = null;
  for (const line of lines) {
    const match = HEADING_LINE_PATTERN.exec(line);
    const lineLevel = match ? match[1].length : 0;
    if (level === null) level = lineLevel;
    else if (level !== lineLevel) return 0;
  }
  return level || 0;
}
function setHeadingLevel(textarea, targetLevel) {
  const { lineStart, lineEnd, lines } = selectedLineRange(textarea);
  const nextLines = lines.map((line) => {
    const stripped = line.replace(HEADING_LINE_PATTERN, "");
    return targetLevel > 0 ? `${"#".repeat(targetLevel)} ${stripped}` : stripped;
  });
  const nextText = nextLines.join("\n");
  replaceTextareaSelection(textarea, lineStart, lineEnd, nextText);
  textarea.setSelectionRange(lineStart, lineStart + nextText.length);
}
function toggleHeadingLevel(textarea, level) {
  setHeadingLevel(textarea, currentHeadingLevel(textarea) === level ? 0 : level);
}

// Bullet list, Checklist, and Numbered list are mutually exclusive
// alternatives for a line's leading marker, not independent toggleable bits
// like Bold/Italic — but Checklist's syntax (GFM `- [ ] `) starts with the
// same `- ` a plain bullet does. A naive startsWith("- ") check reads a
// checklist line as also an active bullet, corrupting it on a Bullet click —
// same class of bug as Bold/Italic's shared `*`, fixed the same way: one
// shared model, not isolated per-button prefix checks.
const CHECKLIST_LINE_PATTERN = /^[-*+]\s+\[[ xX]\]\s+/;
const BULLET_LINE_PATTERN = /^[-*+]\s+/;
const NUMBERED_LINE_PATTERN = /^\d+\.\s+/;

// null when the touched lines don't all agree, same "report nothing rather
// than guess" rule as the multi-line toggles above. Checked in this order
// since checklist's pattern is a strict superset of bullet's.
function currentListKind(textarea) {
  const { lines } = selectedLineRange(textarea);
  let kind;
  for (const line of lines) {
    let lineKind = null;
    if (CHECKLIST_LINE_PATTERN.test(line)) lineKind = "checklist";
    else if (BULLET_LINE_PATTERN.test(line)) lineKind = "bullet";
    else if (NUMBERED_LINE_PATTERN.test(line)) lineKind = "numbered";
    if (kind === undefined) kind = lineKind;
    else if (kind !== lineKind) return null;
  }
  return kind || null;
}

function stripListMarker(line) {
  if (CHECKLIST_LINE_PATTERN.test(line)) return line.replace(CHECKLIST_LINE_PATTERN, "");
  if (BULLET_LINE_PATTERN.test(line)) return line.replace(BULLET_LINE_PATTERN, "");
  if (NUMBERED_LINE_PATTERN.test(line)) return line.replace(NUMBERED_LINE_PATTERN, "");
  return line;
}

// Rewrites every touched line to `targetKind` (or plain text for null),
// stripping any existing marker first — how a checklist line cleanly becomes
// a plain bullet in one step.
function setListKind(textarea, targetKind) {
  const { lineStart, lineEnd, lines } = selectedLineRange(textarea);
  const stripped = lines.map(stripListMarker);
  const nextLines = stripped.map((line, index) => {
    if (targetKind === "bullet") return `- ${line}`;
    if (targetKind === "checklist") return `- [ ] ${line}`;
    if (targetKind === "numbered") return `${index + 1}. ${line}`;
    return line;
  });
  const nextText = nextLines.join("\n");
  replaceTextareaSelection(textarea, lineStart, lineEnd, nextText);
  textarea.setSelectionRange(lineStart, lineStart + nextText.length);
}

function toggleListKind(textarea, kind) {
  setListKind(textarea, currentListKind(textarea) === kind ? null : kind);
}

// Inserts `content` as its own standalone block, preceded/followed by a blank
// line unless one's already there — shared by Horizontal Rule and Table,
// both block-level elements needing real separation. Not a toggle.
function insertMarkdownBlock(textarea, content) {
  const { selectionStart, selectionEnd, value } = textarea;
  const before = value.slice(0, selectionStart);
  const after = value.slice(selectionEnd);
  const leading = before.length === 0 || before.endsWith("\n\n") ? "" : before.endsWith("\n") ? "\n" : "\n\n";
  const trailing = after.length === 0 || after.startsWith("\n\n") ? "" : after.startsWith("\n") ? "\n" : "\n\n";
  replaceTextareaSelection(textarea, selectionStart, selectionEnd, `${leading}${content}${trailing}`);
  const caret = selectionStart + leading.length + content.length;
  textarea.setSelectionRange(caret, caret);
}
function insertHorizontalRule(textarea) {
  insertMarkdownBlock(textarea, "---");
}

// GFM table syntax — a header row, the required `---` separator row (one
// cell per column, alignment-less), then `rows` blank body rows ready to
// fill in.
function buildMarkdownTable(columns, rows) {
  const headerCells = Array.from({ length: columns }, (_, index) => `Header ${index + 1}`);
  const separatorCells = Array.from({ length: columns }, () => "---");
  const blankRow = `| ${Array.from({ length: columns }, () => " ").join(" | ")} |`;
  return [`| ${headerCells.join(" | ")} |`, `| ${separatorCells.join(" | ")} |`, ...Array.from({ length: rows }, () => blankRow)].join(
    "\n"
  );
}

const TABLE_PICKER_MAX_COLS = 8;
const TABLE_PICKER_MAX_ROWS = 6;

// Word/Excel's "Insert Table" grid picker: hover highlights a rectangle from
// top-left to the pointer, a label reports "columns x rows," a click commits
// immediately (8x6 max — a bigger table is easy to hand-edit afterward). Built
// once and shown/hidden — a real popover in document.body (not Bootstrap's
// Popover, which can't cleanly host interactive content) so its positioning
// isn't clipped by the editor card's `overflow: hidden`.
function createTablePickerPopover(anchorButton, onPick) {
  const popover = el("div", "repository-table-picker d-none");
  const grid = el("div", "repository-table-picker-grid");
  const cells = [];
  for (let row = 0; row < TABLE_PICKER_MAX_ROWS; row++) {
    for (let col = 0; col < TABLE_PICKER_MAX_COLS; col++) {
      const cell = el("div", "repository-table-picker-cell");
      cell.dataset.row = String(row);
      cell.dataset.col = String(col);
      grid.appendChild(cell);
      cells.push(cell);
    }
  }
  const label = el("div", "repository-table-picker-label small text-body-secondary text-center", "Insert table");
  popover.append(grid, label);
  document.body.appendChild(popover);

  function highlight(rows, cols) {
    cells.forEach((cell) => {
      const active = Number(cell.dataset.row) < rows && Number(cell.dataset.col) < cols;
      cell.classList.toggle("is-active", active);
    });
    label.textContent = rows && cols ? `${cols} × ${rows} table` : "Insert table";
  }

  function onOutsideClick(event) {
    if (!popover.contains(event.target) && event.target !== anchorButton) close();
  }
  function onKeydown(event) {
    if (event.key === "Escape") close();
  }
  function open() {
    const rect = anchorButton.getBoundingClientRect();
    popover.style.top = `${window.scrollY + rect.bottom + 4}px`;
    popover.style.left = `${window.scrollX + rect.left}px`;
    popover.classList.remove("d-none");
    highlight(0, 0);
    // Deferred past this same click via setTimeout — the click that opened
    // this would otherwise immediately bubble up and close it in the same tick.
    setTimeout(() => {
      document.addEventListener("mousedown", onOutsideClick, true);
      document.addEventListener("keydown", onKeydown, true);
    }, 0);
  }
  function close() {
    popover.classList.add("d-none");
    document.removeEventListener("mousedown", onOutsideClick, true);
    document.removeEventListener("keydown", onKeydown, true);
  }
  function toggle() {
    if (popover.classList.contains("d-none")) open();
    else close();
  }

  grid.addEventListener("mousemove", (event) => {
    const cell = event.target.closest(".repository-table-picker-cell");
    if (!cell) return;
    highlight(Number(cell.dataset.row) + 1, Number(cell.dataset.col) + 1);
  });
  grid.addEventListener("mouseleave", () => highlight(0, 0));
  grid.addEventListener("click", (event) => {
    const cell = event.target.closest(".repository-table-picker-cell");
    if (!cell) return;
    onPick(Number(cell.dataset.col) + 1, Number(cell.dataset.row) + 1);
    close();
  });

  return { toggle, close };
}

// `[label](url)` — wraps a selection as the link label, or inserts a
// placeholder when nothing's selected; either way leaves `url` selected so
// typing a real address is the next keystroke.
function insertMarkdownLink(textarea) {
  const { selectionStart, selectionEnd, value } = textarea;
  const selected = value.slice(selectionStart, selectionEnd);
  const label = selected || "link text";
  replaceTextareaSelection(textarea, selectionStart, selectionEnd, `[${label}](url)`);
  const urlStart = selectionStart + label.length + 3; // "[" + label + "]("
  textarea.setSelectionRange(urlStart, urlStart + 3); // "url"
}

// journal-callouts.js's documented syntax (`> [!type]+ Title` then
// `>`-prefixed body). Defaults to `[!note]+` (foldable, open by default) —
// `+` is what makes the fold affordance appear in View mode — with the type
// left selected so overtyping "note" with "warning"/"tip"/a custom type is
// the next keystroke. Reuses the current line(s) as the body.
function insertCallout(textarea) {
  const { lineStart, lineEnd, lines } = selectedLineRange(textarea);
  const bodyLines = lines.some((line) => line.trim()) ? lines : ["Callout body"];
  const template = [`> [!note]+ Title`, ...bodyLines.map((line) => `> ${line}`)].join("\n");
  replaceTextareaSelection(textarea, lineStart, lineEnd, template);
  const typeStart = lineStart + 4; // '> [!'
  textarea.setSelectionRange(typeStart, typeStart + "note".length);
}

// A blank [!story-board] callout — same "insert, leave title selected to
// overtype" convention as insertCallout. Empty Nodes/Edges tables
// (serializeStoryBoard over a fully-empty model) that the visual editor's own
// Add Node/Lane/Stage actions build up from once rendered as a live canvas.
function insertStoryBoard(textarea) {
  const { lineStart, lineEnd } = selectedLineRange(textarea);
  const blank = serializeStoryBoard({ layoutMode: "freeform", lanes: [], stages: [], nodes: [], edges: [] });
  const template = [`> [!story-board]+ New Story Board`, ...blank.split("\n").map((line) => (line ? `> ${line}` : ">"))].join("\n");
  replaceTextareaSelection(textarea, lineStart, lineEnd, template);
  const titleStart = lineStart + "> [!story-board]+ ".length;
  textarea.setSelectionRange(titleStart, titleStart + "New Story Board".length);
}

if (bodyTextarea) {
  const styleGroup = document.querySelector("[data-repository-format-style-mount]");
  const headingGroup = document.querySelector("[data-repository-format-heading-mount]");
  const blockGroup = document.querySelector("[data-repository-format-block-mount]");
  const insertGroup = document.querySelector("[data-repository-format-insert-mount]");

  // {button, isActive(textarea)} for every toggleable button (Link/Callout
  // aren't toggles) — updateFormatToggleStates walks this to keep pressed
  // state in sync with the current cursor/selection, not just the last click.
  const toggleButtons = [];
  function registerToggle(button, isActive) {
    toggleButtons.push({ button, isActive });
    return button;
  }
  function updateFormatToggleStates() {
    toggleButtons.forEach(({ button, isActive }) => {
      const active = isActive(bodyTextarea);
      button.classList.toggle("active", active);
      button.setAttribute("aria-pressed", active ? "true" : "false");
    });
    // Not a plain {button,isActive} toggle — its icon has to change too, so
    // it's called directly rather than folded into the generic loop above.
    updateHeadingPickerState();
  }
  // Every action handler runs the edit, then re-derives every button's state
  // from the resulting selection — simpler than each handler predicting its own toggle.
  function formatAction(fn) {
    return () => {
      fn();
      updateFormatToggleStates();
    };
  }
  function buildFormatButton({ icon, label, onClick, isActive }) {
    const button = createIconButton({ icon, label, kind: "compact", onClick: formatAction(onClick) });
    if (isActive) {
      button.setAttribute("aria-pressed", "false");
      registerToggle(button, isActive);
    }
    return button;
  }

  [
    {
      icon: "tabler:bold",
      label: "Bold",
      onClick: () => toggleBold(bodyTextarea),
      isActive: (textarea) => isBoldActive(textarea),
    },
    {
      icon: "tabler:italic",
      label: "Italic",
      onClick: () => toggleItalic(bodyTextarea),
      isActive: (textarea) => isItalicActive(textarea),
    },
    {
      icon: "tabler:strikethrough",
      label: "Strikethrough",
      onClick: () => applyMarkdownWrap(bodyTextarea, "~~"),
      isActive: (textarea) => isSelectionWrapped(textarea, "~~"),
    },
    {
      icon: "tabler:code",
      label: "Inline code",
      onClick: () => applyMarkdownWrap(bodyTextarea, "`"),
      isActive: (textarea) => isSelectionWrapped(textarea, "`"),
    },
  ].forEach((config) => styleGroup?.appendChild(buildFormatButton(config)));

  // Condensed into one hover-dropdown (six buttons would push the toolbar
  // onto its own row, and only one level is ever active at once) — same
  // hover-opens mechanism the header's tool switcher uses (attachHoverDropdown).
  // The toggle icon mirrors the active level's H1-H6 glyph, or the generic
  // "heading" glyph when none is (updateHeadingPickerState).
  const headingDropdown = el("div", "dropdown");
  const headingToggle = createIconButton({ icon: "tabler:heading", label: "Heading", kind: "compact" });
  headingToggle.classList.add("dropdown-toggle");
  headingToggle.dataset.bsToggle = "dropdown";
  // Bootstrap's default Popper `position: absolute` would get cut off by the
  // editor card's own `overflow: hidden`. `strategy: fixed` positions relative
  // to the viewport instead, Bootstrap's documented escape hatch for this case.
  headingToggle.dataset.bsStrategy = "fixed";
  headingToggle.setAttribute("aria-expanded", "false");
  const headingMenu = el("ul", "dropdown-menu");
  const headingItems = [];
  for (let level = 1; level <= 6; level++) {
    const item = document.createElement("button");
    item.type = "button";
    item.className = "dropdown-item d-flex align-items-center gap-2";
    const itemIcon = el("span", "iconify");
    itemIcon.dataset.icon = `tabler:h-${level}`;
    itemIcon.setAttribute("aria-hidden", "true");
    item.append(itemIcon, document.createTextNode(`Heading ${level}`));
    item.addEventListener("click", () => {
      toggleHeadingLevel(bodyTextarea, level);
      updateFormatToggleStates();
    });
    const li = document.createElement("li");
    li.appendChild(item);
    headingMenu.appendChild(li);
    headingItems.push({ item, level });
  }
  headingDropdown.append(headingToggle, headingMenu);
  headingGroup?.appendChild(headingDropdown);
  attachHoverDropdown(headingDropdown, headingToggle);
  function updateHeadingPickerState() {
    const level = currentHeadingLevel(bodyTextarea);
    const icon = headingToggle.querySelector(".iconify");
    if (icon) icon.dataset.icon = level ? `tabler:h-${level}` : "tabler:heading";
    headingToggle.classList.toggle("active", Boolean(level));
    headingToggle.setAttribute("aria-pressed", level ? "true" : "false");
    headingItems.forEach(({ item, level: itemLevel }) => item.classList.toggle("active", itemLevel === level));
  }

  [
    {
      icon: "tabler:blockquote",
      label: "Quote",
      onClick: () => applyMarkdownLinePrefix(bodyTextarea, () => "> "),
      isActive: (textarea) => isSelectionLinePrefixed(textarea, () => "> "),
    },
    {
      icon: "tabler:list-check",
      label: "Checklist",
      onClick: () => toggleListKind(bodyTextarea, "checklist"),
      isActive: (textarea) => currentListKind(textarea) === "checklist",
    },
    {
      icon: "tabler:list",
      label: "Bullet list",
      onClick: () => toggleListKind(bodyTextarea, "bullet"),
      isActive: (textarea) => currentListKind(textarea) === "bullet",
    },
    {
      icon: "tabler:list-numbers",
      label: "Numbered list",
      onClick: () => toggleListKind(bodyTextarea, "numbered"),
      isActive: (textarea) => currentListKind(textarea) === "numbered",
    },
    {
      icon: "tabler:link",
      label: "Link",
      onClick: () => insertMarkdownLink(bodyTextarea),
    },
  ].forEach((config) => blockGroup?.appendChild(buildFormatButton(config)));

  // No isActive — a one-shot insertion, same as Table/Callout below, not a
  // span/line style with an "on" state.
  insertGroup?.appendChild(
    buildFormatButton({ icon: "tabler:minus", label: "Horizontal rule", onClick: () => insertHorizontalRule(bodyTextarea) })
  );
  // Not built via buildFormatButton — clicking Table opens the grid picker
  // (createTablePickerPopover), which inserts on a cell click.
  const tableButton = createIconButton({ icon: "tabler:table", label: "Table", kind: "compact" });
  insertGroup?.appendChild(tableButton);
  const tablePicker = createTablePickerPopover(tableButton, (columns, rows) => {
    insertMarkdownBlock(bodyTextarea, buildMarkdownTable(columns, rows));
    updateFormatToggleStates();
  });
  tableButton.addEventListener("click", (event) => {
    event.stopPropagation();
    tablePicker.toggle();
  });
  insertGroup?.appendChild(
    buildFormatButton({ icon: "tabler:message-2", label: "Callout", onClick: () => insertCallout(bodyTextarea) })
  );
  insertGroup?.appendChild(
    buildFormatButton({ icon: "tabler:layout-board-split", label: "Story Board", onClick: () => insertStoryBoard(bodyTextarea) })
  );
  // Not built via buildFormatButton — transforms existing content (async,
  // resolving each wikilink) rather than inserting at the cursor.
  insertGroup?.appendChild(
    createIconButton({
      icon: "tabler:replace",
      label: "Convert wiki-links to references",
      kind: "compact",
      onClick: () => void handleConvertWikiLinksToReferences(),
    })
  );

  // Keeps toggle state in sync with the cursor/selection, not just after a
  // click — covers mouse clicks, arrow-key navigation, and typing.
  ["keyup", "mouseup", "click", "input"].forEach((eventName) => {
    bodyTextarea.addEventListener(eventName, updateFormatToggleStates);
  });
  updateFormatToggleStates();
  refreshTooltips();
}

// Without this, back/forward fall through to app-shell's page-level history
// instead of stepping back through pages viewed inside Repository.
// `event.state.repositoryPageId` is preferred when present; falling back to
// the URL's `?page=` covers the browser-default `null` state on initial load.
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
// initHelpSystem's own refreshTooltips(root) already activates every tooltip
// in the document, including help-topic triggers — a separate call before
// this one would only sweep whatever existed before initHelpSystem's own
// trigger elements, fully redundant with this sweep.
void initHelpSystem({ root: document });
initRelationshipsGraph();
// Fetched once, up front — validKindIds/kindLabelsMap must populate before
// the first renderPreview/renderRelated can turn a `` `kindId:Name` `` block
// into a chip. Refreshes once more if a page rendered before this resolves.
void ensureLibraryKinds().then(() => {
  if (currentMode === "view") renderPreview();
  void renderRelated();
});
void refreshActiveCalendar().then(() => {
  if (currentMode === "view") renderPreview();
  if (activeTab === "timeline") renderTimeline();
});
// A different campaign can mean a different Setting, so calendar vocabulary
// needs re-resolving too (data-manager.js's setActiveGroup emits this).
window.addEventListener("workbench:active-group-changed", () => {
  void refreshActiveCalendar().then(() => {
    if (currentMode === "view") renderPreview();
    if (activeTab === "timeline") renderTimeline();
  });
});
// Advancing the campaign date from any Calendar widget broadcasts this —
// updates the cached day index directly (payload already carries it) and
// re-renders so a `` `date:current` `` chip or the Timeline's Today divider reflects it immediately.
window.addEventListener("undercroft:campaign-date-changed", (event) => {
  const dayIndex = event.detail?.dayIndex;
  activeCampaignDayIndex = Number.isFinite(dayIndex) ? dayIndex : null;
  if (currentMode === "view") renderPreview();
  if (activeTab === "timeline") renderTimeline();
});
void refreshEntries().then(() => {
  // A bookmarked/reloaded `?page=<id>` deep-links straight to that page,
  // resolved after entries load (findEntry needs the fetched list).
  // replacePageHistory establishes a clean baseline state for this load.
  const deepLinkParams = new URLSearchParams(window.location.search);
  const requestedId = deepLinkParams.get("page") || "";
  const resolvedId = requestedId && findEntry(requestedId) ? requestedId : "";
  // `?heading=<text>` — a marker/reference deep link into a heading or quest
  // anchor (kind-tool-route.js's journal route, Orrery's marker link-out).
  const requestedHeading = deepLinkParams.get("heading") || "";
  // `?q=<term>` — the suite-wide header search's deep link into a body match
  // (suite-search.js). selectPage's own scroll decision runs first and is
  // superseded by this right after; both synchronous, no visible flash.
  const requestedQuery = deepLinkParams.get("q") || "";
  if (resolvedId) selectPage(resolvedId, { heading: requestedHeading, remember: true, pushHistory: false });
  if (resolvedId && requestedQuery) jumpToSearchQuery(requestedQuery);
  replacePageHistory(resolvedId);
});
