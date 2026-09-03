// CSS class-name search/suggestions for a "Classes" (Advanced) inspector
// field, shared by Press and Workbench so the suggestion list and dropdown
// stay identical instead of drifting apart. The one Press-specific bit
// (wrapping a click in its own undo-stack recording) is an optional
// caller-supplied `wrapChange`. splitClassTokens is exported since Press's
// own COMPONENT_REQUIRED_CLASS_MAP handling (press/js/app.js) needs the
// same token-splitting helper.

// A short, deliberately non-overlapping reference list — nothing here
// duplicates a control the inspector already has a dedicated field for.
// "badge text-bg-primary" replaces what used to be a dedicated "Badge"
// field component in Press, which was really just Text with this combo.
export const CLASS_NAME_SUGGESTIONS = [
  { classes: "badge text-bg-primary", label: "Badge", description: "Pill-style badge background" },
  { classes: "text-body-secondary", label: "Muted", description: "Theme-aware secondary text color (adapts to light/dark)" },
  { classes: "flex-grow-1", label: "Fill space", description: "Expands to fill remaining space in a Layer or Grid" },
  { classes: "text-truncate", label: "Truncate", description: "Cuts off overflowing text with an ellipsis, single line" },
  { classes: "text-nowrap", label: "No wrap", description: "Keeps text on one line, never wraps" },
  { classes: "shadow-sm", label: "Shadow", description: "Soft drop shadow (box, not text)" },
  { classes: "text-shadow-dark", label: "Dark text shadow", description: "Dark shadow behind text — for light text over a busy/photo background" },
  { classes: "text-shadow-light", label: "Light text shadow", description: "Light shadow behind text — for dark text over a busy/photo background" },
];

export function splitClassTokens(value = "") {
  return value.split(/\s+/).filter(Boolean);
}

// Toggles the whole class combo as one unit, not each token independently
// — avoids leaving a half-applied combo behind. `wrapChange(fn)` lets a
// caller with its own undo stack (Press) record this as one undoable step.
function toggleClassNameSuggestion(input, suggestion, wrapChange) {
  const current = splitClassTokens(input.value);
  const toggleTokens = splitClassTokens(suggestion.classes);
  const hasAll = toggleTokens.every((token) => current.includes(token));
  const next = hasAll
    ? current.filter((token) => !toggleTokens.includes(token))
    : [...current, ...toggleTokens.filter((token) => !current.includes(token))];
  // Dispatches a real "input" event so it reuses the field's own existing
  // write path (undo, state commit) rather than needing a second one here.
  wrapChange(() => {
    input.value = next.join(" ");
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

function renderClassNameSuggestionRow(suggestion, isApplied) {
  const row = document.createElement("button");
  row.type = "button";
  row.className = "list-group-item list-group-item-action d-flex align-items-start gap-2 py-1";
  const check = document.createElement("span");
  check.className = "flex-shrink-0";
  check.style.width = "1rem";
  check.setAttribute("aria-hidden", "true");
  check.textContent = isApplied ? "✓" : "";
  const textWrap = document.createElement("span");
  textWrap.className = "d-flex flex-column";
  const label = document.createElement("span");
  label.className = "fw-semibold";
  label.textContent = suggestion.label;
  const description = document.createElement("small");
  description.className = "text-body-secondary";
  description.textContent = suggestion.description;
  textWrap.append(label, description);
  row.append(check, textWrap);
  return row;
}

// Mirrors attachIconAutocomplete's/attachFontFamilyAutocomplete's structure
// closely — the difference: this list is fixed (curated, not searched) and
// a click toggles rather than replaces, so the dropdown stays open for
// toggling more than one suggestion in a row.
function ensureClassNameAutocompleteContainer(input) {
  if (!input || !input.parentElement) return null;
  const parent = input.closest(".form-floating") ?? input.parentElement;
  parent.classList.add("position-relative");
  let container = parent.querySelector("[data-classname-autocomplete]");
  if (!container) {
    container = document.createElement("div");
    container.dataset.classnameAutocomplete = "true";
    container.className = "list-group position-absolute top-100 start-0 w-100 shadow-sm bg-body border mt-1 d-none";
    container.style.zIndex = "1300";
    container.style.fontSize = "0.8125rem";
    container.style.maxHeight = "16rem";
    container.style.overflowY = "auto";
    parent.appendChild(container);
  }
  return container;
}

export function attachClassNameAutocomplete(input, { wrapChange = (fn) => fn() } = {}) {
  if (!input) return null;
  const container = ensureClassNameAutocompleteContainer(input);
  if (!container) return null;
  let activeIndex = -1;

  const close = () => {
    activeIndex = -1;
    container.innerHTML = "";
    container.classList.add("d-none");
  };

  const render = () => {
    activeIndex = -1;
    const current = splitClassTokens(input.value);
    container.innerHTML = "";
    CLASS_NAME_SUGGESTIONS.forEach((suggestion, index) => {
      const tokens = splitClassTokens(suggestion.classes);
      const isApplied = tokens.length > 0 && tokens.every((token) => current.includes(token));
      const row = renderClassNameSuggestionRow(suggestion, isApplied);
      row.dataset.classnameIndex = String(index);
      row.setAttribute("role", "option");
      row.addEventListener("mousedown", (event) => event.preventDefault());
      row.addEventListener("click", () => {
        toggleClassNameSuggestion(input, suggestion, wrapChange);
        render();
      });
      container.appendChild(row);
    });
    container.classList.remove("d-none");
  };

  const onKeyDown = (event) => {
    if (container.classList.contains("d-none")) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      activeIndex = Math.min(activeIndex + 1, CLASS_NAME_SUGGESTIONS.length - 1);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      activeIndex = Math.max(activeIndex - 1, 0);
    } else if (event.key === "Enter") {
      if (activeIndex < 0 || !CLASS_NAME_SUGGESTIONS[activeIndex]) return;
      event.preventDefault();
      toggleClassNameSuggestion(input, CLASS_NAME_SUGGESTIONS[activeIndex], wrapChange);
      render();
      return;
    } else if (event.key === "Escape") {
      event.preventDefault();
      close();
      return;
    } else {
      return;
    }
    Array.from(container.querySelectorAll("[data-classname-index]")).forEach((row) => {
      row.classList.toggle("active", Number(row.dataset.classnameIndex) === activeIndex);
    });
  };

  input.addEventListener("focus", render);
  input.addEventListener("click", render);
  input.addEventListener("input", render);
  input.addEventListener("keydown", onKeyDown);
  input.addEventListener("blur", () => setTimeout(close, 120));

  return { render, close };
}
