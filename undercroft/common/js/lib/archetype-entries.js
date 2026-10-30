// Archetypes are the NPC types a System lists (its "archetypeTable" field
// role) plus any a Location adds for itself. Both are ordered most common
// first, and a Location's own come before the System's.
import { resolveFieldRole } from "./field-roles.js";
import { createSortable } from "./dnd.js";
import { createIconButton } from "./ui-components.js";
import { disposeTooltips, refreshTooltips } from "./tooltips.js";

// The System's named archetype values, in the order the System lists them.
export async function loadSystemArchetypeValues(dataManager, systemId) {
  if (!dataManager || !systemId) return [];
  try {
    const result = await dataManager.get("systems", systemId, { preferLocal: false });
    const field = resolveFieldRole(result?.payload, "archetypeTable")?.fieldDef;
    return (field?.values || []).filter((value) => value?.name);
  } catch (error) {
    return [];
  }
}

// A Location saved with numbered override slots ({"22": {name}, "23": {name}})
// reads as a plain list, in slot order.
export function normalizeLocationArchetypes(location) {
  if (!location || typeof location !== "object") return location;
  const { archetypeOverrides, ...rest } = location;
  if (Array.isArray(rest.archetypes)) return rest;
  const fromSlots =
    archetypeOverrides && typeof archetypeOverrides === "object"
      ? Object.entries(archetypeOverrides)
          .sort(([a], [b]) => Number(a) - Number(b))
          .map(([, entry]) => (entry?.name ? { name: entry.name } : null))
          .filter(Boolean)
      : [];
  return { ...rest, archetypes: fromSlots };
}

function parseProperties(text) {
  const trimmed = text.trim();
  if (!trimmed) return {};
  let parsed;
  try {
    parsed = JSON.parse(trimmed);
  } catch (error) {
    throw new Error("Extra JSON must be valid JSON.");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Extra JSON must be a JSON object, like {\"hitPoints\": 11}.");
  }
  return parsed;
}

// A Location's own archetype list: one row per archetype, a name and optional
// extra properties as JSON (the same keys a System's archetype entries
// carry), in reorderable order. `readOnly` shows the list without editing, for
// Forge. getEntries() throws when the JSON isn't an object (unless
// `strict: false`).
export function createArchetypeEntriesEditor({ container, readOnly = false } = {}) {
  if (!container) throw new Error("createArchetypeEntriesEditor requires a container");
  const noEntries = document.createElement("p");
  noEntries.className = "small text-body-secondary mb-0";
  noEntries.textContent = "No archetypes of its own.";

  function addRow(entry = {}) {
    const { name = "", ...properties } = entry;
    const row = document.createElement("div");
    row.className = "d-flex align-items-center gap-2";
    row.setAttribute("data-archetype-entry", "");

    if (!readOnly) {
      const handle = document.createElement("span");
      handle.className = "flex-shrink-0 text-body-secondary d-inline-flex";
      handle.style.cursor = "grab";
      handle.setAttribute("data-sortable-handle", "");
      const grip = document.createElement("span");
      grip.className = "iconify";
      grip.dataset.icon = "tabler:grip-vertical";
      grip.setAttribute("aria-hidden", "true");
      handle.appendChild(grip);
      row.appendChild(handle);
    }
    const nameInput = document.createElement("input");
    nameInput.className = "form-control form-control-sm flex-shrink-0";
    nameInput.style.width = "10rem";
    nameInput.type = "text";
    nameInput.placeholder = "Name";
    nameInput.value = name;
    nameInput.readOnly = readOnly;
    nameInput.setAttribute("data-archetype-entry-name", "");
    row.appendChild(nameInput);

    const propertiesInput = document.createElement("input");
    propertiesInput.className = "form-control form-control-sm font-monospace flex-grow-1";
    propertiesInput.style.minWidth = "6rem";
    propertiesInput.type = "text";
    propertiesInput.placeholder = "Extra JSON";
    propertiesInput.readOnly = readOnly;
    propertiesInput.value = Object.keys(properties).length ? JSON.stringify(properties) : "";
    propertiesInput.setAttribute("data-archetype-entry-properties", "");
    propertiesInput.addEventListener("input", () => {
      try {
        parseProperties(propertiesInput.value);
        propertiesInput.classList.remove("is-invalid");
      } catch (error) {
        propertiesInput.classList.add("is-invalid");
      }
    });
    row.appendChild(propertiesInput);

    if (!readOnly) {
      row.appendChild(
        createIconButton({
          icon: "tabler:trash",
          label: "Remove archetype",
          variant: "outline-danger",
          className: "flex-shrink-0",
          onClick: () => {
            disposeTooltips(row);
            row.remove();
            sync();
            container.dispatchEvent(new Event("input", { bubbles: true }));
          },
        })
      );
    }
    container.appendChild(row);
    sync();
    refreshTooltips(row);
    return row;
  }

  function sync() {
    const rows = container.querySelectorAll("[data-archetype-entry]");
    if (!rows.length && !container.contains(noEntries)) container.appendChild(noEntries);
    if (rows.length && container.contains(noEntries)) noEntries.remove();
  }

  if (!readOnly) {
    createSortable(container, {
      handle: "[data-sortable-handle]",
      draggable: "[data-archetype-entry]",
      onEnd: () => container.dispatchEvent(new Event("input", { bubbles: true })),
    });
  }

  return {
    addEntry: () => addRow(),
    setEntries(entries) {
      disposeTooltips(container);
      container.replaceChildren();
      (entries || []).forEach((entry) => addRow(entry));
      sync();
    },
    // A name-less row is skipped; later rows repeating a name are dropped.
    // `strict: false` reads an invalid JSON box as empty instead of
    // throwing, for callers that only compare against the saved copy.
    getEntries({ strict = true } = {}) {
      const seen = new Set();
      const result = [];
      container.querySelectorAll("[data-archetype-entry]").forEach((row) => {
        const name = row.querySelector("[data-archetype-entry-name]").value.trim();
        if (!name || seen.has(name)) return;
        seen.add(name);
        let properties = {};
        try {
          properties = parseProperties(row.querySelector("[data-archetype-entry-properties]").value);
        } catch (error) {
          if (strict) throw new Error(`${name}: ${error.message}`);
        }
        result.push({ ...properties, name });
      });
      return result;
    },
  };
}
