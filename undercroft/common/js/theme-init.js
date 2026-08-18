// Applies the stored theme preference to <html> (and <body>, on the rare
// page where it's already parsed by the time this runs) before first paint,
// so there's no flash of the wrong theme. Loaded as a plain, non-module,
// non-deferred <script src> in every page's own <head> — BEFORE the CSS
// links, in the exact position the inline version it replaces used to
// occupy — which blocks parsing until fetched and executed, same as an
// inline script would, just with one (browser-cached after first load)
// network round trip instead of zero. Deliberately NOT a module and NOT
// deferred: either would let parsing continue past it, reintroducing the
// exact flash this exists to prevent.
//
// Also emits the page's ONE Bootstrap stylesheet <link> via document.write
// — the same "must win the race against first paint" reasoning applies to
// WHICH palette loads, not just light/dark. Every page's own <head> no
// longer hand-writes that <link> itself (see common/js/lib/theme.js's own
// comment on applyThemePack for the full picture) — this script is its sole
// source now. Deliberately convention-based, NOT a fetch() of
// common/data/theme-packs.json: an async fetch can't finish before the
// parser reaches the point document.write needs to run, which would
// reintroduce the exact flash this exists to prevent. theme.js's own
// loadThemePacks() reads that manifest separately, later, only for the
// picker UI's display labels/swatches — never for this critical path.
//
// Kept independent from common/js/lib/theme.js's own initThemeControls —
// that one wires the header's theme/palette controls and runs later, after
// <body> exists; this one only ever needs to win the race against first
// paint.
(function () {
  const storageKey = "undercroft.workbench.theme";
  const packStorageKey = "undercroft.workbench.theme-pack";
  const THEMES = ["light", "system", "dark"];
  // Matches common/data/theme-packs.json's own `id` values — alphanumeric
  // + hyphens only, so a malformed/stale localStorage value can't produce
  // an unexpected href (no slashes or `..`, deliberately not just trusting
  // the stored string).
  const PACK_ID_PATTERN = /^[a-z0-9-]+$/;
  const prefersDark = () =>
    typeof window !== "undefined" &&
    window.matchMedia &&
    window.matchMedia("(prefers-color-scheme: dark)").matches;
  const resolveTheme = (preference) => {
    if (preference === "dark") return "dark";
    if (preference === "light") return "light";
    return prefersDark() ? "dark" : "light";
  };
  const apply = (value) => {
    const preference = THEMES.includes(value) ? value : "system";
    const resolved = resolveTheme(preference);
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
    return preference;
  };
  try {
    const stored = localStorage.getItem(storageKey);
    apply(stored);
  } catch (error) {
    apply("system");
    console.warn("Unable to read theme preference", error);
  }

  let packId = "default";
  try {
    const storedPack = localStorage.getItem(packStorageKey);
    if (storedPack && PACK_ID_PATTERN.test(storedPack)) {
      packId = storedPack;
    }
  } catch (error) {
    console.warn("Unable to read theme pack preference", error);
  }
  const relativeHref =
    packId === "default"
      ? "vendor/bootstrap/bootstrap.min.css"
      : `vendor/bootswatch/${packId}/bootstrap.min.css`;
  // Resolved against THIS script's own URL, not the page's — document.
  // currentScript is reliable here specifically because this script is
  // synchronous/non-module/non-deferred (see the file comment above), and
  // its own path is always "<pageDir>/.../common/js/theme-init.js" on every
  // page, one level up (../) from common/'s own root.
  const commonBase = new URL("../", document.currentScript.src);
  const stylesheetUrl = new URL(relativeHref, commonBase).href;
  document.write(`<link rel="stylesheet" href="${stylesheetUrl}" data-undercroft-bootstrap-link>`);
})();
