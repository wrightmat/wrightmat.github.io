// The shared "Binding / Formula / Text" input control, used by both
// Workbench's template editor and Orrery's marker Vision Range field — the
// one shared implementation of the "Binding/Text" half of the project's
// Binding/Text vs Source convention (see undercroft/README.md's Component
// Inspector standards), extended here with Formula.
//
// Kept generic via caller-supplied callbacks rather than Workbench-specific
// coupling: `onCommit(mutator)` replaces a direct updateComponent call;
// `getSystemFields()` is called fresh on every keystroke/open instead of
// reading a closed-over field array, so a live System-selection change
// elsewhere is picked up without refocus; `evaluateFormulaPreview`/
// `resolveBindingPreview` let a caller preview against real data (Orrery's
// linked Character) instead of only synthetic sample data.
import { attachFormulaAutocomplete } from "./formula-autocomplete.js";
import { categorizeFieldType } from "./system-schema.js";
import { listFormulaFunctionMetadata } from "./formula-metadata.js";

const FORMULA_FUNCTIONS = listFormulaFunctionMetadata();

function normalizeBindingValue(value) {
  return typeof value === "string" ? value.trim() : "";
}

function componentHasFormula(data, { formulaKey = "formula" } = {}) {
  if (!formulaKey) return false;
  const value = data && typeof data[formulaKey] === "string" ? data[formulaKey] : "";
  return normalizeBindingValue(value).length > 0;
}

// Reads whatever's currently "in effect" for display in the input — formula
// (re-prefixed with "=") first, else a non-empty binding path, else the
// literal text sibling key (when textKey is configured), else "".
export function getBindingEditorValue(data, { bindingKey = "binding", formulaKey = "formula", textKey = null } = {}) {
  if (!data || typeof data !== "object") return "";
  if (componentHasFormula(data, { formulaKey })) {
    const expression = normalizeBindingValue(data[formulaKey]);
    return expression ? `=${expression}` : "";
  }
  const boundValue = bindingKey ? normalizeBindingValue(data[bindingKey]) : "";
  if (boundValue) return boundValue;
  if (textKey && typeof data[textKey] === "string") return data[textKey];
  return "";
}

function fieldMatchesCategories(entry, categories) {
  if (!Array.isArray(categories) || !categories.length) return true;
  const entryCategory = entry?.category || categorizeFieldType(entry?.type);
  if (!entryCategory) return categories.includes("string") || categories.includes("any");
  return categories.includes(entryCategory) || categories.includes("any");
}

const FIELD_TYPE_META = {
  string: { icon: "tabler:letter-case", label: "String" },
  number: { icon: "tabler:123", label: "Number" },
  boolean: { icon: "tabler:switch-3", label: "Boolean" },
  array: { icon: "tabler:brackets", label: "Array" },
  object: { icon: "tabler:braces", label: "Object" },
};
const DEFAULT_FIELD_TYPE_META = { icon: "tabler:question-mark", label: "Value" };

export function resolveFieldTypeMeta(categoryOrType) {
  const category = categoryOrType ? String(categoryOrType).toLowerCase() : "";
  return FIELD_TYPE_META[category] || DEFAULT_FIELD_TYPE_META;
}

// Fired whenever a caller's own field list changes (e.g. Workbench
// switching the selected System, or Orrery finishing a character-payload
// fetch that resolved a new set of bindable fields) — any currently-
// focused createBindingFormulaInput listens for this and refreshes its
// suggestion list live, without requiring blur/refocus.
export const BINDING_FIELDS_EVENT = "binding-field:fields-ready";
export function notifyBindingFieldsReady(detail = {}) {
  if (typeof window === "undefined" || typeof window.dispatchEvent !== "function") return;
  window.dispatchEvent(new CustomEvent(BINDING_FIELDS_EVENT, { detail }));
}

// Shared live feedback line under the input — a formula's syntax/runtime
// errors are otherwise silent, and this previews what a binding/formula
// currently resolves to. Plain literal text shows nothing (already fully
// visible in the input itself).
function createFieldPreviewFeedback({ evaluateFormulaPreview, resolveBindingPreview } = {}) {
  const element = document.createElement("div");
  element.className = "extra-small d-none";

  function update(raw, { supportsBinding = true, supportsFormula = true } = {}) {
    const trimmed = typeof raw === "string" ? raw.trim() : "";
    if (supportsFormula && trimmed.startsWith("=") && typeof evaluateFormulaPreview === "function") {
      const outcome = evaluateFormulaPreview(trimmed.slice(1).trim()) || {};
      element.classList.remove("d-none");
      if (!outcome.ok) {
        element.classList.add("text-danger");
        element.classList.remove("text-body-secondary");
        element.textContent = `Formula error: ${outcome.error || "Invalid formula"}`;
      } else {
        element.classList.remove("text-danger");
        element.classList.add("text-body-secondary");
        const preview = outcome.value === undefined || outcome.value === null || outcome.value === "" ? "(no value)" : String(outcome.value);
        element.textContent = `Preview: ${preview}`;
      }
      return;
    }
    if (supportsBinding && trimmed.startsWith("@") && typeof resolveBindingPreview === "function") {
      const resolved = resolveBindingPreview(trimmed);
      element.classList.remove("d-none", "text-danger");
      element.classList.add("text-body-secondary");
      const preview = resolved === undefined || resolved === null || String(resolved).trim() === "" ? "(no sample data for this field)" : String(resolved);
      element.textContent = `Preview: ${preview}`;
      return;
    }
    element.classList.add("d-none");
  }

  return { element, update };
}

// createBindingFormulaInput(data, options) — data is any plain object
// carrying bindingKey/formulaKey/textKey (a Workbench component, an Orrery
// marker element, anything). Returns a detached `.form-floating` wrapper
// element ready to append.
export function createBindingFormulaInput(
  data,
  {
    supportsBinding = true,
    supportsFormula = true,
    labelText = "Binding / Formula",
    placeholder = null,
    bindingKey = "binding",
    formulaKey = "formula",
    textKey = null,
    allowedFieldCategories = [],
    getSystemFields = () => [],
    hasSchemaSelected = true,
    // Off for a caller with no "select a system" step of its own to point at
    // (Orrery's marker Vision Range, only a linked Character) — Workbench's
    // template editor (a real System select right there) keeps this on.
    showEmptyFieldsHint = true,
    helperText = null,
    afterCommit = null,
    onCommit,
    evaluateFormulaPreview,
    resolveBindingPreview,
    idSeed = "binding-formula",
    // Matches inspector-fields.js's createHalfWidthNumberField exactly, for
    // a caller pairing this field alongside an ordinary compact number
    // field (Orrery's Vision Range next to Size). Workbench leaves this off
    // and keeps the floating-label look.
    compact = false,
  } = {}
) {
  if (typeof onCommit !== "function") {
    throw new Error("createBindingFormulaInput requires an onCommit(mutator) callback");
  }

  const wrapper = document.createElement("div");
  const id = `${idSeed}-${Math.random().toString(16).slice(2)}`;

  const input = document.createElement("input");
  input.type = "text";
  input.id = id;
  const resolvedPlaceholder =
    placeholder !== null && placeholder !== undefined
      ? placeholder
      : supportsFormula
      ? "@attributes.score or =sum(@attributes.strength, @attributes.dexterity)"
      : "@attributes.score";
  input.placeholder = resolvedPlaceholder || "";
  input.autocomplete = "off";
  input.spellcheck = false;
  input.value = getBindingEditorValue(data, { bindingKey, formulaKey, textKey });
  input.setAttribute("aria-autocomplete", "list");

  const label = document.createElement("label");
  label.setAttribute("for", id);
  label.textContent = labelText;

  if (compact) {
    // Label above the input (not form-floating's required input-before-
    // label order); position:relative set explicitly since form-floating's
    // utility class normally supplies it for the suggestions dropdown.
    wrapper.className = "d-flex flex-column gap-1";
    wrapper.style.position = "relative";
    label.className = "form-label extra-small text-body-secondary mb-0";
    input.className = "form-control form-control-sm";
    wrapper.append(label, input);
  } else {
    wrapper.className = "form-floating";
    label.className = "fw-semibold";
    input.className = "form-control";
    wrapper.append(input, label);
  }

  const suggestions = document.createElement("div");
  suggestions.className = "list-group position-absolute top-100 start-0 w-100 shadow-sm bg-body border mt-1 d-none";
  suggestions.id = `${id}-suggestions`;
  suggestions.setAttribute("role", "listbox");
  suggestions.style.zIndex = "1300";
  suggestions.style.fontSize = "0.8125rem";
  suggestions.style.maxHeight = "16rem";
  suggestions.style.overflowY = "auto";
  input.setAttribute("aria-controls", suggestions.id);

  const feedback = createFieldPreviewFeedback({ evaluateFormulaPreview, resolveBindingPreview });
  feedback.update(input.value, { supportsBinding, supportsFormula });

  wrapper.append(suggestions, feedback.element);

  const MAX_SUGGESTIONS = 12;
  let listeningForUpdates = false;

  const handleBindingFieldsReady = () => {
    if (document.activeElement === input) {
      autocomplete.update();
    }
  };

  function getFieldSuggestions(query = "") {
    if (!supportsBinding) return [];
    const normalized = query.trim().toLowerCase();
    const entries = Array.isArray(getSystemFields()) ? getSystemFields() : [];
    const typed = entries.filter((entry) => fieldMatchesCategories(entry, allowedFieldCategories));
    const filtered = normalized
      ? typed.filter((entry) => {
          const path = entry.path?.toLowerCase?.() || "";
          const label = entry.label?.toLowerCase?.() || "";
          return path.includes(normalized) || label.includes(normalized);
        })
      : typed;
    return filtered.slice(0, MAX_SUGGESTIONS).map((entry) => {
      const category = entry.category || categorizeFieldType(entry.type);
      return {
        type: "field",
        path: entry.path,
        display: `@${entry.path}`,
        description: entry.label && entry.label !== entry.path ? entry.label : "",
        fieldType: entry.type || "",
        fieldCategory: category || "",
      };
    });
  }

  function getFunctionSuggestions(query = "") {
    if (!supportsFormula) return [];
    const normalized = query.trim().toLowerCase();
    const entries = normalized
      ? FORMULA_FUNCTIONS.filter((fn) => fn.name.toLowerCase().startsWith(normalized))
      : FORMULA_FUNCTIONS;
    return entries.slice(0, MAX_SUGGESTIONS).map((fn) => ({
      type: "function",
      name: fn.name,
      display: fn.signature,
      description: fn.name,
    }));
  }

  function commitValue(raw) {
    const source = typeof raw === "string" ? raw : "";
    const trimmed = source.trim();
    let result = { type: "empty", value: "" };
    onCommit((draft) => {
      if (!trimmed) {
        if (bindingKey) draft[bindingKey] = "";
        if (supportsFormula && formulaKey) draft[formulaKey] = "";
        if (textKey) draft[textKey] = "";
        result = { type: "empty", value: "" };
      } else if (supportsFormula && trimmed.startsWith("=")) {
        const expression = trimmed.slice(1).trim();
        if (formulaKey) draft[formulaKey] = expression;
        if (bindingKey) draft[bindingKey] = "";
        if (textKey) draft[textKey] = "";
        result = { type: "formula", value: expression };
      } else if (textKey && !trimmed.startsWith("@")) {
        draft[textKey] = trimmed;
        if (bindingKey) draft[bindingKey] = "";
        if (supportsFormula && formulaKey) draft[formulaKey] = "";
        result = { type: "text", value: trimmed };
      } else {
        if (bindingKey) draft[bindingKey] = supportsBinding ? trimmed : "";
        if (supportsFormula && formulaKey) draft[formulaKey] = "";
        if (textKey) draft[textKey] = "";
        result = { type: "binding", value: trimmed };
      }
      if (typeof afterCommit === "function") {
        afterCommit({ draft, raw: source, trimmed, result });
      }
    });
  }

  const autocomplete = attachFormulaAutocomplete(input, {
    container: suggestions,
    supportsBinding,
    supportsFunctions: supportsFormula,
    getFieldItems: (query) => getFieldSuggestions(query),
    getFunctionItems: (query) => getFunctionSuggestions(query),
    resolveFieldMeta: resolveFieldTypeMeta,
    maxItems: MAX_SUGGESTIONS,
    applySuggestion: ({ applyDefault }) => {
      applyDefault();
      commitValue(input.value);
      feedback.update(input.value, { supportsBinding, supportsFormula });
    },
  });

  input.addEventListener("input", () => {
    commitValue(input.value);
    autocomplete.update();
    feedback.update(input.value, { supportsBinding, supportsFormula });
  });

  input.addEventListener("focus", () => {
    if (!listeningForUpdates) {
      window.addEventListener(BINDING_FIELDS_EVENT, handleBindingFieldsReady);
      listeningForUpdates = true;
    }
    autocomplete.update();
  });

  input.addEventListener("click", () => {
    autocomplete.update();
  });

  input.addEventListener("blur", () => {
    setTimeout(() => {
      autocomplete.close();
      if (listeningForUpdates) {
        window.removeEventListener(BINDING_FIELDS_EVENT, handleBindingFieldsReady);
        listeningForUpdates = false;
      }
    }, 120);
  });

  if (helperText) {
    const helper = document.createElement("div");
    helper.className = "form-text text-body-secondary";
    helper.textContent = helperText;
    wrapper.appendChild(helper);
  }

  if (showEmptyFieldsHint && supportsBinding && !(Array.isArray(getSystemFields()) && getSystemFields().length)) {
    const helper = document.createElement("div");
    helper.className = "form-text text-body-secondary";
    helper.textContent = hasSchemaSelected ? "No fields available for this system yet." : "Select a system to enable bindings.";
    wrapper.appendChild(helper);
  }

  return wrapper;
}
