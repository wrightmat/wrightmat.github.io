const DEFAULT_MAX_ITEMS = 12;

function normalizeOptions(options = {}) {
  const {
    supportsBinding = true,
    supportsFunctions = true,
    resolveFieldMeta = null,
    functionIcon = "",
    maxItems = DEFAULT_MAX_ITEMS,
  } = options;
  return {
    ...options,
    supportsBinding,
    supportsFunctions,
    resolveFieldMeta: typeof resolveFieldMeta === "function" ? resolveFieldMeta : null,
    functionIcon: typeof functionIcon === "string" ? functionIcon : "",
    maxItems: Number.isFinite(maxItems) && maxItems > 0 ? Math.floor(maxItems) : DEFAULT_MAX_ITEMS,
  };
}

function createDefaultOptionRenderer({ resolveFieldMeta, functionIcon }) {
  return (item) => {
    const option = document.createElement("button");
    option.type = "button";
    option.className = "list-group-item list-group-item-action d-flex align-items-center gap-2 py-1";

    const row = document.createElement("div");
    row.className = "d-flex align-items-center gap-2 flex-grow-1 text-start";
    row.style.minWidth = "0";

    if (item.type === "field" && resolveFieldMeta) {
      const meta = resolveFieldMeta(item.fieldCategory || item.fieldType);
      if (meta && meta.icon) {
        const icon = document.createElement("span");
        icon.className = "iconify flex-shrink-0 text-body-tertiary";
        icon.dataset.icon = meta.icon;
        icon.setAttribute("aria-hidden", "true");
        icon.style.fontSize = "1rem";
        row.appendChild(icon);
      }
    } else if (item.type === "function" && functionIcon) {
      const icon = document.createElement("span");
      icon.className = "iconify flex-shrink-0 text-body-tertiary";
      icon.dataset.icon = functionIcon;
      icon.setAttribute("aria-hidden", "true");
      icon.style.fontSize = "1rem";
      row.appendChild(icon);
    }

    const label = document.createElement("span");
    label.className = "text-truncate";
    label.textContent = item.display || item.name || "";
    row.appendChild(label);

    option.appendChild(row);

    if (item.description) {
      const hint = document.createElement("small");
      hint.className = "text-body-secondary text-nowrap text-end ms-auto";
      hint.textContent = item.description;
      option.appendChild(hint);
    }

    return option;
  };
}

function defaultApplySuggestion(input, item, context) {
  const value = input.value || "";
  const start = context?.startIndex ?? 0;
  const end = context?.endIndex ?? start;
  const before = value.slice(0, start);
  const after = value.slice(end);

  if (item.type === "field") {
    const inserted = item.path || item.value || "";
    const nextValue = `${before}${inserted}${after}`;
    input.value = nextValue;
    const caret = before.length + inserted.length;
    if (typeof input.setSelectionRange === "function") {
      input.setSelectionRange(caret, caret);
    }
    return;
  }

  if (item.type === "function") {
    const name = item.name || item.value || "";
    const nextValue = `${before}${name}()${after}`;
    input.value = nextValue;
    const caret = before.length + name.length + 1;
    if (typeof input.setSelectionRange === "function") {
      input.setSelectionRange(caret, caret);
    }
    return;
  }

  const inserted = item.value || item.display || "";
  const nextValue = `${before}${inserted}${after}`;
  input.value = nextValue;
  const caret = before.length + inserted.length;
  if (typeof input.setSelectionRange === "function") {
    input.setSelectionRange(caret, caret);
  }
}

export function attachFormulaAutocomplete(input, options = {}) {
  if (!input) {
    throw new Error("attachFormulaAutocomplete requires an input element");
  }
  const normalized = normalizeOptions(options);
  const {
    container,
    supportsBinding,
    supportsFunctions,
    getFieldItems = () => [],
    getFunctionItems = () => [],
    renderItem,
    applySuggestion,
    onAfterApply,
    maxItems,
  } = normalized;

  if (!container) {
    throw new Error("attachFormulaAutocomplete requires a container element");
  }

  const renderOption =
    typeof renderItem === "function"
      ? renderItem
      : createDefaultOptionRenderer({
          resolveFieldMeta: normalized.resolveFieldMeta,
          functionIcon: normalized.functionIcon,
        });

  const suggestionState = {
    items: [],
    activeIndex: -1,
    context: null,
  };

  const baseId = container.id || input.id || `formula-autocomplete-${Math.random().toString(36).slice(2, 8)}`;
  if (!container.id) {
    container.id = `${baseId}-list`;
  }

  function closeSuggestions() {
    suggestionState.items = [];
    suggestionState.activeIndex = -1;
    suggestionState.context = null;
    container.innerHTML = "";
    container.classList.add("d-none");
    input.removeAttribute("aria-activedescendant");
  }

  function setActive(index) {
    if (!suggestionState.items.length) {
      return;
    }
    const clamped = Math.max(0, Math.min(index, suggestionState.items.length - 1));
    suggestionState.activeIndex = clamped;
    const options = Array.from(container.querySelectorAll("[data-suggestion-index]"));
    options.forEach((option) => {
      const optionIndex = Number(option.dataset.suggestionIndex);
      const isActive = optionIndex === clamped;
      option.setAttribute("aria-selected", isActive ? "true" : "false");
      if (isActive) {
        option.classList.add("active");
        input.setAttribute("aria-activedescendant", option.id);
      } else {
        option.classList.remove("active");
      }
    });
  }

  function moveActive(delta) {
    if (!suggestionState.items.length) {
      return;
    }
    const nextIndex =
      suggestionState.activeIndex < 0 ? 0 : suggestionState.activeIndex + delta;
    setActive(nextIndex);
  }

  function applyActiveSuggestion() {
    if (suggestionState.activeIndex < 0 || suggestionState.activeIndex >= suggestionState.items.length) {
      return;
    }
    applySuggestionAt(suggestionState.activeIndex);
  }

  function applySuggestionAt(index) {
    const item = suggestionState.items[index];
    if (!item) {
      return;
    }
    const context = suggestionState.context || { startIndex: 0, endIndex: 0 };
    const applyDefault = () => defaultApplySuggestion(input, item, context);

    if (typeof applySuggestion === "function") {
      applySuggestion({ item, context, input, applyDefault });
    } else {
      applyDefault();
    }

    if (typeof onAfterApply === "function") {
      onAfterApply({ item, context, input });
    }

    closeSuggestions();
  }

  function renderSuggestions(items, context) {
    suggestionState.items = items.slice(0, maxItems);
    suggestionState.context = context;
    suggestionState.activeIndex = -1;
    container.innerHTML = "";

    if (!suggestionState.items.length) {
      closeSuggestions();
      return;
    }

    suggestionState.items.forEach((item, index) => {
      const option = renderOption(item, index, { input });
      if (!option) {
        return;
      }
      option.dataset.suggestionIndex = String(index);
      option.id = `${baseId}-option-${index}`;
      option.setAttribute("role", "option");
      option.tabIndex = -1;
      option.setAttribute("tabindex", "-1");
      option.setAttribute("aria-selected", "false");
      option.addEventListener("mousedown", (event) => event.preventDefault());
      option.addEventListener("click", () => {
        applySuggestionAt(index);
      });
      container.appendChild(option);
    });

    container.classList.remove("d-none");
    setActive(0);
  }

  function updateSuggestions() {
    const value = input.value || "";
    const caret =
      typeof input.selectionStart === "number" && input.selectionStart >= 0
        ? input.selectionStart
        : value.length;
    const beforeCaret = value.slice(0, caret);

    if (supportsBinding) {
      const atIndex = beforeCaret.lastIndexOf("@");
      if (atIndex !== -1) {
        const query = beforeCaret.slice(atIndex + 1);
        const fieldItems = getFieldItems(query, { value, caret }) || [];
        if (fieldItems.length) {
          renderSuggestions(fieldItems, { type: "field", startIndex: atIndex + 1, endIndex: caret });
          return;
        }
      }
    }

    if (supportsFunctions && value.trim().startsWith("=")) {
      const equalsIndex = value.indexOf("=");
      if (equalsIndex !== -1 && caret >= equalsIndex + 1) {
        const query = value.slice(equalsIndex + 1, caret);
        const functionItems = getFunctionItems(query, { value, caret }) || [];
        if (functionItems.length) {
          renderSuggestions(functionItems, { type: "function", startIndex: equalsIndex + 1, endIndex: caret });
          return;
        }
      }
    }

    closeSuggestions();
  }

  const handleInput = () => {
    updateSuggestions();
  };

  const handleFocus = () => {
    updateSuggestions();
  };

  const handleClick = () => {
    updateSuggestions();
  };

  const handleKeyDown = (event) => {
    if (!suggestionState.items.length) {
      return;
    }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      moveActive(1);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      moveActive(-1);
    } else if (event.key === "Enter") {
      event.preventDefault();
      applyActiveSuggestion();
    } else if (event.key === "Escape") {
      event.preventDefault();
      closeSuggestions();
    }
  };

  const handleBlur = () => {
    setTimeout(() => {
      closeSuggestions();
    }, 120);
  };

  input.addEventListener("input", handleInput);
  input.addEventListener("focus", handleFocus);
  input.addEventListener("click", handleClick);
  input.addEventListener("keydown", handleKeyDown);
  input.addEventListener("blur", handleBlur);

  return {
    update: updateSuggestions,
    close: closeSuggestions,
    destroy() {
      input.removeEventListener("input", handleInput);
      input.removeEventListener("focus", handleFocus);
      input.removeEventListener("click", handleClick);
      input.removeEventListener("keydown", handleKeyDown);
      input.removeEventListener("blur", handleBlur);
      closeSuggestions();
    },
  };
}

export default attachFormulaAutocomplete;
