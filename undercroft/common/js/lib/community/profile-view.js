// A community profile as others see it (also the "see how others see me" preview).
import { el } from "../dom.js";
import { optionLabel, systemTitle } from "./reference.js";
import { renderScaleComparison } from "./scale-control.js";

function line(label, value) {
  if (!value) return null;
  const row = el("div", "d-flex justify-content-between gap-3 small");
  row.append(el("span", "text-body-secondary", label), el("span", "text-end", value));
  return row;
}

function availabilityText(availability, reference) {
  const days = reference.options.weekdays;
  const parts = reference.options.dayParts;
  return days
    .filter((day) => availability?.[day.id]?.length)
    .map((day) => `${day.label.slice(0, 3)} ${availability[day.id].map((id) => optionLabel({ dayParts: parts }, "dayParts", id).toLowerCase()).join("/")}`)
    .join(", ");
}

// `person` is the server's { userId, username, profile } view; `mineScales` adds a
// side-by-side track for the viewer's own preferences.
export function renderProfileView(person, { reference, systems = [], mineScales = null } = {}) {
  const root = el("div", "d-flex flex-column gap-3");
  const profile = person.profile;
  root.appendChild(el("div", "fw-semibold", person.username));
  if (!profile) {
    root.appendChild(el("div", "text-body-secondary small", "This person hasn't shared a profile."));
    return root;
  }
  if (profile.bio) root.appendChild(el("p", "mb-0 small", profile.bio));
  const facts = el("div", "d-flex flex-column gap-1");
  [
    line("Open to", optionLabel(reference.options, "openTo", profile.openTo)),
    line("Role", optionLabel(reference.options, "role", profile.role)),
    line("Experience", optionLabel(reference.options, "experience", profile.experience)),
    line("Systems", (profile.systems || []).map((entry) => (entry.systemId ? systemTitle(systems, entry.systemId) : entry.name)).join(", ")),
    line("Session length", optionLabel(reference.options, "sessionLength", profile.sessionLength)),
    line("Play", optionLabel(reference.options, "playMode", profile.playMode)),
    line("Location", profile.locationLabel),
    line("Time zone", profile.timezone),
    line("Availability", availabilityText(profile.availability, reference)),
    line(
      "Safety tools",
      (profile.safetyTools || []).map((id) => reference.safetyTools.find((tool) => tool.id === id)?.name || id).join(", "),
    ),
  ]
    .filter(Boolean)
    .forEach((row) => facts.appendChild(row));
  root.appendChild(facts);
  root.appendChild(el("div", "text-uppercase fs-6 fw-semibold text-body-secondary", "Preferences"));
  root.appendChild(renderScaleComparison(reference.scales, profile.scales, mineScales, { points: reference.points, theirsLabel: person.username }));
  return root;
}
