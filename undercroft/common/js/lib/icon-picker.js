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

export function getAllIconOptions() {
  const bootstrapOptions = bootstrapIconNames.map((name) => ({
    group: "Bootstrap",
    label: name,
    value: `bi-${name}`,
  }));
  return [...ddbIconOptions, ...bootstrapOptions];
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
  const icon = document.createElement("span");
  // Bootstrap Icons needs the shared "bi" base class alongside "bi-{name}"
  // (the base class supplies the icon font/pseudo-element plumbing, the
  // per-icon class only sets which glyph) — same rule the icon component's
  // own render logic applies; a ddb-* icon is a single self-contained class
  // and needs nothing extra.
  icon.className = option.value.startsWith("bi-") ? `bi ${option.value}` : option.value;
  preview.appendChild(icon);
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
// "ddb-*"/"bi-*" class string — the caller owns what happens next (writing
// it onto a node, re-rendering a preview, etc.), so this stays reusable
// across Press's and Workbench's own different node/component shapes.
export function attachIconAutocomplete(input, { onSelect } = {}) {
  if (!input || typeof onSelect !== "function") return null;
  const container = ensureIconAutocompleteContainer(input);
  if (!container) return null;
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
    const filtered = getAllIconOptions()
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
    // Both lists are fetched lazily and may not have resolved yet the first
    // time this field is used — re-run update() once each lands so the
    // dropdown (if still open) picks up the fuller list instead of staying
    // stuck showing whatever was available first.
    ensureDdbIconOptionsLoaded(update);
    ensureBootstrapIconNamesLoaded(update);
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
