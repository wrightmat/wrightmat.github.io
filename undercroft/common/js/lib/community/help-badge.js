// The "?" badge for a help topic. Badges are inert until initHelpSystem runs
// over the container they were placed in.
import { el } from "../dom.js";

export function helpBadge(topic) {
  const badge = el("span", "align-middle");
  badge.dataset.helpTopic = topic;
  badge.dataset.helpInsert = "replace";
  return badge;
}
