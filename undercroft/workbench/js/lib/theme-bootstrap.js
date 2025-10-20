(function () {
  const storageKey = "undercroft.workbench.theme";
  const THEMES = ["light", "system", "dark"];

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

  function applyAttributes(preference, resolved) {
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

  function apply(preference) {
    const resolved = resolveTheme(preference);
    applyAttributes(preference, resolved);
    return preference;
  }

  try {
    const stored = localStorage.getItem(storageKey);
    const preference = THEMES.includes(stored) ? stored : "system";
    apply(preference);
  } catch (error) {
    apply("system");
    if (typeof console !== "undefined") {
      console.warn("Theme bootstrap: unable to read preference", error);
    }
  }
})();
