const STORAGE_KEY = "undercroft.workbench.theme";
const THEMES = ["light", "system", "dark"];

function prefersDark() {
  return (
    typeof window !== "undefined" &&
    window.matchMedia &&
    window.matchMedia("(prefers-color-scheme: dark)").matches
  );
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
  const safeTheme = THEMES.includes(theme) ? theme : "system";
  const root = document.documentElement;
  root.dataset.theme = safeTheme;
  const darkMode = safeTheme === "dark" || (safeTheme === "system" && prefersDark());
  root.classList.toggle("dark", darkMode);
  try {
    if (safeTheme === "system") {
      localStorage.removeItem(STORAGE_KEY);
    } else {
      localStorage.setItem(STORAGE_KEY, safeTheme);
    }
  } catch (error) {
    console.warn("Theme: unable to persist preference", error);
  }
  return safeTheme;
}

export function initThemeControls(root = document) {
  const preference = getThemePreference();
  applyTheme(preference);
  const controls = Array.from(root.querySelectorAll("[data-theme-option]"));
  controls.forEach((control) => {
    const option = control.getAttribute("data-theme-option");
    control.dataset.active = option === preference ? "true" : "false";
    control.setAttribute("aria-pressed", option === preference ? "true" : "false");
    control.addEventListener("click", () => {
      const selected = applyTheme(option);
      controls.forEach((btn) => {
        const btnOption = btn.getAttribute("data-theme-option");
        const isActive = btnOption === selected;
        btn.dataset.active = isActive ? "true" : "false";
        btn.setAttribute("aria-pressed", isActive ? "true" : "false");
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
        });
      }
    };
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    media.addEventListener("change", listener);
  }
}
