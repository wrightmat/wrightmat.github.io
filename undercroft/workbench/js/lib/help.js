import { refreshTooltips } from "./tooltips.js";

const DEFAULT_TOPICS_URL = "data/help-topics.json";

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
  const href = typeof rawTopic.href === "string" && rawTopic.href.trim() ? rawTopic.href.trim() : `docs/index.html#${id}`;
  const details = Array.isArray(rawTopic.details)
    ? rawTopic.details.filter((line) => typeof line === "string" && line.trim()).map((line) => line.trim())
    : [];
  return {
    ...rawTopic,
    id,
    title,
    summary,
    category,
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
  topics.sort((a, b) => {
    if (a.category === b.category) {
      return a.title.localeCompare(b.title);
    }
    return a.category.localeCompare(b.category);
  });
  return { topics, map, raw: payload || { topics: [] } };
}

export async function loadHelpTopics(topicsUrl = DEFAULT_TOPICS_URL) {
  if (!cachedTopicsPromise || topicsUrl !== cachedTopicsUrl) {
    cachedTopicsUrl = topicsUrl;
    cachedTopicsPromise = fetch(topicsUrl)
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
    window.open(topic.href, "_blank", "noopener,noreferrer");
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
  if (typeof root.querySelectorAll === "function") {
    const headerDocs = root.querySelectorAll(
      ".workbench-header .help-topic-trigger, .workbench-header [data-docs-link], .workbench-header [data-help-topic]"
    );
    headerDocs.forEach((element) => {
      const node = /** @type {HTMLElement} */ (element);
      if (node.classList.contains("help-topic-trigger")) {
        node.remove();
        return;
      }
      const tag = node.tagName;
      if (tag === "BUTTON" || tag === "A") {
        node.remove();
        return;
      }
      node.removeAttribute("data-help-topic");
      if (!node.textContent?.trim() && !node.children.length) {
        node.remove();
      }
    });
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
    if (element.closest(".workbench-header")) {
      element.dataset.helpTopicAttached = "true";
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
