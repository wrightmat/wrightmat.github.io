// Shared "edit an array of typed, arbitrarily-nested property definitions"
// UI — extracted from Loom's System editor so Group Properties can reuse
// the exact same recursive row editor, type-cycling, drag-to-reorder, and
// value-list machinery instead of a hand-duplicated second copy. Every
// function here is undo/dirty-tracking-agnostic — callers thread that
// through via the `ctx` object each function takes, so System keeps
// participating in Loom's whole-tab undo stack exactly as before, while
// Group (no such stack) just re-renders/marks itself dirty instead.
import { escapeHtml } from "./auth-ui.js";
import { createSortable } from "./dnd.js";
import { initHelpSystem } from "./help.js";
import { loadReservedKeysSchema } from "./system-validation.js";
import { loadLibraryKinds } from "./content-fetch.js";

// One shared, lazily-fetched list of the suite's registered Library kinds
// ({id, label, plural}) — backs the `libraryKind` column's <select> options,
// the same registry Loom's own Entities/Systems pickers already read.
let libraryKindsPromise = null;
function ensureLibraryKinds() {
  if (!libraryKindsPromise) {
    libraryKindsPromise = loadLibraryKinds().catch(() => []);
  }
  return libraryKindsPromise;
}

// A field's own reserved-key "binding" vocabulary is its literal key for
// fieldRoles/derivedFormulas/levelUpBindings, but combatBindings has no
// fixed key of its own — it's whichever field the System's fieldRoles
// entries point at (role "combatBindings"). Resolving THAT needs the full
// sibling fields list, which this module doesn't otherwise track — a caller
// with that context (Loom's System editor) supplies `ctx.resolveFieldBindingKey`
// to cover it; this default only handles the 3 keys resolvable from the
// field alone.
const LITERAL_BINDING_KEYS = new Set(["fieldRoles", "derivedFormulas", "levelUpBindings"]);
function defaultResolveFieldBindingKey(field) {
  return LITERAL_BINDING_KEYS.has(field?.key) ? field.key : null;
}

// One shared <datalist> of the true-reserved-key names (buildSteps,
// derivedFormulas, fieldRoles, ...) — a suggestion, not a restriction, so
// it's harmless to also show on Group Properties' or a nested Sub-field's
// own Key input, not just a System's own top-level fields. Built lazily,
// once, the first time any Key input needs it.
const RESERVED_KEY_DATALIST_ID = "undercroft-reserved-key-datalist";
let reservedKeyDatalistReady = null;
function ensureReservedKeyDatalist() {
  if (!reservedKeyDatalistReady) {
    reservedKeyDatalistReady = loadReservedKeysSchema().then((schema) => {
      let datalist = document.getElementById(RESERVED_KEY_DATALIST_ID);
      if (!datalist) {
        datalist = document.createElement("datalist");
        datalist.id = RESERVED_KEY_DATALIST_ID;
        document.body.appendChild(datalist);
      }
      datalist.innerHTML = (schema.keys || [])
        .map((entry) => `<option value="${escapeHtml(entry.key)}" label="${escapeHtml(entry.description || "")}"></option>`)
        .join("");
    });
  }
  return reservedKeyDatalistReady;
}

// The type control is a single icon button that cycles through these on
// click (see renderPropertyRow) rather than a dropdown, so a row's whole
// first line — including this button — can double as a drag handle for
// reordering (a plain <select> would eat the drag gesture instead).
export const PROPERTY_TYPES = [
  { value: "string", label: "String", icon: "tabler:letter-case" },
  { value: "number", label: "Number", icon: "tabler:hash" },
  { value: "boolean", label: "Boolean", icon: "tabler:toggle-left" },
  { value: "object", label: "Object", icon: "tabler:braces" },
  { value: "array", label: "Array", icon: "tabler:brackets" },
];

export const VALUE_COLUMNS = [
  // `wide` (flex-grow instead of a fixed narrow width — see renderValueRow)
  // is Description-only: every other column is a short token (a number, a
  // dotted path, a short id) that fits a fixed few rem; Description is
  // prose, the same reason Extra JSON already grows.
  { key: "description", label: "Description", type: "string", placeholder: "Description", wide: true },
  { key: "shortName", label: "Short name", type: "string", placeholder: "Short name" },
  { key: "sourceId", label: "Source ID", type: "number", placeholder: "Source ID" },
  // Library family — `libraryKind` selects a category of Library records
  // (populated per-render from the suite's registered Library kinds, see
  // ensureLibraryKinds above); `libraryField` is the pointer *within* that
  // kind, interpreted per-consumer — a field name to read off a
  // dynamically-resolved record (levelUpBindings' own use) or, for a
  // "pick one specific record" array (e.g. a Classes list), the record's own
  // id. The latter case gets a convenience entity-picker next to the plain
  // text input (see populateDynamicValueSelects) — this is the one, unified
  // replacement for the retired field-level entityKind/entityId mechanism.
  { key: "libraryKind", label: "Library kind", type: "select", options: [] },
  { key: "libraryField", label: "Library field", type: "string", placeholder: "e.g. hit_die" },
  // Read/write reference family — one resolution mechanism (dotted-path.js),
  // varying only in which root object is walked and which direction. No `@`
  // prefix in any of these — the column itself already fixes what kind of
  // thing the value holds, so a sigil would be pure redundancy.
  { key: "recordField", label: "Record field", type: "string", placeholder: "e.g. stats.hitPoints.current" },
  { key: "sourceField", label: "Source field", type: "string", placeholder: "e.g. conditions" },
  { key: "targetPath", label: "Target path", type: "string", placeholder: "e.g. stats.armorClass" },
  // A named connection between System-authored data and hardcoded engine
  // code — options are resolved per-render from reserved-keys.json's
  // `bindings` map, keyed by which reserved key this field actually is (see
  // defaultResolveFieldBindingKey/ctx.resolveFieldBindingKey) — no per-key
  // branch here, just a data lookup.
  { key: "binding", label: "Binding", type: "select", options: [] },
  { key: "cost", label: "Cost", type: "number", placeholder: "Cost" },
  // Added for the Inventory Weight calculator's currency-weight lookup
  // (common/js/lib/calculator-modes/inventory-weight.js) — e.g. sys.dnd5e's
  // `currency` field values, lb-per-coin. Optional like every other column
  // here (fieldValueColumnState below only surfaces it once some value on
  // the field actually sets it), so this adds nothing to array fields that
  // aren't currency-shaped.
  { key: "weight", label: "Weight", type: "number", placeholder: "Weight" },
];

export function fieldValueColumnState(field) {
  // An object field's own per-Template map (buildSteps — see
  // renderPropertyRow's hasOpaqueObjectValues) has no single flat `values`
  // array to read — flatten every Template's own entries together so a
  // column any Template's steps actually use (e.g. `libraryKind`) still
  // auto-activates, same as a plain Enum array field would.
  const values = Array.isArray(field.values)
    ? field.values
    : field.values && typeof field.values === "object"
      ? Object.values(field.values).flatMap((entry) => (Array.isArray(entry) ? entry : []))
      : [];
  const anyValueHas = (key) => values.some((entry) => entry && typeof entry === "object" && entry[key] !== undefined);
  const state = {};
  // `binding`/`libraryKind` render as <select>s but their real options are
  // resolved per-field, asynchronously (see populateDynamicValueSelects) —
  // fieldValueColumnState itself runs synchronously, so both simply
  // auto-activate on bare key-presence like any other column, rather than
  // checking against a fixed option list the way a static select column would.
  VALUE_COLUMNS.forEach((column) => {
    state[column.key] = anyValueHas(column.key);
  });
  return state;
}

// Drag-to-reorder for Properties/Sub-fields/Record fields rows uses the same
// SortableJS wrapper Press's layout/canvas lists already use (common/js/lib/
// dnd.js) instead of hand-rolled HTML5 drag events, so it gets the same
// clear drop-zone feedback for free. No `group` option is set, so — unlike
// Press's palette/canvas, which deliberately move items between lists — a
// row can only reorder among its own siblings. `filter` + `preventOnFilter:
// false` excludes actual form controls (typing, checkboxes, Required/
// Remove/Add-*) from starting a drag, so those keep working normally —
// dragging can still start from the type icon or any other dead space in
// the row's first line.
//
// `ctx.captureDragSnapshot()` / `ctx.commitDragSnapshot(before)` are how a
// caller wires this gesture into ITS OWN undo/dirty tracking — SortableJS
// has already performed the DOM move by the time onEnd fires, so there's no
// "action" left to wrap the way a click handler's mutation can be; the
// caller gets a before-value from the first hook and decides what to do
// with it (push an undo entry, mark dirty, or nothing at all) in the
// second. Both are optional — omit them for a container that doesn't need
// undo integration at all.
export function initPropertySortable(container, ctx = {}) {
  if (!container) return;
  // SortableJS is a deferred CDN script (see Loom's own index.html comment
  // on load order) — this can run before it's finished loading the very
  // first time a page renders its first property row synchronously during
  // init. Every deferred/module script still runs synchronously back-to-back
  // before yielding to any timer, so a setTimeout(0) retry is guaranteed to
  // land after Sortable.min.js has finished executing.
  if (typeof Sortable === "undefined") {
    window.setTimeout(() => initPropertySortable(container, ctx), 0);
    return;
  }
  let dragBeforeSnapshot = null;
  createSortable(container, {
    handle: null,
    filter: "input, select, textarea, button:not([data-property-type])",
    preventOnFilter: false,
    onStart: () => {
      dragBeforeSnapshot = ctx.captureDragSnapshot ? ctx.captureDragSnapshot() : null;
    },
    onEnd: () => {
      ctx.commitDragSnapshot?.(dragBeforeSnapshot);
      dragBeforeSnapshot = null;
    },
  });
}

// Shared by the type button's own click-to-cycle handler (renderPropertyRow)
// and a caller's own Property Inspector Type <select>, if it has one (Loom's
// System editor does) — both just need to "set this row's type to this
// exact value," they differ only in how they land on that value (cycle to
// the next one vs. pick one directly). Pure DOM manipulation, no undo
// wrapping of its own — callers wrap their own call to this in whatever
// change-tracking they use.
export function applyPropertyType(row, typeButton, value, { refreshTooltips } = {}) {
  const meta = PROPERTY_TYPES.find((entry) => entry.value === value) || PROPERTY_TYPES[0];
  typeButton.dataset.value = meta.value;
  typeButton.querySelector(".iconify")?.setAttribute("data-icon", meta.icon);
  typeButton.setAttribute("aria-label", `Property type: ${meta.label} — click to change, drag to reorder`);
  typeButton.setAttribute("data-bs-title", `${meta.label} — click to change type, drag to reorder`);
  refreshTooltips?.(row);
  row._syncTypeSections?.();
}

// The main row editor — one property definition, with full recursive
// object/array (Sub-fields / Record fields) support. `ctx` fields:
//   - runChange(fn): REQUIRED. Wraps every mutation this row makes (type
//     cycle, Required toggle) — System passes
//     `(fn) => recordUndoableChange("system", fn)`; a caller with no undo
//     stack of its own can pass `(fn) => { fn(); markDirty(); }`.
//   - refreshTooltips(root): REQUIRED, Bootstrap tooltip init for the type/
//     Required buttons (a row built after page load needs this explicitly).
//   - initHelpSystem({root}): optional, wires up help-topic icons within
//     the row (array-option checkboxes) if the caller's page has any
//     registered for these topics.
//   - extraRowControls(row, field): optional — called once after the row's
//     own DOM is built, so a caller can inject additional per-row UI (e.g.
//     Group Properties' own top-level-only "Public" checkbox) without this
//     module needing to know that concept exists.
//   - dataManager, filterSystemId: passed through to populateLibraryFieldDatalist
//     for a values entry's own Library field autocomplete suggestions (Enum array mode).
//   - status: passed through to collectValueRow's own invalid-JSON warning
//     (only actually invoked from collectFieldFromRow, not from here, but
//     accepted here too so one `ctx` object works for every call in a
//     caller's own render+collect pair).
// One entry of an object field's Per-Template Values map (see
// renderPropertyRow's hasOpaqueObjectValues) — a Template id (the entry's
// own title, playing the same role "Allowed values"' static label plays for
// an ordinary Enum array field) with its own Add-value button right beside
// it — same header-then-rows shape as "Allowed values", just repeated once
// per Template instead of appearing once for the whole field. Rows below
// are the EXACT SAME value-row editor every Enum-mode array field already
// uses (VALUE_COLUMNS' shared checkbox row + renderValueRow per entry + an
// Extra JSON fallback for whatever a step's own heterogeneous shape doesn't
// map to a structured column) — never a bespoke raw-JSON textarea.
// buildSteps: a System with more than one creatable Template needing a
// different wizard for each (Blades in the Dark's Character vs. Crew) is
// the only reserved key using this shape today.
function createObjectMapEntryRow(templateKey = "") {
  const wrap = document.createElement("div");
  wrap.className = "d-flex flex-column gap-1";
  wrap.dataset.systemObjectMapEntry = "";
  wrap.innerHTML = `
    <div class="d-flex align-items-center justify-content-between gap-2">
      <input class="form-control form-control-sm fw-semibold" style="max-width: 16rem;" placeholder="Template id (e.g. tpl.bitd.character)" value="${escapeHtml(templateKey)}" data-system-object-map-key />
      <div class="d-flex align-items-center gap-1 flex-shrink-0">
        <button
          class="btn btn-outline-secondary btn-sm p-1"
          type="button"
          data-system-add-value
          aria-label="Add value"
          data-bs-toggle="tooltip"
          data-bs-placement="top"
          data-bs-title="Add value"
        >
          <span class="iconify" data-icon="tabler:plus" aria-hidden="true"></span>
        </button>
        <button
          class="btn btn-outline-danger btn-sm p-1"
          type="button"
          data-system-remove-object-map-entry
          aria-label="Remove Template entry"
          data-bs-toggle="tooltip"
          data-bs-placement="top"
          data-bs-title="Remove Template entry"
        >
          <span class="iconify" data-icon="tabler:trash" aria-hidden="true"></span>
        </button>
      </div>
    </div>
    <div class="d-flex flex-column gap-1" data-system-object-map-value-rows></div>
  `;
  return wrap;
}

// Shared by collectFieldFromRow's array-Enum and object-map branches — both
// collect the exact same VALUE_COLUMNS checkbox state from this field's one
// shared checkbox row (see renderPropertyRow's arrayOptionsHtml, shown for
// either mode — see syncArrayOptionsVisibility).
function collectValueColumnOptions(row) {
  const options = {};
  VALUE_COLUMNS.forEach((column) => {
    options[column.key] = row.querySelector(`[data-property-option="${column.key}"]`)?.checked ?? false;
  });
  return options;
}

export function renderPropertyRow(field = {}, container, ctx = {}) {
  if (!container) return null;
  void ensureReservedKeyDatalist();
  const row = document.createElement("div");
  row.className = "border rounded-3 p-2 d-flex flex-column gap-2";
  // Kept so collectFieldFromRow can merge its output back over this instead
  // of reconstructing the field from only the inputs below — any property
  // this editor has no dedicated control for (a single field's own stat
  // block, or anything not yet promoted to a structured input) survives a
  // save untouched instead of being silently dropped.
  row._originalField = field;
  const currentTypeMeta = PROPERTY_TYPES.find((entry) => entry.value === field.type) || PROPERTY_TYPES[0];
  // Records mode ("item") also covers an array field whose own children live
  // as a bare top-level `children` sibling of `values` — see the
  // itemChildren fallback below for why that shape exists and is just as
  // real as `item.children`.
  const hasBareRecordChildren = field.type === "array" && Array.isArray(field.children) && field.children.length > 0;
  const arrayMode = field.item || hasBareRecordChildren ? "item" : "values";
  const columnState = fieldValueColumnState(field);
  // Custom-built rather than Bootstrap's .form-check/.form-check-inline —
  // those assume a stacked layout and carry their own ~1rem right margin on
  // top of this row's own flex `gap`, which used to push this row into a
  // horizontal scrollbar. A plain flex pair (gap-1 between one checkbox and
  // its own label, extra-small text, no Bootstrap form-check margins) packs
  // each option tighter with no loss of the click target — the container's
  // own `gap-3` below is the breathing room BETWEEN options. One shared
  // help icon (loom.systemArrayOptions, added once before the checkboxes
  // below) documents every column in one place now, instead of a "?" badge
  // per checkbox eating further width.
  // `order` (flex order, not DOM position — see reorderArrayOptions) puts a
  // checked option ahead of every unchecked one, in the same relative
  // VALUE_COLUMNS sequence a checked column's own value-row input already
  // collapses to (an unchecked column's input is `hidden`, so the visible
  // ones already compact to the front there) — this is what makes it
  // obvious at a glance which checkbox owns which input below, rather than
  // a checked box sitting wherever its column happens to fall among all 11.
  const optionCheckbox = (key, label, index, checked) => {
    const inputId = `system-prop-${key}-${Math.random().toString(36).slice(2)}`;
    const order = checked ? index : index + VALUE_COLUMNS.length;
    return `
    <div class="d-flex align-items-center gap-1 flex-shrink-0" data-option-wrap="${key}" style="order: ${order};">
      <input class="form-check-input m-0" type="checkbox" ${checked ? "checked" : ""} id="${inputId}" data-property-option="${key}" style="cursor: pointer;" />
      <label class="form-check-label extra-small mb-0 text-nowrap" for="${inputId}" style="cursor: pointer;">${label}</label>
    </div>
  `;
  };
  const arrayOptionsHtml = VALUE_COLUMNS.map((column, index) => optionCheckbox(column.key, column.label, index, columnState[column.key])).join("");
  // Name isn't a VALUE_COLUMNS entry (it's always present, never optional),
  // but it IS always the first control in every value row below — this
  // disabled, always-checked checkbox just labels that column the same way
  // every other one is labeled, instead of leaving it the one unmarked input.
  const nameColumnId = `system-prop-name-${Math.random().toString(36).slice(2)}`;
  // An "object" field's `values` (as opposed to `children`) is opaque here —
  // this editor only ever reads/writes an object field's Sub-fields. A
  // reserved key with its own documented alternate shape there (buildSteps'
  // per-Template-id map, e.g. Blades in the Dark: Character vs. Crew — see
  // getDeclaredBuildSteps in workbench-character-view.js and reserved-keys.
  // json's own `perTemplateMapType`) still needs that data to survive a
  // save untouched even though there's no UI here to show or edit it.
  const hasOpaqueObjectValues =
    field.type === "object" && field.values && typeof field.values === "object" && !Array.isArray(field.values);
  row.innerHTML = `
    <div class="d-flex align-items-center gap-2">
      <button
        type="button"
        class="btn btn-outline-secondary btn-sm flex-shrink-0"
        style="cursor: grab;"
        data-property-type
        data-value="${currentTypeMeta.value}"
        data-bs-toggle="tooltip"
        data-bs-placement="top"
        data-bs-title="${currentTypeMeta.label} — click to change type, drag to reorder"
        aria-label="Property type: ${currentTypeMeta.label} — click to change, drag to reorder"
      >
        <span class="iconify" data-icon="${currentTypeMeta.icon}" aria-hidden="true"></span>
      </button>
      <input class="form-control form-control-sm" style="max-width: 8rem;" placeholder="key (e.g. abilities.strength)" value="${escapeHtml(field.key || "")}" list="${RESERVED_KEY_DATALIST_ID}" data-property-key />
      <input class="form-control form-control-sm flex-grow-1" style="min-width: 5rem;" placeholder="Label" value="${escapeHtml(field.label || "")}" data-property-label />
      <select class="form-select form-select-sm flex-shrink-0" style="max-width: 8rem;" data-property-array-mode hidden>
        <option value="values"${arrayMode === "values" ? " selected" : ""}>Enum</option>
        <option value="item"${arrayMode === "item" ? " selected" : ""}>Records</option>
      </select>
      <input class="form-control form-control-sm flex-shrink-0" style="max-width: 6rem;" placeholder="Default" value="${escapeHtml(field.default ?? "")}" data-property-default hidden />
      <input class="form-control form-control-sm flex-shrink-0" style="max-width: 4.5rem;" type="number" placeholder="Min" value="${field.minimum ?? ""}" data-property-minimum hidden />
      <input class="form-control form-control-sm flex-shrink-0" style="max-width: 4.5rem;" type="number" placeholder="Max" value="${field.maximum ?? ""}" data-property-maximum hidden />
      <button
        class="btn btn-sm flex-shrink-0 ${field.required ? "btn-primary" : "btn-outline-secondary"}"
        type="button"
        data-property-required
        aria-pressed="${field.required ? "true" : "false"}"
        data-bs-toggle="tooltip"
        data-bs-placement="top"
        data-bs-title="Required"
        aria-label="Required"
      >
        <span class="iconify" data-icon="tabler:asterisk" aria-hidden="true"></span>
      </button>
      <button
        class="btn btn-outline-danger btn-sm flex-shrink-0"
        type="button"
        data-property-remove
        aria-label="Remove property"
        data-bs-toggle="tooltip"
        data-bs-placement="top"
        data-bs-title="Remove property"
      >
        <span class="iconify" data-icon="tabler:trash" aria-hidden="true"></span>
      </button>
    </div>
    <div class="d-flex flex-nowrap overflow-x-auto gap-3 align-items-center pb-1" data-system-array-options hidden>
      <span class="align-middle flex-shrink-0" style="order: -2;" data-help-topic="loom.systemArrayOptions" data-help-insert="replace"></span>
      <div class="d-flex align-items-center gap-1 flex-shrink-0" style="order: -1;">
        <input class="form-check-input m-0" type="checkbox" checked disabled id="${nameColumnId}" style="cursor: default;" />
        <label class="form-check-label extra-small mb-0 text-nowrap" for="${nameColumnId}" style="cursor: default;">Name</label>
      </div>
      ${arrayOptionsHtml}
    </div>
    <div class="d-flex flex-column gap-2 ps-3 border-start" data-system-object-section hidden>
      <div class="d-flex align-items-center justify-content-end gap-2">
        <button
          class="btn btn-outline-secondary btn-sm p-1"
          type="button"
          data-system-add-child
          aria-label="Add sub-field"
          data-bs-toggle="tooltip"
          data-bs-placement="top"
          data-bs-title="Add sub-field"
        >
          <span class="iconify" data-icon="tabler:plus" aria-hidden="true"></span>
        </button>
      </div>
      <div class="d-flex flex-column gap-2" data-system-children></div>
    </div>
    <div class="d-flex flex-column gap-2 ps-3 border-start" data-system-object-map-section hidden>
      <div class="d-flex align-items-center justify-content-between gap-2">
        <label class="small text-body-secondary mb-0">Per-Template Values</label>
        <button
          class="btn btn-outline-secondary btn-sm p-1"
          type="button"
          data-system-add-object-map-entry
          aria-label="Add Template entry"
          data-bs-toggle="tooltip"
          data-bs-placement="top"
          data-bs-title="Add Template entry"
        >
          <span class="iconify" data-icon="tabler:plus" aria-hidden="true"></span>
        </button>
      </div>
      <div class="d-flex flex-column gap-3" data-system-object-map-entries></div>
    </div>
    <div class="d-flex flex-column gap-2 ps-3 border-start" data-system-array-section hidden>
      <div class="d-flex flex-column gap-1" data-system-values-section hidden>
        <div class="d-flex align-items-center justify-content-between gap-2">
          <label class="small text-body-secondary mb-0">Allowed values</label>
          <button
            class="btn btn-outline-secondary btn-sm p-1"
            type="button"
            data-system-add-value
            aria-label="Add value"
            data-bs-toggle="tooltip"
            data-bs-placement="top"
            data-bs-title="Add value"
          >
            <span class="iconify" data-icon="tabler:plus" aria-hidden="true"></span>
          </button>
        </div>
        <div class="d-flex flex-column gap-1" data-system-value-rows></div>
      </div>
      <div class="d-flex flex-column gap-2" data-system-item-section hidden>
        <div class="row g-2 align-items-center">
          <div class="col-6">
            <input class="form-control form-control-sm" placeholder="Record label" value="${escapeHtml(field.item?.label || "")}" data-item-label />
          </div>
          <div class="col-6">
            <input class="form-control form-control-sm" placeholder="Display field key (e.g. inventory[].name)" value="${escapeHtml(field.item?.displayField || "")}" data-item-display-field />
          </div>
        </div>
        <div class="d-flex align-items-center justify-content-between gap-2">
          <span class="small text-body-secondary">Record fields</span>
          <button
            class="btn btn-outline-secondary btn-sm p-1"
            type="button"
            data-system-add-item-child
            aria-label="Add record field"
            data-bs-toggle="tooltip"
            data-bs-placement="top"
            data-bs-title="Add record field"
          >
            <span class="iconify" data-icon="tabler:plus" aria-hidden="true"></span>
          </button>
        </div>
        <div class="d-flex flex-column gap-2" data-system-item-children></div>
      </div>
    </div>
  `;
  container.appendChild(row);
  // A row built long after page load needs its own help-topic icons/
  // tooltips wired explicitly — the caller's one page-init call for each of
  // these never reaches a row created this late.
  void ctx.initHelpSystem?.({ root: row });
  ctx.refreshTooltips?.(row);

  const requiredButton = row.querySelector("[data-property-required]");
  requiredButton.addEventListener("click", () => {
    ctx.runChange(() => {
      const pressed = requiredButton.getAttribute("aria-pressed") === "true";
      requiredButton.setAttribute("aria-pressed", pressed ? "false" : "true");
      requiredButton.classList.toggle("btn-primary", !pressed);
      requiredButton.classList.toggle("btn-outline-secondary", pressed);
    });
  });

  // Bootstrap's own utility classes are `!important` (the same "hidden +
  // d-none" workaround used throughout this suite), so both need toggling
  // together.
  const typeButton = row.querySelector("[data-property-type]");
  const arrayOptions = row.querySelector("[data-system-array-options]");
  const defaultInput = row.querySelector("[data-property-default]");
  const minInput = row.querySelector("[data-property-minimum]");
  const maxInput = row.querySelector("[data-property-maximum]");
  const objectSection = row.querySelector("[data-system-object-section]");
  const objectMapSection = row.querySelector("[data-system-object-map-section]");
  const arraySection = row.querySelector("[data-system-array-section]");
  const arrayModeSelect = row.querySelector("[data-property-array-mode]");
  const valuesSection = row.querySelector("[data-system-values-section]");
  const itemSection = row.querySelector("[data-system-item-section]");
  const valueRowsContainer = row.querySelector("[data-system-value-rows]");

  const showHide = (el, show) => {
    el.hidden = !show;
    el.classList.toggle("d-none", !show);
  };

  // Array Value Options only means anything for Enum mode (a flat,
  // System-defined `values` list) — Records mode's own rows are Sub-field
  // definitions (`item.children`), never touched by VALUE_COLUMNS, so the
  // checkboxes would just sit there doing nothing. Depends on both the
  // property's own type AND its array mode, so it's kept as one function
  // both syncTypeSections (type just changed) and syncArrayModeSections
  // (mode just changed) call, rather than duplicating the condition. An
  // object field's own Per-Template map (hasOpaqueObjectValues) is the same
  // "Enum" shape one level down — every Template's own list of values
  // shares this one checkbox row too, rather than each Template getting its
  // own separate set.
  const syncArrayOptionsVisibility = () => {
    const isEnumArray = typeButton.dataset.value === "array" && arrayModeSelect.value === "values";
    const isObjectMap = hasOpaqueObjectValues && typeButton.dataset.value === "object";
    showHide(arrayOptions, isEnumArray || isObjectMap);
  };
  const syncTypeSections = () => {
    const currentType = typeButton.dataset.value;
    const isObject = currentType === "object";
    const isArray = currentType === "array";
    const isScalar = ["string", "number", "boolean"].includes(currentType);
    // A Per-Template map (buildSteps) is a DIFFERENT shape from ordinary
    // object Sub-fields, never both — Sub-fields' own "Add sub-field" has no
    // business appearing on a field that's really a named group of Enum
    // value lists, so the two sections are mutually exclusive, not stacked.
    showHide(objectSection, isObject && !hasOpaqueObjectValues);
    showHide(objectMapSection, isObject && hasOpaqueObjectValues);
    showHide(arraySection, isArray);
    syncArrayOptionsVisibility();
    arrayModeSelect.hidden = !isArray;
    defaultInput.hidden = !isScalar;
    minInput.hidden = currentType !== "number";
    maxInput.hidden = currentType !== "number";
  };
  // Stashed so a caller's own Property Inspector (a separate, later-defined
  // set of functions, if it has one) can trigger this same row's section
  // visibility after setting a type from its own <select>, without needing
  // access to this closure's other locals.
  row._syncTypeSections = syncTypeSections;
  const syncArrayModeSections = () => {
    const isValues = arrayModeSelect.value === "values";
    showHide(valuesSection, isValues);
    showHide(itemSection, !isValues);
    syncArrayOptionsVisibility();
  };
  // Re-applies every value row's column visibility to match this field's own
  // current option checkboxes — called on load and whenever an option is
  // toggled, so a field's rows always reflect what's actually enabled for it
  // rather than needing a full re-render. Applies to both this field's own
  // classic Enum value rows AND every Template's own value rows under the
  // Per-Template map (data-system-object-map-value-rows) — a distinct
  // attribute from data-system-value-rows specifically so this row's own
  // (always-present-but-hidden-unless-Enum) array-values container can't
  // collide with them in a `querySelector` (first-match) lookup.
  const syncValueColumns = () => {
    const state = {};
    VALUE_COLUMNS.forEach((column, index) => {
      const checked = row.querySelector(`[data-property-option="${column.key}"]`)?.checked ?? false;
      state[column.key] = checked;
      const wrap = row.querySelector(`[data-option-wrap="${column.key}"]`);
      if (wrap) wrap.style.order = checked ? index : index + VALUE_COLUMNS.length;
    });
    Array.from(valueRowsContainer.children).forEach((valueRow) => applyValueRowColumns(valueRow, state));
    row.querySelectorAll("[data-system-object-map-value-rows]").forEach((container) => {
      Array.from(container.children).forEach((valueRow) => applyValueRowColumns(valueRow, state));
    });
  };
  // Click cycles to the next type in PROPERTY_TYPES (wrapping around) rather
  // than opening a dropdown — see PROPERTY_TYPES' own comment for why. A
  // plain click never triggers the drag handlers below (those need real
  // pointer movement past a browser threshold first), so both interactions
  // coexist on the same element without conflict.
  typeButton.addEventListener("click", () => {
    ctx.runChange(() => {
      const currentIndex = PROPERTY_TYPES.findIndex((entry) => entry.value === typeButton.dataset.value);
      const next = PROPERTY_TYPES[(currentIndex + 1) % PROPERTY_TYPES.length];
      applyPropertyType(row, typeButton, next.value, ctx);
    });
  });
  arrayModeSelect.addEventListener("change", syncArrayModeSections);
  row.querySelectorAll("[data-property-option]").forEach((checkbox) => checkbox.addEventListener("change", syncValueColumns));
  syncTypeSections();
  syncArrayModeSections();

  // An array field's own Records-mode sub-fields have two authored shapes in
  // the wild — `item.children` (dnd5e/dnd5e2014's own convention, carrying
  // `item.label`/`item.displayField` alongside) and a bare top-level
  // `children` sibling to `values` (every other System — see bindings.js'
  // resolveDottedPath and system-schema.js's collectSystemFields, both of
  // which already prefer this shape first). Only an "object"-type field's
  // Sub-fields section owns bare `children`; for "array", it means Records
  // mode instead, so it renders into the item section, never both.
  const childrenContainer = row.querySelector("[data-system-children]");
  if (field.type !== "array") {
    (field.children || []).forEach((child) => renderPropertyRow(child, childrenContainer, ctx));
    initPropertySortable(childrenContainer, ctx);
  }

  const itemChildrenContainer = row.querySelector("[data-system-item-children]");
  const itemChildren = field.item?.children || (field.type === "array" ? field.children : null) || [];
  itemChildren.forEach((child) => renderPropertyRow(child, itemChildrenContainer, ctx));
  initPropertySortable(itemChildrenContainer, ctx);

  // Resolved once and shared by both the classic Enum values loop below AND
  // the Per-Template map loop — buildSteps isn't itself a bindingKey-bearing
  // reserved key (fieldRoles/derivedFormulas/levelUpBindings/combatBindings
  // are), so this resolves falsy for it either way, same as any other
  // ordinary Enum field with no binding vocabulary of its own.
  const bindingKey = (ctx.resolveFieldBindingKey || defaultResolveFieldBindingKey)(field, ctx);

  const objectMapEntriesContainer = row.querySelector("[data-system-object-map-entries]");
  if (hasOpaqueObjectValues && objectMapEntriesContainer) {
    Object.entries(field.values).forEach(([templateKey, templateValues]) => {
      const entryRow = createObjectMapEntryRow(templateKey);
      objectMapEntriesContainer.appendChild(entryRow);
      // Built well after this field's own row-level refreshTooltips call
      // already ran (see below) — needs its own, same reasoning as that
      // call's own comment.
      ctx.refreshTooltips?.(entryRow);
      const entryValueRows = entryRow.querySelector("[data-system-object-map-value-rows]");
      (Array.isArray(templateValues) ? templateValues : []).forEach((entry) => {
        const valueRow = renderValueRow(entry, entryValueRows);
        ctx.refreshTooltips?.(valueRow);
        const source = typeof entry === "object" && entry !== null ? entry : {};
        void populateDynamicValueSelects(valueRow, bindingKey, source);
        wireLibraryFieldAutocomplete(valueRow, source.libraryKind || "", !bindingKey, ctx);
      });
    });
  }

  (Array.isArray(field.values) ? field.values : []).forEach((entry) => {
    const valueRow = renderValueRow(entry, valueRowsContainer);
    ctx.refreshTooltips?.(valueRow);
    const source = typeof entry === "object" && entry !== null ? entry : {};
    void populateDynamicValueSelects(valueRow, bindingKey, source);
    wireLibraryFieldAutocomplete(valueRow, source.libraryKind || "", !bindingKey, ctx);
  });
  syncValueColumns();

  ctx.extraRowControls?.(row, field);

  return row;
}

// Shows/hides one value row's optional columns to match its field's current
// option checkboxes (see syncValueColumns above) — called on initial render
// and again live whenever a checkbox is toggled.
export function applyValueRowColumns(valueRow, state) {
  VALUE_COLUMNS.forEach((column) => {
    const wrap = valueRow.querySelector(`[data-value-column="${column.key}"]`);
    if (wrap) {
      wrap.hidden = !state[column.key];
      wrap.classList.toggle("d-none", !state[column.key]);
    }
  });
}

export function renderValueRow(entry = {}, container) {
  if (!container) return null;
  const name = typeof entry === "string" ? entry : entry?.name || "";
  const source = typeof entry === "object" && entry !== null ? entry : {};
  // Kept so collectValueRow's value collection can merge its output back
  // over this instead of reconstructing from scratch — same reasoning as
  // row._originalField above.
  const libraryFieldDatalistId = `system-value-library-field-${Math.random().toString(36).slice(2)}`;
  const columnInputs = VALUE_COLUMNS.map((column) => {
    const currentValue = source[column.key] ?? "";
    const control =
      column.type === "select"
        ? `<select class="form-select form-select-sm" style="width: 9rem;" data-value-column-input="${column.key}">
            ${(column.options || [])
              .map(
                (option) =>
                  `<option value="${escapeHtml(option.value)}"${option.value === currentValue ? " selected" : ""}>${escapeHtml(option.label)}</option>`
              )
              .join("")}
          </select>`
        : `<input
            class="form-control form-control-sm"
            style="${column.wide ? "min-width: 12rem;" : "width: 9rem;"}"
            type="${column.type === "number" ? "number" : "text"}"
            placeholder="${column.placeholder}"
            value="${escapeHtml(currentValue)}"
            data-value-column-input="${column.key}"
            ${column.key === "libraryField" ? `list="${libraryFieldDatalistId}"` : ""}
          />`;
    // `libraryField` gets a paired <datalist> (see wireLibraryFieldAutocomplete)
    // instead of a second visible control — a datalist never renders its own
    // element, so this stays exactly one input tall like every other column,
    // while still offering real entities of the row's own `libraryKind` as
    // native-autocomplete suggestions. Never required — typing directly
    // (a field name, for levelUpBindings-style rows) always works regardless.
    if (column.key === "libraryField") {
      return `<div class="flex-shrink-0" data-value-column="${column.key}" hidden>
        ${control}
        <datalist data-value-library-field-datalist id="${libraryFieldDatalistId}"></datalist>
      </div>`;
    }
    return `<div class="${column.wide ? "flex-grow-1" : "flex-shrink-0"}" data-value-column="${column.key}" hidden>${control}</div>`;
  }).join("");
  // Anything beyond the columns above (a field-specific stat block, or
  // anything not yet promoted to a structured input) isn't worth a bespoke
  // input per property — shown/edited as one JSON object instead, so an
  // unknown property is never silently dropped on save.
  const extra = { ...source };
  delete extra.name;
  VALUE_COLUMNS.forEach((column) => delete extra[column.key]);
  const extraJson = Object.keys(extra).length ? JSON.stringify(extra) : "";
  const row = document.createElement("div");
  row.className = "d-flex align-items-center gap-2";
  row.dataset.systemValueRow = "";
  row._originalValue = entry;
  row.innerHTML = `
    <input class="form-control form-control-sm flex-shrink-0" style="width: 10rem;" placeholder="Name" value="${escapeHtml(name)}" data-value-name />
    ${columnInputs}
    <input class="form-control form-control-sm font-monospace flex-grow-1" style="min-width: 6rem;" placeholder="Extra JSON" value="${escapeHtml(extraJson)}" data-value-extra />
    <button
      class="btn btn-outline-danger btn-sm flex-shrink-0"
      type="button"
      data-remove-value
      aria-label="Remove value"
      data-bs-toggle="tooltip"
      data-bs-placement="top"
      data-bs-title="Remove value"
    >
      <span class="iconify" data-icon="tabler:trash" aria-hidden="true"></span>
    </button>
  `;
  container.appendChild(row);
  return row;
}

// Populates the two dynamically-optioned <select> columns (see VALUE_COLUMNS
// above) for one value row: `binding` from reserved-keys.json's `bindings`
// map, keyed by `bindingKey` (this field's own reserved key, resolved once
// per renderPropertyRow call — see defaultResolveFieldBindingKey/
// ctx.resolveFieldBindingKey); `libraryKind` from the suite's registered
// Library kinds, the same registry Loom's own Entities/Systems pickers use.
// A stored value naming a binding/kind the current lookup doesn't know about
// (data authored before a rename, or against a since-removed kind) is kept
// as a selected option anyway, same reasoning as populateValueEntitySelect —
// saving never silently discards it.
export async function populateDynamicValueSelects(valueRow, bindingKey, source = {}) {
  const bindingSelect = valueRow?.querySelector('[data-value-column-input="binding"]');
  if (bindingSelect) {
    const schema = await loadReservedKeysSchema();
    const options = bindingKey ? schema.bindings?.[bindingKey] || [] : [];
    bindingSelect.innerHTML = `<option value="">—</option>`;
    options.forEach((entry) => {
      const option = document.createElement("option");
      option.value = entry.name;
      option.textContent = entry.name;
      option.title = entry.description || "";
      if (entry.name === source.binding) option.selected = true;
      bindingSelect.appendChild(option);
    });
    if (source.binding && !options.some((entry) => entry.name === source.binding)) {
      const option = document.createElement("option");
      option.value = source.binding;
      option.textContent = `${source.binding} (not found)`;
      option.selected = true;
      bindingSelect.appendChild(option);
    }
  }
  const libraryKindSelect = valueRow?.querySelector('[data-value-column-input="libraryKind"]');
  if (libraryKindSelect) {
    const kinds = await ensureLibraryKinds();
    libraryKindSelect.innerHTML = `<option value="">—</option>`;
    kinds.forEach((kind) => {
      const option = document.createElement("option");
      option.value = kind.id;
      option.textContent = kind.label || kind.id;
      if (kind.id === source.libraryKind) option.selected = true;
      libraryKindSelect.appendChild(option);
    });
    if (source.libraryKind && !kinds.some((kind) => kind.id === source.libraryKind)) {
      const option = document.createElement("option");
      option.value = source.libraryKind;
      option.textContent = `${source.libraryKind} (not found)`;
      option.selected = true;
      libraryKindSelect.appendChild(option);
    }
  }
}

// Sequential (not concurrent) fetches — Properties editing is a
// low-frequency admin action over small lists, not worth the added
// complexity of a concurrency-limited batch fetch used elsewhere for larger
// ones. `ctx.dataManager` is required to do anything at all; `ctx.
// filterSystemId`, if set, narrows the list to entities that declare that
// System among their own systemIds (System's own editor uses its own,
// currently-being-edited systemId; a caller with no such concept — Group
// Properties — omits it and gets every entity of the kind instead).
export async function populateLibraryFieldDatalist(datalist, kind, ctx = {}) {
  if (!datalist) return;
  datalist.innerHTML = "";
  const dataManager = ctx.dataManager;
  if (!kind || !dataManager) return;
  const filterSystemId = (ctx.filterSystemId || "").trim();
  let ids = [];
  try {
    const { remote } = await dataManager.list(kind, { refresh: true, includeLocal: false });
    ids = dataManager.collectListEntries(remote, ["owned", "shared", "public", "items"]).map((entry) => entry.id);
  } catch (error) {
    return;
  }
  for (const id of ids) {
    let entity = null;
    try {
      entity = (await dataManager.get(kind, id))?.payload;
    } catch (error) {
      continue;
    }
    const systemIds = Array.isArray(entity?.systemIds) ? entity.systemIds : [];
    if (filterSystemId && !systemIds.includes(filterSystemId)) continue;
    const option = document.createElement("option");
    option.value = id;
    option.label = entity?.name || id;
    datalist.appendChild(option);
  }
}

// Wires one value row's `libraryField` autocomplete suggestions (see
// renderValueRow) — the one, unified replacement for the retired
// entityKind/entityId "Library-linked" mechanism. Only relevant for a
// "pick one specific record" array (e.g. a System's own Classes list, where
// libraryField holds that record's own id) — `allowSuggestions` is
// `!bindingKey` (see renderPropertyRow), since a field WITH a binding
// vocabulary (fieldRoles/derivedFormulas/levelUpBindings) always uses
// libraryField as a plain field NAME instead (e.g. "proficiency_choices"),
// where suggesting record ids would be actively wrong. When allowed,
// populates the row's paired <datalist> against its own `libraryKind` (via
// populateLibraryFieldDatalist, sharing the exact same fetch/filter
// behavior the old mechanism had), re-populating whenever that row's own
// Library kind select changes. A <datalist> never renders a visible element
// of its own, so the text input stays the only control the user sees —
// typing a suggested entity's id (or anything else) is all the same "type
// into the field" action, unlike the old separate picker <select>.
// `initialKind` is the row's already-known starting value — read
// synchronously from the original data rather than the `libraryKind`
// <select>'s own live value, which populateDynamicValueSelects fills in
// asynchronously and may not have landed yet at this point in the same
// render pass.
export function wireLibraryFieldAutocomplete(valueRow, initialKind, allowSuggestions, ctx = {}) {
  const kindSelect = valueRow?.querySelector('[data-value-column-input="libraryKind"]');
  const datalist = valueRow?.querySelector("[data-value-library-field-datalist]");
  if (!kindSelect || !datalist || !allowSuggestions) return;
  kindSelect.addEventListener("change", () => populateLibraryFieldDatalist(datalist, kindSelect.value, ctx));
  void populateLibraryFieldDatalist(datalist, initialKind, ctx);
}

export function collectValueRow(valueRow, options, ctx = {}) {
  const name = valueRow.querySelector("[data-value-name]")?.value.trim() || "";
  const extraRaw = valueRow.querySelector("[data-value-extra]")?.value.trim() || "";
  let extra = {};
  if (extraRaw) {
    try {
      extra = JSON.parse(extraRaw);
    } catch (error) {
      ctx.status?.show(`"${name || "This entry"}"'s extra properties aren't valid JSON — saved without them.`, {
        type: "warning",
        timeout: 4000,
      });
    }
  }
  // Merge over the original entry (see renderValueRow) so anything not
  // covered by a column input or the extra-JSON box — a field-specific stat
  // this editor doesn't know about yet — still survives.
  const original = valueRow._originalValue && typeof valueRow._originalValue === "object" ? valueRow._originalValue : {};
  const value = { ...original, ...extra };
  delete value.name;
  if (name) value.name = name;
  // Only a column this field actually opted into (its own checkbox) is
  // managed here at all — deleting a VALUE_COLUMNS key unconditionally
  // would silently wipe a same-named property this UI was never given
  // control over, the exact kind of silent data loss this editor is
  // supposed to never do.
  VALUE_COLUMNS.forEach((column) => {
    if (!options[column.key]) return;
    delete value[column.key];
    const raw = valueRow.querySelector(`[data-value-column-input="${column.key}"]`)?.value ?? "";
    if (raw === "") return;
    value[column.key] = column.type === "number" ? Number(raw) : raw;
  });
  // Only a genuinely empty row (no Name, no columns, no extra JSON, no
  // original data) is dropped now — a blank Name alone used to silently
  // discard the whole row, which lost real data for buildSteps (keyed by
  // `step`), derivedFormulas (keyed by `binding`), and fieldRoles (keyed by
  // `sourceField`+`binding`), none of which use `name` at all. See
  // findUnnamedValueEntries for the save-time nudge toward adding one.
  return Object.keys(value).length ? value : null;
}

// Walks a collected `fields` array (post-collectFieldsFromContainer, so
// already recursed through object/array-of-object nesting) for array value
// entries with no `name` — used at save time to prompt rather than silently
// accept, since collectValueRow itself no longer drops or invents one.
export function findUnnamedValueEntries(fields) {
  const found = [];
  const walk = (list) => {
    (list || []).forEach((field) => {
      if (Array.isArray(field.values)) {
        field.values.forEach((value) => {
          if (value && typeof value === "object" && !value.name) found.push({ field, value });
        });
      }
      if (Array.isArray(field.children)) walk(field.children);
      if (field.item?.children) walk(field.item.children);
    });
  };
  walk(fields);
  return found;
}

export function collectFieldFromRow(row, ctx = {}) {
  const key = row.querySelector("[data-property-key]").value.trim();
  const label = row.querySelector("[data-property-label]").value.trim();
  const type = row.querySelector("[data-property-type]").dataset.value;
  const defaultRaw = row.querySelector("[data-property-default]").value;
  const minimum = row.querySelector("[data-property-minimum]").value;
  const maximum = row.querySelector("[data-property-maximum]").value;
  const required = row.querySelector("[data-property-required]").getAttribute("aria-pressed") === "true";

  // Start from the original field (see renderPropertyRow) so any property
  // this editor has no dedicated control for survives a save untouched,
  // instead of a bare `{ type, key, label }` silently discarding it. Every
  // property the UI DOES control below is explicitly deleted first so
  // unchecking/clearing it in the UI actually takes effect rather than the
  // stale original winning.
  const field = { ...(row._originalField || {}), type, key, label };
  delete field.category;
  delete field.default;
  delete field.required;
  delete field.minimum;
  delete field.maximum;
  delete field.children;
  delete field.item;
  delete field.values;

  if (defaultRaw !== "") field.default = defaultRaw;
  if (required) field.required = true;
  if (type === "number") {
    if (minimum !== "") field.minimum = Number(minimum);
    if (maximum !== "") field.maximum = Number(maximum);
  }
  if (type === "object") {
    const children = collectFieldsFromContainer(row.querySelector("[data-system-children]"), ctx);
    if (children.length) field.children = children;
    // Per-Template Values — see renderPropertyRow's
    // hasOpaqueObjectValues/objectMapEntries. Each Template's own list
    // collects through the exact same collectValueRow every Enum-mode array
    // field's values already use (shared VALUE_COLUMNS checkbox state via
    // collectValueColumnOptions), not a JSON blob. The section's own
    // `hidden` state (not entry count) says whether this field went through
    // this editing path at all: a field that never had one stays untouched
    // below; one that did, but was emptied down to zero entries by the
    // Remove button, correctly ends up with an empty `values: {}` rather
    // than having its stale original silently restored.
    const objectMapSection = row.querySelector("[data-system-object-map-section]");
    if (objectMapSection && !objectMapSection.hidden) {
      const options = collectValueColumnOptions(row);
      const values = {};
      Array.from(row.querySelectorAll("[data-system-object-map-entry]")).forEach((entryRow) => {
        const entryKey = entryRow.querySelector("[data-system-object-map-key]")?.value.trim();
        if (!entryKey) return;
        const valueRows = Array.from(entryRow.querySelector("[data-system-object-map-value-rows]")?.children || []);
        values[entryKey] = valueRows.map((valueRow) => collectValueRow(valueRow, options, ctx)).filter(Boolean);
      });
      field.values = values;
    } else if (!children.length) {
      // Neither Sub-fields nor the Per-Template map UI ever activated for
      // this field — an opaque original shape round-trips untouched rather
      // than being silently wiped just because this editor has nothing to
      // say about it yet.
      const originalValues = row._originalField?.values;
      if (originalValues && typeof originalValues === "object" && !Array.isArray(originalValues)) {
        field.values = originalValues;
      }
    }
  }
  if (type === "array") {
    const arrayMode = row.querySelector("[data-property-array-mode]")?.value || "values";
    if (arrayMode === "item") {
      const itemLabel = row.querySelector("[data-item-label]")?.value.trim();
      const displayField = row.querySelector("[data-item-display-field]")?.value.trim();
      const children = collectFieldsFromContainer(row.querySelector("[data-system-item-children]"), ctx);
      // A field already using the bare top-level `children` shape (every
      // System except dnd5e/dnd5e2014 — see renderPropertyRow's
      // hasBareRecordChildren) keeps using it, unmigrated, since it's
      // already what bindings.js/system-schema.js both read natively —
      // unless the user actually types a Record label/Display field, which
      // has nowhere to live there, promoting it to item.children on this
      // save. Anything else (dnd5e's own item.children convention, or a
      // brand-new Records-mode field) keeps the pre-existing item.children
      // shape, unchanged from before this fallback existed.
      const originalField = row._originalField || {};
      const usesBareShape = Array.isArray(originalField.children) && originalField.children.length > 0 && !originalField.item;
      if (usesBareShape && !itemLabel && !displayField) {
        if (children.length) field.children = children;
      } else {
        const item = { type: "object" };
        if (itemLabel) item.label = itemLabel;
        if (displayField) item.displayField = displayField;
        if (children.length) item.children = children;
        field.item = item;
      }
    } else {
      const options = collectValueColumnOptions(row);
      const valueRows = Array.from(row.querySelector("[data-system-value-rows]")?.children || []);
      const values = valueRows.map((valueRow) => collectValueRow(valueRow, options, ctx)).filter(Boolean);
      if (values.length) field.values = values;
    }
  }
  return field;
}

export function collectFieldsFromContainer(container, ctx = {}) {
  if (!container) return [];
  return Array.from(container.children)
    .map((row) => collectFieldFromRow(row, ctx))
    .filter((field) => field.key);
}

export function collectProperties(container, ctx = {}) {
  return collectFieldsFromContainer(container, ctx);
}

// Wires the ONE top-level container's worth of delegated click/input/change
// handling — add/remove property, add/remove sub-field, add/remove record
// field, add/remove value, and (optional) row selection. All the
// recordUndoableChange("system", ...) equivalents route through
// `ctx.runChange`, same as renderPropertyRow's own internal handlers.
// `ctx.onRowSelected(row)` / `ctx.onRowChanged(row)` are optional — System
// wires these to its own Property Inspector panel; a caller with no such
// panel (Group Properties) omits them and nothing fires.
export function wirePropertyContainerEvents(container, ctx = {}) {
  if (!container) return;
  container.addEventListener("click", (event) => {
    const removeButton = event.target.closest("[data-property-remove]");
    if (removeButton) {
      const rowToRemove = removeButton.closest("div.border");
      ctx.runChange(() => rowToRemove?.remove());
      ctx.onRowRemoved?.(rowToRemove);
      return;
    }
    const addChildButton = event.target.closest("[data-system-add-child]");
    if (addChildButton) {
      const target = addChildButton.closest("[data-system-object-section]")?.querySelector("[data-system-children]");
      if (target) ctx.runChange(() => renderPropertyRow({}, target, ctx));
      return;
    }
    const addItemChildButton = event.target.closest("[data-system-add-item-child]");
    if (addItemChildButton) {
      const target = addItemChildButton
        .closest("[data-system-item-section]")
        ?.querySelector("[data-system-item-children]");
      if (target) ctx.runChange(() => renderPropertyRow({}, target, ctx));
      return;
    }
    const addObjectMapEntryButton = event.target.closest("[data-system-add-object-map-entry]");
    if (addObjectMapEntryButton) {
      const target = addObjectMapEntryButton
        .closest("[data-system-object-map-section]")
        ?.querySelector("[data-system-object-map-entries]");
      if (target) {
        ctx.runChange(() => {
          const entryRow = createObjectMapEntryRow("");
          target.appendChild(entryRow);
          ctx.refreshTooltips?.(entryRow);
        });
      }
      return;
    }
    const removeObjectMapEntryButton = event.target.closest("[data-system-remove-object-map-entry]");
    if (removeObjectMapEntryButton) {
      ctx.runChange(() => removeObjectMapEntryButton.closest("[data-system-object-map-entry]")?.remove());
      return;
    }
    const addValueButton = event.target.closest("[data-system-add-value]");
    if (addValueButton) {
      const propertyRow = addValueButton.closest(".border.rounded-3");
      // Either this field's own classic Enum values list, or (buildSteps'
      // Per-Template map) one Template entry's own value-rows container —
      // whichever ancestor is actually present, same shared value-row
      // machinery either way.
      const arraySection = addValueButton.closest("[data-system-array-section]");
      const objectMapEntry = addValueButton.closest("[data-system-object-map-entry]");
      const target =
        objectMapEntry?.querySelector("[data-system-object-map-value-rows]") ||
        arraySection?.querySelector("[data-system-value-rows]");
      if (target) {
        ctx.runChange(() => {
          const fieldKey = propertyRow?.querySelector("[data-property-key]")?.value.trim() || "";
          const valueRow = renderValueRow({}, target);
          ctx.refreshTooltips?.(valueRow);
          const bindingKey = (ctx.resolveFieldBindingKey || defaultResolveFieldBindingKey)({ key: fieldKey }, ctx);
          void populateDynamicValueSelects(valueRow, bindingKey, {});
          wireLibraryFieldAutocomplete(valueRow, "", !bindingKey, ctx);
          const state = {};
          VALUE_COLUMNS.forEach((column) => {
            state[column.key] = propertyRow?.querySelector(`[data-property-option="${column.key}"]`)?.checked ?? false;
          });
          applyValueRowColumns(valueRow, state);
        });
      }
      return;
    }
    const removeValueButton = event.target.closest("[data-remove-value]");
    if (removeValueButton) {
      ctx.runChange(() => removeValueButton.closest("[data-system-value-row]")?.remove());
      return;
    }
    // Nothing above matched — an ordinary click somewhere in a property row
    // (its own dead space, the type button, Required, a checkbox, ...).
    // Works at any nesting depth since this listener is on the top-level
    // container and every click bubbles up to it regardless of how deep the
    // row actually is.
    const clickedRow = event.target.closest(".border.rounded-3");
    if (clickedRow) {
      ctx.onRowSelected?.(clickedRow);
    }
  });
  // Reflects edits made directly in a row (typing Key/Label, toggling
  // Required, checking an array option, ...) — a caller with its own
  // Inspector-style mirror uses this to know when to refresh it.
  container.addEventListener("input", (event) => {
    ctx.onRowChanged?.(event.target.closest(".border.rounded-3"));
  });
  container.addEventListener("change", (event) => {
    ctx.onRowChanged?.(event.target.closest(".border.rounded-3"));
  });
}

// --- Property Inspector (right pane) ---------------------------------------
// A second, more spacious editing surface for whichever property row is
// currently selected in the Properties list — purely additive, the list
// itself is untouched. Extracted from Loom's System Property Inspector so
// Group Properties can reuse the identical mechanism. Every control here
// proxies the selected row's own real input: reads its current value, and
// on interaction writes back and dispatches the same native event that
// input already listens for — so editing here IS editing the row, not a
// separate copy that could drift out of sync. Type is the one exception
// (createInspectorTypeSelect) since the row's Type control is a
// click-to-cycle button with no "set to exactly this value" event to proxy.

function inspectorFieldWrap(labelText, controlEl) {
  const wrap = document.createElement("div");
  wrap.className = "d-flex flex-column gap-1";
  const label = document.createElement("label");
  label.className = "form-label fw-semibold mb-0 small";
  label.textContent = labelText;
  wrap.appendChild(label);
  wrap.appendChild(controlEl);
  return wrap;
}

function createInspectorTextProxy(row, selector, type = "text") {
  const source = row.querySelector(selector);
  const input = document.createElement("input");
  input.className = "form-control form-control-sm";
  input.type = type;
  if (source) {
    input.value = source.value;
    input.placeholder = source.placeholder || "";
  }
  // focusin (not focus — needs to bubble to the row container's own
  // undo/dirty-tracking listener, wherever the caller attached one) captures
  // the "before" snapshot the same way a real click into the row's own input
  // would.
  input.addEventListener("focus", () => source?.dispatchEvent(new Event("focusin", { bubbles: true })));
  input.addEventListener("input", () => {
    if (!source) return;
    source.value = input.value;
    source.dispatchEvent(new Event("input", { bubbles: true }));
  });
  input.addEventListener("change", () => {
    if (!source) return;
    source.value = input.value;
    source.dispatchEvent(new Event("change", { bubbles: true }));
  });
  return input;
}

function createInspectorSelectProxy(row, selector, options) {
  const source = row.querySelector(selector);
  const select = document.createElement("select");
  select.className = "form-select form-select-sm";
  options.forEach((option) => {
    const opt = document.createElement("option");
    opt.value = option.value;
    opt.textContent = option.label;
    select.appendChild(opt);
  });
  select.value = source?.value ?? options[0]?.value ?? "";
  select.addEventListener("change", () => {
    if (!source) return;
    source.value = select.value;
    source.dispatchEvent(new Event("change", { bubbles: true }));
  });
  return select;
}

function createInspectorCheckboxField(row, selector, labelText) {
  const source = row.querySelector(selector);
  const wrap = document.createElement("div");
  wrap.className = "form-check mb-0";
  const input = document.createElement("input");
  input.className = "form-check-input";
  input.type = "checkbox";
  const inputId = `property-inspector-check-${Math.random().toString(36).slice(2)}`;
  input.id = inputId;
  input.checked = Boolean(source?.checked);
  input.addEventListener("change", () => {
    if (!source) return;
    source.checked = input.checked;
    source.dispatchEvent(new Event("change", { bubbles: true }));
  });
  const label = document.createElement("label");
  label.className = "form-check-label small";
  label.htmlFor = inputId;
  label.textContent = labelText;
  wrap.appendChild(input);
  wrap.appendChild(label);
  return wrap;
}

// Type has no dedicated "set to exactly this value" event to proxy on the
// row (its own control is a click-to-cycle button — see applyPropertyType),
// so this is the one field built by hand instead of via one of the generic
// proxy helpers above.
function createInspectorTypeSelect(row, ctx, onTypeChanged) {
  const typeButton = row.querySelector("[data-property-type]");
  const select = document.createElement("select");
  select.className = "form-select form-select-sm";
  PROPERTY_TYPES.forEach((entry) => {
    const opt = document.createElement("option");
    opt.value = entry.value;
    opt.textContent = entry.label;
    select.appendChild(opt);
  });
  select.value = typeButton?.dataset.value || PROPERTY_TYPES[0].value;
  select.addEventListener("change", () => {
    if (!typeButton) return;
    ctx.runChange(() => applyPropertyType(row, typeButton, select.value, ctx));
    // Nothing was dispatched on the row for the generic "reflect row edits
    // into the inspector" listeners to catch (see applyPropertyType), so
    // this rebuilds directly — needed to show/hide Default/Min/Max/Array
    // Mode/options for the new type.
    onTypeChanged?.();
  });
  return select;
}

function buildInspectorFields(row, ctx, onTypeChanged) {
  const fragment = document.createDocumentFragment();
  const currentType = row.querySelector("[data-property-type]")?.dataset.value || "string";
  const isScalar = ["string", "number", "boolean"].includes(currentType);
  const isArray = currentType === "array";

  fragment.appendChild(inspectorFieldWrap("Type", createInspectorTypeSelect(row, ctx, onTypeChanged)));
  fragment.appendChild(inspectorFieldWrap("Key", createInspectorTextProxy(row, "[data-property-key]")));
  fragment.appendChild(inspectorFieldWrap("Label", createInspectorTextProxy(row, "[data-property-label]")));

  if (isScalar) {
    fragment.appendChild(inspectorFieldWrap("Default", createInspectorTextProxy(row, "[data-property-default]")));
  }
  if (currentType === "number") {
    const minMaxRow = document.createElement("div");
    minMaxRow.className = "row g-2";
    const minCol = document.createElement("div");
    minCol.className = "col-6";
    minCol.appendChild(inspectorFieldWrap("Minimum", createInspectorTextProxy(row, "[data-property-minimum]", "number")));
    const maxCol = document.createElement("div");
    maxCol.className = "col-6";
    maxCol.appendChild(inspectorFieldWrap("Maximum", createInspectorTextProxy(row, "[data-property-maximum]", "number")));
    minMaxRow.appendChild(minCol);
    minMaxRow.appendChild(maxCol);
    fragment.appendChild(minMaxRow);
  }

  if (isArray) {
    fragment.appendChild(
      inspectorFieldWrap(
        "Array Mode",
        createInspectorSelectProxy(row, "[data-property-array-mode]", [
          { value: "values", label: "Enum" },
          { value: "item", label: "Records" },
        ])
      )
    );
    const optionsWrap = document.createElement("div");
    optionsWrap.className = "d-flex flex-column gap-1";
    const optionsLabel = document.createElement("span");
    optionsLabel.className = "form-label fw-semibold mb-0 small d-flex align-items-center gap-1";
    optionsLabel.textContent = "Array Value Options";
    const optionsHelp = document.createElement("span");
    optionsHelp.className = "align-middle";
    optionsHelp.dataset.helpTopic = "loom.systemArrayOptions";
    optionsHelp.dataset.helpInsert = "replace";
    optionsLabel.appendChild(optionsHelp);
    optionsWrap.appendChild(optionsLabel);
    const checkboxGrid = document.createElement("div");
    checkboxGrid.className = "d-flex flex-wrap gap-2";
    VALUE_COLUMNS.forEach((column) => {
      checkboxGrid.appendChild(createInspectorCheckboxField(row, `[data-property-option="${column.key}"]`, column.label));
    });
    optionsWrap.appendChild(checkboxGrid);
    fragment.appendChild(optionsWrap);
  }

  return fragment;
}

// One Property Inspector instance — System and Group each get their own
// (separate selected-row state, separate DOM mounts), built by calling this
// with their own `ctx` (systemPropertyCtx/groupPropertyCtx — same object
// already passed to renderPropertyRow/wirePropertyContainerEvents for that
// tab) and their own toolbar/empty/details/fields elements. `ctx.runChange`
// is reused as-is for structural edits made here (New/Delete/Duplicate/Type)
// — System's own wraps recordUndoableChange, Group's own just re-renders/
// marks dirty, exactly like every other structural edit already routes
// through it.
export function createPropertyInspector({
  ctx,
  rowsContainer,
  emptyEl,
  detailsEl,
  fieldsEl,
  newButton,
  deleteButton,
  duplicateButton,
  requiredButton,
  isActive = () => true,
} = {}) {
  let selectedRow = null;

  function updateToolbar() {
    const hasRow = Boolean(selectedRow?.isConnected);
    if (deleteButton) deleteButton.disabled = !hasRow;
    if (duplicateButton) duplicateButton.disabled = !hasRow;
    if (requiredButton) {
      requiredButton.disabled = !hasRow;
      const pressed = hasRow && selectedRow.querySelector("[data-property-required]")?.getAttribute("aria-pressed") === "true";
      requiredButton.setAttribute("aria-pressed", pressed ? "true" : "false");
      requiredButton.classList.toggle("btn-primary", pressed);
      requiredButton.classList.toggle("btn-outline-secondary", !pressed);
    }
  }

  // Skips rebuilding the fields list while the user is actively typing in
  // one of its own text/number inputs — rebuilding would yank the input out
  // from under their cursor. Safe to skip: the row itself already has the
  // correct value (this exact control just wrote it there via its own
  // input/change proxy), so nothing else needs to move. Selects/checkboxes/
  // buttons have no caret to protect, so a change to one of those always
  // rebuilds immediately — that's what keeps section visibility (Default/
  // Min/Max, Array options, ...) correct as Type/Array Mode changes.
  function shouldSkipRebuild() {
    const active = document.activeElement;
    if (!fieldsEl || !fieldsEl.contains(active)) return false;
    if (active.tagName === "TEXTAREA") return true;
    if (active.tagName === "INPUT" && (active.type === "text" || active.type === "number")) return true;
    return false;
  }

  function refresh() {
    if (!emptyEl || !detailsEl || !fieldsEl) return;
    if (selectedRow && !selectedRow.isConnected) selectedRow = null;
    const row = selectedRow;
    updateToolbar();
    emptyEl.hidden = Boolean(row);
    detailsEl.classList.toggle("d-none", !row);
    if (!row) return;
    if (shouldSkipRebuild()) return;
    fieldsEl.innerHTML = "";
    fieldsEl.appendChild(buildInspectorFields(row, ctx, refresh));
    void initHelpSystem({ root: fieldsEl });
  }

  function selectRow(row) {
    if (selectedRow === row) return;
    if (selectedRow) selectedRow.removeAttribute("data-property-row-selected");
    selectedRow = row || null;
    if (selectedRow) selectedRow.setAttribute("data-property-row-selected", "true");
    refresh();
  }

  // Walks the Properties list in the same top-to-bottom order it's rendered
  // in — querySelectorAll returns matches in document order, so this
  // flattens the nesting for free: from an Object property, Down lands on
  // its first Sub-field next, exactly like a tree view. Doesn't wrap past
  // either end (matches a plain listbox, not a carousel).
  function rowList() {
    return rowsContainer ? Array.from(rowsContainer.querySelectorAll(".border.rounded-3")) : [];
  }

  function moveSelection(direction) {
    const rows = rowList();
    if (!rows.length) return;
    const currentIndex = selectedRow ? rows.indexOf(selectedRow) : -1;
    const nextIndex = currentIndex === -1 ? (direction > 0 ? 0 : rows.length - 1) : currentIndex + direction;
    if (nextIndex < 0 || nextIndex >= rows.length) return;
    selectRow(rows[nextIndex]);
    rows[nextIndex].scrollIntoView({ block: "nearest" });
  }

  newButton?.addEventListener("click", () => {
    const container = selectedRow?.parentElement || rowsContainer;
    if (!container) return;
    let newRow;
    ctx.runChange(() => {
      newRow = renderPropertyRow({}, container, ctx);
      if (selectedRow?.parentElement === container) selectedRow.after(newRow);
    });
    if (newRow) selectRow(newRow);
  });

  deleteButton?.addEventListener("click", () => {
    if (!selectedRow) return;
    const row = selectedRow;
    ctx.runChange(() => row.remove());
    selectRow(null);
  });

  duplicateButton?.addEventListener("click", () => {
    if (!selectedRow) return;
    const sourceRow = selectedRow;
    const container = sourceRow.parentElement;
    if (!container) return;
    let newRow;
    ctx.runChange(() => {
      // ctx.collectField (optional) lets a caller with extra per-row state
      // collectFieldFromRow doesn't itself know about (Group's own "Public"
      // toggle — see groupPropertyCtx's own comment) fold it back in, the
      // same way that caller's own Save/dirty-check already does.
      const field = ctx.collectField ? ctx.collectField(sourceRow) : collectFieldFromRow(sourceRow, ctx);
      if (field.key) field.key = `${field.key}_copy`;
      newRow = renderPropertyRow(field, container, ctx);
      sourceRow.after(newRow);
    });
    if (newRow) selectRow(newRow);
  });

  requiredButton?.addEventListener("click", () => {
    selectedRow?.querySelector("[data-property-required]")?.click();
  });

  // Only steals Up/Down when they'd otherwise do nothing useful where focus
  // currently is — not while it's on a <select> (native option-cycling) or a
  // number input (native increment/decrement), and not anywhere outside the
  // Properties list/Inspector entirely (e.g. this tab's own Title field, or
  // a completely different tab where a stale selection might still be set
  // from an earlier visit).
  document.addEventListener("keydown", (event) => {
    if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
    if (!selectedRow || !isActive()) return;
    const active = document.activeElement;
    if (active && active !== document.body) {
      if (active.tagName === "SELECT") return;
      if (active.tagName === "INPUT" && active.type === "number") return;
      const withinRelevantArea = rowsContainer?.contains(active) || detailsEl?.contains(active);
      if (!withinRelevantArea) return;
    }
    event.preventDefault();
    moveSelection(event.key === "ArrowDown" ? 1 : -1);
  });

  return {
    selectRow,
    refresh,
    get selectedRow() {
      return selectedRow;
    },
  };
}
