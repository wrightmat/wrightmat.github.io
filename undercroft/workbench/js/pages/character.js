import { initAppShell } from "../lib/app-shell.js";
import { populateSelect } from "../lib/dropdown.js";
import { DataManager } from "../lib/data-manager.js";
import { createCanvasPlaceholder } from "../lib/editor-canvas.js";
import { createCanvasCardElement, createStandardCardChrome } from "../lib/canvas-card.js";
import { createJsonPreviewRenderer } from "../lib/json-preview.js";
import { refreshTooltips } from "../lib/tooltips.js";
import { resolveApiBase } from "../lib/api.js";
import { BUILTIN_TEMPLATES } from "../lib/content-registry.js";
import { COMPONENT_ICONS, applyComponentStyles, applyTextFormatting } from "../lib/component-styles.js";

const BUILTIN_CHARACTERS = [
  {
    id: "cha_01k26cm0jxDR5V4R1Q4N56B5RH",
    title: "Elandra (Demo)",
    path: "data/characters/cha_01k26cm0jxDR5V4R1Q4N56B5RH.json",
    template: "tpl.5e.flex-basic",
    source: "builtin",
  },
];

(() => {
  const { status } = initAppShell({ namespace: "character" });
  const dataManager = new DataManager({ baseUrl: resolveApiBase() });

  const templateCatalog = new Map();
  const characterCatalog = new Map();

  const state = {
    mode: "view",
    template: null,
    components: [],
    character: null,
    draft: null,
  };

  let notesEditor = null;
  let suppressNotesChange = false;
  let currentNotesKey = "";
  let componentCounter = 0;

  const elements = {
    templateSelect: document.querySelector("[data-template-select]"),
    characterSelect: document.querySelector("[data-character-select]"),
    canvasRoot: document.querySelector("[data-canvas-root]"),
    saveButton: document.querySelector('[data-action="save-character"]'),
    undoButton: document.querySelector('[data-action="undo-character"]'),
    redoButton: document.querySelector('[data-action="redo-character"]'),
    importButton: document.querySelector('[data-action="import-character"]'),
    exportButton: document.querySelector('[data-action="export-character"]'),
    newCharacterButton: document.querySelector('[data-action="new-character"]'),
    resetButton: document.querySelector('[data-action="reset-character"]'),
    viewToggle: document.querySelector('[data-action="toggle-mode"]'),
    modeIndicator: document.querySelector("[data-mode-indicator]"),
    noteEditor: document.querySelector("[data-note-editor]"),
    jsonPreview: document.querySelector("[data-json-preview]"),
    jsonPreviewBytes: document.querySelector("[data-preview-bytes]"),
    diceForm: document.querySelector("[data-dice-form]"),
    diceExpression: document.querySelector("[data-dice-expression]"),
    diceResult: document.querySelector("[data-dice-result]"),
  };

  const renderPreview = createJsonPreviewRenderer({
    target: elements.jsonPreview,
    bytesTarget: elements.jsonPreviewBytes,
    serialize: () => state.draft || {},
  });

  registerBuiltinContent();
  initNotesEditor();
  initDiceRoller();
  bindUiEvents();
  loadTemplateRecords();
  loadCharacterRecords();
  syncModeIndicator();
  renderCanvas();
  renderPreview();

  function bindUiEvents() {
    if (elements.templateSelect) {
      elements.templateSelect.addEventListener("change", async () => {
        const selectedId = elements.templateSelect.value;
        if (selectedId) {
          await loadTemplateById(selectedId, { announce: true });
        }
      });
    }

    if (elements.characterSelect) {
      elements.characterSelect.addEventListener("change", async () => {
        const selectedId = elements.characterSelect.value;
        if (selectedId) {
          await loadCharacter(selectedId);
        }
      });
    }

    if (elements.saveButton) {
      elements.saveButton.addEventListener("click", () => {
        if (!state.draft?.id) {
          status.show("Create or load a character first.", { type: "info", timeout: 2000 });
          return;
        }
        persistDraft({ silent: false });
      });
    }

    if (elements.undoButton) {
      elements.undoButton.addEventListener("click", () => {
        status.show("Undo coming soon", { type: "info", timeout: 1800 });
      });
    }

    if (elements.redoButton) {
      elements.redoButton.addEventListener("click", () => {
        status.show("Redo coming soon", { type: "info", timeout: 1800 });
      });
    }

    if (elements.importButton) {
      elements.importButton.addEventListener("click", () => {
        status.show("Import coming soon", { type: "info", timeout: 2000 });
      });
    }

    if (elements.exportButton) {
      elements.exportButton.addEventListener("click", () => {
        if (!state.draft) {
          status.show("Nothing to export yet.", { type: "info", timeout: 2000 });
          return;
        }
        exportDraft();
      });
    }

    if (elements.newCharacterButton) {
      elements.newCharacterButton.addEventListener("click", () => {
        createNewCharacter();
      });
    }

    if (elements.resetButton) {
      elements.resetButton.addEventListener("click", () => {
        resetDraft();
      });
    }

    if (elements.viewToggle) {
      elements.viewToggle.addEventListener("click", () => {
        state.mode = state.mode === "edit" ? "view" : "edit";
        syncModeIndicator();
        renderCanvas();
        status.show(state.mode === "edit" ? "Edit mode enabled" : "View mode enabled", {
          type: "info",
          timeout: 1500,
        });
      });
    }
  }

  function registerBuiltinContent() {
    BUILTIN_TEMPLATES.forEach((template) => {
      registerTemplateRecord({
        id: template.id,
        title: template.title,
        path: template.path,
        source: "builtin",
      });
    });
    BUILTIN_CHARACTERS.forEach((character) => {
      registerCharacterRecord({
        id: character.id,
        title: character.title,
        path: character.path,
        template: character.template,
        source: character.source || "builtin",
      });
    });
  }

  function registerTemplateRecord(record) {
    if (!record || !record.id) {
      return;
    }
    const current = templateCatalog.get(record.id) || {};
    templateCatalog.set(record.id, { ...current, ...record });
    syncTemplateOptions();
  }

  function registerCharacterRecord(record) {
    if (!record || !record.id) {
      return;
    }
    const current = characterCatalog.get(record.id) || {};
    characterCatalog.set(record.id, { ...current, ...record });
    syncCharacterOptions();
  }

  function syncTemplateOptions() {
    if (!elements.templateSelect) {
      return;
    }
    const options = Array.from(templateCatalog.values())
      .filter((entry) => entry.id)
      .sort((a, b) => (a.title || a.id).localeCompare(b.title || b.id, undefined, { sensitivity: "base" }))
      .map((entry) => ({ value: entry.id, label: entry.title || entry.id }));
    populateSelect(elements.templateSelect, options, { placeholder: "Select template" });
    if (state.template?.id) {
      elements.templateSelect.value = state.template.id;
    }
  }

  function syncCharacterOptions() {
    if (!elements.characterSelect) {
      return;
    }
    const options = Array.from(characterCatalog.values())
      .filter((entry) => entry.id)
      .sort((a, b) => (a.title || a.id).localeCompare(b.title || b.id, undefined, { sensitivity: "base" }))
      .map((entry) => ({ value: entry.id, label: entry.title || entry.id }));
    populateSelect(elements.characterSelect, options, { placeholder: "Select character" });
    if (state.draft?.id) {
      elements.characterSelect.value = state.draft.id;
    }
  }

  function initNotesEditor() {
    if (!elements.noteEditor || !window.toastui || !window.toastui.Editor) {
      return;
    }
    notesEditor = new window.toastui.Editor({
      el: elements.noteEditor,
      height: "100%",
      initialEditType: "markdown",
      previewStyle: "vertical",
      usageStatistics: false,
      placeholder: "Capture quick notes for this session...",
    });
    notesEditor.on("change", () => {
      if (suppressNotesChange) {
        return;
      }
      persistNotes(notesEditor.getMarkdown());
    });
    syncNotesEditor();
  }

  function initDiceRoller() {
    if (!elements.diceForm || !elements.diceExpression || !elements.diceResult) {
      return;
    }
    elements.diceForm.addEventListener("submit", (event) => {
      event.preventDefault();
      const expression = elements.diceExpression.value.trim();
      if (!expression) {
        elements.diceResult.textContent = "Enter a dice expression like 2d6 + 3.";
        return;
      }
      const result = rollDiceExpression(expression);
      if (!result) {
        elements.diceResult.textContent = "Unsupported expression. Try NdM ± K.";
        return;
      }
      const { total, rolls, modifier } = result;
      const breakdown = `${rolls.join(" + ")}${modifier ? (modifier > 0 ? ` + ${modifier}` : ` - ${Math.abs(modifier)}`) : ""}`;
      elements.diceResult.innerHTML = `<strong>Total:</strong> ${total}<br /><span class="text-body-secondary">${breakdown}</span>`;
    });
  }

  function rollDiceExpression(input) {
    const trimmed = input.replace(/\s+/g, "").toLowerCase();
    const match = trimmed.match(/^(\d*)d(\d+)([+-]\d+)?$/);
    if (!match) {
      return null;
    }
    const count = Math.min(Math.max(parseInt(match[1] || "1", 10), 1), 100);
    const sides = Math.min(Math.max(parseInt(match[2], 10), 2), 1000);
    const modifier = match[3] ? parseInt(match[3], 10) : 0;
    const rolls = [];
    for (let index = 0; index < count; index += 1) {
      rolls.push(1 + Math.floor(Math.random() * sides));
    }
    const total = rolls.reduce((sum, value) => sum + value, 0) + modifier;
    return { total, rolls, modifier };
  }

  async function loadTemplateRecords() {
    try {
      const localEntries = dataManager.listLocalEntries("templates");
      localEntries.forEach(({ id, payload }) => {
        if (!id) return;
        registerTemplateRecord({
          id,
          title: payload?.title || id,
          schema: payload?.schema || payload?.system || "",
          source: "local",
        });
      });
    } catch (error) {
      console.warn("Character editor: unable to read local templates", error);
    }
    syncTemplateOptions();
  }

  async function loadCharacterRecords() {
    try {
      const localEntries = dataManager.listLocalEntries("characters");
      localEntries.forEach(({ id, payload }) => {
        if (!id) return;
        registerCharacterRecord({
          id,
          title: payload?.data?.name || payload?.title || id,
          template: payload?.template || "",
          source: "local",
        });
      });
    } catch (error) {
      console.warn("Character editor: unable to read local characters", error);
    }
    syncCharacterOptions();
  }

  async function loadTemplateById(id, { announce = false } = {}) {
    if (!id) {
      return;
    }
    try {
      const metadata = templateCatalog.get(id);
      if (!metadata) {
        throw new Error("Template metadata unavailable");
      }
      const payload = await fetchTemplatePayload(metadata);
      if (!payload) {
        throw new Error("Template payload missing");
      }
      applyTemplateData(payload, { origin: metadata.source || "remote" });
      if (announce) {
        status.show(`Loaded template ${payload.title || id}`, { type: "success", timeout: 1800 });
      }
    } catch (error) {
      console.error("Character editor: failed to load template", error);
      status.show("Unable to load template", { type: "error", timeout: 2500 });
    }
  }

  async function fetchTemplatePayload(metadata) {
    if (!metadata) {
      return null;
    }
    if (metadata.source === "local") {
      const local = dataManager.getLocal("templates", metadata.id);
      if (local) {
        return JSON.parse(JSON.stringify(local));
      }
    }
    if (metadata.source === "builtin" && metadata.path) {
      const response = await fetch(metadata.path);
      if (!response.ok) {
        throw new Error(`Failed to fetch template: ${response.status}`);
      }
      return await response.json();
    }
    if (metadata.source === "remote" && dataManager.baseUrl) {
      const result = await dataManager.get("templates", metadata.id, { preferLocal: true });
      return result?.payload || null;
    }
    return null;
  }

  function applyTemplateData(payload, { origin = "remote" } = {}) {
    const template = {
      id: payload.id || payload.template || "",
      title: payload.title || payload.name || payload.id || "",
      schema: payload.schema || payload.system || "",
      origin,
    };
    componentCounter = 0;
    const components = Array.isArray(payload.components)
      ? payload.components.map((component) => hydrateComponent(component)).filter(Boolean)
      : [];
    state.template = template;
    state.components = components;
    if (template.id) {
      registerTemplateRecord({
        id: template.id,
        title: template.title || template.id,
        schema: template.schema || "",
        source: origin,
      });
    }
    if (state.draft) {
      state.draft.template = template.id;
    }
    if (elements.templateSelect && template.id) {
      elements.templateSelect.value = template.id;
    }
    renderCanvas();
    renderPreview();
    syncTemplateOptions();
  }

  async function loadCharacter(id) {
    if (!id) {
      return;
    }
    try {
      const metadata = characterCatalog.get(id);
      if (!metadata) {
        throw new Error("Character metadata missing");
      }
      const payload = await fetchCharacterPayload(metadata);
      if (!payload) {
        throw new Error("Character payload missing");
      }
      state.character = cloneCharacter(payload);
      state.draft = cloneCharacter(payload);
      registerCharacterRecord({
        id: state.draft.id,
        title: state.draft.data?.name || metadata.title || state.draft.id,
        template: state.draft.template || metadata.template || "",
        source: metadata.source,
      });
      if (state.draft.template) {
        await loadTemplateById(state.draft.template);
      }
      if (!state.draft.data || typeof state.draft.data !== "object") {
        state.draft.data = {};
      }
      syncNotesEditor();
      renderCanvas();
      renderPreview();
      syncCharacterOptions();
      status.show(`Loaded ${state.draft.data?.name || metadata.title || state.draft.id}`, {
        type: "success",
        timeout: 2000,
      });
    } catch (error) {
      console.error("Character editor: failed to load character", error);
      status.show("Unable to load character", { type: "error", timeout: 2500 });
    }
  }

  async function fetchCharacterPayload(metadata) {
    if (!metadata) {
      return null;
    }
    if (metadata.source === "local") {
      const local = dataManager.getLocal("characters", metadata.id);
      if (local) {
        return JSON.parse(JSON.stringify(local));
      }
    }
    if (metadata.source === "builtin" && metadata.path) {
      const response = await fetch(metadata.path);
      if (!response.ok) {
        throw new Error(`Failed to fetch character: ${response.status}`);
      }
      return await response.json();
    }
    if (metadata.source === "remote" && dataManager.baseUrl) {
      const result = await dataManager.get("characters", metadata.id, { preferLocal: true });
      return result?.payload || null;
    }
    return null;
  }

  function renderCanvas() {
    if (!elements.canvasRoot) {
      return;
    }
    elements.canvasRoot.innerHTML = "";
    if (!state.template?.id) {
      elements.canvasRoot.appendChild(
        createCanvasPlaceholder("Select a template to preview the sheet.", { variant: "root" })
      );
      refreshTooltips(elements.canvasRoot);
      syncModeIndicator();
      return;
    }
    if (!state.components.length) {
      elements.canvasRoot.appendChild(
        createCanvasPlaceholder("This template has no components yet.", { variant: "root" })
      );
      refreshTooltips(elements.canvasRoot);
      syncModeIndicator();
      return;
    }
    const fragment = document.createDocumentFragment();
    state.components.forEach((component) => {
      fragment.appendChild(renderComponentCard(component));
    });
    elements.canvasRoot.appendChild(fragment);
    refreshTooltips(elements.canvasRoot);
    syncModeIndicator();
  }

  function renderComponentCard(component) {
    const iconName = COMPONENT_ICONS[component.type] || "tabler:app-window";
    const wrapper = createCanvasCardElement({
      classes: ["character-component"],
      dataset: { componentId: component.uid || "" },
      gapClass: "gap-3",
    });
    const { header, actions, iconElement } = createStandardCardChrome({
      icon: iconName,
      iconLabel: component.type,
      headerOptions: { classes: ["character-component-header"] },
      actionsOptions: { classes: ["character-component-actions"] },
      iconOptions: { classes: ["character-component-icon"] },
      removeButtonOptions: false,
    });
    const title = document.createElement("div");
    title.className = "fw-semibold";
    title.textContent = component.label || component.name || component.type;
    applyTextFormatting(title, component);
    header.insertBefore(title, actions);
    if (component.binding) {
      const badge = document.createElement("span");
      badge.className = "badge text-bg-secondary";
      badge.textContent = component.binding.trim();
      if (iconElement && actions.contains(iconElement)) {
        actions.insertBefore(badge, iconElement);
      } else {
        actions.appendChild(badge);
      }
    }
    wrapper.appendChild(header);
    const body = renderComponentContent(component);
    wrapper.appendChild(body);
    applyComponentStyles(wrapper, component);
    return wrapper;
  }

  function renderComponentContent(component) {
    switch (component.type) {
      case "input":
        return renderInputComponent(component);
      case "array":
        return renderArrayComponent(component);
      case "divider":
        return renderDividerComponent(component);
      case "image":
        return renderImageComponent(component);
      case "label":
        return renderLabelComponent(component);
      case "container":
        return renderContainerComponent(component);
      case "linear-track":
        return renderLinearTrackComponent(component);
      case "circular-track":
        return renderCircularTrackComponent(component);
      case "select-group":
        return renderSelectGroupComponent(component);
      case "toggle":
        return renderToggleComponent(component);
      default: {
        const unsupported = document.createElement("p");
        unsupported.className = "text-body-secondary mb-0";
        unsupported.textContent = `Unsupported component: ${component.type}`;
        return unsupported;
      }
    }
  }

  function renderInputComponent(component) {
    const wrapper = document.createElement("div");
    wrapper.className = "d-flex flex-column gap-2";
    const labelText = component.label || component.name || "Field";
    if (labelText) {
      const label = document.createElement("label");
      label.className = "form-label fw-semibold text-body-secondary mb-0";
      label.textContent = labelText;
      applyTextFormatting(label, component);
      wrapper.appendChild(label);
    }
    const editable = isEditable(component);
    const value = getBindingValue(component.binding);
    const variant = component.variant || "text";

    if (variant === "select") {
      const select = document.createElement("select");
      select.className = "form-select";
      (component.options || []).forEach((option) => {
        const opt = document.createElement("option");
        if (typeof option === "string") {
          opt.value = option;
          opt.textContent = option;
        } else {
          opt.value = option.value;
          opt.textContent = option.label;
        }
        if (opt.value === value) {
          opt.selected = true;
        }
        select.appendChild(opt);
      });
      select.disabled = !editable;
      if (editable) {
        select.addEventListener("change", () => {
          updateBinding(component.binding, select.value);
        });
      }
      wrapper.appendChild(select);
      return wrapper;
    }

    if (variant === "radio" || variant === "checkbox") {
      const group = document.createElement("div");
      group.className = "d-flex flex-wrap gap-2";
      const options = Array.isArray(component.options) ? component.options : [];
      const currentValue = variant === "checkbox"
        ? Array.isArray(value)
          ? value.map(String)
          : []
        : value == null
        ? ""
        : String(value);
      options.forEach((option, index) => {
        const optionValue = typeof option === "string" ? option : option.value;
        const optionLabel = typeof option === "string" ? option : option.label;
        const id = `${component.uid}-${variant}-${index}`;
        const formCheck = document.createElement("div");
        formCheck.className = "form-check form-check-inline";
        const input = document.createElement("input");
        input.className = "form-check-input";
        input.type = variant;
        input.name = `${component.uid}-${variant}`;
        input.id = id;
        input.disabled = !editable;
        if (variant === "radio") {
          input.value = optionValue;
          input.checked = optionValue === currentValue;
        } else {
          input.value = optionValue;
          input.checked = currentValue.includes(String(optionValue));
        }
        if (editable) {
          input.addEventListener("change", () => {
            if (variant === "radio") {
              updateBinding(component.binding, input.value);
            } else {
              const checkedValues = Array.from(group.querySelectorAll("input[type=checkbox]"))
                .filter((node) => node.checked)
                .map((node) => node.value);
              updateBinding(component.binding, checkedValues);
            }
          });
        }
        const optionLabelEl = document.createElement("label");
        optionLabelEl.className = "form-check-label";
        optionLabelEl.setAttribute("for", id);
        optionLabelEl.textContent = optionLabel;
        formCheck.append(input, optionLabelEl);
        group.appendChild(formCheck);
      });
      wrapper.appendChild(group);
      return wrapper;
    }

    const input = document.createElement("input");
    input.className = "form-control";
    if (variant === "number") {
      input.type = "number";
      if (component.min !== undefined) input.min = component.min;
      if (component.max !== undefined) input.max = component.max;
      if (component.step !== undefined) input.step = component.step;
      input.value = value ?? "";
      input.disabled = !editable;
      if (editable) {
        input.addEventListener("input", () => {
          const raw = input.value;
          if (raw === "") {
            updateBinding(component.binding, null);
            return;
          }
          const next = Number(raw);
          updateBinding(component.binding, Number.isNaN(next) ? raw : next);
        });
      }
    } else {
      input.type = component.inputType || "text";
      input.placeholder = component.placeholder || "";
      input.value = value ?? "";
      input.disabled = !editable;
      if (editable) {
        input.addEventListener("input", () => {
          updateBinding(component.binding, input.value);
        });
      }
    }
    wrapper.appendChild(input);
    return wrapper;
  }

  function renderArrayComponent(component) {
    const wrapper = document.createElement("div");
    wrapper.className = "d-flex flex-column gap-2";
    const heading = document.createElement("div");
    heading.className = "fw-semibold text-body-secondary";
    heading.textContent = component.label || component.name || "Array";
    applyTextFormatting(heading, component);
    wrapper.appendChild(heading);
    const textarea = document.createElement("textarea");
    textarea.className = "form-control";
    textarea.rows = component.rows || 4;
    const value = getBindingValue(component.binding);
    const serialized = Array.isArray(value) ? JSON.stringify(value, null, 2) : value ? String(value) : "";
    textarea.value = serialized;
    const editable = isEditable(component);
    textarea.readOnly = !editable;
    if (editable) {
      textarea.addEventListener("blur", () => {
        const text = textarea.value.trim();
        if (!text) {
          updateBinding(component.binding, []);
          persistDraft({ silent: true });
          return;
        }
        try {
          const parsed = JSON.parse(text);
          updateBinding(component.binding, parsed);
        } catch (error) {
          status.show("Enter valid JSON for this list.", { type: "warning", timeout: 2000 });
        }
      });
    }
    wrapper.appendChild(textarea);
    return wrapper;
  }

  function renderDividerComponent(component) {
    const divider = document.createElement("hr");
    divider.className = "my-2";
    if (component.thickness) {
      divider.style.borderWidth = `${component.thickness}px`;
    }
    if (component.borderColor) {
      divider.style.borderColor = component.borderColor;
    }
    return divider;
  }

  function renderImageComponent(component) {
    const wrapper = document.createElement("div");
    wrapper.className = "d-flex flex-column gap-2";
    const label = component.label || component.name;
    if (label) {
      const heading = document.createElement("div");
      heading.className = "fw-semibold text-body-secondary";
      heading.textContent = label;
      wrapper.appendChild(heading);
    }
    const image = document.createElement("img");
    image.className = "img-fluid rounded";
    image.alt = component.alt || label || "Image";
    image.src = component.src || "https://placehold.co/640x360?text=Image";
    wrapper.appendChild(image);
    return wrapper;
  }

  function renderLabelComponent(component) {
    const text = document.createElement("div");
    text.className = "text-body";
    text.textContent = component.text || component.label || "Label";
    applyTextFormatting(text, component);
    return text;
  }

  function renderContainerComponent(component) {
    const wrapper = document.createElement("div");
    wrapper.className = "d-flex flex-column gap-3";
    const zones = normalizeZones(component);
    if (!zones.length) {
      wrapper.appendChild(createCanvasPlaceholder("No components in this container yet.", { variant: "compact" }));
      return wrapper;
    }
    zones.forEach((zone, index) => {
      if (zones.length > 1) {
        const badge = document.createElement("div");
        badge.className = "text-uppercase extra-small text-body-secondary";
        badge.textContent = zone.label || `Zone ${index + 1}`;
        wrapper.appendChild(badge);
      }
      const group = document.createElement("div");
      group.className = "d-flex flex-column gap-3";
      zone.components.forEach((child) => {
        group.appendChild(renderComponentCard(child));
      });
      wrapper.appendChild(group);
    });
    return wrapper;
  }

  function renderLinearTrackComponent(component) {
    const wrapper = document.createElement("div");
    wrapper.className = "d-flex flex-column gap-2";
    const label = document.createElement("div");
    label.className = "fw-semibold text-body-secondary";
    label.textContent = component.label || "Progress";
    wrapper.appendChild(label);
    const input = document.createElement("input");
    input.type = "range";
    input.className = "form-range";
    input.min = component.min ?? 0;
    input.max = component.max ?? 100;
    const value = Number(getBindingValue(component.binding) ?? component.value ?? 0);
    input.value = Number.isNaN(value) ? 0 : value;
    const editable = isEditable(component);
    input.disabled = !editable;
    if (editable) {
      input.addEventListener("input", () => {
        updateBinding(component.binding, Number(input.value));
      });
    }
    wrapper.appendChild(input);
    return wrapper;
  }

  function renderCircularTrackComponent(component) {
    const wrapper = document.createElement("div");
    wrapper.className = "d-flex flex-column gap-2";
    const label = document.createElement("div");
    label.className = "fw-semibold text-body-secondary";
    label.textContent = component.label || "Track";
    wrapper.appendChild(label);
    const input = document.createElement("input");
    input.type = "number";
    input.className = "form-control";
    input.min = 0;
    const max = component.max ?? 100;
    input.max = max;
    const value = Number(getBindingValue(component.binding) ?? component.value ?? 0);
    input.value = Number.isNaN(value) ? 0 : value;
    const editable = isEditable(component);
    input.disabled = !editable;
    if (editable) {
      input.addEventListener("input", () => {
        const next = Number(input.value);
        updateBinding(component.binding, Number.isNaN(next) ? 0 : Math.max(0, Math.min(max, next)));
      });
    }
    wrapper.appendChild(input);
    return wrapper;
  }

  function renderSelectGroupComponent(component) {
    const wrapper = document.createElement("div");
    wrapper.className = "d-flex flex-column gap-2";
    const label = document.createElement("div");
    label.className = "fw-semibold text-body-secondary";
    label.textContent = component.label || "Options";
    wrapper.appendChild(label);
    const editable = isEditable(component);
    const value = getBindingValue(component.binding);
    const options = Array.isArray(component.options) ? component.options : [];
    const group = document.createElement("div");
    group.className = "btn-group flex-wrap";
    group.setAttribute("role", "group");
    options.forEach((option) => {
      const optionValue = typeof option === "string" ? option : option.value;
      const optionLabel = typeof option === "string" ? option : option.label;
      const button = document.createElement("button");
      button.type = "button";
      button.className = String(value) === String(optionValue)
        ? "btn btn-primary btn-sm"
        : "btn btn-outline-secondary btn-sm";
      button.textContent = optionLabel;
      button.disabled = !editable;
      if (editable) {
        button.addEventListener("click", () => {
          updateBinding(component.binding, optionValue);
          renderCanvas();
        });
      }
      group.appendChild(button);
    });
    wrapper.appendChild(group);
    return wrapper;
  }

  function renderToggleComponent(component) {
    const wrapper = document.createElement("div");
    wrapper.className = "d-flex flex-column gap-2";
    const label = document.createElement("div");
    label.className = "fw-semibold text-body-secondary";
    label.textContent = component.label || "Toggle";
    wrapper.appendChild(label);
    const select = document.createElement("select");
    select.className = "form-select form-select-sm";
    const states = Array.isArray(component.states) ? component.states : [];
    states.forEach((state, index) => {
      const option = document.createElement("option");
      option.value = state;
      option.textContent = state;
      if (component.activeIndex === index || getBindingValue(component.binding) === state) {
        option.selected = true;
      }
      select.appendChild(option);
    });
    const editable = isEditable(component);
    select.disabled = !editable;
    if (editable) {
      select.addEventListener("change", () => {
        updateBinding(component.binding, select.value);
      });
    }
    wrapper.appendChild(select);
    return wrapper;
  }

  function normalizeZones(component) {
    if (!component || !component.zones || typeof component.zones !== "object") {
      return [];
    }
    return Object.keys(component.zones).map((key, index) => ({
      key,
      label:
        component.zoneLabels?.[key] ||
        (Array.isArray(component.tabLabels) ? component.tabLabels[index] : null) ||
        formatZoneLabel(key, index),
      components: Array.isArray(component.zones[key]) ? component.zones[key].map((child) => child) : [],
    }));
  }

  function formatZoneLabel(key, index) {
    if (!key) {
      return `Zone ${index + 1}`;
    }
    const cleaned = key.replace(/[-_]+/g, " ").trim();
    if (!cleaned) {
      return `Zone ${index + 1}`;
    }
    return cleaned
      .split(" ")
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(" ");
  }

  function hydrateComponent(component) {
    if (!component || typeof component !== "object") {
      return null;
    }
    const clone = JSON.parse(JSON.stringify(component));
    if (!clone.uid) {
      componentCounter += 1;
      clone.uid = `cmp-${componentCounter}`;
    }
    if (clone.zones && typeof clone.zones === "object") {
      Object.keys(clone.zones).forEach((key) => {
        const items = Array.isArray(clone.zones[key]) ? clone.zones[key] : [];
        clone.zones[key] = items.map((child) => hydrateComponent(child)).filter(Boolean);
      });
    }
    return clone;
  }

  function isEditable(component) {
    if (!component) {
      return false;
    }
    return state.mode === "edit" && !component.readOnly;
  }

  function getBindingValue(binding) {
    if (!binding || typeof binding !== "string") {
      return undefined;
    }
    const trimmed = binding.trim();
    if (!trimmed.startsWith("@")) {
      return undefined;
    }
    const path = trimmed.slice(1).split(".").filter(Boolean);
    if (!path.length) {
      return undefined;
    }
    let cursor = state.draft?.data;
    for (const segment of path) {
      if (!cursor || typeof cursor !== "object" || !(segment in cursor)) {
        return undefined;
      }
      cursor = cursor[segment];
    }
    return cursor;
  }

  function updateBinding(binding, value) {
    if (!state.draft || !binding || typeof binding !== "string" || !binding.startsWith("@")) {
      return;
    }
    const path = binding.slice(1).split(".").filter(Boolean);
    if (!path.length) {
      return;
    }
    if (!state.draft.data || typeof state.draft.data !== "object") {
      state.draft.data = {};
    }
    let cursor = state.draft.data;
    for (let index = 0; index < path.length - 1; index += 1) {
      const key = path[index];
      if (!cursor[key] || typeof cursor[key] !== "object") {
        cursor[key] = {};
      }
      cursor = cursor[key];
    }
    cursor[path[path.length - 1]] = value;
    persistDraft({ silent: true });
    renderPreview();
  }

  async function createNewCharacter() {
    const templateId = elements.templateSelect?.value || state.template?.id;
    if (!templateId) {
      status.show("Select a template before creating a character.", { type: "warning", timeout: 2200 });
      return;
    }
    if (state.template?.id !== templateId) {
      await loadTemplateById(templateId);
      if (state.template?.id !== templateId) {
        return;
      }
    }
    const name = window.prompt("Name your character", "New Hero");
    if (name === null) {
      return;
    }
    const trimmed = name.trim();
    if (!trimmed) {
      status.show("Provide a name for the new character.", { type: "warning", timeout: 2000 });
      return;
    }
    const id = generateCharacterId(trimmed);
    const draft = {
      id,
      title: trimmed,
      template: templateId,
      system: state.template?.schema || "",
      data: { name: trimmed },
      state: { timers: {}, log: [] },
    };
    state.character = cloneCharacter(draft);
    state.draft = cloneCharacter(draft);
    state.mode = "edit";
    registerCharacterRecord({ id, title: trimmed, template: templateId, source: "local" });
    syncCharacterOptions();
    if (elements.characterSelect) {
      elements.characterSelect.value = id;
    }
    persistDraft({ silent: true });
    syncNotesEditor();
    renderCanvas();
    renderPreview();
    syncModeIndicator();
    status.show(`Started ${trimmed}`, { type: "success", timeout: 2000 });
  }

  function resetDraft() {
    if (!state.character) {
      status.show("Nothing to reset yet.", { type: "info", timeout: 1800 });
      return;
    }
    state.draft = cloneCharacter(state.character);
    syncNotesEditor();
    renderCanvas();
    renderPreview();
    status.show("Reverted unsaved changes.", { timeout: 1800 });
  }

  function exportDraft() {
    const dataStr = JSON.stringify(state.draft, null, 2);
    const blob = new Blob([dataStr], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${state.draft.id || "character"}.json`;
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    URL.revokeObjectURL(url);
    status.show("Downloaded character JSON", { timeout: 2000 });
  }

  function persistDraft({ silent = true } = {}) {
    if (!state.draft?.id) {
      return;
    }
    try {
      dataManager.saveLocal("characters", state.draft.id, state.draft);
      registerCharacterRecord({
        id: state.draft.id,
        title: state.draft.data?.name || state.draft.title || state.draft.id,
        template: state.draft.template || state.template?.id || "",
        source: "local",
      });
      if (!silent) {
        status.show("Character saved locally", { type: "success", timeout: 2000 });
      }
    } catch (error) {
      console.warn("Character editor: unable to save character", error);
      status.show("Failed to save character locally", { type: "error", timeout: 2200 });
    }
  }

  function syncModeIndicator() {
    if (elements.modeIndicator) {
      elements.modeIndicator.textContent = state.mode === "edit" ? "Editing" : "Viewing";
    }
    if (elements.viewToggle) {
      const icon = elements.viewToggle.querySelector("[data-mode-icon]");
      const label = elements.viewToggle.querySelector("[data-mode-label]");
      const tooltipTitle = state.mode === "edit" ? "Switch to view mode" : "Switch to edit mode";
      elements.viewToggle.setAttribute("data-bs-title", tooltipTitle);
      elements.viewToggle.setAttribute("aria-pressed", state.mode === "edit" ? "true" : "false");
      if (icon) {
        icon.setAttribute("data-icon", state.mode === "edit" ? "tabler:edit" : "tabler:eye");
      }
      if (label) {
        label.textContent = state.mode === "edit" ? "Edit mode" : "View mode";
      }
      refreshTooltips(elements.viewToggle.parentElement || elements.viewToggle);
    }
  }

  function syncNotesEditor() {
    if (!notesEditor) {
      return;
    }
    const key = getNotesStorageKey();
    if (key === currentNotesKey) {
      return;
    }
    currentNotesKey = key;
    suppressNotesChange = true;
    try {
      const stored = localStorage.getItem(key);
      notesEditor.setMarkdown(stored || "");
    } catch (error) {
      console.warn("Character editor: unable to load notes", error);
      notesEditor.setMarkdown("");
    } finally {
      suppressNotesChange = false;
    }
  }

  function persistNotes(value) {
    const key = getNotesStorageKey();
    try {
      localStorage.setItem(key, value || "");
    } catch (error) {
      console.warn("Character editor: unable to save notes", error);
    }
  }

  function getNotesStorageKey() {
    const id = state.draft?.id || "session";
    return `undercroft.workbench.character.notes.${id}`;
  }

  function cloneCharacter(payload) {
    return payload ? JSON.parse(JSON.stringify(payload)) : null;
  }

  function generateCharacterId(name) {
    if (typeof crypto !== "undefined" && crypto.randomUUID) {
      return `cha_${crypto.randomUUID()}`;
    }
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
    const rand = Math.random().toString(36).slice(2, 8);
    return `cha_${slug || "character"}_${rand}`;
  }
})();
