// Shared plumbing for Crucible/Vault/Sanctum's near-identical "generate a
// record from Library reference data, then save/export/note it" one-shot
// flow — Forge doesn't participate (no feature/recipe concept, and its own
// listAllSystems merges in dataManager.listBuiltins() for a legacy-builtin-
// Location case none of these three have, so it stays a local function
// there rather than being forced into this shared shape). Each function
// here takes whatever per-tool state it needs explicitly (a list, a DOM
// element, an export-shaping function) instead of closing over module-level
// state, so one shared copy works for all three tools' own module-scoped
// variables.

export async function listAllSystems(dataManager) {
  if (!dataManager) return [];
  try {
    const listing = await dataManager.list("systems");
    const entries = dataManager.collectListEntries(listing.remote, ["items", "owned", "shared", "public"]);
    return entries
      .map((entry) => ({ id: entry.id, title: entry.title || entry.id }))
      .sort((a, b) => a.title.localeCompare(b.title));
  } catch (error) {
    return [];
  }
}

export function findById(list, id) {
  return list.find((entry) => entry.id === id) || null;
}

export function featureLabel(features, id) {
  const feature = findById(features, id);
  return feature ? feature.name || feature.id : id;
}

export function readLockedFeatureIds(selectElement) {
  if (!selectElement) return [];
  return Array.from(selectElement.selectedOptions).map((option) => option.value);
}

// `toPressExportShape` is each tool's own record-shaping function (monster/
// effect/location schema) — the only genuinely tool-specific piece; the
// Blob/anchor/download mechanics around it are what were actually duplicated.
export function exportRecordAsJson(record, toPressExportShape) {
  const shaped = toPressExportShape(record);
  const blob = new Blob([JSON.stringify(shaped, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${shaped.name || shaped.id}.json`;
  link.click();
  URL.revokeObjectURL(url);
}

// The "generate a note via LLM" flow (spinner swap, call the tool's own
// generate-note endpoint, write name/notes back onto the record and its
// inputs, restore the button) is identical across Crucible/Vault/Sanctum —
// only the request body sent to the LLM genuinely differs per tool, so
// that's the one thing callers provide as a closure. `record` is mutated in
// place (record.name/record.notes) rather than returned, since callers hold
// their own reference to the same object and expect it updated directly,
// matching what each tool's local version already did.
//
// Forge doesn't use this: its own note flow doesn't suggest/overwrite a
// name (Forge's NPCs already have a rolled name), it's a genuinely different
// shape, not just a different request body.
export async function generateNoteForRecord({ record, elements, status, generateNote, buildRequestBody }) {
  if (!record) return false;
  record.name = elements.nameInput?.value || "";
  const originalHtml = elements.generateNoteButton?.innerHTML;
  if (elements.generateNoteButton) {
    elements.generateNoteButton.disabled = true;
    elements.generateNoteButton.innerHTML =
      '<span class="spinner-border spinner-border-sm" role="status" aria-hidden="true"></span> Generating…';
  }
  try {
    const { name, note } = await generateNote(buildRequestBody(record));
    record.name = name;
    record.notes = note;
    if (elements.nameInput) elements.nameInput.value = name;
    if (elements.notesText) elements.notesText.value = note;
    status?.show("Note generated.", { type: "success", timeout: 1500 });
    return true;
  } catch (error) {
    status?.show(`Unable to generate note: ${error.message}`, { type: "error", timeout: 5000 });
    return false;
  } finally {
    if (elements.generateNoteButton) {
      elements.generateNoteButton.disabled = false;
      elements.generateNoteButton.innerHTML = originalHtml;
    }
  }
}
