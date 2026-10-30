// A person's observed signals, shown side by side and never combined. Each metric is a
// row with its value for the last year and for all time; every rate carries its
// denominator, and below the minimum sample only the count is shown.
import { el } from "../dom.js";
import { initHelpSystem } from "../help.js";
import { helpBadge } from "./help-badge.js";
import { systemTitle } from "./reference.js";

function plural(count, word) {
  return `${count} ${word}${count === 1 ? "" : "s"}`;
}

// A rate is its percentage over its denominator ("6%" above "18 sessions"); below the
// minimum sample only the count is shown.
function rateCell(rate, noun) {
  if (!rate) return "—";
  if (rate.belowMinimum) return { main: String(rate.count), sub: `${noun}${rate.count === 1 ? "" : "s"}` };
  return { main: `${Math.round(rate.value * 100)}%`, sub: plural(rate.denominator, noun) };
}

const LABEL_CLASS = "small text-body-secondary";
const VALUE_CLASS = "small text-end";

// A grid whose three columns (metric, last year, all time) line up across every row.
function metricGrid() {
  const grid = el("div", "d-grid align-items-baseline");
  grid.style.gridTemplateColumns = "minmax(0, 1.3fr) minmax(0, 1fr) minmax(0, 1fr)";
  grid.style.columnGap = "0.5rem";
  grid.style.rowGap = "0.35rem";
  return grid;
}

function valueCell(value) {
  const cell = el("div", VALUE_CLASS);
  if (typeof value === "string") {
    cell.textContent = value;
  } else {
    cell.appendChild(el("div", "", value.main));
    cell.appendChild(el("div", "text-body-secondary", value.sub));
  }
  return cell;
}

function addRow(grid, label, recent, lifetime, { indent = false } = {}) {
  const name = el("span", LABEL_CLASS, label);
  if (indent) name.style.paddingLeft = "0.75rem";
  grid.append(name, valueCell(recent), valueCell(lifetime));
}

function addHeader(grid) {
  grid.append(el("span"), el("span", "small fw-semibold text-end", "Last year"), el("span", "small fw-semibold text-end", "All time"));
}

function systemCounts(part) {
  return new Map(part.bySystem.map((entry) => [entry.systemId, entry.count]));
}

function roleSection(title, role, data, systems) {
  const section = el("div", "d-flex flex-column gap-2");
  const heading = el("div", "text-uppercase fs-6 fw-semibold text-body-secondary", title);
  heading.appendChild(helpBadge("community.signals"));
  section.appendChild(heading);
  const grid = metricGrid();
  addHeader(grid);
  const recent = data.recent[role];
  const lifetime = data.lifetime[role];
  addRow(grid, role === "gm" ? "Sessions run" : "Sessions played", String(recent.sessionCount), String(lifetime.sessionCount));
  const recentSystems = systemCounts(recent);
  lifetime.bySystem.slice(0, 5).forEach((entry) => {
    addRow(
      grid,
      entry.systemId ? systemTitle(systems, entry.systemId) : "Unspecified system",
      recentSystems.has(entry.systemId) ? String(recentSystems.get(entry.systemId)) : "—",
      String(entry.count),
      { indent: true },
    );
  });
  if (role === "player") {
    addRow(grid, "No-show rate", rateCell(recent.reliability, "session"), rateCell(lifetime.reliability, "session"));
    if (recent.reliability.contested || lifetime.reliability.contested) {
      addRow(grid, "Contested no-shows", String(recent.reliability.contested), String(lifetime.reliability.contested));
    }
  } else {
    addRow(grid, "Cancellation rate", rateCell(recent.reliability, "date"), rateCell(lifetime.reliability, "date"));
    addRow(grid, "Late cancellations", String(recent.reliability.lateCancellations), String(lifetime.reliability.lateCancellations));
    const reschedules = (period) => `${period.reliability.lateReschedules} of ${period.reliability.reschedules}`;
    addRow(grid, "Late reschedules", reschedules(recent), reschedules(lifetime));
  }
  const retentionNoun = role === "gm" ? "player" : "campaign";
  addRow(grid, "Retention", rateCell(recent.retention, retentionNoun), rateCell(lifetime.retention, retentionNoun));
  section.appendChild(grid);
  return section;
}

function endorsementsSection(data) {
  const section = el("div", "d-flex flex-column gap-2");
  const title = el("div", "text-uppercase fs-6 fw-semibold text-body-secondary", "Endorsements");
  title.appendChild(helpBadge("community.endorsements"));
  section.appendChild(title);
  let any = false;
  [["player", "As a player"], ["gm", "As a GM"]].forEach(([role, label]) => {
    const list = data.endorsements[role];
    if (!list.length) return;
    any = true;
    const block = el("div", "d-flex flex-column gap-1");
    block.appendChild(el("span", LABEL_CLASS, label));
    const badges = el("div", "d-flex flex-wrap gap-1");
    list.forEach((entry) => badges.appendChild(el("span", "badge text-bg-secondary", `${entry.name} · ${entry.count}`)));
    block.appendChild(badges);
    section.appendChild(block);
  });
  if (!any) section.appendChild(el("span", "text-body-secondary small", "No endorsements yet"));
  return section;
}

// Loads and renders signals for one person into `container`. Resolves quietly
// to a "Private profile" note when the server says the viewer can't see them.
export async function renderTrustProfile(container, { dataManager, userId, systems = [], heading = true } = {}) {
  container.replaceChildren(el("div", "text-body-secondary small", "Loading…"));
  let data;
  try {
    data = await dataManager.getCommunitySignals(userId);
  } catch (error) {
    container.replaceChildren(el("div", "text-body-secondary small", "Private profile"));
    return;
  }
  const root = el("div", "d-flex flex-column gap-3");
  const tenure = data.tenure.lessThanOneYear ? "Less than 1 year on Undercroft" : `${plural(data.tenure.years, "year")} on Undercroft`;
  const top = el("div", "d-flex flex-wrap align-items-baseline justify-content-between gap-2");
  if (heading) top.appendChild(el("span", "fw-semibold", data.username));
  const tenureText = el("span", "text-body-secondary small", tenure);
  tenureText.appendChild(helpBadge("community.tenure"));
  top.appendChild(tenureText);
  root.append(top, roleSection("As a player", "player", data, systems), roleSection("As a GM", "gm", data, systems), endorsementsSection(data));
  container.replaceChildren(root);
  void initHelpSystem({ root: container });
}
