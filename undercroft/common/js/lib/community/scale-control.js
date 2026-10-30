// The thirteen shared preference scales: an editor (five points plus "Don't
// care", which is the resting value and is stored as absent) and a side-by-side
// comparison. Two values are never merged into one score; the comparison only
// counts how many shared scales are within one point of each other.
import { el } from "../dom.js";

const ASPECT_ENDS = { low: "Not important", high: "Essential" };

function poles(scale) {
  return scale.kind === "feel" ? { low: scale.low, high: scale.high } : ASPECT_ENDS;
}

// Calls onChange(value|null) when the user picks a point or returns to "Don't care".
export function createScaleControl(scale, value, { points = 5, onChange, readOnly = false } = {}) {
  const wrap = el("div", "d-flex flex-column gap-1");
  wrap.dataset.scaleId = scale.id;
  const head = el("div", "d-flex align-items-baseline justify-content-between gap-2");
  const title = el("span", "fw-semibold small", scale.label);
  title.title = scale.description;
  const ends = poles(scale);
  head.append(title, el("span", "text-body-secondary small", `${ends.low} → ${ends.high}`));
  const group = el("div", "btn-group btn-group-sm w-100");
  group.setAttribute("role", "group");
  group.setAttribute("aria-label", scale.label);
  let current = value ?? null;

  const buttons = [];
  const addButton = (label, pointValue, text) => {
    const button = el("button", "btn btn-outline-secondary", text);
    button.type = "button";
    button.setAttribute("aria-label", label);
    button.disabled = readOnly;
    button.addEventListener("click", () => {
      current = pointValue;
      refresh();
      onChange?.(current);
    });
    buttons.push({ button, pointValue });
    group.appendChild(button);
  };
  addButton("Don't care", null, "Don't care");
  for (let point = 1; point <= points; point += 1) {
    addButton(`${scale.label}: ${point} of ${points}`, point, String(point));
  }
  function refresh() {
    buttons.forEach(({ button, pointValue }) => {
      const active = pointValue === current;
      button.classList.toggle("active", active);
      button.setAttribute("aria-pressed", String(active));
    });
  }
  refresh();
  wrap.append(head, group);
  return {
    element: wrap,
    setValue(next) {
      current = next ?? null;
      refresh();
    },
  };
}

// How many of the scales both sides have set are within one point of each other.
export function scaleCloseness(mine, theirs) {
  let shared = 0;
  let close = 0;
  Object.keys(theirs || {}).forEach((id) => {
    if (mine?.[id] != null && theirs[id] != null) {
      shared += 1;
      if (Math.abs(mine[id] - theirs[id]) <= 1) close += 1;
    }
  });
  return { close, shared };
}

export function closenessText(mine, theirs) {
  const { close, shared } = scaleCloseness(mine, theirs);
  return shared ? `Close on ${close} of ${shared} shared scales` : "No shared scales";
}

// Read-only rows for each scale the other side set: a five-point track with their
// marker and, when given, yours.
export function renderScaleComparison(scales, theirs, mine, { points = 5, theirsLabel = "Them", mineLabel = "You" } = {}) {
  const wrap = el("div", "d-flex flex-column gap-2");
  const rows = scales.filter((scale) => theirs?.[scale.id] != null);
  if (!rows.length) {
    wrap.appendChild(el("span", "text-body-secondary small", "No preferences set"));
    return wrap;
  }
  rows.forEach((scale) => {
    const row = el("div", "d-flex flex-column gap-1");
    const ends = poles(scale);
    row.appendChild(el("span", "small fw-semibold", scale.label));
    const track = el("div", "d-flex align-items-center gap-1");
    for (let point = 1; point <= points; point += 1) {
      const cell = el("span", "flex-fill text-center rounded small border");
      const marks = [];
      if (theirs[scale.id] === point) marks.push("●");
      if (mine?.[scale.id] === point) marks.push("○");
      cell.textContent = marks.join(" ") || "·";
      if (theirs[scale.id] === point) cell.classList.add("text-bg-primary");
      else if (mine?.[scale.id] === point) cell.classList.add("border-primary");
      cell.title = [
        theirs[scale.id] === point ? `${theirsLabel}: ${point}` : "",
        mine?.[scale.id] === point ? `${mineLabel}: ${point}` : "",
      ]
        .filter(Boolean)
        .join(" · ");
      track.appendChild(cell);
    }
    const labels = el("div", "d-flex justify-content-between text-body-secondary");
    labels.style.fontSize = "0.7rem";
    labels.append(el("span", "", ends.low), el("span", "", ends.high));
    row.append(track, labels);
    wrap.appendChild(row);
  });
  if (mine && Object.keys(mine).length) {
    wrap.appendChild(el("span", "text-body-secondary small", `● ${theirsLabel}   ○ ${mineLabel}`));
  }
  return wrap;
}
