import { roleRank } from "./data-manager.js";
import { updateTooltipContent } from "./tooltips.js";

const SETTINGS_KEY = "docFavorites";
const LOCAL_KEY = "undercroft:doc-favorites";

function readLocal() {
  try {
    return JSON.parse(localStorage.getItem(LOCAL_KEY) || "null");
  } catch (error) {
    return null;
  }
}

function writeLocal(value) {
  try {
    localStorage.setItem(LOCAL_KEY, JSON.stringify(value));
  } catch (error) {
    // Unavailable storage still leaves the server copy when signed in.
  }
}

const idList = (value) => (Array.isArray(value) ? value.filter((id) => typeof id === "string") : []);

// A user's favorite documentation topics. A topic can carry `favoriteTier` in
// the help catalog, which favorites it for everyone at that tier or above;
// what the user adds or removes is stored on top of that, per account (and in
// this browser when signed out).
export async function loadDocFavorites({ dataManager, topics }) {
  const user = dataManager.session?.user || null;
  let saved = null;
  if (dataManager.isAuthenticated()) {
    try {
      saved = (await dataManager.getUserSettings())?.[SETTINGS_KEY] || null;
    } catch (error) {
      saved = null;
    }
  }
  saved = saved || readLocal() || {};
  const added = new Set(idList(saved.added));
  const removed = new Set(idList(saved.removed));
  const listeners = new Set();
  const known = new Set(topics.map((topic) => topic.id));

  const automatic = (topic) => Boolean(topic.favoriteTier) && Boolean(user) && roleRank(user.tier) >= roleRank(topic.favoriteTier);
  const isFavorite = (id) => {
    const topic = topics.find((entry) => entry.id === id);
    if (!topic) return false;
    return added.has(id) || (automatic(topic) && !removed.has(id));
  };

  function persist() {
    const value = { added: [...added], removed: [...removed] };
    writeLocal(value);
    if (dataManager.isAuthenticated()) {
      dataManager.saveUserSettings({ [SETTINGS_KEY]: value }).catch(() => {});
    }
  }

  return {
    isFavorite,
    ids: () => topics.filter((topic) => isFavorite(topic.id)).map((topic) => topic.id),
    toggle(id) {
      if (!known.has(id)) return;
      const topic = topics.find((entry) => entry.id === id);
      if (isFavorite(id)) {
        added.delete(id);
        if (automatic(topic)) removed.add(id);
      } else {
        removed.delete(id);
        if (!automatic(topic)) added.add(id);
      }
      persist();
      listeners.forEach((listener) => listener());
    },
    onChange(listener) {
      listeners.add(listener);
    },
  };
}

// A star button for a topic row or heading; `favorites.onChange` repaints it.
export function createFavoriteStar(favorites, topicId, { className = "" } = {}) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = `btn btn-link p-0 text-decoration-none flex-shrink-0 ${className}`.trim();
  button.setAttribute("data-bs-toggle", "tooltip");
  const paint = () => {
    const on = favorites.isFavorite(topicId);
    // A fresh span each time: Iconify has already swapped the old one for an svg.
    const icon = document.createElement("span");
    icon.className = `iconify${on ? " text-warning" : ""}`;
    icon.dataset.icon = on ? "tabler:star-filled" : "tabler:star";
    icon.setAttribute("aria-hidden", "true");
    button.replaceChildren(icon);
    const label = on ? "Remove from favorites" : "Add to favorites";
    button.setAttribute("aria-label", label);
    button.setAttribute("aria-pressed", on ? "true" : "false");
    button.setAttribute("data-bs-title", label);
    updateTooltipContent(button, label);
  };
  paint();
  button.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    favorites.toggle(topicId);
  });
  // Stars from an earlier render are detached; leave them alone.
  favorites.onChange(() => {
    if (button.isConnected) paint();
  });
  return button;
}
