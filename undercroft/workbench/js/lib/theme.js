const STORAGE_KEY = "undercroft.workbench.theme";
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
