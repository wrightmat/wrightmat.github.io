import { initAppShell } from "../../common/js/lib/app-shell.js";
import { initAuthControls } from "../../common/js/lib/auth-ui.js";
import { updateJsonPreview } from "../../common/js/lib/json-preview.js";
import { bindCollapsibleToggle, setCollapsibleState } from "../../common/js/lib/collapsible.js";
import { refreshTooltips } from "../../common/js/lib/tooltips.js";
import { initHelpSystem } from "../../common/js/lib/help.js";
import { applyMapping } from "../../common/js/lib/mapping-engine.js";
import { LOOKUP_TABLES } from "../../common/js/lib/lookup-tables.js";
import { customFunctions } from "../../common/js/lib/mapping-custom-functions.js";
import { loadSourceDataRaw, LIBRARY_KINDS } from "../../common/js/lib/content-fetch.js";

const SOURCES = [
  {
    id: "ddb",
    label: "D&D Beyond",
    valueLabel: "Character ID or URL",
    placeholder: "e.g. 123456789, or https://www.dndbeyond.com/classes/2190875-barbarian",
    helpTopic: "loom.source.ddb",
  },
  {
    id: "srd",
    label: "5e API",
    valueLabel: "API Endpoint or URL",
    placeholder: "e.g. /api/2024/classes/barbarian",
    helpTopic: "loom.source.srd",
  },
];

const mappingSelect = document.querySelector("[data-mapping-select]");
const mappingsToggle = document.querySelector("[data-mappings-toggle]");
const mappingsPanel = document.querySelector("[data-mappings-panel]");
const nodePalette = document.querySelector("[data-node-palette]");
const stepPaletteSection = document.querySelector("[data-step-palette-section]");
const stepPalette = document.querySelector("[data-step-palette]");
const sampleDataInput = document.querySelector("[data-sample-data-input]");
const sampleDataApplyButton = document.querySelector("[data-sample-data-apply]");
const sourceSelect = document.querySelector("[data-source-select]");
const sourceValueInput = document.querySelector("[data-source-value]");
const sourceValueLabelRow = document.querySelector("[data-source-value-label-row]");
const sourceFetchButton = document.querySelector("[data-source-fetch]");
const entitiesSummary = document.querySelector("[data-entities-summary]");
const entitiesList = document.querySelector("[data-entities-list]");
const entitiesToggle = document.querySelector("[data-entities-toggle]");
const entitiesPanel = document.querySelector("[data-entities-panel]");
const ioToggle = document.querySelector("[data-io-toggle]");
const ioPanel = document.querySelector("[data-io-panel]");
const recentSavesContainer = document.querySelector("[data-recent-saves]");
const recentSavesRefreshButton = document.querySelector("[data-recent-saves-refresh]");
const treeContainer = document.querySelector("[data-mapping-tree]");
const treeToggle = document.querySelector("[data-mapping-tree-toggle]");
const treePanel = document.querySelector("[data-mapping-tree-panel]");
const inspectorContainer = document.querySelector("[data-inspector]");
const rawPreviewEl = document.querySelector("[data-raw-preview]");
const mappedPreviewEl = document.querySelector("[data-mapped-preview]");
const undoButton = document.querySelector('[data-action="undo-mapping"]');
const redoButton = document.querySelector('[data-action="redo-mapping"]');
const newButton = document.querySelector('[data-action="new-mapping"]');
const saveButton = document.querySelector('[data-action="save-mapping"]');
const renameButton = document.querySelector('[data-action="rename-mapping"]');

const CUSTOM_FUNCTION_NAMES = Object.keys(customFunctions);

let mappingDefinition = null;
let selectedNode = null;
let sampleData = {};
let currentMappingId = null;
let isApplyingHistory = false;
let undoStack = null;
let status = null;
let lastMappedResult = null;

// --- Undo/redo -------------------------------------------------------------
// Whole-tree JSON snapshots, mirroring press/js/app.js's recordUndoableChange
// pattern: cheap to diff/clone for a tree this size, and side-steps having to
// track stable node identity across undo/redo (selection just resets, like
// it already does on load/new).

function createSnapshot() {
  return { mappingDefinition: mappingDefinition ? JSON.parse(JSON.stringify(mappingDefinition)) : null };
}

function applySnapshot(snapshot) {
  mappingDefinition = snapshot?.mappingDefinition ? JSON.parse(JSON.stringify(snapshot.mappingDefinition)) : null;
  selectedNode = null;
  enterMappingMode(mappingDefinition);
  rerenderAll();
}

function snapshotsEqual(a, b) {
  try {
    return JSON.stringify(a) === JSON.stringify(b);
  } catch (error) {
    return false;
  }
}

function recordUndoableChange(action) {
  if (typeof action !== "function") return;
  if (isApplyingHistory || !undoStack) {
    action();
    return;
  }
  const before = createSnapshot();
  action();
  const after = createSnapshot();
  if (!snapshotsEqual(before, after)) {
    undoStack.push({ type: "mapping", before, after });
  }
}

// --- Node / step factories -------------------------------------------------

function createNode(type) {
  switch (type) {
    case "object":
      return { type: "object", fields: {} };
    case "field":
      return { type: "field", bind: "" };
    case "pipeline":
      return { type: "pipeline", source: "", steps: [] };
    case "with":
      return { type: "with", bindings: {}, body: null };
    case "custom":
      return { type: "custom", fn: CUSTOM_FUNCTION_NAMES[0] || "", args: {} };
    default:
      throw new Error(`Unknown node type: ${type}`);
  }
}

function createStep(stepType) {
  switch (stepType) {
    case "map":
      return { step: "map", item: createNode("field") };
    case "filter":
      return { step: "filter", bind: "" };
    case "flatten":
      return { step: "flatten" };
    case "group-by":
      return { step: "group-by", bind: "" };
    case "sort":
      return { step: "sort", bind: "", direction: "asc" };
    case "dedup":
      return { step: "dedup", bind: "" };
    case "custom":
      return { step: "custom", fn: CUSTOM_FUNCTION_NAMES[0] || "", args: {} };
    default:
      throw new Error(`Unknown step type: ${stepType}`);
  }
}

// --- Tree rendering ----------------------------------------------------

function nodeLabel(node) {
  if (!node) return "";
  switch (node.type) {
    case "object":
      return `${Object.keys(node.fields || {}).length} field(s)`;
    case "field":
      return node.bind || "(empty bind)";
    case "pipeline":
      return `${typeof node.source === "string" ? node.source : node.source?.fn ? `custom:${node.source.fn}` : "(no source)"} — ${(node.steps || []).length} step(s)`;
    case "with":
      return `${Object.keys(node.bindings || {}).length} binding(s)${node.body ? "" : " — no body"}`;
    case "custom":
      return node.fn || "(no function)";
    default:
      return "";
  }
}

function stepLabel(step) {
  switch (step.step) {
    case "map":
      return "map";
    case "filter":
      return `filter: ${step.bind || ""}`;
    case "flatten":
      return "flatten";
    case "group-by":
      return `group-by: ${step.bind || ""}`;
    case "sort":
      return `sort: ${step.bind || ""} (${step.direction || "asc"})`;
    case "dedup":
      return `dedup: ${step.bind || ""}`;
    case "custom":
      return `custom: ${step.fn || ""}`;
    default:
      return step.step;
  }
}

function makeRemoveButton(onRemove) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "btn btn-outline-danger btn-sm loom-node-remove";
  button.textContent = "×";
  button.addEventListener("click", (event) => {
    event.stopPropagation();
    recordUndoableChange(onRemove);
  });
  return button;
}

function renderNodeEl(node, { onRemove } = {}) {
  const el = document.createElement("div");
  el.className = "loom-node" + (node === selectedNode ? " loom-node--selected" : "");
  el.addEventListener("click", (event) => {
    event.stopPropagation();
    selectNode(node);
  });

  const header = document.createElement("div");
  header.className = "loom-node-header";
  const labelWrap = document.createElement("div");
  const typeEl = document.createElement("div");
  typeEl.className = "loom-node-type";
  typeEl.textContent = node.type;
  const labelEl = document.createElement("div");
  labelEl.className = "loom-node-label";
  labelEl.textContent = nodeLabel(node);
  labelWrap.append(typeEl, labelEl);
  header.appendChild(labelWrap);
  if (onRemove) {
    header.appendChild(makeRemoveButton(onRemove));
  }
  el.appendChild(header);

  if (node.type === "object") {
    const childrenEl = document.createElement("div");
    childrenEl.className = "loom-node-children";
    const keys = Object.keys(node.fields || {});
    if (!keys.length) {
      childrenEl.appendChild(emptyHint("No fields yet — select this node, then click a palette entry."));
    }
    keys.forEach((key) => {
      const row = document.createElement("div");
      const keyLabel = document.createElement("div");
      keyLabel.className = "small text-body-secondary fw-semibold mt-1";
      keyLabel.textContent = key;
      row.appendChild(keyLabel);
      row.appendChild(
        renderNodeEl(node.fields[key], {
          onRemove: () => {
            if (selectedNode === node.fields[key]) selectedNode = node;
            delete node.fields[key];
            rerenderAll();
          },
        })
      );
      childrenEl.appendChild(row);
    });
    el.appendChild(childrenEl);
  }

  if (node.type === "with") {
    const bindingsEl = document.createElement("div");
    bindingsEl.className = "loom-node-children";
    const bindingsTitle = document.createElement("div");
    bindingsTitle.className = "small text-body-secondary fw-semibold";
    bindingsTitle.textContent = "Bindings";
    bindingsEl.appendChild(bindingsTitle);
    const keys = Object.keys(node.bindings || {});
    if (!keys.length) {
      bindingsEl.appendChild(emptyHint("No bindings yet."));
    }
    keys.forEach((key) => {
      const row = document.createElement("div");
      const keyLabel = document.createElement("div");
      keyLabel.className = "small text-body-secondary fw-semibold mt-1";
      keyLabel.textContent = key;
      row.appendChild(keyLabel);
      row.appendChild(
        renderNodeEl(node.bindings[key], {
          onRemove: () => {
            if (selectedNode === node.bindings[key]) selectedNode = node;
            delete node.bindings[key];
            rerenderAll();
          },
        })
      );
      bindingsEl.appendChild(row);
    });

    const bodyTitle = document.createElement("div");
    bodyTitle.className = "small text-body-secondary fw-semibold mt-2";
    bodyTitle.textContent = "Body";
    bindingsEl.appendChild(bodyTitle);
    if (node.body) {
      bindingsEl.appendChild(
        renderNodeEl(node.body, {
          onRemove: () => {
            if (selectedNode === node.body) selectedNode = node;
            node.body = null;
            rerenderAll();
          },
        })
      );
    } else {
      bindingsEl.appendChild(emptyHint("No body yet — select this node, then click a palette entry."));
    }
    el.appendChild(bindingsEl);
  }

  if (node.type === "pipeline") {
    const stepsEl = document.createElement("div");
    stepsEl.className = "loom-node-steps";
    const steps = node.steps || [];
    if (!steps.length) {
      stepsEl.appendChild(emptyHint("No steps yet — select this pipeline, then click a step in the palette."));
    }
    steps.forEach((step, index) => {
      const stepEl = document.createElement("div");
      stepEl.className = "loom-step" + (step === selectedNode ? " loom-step--selected" : "");
      stepEl.addEventListener("click", (event) => {
        event.stopPropagation();
        selectNode(step);
      });
      const row = document.createElement("div");
      row.className = "d-flex align-items-center justify-content-between";
      const text = document.createElement("span");
      text.textContent = `${index + 1}. ${stepLabel(step)}`;
      row.appendChild(text);
      row.appendChild(
        makeRemoveButton(() => {
          if (selectedNode === step) selectedNode = node;
          steps.splice(index, 1);
          rerenderAll();
        })
      );
      stepEl.appendChild(row);
      if (step.step === "map") {
        const itemWrap = document.createElement("div");
        itemWrap.className = "mt-1";
        itemWrap.appendChild(renderNodeEl(step.item, {}));
        stepEl.appendChild(itemWrap);
      }
      stepsEl.appendChild(stepEl);
    });
    el.appendChild(stepsEl);
  }

  return el;
}

function emptyHint(text) {
  const p = document.createElement("p");
  p.className = "loom-empty-hint mb-1";
  p.textContent = text;
  return p;
}

function renderTree() {
  if (!treeContainer) return;
  treeContainer.innerHTML = "";
  if (!mappingDefinition) {
    treeContainer.appendChild(emptyHint('No mapping loaded — click "Object" in the palette to start a new root node.'));
    return;
  }
  treeContainer.appendChild(
    renderNodeEl(mappingDefinition, {
      onRemove: () => {
        mappingDefinition = null;
        selectedNode = null;
        rerenderAll();
      },
    })
  );
}

// --- Inspector -----------------------------------------------------------

function inputRow(labelText, inputEl) {
  const wrap = document.createElement("div");
  wrap.className = "mb-2";
  const label = document.createElement("label");
  label.className = "form-label small text-body-secondary fw-semibold mb-1";
  label.textContent = labelText;
  wrap.append(label, inputEl);
  return wrap;
}

function bindTextInput(value, onChange) {
  const input = document.createElement("input");
  input.type = "text";
  input.className = "form-control form-control-sm";
  input.value = value ?? "";
  input.addEventListener("change", () => {
    recordUndoableChange(() => onChange(input.value));
    renderTree();
    runLivePreview();
  });
  return input;
}

function bindSelect(options, value, onChange) {
  const select = document.createElement("select");
  select.className = "form-select form-select-sm";
  options.forEach((option) => {
    const opt = document.createElement("option");
    opt.value = option;
    opt.textContent = option;
    if (option === value) opt.selected = true;
    select.appendChild(opt);
  });
  select.addEventListener("change", () => {
    recordUndoableChange(() => onChange(select.value));
    renderTree();
    runLivePreview();
  });
  return select;
}

function renderInspector() {
  if (!inspectorContainer) return;
  inspectorContainer.innerHTML = "";
  const node = selectedNode;
  if (!node) {
    inspectorContainer.appendChild(document.createElement("p")).className = "small text-body-secondary";
    inspectorContainer.lastChild.textContent = "Select a node in the tree to edit its properties.";
    return;
  }

  if (node.step) {
    // pipeline step
    inspectorContainer.appendChild(labelHeading(`Step: ${node.step}`));
    if ("bind" in node) {
      inspectorContainer.appendChild(
        inputRow("Bind (@path or =formula)", bindTextInput(node.bind, (value) => (node.bind = value)))
      );
    }
    if ("direction" in node) {
      inspectorContainer.appendChild(
        inputRow(
          "Direction",
          bindSelect(["asc", "desc"], node.direction, (value) => (node.direction = value))
        )
      );
    }
    if (node.step === "custom") {
      inspectorContainer.appendChild(
        inputRow(
          "Function",
          bindSelect(CUSTOM_FUNCTION_NAMES, node.fn, (value) => (node.fn = value))
        )
      );
    }
    return;
  }

  inspectorContainer.appendChild(labelHeading(`Node: ${node.type}`));
  if (node.type === "field") {
    inspectorContainer.appendChild(
      inputRow("Bind (@path or =formula)", bindTextInput(node.bind, (value) => (node.bind = value)))
    );
  }
  if (node.type === "pipeline") {
    const isCustomSource = node.source && typeof node.source === "object";
    const sourceKindSelect = bindSelect(["bind", "custom"], isCustomSource ? "custom" : "bind", (value) => {
      node.source = value === "custom" ? { fn: CUSTOM_FUNCTION_NAMES[0] || "", args: {} } : "";
      renderInspector();
    });
    inspectorContainer.appendChild(inputRow("Source kind", sourceKindSelect));
    if (isCustomSource) {
      inspectorContainer.appendChild(
        inputRow(
          "Source function",
          bindSelect(CUSTOM_FUNCTION_NAMES, node.source.fn, (value) => (node.source.fn = value))
        )
      );
    } else {
      inspectorContainer.appendChild(
        inputRow("Source bind (@path)", bindTextInput(typeof node.source === "string" ? node.source : "", (value) => (node.source = value)))
      );
    }
  }
  if (node.type === "custom") {
    inspectorContainer.appendChild(
      inputRow(
        "Function",
        bindSelect(CUSTOM_FUNCTION_NAMES, node.fn, (value) => (node.fn = value))
      )
    );
  }
  if (node.type === "object" || node.type === "with") {
    inspectorContainer.appendChild(
      document.createElement("p")
    ).textContent = "Use the Node Palette on the left to add children to this node.";
    inspectorContainer.lastChild.className = "small text-body-secondary";
  }
}

function labelHeading(text) {
  const h = document.createElement("h3");
  h.className = "h6 mb-2";
  h.textContent = text;
  return h;
}

function selectNode(node) {
  selectedNode = node;
  const isPipeline = node && node.type === "pipeline";
  if (stepPaletteSection) stepPaletteSection.hidden = !isPipeline;
  renderTree();
  renderInspector();
}

function rerenderAll() {
  renderTree();
  renderInspector();
  runLivePreview();
}

// Delegated hover: event.target is always the topmost/innermost element the
// pointer is actually over, so .closest() finds exactly the right node/step
// to highlight — no ambiguity about which nested box "wins", and no flicker
// since it's one explicit class toggle instead of competing CSS :hover rules.
let hoveredEl = null;
function setHoveredElement(el) {
  if (hoveredEl === el) return;
  if (hoveredEl) hoveredEl.classList.remove("loom-hovered");
  hoveredEl = el;
  if (hoveredEl) hoveredEl.classList.add("loom-hovered");
}

if (treeContainer) {
  treeContainer.addEventListener("mouseover", (event) => {
    setHoveredElement(event.target.closest(".loom-node, .loom-step"));
  });
  treeContainer.addEventListener("mouseleave", () => setHoveredElement(null));
}

if (treeToggle && treePanel) {
  bindCollapsibleToggle(treeToggle, treePanel, {
    collapsed: false,
    expandLabel: "Expand mapping tree",
    collapseLabel: "Collapse mapping tree",
  });
}

if (mappingsToggle && mappingsPanel) {
  bindCollapsibleToggle(mappingsToggle, mappingsPanel, {
    collapsed: false,
    expandLabel: "Expand selection",
    collapseLabel: "Collapse selection",
  });
}

if (entitiesToggle && entitiesPanel) {
  bindCollapsibleToggle(entitiesToggle, entitiesPanel, {
    collapsed: false,
    expandLabel: "Expand entities",
    collapseLabel: "Collapse entities",
  });
}

if (ioToggle && ioPanel) {
  bindCollapsibleToggle(ioToggle, ioPanel, {
    collapsed: false,
    expandLabel: "Expand data",
    collapseLabel: "Collapse data",
  });
}

// --- Workflow mode: a mapping with a fixed $source (already saved/loaded)
// locks the Data Source dropdown to that source and favors the Entities pane;
// a brand-new mapping (no $source yet) leaves Data Source selectable and
// favors the Mapping Tree instead. Input/Output stays expanded either way.
// This only fires on actual mode transitions (load/new/first-save), not on
// every small edit, so it doesn't fight the user's own manual collapse/expand.

function applySourceLock(source) {
  if (!sourceSelect) return;
  sourceSelect.disabled = Boolean(source);
  if (source) sourceSelect.value = source;
  const active = SOURCES.find((entry) => entry.id === sourceSelect.value) || SOURCES[0];
  if (sourceValueInput) sourceValueInput.placeholder = active.placeholder;
  renderSourceValueLabel(active);
}

function enterMappingMode(definition) {
  const source = definition && typeof definition === "object" ? definition.$source : null;
  applySourceLock(source || null);
  if (treeToggle && treePanel) {
    setCollapsibleState(treeToggle, treePanel, {
      collapsed: Boolean(source),
      expandLabel: "Expand mapping tree",
      collapseLabel: "Collapse mapping tree",
    });
  }
  if (entitiesToggle && entitiesPanel) {
    setCollapsibleState(entitiesToggle, entitiesPanel, {
      collapsed: !source,
      expandLabel: "Expand entities",
      collapseLabel: "Collapse entities",
    });
  }
  if (ioToggle && ioPanel) {
    setCollapsibleState(ioToggle, ioPanel, {
      collapsed: false,
      expandLabel: "Expand data",
      collapseLabel: "Collapse data",
    });
  }
}

// --- Palette handlers ------------------------------------------------------

function promptKey(promptText, defaultValue = "") {
  const key = window.prompt(promptText, defaultValue);
  if (key == null) return null;
  const trimmed = key.trim();
  return trimmed || null;
}

if (nodePalette) {
  nodePalette.addEventListener("click", (event) => {
    const button = event.target.closest("[data-palette-node-type]");
    if (!button) return;
    const type = button.dataset.paletteNodeType;

    if (!mappingDefinition) {
      recordUndoableChange(() => {
        mappingDefinition = createNode(type);
      });
      selectNode(mappingDefinition);
      rerenderAll();
      return;
    }

    if (!selectedNode) {
      status?.show("Select a node first (or remove the root to start over).", { type: "warning", timeout: 2500 });
      return;
    }

    if (selectedNode.type === "object") {
      const key = promptKey("Field name:");
      if (!key) return;
      recordUndoableChange(() => {
        selectedNode.fields[key] = createNode(type);
      });
      rerenderAll();
      return;
    }

    if (selectedNode.type === "with") {
      const key = promptKey("Binding name (leave blank to set as the body):");
      if (key === null) return;
      recordUndoableChange(() => {
        if (key) {
          selectedNode.bindings[key] = createNode(type);
        } else {
          selectedNode.body = createNode(type);
        }
      });
      rerenderAll();
      return;
    }

    status?.show(`A ${selectedNode.type} node can't have children added this way.`, { type: "warning", timeout: 2500 });
  });
}

if (stepPalette) {
  stepPalette.addEventListener("click", (event) => {
    const button = event.target.closest("[data-palette-step-type]");
    if (!button) return;
    if (!selectedNode || selectedNode.type !== "pipeline") {
      status?.show("Select a pipeline node first.", { type: "warning", timeout: 2000 });
      return;
    }
    recordUndoableChange(() => {
      selectedNode.steps.push(createStep(button.dataset.paletteStepType));
    });
    rerenderAll();
  });
}

// --- Live preview ----------------------------------------------------------

function runLivePreview() {
  updateJsonPreview(rawPreviewEl, null, sampleData);
  if (!mappingDefinition) {
    lastMappedResult = null;
    updateJsonPreview(mappedPreviewEl, null, { note: "No mapping defined yet." });
    renderEntities();
    return;
  }
  try {
    const result = applyMapping(mappingDefinition, sampleData, {
      lookupTables: LOOKUP_TABLES,
      customFunctions,
    });
    lastMappedResult = result;
    updateJsonPreview(mappedPreviewEl, null, result);
  } catch (error) {
    lastMappedResult = null;
    updateJsonPreview(mappedPreviewEl, null, { error: error.message });
  }
  renderEntities();
}

if (sampleDataApplyButton) {
  sampleDataApplyButton.addEventListener("click", () => {
    try {
      sampleData = JSON.parse(sampleDataInput.value || "{}");
      status?.show("Sample data applied.", { type: "success", timeout: 1500 });
      runLivePreview();
    } catch (error) {
      status?.show(`Sample data isn't valid JSON: ${error.message}`, { type: "error", timeout: 4000 });
    }
  });
}

// --- Source fetch ------------------------------------------------------

function renderSourceValueLabel(source) {
  if (!sourceValueLabelRow) return;
  sourceValueLabelRow.innerHTML = "";
  const labelRow = document.createElement("div");
  labelRow.className = "d-flex justify-content-between align-items-center gap-2 flex-wrap";
  const label = document.createElement("label");
  label.className = "form-label fw-semibold mb-0";
  label.setAttribute("for", "loomSourceValue");
  label.textContent = source.valueLabel;
  labelRow.appendChild(label);
  if (source.helpTopic) {
    const help = document.createElement("span");
    help.className = "align-middle";
    help.dataset.helpTopic = source.helpTopic;
    help.dataset.helpInsert = "replace";
    help.dataset.helpPlacement = "left";
    labelRow.appendChild(help);
    initHelpSystem({ root: labelRow });
  }
  sourceValueLabelRow.appendChild(labelRow);
}

if (sourceSelect) {
  SOURCES.forEach((source) => {
    const option = document.createElement("option");
    option.value = source.id;
    option.textContent = source.label;
    sourceSelect.appendChild(option);
  });
  const updateSourceUi = () => {
    const source = SOURCES.find((entry) => entry.id === sourceSelect.value) || SOURCES[0];
    if (sourceValueInput) sourceValueInput.placeholder = source.placeholder;
    renderSourceValueLabel(source);
  };
  sourceSelect.addEventListener("change", updateSourceUi);
  updateSourceUi();
}

if (sourceFetchButton) {
  sourceFetchButton.addEventListener("click", async () => {
    const source = SOURCES.find((entry) => entry.id === sourceSelect?.value) || SOURCES[0];
    const value = (sourceValueInput?.value || "").trim();
    if (!value) {
      status?.show("Enter a value to fetch.", { type: "warning", timeout: 2000 });
      return;
    }
    try {
      const raw = await loadSourceDataRaw(source, value);
      sampleData = raw;
      if (sampleDataInput) sampleDataInput.value = JSON.stringify(sampleData, null, 2);
      runLivePreview();
      status?.show("Fetched.", { type: "success", timeout: 1500 });
    } catch (error) {
      status?.show(`Fetch failed: ${error.message}`, { type: "error", timeout: 4000 });
    }
  });
}

// --- Entities: one-to-many expansion + per-entity save ---------------------
// Convention, not engine metadata: a mapped result with a top-level {kind,
// name} is the primary entity; ENTITY_ARRAY_FIELDS below map a specific field
// name to the entity kind its items should be saved as. Explicit by design —
// reference arrays like saving_throws/proficiencies also carry {name, ...}
// entries but aren't separate entities to save, so a field only qualifies if
// it's actually listed here, never just by shape. `subclasses` is NOT listed:
// it's deliberately just a lightweight ref array on the class ({index, name,
// url}, matching the 5e API's class shape) — the full subclass list is its
// own separate mapping (ddb-subclass.json), whose pipeline root already
// produces subclass entities directly via the Array.isArray branch below.
const ENTITY_ARRAY_FIELDS = { variants: "variant" };

function slugify(name) {
  return (
    (name || "")
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)/g, "") || "entity"
  );
}

// A mapping's root can itself be a pipeline (e.g. ddb-subclass.json applies
// to the same class-page fetch as ddb-class.json, but its root is a pipeline
// over `subclasses` producing the full array directly) — every item that
// looks like an entity ({kind, name}) is one, no wrapping object needed.
function deriveEntities(mappedResult) {
  if (Array.isArray(mappedResult)) {
    return mappedResult
      .filter((item) => item && typeof item === "object" && typeof item.kind === "string" && typeof item.name === "string")
      .map((item) => ({ kind: item.kind, name: item.name, data: item }));
  }
  if (!mappedResult || typeof mappedResult !== "object") return [];
  const entities = [];
  if (typeof mappedResult.kind === "string" && typeof mappedResult.name === "string") {
    entities.push({ kind: mappedResult.kind, name: mappedResult.name, data: mappedResult });
  }
  Object.entries(ENTITY_ARRAY_FIELDS).forEach(([key, kind]) => {
    const value = mappedResult[key];
    if (!Array.isArray(value)) return;
    value.forEach((item) => {
      if (item && typeof item === "object" && typeof item.name === "string") {
        entities.push({ kind, name: item.name, data: item });
      }
    });
  });
  return entities;
}

async function saveEntity(entity) {
  const id = promptKey(`Save "${entity.name}" as (id):`, slugify(entity.name));
  if (!id) return;
  try {
    const response = await fetch(`/library/${encodeURIComponent(entity.kind)}/${encodeURIComponent(id)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ data: entity.data }),
    });
    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      throw new Error(payload.error || `HTTP ${response.status}`);
    }
    status?.show(`Saved ${entity.kind}/${id}.json.`, { type: "success", timeout: 2000 });
    loadRecentSaves();
  } catch (error) {
    status?.show(`Unable to save: ${error.message}`, { type: "error", timeout: 4000 });
  }
}

function renderEntities() {
  if (!entitiesList || !entitiesSummary) return;
  entitiesList.innerHTML = "";
  const entities = deriveEntities(lastMappedResult);
  if (!entities.length) {
    entitiesSummary.textContent =
      "No save-able entities in this mapping's output (expects a top-level {kind, name}, plus optionally top-level arrays of named items).";
    return;
  }
  const counts = {};
  entities.forEach((entity) => {
    counts[entity.kind] = (counts[entity.kind] || 0) + 1;
  });
  entitiesSummary.textContent = `This produced: ${Object.entries(counts)
    .map(([kind, count]) => `${count} ${kind}${count === 1 ? "" : "s"}`)
    .join(" + ")}`;

  entities.forEach((entity) => {
    const row = document.createElement("div");
    row.className = "d-flex align-items-center justify-content-between border rounded-3 px-2 py-1";
    const label = document.createElement("span");
    label.className = "small";
    label.textContent = `${entity.name} (${entity.kind})`;
    const saveBtn = document.createElement("button");
    saveBtn.type = "button";
    saveBtn.className = "btn btn-outline-primary btn-sm";
    saveBtn.textContent = "Save";
    saveBtn.addEventListener("click", () => saveEntity(entity));
    row.append(label, saveBtn);
    entitiesList.appendChild(row);
  });
}

// --- Recent saves ------------------------------------------------------

async function loadRecentSaves() {
  if (!recentSavesContainer) return;
  let entries = [];
  try {
    const lists = await Promise.all(
      LIBRARY_KINDS.map(async (kind) => {
        const response = await fetch(`/list/library-${kind}`);
        if (!response.ok) return [];
        const payload = await response.json();
        return (payload.files || []).map((entry) => ({
          kind,
          filename: entry.filename,
          modified: entry.modified || 0,
        }));
      })
    );
    entries = lists.flat().sort((a, b) => b.modified - a.modified).slice(0, 15);
  } catch (error) {
    return;
  }
  recentSavesContainer.innerHTML = "";
  if (!entries.length) {
    const p = document.createElement("p");
    p.className = "small text-body-secondary mb-0";
    p.textContent = "No saved entries yet.";
    recentSavesContainer.appendChild(p);
    return;
  }
  entries.forEach((entry) => {
    const row = document.createElement("div");
    row.className = "small";
    const when = entry.modified ? new Date(entry.modified * 1000).toLocaleString() : "";
    row.textContent = `${entry.kind}/${entry.filename}${when ? ` — ${when}` : ""}`;
    recentSavesContainer.appendChild(row);
  });
}

if (recentSavesRefreshButton) {
  recentSavesRefreshButton.addEventListener("click", () => loadRecentSaves());
}

// --- Mapping load/save -------------------------------------------------

async function listMappings() {
  try {
    const response = await fetch("/list/loom-mappings");
    if (!response.ok) return [];
    const payload = await response.json();
    return (payload.files || []).map((entry) => entry.filename).filter(Boolean);
  } catch (error) {
    return [];
  }
}

async function populateMappingSelect() {
  if (!mappingSelect) return;
  const names = await listMappings();
  mappingSelect.innerHTML = "";
  const blank = document.createElement("option");
  blank.value = "";
  blank.textContent = names.length ? "Select a mapping…" : "No saved mappings yet";
  mappingSelect.appendChild(blank);
  names.forEach((name) => {
    const option = document.createElement("option");
    option.value = name;
    option.textContent = name;
    if (name === currentMappingId) option.selected = true;
    mappingSelect.appendChild(option);
  });
}

// Switching mappings changes what shape of data is expected entirely — a
// class fetch means nothing to a species mapping — so the raw input, the
// source-fetch value, and (via rerenderAll -> runLivePreview) the mapped
// output and Entities pane all reset rather than re-running the new mapping
// against leftover data from a different shape.
function resetRawData() {
  sampleData = {};
  if (sourceValueInput) sourceValueInput.value = "";
  if (sampleDataInput) sampleDataInput.value = JSON.stringify(sampleData, null, 2);
}

async function loadMapping(id) {
  const url = new URL(`../mappings/${id}.json`, import.meta.url);
  // no-store: mapping files get edited/saved iteratively (including from
  // outside the browser), so a stale cached copy silently showing old
  // behavior is worse than the extra round trip every load costs.
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  mappingDefinition = await response.json();
  currentMappingId = id;
  selectedNode = null;
  undoStack?.clear();
  resetRawData();
  enterMappingMode(mappingDefinition);
  rerenderAll();
}

if (mappingSelect) {
  mappingSelect.addEventListener("change", async () => {
    const id = mappingSelect.value;
    if (!id) return;
    try {
      await loadMapping(id);
      status?.show(`Loaded ${id}.`, { type: "success", timeout: 1500 });
    } catch (error) {
      status?.show(`Unable to load mapping: ${error.message}`, { type: "error", timeout: 4000 });
    }
  });
}

async function saveMapping(id) {
  const response = await fetch(`/loom/mappings/${encodeURIComponent(id)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ definition: mappingDefinition }),
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload.error || `HTTP ${response.status}`);
  }
}

if (newButton) {
  newButton.addEventListener("click", () => {
    mappingDefinition = null;
    selectedNode = null;
    currentMappingId = null;
    undoStack?.clear();
    if (mappingSelect) mappingSelect.value = "";
    resetRawData();
    enterMappingMode(null);
    rerenderAll();
  });
}

if (saveButton) {
  saveButton.addEventListener("click", async () => {
    if (!mappingDefinition) {
      status?.show("Nothing to save yet.", { type: "warning", timeout: 2000 });
      return;
    }
    if (!mappingDefinition.$source && sourceSelect && !sourceSelect.disabled) {
      mappingDefinition.$source = sourceSelect.value;
    }
    let id = currentMappingId;
    if (!id) {
      id = promptKey("Save as (mapping id):");
      if (!id) return;
    }
    try {
      await saveMapping(id);
      currentMappingId = id;
      status?.show(`Saved ${id}.json.`, { type: "success", timeout: 2000 });
      await populateMappingSelect();
      enterMappingMode(mappingDefinition);
    } catch (error) {
      status?.show(`Unable to save mapping: ${error.message}`, { type: "error", timeout: 4000 });
    }
  });
}

if (renameButton) {
  renameButton.addEventListener("click", async () => {
    if (!currentMappingId) {
      status?.show("Save this mapping first, then you can rename it.", { type: "warning", timeout: 2500 });
      return;
    }
    const newId = promptKey(`Rename "${currentMappingId}" to:`);
    if (!newId || newId === currentMappingId) return;
    try {
      const response = await fetch(`/loom/mappings/${encodeURIComponent(currentMappingId)}/rename`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ newId }),
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload.error || `HTTP ${response.status}`);
      }
      currentMappingId = newId;
      status?.show(`Renamed to ${newId}.json.`, { type: "success", timeout: 2000 });
      await populateMappingSelect();
    } catch (error) {
      status?.show(`Unable to rename mapping: ${error.message}`, { type: "error", timeout: 4000 });
    }
  });
}

// --- Init --------------------------------------------------------------

async function init() {
  const shell = initAppShell({
    namespace: "loom-mapping",
    storagePrefix: "undercroft.loom.undo",
    onUndo: (entry) => {
      if (!entry?.before) return { applied: false };
      isApplyingHistory = true;
      try {
        applySnapshot(entry.before);
      } finally {
        isApplyingHistory = false;
      }
      return null;
    },
    onRedo: (entry) => {
      if (!entry?.after) return { applied: false };
      isApplyingHistory = true;
      try {
        applySnapshot(entry.after);
      } finally {
        isApplyingHistory = false;
      }
      return null;
    },
  });
  status = shell.status;
  undoStack = shell.undoStack;
  initAuthControls({ status });

  if (undoButton) undoButton.addEventListener("click", () => shell.undo());
  if (redoButton) redoButton.addEventListener("click", () => shell.redo());

  try {
    sampleData = await fetch("test/fixtures/raw-character-sample.json").then((r) => r.json());
  } catch (error) {
    sampleData = {};
  }
  if (sampleDataInput) sampleDataInput.value = JSON.stringify(sampleData, null, 2);
  await populateMappingSelect();
  enterMappingMode(mappingDefinition);
  rerenderAll();
  loadRecentSaves();
  initHelpSystem({ root: document });
  refreshTooltips(document);
}

init();
