// Font-family search/autocomplete for a "Font" inspector field — shared by
// Press and Workbench so the two pickers stay byte-for-byte identical
// (Press-specific bits like its Add Font modal are caller-supplied
// callbacks, same attachXAutocomplete(input, {onSelect}) shape icon-picker.js
// uses).
import { getAllFontOptions, isCustomFontId, ensureFontLoaded, verifyGoogleFontExists, lookupGoogleFontCategory } from "./font-library.js";

// A comma means it's already a full CSS font-family declaration (e.g.
// "Georgia, serif") — used verbatim. No comma means a bare name, treated as
// a Google Font: existence-checked, wrapped with a generic fallback for
// `family`, space-to-"+" encoded for `googleFont`. Throws with a user-facing
// message on any validation failure.
export async function validateFontInput(raw) {
  if (!raw) {
    throw new Error("Enter a font name or CSS font-family value.");
  }
  const isRawCss = raw.includes(",");
  // Different allowlists per shape — catches junk input before any network
  // activity; only the bare-name path gets the real-existence check below.
  const isValidFormat = isRawCss ? /^[a-zA-Z0-9 ,'"-]{1,150}$/.test(raw) : /^[a-zA-Z0-9 '-]{1,60}$/.test(raw);
  if (!isValidFormat) {
    throw new Error("That doesn't look like a valid font name or font-family value.");
  }
  const baseLabel = isRawCss ? raw.replace(/['"]/g, "").split(",")[0].trim() || raw : raw;
  const id = baseLabel.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  if (!id) {
    throw new Error("Enter a valid font name or font-family value.");
  }
  let label = baseLabel;
  let googleFont;
  if (!isRawCss) {
    googleFont = raw.replace(/\s+/g, "+");
    await verifyGoogleFontExists(raw, googleFont);
    // Best-effort labeling (e.g. "Georgia (serif)") — any lookup problem
    // just means no suffix, never blocks validation; logged for diagnosis.
    const { category } = await lookupGoogleFontCategory(raw);
    if (category) {
      label = `${raw} (${category})`;
    } else {
      console.warn(`No Google Fonts category found for "${raw}" — the metadata lookup may be unavailable from this origin.`);
    }
  }
  return isRawCss ? { id, label, family: raw } : { id, label, family: `'${raw}', sans-serif`, googleFont };
}

function ensureFontFamilyAutocompleteContainer(input) {
  if (!input || !input.parentElement) return null;
  const parent = input.closest(".form-floating") ?? input.parentElement;
  parent.classList.add("position-relative");
  let container = parent.querySelector("[data-font-autocomplete]");
  if (!container) {
    container = document.createElement("div");
    container.dataset.fontAutocomplete = "true";
    container.className = "list-group position-absolute top-100 start-0 w-100 shadow-sm bg-body border mt-1 d-none";
    container.style.zIndex = "1300";
    container.style.fontSize = "0.8125rem";
    container.style.maxHeight = "16rem";
    container.style.overflowY = "auto";
    parent.appendChild(container);
  }
  return container;
}

// Filters getAllFontOptions() as you type, arrow keys navigate, Enter/click
// selects — same shape as every other autocomplete in this suite. A pinned
// "Add a font…" row is appended when `onAddFont` is supplied; each rendered
// row previews its own font live via inline style.
//
// `onSelect(option)` is required. `onAddFont`/`canAddFont`/`onAddDenied` and
// `onDeleteFont`/`canDeleteFont` are optional and independently omittable.
export function attachFontFamilyAutocomplete(
  input,
  {
    onSelect,
    onAddFont = null,
    canAddFont = () => true,
    onAddDenied = null,
    onDeleteFont = null,
    canDeleteFont = () => true,
    // A Template-level "base font" field has nothing to inherit from, so
    // "Default" is meaningless there and excluded entirely.
    excludeDefault = false,
  } = {}
) {
  if (!input || typeof onSelect !== "function") return null;
  const container = ensureFontFamilyAutocompleteContainer(input);
  if (!container) return null;
  const MAX_ITEMS = 20;
  let items = [];
  let activeIndex = -1;

  const close = () => {
    items = [];
    activeIndex = -1;
    container.innerHTML = "";
    container.classList.add("d-none");
  };

  const activateItem = (item) => {
    close();
    if (item.type === "add") {
      if (!onAddFont) return;
      if (canAddFont()) {
        onAddFont();
      } else if (onAddDenied) {
        onAddDenied();
      }
    } else {
      onSelect(item.option);
    }
  };

  // `searchOverride` replaces the field's current value for filtering —
  // used on focus so opening the dropdown on an already-selected font shows
  // every option, not just the one matching that exact label text.
  const render = (searchOverride) => {
    const value = (searchOverride ?? input.value).trim().toLowerCase();
    const matches = getAllFontOptions()
      .filter((option) => (excludeDefault ? option.family !== null : true))
      .filter((option) => {
        if (!value) return true;
        return option.label.toLowerCase().includes(value) || (option.family ?? "").toLowerCase().includes(value);
      })
      .slice(0, MAX_ITEMS);
    items = [...matches.map((option) => ({ type: "font", option })), ...(onAddFont ? [{ type: "add" }] : [])];
    activeIndex = -1;
    container.innerHTML = "";
    items.forEach((item, index) => {
      // A <div>, not a <button> — the optional delete button below needs to
      // nest inside a clickable row, and a <button> can't contain another.
      const row = document.createElement("div");
      row.className = "list-group-item list-group-item-action d-flex align-items-center gap-2 py-1";
      row.dataset.fontIndex = String(index);
      row.setAttribute("role", "option");

      const label = document.createElement("span");
      label.className = "flex-grow-1 text-truncate";
      if (item.type === "add") {
        label.textContent = "Add a font…";
        row.classList.add("fw-semibold");
      } else {
        label.textContent = item.option.label;
        if (item.option.family) {
          label.style.fontFamily = item.option.family;
          ensureFontLoaded(item.option);
        }
      }
      row.appendChild(label);

      if (item.type === "font" && onDeleteFont && isCustomFontId(item.option.id) && canDeleteFont(item.option)) {
        const deleteButton = document.createElement("button");
        deleteButton.type = "button";
        deleteButton.className = "btn btn-sm btn-outline-danger py-0 px-1 flex-shrink-0";
        deleteButton.textContent = "×";
        deleteButton.setAttribute("aria-label", `Delete ${item.option.label} from the font library`);
        deleteButton.addEventListener("mousedown", (event) => event.preventDefault());
        deleteButton.addEventListener("click", (event) => {
          event.stopPropagation();
          close();
          onDeleteFont(item.option);
        });
        row.appendChild(deleteButton);
      }

      row.addEventListener("mousedown", (event) => event.preventDefault());
      row.addEventListener("click", () => activateItem(item));
      container.appendChild(row);
    });
    container.classList.remove("d-none");
  };

  const onKeyDown = (event) => {
    if (container.classList.contains("d-none")) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      activeIndex = Math.min(activeIndex + 1, items.length - 1);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      activeIndex = Math.max(activeIndex - 1, 0);
    } else if (event.key === "Enter") {
      if (activeIndex < 0 || !items[activeIndex]) return;
      event.preventDefault();
      activateItem(items[activeIndex]);
      return;
    } else if (event.key === "Escape") {
      event.preventDefault();
      close();
      return;
    } else {
      return;
    }
    Array.from(container.querySelectorAll("[data-font-index]")).forEach((row) => {
      row.classList.toggle("active", Number(row.dataset.fontIndex) === activeIndex);
    });
  };

  input.addEventListener("focus", () => {
    // Select-all on focus: the common case is replacing one font, not
    // editing the name in place. Rendered with an empty search — focusing
    // means "show me my options," not "search what's already there."
    input.select();
    render("");
  });
  input.addEventListener("click", render);
  input.addEventListener("input", render);
  input.addEventListener("keydown", onKeyDown);
  input.addEventListener("blur", () => setTimeout(close, 120));

  return { render, close };
}
