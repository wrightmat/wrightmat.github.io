import { loadHelpTopics } from "./help.js";
import { expandPane } from "./panes.js";
import { bindCollapsibleToggle } from "./collapsible.js";

function groupHelpTopicsByCategory(topics) {
  const grouping = new Map();
  topics.forEach((topic) => {
    const category = topic.category || "General";
    if (!grouping.has(category)) {
      grouping.set(category, []);
    }
    grouping.get(category).push(topic);
  });
  return Array.from(grouping.entries());
}

// Shared by Account's right-pane help browser and the Dashboard's left-pane
// copy — same data-help-browser-* markup contract either way. Pinning (a
// pin toggle next to each topic, plus a "Pinned" section above the category
// list) is opt-in via getPinnedIds/onTogglePin: Account passes neither and
// gets none of that UI; the Dashboard passes both, backed by its own
// dashboardPinnedHelpTopics setting.
export async function initHelpBrowser({
  root = document,
  topicsUrl,
  pane = null, // {element, toggle} — expand this pane when a topic opens
  getPinnedIds = null, // () => string[]
  onTogglePin = null, // (topicId) => void
} = {}) {
  const elements = {
    search: root.querySelector("[data-help-browser-search]"),
    pinnedWrap: root.querySelector("[data-help-browser-pinned]"),
    list: root.querySelector("[data-help-browser-list]"),
    detail: root.querySelector("[data-help-browser-detail]"),
    back: root.querySelector("[data-help-browser-back]"),
    detailTitle: root.querySelector("[data-help-browser-detail-title]"),
    detailCategory: root.querySelector("[data-help-browser-detail-category]"),
    detailSummary: root.querySelector("[data-help-browser-detail-summary]"),
    detailList: root.querySelector("[data-help-browser-detail-list]"),
    detailPin: root.querySelector("[data-help-browser-detail-pin]"),
  };

  const pinningEnabled = typeof getPinnedIds === "function" && typeof onTogglePin === "function";

  let topicsList = [];
  let topicsById = new Map();
  let activeQuery = "";
  let activeTopicId = "";
  // Runtime-only (not persisted) EXPAND state, keyed by category name — every
  // section starts collapsed; a category only appears here once the user
  // deliberately opens it, and that survives a re-render (e.g. from typing a
  // search query) but not a page reload. "Pinned" gets its own flag since
  // it's not a category. Search overrides this rather than using it: any
  // category with a match while a query is active renders expanded
  // regardless of this set (see renderList) — the intent is "let me see what
  // I searched for," not "remember what I searched for last time."
  const expandedCategories = new Set();
  let pinnedExpanded = false;

  // One row+panel pair, shared by both the Pinned section and every category
  // section — same collapsible-toggle convention used throughout the suite
  // (see common/js/lib/collapsible.js and e.g. Loom's Recent Saves panel).
  function buildCollapsibleSection(title) {
    const wrapper = document.createElement("div");
    wrapper.className = "d-flex flex-column gap-1";
    const row = document.createElement("div");
    row.className = "d-flex align-items-center justify-content-between mt-2";
    const label = document.createElement("span");
    label.className = "text-uppercase small fw-semibold text-body-secondary";
    label.textContent = title;
    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "btn btn-outline-secondary btn-sm d-inline-flex align-items-center justify-content-center collapsible-toggle p-1";
    const icon = document.createElement("span");
    icon.className = "iconify";
    icon.setAttribute("aria-hidden", "true");
    const srLabel = document.createElement("span");
    srLabel.className = "visually-hidden";
    srLabel.textContent = `Toggle ${title}`;
    toggle.append(icon, srLabel);
    row.append(label, toggle);
    const panel = document.createElement("div");
    panel.className = "d-flex flex-column gap-1";
    wrapper.append(row, panel);
    return { wrapper, toggle, panel };
  }

  function buildTopicRow(topic, topicId) {
    const row = document.createElement("div");
    row.className = "d-flex align-items-center gap-1";
    const button = document.createElement("button");
    button.type = "button";
    button.className = "btn btn-link text-start p-1 text-decoration-none link-body-emphasis small flex-grow-1";
    button.textContent = topic.title;
    button.addEventListener("click", () => showTopic(topicId));
    row.appendChild(button);
    if (pinningEnabled) row.appendChild(buildPinButton(topicId));
    return row;
  }

  function isPinned(topicId) {
    return pinningEnabled && getPinnedIds().includes(topicId);
  }

  function buildPinButton(topicId) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "btn btn-link p-0 text-decoration-none flex-shrink-0";
    const pinned = isPinned(topicId);
    button.setAttribute("aria-label", pinned ? "Unpin topic" : "Pin topic for quick reference");
    const icon = document.createElement("span");
    icon.className = "iconify";
    icon.dataset.icon = pinned ? "tabler:pinned-filled" : "tabler:pin";
    icon.setAttribute("aria-hidden", "true");
    button.appendChild(icon);
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      onTogglePin(topicId);
      renderPinned();
      renderList(filterTopics(activeQuery));
      if (activeTopicId === topicId) syncDetailPinButton();
    });
    return button;
  }

  function renderPinned() {
    if (!elements.pinnedWrap || !pinningEnabled) return;
    const pinnedIds = getPinnedIds();
    elements.pinnedWrap.innerHTML = "";
    if (!pinnedIds.length) {
      elements.pinnedWrap.classList.add("d-none");
      return;
    }
    elements.pinnedWrap.classList.remove("d-none");
    const { wrapper, toggle, panel } = buildCollapsibleSection("Pinned");
    pinnedIds.forEach((topicId) => {
      const topic = topicsById.get(topicId);
      if (!topic) return;
      panel.appendChild(buildTopicRow(topic, topicId));
    });
    elements.pinnedWrap.appendChild(wrapper);
    bindCollapsibleToggle(toggle, panel, { collapsed: !pinnedExpanded });
    toggle.addEventListener("click", () => {
      pinnedExpanded = !panel.hidden;
    });
  }

  function renderList(topics) {
    if (!elements.list) return;
    elements.list.innerHTML = "";
    if (!topics.length) {
      const empty = document.createElement("p");
      empty.className = "text-body-secondary small mb-0";
      empty.textContent = "No matching topics.";
      elements.list.appendChild(empty);
      return;
    }
    // `topics` is already filtered to matches when activeQuery is set, so
    // every category reaching this loop only contains matching entries —
    // force those open rather than making a searcher click through
    // collapsed sections to see what matched.
    groupHelpTopicsByCategory(topics).forEach(([category, entries]) => {
      const { wrapper, toggle, panel } = buildCollapsibleSection(category);
      entries.forEach((topic) => panel.appendChild(buildTopicRow(topic, topic.id)));
      elements.list.appendChild(wrapper);
      const collapsed = activeQuery ? false : !expandedCategories.has(category);
      bindCollapsibleToggle(toggle, panel, { collapsed });
      toggle.addEventListener("click", () => {
        if (panel.hidden) expandedCategories.delete(category);
        else expandedCategories.add(category);
      });
    });
  }

  function syncDetailPinButton() {
    if (!elements.detailPin || !pinningEnabled) return;
    const pinned = isPinned(activeTopicId);
    const icon = elements.detailPin.querySelector(".iconify");
    if (icon) icon.dataset.icon = pinned ? "tabler:pinned-filled" : "tabler:pin";
    elements.detailPin.setAttribute("aria-label", pinned ? "Unpin topic" : "Pin topic for quick reference");
  }

  function showTopic(topicId) {
    const topic = topicsById.get(topicId);
    if (!topic) return;
    activeTopicId = topicId;
    if (elements.search) elements.search.classList.add("d-none");
    if (elements.pinnedWrap) elements.pinnedWrap.classList.add("d-none");
    if (elements.list) elements.list.classList.add("d-none");
    if (elements.detail) {
      elements.detail.classList.remove("d-none");
      elements.detail.classList.add("d-flex");
    }
    if (elements.detailTitle) elements.detailTitle.textContent = topic.title;
    if (elements.detailCategory) elements.detailCategory.textContent = topic.category;
    if (elements.detailSummary) elements.detailSummary.textContent = topic.summary;
    if (elements.detailList) {
      elements.detailList.innerHTML = "";
      (topic.details || []).forEach((line) => {
        const item = document.createElement("li");
        item.textContent = line;
        elements.detailList.appendChild(item);
      });
    }
    syncDetailPinButton();
    // Expanding here matters for the ?help=<id> deep link specifically — a
    // fresh page load may have this pane already collapsed, but jumping to a
    // topic should never leave it looking collapsed/empty.
    if (pane?.element) {
      expandPane(pane.element, pane.toggle);
    }
  }

  function hideDetail() {
    if (elements.detail) {
      elements.detail.classList.add("d-none");
      elements.detail.classList.remove("d-flex");
    }
    if (elements.list) elements.list.classList.remove("d-none");
    if (elements.search) elements.search.classList.remove("d-none");
    if (elements.pinnedWrap && pinningEnabled && getPinnedIds().length) {
      elements.pinnedWrap.classList.remove("d-none");
    }
    activeTopicId = "";
  }

  function filterTopics(query) {
    if (!query) return topicsList;
    return topicsList.filter(
      (topic) =>
        topic.title.toLowerCase().includes(query) ||
        topic.summary.toLowerCase().includes(query) ||
        topic.category.toLowerCase().includes(query)
    );
  }

  try {
    const { topics, map } = await loadHelpTopics(topicsUrl);
    topicsList = topics;
    topicsById = map;
  } catch (error) {
    if (elements.list) {
      elements.list.innerHTML = '<p class="text-danger small mb-0">Unable to load help topics.</p>';
    }
    return { showTopic() {}, refreshPinned() {} };
  }

  renderPinned();
  renderList(topicsList);

  if (elements.search) {
    elements.search.addEventListener("input", () => {
      activeQuery = elements.search.value.trim().toLowerCase();
      renderList(filterTopics(activeQuery));
    });
  }
  if (elements.back) {
    elements.back.addEventListener("click", hideDetail);
  }
  if (elements.detailPin && pinningEnabled) {
    elements.detailPin.addEventListener("click", () => {
      if (!activeTopicId) return;
      onTogglePin(activeTopicId);
      syncDetailPinButton();
      renderPinned();
    });
  }

  // ?help=<topicId> — how every OTHER tool's inline (?) help icons land here
  // (see common/js/lib/help.js's default href).
  const requestedTopic = new URLSearchParams(window.location.search).get("help");
  if (requestedTopic) {
    showTopic(requestedTopic);
  }

  return {
    showTopic,
    refreshPinned: renderPinned,
  };
}
