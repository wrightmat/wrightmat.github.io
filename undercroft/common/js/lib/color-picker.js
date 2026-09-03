// A custom color-picker popover shared by Press and Workbench — replaces
// the native <input type="color"> for two reasons: (1) this needs a
// binding/formula box alongside the color controls (mirrors
// createFormulaToggleField's manual-vs-formula contract, inspector-fields.js);
// (2) the native picker's hue-bar click commits and closes before a shade
// is actually chosen — a popover we open/close ourselves only closes on
// outside click or Escape.
//
// `evaluate` is injected, not imported, so this module stays
// resolver-agnostic — each tool supplies its own binding/formula resolution.

import { initTooltip } from "./tooltips.js";

// ---- Pure hex/rgb/hsv conversions (nothing like this existed yet) ----

export function normalizeHex(value) {
  const raw = typeof value === "string" ? value.trim() : "";
  const match = /^#?([0-9a-fA-F]{6})$/.exec(raw);
  return match ? `#${match[1].toLowerCase()}` : null;
}

export function hexToRgb(hex) {
  const normalized = normalizeHex(hex);
  if (!normalized) return null;
  const value = normalized.slice(1);
  return {
    r: parseInt(value.slice(0, 2), 16),
    g: parseInt(value.slice(2, 4), 16),
    b: parseInt(value.slice(4, 6), 16),
  };
}

export function rgbToHex({ r, g, b }) {
  const toHex = (channel) => Math.max(0, Math.min(255, Math.round(channel))).toString(16).padStart(2, "0");
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

export function rgbToHsv({ r, g, b }) {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const d = max - min;
  let h = 0;
  if (d !== 0) {
    if (max === rn) h = ((gn - bn) / d) % 6;
    else if (max === gn) h = (bn - rn) / d + 2;
    else h = (rn - gn) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  const s = max === 0 ? 0 : d / max;
  return { h, s: s * 100, v: max * 100 };
}

export function hsvToRgb({ h, s, v }) {
  const sn = s / 100;
  const vn = v / 100;
  const c = vn * sn;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = vn - c;
  let r1 = 0;
  let g1 = 0;
  let b1 = 0;
  if (h < 60) {
    r1 = c;
    g1 = x;
  } else if (h < 120) {
    r1 = x;
    g1 = c;
  } else if (h < 180) {
    g1 = c;
    b1 = x;
  } else if (h < 240) {
    g1 = x;
    b1 = c;
  } else if (h < 300) {
    r1 = x;
    b1 = c;
  } else {
    r1 = c;
    b1 = x;
  }
  return { r: (r1 + m) * 255, g: (g1 + m) * 255, b: (b1 + m) * 255 };
}

export function hexToHsv(hex) {
  const rgb = hexToRgb(hex);
  return rgb ? rgbToHsv(rgb) : null;
}

export function hsvToHex(hsv) {
  return rgbToHex(hsvToRgb(hsv));
}

function expandShortHex(value) {
  const match = /^#([0-9a-fA-F]{3})$/.exec(value.trim());
  if (!match) return null;
  const [r, g, b] = match[1].split("");
  return normalizeHex(`#${r}${r}${g}${g}${b}${b}`);
}

function parseRgbFunction(value) {
  const match = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i.exec(value.trim());
  if (!match) return null;
  return rgbToHex({ r: Number(match[1]), g: Number(match[2]), b: Number(match[3]) });
}

// Resolves a CSS custom property's CURRENT computed value (e.g.
// --bs-body-bg) to a hex string for the picker's own live preview — not
// used for user-typed input, which stays strict via normalizeHex. Tries
// 6-digit hex first, then 3-digit shorthand (Bootstrap uses this for some
// tokens), then an rgb()/rgba() fallback.
export function resolveThemeTokenHex(tokenName) {
  if (typeof document === "undefined" || !tokenName) return null;
  const raw = getComputedStyle(document.documentElement).getPropertyValue(tokenName).trim();
  if (!raw) return null;
  return normalizeHex(raw) || expandShortHex(raw) || parseRgbFunction(raw);
}

// Curated, deliberately small — Bootstrap's own semantic/surface tokens,
// redefined automatically per active theme pack and light/dark mode, so a
// color stored as one of these stays correct forever. Accent Background/
// Accent Text are a deliberate PAIR (Bootstrap's subtle-bg + emphasis-text
// convention) for a foreground always readable against its own background
// regardless of theme. Not a JSON manifest — tied to Bootstrap's own fixed
// vocabulary, just add an entry here to extend it (Danger/Warning/Success).
export const THEME_COLOR_SWATCHES = [
  { label: "Primary", token: "--bs-primary" },
  { label: "Body Background", token: "--bs-body-bg" },
  { label: "Body Text", token: "--bs-body-color" },
  { label: "Muted Text", token: "--bs-secondary-color" },
  { label: "Border", token: "--bs-border-color" },
  { label: "Accent Background", token: "--bs-primary-bg-subtle" },
  { label: "Accent Text", token: "--bs-primary-text-emphasis" },
];

// Matches exactly what commitThemeToken writes back for a theme-token
// selection — the one shape this module recognizes as a theme token.
const THEME_TOKEN_PATTERN = /^var\((--[\w-]+)\)$/;

let idCounter = 0;
function nextId(prefix) {
  idCounter += 1;
  return `color-picker-${prefix}-${idCounter}`;
}

function clamp01(value) {
  return Math.max(0, Math.min(1, value));
}

// The unified manual-vs-formula control for a color — same contract as
// createFormulaToggleField (inspector-fields.js): manual controls work
// when bindingValue is empty; a non-empty bindingValue disables them and
// shows evaluate(raw)'s result instead, or an indeterminate state when
// evaluate returns undefined.
export function createColorPickerField(labelText, {
  value = "",
  defaultValue = "#000000",
  bindingValue = "",
  onManualChange,
  onBindingChange,
  onClear,
  evaluate,
  placeholder = "@abilities.str.mod or =if(...)",
} = {}) {
  const id = nextId(labelText);
  const wrapper = document.createElement("div");
  wrapper.className = "template-color-control";

  const label = document.createElement("label");
  label.className = "form-label small text-body-secondary mb-0";
  label.setAttribute("for", id);
  label.textContent = labelText;

  const controls = document.createElement("div");
  controls.className = "d-flex align-items-center gap-2";

  const swatchWrap = document.createElement("div");
  swatchWrap.className = "template-color-swatch color-picker-swatch-wrap position-relative";

  const swatch = document.createElement("button");
  swatch.type = "button";
  swatch.id = id;
  swatch.className = "color-picker-swatch";
  swatch.setAttribute("aria-haspopup", "true");
  swatch.setAttribute("aria-expanded", "false");

  const unsetIcon = document.createElement("span");
  unsetIcon.className = "iconify template-color-unset-icon";
  unsetIcon.dataset.icon = "tabler:x";
  unsetIcon.setAttribute("aria-hidden", "true");

  swatchWrap.append(swatch, unsetIcon);

  controls.append(swatchWrap);
  wrapper.append(label, controls);

  // ---- Popover (built once, appended to swatchWrap, hidden until open) ----

  const popover = document.createElement("div");
  popover.className = "color-picker-popover d-none";
  popover.setAttribute("role", "dialog");

  const svSquare = document.createElement("div");
  svSquare.className = "color-picker-sv";
  const svIndicator = document.createElement("div");
  svIndicator.className = "color-picker-sv-indicator";
  svSquare.appendChild(svIndicator);

  const hueSlider = document.createElement("div");
  hueSlider.className = "color-picker-hue";
  const hueHandle = document.createElement("div");
  hueHandle.className = "color-picker-hue-handle";
  hueSlider.appendChild(hueHandle);

  // Theme-color swatches — clicking one fills valueInput with the token's
  // bare name (e.g. "--bs-primary"). Each background is set inline to
  // var(<token>), so every dot shows its live theme color with no
  // computed-value lookup needed to render the row.
  const themeSwatchRow = document.createElement("div");
  themeSwatchRow.className = "color-picker-theme-swatches";
  const themeSwatchButtons = THEME_COLOR_SWATCHES.map((entry) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "color-picker-theme-swatch";
    button.style.backgroundColor = `var(${entry.token})`;
    button.setAttribute("aria-label", `Theme color: ${entry.label}`);
    button.dataset.token = entry.token;
    themeSwatchRow.appendChild(button);
    initTooltip(button, { title: `Theme color: ${entry.label}` });
    return button;
  });

  // One input for every color source this field understands (see
  // classifyInput below): "#" hex, "--" a CSS theme variable, "@"/"="
  // binding/formula (both handed to onBindingChange raw). Accept/Clear
  // apply to whatever this currently holds.
  const valueRow = document.createElement("div");
  valueRow.className = "d-flex align-items-center gap-2 color-picker-value-row";
  const valueInput = document.createElement("input");
  valueInput.type = "text";
  valueInput.className = "form-control form-control-sm flex-grow-1";
  valueInput.autocomplete = "off";
  valueInput.spellcheck = false;
  valueInput.placeholder = "#hex · --theme · @bind · =formula";
  // The caller's own richer example moves to a hover tooltip — the
  // placeholder above already has to cover all four shapes at once.
  initTooltip(valueInput, { title: placeholder });
  const acceptButton = document.createElement("button");
  acceptButton.type = "button";
  acceptButton.className = "btn btn-primary btn-sm color-picker-accept flex-shrink-0";
  acceptButton.innerHTML = '<span class="iconify" data-icon="tabler:check" aria-hidden="true"></span>';
  acceptButton.setAttribute("aria-label", `Accept ${labelText.toLowerCase()} color`);
  initTooltip(acceptButton, { title: `Accept ${labelText.toLowerCase()} color` });
  const clearButton = document.createElement("button");
  clearButton.type = "button";
  clearButton.className = "btn btn-outline-secondary btn-sm flex-shrink-0";
  clearButton.innerHTML = '<span class="iconify" data-icon="tabler:circle-off" aria-hidden="true"></span>';
  clearButton.setAttribute("aria-label", `Clear ${labelText.toLowerCase()}`);
  initTooltip(clearButton, { title: `Clear ${labelText.toLowerCase()}` });
  valueRow.append(valueInput, acceptButton, clearButton);

  popover.append(svSquare, hueSlider, themeSwatchRow, valueRow);
  swatchWrap.appendChild(popover);

  // ---- State ----

  let hsv = hexToHsv(value) || hexToHsv(defaultValue) || { h: 0, s: 0, v: 0 };

  function themeTokenFromValue(raw) {
    return THEME_TOKEN_PATTERN.exec(raw || "")?.[1] || "";
  }

  // The one place this module decides which shape a raw string is, used
  // identically for live preview and for commitCurrent, so they can
  // never disagree about what the input currently means.
  function classifyInput(raw) {
    const trimmed = typeof raw === "string" ? raw.trim() : "";
    if (!trimmed) return { kind: "empty", text: "" };
    if (trimmed.startsWith("#")) return { kind: "hex", text: trimmed };
    if (trimmed.startsWith("--")) return { kind: "theme", text: trimmed };
    if (trimmed.startsWith("@") || trimmed.startsWith("=")) return { kind: "binding", text: trimmed };
    return { kind: "unrecognized", text: trimmed };
  }

  // The last actually committed state — binding wins if both
  // `bindingValue` and `value` are set, same precedence this field gives
  // binding over manual color elsewhere.
  let committedRawText = bindingValue || themeTokenFromValue(value) || value || "";
  valueInput.value = committedRawText;
  // Set by any actual edit; cleared on open and after every commit. Lets
  // commitCurrent() no-op on open-then-click-away, instead of pushing a
  // no-op undo entry every time someone glances at a swatch.
  let dirty = false;
  let isOpen = false;

  // Renders the swatch/indicator from whatever the input classifies as.
  // Never invents a color: an unresolved binding/formula/theme-token shows
  // the indeterminate treatment, not a guessed hex. Local preview only —
  // see commitCurrent for the only path that writes to actual data.
  function render() {
    const classification = classifyInput(valueInput.value);
    let effectiveHex = hsvToHex(hsv);
    // Only set for the theme case — a live var() reference, kept correct
    // by the browser with no re-render needed. effectiveHex stays a
    // resolved snapshot, used for the wheel indicator regardless of kind.
    let effectiveSwatchColor = null;
    let isSet = false;
    let indeterminate = false;
    if (classification.kind === "binding") {
      const result = typeof evaluate === "function" ? evaluate(classification.text) : undefined;
      const normalized = result !== undefined ? normalizeHex(result) : null;
      if (normalized) {
        effectiveHex = normalized;
        isSet = true;
      } else {
        indeterminate = true;
      }
    } else if (classification.kind === "theme") {
      effectiveSwatchColor = `var(${classification.text})`;
      const resolved = resolveThemeTokenHex(classification.text);
      if (resolved) {
        effectiveHex = resolved;
        isSet = true;
      } else {
        indeterminate = true;
      }
    } else if (classification.kind === "hex") {
      const normalized = normalizeHex(classification.text);
      if (normalized) {
        effectiveHex = normalized;
        isSet = true;
      } else {
        indeterminate = true;
      }
    } else if (classification.kind === "unrecognized") {
      // Something's there, just not a shape this field understands —
      // "can't preview this," not "nothing entered."
      indeterminate = true;
    }
    swatch.style.backgroundColor = effectiveSwatchColor || effectiveHex;
    wrapper.classList.toggle("template-color-control--unset", !isSet && !indeterminate);
    wrapper.classList.toggle("color-picker-indeterminate", indeterminate);
    themeSwatchButtons.forEach((button) => {
      button.classList.toggle("active", classification.kind === "theme" && button.dataset.token === classification.text);
    });
    const { h, s, v } = hsv;
    svSquare.style.setProperty("--color-picker-hue", String(h));
    svIndicator.style.left = `${s}%`;
    svIndicator.style.top = `${100 - v}%`;
    hueHandle.style.left = `${(h / 360) * 100}%`;
  }

  // Local-only: re-renders the popover's own preview without writing to
  // actual data — see commitCurrent for the only thing that does that.
  function previewInput() {
    const classification = classifyInput(valueInput.value);
    if (classification.kind === "hex") {
      const normalized = normalizeHex(classification.text);
      if (normalized) hsv = hexToHsv(normalized) || hsv;
    }
    dirty = true;
    render();
  }

  // Dragging writes its resulting hex straight into valueInput — this IS
  // how a drag stays visible, as if typed by hand. Overwrites whatever
  // was there before (a binding, a theme token), same as typing over it.
  function applyHsvToInput() {
    valueInput.value = hsvToHex(hsv);
    dirty = true;
    render();
  }

  // The only three things that actually write to the host's data —
  // commitCurrent below decides which applies and is the only caller of
  // any of them. Never invoked directly from a drag/typing frame.
  function commitManualColor(hex) {
    committedRawText = hex;
    if (typeof onManualChange === "function") onManualChange(hex);
  }
  function commitBindingText(raw) {
    committedRawText = raw;
    if (typeof onBindingChange === "function") onBindingChange(raw);
  }
  // Writes "var(--the-token)" into the SAME field a hex value normally
  // occupies (via onManualChange) — every renderer just assigns the string
  // to element.style.color/backgroundColor, so a var() reference works
  // there with zero rendering-side changes.
  function commitThemeToken(tokenName) {
    committedRawText = tokenName;
    if (typeof onManualChange === "function") onManualChange(`var(${tokenName})`);
  }
  function commitClear() {
    committedRawText = "";
    if (typeof onBindingChange === "function") onBindingChange("");
    if (typeof onClear === "function") onClear();
  }

  // The one place anything gets committed — Accept, Enter, and closing the
  // popover by any means other than Escape all funnel through this. A
  // no-op open-then-close commits nothing (see `dirty`). Typing something
  // matching none of the recognized shapes also commits nothing —
  // "silently ignore, don't guess."
  function commitCurrent() {
    if (!dirty) return;
    const classification = classifyInput(valueInput.value);
    if (classification.kind === "binding") {
      commitBindingText(classification.text);
    } else if (classification.kind === "theme") {
      commitThemeToken(classification.text);
    } else if (classification.kind === "hex") {
      commitManualColor(normalizeHex(classification.text) || hsvToHex(hsv));
    } else if (classification.kind === "empty") {
      commitClear();
    }
    dirty = false;
    render();
  }

  // ---- Saturation/Value square drag ----

  function updateSvFromEvent(event) {
    const rect = svSquare.getBoundingClientRect();
    const clientX = event.touches ? event.touches[0].clientX : event.clientX;
    const clientY = event.touches ? event.touches[0].clientY : event.clientY;
    const x = clamp01((clientX - rect.left) / rect.width);
    const y = clamp01((clientY - rect.top) / rect.height);
    hsv = { ...hsv, s: x * 100, v: (1 - y) * 100 };
    applyHsvToInput();
  }

  function onSvPointerMove(event) {
    event.preventDefault();
    updateSvFromEvent(event);
  }
  function onSvPointerUp() {
    document.removeEventListener("mousemove", onSvPointerMove);
    document.removeEventListener("mouseup", onSvPointerUp);
    document.removeEventListener("touchmove", onSvPointerMove);
    document.removeEventListener("touchend", onSvPointerUp);
  }
  svSquare.addEventListener("mousedown", (event) => {
    event.preventDefault();
    updateSvFromEvent(event);
    document.addEventListener("mousemove", onSvPointerMove);
    document.addEventListener("mouseup", onSvPointerUp);
  });
  svSquare.addEventListener("touchstart", (event) => {
    updateSvFromEvent(event);
    document.addEventListener("touchmove", onSvPointerMove, { passive: false });
    document.addEventListener("touchend", onSvPointerUp);
  });

  // ---- Hue slider drag ----

  function updateHueFromEvent(event) {
    const rect = hueSlider.getBoundingClientRect();
    const clientX = event.touches ? event.touches[0].clientX : event.clientX;
    const x = clamp01((clientX - rect.left) / rect.width);
    hsv = { ...hsv, h: x * 360 };
    applyHsvToInput();
  }
  function onHuePointerMove(event) {
    event.preventDefault();
    updateHueFromEvent(event);
  }
  function onHuePointerUp() {
    document.removeEventListener("mousemove", onHuePointerMove);
    document.removeEventListener("mouseup", onHuePointerUp);
    document.removeEventListener("touchmove", onHuePointerMove);
    document.removeEventListener("touchend", onHuePointerUp);
  }
  hueSlider.addEventListener("mousedown", (event) => {
    event.preventDefault();
    updateHueFromEvent(event);
    document.addEventListener("mousemove", onHuePointerMove);
    document.addEventListener("mouseup", onHuePointerUp);
  });
  hueSlider.addEventListener("touchstart", (event) => {
    updateHueFromEvent(event);
    document.addEventListener("touchmove", onHuePointerMove, { passive: false });
    document.addEventListener("touchend", onHuePointerUp);
  });

  // ---- Theme-color swatches ----

  themeSwatchButtons.forEach((button) => {
    button.addEventListener("click", () => {
      valueInput.value = button.dataset.token;
      dirty = true;
      render();
    });
  });

  // ---- The one value input ----

  valueInput.addEventListener("input", () => {
    previewInput();
  });
  // Enter is a shortcut for "commit and close" (same as Accept) — a
  // deliberate one-shot confirm, not a second code path.
  valueInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      commitAndClose();
    }
  });

  // ---- Accept ----

  acceptButton.addEventListener("click", () => {
    commitAndClose();
  });

  // ---- Clear ----

  clearButton.addEventListener("click", () => {
    valueInput.value = "";
    commitClear();
    dirty = false;
    hsv = hexToHsv(defaultValue) || hsv;
    render();
  });

  // ---- Open/close ----
  //
  // Escape is the only real "never mind" — discards staged changes and
  // falls back to the last committed state. Every other way of leaving
  // (Accept, Enter, clicking away) commits first — closing isn't a
  // separate action from confirming.

  function teardownOpenState() {
    isOpen = false;
    popover.classList.add("d-none");
    swatch.setAttribute("aria-expanded", "false");
    document.removeEventListener("mousedown", onDocumentMouseDown, true);
    document.removeEventListener("keydown", onDocumentKeyDown, true);
  }

  function commitAndClose() {
    if (!isOpen) return;
    commitCurrent();
    teardownOpenState();
  }

  function closeAndDiscard() {
    if (!isOpen) return;
    teardownOpenState();
    valueInput.value = committedRawText;
    const committed = classifyInput(committedRawText);
    if (committed.kind === "hex") {
      hsv = hexToHsv(committed.text) || hexToHsv(defaultValue) || hsv;
    }
    dirty = false;
    render();
  }

  // Finds the nearest ancestor that bounds this field's visible area on
  // the given edge — generic rather than a tool-specific pane selector,
  // since Press and Workbench each have their own panel structure. Falls
  // back to the viewport. `edge` is "right" or "bottom", the only two
  // directions this popover (anchored top-left) ever needs to flip.
  function getClippingAncestorEdge(el, edge) {
    const overflowProp = edge === "right" ? "overflowX" : "overflowY";
    let node = el.parentElement;
    while (node && node !== document.body) {
      const overflow = window.getComputedStyle(node)[overflowProp];
      if (overflow === "auto" || overflow === "scroll" || overflow === "hidden") {
        return node.getBoundingClientRect()[edge];
      }
      node = node.parentElement;
    }
    return edge === "right"
      ? document.documentElement.clientWidth || window.innerWidth
      : document.documentElement.clientHeight || window.innerHeight;
  }

  // Default anchor is flush with the swatch's left edge, just below it.
  // Both edges are checked independently and flipped whichever way fits —
  // a field near the bottom has the same problem vertically that one near
  // the right edge (Border) has horizontally. Measured after unhiding
  // (getBoundingClientRect needs real layout); only overridden when it
  // doesn't fit.
  function repositionPopover() {
    popover.style.left = "0";
    popover.style.right = "auto";
    popover.style.top = "calc(100% + 0.375rem)";
    popover.style.bottom = "auto";
    const rect = popover.getBoundingClientRect();
    if (rect.right > getClippingAncestorEdge(swatchWrap, "right")) {
      popover.style.left = "auto";
      popover.style.right = "0";
    }
    if (rect.bottom > getClippingAncestorEdge(swatchWrap, "bottom")) {
      popover.style.top = "auto";
      popover.style.bottom = "calc(100% + 0.375rem)";
    }
  }

  function open() {
    if (isOpen) return;
    isOpen = true;
    dirty = false;
    popover.classList.remove("d-none");
    swatch.setAttribute("aria-expanded", "true");
    repositionPopover();
    document.addEventListener("mousedown", onDocumentMouseDown, true);
    document.addEventListener("keydown", onDocumentKeyDown, true);
  }

  function onDocumentMouseDown(event) {
    if (swatchWrap.contains(event.target)) return;
    commitAndClose();
  }
  function onDocumentKeyDown(event) {
    if (event.key === "Escape") {
      event.preventDefault();
      closeAndDiscard();
    }
  }

  swatch.addEventListener("click", () => {
    if (isOpen) {
      commitAndClose();
    } else {
      open();
    }
  });

  render();

  return wrapper;
}
