// One recruitment listing, as a card. Used by Find a Game and by Loom's
// Recruitment preview.
import { el } from "../dom.js";
import { describeDuration, describeRecurrence, formatSessionRange } from "../sessions/format.js";
import { closenessText } from "./scale-control.js";
import { optionLabel, systemTitle } from "./reference.js";

function badge(text, className = "text-bg-secondary") {
  return el("span", `badge ${className}`, text);
}

function scheduleLines(listing) {
  return (listing.schedule || []).map((series) => {
    const next = series.nextSlot ? formatSessionRange(series.nextSlot, null, { kind: series.kind }) : "No upcoming date";
    const repeat = describeRecurrence(series.recurrence);
    return `${series.title}: ${repeat} · ${describeDuration(series.durationMinutes)} · next ${next}`;
  });
}

// `mineScales` (the viewer's own profile scales) adds the "close on N of M" line.
export function renderListingCard(listing, { reference, systems = [], mineScales = null, onSelect, selected = false } = {}) {
  const card = el("div", `card shadow-theme${selected ? " border-primary" : ""}`);
  const body = el("div", "card-body d-flex flex-column gap-2");
  const head = el("div", "d-flex flex-wrap align-items-center gap-2");
  head.appendChild(badge(listing.targetKind === "campaign" ? "Campaign" : "Session", "text-bg-primary"));
  head.appendChild(el("span", "fw-semibold", listing.systemId ? systemTitle(systems, listing.systemId) : listing.systemName));
  if (listing.campaignName) head.appendChild(el("span", "text-body-secondary small", listing.campaignName));
  const seats = el("span", "ms-auto small", listing.status === "open" ? `${listing.openSeats} of ${listing.seatsOffered} seats open` : listing.status);
  head.appendChild(seats);
  body.appendChild(head);
  if (listing.gm) body.appendChild(el("div", "small text-body-secondary", `Run by ${listing.gm.username} · ${listing.groupName}`));
  scheduleLines(listing).forEach((line) => body.appendChild(el("div", "small", line)));
  const facts = [
    listing.sessionLength && optionLabel(reference.options, "sessionLength", listing.sessionLength),
    listing.ageRange && optionLabel(reference.options, "ageRange", listing.ageRange),
    listing.platform && optionLabel(reference.options, "platform", listing.platform),
  ].filter(Boolean);
  if (facts.length) body.appendChild(el("div", "small text-body-secondary", facts.join(" · ")));
  const tags = el("div", "d-flex flex-wrap gap-1");
  listing.tags.forEach((tag) => tags.appendChild(badge(tag)));
  listing.safetyTools.forEach((id) => {
    const tool = reference.safetyTools.find((entry) => entry.id === id);
    if (tool) tags.appendChild(badge(tool.name, "text-bg-info"));
  });
  if (tags.childElementCount) body.appendChild(tags);
  if (mineScales && Object.keys(mineScales).length) {
    body.appendChild(el("div", "small text-body-secondary", closenessText(mineScales, listing.scales)));
  }
  card.appendChild(body);
  if (onSelect) {
    card.style.cursor = "pointer";
    card.addEventListener("click", () => onSelect(listing));
  }
  return card;
}
