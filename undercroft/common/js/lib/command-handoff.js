// How `/new <kind>` reaches the tool that makes that kind. A tool registers the buttons it makes things with once
// its own startup has settled; a request then runs on that page directly, or arrives as `?new=<kind>&new.<option>=`.
// Options are matched to the tool's own pickers by their visible label (or data attribute), so a System-defined
// picker (Vault's Rarity, Tier, ...) needs no per-System wiring.
import { resolveToolHref, resolveToolContextPath } from "./app-shell.js";

export const NEW_KIND_TOOLS = {
  npc: "forge",
  monster: "crucible",
  wonder: "vault",
  item: "vault",
  spell: "vault",
  location: "sanctum",
  setting: "sanctum",
  character: "workbench",
  map: "orrery",
  page: "repository",
  template: "press",
};

const OPTION_PREFIX = "new.";
let registered = null;

const normalize = (text) => String(text ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
const initials = (text) =>
  String(text ?? "")
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((word) => word[0].toLowerCase())
    .join("");

export function requestNew(kind, options = {}, { newTab = false } = {}) {
  const tool = NEW_KIND_TOOLS[kind];
  if (!tool) throw new Error(`"${kind}" isn't something /new can make.`);
  if (!newTab && registered?.makes?.[kind]) return runRequest(registered, kind, options);
  const params = new URLSearchParams({ new: kind });
  Object.entries(options).forEach(([key, value]) => params.set(`${OPTION_PREFIX}${key}`, value));
  const url = `${resolveToolHref(tool, resolveToolContextPath())}?${params.toString()}`;
  if (newTab) window.open(url, "_blank", "noopener");
  else window.location.assign(url);
  return Promise.resolve(true);
}

// `makes` maps each kind to the button that makes it (Generate, or the toolbar's New), or to a function for a tool
// whose entry point isn't a single button. `fields` are the pickers that
// cascade (System, Setting, Location), in order, each `{ param, select, onChange }`; every other labelled picker in
// the left pane is matched afterwards, once the cascade has filled it.
export function handleCommandRequest({ makes, fields = [], status } = {}) {
  registered = { makes, fields, status };
  const params = new URLSearchParams(window.location.search);
  const kind = params.get("new");
  if (!kind || !makes?.[kind]) return;
  const options = {};
  [...params.keys()].filter((key) => key.startsWith(OPTION_PREFIX)).forEach((key) => {
    options[key.slice(OPTION_PREFIX.length)] = params.get(key);
    params.delete(key);
  });
  params.delete("new");
  const query = params.toString();
  window.history.replaceState(null, "", `${window.location.pathname}${query ? `?${query}` : ""}${window.location.hash}`);
  void runRequest(registered, kind, options);
}

function matchScore(names, label, key) {
  if (names.includes(key)) return 3;
  if (initials(label) === key) return 2;
  return names.some((name) => name.length > key.length && (name.startsWith(key) || name.endsWith(key))) ? 1 : 0;
}

function selectLabel(select) {
  return select.labels?.[0]?.textContent || select.parentElement?.querySelector("label")?.textContent || "";
}

function describeSelect(select, param = "") {
  const label = selectLabel(select).trim() || param;
  const names = [param, label, ...Object.entries(select.dataset).flatMap(([key, value]) => [key.replace(/(Override|Select)$/, ""), value])]
    .map(normalize)
    .filter(Boolean);
  return { select, label, names };
}

function pickOption(select, value) {
  const wanted = normalize(value);
  const options = [...select.options].filter((option) => !option.disabled && option.value);
  return (
    options.find((option) => normalize(option.value) === wanted || normalize(option.textContent) === wanted) ||
    options.find((option) => normalize(option.textContent).startsWith(wanted)) ||
    options.find((option) => normalize(option.textContent).includes(wanted)) ||
    null
  );
}

async function applyValue({ select, label, onChange }, value) {
  const option = pickOption(select, value);
  if (!option) throw new Error(`"${value}" isn't one of the ${label || "picker"} choices here.`);
  select.value = option.value;
  if (onChange) await onChange();
  else select.dispatchEvent(new Event("change", { bubbles: true }));
}

// Each option goes to the picker it matches best (ties to the earliest on the page); returns them in page order.
function assignOptions(pending, candidates) {
  const assigned = new Map();
  pending.forEach((value, key) => {
    let best = null;
    candidates.forEach((candidate) => {
      if (assigned.has(candidate)) return;
      const score = matchScore(candidate.names, candidate.label, key);
      if (score && (!best || score > best.score)) best = { candidate, score };
    });
    if (best) {
      assigned.set(best.candidate, value);
      pending.delete(key);
    }
  });
  return candidates.filter((candidate) => assigned.has(candidate)).map((candidate) => [candidate, assigned.get(candidate)]);
}

async function runRequest({ makes, fields, status }, kind, options) {
  const pending = new Map(Object.entries(options).map(([key, value]) => [normalize(key), value]));
  try {
    const explicit = fields.filter((field) => field.select).map((field) => ({ ...describeSelect(field.select, field.param), onChange: field.onChange }));
    for (const [field, value] of assignOptions(pending, explicit)) await applyValue(field, value);
    const taken = new Set(explicit.map((field) => field.select));
    const pane = document.querySelector('[data-pane="left"]') || document;
    const others = [...pane.querySelectorAll("select")].filter((select) => !taken.has(select)).map((select) => describeSelect(select));
    for (const [field, value] of assignOptions(pending, others)) await applyValue(field, value);
    if (pending.size) throw new Error(`There's no ${[...pending.keys()].join(", ")} choice here.`);
  } catch (error) {
    status?.show(error.message, { type: "warning" });
    return false;
  }
  const button = makes[kind];
  if (typeof button === "function") {
    await button();
    return true;
  }
  if (button.disabled) {
    const reason = button.parentElement?.dataset?.tooltipDisabledWrap === "true" ? button.parentElement.getAttribute("data-bs-title") : "";
    status?.show(reason || "This can't be made yet.", { type: "warning" });
    return false;
  }
  button.click();
  return true;
}
