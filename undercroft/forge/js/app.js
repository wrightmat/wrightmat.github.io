import { initAppShell } from "../../common/js/lib/app-shell.js";
import { initAuthControls, escapeHtml } from "../../common/js/lib/auth-ui.js";
import { updateJsonPreview } from "../../common/js/lib/json-preview.js";
import { expandPane } from "../../common/js/lib/panes.js";
import { bindCollapsibleToggle } from "../../common/js/lib/collapsible.js";
import { initHelpSystem } from "../../common/js/lib/help.js";
import { refreshTooltips } from "../../common/js/lib/tooltips.js";
import {
  loadForgeTables,
  listSettingsForSystem,
  listLocationsForSetting,
  loadLocation,
  loadSpeciesProfilesForLocation,
  getSpeciesOptions,
  getArchetypeOptions,
  getAttitudeLabel,
  loadAlignmentFaces,
  loadAbilityFieldDefs,
  GENDER_FACES,
  AGE_FACES,
  RELATIONSHIP_STATUS_FACES,
  ORIENTATION_FACES,
  ATTITUDE_LABELS,
} from "./lib/tables.js";
import { generateNpc, rerollAttribute } from "./lib/generator.js";
import { createNpcRecord, toPressExportShape } from "./lib/npc-schema.js";
import { generateCharacterNote } from "./lib/llm-note.js";
import { buildLocationPressTemplate } from "./lib/press-export.js";
import { createDirtyGate } from "../../common/js/lib/dirty-gate.js";
import { abilityModifier } from "../../common/js/lib/dnd-rules.js";
import { confirmDelete } from "../../common/js/lib/ownership.js";

const systemSelect = document.querySelector("[data-system-select]");
const settingSelect = document.querySelector("[data-setting-select]");
const locationSelect = document.querySelector("[data-location-select]");
const speciesOverrideSelect = document.querySelector("[data-species-override]");
const archetypeOverrideSelect = document.querySelector("[data-archetype-override]");
const alignmentOverrideSelect = document.querySelector("[data-alignment-override]");
const genderOverrideSelect = document.querySelector("[data-gender-override]");
const generateButton = document.querySelector("[data-generate-npc]");

const npcEmptyState = document.querySelector("[data-npc-empty-state]");
const npcDisplay = document.querySelector("[data-npc-display]");
const identityFields = document.querySelector("[data-identity-fields]");
const fourDFields = document.querySelector("[data-fourd-fields]");
const statsFields = document.querySelector("[data-stats-fields]");
const generateNoteButton = document.querySelector("[data-generate-note]");
const noteText = document.querySelector("[data-note-text]");

const saveButton = document.querySelector("[data-save-npc]");
const exportButton = document.querySelector("[data-export-npc]");
const deleteButton = document.querySelector("[data-delete-npc]");
const npcJsonPreview = document.querySelector("[data-npc-json-preview]");
const npcJsonBytes = document.querySelector("[data-npc-json-bytes]");

const rightPane = document.querySelector('[data-pane="right"]');
const rightPaneToggle = document.querySelector('[data-pane-toggle="right"]');

const inspectorToggle = document.querySelector("[data-inspector-toggle]");
const inspectorPanel = document.querySelector("[data-inspector-panel]");
const inspectorEmpty = document.querySelector("[data-inspector-empty]");
const inspectorLocation = document.querySelector("[data-inspector-location]");
const inspectorSpecies = document.querySelector("[data-inspector-species]");
const inspectorRoll = document.querySelector("[data-inspector-roll]");
const inspectorRollTitle = document.querySelector("[data-inspector-roll-title]");
const inspectorRollCurrent = document.querySelector("[data-inspector-roll-current]");
const inspectorRollJson = document.querySelector("[data-inspector-roll-json]");

const exportLocationTemplateButton = document.querySelector("[data-export-location-template]");
const locationNameInput = document.querySelector("[data-location-name]");
const locationSystemInput = document.querySelector("[data-location-system]");
const locationSettingInput = document.querySelector("[data-location-setting]");
const speciesWeightRows = document.querySelector("[data-species-weight-rows]");
const speciesWeightTotal = document.querySelector("[data-species-weight-total]");
const mixingCoefficientInput = document.querySelector("[data-mixing-coefficient]");
const mixingCoefficientValue = document.querySelector("[data-mixing-coefficient-value]");
const archetypeOverrideRows = document.querySelector("[data-archetype-override-rows]");

const speciesLabelInput = document.querySelector("[data-species-label]");
const speciesNameModeSelect = document.querySelector("[data-species-name-mode]");
const speciesLastNameFormSelect = document.querySelector("[data-species-last-name-form]");
const speciesFirstNamesTextarea = document.querySelector("[data-species-first-names]");
const speciesLastNamesTextarea = document.querySelector("[data-species-last-names]");
const speciesLastNamesGroup = document.querySelector("[data-species-last-names-group]");

let status = null;
let tables = null;
let currentLocation = null;
let currentRecord = null;
// Gates Save (dirty relative to the last save) and Delete (only a record
// that's actually been saved, not just generated/rerolled locally, can be
// deleted) — see common/js/lib/dirty-gate.js. currentRecord is kept live
// (every edit/reroll patches it directly, unlike Crucible's separate input
// fields), so the snapshot is just its own export shape.
const dirtyGate = createDirtyGate({ buildSnapshot: () => (currentRecord ? toPressExportShape(currentRecord) : null) });
let selectedFieldKey = null;
let dataManager = null;

const IDENTITY_FIELD_DEFS = [
  { key: "name", label: "Name" },
  { key: "species", label: "Species" },
  { key: "archetype", label: "Archetype" },
  { key: "alignment", label: "Alignment" },
  { key: "gender", label: "Gender" },
  { key: "age", label: "Age" },
  { key: "relationship", label: "Relationship" },
  { key: "attitude", label: "Attitude" },
  { key: "location", label: "Location" },
];

const FOURD_FIELD_DEFS = [
  { key: "description", label: "Description" },
  { key: "demeanor", label: "Demeanor" },
  { key: "drive", label: "Drive" },
  { key: "direction", label: "Direction" },
];

// Both read from the active System's own "alignments"/"abilities" fields
// (loadAlignmentFaces/loadAbilityFieldDefs in lib/tables.js) rather than a
// second hardcoded copy — refreshed by refreshSystemVocabulary() whenever
// the System select changes, so switching Systems immediately reflects that
// System's own vocabulary instead of always showing D&D 5e's.
let ABILITY_FIELD_DEFS = [];
let ABILITY_KEYS = new Set();

// Called once at init (after the default System is selected) and again on
// every System select change — keeps the alignment override dropdown and
// the ability-score card labels/keys in sync with whichever System is
// currently active.
async function refreshSystemVocabulary(systemId) {
  const [alignmentFaces, abilityFieldDefs] = await Promise.all([
    loadAlignmentFaces(dataManager, systemId),
    loadAbilityFieldDefs(dataManager, systemId),
  ]);
  if (tables) {
    tables.alignmentFaces = alignmentFaces;
  }
  ABILITY_FIELD_DEFS = abilityFieldDefs;
  ABILITY_KEYS = new Set(abilityFieldDefs.map((entry) => entry.key));
  populateSelectOptions(alignmentOverrideSelect, alignmentFaces);
}

function formatIdentityValue(key, value) {
  if (key === "attitude") {
    return `${getAttitudeLabel(value)} (${value})`;
  }
  return String(value ?? "");
}

function abilityModifierText(score) {
  const modifier = abilityModifier(score);
  return `(${modifier >= 0 ? "+" : ""}${modifier})`;
}

function buildFieldCard({
  key,
  label,
  value,
  rerollable,
  colClass = "col-12 col-md-6 col-lg-4",
  compact = false,
  editable = false,
  selectable = false,
  suffix = "",
}) {
  const col = document.createElement("div");
  col.className = colClass;
  const box = document.createElement("div");
  if (compact) {
    box.className = "d-flex flex-column align-items-center justify-content-center text-center border rounded-3 p-1 h-100";
    const labelLine = `<div class="text-uppercase text-body-secondary" style="font-size: 0.65rem">${escapeHtml(label)}</div>`;
    if (editable) {
      // Same .forge-inline-edit blend-in idiom as the Name field, just sized
      // for a compact box — the raw score/number is what's editable, kept
      // separate from the (+N) ability modifier (recomputed live, not stored).
      box.innerHTML = `${labelLine}<div class="d-flex align-items-center justify-content-center gap-1"><input type="text" class="forge-inline-edit small fw-semibold text-center" style="width: 2.5rem" value="${escapeHtml(value)}" data-editable-field="${key}" aria-label="Edit ${label}" />${
        suffix ? `<span class="small text-body-secondary" data-editable-suffix="${key}">${escapeHtml(suffix)}</span>` : ""
      }</div>`;
    } else {
      box.innerHTML = `${labelLine}<div class="fw-semibold small">${escapeHtml(value)}</div>`;
    }
    col.appendChild(box);
    return col;
  }
  box.className = "d-flex align-items-center justify-content-between gap-2 border rounded-3 p-2 h-100";
  if (selectable) {
    box.dataset.selectField = key;
  }
  const text = document.createElement("div");
  text.className = "flex-grow-1";
  const labelLine = document.createElement("div");
  labelLine.className = "small text-uppercase text-body-secondary";
  labelLine.textContent = label;
  text.appendChild(labelLine);
  if (editable) {
    // Looks like the plain value line (see .forge-inline-edit) until
    // hovered/focused — an <input> the whole time, just styled to blend in.
    const input = document.createElement("input");
    input.type = "text";
    input.className = "forge-inline-edit";
    input.value = value;
    input.dataset.editableField = key;
    input.setAttribute("aria-label", `Edit ${label}`);
    text.appendChild(input);
  } else {
    const valueLine = document.createElement("div");
    valueLine.className = "fw-semibold";
    valueLine.textContent = value;
    text.appendChild(valueLine);
  }
  box.appendChild(text);
  if (rerollable) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "btn btn-outline-secondary btn-sm flex-shrink-0";
    button.dataset.rerollAttribute = key;
    button.setAttribute("aria-label", `Reroll ${label}`);
    button.innerHTML = `<span class="iconify" data-icon="tabler:refresh" aria-hidden="true"></span>`;
    box.appendChild(button);
  }
  col.appendChild(box);
  return col;
}

// Ability scores are all shown in a single row (6 compact boxes), AC/HP in
// a second row underneath — deliberately smaller/plainer than the
// Identity/4D cards since there's nothing to reroll here (see getStatsForArchetype).
function renderStats(stats) {
  statsFields.innerHTML = "";
  if (!stats) {
    const col = document.createElement("div");
    col.className = "col-12";
    col.innerHTML =
      '<p class="small text-body-secondary mb-0">No stat block available for this archetype (setting-specific or Wildcard).</p>';
    statsFields.appendChild(col);
    return;
  }
  ABILITY_FIELD_DEFS.forEach(({ key, label }) => {
    statsFields.appendChild(
      buildFieldCard({
        key,
        label,
        value: stats.abilities?.[key] ?? "",
        suffix: abilityModifierText(stats.abilities?.[key]),
        rerollable: false,
        colClass: "col-4 col-md-2",
        compact: true,
        editable: true,
      })
    );
  });
  statsFields.appendChild(
    buildFieldCard({
      key: "armorClass",
      label: "AC",
      value: stats.armorClass,
      rerollable: false,
      colClass: "col-4",
      compact: true,
      editable: true,
    })
  );
  statsFields.appendChild(
    buildFieldCard({
      key: "currentHp",
      label: "Current HP",
      value: stats.hitPoints?.current ?? "",
      rerollable: false,
      colClass: "col-4",
      compact: true,
      editable: true,
    })
  );
  statsFields.appendChild(
    buildFieldCard({
      key: "maxHp",
      label: "Max HP",
      value: stats.hitPoints?.max ?? "",
      rerollable: false,
      colClass: "col-4",
      compact: true,
      editable: true,
    })
  );
}

// Save (dirty-gated) and Delete (saved-gated) button state, shared by
// renderNpc's full re-render and the in-place field-edit handlers below
// (which patch currentRecord directly and skip a full renderNpc to avoid
// jumping the edited input's cursor).
function refreshActionButtons() {
  saveButton.disabled = !currentRecord || !dirtyGate.isDirty();
  exportButton.disabled = !currentRecord;
  deleteButton.disabled = !currentRecord || !dirtyGate.hasSaved();
}

function renderNpc(record) {
  currentRecord = record;
  npcEmptyState.classList.toggle("d-none", Boolean(record));
  npcDisplay.classList.toggle("d-none", !record);
  refreshActionButtons();

  if (!record) {
    updateJsonPreview(npcJsonPreview, npcJsonBytes, {});
    return;
  }

  identityFields.innerHTML = "";
  IDENTITY_FIELD_DEFS.forEach(({ key, label }) => {
    identityFields.appendChild(
      buildFieldCard({
        key,
        label,
        value:
          key === "location"
            ? currentLocation?.name || ""
            : formatIdentityValue(key, key === "name" ? record.name : record.identity[key]),
        rerollable: key !== "location",
        editable: key === "name",
        selectable: true,
      })
    );
  });

  fourDFields.innerHTML = "";
  FOURD_FIELD_DEFS.forEach(({ key, label }) => {
    fourDFields.appendChild(
      buildFieldCard({ key, label, value: record.fourD[key], rerollable: true, selectable: true })
    );
  });

  renderStats(record.stats);

  noteText.value = record.note || "";
  updateJsonPreview(npcJsonPreview, npcJsonBytes, toPressExportShape(record));

  // Regenerating/rerolling replaces the Identity/4D boxes wholesale, so the
  // selected box's highlight (and, for a roll-driven inspector view, its
  // JSON) needs to be reapplied against the fresh markup/data.
  updateFieldSelectionUI();
  if (selectedFieldKey) {
    updateInspector();
  }
}

// --- Manual overrides ----------------------------------------------------
// Blank ("Random") is the default in every select; a non-blank value is
// passed straight through to generateNpc, which uses it instead of rolling
// that one attribute. Species/Archetype options depend on the selected
// Location and get repopulated whenever it changes; Alignment/Gender are
// fixed tables, populated once. Options may be plain strings (value===label)
// or {value, label} pairs (Species, where the value is a speciesId but the
// label shown is the profile's own display name).
function populateSelectOptions(selectEl, options, { blankLabel = "Random" } = {}) {
  const previous = selectEl.value;
  selectEl.innerHTML = "";
  const blank = document.createElement("option");
  blank.value = "";
  blank.textContent = blankLabel;
  selectEl.appendChild(blank);
  options.forEach((entry) => {
    const value = typeof entry === "string" ? entry : entry.value;
    const label = typeof entry === "string" ? entry : entry.label;
    const option = document.createElement("option");
    option.value = value;
    option.textContent = label;
    selectEl.appendChild(option);
  });
  const values = options.map((entry) => (typeof entry === "string" ? entry : entry.value));
  if (values.includes(previous)) {
    selectEl.value = previous;
  }
}

// Alignment is intentionally NOT populated here — it's System-dependent (see
// refreshSystemVocabulary), so it's populated once a System is known rather
// than from a fixed constant at startup.
function populateFixedOverrides() {
  populateSelectOptions(genderOverrideSelect, [...new Set(GENDER_FACES)]);
}

function populateLocationOverrides(location) {
  const speciesOptions = getSpeciesOptions(location, tables.speciesProfiles).map((entry) => ({
    value: entry.speciesId,
    label: entry.label,
  }));
  populateSelectOptions(speciesOverrideSelect, speciesOptions);
  const archetypeNames = getArchetypeOptions(tables.archetype, location).map((entry) => entry.name);
  populateSelectOptions(archetypeOverrideSelect, archetypeNames);
}

function readOverrides() {
  return {
    species: speciesOverrideSelect.value,
    archetype: archetypeOverrideSelect.value,
    alignment: alignmentOverrideSelect.value,
    gender: genderOverrideSelect.value,
  };
}

// --- System > Setting > Location cascading selects --------------------------
// Locations are authored in Sanctum, Species in Loom — these three selects
// just pick which already-saved Location to generate from, mirroring the
// same System/Setting/Location tree Sanctum's own picker presents.

async function listAllSystems() {
  if (!dataManager) return [];
  const merged = new Map();
  // Workbench ships sys.dnd5e as a "builtin" (a static JSON file, not a row
  // in the systems DB table), so it never shows up in dataManager.list()
  // below on its own — without this, the picker only shows Systems a
  // creator has actually saved, hiding the one every seed Location/Setting
  // already points at.
  try {
    const builtins = await dataManager.listBuiltins();
    (builtins?.systems || []).forEach((entry) => {
      if (entry?.available) merged.set(entry.id, { id: entry.id, title: entry.title || entry.id });
    });
  } catch (error) {
    // builtins are a nice-to-have, not required
  }
  try {
    const listing = await dataManager.list("systems");
    const remoteEntries = dataManager.collectListEntries(listing.remote, ["items", "owned", "shared", "public"]);
    remoteEntries.forEach((entry) => merged.set(entry.id, { id: entry.id, title: entry.title || entry.id }));
    (listing.local || []).forEach((entry) => {
      if (!merged.has(entry.id)) {
        merged.set(entry.id, { id: entry.id, title: entry.payload?.title || entry.id });
      }
    });
  } catch (error) {
    // fall through with whatever builtins we already have
  }
  return Array.from(merged.values()).sort((a, b) => (a.title || "").localeCompare(b.title || ""));
}

async function populateSystemSelect() {
  const systems = await listAllSystems();
  const previous = systemSelect.value;
  systemSelect.innerHTML = "";
  const blank = document.createElement("option");
  blank.value = "";
  blank.textContent = systems.length ? "Select a system…" : "No systems yet";
  systemSelect.appendChild(blank);
  systems.forEach((system) => {
    const option = document.createElement("option");
    option.value = system.id;
    option.textContent = system.title;
    systemSelect.appendChild(option);
  });
  if (systems.some((system) => system.id === previous)) systemSelect.value = previous;
  return systems;
}

async function populateSettingSelect(systemId) {
  const settings = await listSettingsForSystem(dataManager, systemId);
  settingSelect.innerHTML = "";
  const blank = document.createElement("option");
  blank.value = "";
  blank.textContent = settings.length ? "Select a setting…" : "No settings yet";
  settingSelect.appendChild(blank);
  settings.forEach((setting) => {
    const option = document.createElement("option");
    option.value = setting.id;
    option.textContent = setting.name;
    settingSelect.appendChild(option);
  });
  return settings;
}

async function populateLocationSelectOptions(settingId) {
  const locations = await listLocationsForSetting(dataManager, settingId);
  locationSelect.innerHTML = "";
  const blank = document.createElement("option");
  blank.value = "";
  blank.textContent = locations.length ? "Select a location…" : "No locations yet";
  locationSelect.appendChild(blank);
  locations.forEach((location) => {
    const option = document.createElement("option");
    option.value = location.id;
    option.textContent = location.name;
    locationSelect.appendChild(option);
  });
  return locations;
}

async function selectLocation(id) {
  currentLocation = await loadLocation(id);
  locationSelect.value = id;
  tables.speciesProfiles = await loadSpeciesProfilesForLocation(currentLocation);
  populateLocationOverrides(currentLocation);

  // The Location Identity box (and the inspector, if it's the one currently
  // selected) reflect whatever's chosen up here in the left pane, not just
  // whatever was true at the last renderNpc.
  const locationValue = identityFields.querySelector('[data-select-field="location"] .fw-semibold');
  if (locationValue) locationValue.textContent = currentLocation?.name || "";
  if (selectedFieldKey === "location") {
    updateInspector();
  }
}

// --- Location inspector (read-only — edited in Sanctum) --------------------

function renderSpeciesWeightRow(entry = { entityId: "", weight: 0 }) {
  const row = document.createElement("div");
  row.className = "d-flex align-items-center gap-2";
  const options = Array.from(tables?.speciesProfiles?.values() || []);
  const optionsHtml = options
    .map(
      (option) =>
        `<option value="${escapeHtml(option.id)}"${option.id === entry.entityId ? " selected" : ""}>${escapeHtml(option.label)}</option>`
    )
    .join("");
  row.innerHTML = `
    <select class="form-select" data-species-weight-select disabled>
      <option value="">Select a species…</option>
      ${optionsHtml}
    </select>
    <input class="form-control" type="number" min="0" step="1" style="max-width: 6rem" value="${Number(entry.weight) || 0}" data-species-weight-value readonly />
  `;
  speciesWeightRows.appendChild(row);
  updateSpeciesWeightTotal();
}

function updateSpeciesWeightTotal() {
  const total = Array.from(speciesWeightRows.querySelectorAll("[data-species-weight-value]")).reduce(
    (sum, input) => sum + (Number(input.value) || 0),
    0
  );
  speciesWeightTotal.textContent = `Total: ${total}`;
}

function renderArchetypeOverrideRows(overrides = {}) {
  archetypeOverrideRows.innerHTML = "";
  const overridable = (tables.archetype.entries || []).filter((entry) => entry.overridable);
  overridable.forEach((entry) => {
    const row = document.createElement("div");
    row.className = "d-flex align-items-center gap-2";
    row.dataset.archetypeOverrideRoll = String(entry.roll);
    const value = overrides[String(entry.roll)]?.name || "";
    row.innerHTML = `
      <label class="form-label mb-0 flex-shrink-0" style="width: 5rem">Roll ${entry.roll}</label>
      <input class="form-control" type="text" placeholder="Setting-specific archetype name" value="${escapeHtml(value)}" data-archetype-override-value readonly />
    `;
    archetypeOverrideRows.appendChild(row);
  });
}

function populateLocationForm(location) {
  locationNameInput.value = location?.name || "";
  locationSystemInput.value = systemSelect.selectedOptions[0]?.textContent || "";
  locationSettingInput.value = settingSelect.selectedOptions[0]?.textContent || "";
  mixingCoefficientInput.value = location?.mixingCoefficient ?? 0.2;
  mixingCoefficientValue.textContent = Number(mixingCoefficientInput.value).toFixed(2);
  speciesWeightRows.innerHTML = "";
  (location?.speciesWeights || []).forEach((entry) => renderSpeciesWeightRow(entry));
  renderArchetypeOverrideRows(location?.archetypeOverrides || {});
  updateSpeciesWeightTotal();
}

// --- Species inspector (read-only — edited in Loom) -------------------------

function toggleSpeciesLastNamesVisibility() {
  speciesLastNamesGroup.hidden = speciesLastNameFormSelect.value === "none";
}

// Pool entries may be a bare string or {name, weight} (see
// name-generator.js's normalizeNamePool) — this read-only summary only
// needs the name itself, one per line.
function namePoolLines(pool) {
  return (pool || []).map((entry) => (typeof entry === "string" ? entry : entry?.name || "")).filter(Boolean).join("\n");
}

function populateSpeciesForm(profile) {
  speciesLabelInput.value = profile?.label || "";
  speciesNameModeSelect.value = profile?.nameMode === "synonym" ? "synonym" : "blend";
  speciesLastNameFormSelect.value = profile?.lastNameForm || "none";
  speciesFirstNamesTextarea.value = namePoolLines(profile?.firstNames);
  speciesLastNamesTextarea.value = namePoolLines(profile?.lastNames);
  toggleSpeciesLastNamesVisibility();
}

// --- Identity/4D box selection / inspector ------------------------------
// Standard Undercroft select-then-inspect convention: clicking an Identity
// or 4D box selects it and surfaces its details in the right-pane inspector.
// Location and Species get their existing full editors; everything else
// gets a read-only dump of the JSON data driving it, alongside this NPC's
// current rolled value.

function selectField(key) {
  selectedFieldKey = selectedFieldKey === key ? null : key;
  updateFieldSelectionUI();
  updateInspector();
}

function updateFieldSelectionUI() {
  [identityFields, fourDFields].forEach((container) => {
    container.querySelectorAll("[data-select-field]").forEach((box) => {
      box.classList.toggle("forge-field-selected", box.dataset.selectField === selectedFieldKey);
    });
  });
}

// Setting `.hidden` alone silently does nothing here: these panels carry
// Bootstrap's `.d-flex` (declared `!important`), which beats the `[hidden]`
// UA rule regardless of the property. Toggling `.d-none` (also `!important`,
// and generated after `.d-flex` in Bootstrap's own stylesheet, so it wins
// the tie) is what actually hides them — same convention as setCollapsibleState.
function setInspectorSectionVisible(section, visible) {
  section.hidden = !visible;
  section.classList.toggle("d-none", !visible);
}

function updateInspector() {
  setInspectorSectionVisible(inspectorEmpty, !selectedFieldKey);
  setInspectorSectionVisible(inspectorLocation, selectedFieldKey === "location");
  setInspectorSectionVisible(inspectorSpecies, selectedFieldKey === "species");
  setInspectorSectionVisible(
    inspectorRoll,
    Boolean(selectedFieldKey) && selectedFieldKey !== "location" && selectedFieldKey !== "species"
  );

  if (!selectedFieldKey) return;

  if (rightPane && rightPaneToggle) {
    expandPane(rightPane, rightPaneToggle);
  }

  if (selectedFieldKey === "location") {
    populateLocationForm(currentLocation);
    return;
  }

  if (selectedFieldKey === "species") {
    const speciesId = currentRecord?.rolls?.species?.speciesId || null;
    const profile = speciesId ? tables.speciesProfiles?.get(speciesId) || null : null;
    populateSpeciesForm(profile);
    return;
  }

  const def = IDENTITY_FIELD_DEFS.find((entry) => entry.key === selectedFieldKey) || FOURD_FIELD_DEFS.find((entry) => entry.key === selectedFieldKey);
  inspectorRollTitle.textContent = def?.label || selectedFieldKey;
  inspectorRollCurrent.textContent = currentRecord ? `This NPC's roll: ${getFieldCurrentValue(selectedFieldKey)}` : "";
  inspectorRollJson.textContent = JSON.stringify(getFieldTableData(selectedFieldKey), null, 2);
}

// This NPC's own resolved value for a given field — Identity attributes
// live under `record.identity`, 4D attributes under `record.fourD`.
function getFieldCurrentValue(key) {
  if (FOURD_FIELD_DEFS.some((entry) => entry.key === key)) {
    return currentRecord?.fourD?.[key] ?? "";
  }
  return formatIdentityValue(key, currentRecord?.identity?.[key]);
}

// The full JSON backing each field — a static table for most (the same data
// getArchetypeOptions/rollAlignment/rollFourD/etc. already draw from), or,
// for Name, the Species Name Profile(s) exemplar-interpolation actually used
// for this specific NPC (there's no fixed table behind Name anymore).
function getFieldTableData(key) {
  switch (key) {
    case "archetype":
      return getArchetypeOptions(tables.archetype, currentLocation);
    case "alignment":
      return tables?.alignmentFaces || [];
    case "gender":
      return GENDER_FACES;
    case "age":
      return AGE_FACES;
    case "relationship":
      return { status: RELATIONSHIP_STATUS_FACES, orientation: ORIENTATION_FACES };
    case "attitude":
      return ATTITUDE_LABELS;
    case "name": {
      const nameRoll = currentRecord?.rolls?.name;
      if (!nameRoll) return {};
      return {
        generation: nameRoll,
        primaryProfile: tables.speciesProfiles?.get(nameRoll.primarySpeciesId) || null,
        partnerProfile: nameRoll.partnerSpeciesId ? tables.speciesProfiles?.get(nameRoll.partnerSpeciesId) || null : null,
      };
    }
    case "description":
    case "demeanor":
    case "drive":
    case "direction":
      return tables.fourD?.[key] ?? [];
    default:
      return currentRecord?.rolls?.[key] ?? {};
  }
}

// --- Event wiring ------------------------------------------------------

generateButton.addEventListener("click", () => {
  if (!currentLocation || !tables) return;
  const overrides = readOverrides();
  const record = createNpcRecord(generateNpc(currentLocation, tables, { overrides }));
  dirtyGate.markDirty();
  renderNpc(record);
});

[identityFields, fourDFields].forEach((container) => {
  container.addEventListener("click", (event) => {
    const button = event.target.closest("[data-reroll-attribute]");
    if (!button || !currentRecord || !currentLocation || !tables) return;
    renderNpc(rerollAttribute(currentRecord, tables, currentLocation, button.dataset.rerollAttribute));
  });
});

// Clicking an Identity or 4D box selects it and surfaces its details in the
// inspector — guarded so a click on the reroll button or the Name field's
// inline input (both nested inside the box) doesn't also toggle selection.
[identityFields, fourDFields].forEach((container) => {
  container.addEventListener("click", (event) => {
    if (event.target.closest("[data-reroll-attribute]") || event.target.closest("[data-editable-field]")) return;
    const box = event.target.closest("[data-select-field]");
    if (!box) return;
    selectField(box.dataset.selectField);
  });
});

// Typing directly into an editable field (currently just Name, which lives
// at the record's top level — see undercroft/forge/js/lib/generator.js —
// not nested in `identity` like the rest of the rolled Identity block) keeps
// the record in sync without re-running renderNpc — same reasoning as the
// note textarea below: resetting .value mid-edit would jump the cursor.
identityFields.addEventListener("input", (event) => {
  const input = event.target.closest("[data-editable-field]");
  if (!input || !currentRecord) return;
  const field = input.dataset.editableField;
  currentRecord = field === "name" ? { ...currentRecord, name: input.value } : currentRecord;
  updateJsonPreview(npcJsonPreview, npcJsonBytes, toPressExportShape(currentRecord));
  refreshActionButtons();
});

// Typing directly into a Stats field (ability scores, AC, HP) keeps the
// record in sync the same way — ability scores also live-update their (+N)
// modifier suffix alongside, since that's derived rather than stored.
statsFields.addEventListener("input", (event) => {
  const input = event.target.closest("[data-editable-field]");
  if (!input || !currentRecord?.stats) return;
  const field = input.dataset.editableField;
  const numericValue = Number(input.value) || 0;
  if (ABILITY_KEYS.has(field)) {
    currentRecord = {
      ...currentRecord,
      stats: { ...currentRecord.stats, abilities: { ...currentRecord.stats.abilities, [field]: numericValue } },
    };
    const suffixEl = statsFields.querySelector(`[data-editable-suffix="${field}"]`);
    if (suffixEl) suffixEl.textContent = abilityModifierText(numericValue);
  } else if (field === "currentHp" || field === "maxHp") {
    const hpKey = field === "currentHp" ? "current" : "max";
    currentRecord = {
      ...currentRecord,
      stats: { ...currentRecord.stats, hitPoints: { ...currentRecord.stats.hitPoints, [hpKey]: numericValue } },
    };
  } else {
    currentRecord = { ...currentRecord, stats: { ...currentRecord.stats, [field]: numericValue } };
  }
  updateJsonPreview(npcJsonPreview, npcJsonBytes, toPressExportShape(currentRecord));
  refreshActionButtons();
});

generateNoteButton.addEventListener("click", async () => {
  if (!currentRecord) return;
  generateNoteButton.disabled = true;
  const originalHtml = generateNoteButton.innerHTML;
  generateNoteButton.innerHTML = '<span class="spinner-border spinner-border-sm" aria-hidden="true"></span> Generating…';
  try {
    const note = await generateCharacterNote(currentRecord);
    currentRecord = { ...currentRecord, note };
    renderNpc(currentRecord);
    status?.show("Note generated.", { type: "success", timeout: 1500 });
  } catch (error) {
    status?.show(`Unable to generate note: ${error.message}`, { type: "error", timeout: 5000 });
  } finally {
    generateNoteButton.disabled = false;
    generateNoteButton.innerHTML = originalHtml;
  }
});

// Typing directly in the note box (writing one from scratch, or editing
// what Generate Note produced) keeps the record in sync without re-running
// renderNpc — resetting .value mid-edit would jump the cursor.
noteText.addEventListener("input", () => {
  if (!currentRecord) return;
  currentRecord = { ...currentRecord, note: noteText.value };
  updateJsonPreview(npcJsonPreview, npcJsonBytes, toPressExportShape(currentRecord));
  refreshActionButtons();
});

// Same dirty check refreshActionButtons already uses for the Save button —
// Forge had no guard at all against navigating/closing away from unsaved
// edits (unlike Workbench, which already had this).
window.addEventListener("beforeunload", (event) => {
  if (!currentRecord || !dirtyGate.isDirty()) return;
  event.preventDefault();
  event.returnValue = "";
});

saveButton.addEventListener("click", async () => {
  if (!currentRecord) return;
  const record = toPressExportShape(currentRecord);
  try {
    // Shared Library, not a Forge-only directory — Press (or any other
    // tool) can read undercroft/common/data/npc/{id}.json directly, the
    // same way it already reads other Library kinds. Default mode ("auto")
    // matters here: Forge has no whole-tool login gate, so an anonymous GM
    // keeps saving locally to their own browser exactly as before, while a
    // signed-in user's NPC becomes a real, owned, shareable record.
    await dataManager.save("npc", currentRecord.id, record);
    dirtyGate.markClean(record);
    refreshActionButtons();
    status?.show("Saved.", { type: "success", timeout: 1500 });
  } catch (error) {
    status?.show(`Unable to save: ${error.message}`, { type: "error", timeout: 4000 });
  }
});

deleteButton.addEventListener("click", async () => {
  if (!currentRecord || !dataManager || !dirtyGate.hasSaved()) return;
  const label = currentRecord.name || currentRecord.id;
  if (!confirmDelete({ label: `"${label}"` })) return;
  try {
    await dataManager.delete("npc", currentRecord.id);
    status?.show("Deleted.", { type: "success", timeout: 1500 });
    dirtyGate.markDirty();
    renderNpc(null);
  } catch (error) {
    status?.show(`Unable to delete: ${error.message}`, { type: "error", timeout: 4000 });
  }
});

exportButton.addEventListener("click", () => {
  if (!currentRecord) return;
  const record = toPressExportShape(currentRecord);
  const blob = new Blob([JSON.stringify(record, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${currentRecord.name || currentRecord.id}.json`;
  link.click();
  URL.revokeObjectURL(url);
});

systemSelect.addEventListener("change", async () => {
  const systemId = systemSelect.value;
  currentLocation = null;
  await Promise.all([refreshSystemVocabulary(systemId), populateSettingSelect(systemId)]);
  await populateLocationSelectOptions("");
});

settingSelect.addEventListener("change", async () => {
  const settingId = settingSelect.value;
  currentLocation = null;
  const locations = await populateLocationSelectOptions(settingId);
  if (locations.length) {
    await selectLocation(locations[0].id);
  }
});

locationSelect.addEventListener("change", () => selectLocation(locationSelect.value));

exportLocationTemplateButton.addEventListener("click", async () => {
  if (!currentLocation) {
    status?.show("Select a location first.", { type: "error", timeout: 3000 });
    return;
  }
  try {
    const templateId = `forge-npc-reference-${currentLocation.id}`;
    const settingName = settingSelect.selectedOptions[0]?.textContent || "";
    const template = await buildLocationPressTemplate(currentLocation, tables, templateId, dataManager, { settingName });
    template.category = "print";
    await dataManager.save("templates", templateId, template);
    status?.show(`Exported Press template ${templateId}.`, { type: "success", timeout: 2500 });
  } catch (error) {
    status?.show(`Unable to export template: ${error.message}`, { type: "error", timeout: 4000 });
  }
});

speciesLastNameFormSelect.addEventListener("change", () => toggleSpeciesLastNamesVisibility());

// --- Init ----------------------------------------------------------------

async function init() {
  const shell = initAppShell({ namespace: "forge", storagePrefix: "undercroft.forge.undo" });
  status = shell.status;
  const auth = initAuthControls({
    status,
  });
  dataManager = auth.dataManager;

  bindCollapsibleToggle(inspectorToggle, inspectorPanel, {
    collapsed: false,
    expandLabel: "Expand component properties",
    collapseLabel: "Collapse component properties",
  });
  // The static markup only carries `hidden` on the Location/Species/Roll
  // panels, which Bootstrap's `!important` `.d-flex` beats on its own (see
  // setInspectorSectionVisible) — run the real visibility logic once up
  // front so nothing but the empty state shows before anything is selected.
  updateInspector();

  tables = await loadForgeTables();
  populateFixedOverrides();

  const systems = await populateSystemSelect();
  const defaultSystemId = systems.some((system) => system.id === "sys.dnd5e") ? "sys.dnd5e" : systems[0]?.id;
  if (defaultSystemId) {
    systemSelect.value = defaultSystemId;
    await refreshSystemVocabulary(defaultSystemId);
    const settings = await populateSettingSelect(defaultSystemId);
    const defaultSettingId = settings.some((setting) => setting.id === "forgotten-realms")
      ? "forgotten-realms"
      : settings[0]?.id;
    if (defaultSettingId) {
      settingSelect.value = defaultSettingId;
      const locations = await populateLocationSelectOptions(defaultSettingId);
      const defaultLocationId = locations.some((location) => location.id === "sword-coast")
        ? "sword-coast"
        : locations[0]?.id;
      if (defaultLocationId) {
        await selectLocation(defaultLocationId);
      }
    }
  }

  renderNpc(null);
  initHelpSystem({ root: document });
  refreshTooltips(document);
}

init();
