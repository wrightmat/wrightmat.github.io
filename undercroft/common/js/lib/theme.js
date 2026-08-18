const STORAGE_KEY = "undercroft.workbench.theme";
const PACK_STORAGE_KEY = "undercroft.workbench.theme-pack";
const THEMES = ["light", "system", "dark"];
// Same allowlist as common/js/theme-init.js's own PACK_ID_PATTERN — keep
// the two in sync, they validate the same localStorage value from two
// different load stages (that one pre-first-paint, this one post-<body>).
const PACK_ID_PATTERN = /^[a-z0-9-]+$/;
let themePacksPromise = null;

function prefersDark() {
  return (
    typeof window !== "undefined" &&
    window.matchMedia &&
    window.matchMedia("(prefers-color-scheme: dark)").matches
  );
}

function resolveTheme(preference) {
  if (preference === "dark") return "dark";
  if (preference === "light") return "light";
  return prefersDark() ? "dark" : "light";
}

function applyThemeAttributes(preference, resolved) {
  const root = document.documentElement;
  const body = document.body;

  if (root) {
    root.dataset.themePreference = preference;
    root.dataset.theme = resolved;
    root.dataset.bsTheme = resolved;
    root.style.colorScheme = resolved;
  }

  if (body) {
    body.dataset.themePreference = preference;
    body.dataset.theme = resolved;
    body.dataset.bsTheme = resolved;
    body.style.colorScheme = resolved;
  }
}

export function getThemePreference() {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored && THEMES.includes(stored)) {
      return stored;
    }
  } catch (error) {
    console.warn("Theme: unable to read preference", error);
  }
  return "system";
}

export function applyTheme(theme) {
  const preference = THEMES.includes(theme) ? theme : "system";
  const resolved = resolveTheme(preference);

  applyThemeAttributes(preference, resolved);

  try {
    if (preference === "system") {
      localStorage.removeItem(STORAGE_KEY);
    } else {
      localStorage.setItem(STORAGE_KEY, preference);
    }
  } catch (error) {
    console.warn("Theme: unable to persist preference", error);
  }

  return preference;
}

export function getThemePackPreference() {
  try {
    const stored = localStorage.getItem(PACK_STORAGE_KEY);
    if (stored && PACK_ID_PATTERN.test(stored)) {
      return stored;
    }
  } catch (error) {
    console.warn("Theme: unable to read pack preference", error);
  }
  return "default";
}

function resolvePackStylesheetUrl(packId) {
  const relativeHref =
    packId === "default" ? "vendor/bootstrap/bootstrap.min.css" : `vendor/bootswatch/${packId}/bootstrap.min.css`;
  // common/js/lib/theme.js -> ../../ -> common/ — same base every
  // page-relative <script src> path (common/js/theme-init.js's own
  // document.currentScript-based resolution) ultimately lands on too.
  const commonBase = new URL("../../", import.meta.url);
  return new URL(relativeHref, commonBase).href;
}

// Swaps the page's ONE Bootstrap stylesheet at runtime — the <link> itself
// is written once by common/js/theme-init.js (document.write, before first
// paint; see that file's own comment for why it can't consult this same
// manifest). This only ever runs after a user click, so a visible swap/
// reflow is expected, not a bug — the FOUC-avoidance concern only applies
// to page load, which theme-init.js already owns.
export function applyThemePack(packId) {
  const id = typeof packId === "string" && PACK_ID_PATTERN.test(packId) ? packId : "default";
  const link = document.querySelector("link[data-undercroft-bootstrap-link]");
  if (link) {
    link.href = resolvePackStylesheetUrl(id);
  }
  try {
    if (id === "default") {
      localStorage.removeItem(PACK_STORAGE_KEY);
    } else {
      localStorage.setItem(PACK_STORAGE_KEY, id);
    }
  } catch (error) {
    console.warn("Theme: unable to persist pack preference", error);
  }
  return id;
}

// Wires a batch of already-built palette-option elements (one per
// common/data/theme-packs.json entry, each carrying `data-theme-pack-option`
// set to that pack's id — see app-shell.js's palette dropdown, the only
// caller today). Click applies + persists the clicked pack and refreshes
// every button's active state together, same shape as initThemeControls'
// own [data-theme-option] wiring just below, but exported separately since
// the palette list is built asynchronously (after loadThemePacks resolves,
// well after initThemeControls' own single synchronous pass has already
// run) rather than existing in the DOM up front.
export function wireThemePackOptions(buttons) {
  const packPreference = getThemePackPreference();
  const setActive = (selected) => {
    buttons.forEach((btn) => {
      const isActive = btn.getAttribute("data-theme-pack-option") === selected;
      btn.dataset.active = isActive ? "true" : "false";
      btn.setAttribute("aria-pressed", isActive ? "true" : "false");
      btn.classList.toggle("active", isActive);
    });
  };
  setActive(packPreference);
  buttons.forEach((btn) => {
    btn.addEventListener("click", () => {
      const option = btn.getAttribute("data-theme-pack-option");
      setActive(applyThemePack(option));
    });
  });
}

// Fetched once per page load and cached — every caller (the header's own
// palette dropdown being the only one today) shares the same in-flight/
// resolved promise rather than re-fetching. Mirrors font-library.js's own
// loadCustomFonts() shape (common/js/lib/font-library.js:108-124): same
// new URL(..., import.meta.url) resolution against this module's own path,
// same non-fatal "log and return []" failure handling.
export function loadThemePacks() {
  if (!themePacksPromise) {
    themePacksPromise = (async () => {
      try {
        const url = new URL("../../data/theme-packs.json", import.meta.url);
        const response = await fetch(url);
        if (!response.ok) {
          throw new Error(`Unable to load ${url}: ${response.status}`);
        }
        const payload = await response.json();
        return Array.isArray(payload?.packs) ? payload.packs : [];
      } catch (error) {
        console.warn("Unable to load the theme pack manifest:", error);
        return [];
      }
    })();
  }
  return themePacksPromise;
}

export function initThemeControls(root = document) {
  const preference = getThemePreference();
  const resolved = resolveTheme(preference);
  applyThemeAttributes(preference, resolved);
  const controls = Array.from(root.querySelectorAll("[data-theme-option]"));
  controls.forEach((control) => {
    const option = control.getAttribute("data-theme-option");
    control.dataset.active = option === preference ? "true" : "false";
    control.setAttribute("aria-pressed", option === preference ? "true" : "false");
    control.classList.toggle("active", option === preference);
    control.addEventListener("click", () => {
      const selected = applyTheme(option);
      controls.forEach((btn) => {
        const btnOption = btn.getAttribute("data-theme-option");
        const isActive = btnOption === selected;
        btn.dataset.active = isActive ? "true" : "false";
        btn.setAttribute("aria-pressed", isActive ? "true" : "false");
        btn.classList.toggle("active", isActive);
      });
    });
  });

  if (typeof window !== "undefined" && window.matchMedia) {
    const listener = (event) => {
      const current = getThemePreference();
      if (current === "system") {
        applyTheme(current);
        controls.forEach((btn) => {
          const option = btn.getAttribute("data-theme-option");
          const isActive = option === current;
          btn.dataset.active = isActive ? "true" : "false";
          btn.setAttribute("aria-pressed", isActive ? "true" : "false");
          btn.classList.toggle("active", isActive);
        });
      }
    };
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    media.addEventListener("change", listener);
  }
}
