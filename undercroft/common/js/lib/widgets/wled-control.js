// The one control for steering a WLED light — used by the Lighting card, the
// Macro editor, Table Lighting, and the Home Assistant light card, so every
// place that edits "what a light does" looks and behaves the same. It is a
// pure VALUE editor: it renders the value, reports changes, and never talks
// to a device or saves anything itself — each host decides what a change
// means (send it now, store it in a macro, feed a scene).
//
// The value is flat; every key is optional:
//   segments  string[]  the picked segment (one) — the `target` section
//   segmentId number    a segment entered by id instead — `target`
//   exclusive boolean   also switch the other segments off — `target`
//   power     boolean   on/off — the `power` section
//   preset    number    a saved device preset — the `preset` section
//   fx, pal, col[], bri, sx, ix, c1, c2, c3, o1, o2, o3   — the `look` section
// (see wled.js's buildLookEntry for how a look is sent).
//
// Hosts switch on only the sections they need:
//   target  {noneLabel, label, exclusive, exclusiveLabel}
//   power   {style: "button"|"checkbox", label}
//   preset  true
//   look    {effect, palette, colors (0–3), brightness, effectOptions}
//
// Every host gets the SAME order and behavior: power + brightness, then
// effect/palette/colors, then the effect's own settings (a collapsible
// section, closed until opened), then the preset and segment pickers.
// `stateKey` names the spot a control sits in (the card, one segment's
// look…) so its Effect settings stay open or closed across the host's
// re-renders, which rebuild the control on every change.
//
// Two modes. "optional": fields other than colors can be unset (a select's
// blank option, a "Set" box on a slider) and an unset field sends nothing.
// "live": the control reflects a device, so those fields always have a value.
// Colors work the SAME in both: each slot is a color or cleared (✕), and a
// cleared slot is black — see normalizeSlot.
//
// Which palette, colors, and sliders an effect actually uses comes from its
// metadata (choices.effectMeta, from /json/fxdata). Controls an effect ignores
// are DIMMED, never hidden or discarded, so a saved value is always visible.
import { el } from "../dom.js";
import { createColorPickerField } from "../color-picker.js";
import { createCollapseToggleButton, setElementCollapsed } from "../collapsible.js";
import { createCheck, fillChoiceSelect, MIN_BRIGHTNESS } from "./wled-look-fields.js";
import { EFFECT_PARAM_KEYS, effectControl } from "./wled-effects.js";

// What an effect without metadata is assumed to offer.
const FALLBACK_CONTROLS = [effectControl("sx"), effectControl("ix")];

function hasNumber(value) {
  return value !== undefined && value !== null && value !== "" && Number.isFinite(Number(value));
}

function makeSelect() {
  const select = document.createElement("select");
  select.className = "form-select form-select-sm";
  return select;
}

// A labeled control that can sit beside others and wrap below ~9rem.
function field(labelText, control, basis = "9rem") {
  const wrap = el("div", "d-flex flex-column gap-1");
  wrap.style.flex = `1 1 ${basis}`;
  wrap.style.minWidth = "0";
  if (labelText) wrap.appendChild(el("label", "form-label small mb-0 text-body-secondary", labelText));
  wrap.appendChild(control);
  return wrap;
}

// [Set] [——slider——] 42% — in "optional" mode the Set box turns the field on
// or off; in "live" mode there's no box and the slider is always active.
function createSlider({ min, max, value, optional, format, ariaLabel, unsetValue, onChange }) {
  const has = hasNumber(value);
  const range = document.createElement("input");
  range.type = "range";
  range.min = String(min);
  range.max = String(max);
  range.value = String(has ? Math.max(min, Math.min(max, Number(value))) : unsetValue);
  range.disabled = optional && !has;
  range.className = "form-range flex-grow-1";
  range.setAttribute("aria-label", ariaLabel);
  const readout = el("span", "small text-body-secondary text-end", format(range.value));
  readout.style.minWidth = "2.5rem";
  range.addEventListener("input", () => {
    readout.textContent = format(range.value);
  });
  // "change", not "input" — a host that rebuilds on every change would drop the drag mid-slide.
  range.addEventListener("change", () => onChange(Number(range.value)));
  const wrap = el("div", "d-flex align-items-center gap-2");
  if (optional) {
    wrap.appendChild(
      createCheck("Set", has, (checked) => {
        range.disabled = !checked;
        onChange(checked ? Number(range.value) : undefined);
      })
    );
  }
  wrap.append(range, readout);
  return wrap;
}

const openEffectSettings = new Set();

// A color slot is a color or cleared — black isn't a color here (a LED can't
// show it, and it's how WLED holds "no color"), so black reads as cleared
// everywhere: shown as ✕, and sent as black. Returns "#rrggbb" or "" (cleared).
function normalizeSlot(hex) {
  const match = /^#?([0-9a-f]{6})$/i.exec(hex || "");
  return match && match[1] !== "000000" ? `#${match[1].toLowerCase()}` : "";
}
// The segment select's last option, which asks for a segment id by number.
const ENTER_SEGMENT_ID = "__enter-segment-id__";
const SEGMENT_ID_PREFIX = "id:";

export function createWledControl({ value = {}, onChange, loadChoices, mode = "optional", sections = {}, labels = {}, stateKey = "" } = {}) {
  const live = mode === "live";
  const target = sections.target || null;
  const power = sections.power || null;
  const withPreset = Boolean(sections.preset);
  const look = sections.look
    ? { effect: true, palette: true, colors: 3, brightness: true, effectOptions: true, ...(sections.look === true ? {} : sections.look) }
    : null;

  let current = { ...value };
  let choices = {};
  let choicesFailed = false;
  const emit = (patch) => {
    current = { ...current, ...patch };
    Object.keys(current).forEach((key) => {
      if (current[key] === undefined || current[key] === "") delete current[key];
    });
    onChange?.({ ...current }, patch);
  };

  const currentMeta = () => (hasNumber(current.fx) ? choices.effectMeta?.[Number(current.fx)] || null : null);

  const root = el("div", "d-flex flex-column gap-2");
  const selects = {}; // refilled when the device's choices arrive

  // --- target ---------------------------------------------------------------
  // One segment, picked from a select. A segment the list doesn't offer (an
  // unnamed one, or an id from another device) is entered by number through
  // the last option, and kept as `segmentId` — separate from `segments`,
  // which holds a listed segment's value.
  let targetField = null;
  let exclusiveRow = null;
  if (target) {
    const select = makeSelect();
    selects.segments = select;
    select.addEventListener("change", () => {
      if (select.value === ENTER_SEGMENT_ID) {
        const raw = window.prompt("Segment id (a number, 0 or higher):", hasNumber(current.segmentId) ? String(current.segmentId) : "");
        const id = raw === null ? Number.NaN : Number.parseInt(raw, 10);
        if (Number.isInteger(id) && id >= 0) emit({ segments: undefined, segmentId: id });
        fillSegments(); // shows the entered id, or restores the previous choice
        return;
      }
      if (select.value.startsWith(SEGMENT_ID_PREFIX)) return; // the already-entered id, chosen again
      emit({ segments: select.value ? [select.value] : undefined, segmentId: undefined });
    });
    targetField = field(target.label || "Segment", select, "9rem");
    if (target.exclusive) {
      exclusiveRow = createCheck(target.exclusiveLabel || "Turn the device's other segments off", Boolean(current.exclusive), (checked) =>
        emit({ exclusive: checked })
      );
    }
  }
  function fillSegments() {
    const select = selects.segments;
    if (!select) return;
    const options = [...(choices.segments || [])];
    const listed = Array.isArray(current.segments) && current.segments[0] ? String(current.segments[0]) : "";
    const enteredId = !listed && hasNumber(current.segmentId) ? `${SEGMENT_ID_PREFIX}${Number(current.segmentId)}` : "";
    if (enteredId) options.push({ value: enteredId, label: `Segment id ${Number(current.segmentId)}` });
    options.push({ value: ENTER_SEGMENT_ID, label: "Enter a segment id…" });
    fillChoiceSelect(select, { blank: target.noneLabel || "No segment", options, current: listed || enteredId });
  }

  // --- power ----------------------------------------------------------------
  let powerButton = null;
  let powerCheckbox = null;
  if (power) {
    if (power.style === "button") {
      powerButton = el("button", "btn btn-sm");
      powerButton.type = "button";
      const paintPower = () => {
        powerButton.className = `btn btn-sm ${current.power ? "btn-primary" : "btn-outline-secondary"}`;
        powerButton.textContent = current.power ? "On" : "Off";
      };
      paintPower();
      powerButton.addEventListener("click", () => {
        emit({ power: !current.power });
        paintPower();
      });
    } else {
      powerCheckbox = createCheck(power.label || "Turn the light on", Boolean(current.power), (checked) => emit({ power: checked }));
    }
  }

  // --- preset ---------------------------------------------------------------
  let presetField = null;
  if (withPreset) {
    const select = makeSelect();
    selects.preset = select;
    select.addEventListener("change", () => emit({ preset: select.value === "" ? undefined : Number(select.value) }));
    presetField = field(labels.presetLabel || "Preset", select, "9rem");
  }
  const fillPreset = () => {
    if (!selects.preset) return;
    fillChoiceSelect(selects.preset, {
      blank: labels.presetBlank || "Select a preset…",
      options: (choices.presets || []).map(({ id, name }) => ({ value: String(id), label: name })),
      current: hasNumber(current.preset) ? String(current.preset) : "",
    });
  };

  // --- look: effect | palette ---------------------------------------------------
  let effectPaletteRow = null;
  let effectOptionsMount = null;
  let effectOptionsSection = null; // the collapsible wrapper, when there is one
  let colorsMount = null;
  let brightnessRow = null;
  if (look) {
    if (look.effect || look.palette) {
      effectPaletteRow = el("div", "d-flex flex-wrap gap-2");
      if (look.effect) {
        const select = makeSelect();
        selects.fx = select;
        select.addEventListener("change", () => {
          const fx = select.value === "" ? undefined : Number(select.value);
          const patch = { fx };
          // Picking an effect shows — and saves — that effect's own defaults
          // (speed, intensity, palette…), so what's applied is what's visible;
          // anything the old effect had set that the new one doesn't default
          // is cleared in "optional" mode.
          const meta = fx === undefined ? null : choices.effectMeta?.[fx] || null;
          if (meta) {
            EFFECT_PARAM_KEYS.forEach((key) => {
              if (meta.defaults[key] !== undefined) patch[key] = key.startsWith("o") ? meta.defaults[key] !== 0 : meta.defaults[key];
              else if (!live) patch[key] = undefined;
            });
            if (meta.usesPalette && meta.defaults.pal !== undefined) patch.pal = meta.defaults.pal;
          }
          emit(patch);
          fillPalette();
          renderDependent();
        });
        effectPaletteRow.appendChild(field("Effect", select));
      }
      if (look.palette) {
        const select = makeSelect();
        selects.pal = select;
        select.addEventListener("change", () => emit({ pal: select.value === "" ? undefined : Number(select.value) }));
        effectPaletteRow.appendChild(field("Palette", select));
      }
    }
    if (look.colors > 0) colorsMount = el("div", "d-flex flex-wrap align-items-center gap-2");
    if (look.effectOptions) {
      effectOptionsMount = el("div", "d-flex flex-wrap gap-2");
      // An "Effect settings" header with a chevron, closed until opened.
      const open = Boolean(stateKey) && openEffectSettings.has(stateKey);
      const { button } = createCollapseToggleButton({
        label: "effect settings",
        collapsed: !open,
        onToggle: (collapsed) => {
          setElementCollapsed(effectOptionsMount, collapsed);
          if (!stateKey) return;
          if (collapsed) openEffectSettings.delete(stateKey);
          else openEffectSettings.add(stateKey);
        },
      });
      setElementCollapsed(effectOptionsMount, !open);
      const header = el("div", "d-flex align-items-center gap-1");
      header.append(button, el("span", "small fw-semibold text-body-secondary", "Effect settings"));
      effectOptionsSection = el("div", "d-flex flex-column gap-1");
      effectOptionsSection.append(header, effectOptionsMount);
    }
    if (look.brightness) {
      const slider = createSlider({
        min: MIN_BRIGHTNESS,
        max: 255,
        value: current.bri,
        optional: !live,
        format: (raw) => `${Math.round((Number(raw) / 255) * 100)}%`,
        ariaLabel: "Brightness",
        unsetValue: 255,
        onChange: (bri) => emit({ bri }),
      });
      if (powerButton) {
        // The On/Off button leads the brightness row, as it does on the Lighting card.
        brightnessRow = el("div", "d-flex align-items-center gap-2");
        slider.classList.add("flex-grow-1");
        brightnessRow.append(powerButton, slider);
      } else {
        brightnessRow = field("Brightness", slider, "auto");
      }
    }
  }
  const fillPalette = () => {
    const select = selects.pal;
    if (!select) return;
    const meta = currentMeta();
    fillChoiceSelect(select, {
      blank: blankForLive(labels.paletteBlank || "Leave unchanged"),
      options: (choices.palettes || []).map((name, index) => ({ value: String(index), label: name })),
      current: hasNumber(current.pal) ? String(current.pal) : "",
    });
    const unused = Boolean(meta && !meta.usesPalette);
    select.disabled = unused;
    select.title = unused ? "This effect doesn't use a palette." : "";
  };
  function blankForLive(blank) {
    return live ? null : blank;
  }
  const fillEffect = () => {
    if (!selects.fx) return;
    fillChoiceSelect(selects.fx, {
      blank: blankForLive(labels.effectBlank || "Leave unchanged"),
      options: (choices.effects || []).map((name, index) => ({ value: String(index), label: name })),
      current: hasNumber(current.fx) ? String(current.fx) : "",
    });
  };

  // The parts that depend on the selected effect: which colors are in use,
  // and which effect-specific sliders/options exist.
  function renderDependent() {
    const meta = currentMeta();
    if (colorsMount) {
      colorsMount.innerHTML = "";
      const slotLabels = ["Primary color", "Secondary color", "Tertiary color"];
      for (let slot = 0; slot < look.colors; slot += 1) {
        const slotMeta = meta?.colors?.[slot];
        const labelText = slotMeta?.label ? `${slotMeta.label} color` : slotLabels[slot];
        const picker = createColorPickerField(labelText, {
          value: normalizeSlot(current.col?.[slot]),
          defaultValue: "#ffffff",
          hexOnly: true,
          compact: true,
          onManualChange: (hex) => setColor(slot, hex),
          onClear: () => setColor(slot, ""),
        });
        if (slotMeta && !slotMeta.used) picker.setDisabled(true, `${labelText}: this effect doesn't use it.`);
        colorsMount.appendChild(picker);
      }
    }
    if (effectOptionsMount) {
      effectOptionsMount.innerHTML = "";
      // What the effect defines — or the usual speed/intensity when there's
      // no metadata to go by (none loaded, or no effect picked yet while the
      // metadata is simply unavailable).
      const defined = meta ? meta.controls : choices.effectMeta === null || choicesFailed ? FALLBACK_CONTROLS : [];
      const controls = defined.map((control) => ({ control, unused: false }));
      // A saved value the effect doesn't define is still shown, dimmed —
      // never hidden.
      EFFECT_PARAM_KEYS.forEach((key) => {
        if (current[key] !== undefined && !defined.some((control) => control.key === key)) {
          controls.push({ control: effectControl(key), unused: true });
        }
      });
      controls.forEach(({ control, unused }) => {
        let built;
        if (control.kind === "slider") {
          built = field(
            control.label,
            createSlider({
              min: 0,
              max: control.max,
              value: current[control.key],
              optional: !live,
              format: (raw) => String(raw),
              ariaLabel: control.label,
              unsetValue: Math.round(control.max / 2),
              onChange: (number) => emit({ [control.key]: number }),
            }),
            "11rem"
          );
        } else if (live) {
          built = createCheck(control.label, current[control.key] === true, (checked) => emit({ [control.key]: checked }));
        } else {
          // Three states, so "leave it alone" stays distinct from "off".
          const select = makeSelect();
          fillChoiceSelect(select, {
            blank: "Leave unchanged",
            options: [
              { value: "on", label: "On" },
              { value: "off", label: "Off" },
            ],
            current: typeof current[control.key] === "boolean" ? (current[control.key] ? "on" : "off") : "",
          });
          select.addEventListener("change", () => emit({ [control.key]: select.value === "" ? undefined : select.value === "on" }));
          built = field(control.label, select, "9rem");
        }
        if (unused) {
          built.style.opacity = "0.4";
          built.title = `${control.label}: this effect doesn't use it.`;
        }
        effectOptionsMount.appendChild(built);
      });
      // No settings (or none loaded yet) — no empty header either.
      effectOptionsSection?.classList.toggle("d-none", !effectOptionsMount.children.length);
    }
  }
  function setColor(slot, hex) {
    const slots = Array.from({ length: look.colors }, (_, index) => normalizeSlot(index === slot ? hex : current.col?.[index]));
    emit({ col: slots });
    // Rebuilt so a swatch just set to black shows as cleared.
    renderDependent();
  }

  // --- assemble ---------------------------------------------------------------
  // The one order, for every host: power and brightness; then the preset and
  // segment that choose WHICH LEDs; then the effect, palette and colors
  // applied to them; then the effect's own settings.
  const rows = [];
  if (powerButton && !brightnessRow) {
    // Wrapped so a lone button keeps its natural width instead of stretching.
    const powerRow = el("div", "d-flex");
    powerRow.appendChild(powerButton);
    rows.push(powerRow);
  }
  if (powerCheckbox) rows.push(powerCheckbox);
  rows.push(brightnessRow);
  // Preset and segment share a row (side by side, wrapping when narrow).
  if (presetField || targetField) {
    const pickerRow = el("div", "d-flex flex-wrap gap-2");
    if (presetField) pickerRow.appendChild(presetField);
    if (targetField) pickerRow.appendChild(targetField);
    rows.push(pickerRow);
  }
  rows.push(exclusiveRow, effectPaletteRow, colorsMount, effectOptionsSection);
  rows.filter(Boolean).forEach((row) => root.appendChild(row));

  // Show the saved values at once; the full option lists fill in when the
  // device answers (a saved value the list lacks stays selectable).
  fillSegments();
  fillPreset();
  fillEffect();
  fillPalette();
  renderDependent();
  Promise.resolve(loadChoices?.())
    .then((loaded) => {
      choices = loaded || {};
      fillSegments();
      fillPreset();
      fillEffect();
      fillPalette();
      renderDependent();
    })
    .catch((error) => {
      choicesFailed = true;
      renderDependent();
      const reason = error?.message ? `${error.message} Showing saved values.` : "Couldn't load this device's options — showing saved values.";
      root.appendChild(el("span", "small text-body-secondary", reason));
    });

  return root;
}
