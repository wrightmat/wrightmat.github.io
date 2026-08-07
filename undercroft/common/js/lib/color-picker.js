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

  // Hex input + Accept share one row — Accept applies to whatever this
  // popover currently has staged (a dragged/typed color, or a typed
  // binding/formula below), so it reads naturally as "confirm the value
  // shown here," not as a color-only control tucked off on its own.
  const hexRow = document.createElement("div");
  hexRow.className = "d-flex align-items-center gap-2";
  const hexLabel = document.createElement("span");
  hexLabel.className = "text-body-secondary extra-small";
  hexLabel.textContent = "Hex";
  const hexInput = document.createElement("input");
  hexInput.type = "text";
  hexInput.className = "form-control form-control-sm flex-grow-1";
  hexInput.autocomplete = "off";
  hexInput.spellcheck = false;
  const acceptButton = document.createElement("button");
  acceptButton.type = "button";
  acceptButton.className = "btn btn-primary btn-sm color-picker-accept flex-shrink-0";
  acceptButton.innerHTML = '<span class="iconify" data-icon="tabler:check" aria-hidden="true"></span>';
  acceptButton.setAttribute("aria-label", `Accept ${labelText.toLowerCase()} color`);
  hexRow.append(hexLabel, hexInput, acceptButton);

  const bindingWrap = document.createElement("div");
  bindingWrap.className = "d-flex flex-column gap-1 color-picker-binding";
  const bindingLabel = document.createElement("label");
  bindingLabel.className = "form-label extra-small text-body-secondary mb-0";
  bindingLabel.textContent = "Binding / formula";
  const bindingInput = document.createElement("input");
  bindingInput.type = "text";
  bindingInput.className = "form-control form-control-sm";
  bindingInput.placeholder = placeholder;
  bindingInput.autocomplete = "off";
  bindingInput.spellcheck = false;
  bindingWrap.append(bindingLabel, bindingInput);

  // The only clear affordance now — there used to ALSO be an icon-only
  // button next to the swatch itself, outside the popover entirely, which
  // turned out not to be obvious as a "clear" action at a glance. One
  // button, inside the popover, with both a visible label and a tooltip.
  const clearRow = document.createElement("div");
  clearRow.className = "d-flex justify-content-end pt-1";
  const clearButton = document.createElement("button");
  clearButton.type = "button";
  clearButton.className = "btn btn-outline-secondary btn-sm";
  clearButton.innerHTML = `<span class="iconify" data-icon="tabler:circle-off" aria-hidden="true"></span> Clear`;
  clearButton.title = `Clear ${labelText.toLowerCase()}`;
  clearButton.setAttribute("aria-label", `Clear ${labelText.toLowerCase()}`);
  clearRow.appendChild(clearButton);

  popover.append(svSquare, hueSlider, hexRow, bindingWrap, clearRow);
  swatchWrap.appendChild(popover);

  // ---- State ----

  let hsv = hexToHsv(value) || hexToHsv(defaultValue) || { h: 0, s: 0, v: 0 };
  // The last value this field actually committed (Accept, Enter, or
  // closing the popover — see commitCurrent) — distinct from the `value`/
  // `bindingValue` this field was created with, since a host that doesn't
  // rebuild this widget on every committed change (Press's manual color
  // handler doesn't; see that tool's own comment) would otherwise leave
  // those stale after the very first commit. Everything that needs "what's
  // actually committed right now" (the unset-X overlay, discarding a
  // cancelled Escape) reads these instead of the closure parameters.
  let committedHex = normalizeHex(value) || null;
  let committedBinding = bindingValue || "";
  let hasManualValue = Boolean(committedHex);
  // Set by any actual edit (drag, hex typing, binding typing); cleared on
  // open and after every commit. Lets commitCurrent() no-op on a plain
  // open-then-click-away with nothing touched, instead of writing an
  // unchanged value and pushing a no-op undo entry every time someone
  // glances at a swatch.
  let dirty = false;
  let isOpen = false;

  function hasBindingContent() {
    return bindingInput.value.trim().length > 0;
  }

  // Renders the swatch/hex/indicator from whatever is currently the
  // "effective" color — the literal hsv-derived hex while unbound, or
  // evaluate()'s live result while a binding/formula is active. Never
  // invents a color of its own: an unresolved binding/formula shows the
  // same unset/indeterminate treatment the rest of this inspector already
  // uses for "nothing is actually set," not a guessed hex. Called on every
  // drag/hex-input/binding-input frame purely for this LOCAL preview —
  // nothing here writes to the actual data (see commitCurrent for the only
  // path that does).
  function render() {
    const bound = hasBindingContent();
    svSquare.classList.toggle("disabled", bound);
    hueSlider.classList.toggle("disabled", bound);
    hexInput.disabled = bound;
    let effectiveHex = hsvToHex(hsv);
    let isSet = true;
    let indeterminate = false;
    if (bound) {
      const result = typeof evaluate === "function" ? evaluate(bindingInput.value.trim()) : undefined;
      if (result === undefined) {
        indeterminate = true;
        isSet = false;
      } else {
        const normalized = normalizeHex(result);
        if (normalized) {
          effectiveHex = normalized;
        } else {
          indeterminate = true;
          isSet = false;
        }
      }
    } else {
      isSet = hasManualValue;
    }
    swatch.style.backgroundColor = effectiveHex;
    wrapper.classList.toggle("template-color-control--unset", !isSet && !indeterminate);
    wrapper.classList.toggle("color-picker-indeterminate", indeterminate);
    hexInput.value = bound ? effectiveHex : (isSet ? effectiveHex : "");
    hexInput.placeholder = bound ? "" : defaultValue;
    const { h, s, v } = hsv;
    svSquare.style.setProperty("--color-picker-hue", String(h));
    svIndicator.style.left = `${s}%`;
    svIndicator.style.top = `${100 - v}%`;
    hueHandle.style.left = `${(h / 360) * 100}%`;
  }

  // Local-only: updates hsv and re-renders the popover's own preview
  // (swatch included) without writing anything to the actual data — see
  // commitCurrent for the only thing that actually does that.
  function previewManual() {
    hasManualValue = true;
    dirty = true;
    render();
  }

  // The only two things that actually write to the host's data —
  // commitCurrent below decides which applies and is the only caller of
  // either. Never invoked directly from a drag/typing frame.
  function commitManualColor() {
    const hex = hsvToHex(hsv);
    committedHex = hex;
    if (typeof onManualChange === "function") onManualChange(hex);
  }
  function commitBindingText() {
    const raw = bindingInput.value.trim();
    committedBinding = raw;
    if (typeof onBindingChange === "function") onBindingChange(raw);
  }

  // The one place anything gets committed — Accept, Enter (in either the
  // hex or binding box), and closing the popover by any means other than
  // Escape all funnel through this. A binding box with real text (or one
  // that HAD committed text and has now been typed down to empty, which is
  // a real "clear the binding" edit) always wins over the manual color,
  // matching hasBindingContent()'s own manual-controls-disabled rule in
  // render(). A no-op open-then-close (nothing actually touched) commits
  // nothing at all — see `dirty`'s own comment.
  function commitCurrent() {
    if (!dirty) return;
    const currentBinding = bindingInput.value.trim();
    if (currentBinding || committedBinding) {
      commitBindingText();
    } else {
      commitManualColor();
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
    previewManual();
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
    if (hasBindingContent()) return;
    event.preventDefault();
    updateSvFromEvent(event);
    document.addEventListener("mousemove", onSvPointerMove);
    document.addEventListener("mouseup", onSvPointerUp);
  });
  svSquare.addEventListener("touchstart", (event) => {
    if (hasBindingContent()) return;
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
    previewManual();
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
    if (hasBindingContent()) return;
    event.preventDefault();
    updateHueFromEvent(event);
    document.addEventListener("mousemove", onHuePointerMove);
    document.addEventListener("mouseup", onHuePointerUp);
  });
  hueSlider.addEventListener("touchstart", (event) => {
    if (hasBindingContent()) return;
    updateHueFromEvent(event);
    document.addEventListener("touchmove", onHuePointerMove, { passive: false });
    document.addEventListener("touchend", onHuePointerUp);
  });

  // ---- Hex text input ----

  hexInput.addEventListener("input", () => {
    const normalized = normalizeHex(hexInput.value);
    if (!normalized) return;
    hsv = hexToHsv(normalized) || hsv;
    previewManual();
  });
  // Enter is a shortcut for "commit and close" (same as Accept) — a
  // deliberate one-shot confirm, not a second code path.
  hexInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      commitAndClose();
    }
  });

  // ---- Binding/formula input ----

  bindingInput.value = bindingValue || "";
  // Typing here only ever updates the LOCAL preview (render() evaluates
  // whatever's currently typed, live) — it used to call onBindingChange on
  // every keystroke, which committed a change on every keystroke, which is
  // exactly the same "a commit is the host's cue to re-render, and
  // re-rendering while you're still typing tears this popover down and
  // rebuilds it mid-edit" problem the manual color drag had. Only
  // commitCurrent (Accept, Enter, or closing) actually writes it out.
  bindingInput.addEventListener("input", () => {
    dirty = true;
    render();
  });
  bindingInput.addEventListener("keydown", (event) => {
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
    bindingInput.value = "";
    if (typeof onBindingChange === "function") onBindingChange("");
    if (typeof onClear === "function") onClear();
    committedHex = null;
    committedBinding = "";
    hasManualValue = false;
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
    hsv = hexToHsv(committedHex) || hexToHsv(defaultValue) || hsv;
    hasManualValue = Boolean(committedHex);
    bindingInput.value = committedBinding;
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
