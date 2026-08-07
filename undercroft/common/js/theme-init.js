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
// Kept independent from common/js/lib/theme.js's own initThemeControls —
// that one wires the header's theme buttons and runs later, after <body>
// exists; this one only ever needs to win the race against first paint.
(function () {
  const storageKey = "undercroft.workbench.theme";
  const THEMES = ["light", "system", "dark"];
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
})();
