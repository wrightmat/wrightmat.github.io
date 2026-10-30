// What the server says about the site it serves: the environment label and the feedback address. One request per page.
import { apiUrl } from "./api.js";

let infoPromise = null;

export function loadSiteInfo() {
  if (!infoPromise) {
    infoPromise = fetch(apiUrl("/site"))
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => ({
        environmentLabel: typeof data?.environmentLabel === "string" ? data.environmentLabel : null,
        feedbackUrl: typeof data?.feedbackUrl === "string" ? data.feedbackUrl : "",
      }))
      .catch(() => ({ environmentLabel: null, feedbackUrl: "" }));
  }
  return infoPromise;
}
