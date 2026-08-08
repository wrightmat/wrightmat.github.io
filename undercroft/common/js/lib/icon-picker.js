// Icon search/autocomplete for the "Icon" component's iconClass field —
// shared by Press and Workbench (both ported here verbatim from Press's
// original implementation) so the two searchable icon sets (ddb-icons.css
// class-scraping, Bootstrap Icons CDN JSON) and the dropdown widget stay
// byte-for-byte identical instead of drifting across two copies. Icons here
// are rendered as CSS classes (`ddb-*` self-contained, `bi-*` needs the
// shared "bi" base class) — a deliberately different, non-Iconify system
// from the rest of the suite's `data-icon="tabler:*"` convention, since
// this is specifically what Press's own Icon component already used and
// this is a like-for-like port, not a reinterpretation.
//
// Tabler (Iconify) icons were added as a THIRD, opt-in source (see
// ensureTablerIconNamesLoaded/TABLER_ICON_SOURCE below) for callers whose
// own `icon` value is the suite-wide `tabler:*` data-icon convention
// instead of a CSS class — Orrery/Dashboard's own chrome and content-icon
// fields, not Press/Workbench's iconClass. `getAllIconOptions`/
// `attachIconAutocomplete` both take an optional `sources` filter so a
// caller can restrict to just one vocabulary (board.js passes
// `sources: ["tabler"]`, since a bi-*/ddb-* suggestion would be a value its
// own tabler:*-only render pipeline can't use at all) — the default (no
// `sources` given) stays ddb+bi ONLY, unchanged from before this was added,
// so Press/Workbench's own Icon component field (which can only ever
// render a CSS-class icon) never starts suggesting a `tabler:*` value it
// has no way to display.

// Cosmetic grouping only, for the small gray label on the right of each
// autocomplete row — reused from the categories ddb-icons.css's own
// existing icons happened to fall into. Anything not listed here (an icon
// added to the stylesheet without also being added here) just falls under
// a generic "DDB Icons" group instead of needing a registration step — see
// ensureDdbIconOptionsLoaded below, which is what actually discovers the
// icon names themselves, directly from the stylesheet.
export const DDB_ICON_GROUPS = {
  bludgeoning: "Damage",
  piercing: "Damage",
  slashing: "Damage",
  acid: "Damage",
  cold: "Damage",
  fire: "Damage",
  force: "Damage",
  lightning: "Damage",
  necrotic: "Damage",
  poison: "Damage",
  psychic: "Damage",
  radiant: "Damage",
  thunder: "Damage",
  abjuration: "Magic School",
  conjuration: "Magic School",
  divination: "Magic School",
  enchantment: "Magic School",
  evocation: "Magic School",
  illusion: "Magic School",
  necromancy: "Magic School",
  transmutation: "Magic School",
  artifice: "Inner Circle",
  dunamancy: "Inner Circle",
  psionics: "Inner Circle",
  entropomancy: "Inner Circle",
  sangromancy: "Inner Circle",
  "melee-attack": "Attack",
  "melee-weapon": "Attack",
  "ranged-attack": "Attack",
  "ranged-weapon": "Attack",
  immunity: "Defense",
  resistance: "Defense",
  vulnerability: "Defense",
  cone: "Area",
  cube: "Area",
  cylinder: "Area",
  sphere: "Area",
  square: "Area",
  artificer: "Class",
  barbarian: "Class",
  bard: "Class",
  cleric: "Class",
  druid: "Class",
  fighter: "Class",
  monk: "Class",
  paladin: "Class",
  ranger: "Class",
  rogue: "Class",
  sorcerer: "Class",
  warlock: "Class",
  wizard: "Class",
  advantage: "Misc",
  attunement: "Misc",
  concentration: "Misc",
  disadvantage: "Misc",
  healing: "Misc",
  ritual: "Misc",
};

function titleCaseIconName(name) {
  return name
    .split("-")
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

// Resolved relative to THIS module's own file (not the importing page's
// document location) so both Press's and Workbench's own copies of this
// module fetch the same common/css/ddb-icons.css regardless of which
// tool's page loaded it.
const DDB_ICONS_CSS_URL = new URL("../../css/ddb-icons.css", import.meta.url);

// Discovered directly from ddb-icons.css (same-origin, no CORS concern
// unlike the Bootstrap Icons CDN fetch below) rather than a hand-maintained
// list — a new `.ddb-whatever { ... }` rule added to that stylesheet just
// shows up here automatically, no separate registration step needed. Same
// lazy-fetch-once-and-cache shape as ensureBootstrapIconNamesLoaded.
let ddbIconOptions = [];
let ddbIconOptionsPromise = null;
export function ensureDdbIconOptionsLoaded(onLoaded) {
  if (!ddbIconOptionsPromise) {
    ddbIconOptionsPromise = fetch(DDB_ICONS_CSS_URL)
      .then((response) =>
        response.ok ? response.text() : Promise.reject(new Error(`ddb-icons.css unavailable (${response.status})`))
      )
      .then((text) => {
        const names = new Set();
        const pattern = /\.ddb-([a-zA-Z0-9-]+)\s*\{/g;
        let match = pattern.exec(text);
        while (match) {
          names.add(match[1]);
          match = pattern.exec(text);
        }
        ddbIconOptions = Array.from(names)
          .sort()
          .map((name) => ({
            group: DDB_ICON_GROUPS[name] ?? "DDB Icons",
            label: titleCaseIconName(name),
            value: `ddb-${name}`,
          }));
      })
      .catch((error) => {
        console.warn("ddb-icons.css icon list unavailable:", error);
      });
  }
  ddbIconOptionsPromise.then(onLoaded);
}

// Bootstrap Icons — fetched once, lazily, from the same CDN/version this
// suite already loads the stylesheet from — best-effort: a failure here
// just means no Bootstrap Icons show up as suggestions, never a hard error.
const BOOTSTRAP_ICONS_VERSION = "1.11.3";
const BOOTSTRAP_ICONS_JSON_URL = `https://cdn.jsdelivr.net/npm/bootstrap-icons@${BOOTSTRAP_ICONS_VERSION}/font/bootstrap-icons.json`;
let bootstrapIconNames = [];
let bootstrapIconNamesPromise = null;
export function ensureBootstrapIconNamesLoaded(onLoaded) {
  if (!bootstrapIconNamesPromise) {
    bootstrapIconNamesPromise = fetch(BOOTSTRAP_ICONS_JSON_URL)
      .then((response) => (response.ok ? response.json() : Promise.reject(new Error(`Bootstrap Icons list unavailable (${response.status})`))))
      .then((data) => {
        bootstrapIconNames = Object.keys(data ?? {}).sort();
      })
      .catch((error) => {
        console.warn("Bootstrap Icons list unavailable:", error);
      });
  }
  bootstrapIconNamesPromise.then(onLoaded);
}

// Tabler (Iconify) — fetched once, lazily, from Iconify's own public
// collection API (no local copy of ~5,000+ icon names to keep in sync
// with the CDN script's own version). Best-effort, same shape as
// ensureBootstrapIconNamesLoaded: a failure here just means no Tabler
// icons show up as suggestions, never a hard error. `value` is
// `tabler:<name>` (this suite's own data-icon convention), NOT a `tabler-`
// CSS class — never merged into ddbIconOptions/bootstrapIconNames, which
// are both CSS-class vocabularies.
const TABLER_ICON_SET_URL = "https://api.iconify.design/collection?prefix=tabler";
let tablerIconNames = [];
let tablerIconNamesPromise = null;
export function ensureTablerIconNamesLoaded(onLoaded) {
  if (!tablerIconNamesPromise) {
    tablerIconNamesPromise = fetch(TABLER_ICON_SET_URL)
      .then((response) => (response.ok ? response.json() : Promise.reject(new Error(`Tabler icon list unavailable (${response.status})`))))
      .then((data) => {
        // Iconify's collection response groups names under `categories`
        // (an object of arrays) plus a flat `uncategorized` array for
        // anything left over — merging both is what actually gets every
        // icon the set has, not just the categorized subset.
        const categorized = Object.values(data?.categories ?? {}).flat();
        const uncategorized = Array.isArray(data?.uncategorized) ? data.uncategorized : [];
        tablerIconNames = Array.from(new Set([...categorized, ...uncategorized])).sort();
      })
      .catch((error) => {
        console.warn("Tabler icon list unavailable:", error);
      });
  }
  tablerIconNamesPromise.then(onLoaded);
}

// `sources` (optional array of "ddb"/"bi"/"tabler") restricts which
// vocabularies are searched — see this file's own header comment for why
// the default (omitted) deliberately excludes "tabler".
const DEFAULT_ICON_SOURCES = ["ddb", "bi"];
export function getAllIconOptions({ sources = DEFAULT_ICON_SOURCES } = {}) {
  const allowed = new Set(sources);
  const options = [];
  if (allowed.has("ddb")) options.push(...ddbIconOptions);
  if (allowed.has("bi")) {
    options.push(...bootstrapIconNames.map((name) => ({ group: "Bootstrap", label: name, value: `bi-${name}` })));
  }
  if (allowed.has("tabler")) {
    options.push(...tablerIconNames.map((name) => ({ group: "Tabler", label: name, value: `tabler:${name}` })));
  }
  return options;
}

// One place that knows how to turn any of the three icon value shapes this
// module searches (`ddb-*`/`bi-*` CSS classes, `tabler:*` Iconify data-icon)
// into a rendered element — shared by the dropdown's own preview swatch
// (renderIconAutocompleteOption) and any caller building a live preview of
// the currently-committed value (ui-components.js's createIconPickerField),
// so the "which shape is this and how do I render it" branch exists exactly
// once.
export function buildIconPreviewElement(value) {
  const trimmed = String(value ?? "").trim();
  if (!trimmed) return null;
  if (trimmed.startsWith("tabler:")) {
    const icon = document.createElement("span");
    icon.className = "iconify";
    icon.dataset.icon = trimmed;
    // Iconify's own MutationObserver (loaded suite-wide) picks up a
    // brand-new .iconify node automatically — .scan() is a defensive nudge
    // on top of that for the moment right after this element is inserted,
    // matching Press's own one existing use of it (app.js's own
    // icon-preview refresh).
    queueMicrotask(() => window.Iconify?.scan?.(icon.parentElement || icon));
    return icon;
  }
  const tokens = getIconTokens(trimmed);
  if (!tokens.length) return null;
  const icon = document.createElement("span");
  const bootstrapToken = tokens.find((token) => token.startsWith("bi-"));
  icon.className = bootstrapToken ? `bi ${bootstrapToken}` : tokens.join(" ");
  return icon;
}

function ensureIconAutocompleteContainer(input) {
  if (!input || !input.parentElement) return null;
  const parent = input.closest(".form-floating") ?? input.parentElement;
  parent.classList.add("position-relative");
  let container = parent.querySelector("[data-icon-autocomplete]");
  if (!container) {
    container = document.createElement("div");
    container.dataset.iconAutocomplete = "true";
    container.className = "list-group position-absolute top-100 start-0 w-100 shadow-sm bg-body border mt-1 d-none";
    container.style.zIndex = "1300";
    container.style.fontSize = "0.8125rem";
    container.style.maxHeight = "16rem";
    container.style.overflowY = "auto";
    parent.appendChild(container);
  }
  return container;
}

function renderIconAutocompleteOption(option) {
  const row = document.createElement("button");
  row.type = "button";
  row.className = "list-group-item list-group-item-action d-flex align-items-center gap-2 py-1";
  const preview = document.createElement("span");
  preview.className = "press-icon-option__preview";
  // buildIconPreviewElement (this module's own, below) handles all three
  // value shapes ddb-*/bi-*/tabler: — a plain `icon.className = option.value`
  // would render a raw "tabler:bolt" string as a (nonexistent) CSS class
  // instead of an actual Iconify icon.
  const icon = buildIconPreviewElement(option.value);
  if (icon) preview.appendChild(icon);
  const label = document.createElement("span");
  label.className = "text-truncate";
  label.textContent = option.label;
  const group = document.createElement("small");
  group.className = "text-body-secondary text-nowrap ms-auto";
  group.textContent = option.group;
  row.append(preview, label, group);
  return row;
}

// Wires a text input up as a searchable icon picker: typing filters
// getAllIconOptions() (label/value substring match), arrow keys navigate,
// Enter/click selects. `onSelect(value)` is called with the chosen
// "ddb-*"/"bi-*"/"tabler:*" string — the caller owns what happens next
// (writing it onto a node, re-rendering a preview, etc.), so this stays
// reusable across Press's, Workbench's, and board.js's own different
// node/component shapes. `sources` (optional, e.g. `["tabler"]`) restricts
// which vocabularies are searched — see getAllIconOptions's own comment for
// the default.
export function attachIconAutocomplete(input, { onSelect, sources } = {}) {
  if (!input || typeof onSelect !== "function") return null;
  const container = ensureIconAutocompleteContainer(input);
  if (!container) return null;
  const allowedSources = sources || DEFAULT_ICON_SOURCES;
  const MAX_ITEMS = 12;
  let items = [];
  let activeIndex = -1;

  const close = () => {
    items = [];
    activeIndex = -1;
    container.innerHTML = "";
    container.classList.add("d-none");
  };

  const render = (nextItems) => {
    items = nextItems;
    activeIndex = -1;
    container.innerHTML = "";
    if (!items.length) {
      close();
      return;
    }
    items.forEach((option, index) => {
      const row = renderIconAutocompleteOption(option);
      row.dataset.iconIndex = String(index);
      row.setAttribute("role", "option");
      row.addEventListener("mousedown", (event) => event.preventDefault());
      row.addEventListener("click", () => {
        onSelect(option.value);
        close();
      });
      container.appendChild(row);
    });
    container.classList.remove("d-none");
  };

  const update = () => {
    const value = input.value.trim();
    if (value.startsWith("@") || value.startsWith("=")) {
      close();
      return;
    }
    const normalized = value.toLowerCase();
    // Empty shows the first MAX_ITEMS of everything (ddb icons first, so
    // they're what actually appears by default) rather than closing — same
    // "see the options right away on focus" behavior other autocompletes in
    // this suite already have.
    const filtered = getAllIconOptions({ sources: allowedSources })
      .filter((option) => {
        if (!normalized) return true;
        return option.label.toLowerCase().includes(normalized) || option.value.toLowerCase().includes(normalized);
      })
      .slice(0, MAX_ITEMS);
    render(filtered);
  };

  const onKeyDown = (event) => {
    if (!items.length) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      activeIndex = Math.min(activeIndex + 1, items.length - 1);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      activeIndex = Math.max(activeIndex - 1, 0);
    } else if (event.key === "Enter") {
      event.preventDefault();
      if (activeIndex >= 0 && items[activeIndex]) {
        onSelect(items[activeIndex].value);
        close();
      }
    } else if (event.key === "Escape") {
      event.preventDefault();
      close();
    }
    Array.from(container.querySelectorAll("[data-icon-index]")).forEach((row) => {
      row.classList.toggle("active", Number(row.dataset.iconIndex) === activeIndex);
    });
  };

  input.addEventListener("input", update);
  input.addEventListener("focus", () => {
    update();
    // Each list is fetched lazily and may not have resolved yet the first
    // time this field is used — re-run update() once each lands so the
    // dropdown (if still open) picks up the fuller list instead of staying
    // stuck showing whatever was available first. Only the ALLOWED sources'
    // own loaders fire — a board.js field restricted to `["tabler"]` has no
    // reason to also fetch the (unused) ddb/Bootstrap lists.
    const sourceSet = new Set(allowedSources);
    if (sourceSet.has("ddb")) ensureDdbIconOptionsLoaded(update);
    if (sourceSet.has("bi")) ensureBootstrapIconNamesLoaded(update);
    if (sourceSet.has("tabler")) ensureTablerIconNamesLoaded(update);
  });
  input.addEventListener("click", update);
  input.addEventListener("keydown", onKeyDown);
  input.addEventListener("blur", () => setTimeout(close, 120));

  return { update, close };
}

// Splits a resolved iconClass string into its "ddb-*"/"bi-*" tokens (used
// by both the inspector's live preview swatch and the actual component
// render) — anything else in the string (a stray class, whitespace) is
// dropped rather than treated as an icon token.
export function getIconTokens(value) {
  return String(value ?? "")
    .split(/\s+/)
    .filter((token) => token.startsWith("ddb-") || token.startsWith("bi-"));
}

// The full class list to apply to an icon element for a resolved iconClass
// value — prepends the Bootstrap "bi" base class when any bi-* token is
// present, same rule both the inspector preview and the real render use.
export function resolveIconClassList(value) {
  const tokens = getIconTokens(value);
  if (!tokens.length) return [];
  const needsBootstrapBase = tokens.some((token) => token.startsWith("bi-"));
  return needsBootstrapBase ? ["bi", ...tokens] : tokens;
}
