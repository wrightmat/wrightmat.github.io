// Small form helpers shared by the WLED controls — the full control itself
// (effect, palette, colors, brightness, target, power, preset) lives in
// wled-control.js.
import { el } from "../dom.js";

// The lowest brightness any slider offers: 3/255 reads as 1%, where 1/255
// would round to 0% and look like "off".
export const MIN_BRIGHTNESS = 3;

let checkCounter = 0;

export function createCheck(labelText, checked, onChange) {
  const wrap = el("div", "form-check mb-0");
  const input = document.createElement("input");
  input.type = "checkbox";
  input.className = "form-check-input";
  input.id = `wled-check-${(checkCounter += 1)}`;
  input.checked = Boolean(checked);
  input.addEventListener("change", () => onChange(input.checked));
  const label = el("label", "form-check-label small", labelText);
  label.htmlFor = input.id;
  wrap.append(input, label);
  return wrap;
}

// (Re)fills a select, keeping the saved value selectable even when the live
// list no longer has it (a shared macro, a deleted preset, an unreachable
// device) — silently dropping it would rewrite the saved value on the next
// unrelated edit. `blank: null` means no blank entry, for a select that
// always has a value.
export function fillChoiceSelect(select, { blank, options, current }) {
  select.innerHTML = "";
  const entries = [...(blank === null ? [] : [{ value: "", label: blank }]), ...options];
  if (current && !entries.some((entry) => entry.value === current)) {
    entries.push({ value: current, label: `${current} (saved)` });
  }
  entries.forEach(({ value, label }) => {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = label;
    select.appendChild(option);
  });
  select.value = current;
}
