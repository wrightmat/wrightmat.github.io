// Font-family search/autocomplete for a "Font" inspector field — shared by
// Press and Workbench, extracted from Press's original inline
// attachFontFamilyAutocomplete (moved here verbatim except for the
// Press-specific bits — opening its own Add Font modal, its own tier
// check, its own node-mutation write — which become caller-supplied
// callbacks, the same attachXAutocomplete(input, {onSelect}) shape
// common/js/lib/icon-picker.js already established) so the two tools'
// Font pickers stay byte-for-byte identical instead of drifting apart.
import { getAllFontOptions, isCustomFontId, ensureFontLoaded, verifyGoogleFontExists, lookupGoogleFontCategory } from "./font-library.js";

// Shared by an "Add a font" modal's blur-triggered validation and its
// submit handler (whichever caller uses one — Press's and Workbench's own
// modals both do) — a comma means it's already a full CSS font-family
// declaration (e.g. "Georgia, serif" or "'My Font', sans-serif") — used
// verbatim, nothing to load or verify. No comma means a bare name (e.g.
// "Roboto Condensed") — treated as a Google Font: existence-checked,
// wrapped with a generic fallback for `family`, and space-to-"+" encoded
// for `googleFont`. Throws with a user-facing message on any validation
// failure.
export async function validateFontInput(raw) {
  if (!raw) {
    throw new Error("Enter a font name or CSS font-family value.");
  }
  const isRawCss = raw.includes(",");
  // Different allowlists since the two shapes have different valid
  // characters — catches obviously-wrong/junk input before any network
  // activity, independent of the real-existence check below (which only
  // applies to the bare-name path; a raw CSS stack can't be verified
  // against anything).
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
    // Confirms the name actually resolves to something Google Fonts
    // serves before it's added to the shared library — throws with a
    // user-facing message if not.
    await verifyGoogleFontExists(raw, googleFont);
    // Best-effort labeling, "if known" — the same style the old
    // hand-curated list used (e.g. "Georgia (serif)"). Any lookup problem
    // (including this specific metadata endpoint being unreachable or
    // CORS-blocked from this origin, which is unconfirmed) just means no
    // suffix, never blocks validation — logged so it's diagnosable if it
    // keeps not showing up.
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

// Filters getAllFontOptions() (label/family substring match, both cases
// folded) as you type, arrow keys navigate, Enter/click selects — same
// shape as every other autocomplete in this suite. Two differences from a
// plain list: a pinned "Add a font…" row always appended after the
// filtered results (only shown when `onAddFont` is supplied — omit it to
// get a plain read-only picker with no add affordance), and each rendered
// row previews its own font live via inline style, loading Google Fonts
// progressively as they scroll into view so the preview isn't just the
// fallback.
//
// `onSelect(option)` is required — the caller owns writing the chosen
// option onto whatever it's editing. `onAddFont`/`canAddFont`/
// `onAddDenied` and `onDeleteFont`/`canDeleteFont` are all optional and
// independently omittable — a caller with no Add/Delete affordance (or no
// tier system at all) can just leave them out.
export function attachFontFamilyAutocomplete(
  input,
  {
    onSelect,
    onAddFont = null,
    canAddFont = () => true,
    onAddDenied = null,
    onDeleteFont = null,
    canDeleteFont = () => true,
    // A Template-level "base font" field has nothing to inherit from —
    // there's no "Default" for it to mean, so it's excluded from that
    // field's own list entirely rather than shown as a choice that would
    // just be confusing/meaningless there.
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

  // `searchOverride`, when passed, replaces whatever's currently in the
  // field for filtering purposes — used on focus (below) so opening the
  // dropdown on an already-selected font (e.g. "Georgia (serif)") shows
  // every option, not just the ones matching that exact label text (which
  // in practice meant only the current selection itself ever matched,
  // making every other font look like it didn't exist until the field was
  // manually cleared first).
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
      // A <div>, not a <button> — the optional delete button below needs
      // to nest inside a clickable row, and a <button> can't contain
      // another <button> (invalid HTML). Click handling on the row itself
      // does the same job a <button> would.
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
    // Select-all on focus: the common case is replacing one font with
    // another, not editing the name in place, so this saves a
    // select-all-then-type step every time (matches how a lot of native
    // "pick one of these" text fields behave). Rendered with an empty
    // search (see render's own comment) — focusing means "show me my
    // options", not "search for text matching what's already there".
    input.select();
    render("");
  });
  input.addEventListener("click", render);
  input.addEventListener("input", render);
  input.addEventListener("keydown", onKeyDown);
  input.addEventListener("blur", () => setTimeout(close, 120));

  return { render, close };
}
