import { loadHelpTopics } from "./help.js";
import { createFavoriteStar, loadDocFavorites } from "./doc-favorites.js";
import { disposeTooltips, initTooltip, refreshTooltips } from "./tooltips.js";

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
}

// A topic's whole content, for the hover preview.
function topicPreviewHtml(topic) {
  const details = topic.details.length ? `<ul class="text-start ps-3 mb-0 mt-1">${topic.details.map((line) => `<li>${escapeHtml(line)}</li>`).join("")}</ul>` : "";
  return `<div class="text-start"><strong>${escapeHtml(topic.title)}</strong><div>${escapeHtml(topic.summary)}</div>${details}</div>`;
}

// The left-pane list of favorite documentation topics, shared by the
// Dashboard and the Account page. Each row links to the topic on the
// documentation page and previews its full content on hover.
export function initFavoriteDocsPane({ list, dataManager, topicsUrl, docsHref }) {
  if (!list) return;
  let favorites = null;
  let topics = [];

  async function render() {
    try {
      if (!favorites) {
        ({ topics } = await loadHelpTopics(topicsUrl));
        const loaded = await loadDocFavorites({ dataManager, topics });
        loaded.onChange(() => void render());
        favorites = loaded;
      }
    } catch (error) {
      list.textContent = "Unable to load favorites.";
      return;
    }
    disposeTooltips(list);
    list.replaceChildren();
    const mine = topics.filter((topic) => favorites.isFavorite(topic.id));
    if (!mine.length) {
      const empty = document.createElement("p");
      empty.className = "text-body-secondary small mb-0";
      empty.textContent = "No favorites yet. Star a topic on the documentation page to keep it here.";
      list.appendChild(empty);
      return;
    }
    mine.forEach((topic) => {
      const row = document.createElement("div");
      row.className = "d-flex align-items-center gap-1";
      const link = document.createElement("a");
      link.className = "link-body-emphasis text-decoration-none small flex-grow-1 py-1";
      link.href = `${docsHref}#${encodeURIComponent(topic.id)}`;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      link.textContent = topic.title;
      link.setAttribute("data-bs-custom-class", "doc-preview-tooltip");
      initTooltip(link, { title: topicPreviewHtml(topic), placement: "right", html: true });
      row.append(link, createFavoriteStar(favorites, topic.id));
      list.appendChild(row);
    });
    refreshTooltips(list);
  }

  // The signed-in tier decides which topics start as favorites.
  window.addEventListener("undercroft:auth-changed", () => {
    favorites = null;
    void render();
  });
  void render();
}
