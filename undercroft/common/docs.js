import { initAppShell, resolveToolContextPath, resolveToolLabel } from "./js/lib/app-shell.js";
import { DataManager } from "./js/lib/data-manager.js";
import { resolveApiBase } from "./js/lib/api.js";
import { initAuthControls } from "./js/lib/auth-ui.js";
import { loadHelpTopics } from "./js/lib/help.js";
import { createCollapsibleSection } from "./js/lib/ui-components.js";
import { disposeTooltips, refreshTooltips } from "./js/lib/tooltips.js";
import { createFavoriteStar, loadDocFavorites } from "./js/lib/doc-favorites.js";

// Same shell bootstrap every other page under common/ uses (account.js is
// the reference). Lives flat in common/ (not common/docs/), matching
// initAppShell's tool-context path math (resolveToolContextPath assumes
// every page sits exactly one level under the suite root).
const { status } = initAppShell({
  namespace: "docs",
  leftPaneLabel: "Toggle topics pane",
  leftPane: { size: "lg", initial: "expanded", phoneInitial: "expanded" },
  // docs.html is the one page in the suite with no right pane at all.
  rightPaneLabel: null,
  rightPane: null,
});
// No storagePrefix override — see dashboard.js's own comment on the same
// line: unifies this page's local record cache with the rest of the suite's
// default DataManager namespace, so a delete/save anywhere is visible everywhere.
const dataManager = new DataManager({ baseUrl: resolveApiBase() });
initAuthControls({ root: document, status, dataManager });

function slugify(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

// Resolves a topic's stored `href` into an absolute URL for the "Open in
// app" button — most topics point at another tool entirely, a few point
// back at this page. Base is spelled out explicitly rather than relying on
// document.baseURI so a <base> tag added later can't silently change this.
function resolveTopicUrl(href) {
  const base = `${window.location.origin}${window.location.pathname.replace(/[^/]*$/, "")}`;
  try {
    return new URL(href, base).toString();
  } catch (error) {
    console.warn("Unable to resolve topic href", href, error);
    return href;
  }
}

// Just the topic-count/last-updated badges — the catalog's free-text
// description lives in a separate paragraph (renderDescription below) since
// both sit in the left pane's fixed header.
function renderMetadata(root, metadata, topics) {
  if (!root) return;
  root.innerHTML = "";
  const pills = [`${topics.length} topic${topics.length === 1 ? "" : "s"}`];
  if (metadata?.lastUpdated) pills.push(`Last updated ${metadata.lastUpdated}`);
  pills.forEach((text) => {
    const pill = document.createElement("span");
    pill.className = "badge text-bg-secondary";
    pill.textContent = text;
    root.appendChild(pill);
  });
}

function renderDescription(root, metadata) {
  if (!root) return;
  root.textContent = metadata?.description || "";
}

// State both panes share: favorites, which groups are open, and the jump
// from a left-pane topic to its article in the center.
const view = {
  favorites: null,
  // Left-pane groups the user opened ("<key>") or closed ("closed:<key>").
  openCategories: new Set(),
  centerSetters: new Map(),
  query: "",
  grouped: [],
  renderToc: () => {},
};

// Splits one category's topics into [{section, topics}] in the order the
// catalog writes them; a category with no sections is a single unnamed group.
function groupBySection(topics) {
  const sections = [];
  topics.forEach((topic) => {
    let entry = sections.find((candidate) => candidate.section === topic.section);
    if (!entry) {
      entry = { section: topic.section, topics: [] };
      sections.push(entry);
    }
    entry.topics.push(topic);
  });
  return sections;
}

function buildSectionLabel(text) {
  const label = document.createElement("div");
  label.className = "small fw-semibold text-body-secondary mt-2";
  label.textContent = text;
  return label;
}

function topicMatches(topic, query) {
  if (!query) return true;
  return [topic.title, topic.summary, topic.category].some((text) => String(text || "").toLowerCase().includes(query));
}

function buildTopicLink(topic) {
  const row = document.createElement("div");
  row.className = "d-flex align-items-center gap-1";
  const link = document.createElement("a");
  link.className = "link-body-emphasis text-decoration-none small flex-grow-1 py-1";
  link.href = `#${topic.id}`;
  link.textContent = topic.title;
  link.addEventListener("click", (event) => {
    event.preventDefault();
    selectTopic(topic.id);
  });
  row.append(link, createFavoriteStar(view.favorites, topic.id));
  return row;
}

// One collapsible group in the left pane. A search forces matching groups
// open; otherwise the user's own open/closed choices survive a redraw.
function buildTocGroup(key, label, topics, { defaultOpen = false } = {}) {
  const open = Boolean(view.query) || view.openCategories.has(key) || (defaultOpen && !view.openCategories.has(`closed:${key}`));
  const { section, toggle, panel } = createCollapsibleSection({
    label,
    collapsed: !open,
    className: "d-flex flex-column gap-1",
    panelClassName: "d-flex flex-column gap-0 ps-2",
    headingClassName: "text-uppercase small fw-semibold text-body-secondary mb-0",
  });
  groupBySection(topics).forEach(({ section, topics: members }) => {
    if (section) panel.appendChild(buildSectionLabel(section));
    members.forEach((topic) => panel.appendChild(buildTopicLink(topic)));
  });
  toggle.addEventListener("click", () => {
    view.openCategories.delete(key);
    view.openCategories.delete(`closed:${key}`);
    view.openCategories.add(panel.hidden ? `closed:${key}` : key);
  });
  return section;
}

function buildTocList(tocRoot, groupedTopics) {
  if (!tocRoot) return;
  disposeTooltips(tocRoot);
  tocRoot.innerHTML = "";
  const favoriteTopics = groupedTopics
    .flatMap(({ topics }) => topics)
    .filter((topic) => view.favorites.isFavorite(topic.id) && topicMatches(topic, view.query));
  if (favoriteTopics.length) {
    tocRoot.appendChild(buildTocGroup("favorites", "Favorites", favoriteTopics, { defaultOpen: true }));
  }
  let shown = 0;
  groupedTopics.forEach(({ category, categoryId, topics }) => {
    const matching = topics.filter((topic) => topicMatches(topic, view.query));
    if (!matching.length) return;
    shown += matching.length;
    tocRoot.appendChild(buildTocGroup(categoryId, category, matching));
  });
  if (!shown) {
    const empty = document.createElement("p");
    empty.className = "text-body-secondary small mb-0";
    empty.textContent = "No matching topics.";
    tocRoot.appendChild(empty);
  }
  refreshTooltips(tocRoot);
}

// Opens the topic's group in the center pane and brings its article into view.
function selectTopic(topicId, { updateHash = true } = {}) {
  const article = document.getElementById(topicId);
  if (!article) return;
  const group = view.grouped.find(({ topics }) => topics.some((topic) => topic.id === topicId));
  if (group) {
    view.centerSetters.get(group.categoryId)?.(false);
    view.openCategories.delete(`closed:${group.categoryId}`);
    view.openCategories.add(group.categoryId);
    view.renderToc();
  }
  if (updateHash) history.replaceState(null, "", `#${topicId}`);
  article.scrollIntoView({ block: "start" });
}

function renderTopics(root, groupedTopics) {
  if (!root) return;
  root.innerHTML = "";
  view.centerSetters.clear();
  groupedTopics.forEach(({ category, categoryId, topics }) => {
    // Collapsed until a topic is picked on the left.
    const { section, panel, setCollapsed } = createCollapsibleSection({
      label: category,
      id: categoryId,
      collapsed: true,
      className: "d-flex flex-column gap-3",
      headingClassName: "h3 mb-0",
    });
    view.centerSetters.set(categoryId, setCollapsed);

    const items = groupBySection(topics).flatMap(({ section, topics: members }) => [
      ...(section ? [{ heading: section }] : []),
      ...members.map((member) => ({ topic: member })),
    ]);
    items.forEach((item) => {
      if (item.heading) {
        const heading = document.createElement("h4");
        heading.className = "h5 mb-0 mt-2 text-body-secondary";
        heading.textContent = item.heading;
        panel.appendChild(heading);
        return;
      }
      const topic = item.topic;
      const article = document.createElement("article");
      article.className = "d-flex flex-column gap-2 border rounded-3 p-3 bg-body";
      article.id = topic.id;
      // Leaves a little room above the title when a link scrolls here.
      article.style.scrollMarginTop = "1rem";
      const title = document.createElement("h3");
      title.className = "h4 mb-0 d-flex align-items-center gap-2";
      title.append(document.createTextNode(topic.title), createFavoriteStar(view.favorites, topic.id));
      const badge = document.createElement("span");
      badge.className = "badge text-bg-secondary";
      badge.textContent = topic.category;
      title.appendChild(badge);
      article.appendChild(title);
      if (topic.summary) {
        const summary = document.createElement("p");
        summary.className = "text-body-secondary mb-0";
        summary.textContent = topic.summary;
        article.appendChild(summary);
      }
      if (topic.details && topic.details.length) {
        const list = document.createElement("ul");
        list.className = "ps-3 mb-0";
        topic.details.forEach((detail) => {
          const item = document.createElement("li");
          item.className = "mb-1";
          item.textContent = detail;
          list.appendChild(item);
        });
        article.appendChild(list);
      }
      const footer = document.createElement("div");
      footer.className = "d-flex align-items-center justify-content-between flex-wrap gap-2 mt-2";
      const permalink = document.createElement("a");
      permalink.className = "link-primary text-decoration-none small";
      permalink.href = `#${topic.id}`;
      permalink.textContent = "Copy link";
      permalink.addEventListener("click", (event) => {
        event.preventDefault();
        const url = new URL(window.location.href);
        url.hash = topic.id;
        navigator.clipboard?.writeText?.(url.toString()).catch(() => {
          // fallback: update hash so the browser copies on share
          window.location.hash = topic.id;
        });
      });
      footer.appendChild(permalink);
      if (topic.href) {
        const destination = resolveTopicUrl(topic.href);
        const toolLabel = resolveToolLabel(resolveToolContextPath(new URL(destination).pathname));
        const seeAlso = document.createElement("a");
        seeAlso.className = "btn btn-sm btn-outline-primary";
        seeAlso.href = destination;
        seeAlso.target = "_blank";
        seeAlso.rel = "noopener noreferrer";
        seeAlso.textContent = toolLabel ? `Open in ${toolLabel}` : "Open";
        footer.appendChild(seeAlso);
      }
      article.appendChild(footer);
      panel.appendChild(article);
    });
    root.appendChild(section);
  });
}

function groupTopicsByCategory(topics) {
  const grouping = new Map();
  topics.forEach((topic) => {
    const category = topic.category || "General";
    if (!grouping.has(category)) {
      grouping.set(category, []);
    }
    grouping.get(category).push(topic);
  });
  return Array.from(grouping.entries()).map(([category, items]) => ({
    category,
    categoryId: `category-${slugify(category)}`,
    topics: items,
  }));
}

(async () => {
  const tocRoot = document.querySelector("[data-docs-toc]");
  const contentRoot = document.querySelector("[data-docs-root]");
  const metaRoot = document.querySelector("[data-docs-metadata]");
  const descriptionRoot = document.querySelector("[data-docs-description]");
  const searchInput = document.querySelector("[data-docs-search]");
  try {
    const { topics, raw } = await loadHelpTopics("data/help-topics.json");
    renderMetadata(metaRoot, raw?.metadata || {}, topics);
    renderDescription(descriptionRoot, raw?.metadata || {});
    if (!topics.length) {
      if (contentRoot) {
        contentRoot.innerHTML = "";
        const empty = document.createElement("p");
        empty.className = "text-body-secondary mb-0";
        empty.textContent = "No help topics have been published yet.";
        contentRoot.appendChild(empty);
      }
      if (tocRoot) tocRoot.innerHTML = "";
      return;
    }
    view.favorites = await loadDocFavorites({ dataManager, topics });
    view.grouped = groupTopicsByCategory(topics);
    view.renderToc = () => buildTocList(tocRoot, view.grouped);
    view.favorites.onChange(view.renderToc);
    searchInput?.addEventListener("input", () => {
      view.query = searchInput.value.trim().toLowerCase();
      view.renderToc();
    });
    view.renderToc();
    renderTopics(contentRoot, view.grouped);
    // The browser's own hash scroll already ran, before the topics existed.
    const openFromHash = () => {
      const id = decodeURIComponent(window.location.hash.slice(1));
      if (id) selectTopic(id, { updateHash: false });
    };
    openFromHash();
    window.addEventListener("hashchange", openFromHash);
    window.addEventListener("undercroft:show-help-topic", (event) => {
      if (event.detail?.topicId) selectTopic(event.detail.topicId);
    });
  } catch (error) {
    console.error("Failed to render documentation", error);
    if (contentRoot) {
      contentRoot.innerHTML = "";
      const message = document.createElement("div");
      message.className = "alert alert-danger mb-0";
      message.textContent = "We could not load the help catalog. Check the browser console for details.";
      contentRoot.appendChild(message);
    }
    if (tocRoot) {
      tocRoot.innerHTML = "";
      const item = document.createElement("p");
      item.className = "text-body-secondary small mb-0";
      item.textContent = "Unable to load topics";
      tocRoot.appendChild(item);
    }
  }
})();
