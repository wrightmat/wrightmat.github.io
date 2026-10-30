// Optional location with a user-chosen precision. Only what the chosen precision
// reveals is ever put in the value; a US "Area" is the first three digits of a
// ZIP code and is shown as a place name, never as digits.
import { el } from "../dom.js";
import { loadCommunityReference, loadCountries, loadRegions, loadUsAreas } from "./reference.js";

const PRECISION_HINTS = {
  hidden: "No location is shown.",
  country: "Only your country is shown.",
  region: "Your state, province or county is shown.",
  area: "A wider area around you is shown, as a place name.",
};

function select(options, value, { placeholder } = {}) {
  const node = el("select", "form-select form-select-sm");
  if (placeholder) node.appendChild(new Option(placeholder, ""));
  options.forEach(({ value: optionValue, label }) => node.appendChild(new Option(label, optionValue)));
  node.value = value ?? "";
  return node;
}

export async function createLocationPicker(initial, { onChange } = {}) {
  const [reference, countries, areas] = await Promise.all([loadCommunityReference(), loadCountries(), loadUsAreas()]);
  const state = { precision: "hidden", country: "", region: "", area: "", ...(initial || {}) };
  const root = el("div", "d-flex flex-column gap-2");
  const precision = select(
    reference.options.locationPrecision.map((entry) => ({ value: entry.id, label: entry.label })),
    state.precision,
  );
  const hint = el("div", "text-body-secondary small");
  const country = select(countries.map((entry) => ({ value: entry.code, label: entry.name })), state.country, { placeholder: "Country" });
  const region = select([], state.region, { placeholder: "Region" });
  const zip = el("input", "form-control form-control-sm");
  zip.type = "text";
  zip.placeholder = "ZIP code or area name";
  zip.autocomplete = "off";
  zip.setAttribute("list", "location-area-options");
  // Picking a suggestion fills in only the three digits; the place name shows below.
  const areaOptions = el("datalist");
  areaOptions.id = "location-area-options";
  Object.entries(areas).forEach(([prefix, name]) => {
    const option = el("option");
    option.value = prefix;
    option.label = name;
    areaOptions.appendChild(option);
  });
  const areaNote = el("div", "small");

  // The ZIP is only ever turned into its first three digits; nothing longer is kept.
  function areaState() {
    const typed = zip.value.trim();
    if (!typed) return { prefix: "", text: "", ok: false };
    if (!/^\d+$/.test(typed)) return { prefix: "", text: "Pick an area from the list.", ok: false };
    const prefix = typed.slice(0, 3);
    if (prefix.length < 3) return { prefix: "", text: "Enter at least the first three digits.", ok: false };
    const found = areas[prefix];
    if (!found) return { prefix: "", text: "That area isn't recognised.", ok: false };
    return { prefix, text: found, ok: true };
  }

  function currentValue() {
    const value = { precision: state.precision };
    if (state.precision !== "hidden") value.country = state.country;
    if (state.precision === "region" || state.precision === "area") value.region = state.region;
    if (state.precision === "area") value.area = state.area;
    return value;
  }

  function emit() {
    onChange?.(currentValue());
  }

  async function fillRegions() {
    const regions = await loadRegions(state.country);
    region.replaceChildren(new Option("Region", ""), ...regions.map((entry) => new Option(entry.name, entry.code)));
    region.value = regions.some((entry) => entry.code === state.region) ? state.region : "";
    if (region.value !== state.region) state.region = region.value;
  }

  function sync() {
    hint.textContent = PRECISION_HINTS[state.precision];
    country.hidden = state.precision === "hidden";
    region.hidden = !(state.precision === "region" || state.precision === "area");
    zip.hidden = areaNote.hidden = !(state.precision === "area" && state.country === "US");
    if (state.precision === "area" && state.country !== "US") {
      hint.textContent = "Area is only available in the United States; choose Region instead.";
    }
    const area = areaState();
    areaNote.className = `small ${area.ok ? "text-body" : "text-danger"}`;
    areaNote.textContent = area.text;
    state.area = area.prefix;
  }

  precision.addEventListener("change", () => {
    state.precision = precision.value;
    sync();
    emit();
  });
  country.addEventListener("change", async () => {
    state.country = country.value;
    state.region = "";
    await fillRegions();
    sync();
    emit();
  });
  region.addEventListener("change", () => {
    state.region = region.value;
    emit();
  });
  zip.addEventListener("input", () => {
    sync();
    emit();
  });
  zip.addEventListener("change", () => {
    if (state.area) zip.value = state.area;
    sync();
    emit();
  });

  if (state.area) {
    zip.value = state.area;
  }
  await fillRegions();
  sync();
  root.append(precision, hint, country, region, zip, areaOptions, areaNote);
  return {
    element: root,
    getValue: currentValue,
  };
}
