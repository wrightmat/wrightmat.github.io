import { initAppShell } from "./js/lib/app-shell.js";
import { DataManager } from "./js/lib/data-manager.js";
import { resolveApiBase } from "./js/lib/api.js";
import { initAuthControls } from "./js/lib/auth-ui.js";
import { loadHelpTopics } from "./js/lib/help.js";

// Same shell bootstrap every other page under common/ uses (account.js is
// the reference). Lives flat in common/ (not common/docs/), matching
// initAppShell's tool-context path math (resolveToolContextPath assumes
// every page sits exactly one level under the suite root).
const { status } = initAppShell({
  namespace: "docs",
  leftPaneLabel: "Toggle topics pane",
  leftPane: { size: "lg", initial: "expanded" },
  // docs.html is the one page in the suite with no right pane at all.
  rightPaneLabel: null,
  rightPane: null,
});
const dataManager = new DataManager({ baseUrl: resolveApiBase(), storagePrefix: "undercroft.workbench" });
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

// Just the topic-count/last-updated/version badges — the catalog's
// free-text description lives in a separate paragraph (renderDescription
// below) since both sit in the left pane's fixed header.
function renderMetadata(root, metadata, topics) {
  if (!root) return;
  root.innerHTML = "";
  const topicCount = document.createElement("span");
  topicCount.className = "badge text-bg-secondary";
  topicCount.textContent = `${topics.length} topic${topics.length === 1 ? "" : "s"}`;
  root.appendChild(topicCount);
  if (metadata?.lastUpdated) {
    const pill = document.createElement("span");
    pill.className = "badge text-bg-light text-body";
    pill.textContent = `Last updated ${metadata.lastUpdated}`;
    root.appendChild(pill);
  }
  if (metadata?.version) {
    const pill = document.createElement("span");
    pill.className = "badge text-bg-light text-body";
    pill.textContent = `Catalog v${metadata.version}`;
    root.appendChild(pill);
  }
}

function renderDescription(root, metadata) {
  if (!root) return;
  root.textContent = metadata?.description || "";
}

function buildTocList(tocRoot, groupedTopics) {
  if (!tocRoot) return;
  tocRoot.innerHTML = "";
  groupedTopics.forEach(({ category, categoryId, topics }) => {
    const item = document.createElement("li");
    const link = document.createElement("a");
    link.className = "link-body-emphasis text-decoration-none fw-semibold";
    link.href = `#${categoryId}`;
    link.textContent = category;
    item.appendChild(link);
    if (topics.length) {
      const innerList = document.createElement("ul");
      innerList.className = "list-unstyled ps-3 mt-2 d-flex flex-column gap-1";
      topics.forEach((topic) => {
        const topicItem = document.createElement("li");
        const topicLink = document.createElement("a");
        topicLink.className = "link-body-secondary text-decoration-none";
        topicLink.href = `#${topic.id}`;
        topicLink.textContent = topic.title;
        topicItem.appendChild(topicLink);
        innerList.appendChild(topicItem);
      });
      item.appendChild(innerList);
    }
    tocRoot.appendChild(item);
  });
}

function renderTopics(root, groupedTopics) {
  if (!root) return;
  root.innerHTML = "";
  groupedTopics.forEach(({ category, categoryId, topics }) => {
    const section = document.createElement("section");
    section.className = "d-flex flex-column gap-3";
    section.id = categoryId;

    const heading = document.createElement("h2");
    heading.className = "h3 mb-0";
    heading.textContent = category;
    section.appendChild(heading);

    topics.forEach((topic) => {
      const article = document.createElement("article");
      article.className = "d-flex flex-column gap-2 border rounded-3 p-3 bg-body";
      article.id = topic.id;
      const title = document.createElement("h3");
      title.className = "h4 mb-0 d-flex align-items-center gap-2";
      title.textContent = topic.title;
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
      const seeAlso = document.createElement("a");
      seeAlso.className = "btn btn-sm btn-outline-primary";
      seeAlso.href = resolveTopicUrl(topic.href);
      seeAlso.target = "_blank";
      seeAlso.rel = "noopener noreferrer";
      seeAlso.textContent = "Open in app";
      footer.appendChild(seeAlso);
      article.appendChild(footer);
      section.appendChild(article);
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
  try {
    const { topics, raw } = await loadHelpTopics("data/help-topics.json");
    if (!topics.length) {
      if (contentRoot) {
        contentRoot.innerHTML = "";
        const empty = document.createElement("p");
        empty.className = "text-body-secondary mb-0";
        empty.textContent = "No help topics have been published yet.";
        contentRoot.appendChild(empty);
      }
      renderMetadata(metaRoot, raw?.metadata || {}, topics);
      renderDescription(descriptionRoot, raw?.metadata || {});
      buildTocList(tocRoot, []);
      return;
    }
    const grouped = groupTopicsByCategory(topics);
    renderMetadata(metaRoot, raw?.metadata || {}, topics);
    renderDescription(descriptionRoot, raw?.metadata || {});
    buildTocList(tocRoot, grouped);
    renderTopics(contentRoot, grouped);
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
      const item = document.createElement("li");
      item.className = "text-body-secondary";
      item.textContent = "Unable to load topics";
      tocRoot.appendChild(item);
    }
  }
})();
