import { refreshTooltips } from "./tooltips.js";
import { resolveDocsHref, resolveToolContextPath } from "./app-shell.js";

// Module-relative, so it resolves the same from every page.
const DEFAULT_TOPICS_URL = new URL("../../data/help-topics.json", import.meta.url).href;

let cachedTopicsPromise = null;
let cachedTopicsUrl = "";

function normaliseTopic(rawTopic) {
  if (!rawTopic || typeof rawTopic !== "object") {
    return null;
  }
  const id = typeof rawTopic.id === "string" ? rawTopic.id.trim() : "";
  if (!id) {
    return null;
  }
  const title = typeof rawTopic.title === "string" ? rawTopic.title.trim() : id;
  const summary = typeof rawTopic.summary === "string" ? rawTopic.summary.trim() : title;
  const category = typeof rawTopic.category === "string" ? rawTopic.category.trim() : "General";
  // Optional sub-heading within a category ("" when the category isn't divided).
  const section = typeof rawTopic.section === "string" ? rawTopic.section.trim() : "";
  // "" when absent — a topic with no real page behind it (a general concept,
  // not tied to one tool) has no "Open in" destination, never a fabricated one.
  const href = typeof rawTopic.href === "string" ? rawTopic.href.trim() : "";
  const details = Array.isArray(rawTopic.details)
    ? rawTopic.details.filter((line) => typeof line === "string" && line.trim()).map((line) => line.trim())
    : [];
  return {
    ...rawTopic,
    id,
    title,
    summary,
    category,
    section,
    href,
    details,
  };
}

function normaliseTopicsPayload(payload) {
  const topics = [];
  const map = new Map();
  if (payload && Array.isArray(payload.topics)) {
    payload.topics.forEach((topic) => {
      const normalised = normaliseTopic(topic);
      if (!normalised) {
        return;
      }
      topics.push(normalised);
      map.set(normalised.id, normalised);
    });
  }
  // Categories follow the catalog's own `metadata.categories` order; inside a
  // category topics keep the order they are written in, so sections stay together.
  const categoryOrder = Array.isArray(payload?.metadata?.categories) ? payload.metadata.categories : [];
  const rank = (category) => {
    const index = categoryOrder.indexOf(category);
    return index === -1 ? categoryOrder.length : index;
  };
  const written = new Map(topics.map((topic, index) => [topic, index]));
  topics.sort((a, b) => {
    if (a.category === b.category) {
      return written.get(a) - written.get(b);
    }
    return rank(a.category) - rank(b.category) || a.category.localeCompare(b.category);
  });
  return { topics, map, raw: payload || { topics: [] } };
}

export async function loadHelpTopics(topicsUrl = DEFAULT_TOPICS_URL) {
  // Keyed on the resolved URL so the header search and a page's own help
  // system, which spell the same file differently, share one fetch.
  const resolvedUrl = new URL(topicsUrl, document.baseURI).href;
  if (!cachedTopicsPromise || resolvedUrl !== cachedTopicsUrl) {
    cachedTopicsUrl = resolvedUrl;
    cachedTopicsPromise = fetch(resolvedUrl)
      .then((response) => {
        if (!response.ok) {
          throw new Error(`Failed to load help topics: ${response.status}`);
        }
        return response.json();
      })
      .then((payload) => normaliseTopicsPayload(payload))
      .catch((error) => {
        console.warn("Help topics could not be loaded", error);
        return normaliseTopicsPayload({ topics: [] });
      });
  }
  return cachedTopicsPromise;
}

// Every topic's own stored `href` (help-topics.json) points at destinations
// that don't reliably exist across tools, so this ignores it entirely and
// always builds a fresh link to the documentation page, which opens the
// topic from the URL hash — the one destination guaranteed to exist and work
// from every tool.
function resolveHelpTopicHref(topic) {
  return `${resolveDocsHref(resolveToolContextPath())}#${encodeURIComponent(topic.id)}`;
}

// Already on the documentation page: jump to the topic there instead of
// opening a redundant second tab pointed at itself.
function openHelpTopic(topic) {
  if (document.body.dataset.undercroftTool === "docs") {
    window.dispatchEvent(new CustomEvent("undercroft:show-help-topic", { detail: { topicId: topic.id } }));
    return;
  }
  window.open(resolveHelpTopicHref(topic), "_blank", "noopener,noreferrer");
}

function createTriggerElement(topic, { icon, placement, classes, variant } = {}) {
  const trigger = document.createElement("button");
  trigger.type = "button";
  trigger.className = [
    "btn",
    variant === "ghost" ? "btn-link" : "btn-outline-secondary",
    "p-0",
    "help-topic-trigger",
  ]
    .concat(Array.isArray(classes) ? classes : [])
    .filter(Boolean)
    .join(" ");
  trigger.dataset.helpTopicTrigger = topic.id;
  trigger.dataset.bsToggle = "tooltip";
  trigger.dataset.bsPlacement = placement || "top";
  trigger.dataset.bsTitle = topic.summary;
  trigger.setAttribute("aria-label", `Help: ${topic.title}`);
  const iconElement = document.createElement("span");
  iconElement.className = "iconify";
  iconElement.dataset.icon = icon || "tabler:help";
  iconElement.setAttribute("aria-hidden", "true");
  trigger.appendChild(iconElement);
  trigger.addEventListener("click", (event) => {
    event.preventDefault();
    openHelpTopic(topic);
  });
  return trigger;
}

function insertTrigger(target, trigger, { position } = {}) {
  const mode = position || target.getAttribute("data-help-insert") || "after";
  if (mode === "append") {
    target.appendChild(trigger);
    return;
  }
  if (mode === "before") {
    target.insertAdjacentElement("beforebegin", trigger);
    return;
  }
  if (mode === "replace") {
    target.innerHTML = "";
    target.appendChild(trigger);
    return;
  }
  target.insertAdjacentElement("afterend", trigger);
}

export async function initHelpSystem({ root = document, topicsUrl = DEFAULT_TOPICS_URL } = {}) {
  const { map } = await loadHelpTopics(topicsUrl);
  if (!root) {
    return;
  }
  const targets = root.querySelectorAll("[data-help-topic]");
  targets.forEach((element) => {
    const topicId = element.getAttribute("data-help-topic");
    if (!topicId) {
      return;
    }
    const trimmedId = topicId.trim();
    if (!trimmedId || element.dataset.helpTopicAttached === "true") {
      return;
    }
    const topic = map.get(trimmedId);
    if (!topic) {
      console.warn(`Missing help topic: ${trimmedId}`);
      return;
    }
    const placement = element.getAttribute("data-help-placement") || undefined;
    const icon = element.getAttribute("data-help-icon") || undefined;
    const variant = element.getAttribute("data-help-variant") || "ghost";
    const classes = (element.getAttribute("data-help-classes") || "")
      .split(" ")
      .map((value) => value.trim())
      .filter(Boolean);
    const trigger = createTriggerElement(topic, { icon, placement, classes, variant });
    insertTrigger(element, trigger, { position: element.getAttribute("data-help-insert") || undefined });
    element.dataset.helpTopicAttached = "true";
  });
  refreshTooltips(root);
}
