// A custom color-picker popover shared by Press and Workbench — replaces
// the native <input type="color"> for each tool's own color concepts (Text/
// Foreground/Background/Border — this module doesn't know or care which;
// that vocabulary lives in each tool's own COLOR_FIELD_MAP), for two
// reasons: (1) the native OS picker has no room for a second control,
// and this tool needs a binding/formula box alongside the color controls
// (mirrors createFormulaToggleField's manual-vs-formula contract — see
// common/js/lib/inspector-fields.js); (2) the native picker's own hue-bar
// click commits and closes it before a shade is actually chosen, which is
// exactly the "weird behavior" this replaces — a popover we open/close
// ourselves never closes on an internal drag or click, only on outside
// click or Escape.
//
// Same "evaluate is injected, not imported" shape createFormulaToggleField
// already uses, so this module stays resolver-agnostic: each tool supplies
// its own binding/formula resolution rather than this module importing
// bindings.js/a formula engine directly.

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

// Resolves a CSS custom property's CURRENT computed value (e.g. Bootstrap's
// own --bs-body-bg, "#fff" in light mode) to a hex string this module's
// existing hex/HSV pipeline can use for the picker's own live preview — NOT
// used for user-typed hex input, which stays strictly 6-digit via
// normalizeHex above. Bootstrap uses 3-digit shorthand for some tokens
// (confirmed by reading the vendored CSS directly: --bs-body-bg:#fff),
// which normalizeHex's own strict regex rejects — this tries that first,
// then a 3-digit expansion, then a rgb()/rgba() function-syntax fallback in
// case a custom (non-Bootstrap) token happens to be defined that way.
export function resolveThemeTokenHex(tokenName) {
  if (typeof document === "undefined" || !tokenName) return null;
  const raw = getComputedStyle(document.documentElement).getPropertyValue(tokenName).trim();
  if (!raw) return null;
  return normalizeHex(raw) || expandShortHex(raw) || parseRgbFunction(raw);
}

// Curated, deliberately small — Bootstrap's own semantic/surface tokens,
// already redefined automatically per active Bootswatch pack
// (common/data/theme-packs.json) and per light/dark mode
// ([data-bs-theme]), so a color stored as one of these stays correct
// forever with zero template-side changes when either changes. Accent
// Background/Accent Text are a deliberate PAIR — Bootstrap 5.3's own
// "subtle background + emphasis text" convention, engineered to stay
// readable together in both modes — the direct answer to needing a
// foreground that's always readable against its own background regardless
// of active theme (5e proficiency pips, e.g.), which no fixed hex can
// promise once the palette itself is user-selectable. Not a JSON manifest
// like theme-packs.json — this list is tied to Bootstrap's own fixed
// vocabulary, not per-System/user content — just add an entry here to
// extend it later (Danger/Warning/Success, etc.).
export const THEME_COLOR_SWATCHES = [
  { label: "Primary", token: "--bs-primary" },
  { label: "Body Background", token: "--bs-body-bg" },
  { label: "Body Text", token: "--bs-body-color" },
  { label: "Muted Text", token: "--bs-secondary-color" },
  { label: "Border", token: "--bs-border-color" },
  { label: "Accent Background", token: "--bs-primary-bg-subtle" },
  { label: "Accent Text", token: "--bs-primary-text-emphasis" },
];

// Matches exactly what this field writes back out for a theme-token
// selection (see commitThemeToken below) — the one shape this module
// recognizes as "this value is a theme token," on load and on every
// render.
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
// createFormulaToggleField (inspector-fields.js): manual controls (the
// swatch/square/hue/hex) work when bindingValue is empty; a non-empty
// bindingValue disables them and shows evaluate(raw)'s result instead (or
// an indeterminate "can't preview" state when evaluate returns undefined —
// e.g. Workbench's Template editor canvas, which never evaluates
// "=formula" expressions, only "@bindings" — see that module's own note).
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

  // Theme-color swatches — clicking one is a shortcut that fills
  // valueInput below with that token's bare name (e.g. "--bs-primary"),
  // not a separate mechanism from it. Each swatch's own background is set
  // inline to var(<token>) directly, so every dot always shows its real,
  // live, currently-active-theme color with no computed-value lookup
  // needed just to render the row itself.
  const themeSwatchRow = document.createElement("div");
  themeSwatchRow.className = "color-picker-theme-swatches";
  const themeSwatchButtons = THEME_COLOR_SWATCHES.map((entry) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "color-picker-theme-swatch";
    button.style.backgroundColor = `var(${entry.token})`;
    button.title = `Theme color: ${entry.label}`;
    button.setAttribute("aria-label", `Theme color: ${entry.label}`);
    button.dataset.token = entry.token;
    themeSwatchRow.appendChild(button);
    return button;
  });

  // One input for every color source this field understands — a leading
  // character decides which (see classifyInput below): "#" a literal hex,
  // "--" a CSS theme variable (what the swatches above are shortcuts for),
  // "@" a binding or "=" a formula (unchanged from before this
  // consolidation — both were always handed to onBindingChange raw either
  // way, never actually two different code paths here). Accept/Clear apply
  // to whatever this currently holds, same "confirm what's shown" contract
  // the old per-mode Accept button already had, just one shared instance
  // of it instead of one per mode.
  const valueRow = document.createElement("div");
  valueRow.className = "d-flex align-items-center gap-2 color-picker-value-row";
  const valueInput = document.createElement("input");
  valueInput.type = "text";
  valueInput.className = "form-control form-control-sm flex-grow-1";
  valueInput.autocomplete = "off";
  valueInput.spellcheck = false;
  valueInput.placeholder = "#hex · --theme · @bind · =formula";
  // The caller's own richer example (e.g. "@abilities.str.mod or
  // =if(...)") moves to a hover tooltip rather than the placeholder text —
  // there's only one input now, and the placeholder above already has to
  // cover all four shapes at once.
  valueInput.title = placeholder;
  const acceptButton = document.createElement("button");
  acceptButton.type = "button";
  acceptButton.className = "btn btn-primary btn-sm color-picker-accept flex-shrink-0";
  acceptButton.innerHTML = '<span class="iconify" data-icon="tabler:check" aria-hidden="true"></span>';
  acceptButton.setAttribute("aria-label", `Accept ${labelText.toLowerCase()} color`);
  const clearButton = document.createElement("button");
  clearButton.type = "button";
  clearButton.className = "btn btn-outline-secondary btn-sm flex-shrink-0";
  clearButton.innerHTML = '<span class="iconify" data-icon="tabler:circle-off" aria-hidden="true"></span>';
  clearButton.title = `Clear ${labelText.toLowerCase()}`;
  clearButton.setAttribute("aria-label", `Clear ${labelText.toLowerCase()}`);
  valueRow.append(valueInput, acceptButton, clearButton);

  popover.append(svSquare, hueSlider, themeSwatchRow, valueRow);
  swatchWrap.appendChild(popover);

  // ---- State ----

  let hsv = hexToHsv(value) || hexToHsv(defaultValue) || { h: 0, s: 0, v: 0 };

  function themeTokenFromValue(raw) {
    return THEME_TOKEN_PATTERN.exec(raw || "")?.[1] || "";
  }

  // "#" hex, "--" a CSS custom property, "@"/"=" binding/formula — the
  // one place this module decides which of the three (or "empty"/
  // "unrecognized") a raw string is, used identically for live preview
  // (render/previewInput) and for commitCurrent, so they can never
  // disagree about what the input currently means.
  function classifyInput(raw) {
    const trimmed = typeof raw === "string" ? raw.trim() : "";
    if (!trimmed) return { kind: "empty", text: "" };
    if (trimmed.startsWith("#")) return { kind: "hex", text: trimmed };
    if (trimmed.startsWith("--")) return { kind: "theme", text: trimmed };
    if (trimmed.startsWith("@") || trimmed.startsWith("=")) return { kind: "binding", text: trimmed };
    return { kind: "unrecognized", text: trimmed };
  }

  // What the input shows for "the last actually committed state" — binding
  // wins if both `bindingValue` and `value` happen to be set, same
  // precedence this field already gave binding over manual color before
  // this consolidation. Everything this field ever commits is exactly one
  // of these three shapes (see commitCurrent), so recognizing which one
  // `value` already is uses the same classification, just run once here.
  let committedRawText = bindingValue || themeTokenFromValue(value) || value || "";
  valueInput.value = committedRawText;
  // Set by any actual edit (drag, typing, a theme swatch click); cleared on
  // open and after every commit. Lets commitCurrent() no-op on a plain
  // open-then-click-away with nothing touched, instead of writing an
  // unchanged value and pushing a no-op undo entry every time someone
  // glances at a swatch.
  let dirty = false;
  let isOpen = false;

  // Renders the swatch/indicator from whatever the input currently
  // classifies as. Never invents a color of its own: an unresolved
  // binding/formula/theme-token shows the same unset/indeterminate
  // treatment the rest of this inspector already uses for "nothing is
  // actually set," not a guessed hex. Called on every drag/typing frame
  // purely for this LOCAL preview — nothing here writes to the actual data
  // (see commitCurrent for the only path that does).
  function render() {
    const classification = classifyInput(valueInput.value);
    let effectiveHex = hsvToHex(hsv);
    // Only set for the theme case — a live var() reference, kept correct
    // forever by the browser itself (theme pack/light-dark changes need no
    // re-render here). effectiveHex stays a resolved snapshot, used for
    // the wheel's own indicator position regardless of which kind is active.
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

  // Local-only: re-renders the popover's own preview (swatch included)
  // without writing anything to the actual data — see commitCurrent for
  // the only thing that actually does that.
  function previewInput() {
    const classification = classifyInput(valueInput.value);
    if (classification.kind === "hex") {
      const normalized = normalizeHex(classification.text);
      if (normalized) hsv = hexToHsv(normalized) || hsv;
    }
    dirty = true;
    render();
  }

  // Dragging always writes its resulting hex straight into valueInput —
  // there's only one input now, so this IS how a drag stays visible,
  // exactly as if the user had typed the same hex by hand. Whatever kind
  // of value was there before (a binding, a theme token) is simply
  // overwritten, same as typing over it would be.
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
  // occupies (via onManualChange, not a new callback) — every renderer
  // already just assigns whatever string it's given to element.style.color/
  // backgroundColor, so a var() reference works there with zero rendering-
  // side changes, and stays live/correct automatically if the active theme
  // pack or light/dark mode changes later.
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
  // no-op open-then-close (nothing actually touched) commits nothing at
  // all — see `dirty`'s own comment. Typing the input down to nothing and
  // committing that is a real "clear" edit, same as clicking Clear
  // outright; typing something that matches none of the four recognized
  // shapes commits nothing, same defensive "silently ignore, don't guess"
  // behavior this field's own hex input always had for invalid text.
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
  // Escape is the only real "never mind" — it discards whatever's staged
  // and falls back to the last actually-committed state. Every other way
  // of leaving the popover (Accept, Enter, clicking away, toggling the
  // swatch closed) commits first, same as clicking Accept — "closing"
  // isn't a separate action from "confirming," except when you explicitly
  // hit Escape to back out.

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

  // Finds the nearest ancestor that actually bounds this field's visible
  // area on the given edge (an x/y-scrollable/clipped panel), if any —
  // deliberately generic rather than reaching for a tool-specific pane
  // selector, since this module is shared by Press and Workbench and each
  // has its own inspector panel structure. Falls back to the viewport
  // itself, which already covers the common case of a sidebar that simply
  // runs to the window's own edge with nothing narrower clipping it first.
  // `edge` is "right" or "bottom" — the only two directions this popover
  // ever needs to flip away from, since it always anchors top-left of its
  // swatch to start with.
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

  // Default anchor is flush with the swatch's left edge, just below it
  // (popover's own `left: 0`/`top: calc(100% + 0.375rem)` in shell.css).
  // Both edges are checked independently and flipped whichever way
  // actually fits — a field near the bottom of a scrollable panel has
  // exactly the same problem vertically that a field near the right edge
  // (Border, the rightmost of the three/four in the Colors grid) already
  // had horizontally; both get the same treatment here, not just one.
  // Measured after unhiding (getBoundingClientRect needs real layout), and
  // only overridden when it actually doesn't fit — most fields never need
  // this.
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
