// Puts the server's environment label (DEV, UAT, ...) after the page title so tabs for different
// servers can be told apart. The last label is remembered for the tab so the title is right before the fetch returns.
import { loadSiteInfo } from "./site-info.js";

const CACHE_KEY = "undercroft.environment";

function remembered() {
  try {
    return window.sessionStorage.getItem(CACHE_KEY) || "";
  } catch (error) {
    return "";
  }
}

export function initEnvironmentTitle() {
  let label = remembered();
  const title = document.querySelector("title");
  if (!title) return;
  const apply = () => {
    const suffix = label ? ` [${label}]` : "";
    const bare = document.title.replace(/ \[[^\]]+\]$/, "");
    if (document.title !== `${bare}${suffix}`) document.title = `${bare}${suffix}`;
  };
  // Pages that change their own title (a flashing alert, a second screen) keep the label.
  new MutationObserver(apply).observe(title, { childList: true });
  apply();
  loadSiteInfo()
    .then((info) => {
      if (info.environmentLabel === null) return;
      label = info.environmentLabel;
      try {
        window.sessionStorage.setItem(CACHE_KEY, label);
      } catch (error) {
        // the label still applies for this page
      }
      apply();
    })
    .catch(() => {});
}
