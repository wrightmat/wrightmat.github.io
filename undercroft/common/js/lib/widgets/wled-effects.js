// WLED effect metadata — /json/fxdata gives one string per effect describing
// which controls that effect actually uses:
//   `<sliders/options>;<colors>;<palette>;<flags>;<defaults>`
// A MISSING section means "the usual" (speed + intensity, three colors, a
// palette); an EMPTY one means "none". Palette and colors are independent
// segment fields in the API — this is only what the effect makes use of — so
// the editor dims what an effect ignores rather than discarding it.
export const EFFECT_PARAM_KEYS = ["sx", "ix", "c1", "c2", "c3", "o1", "o2", "o3"];
export const EFFECT_PARAM_LABELS = {
  sx: "Speed",
  ix: "Intensity",
  c1: "Custom 1",
  c2: "Custom 2",
  c3: "Custom 3",
  o1: "Option 1",
  o2: "Option 2",
  o3: "Option 3",
};
const COLOR_SLOT_LABELS = ["Primary", "Secondary", "Tertiary"];

// The sliders run 0–255 except the third custom slider (0–31); the first five
// keys are sliders, the last three on/off options.
export function effectControl(key, label = EFFECT_PARAM_LABELS[key]) {
  return { key, label, kind: key.startsWith("o") ? "check" : "slider", max: key === "c3" ? 31 : 255 };
}

export function parseEffectMeta(raw) {
  if (typeof raw !== "string") return null;
  const parts = raw.split(";");
  const paramLabels = parts[0] === undefined ? ["!", "!"] : parts[0].split(",");
  const controls = [];
  EFFECT_PARAM_KEYS.forEach((key, index) => {
    const label = (paramLabels[index] ?? "").trim();
    if (label) controls.push(effectControl(key, label === "!" ? EFFECT_PARAM_LABELS[key] : label));
  });
  const colorLabels = parts[1] === undefined ? ["!", "!", "!"] : parts[1].split(",");
  const colors = COLOR_SLOT_LABELS.map((fallback, index) => {
    const label = (colorLabels[index] ?? "").trim();
    return { used: Boolean(label), label: label && label !== "!" ? label : fallback };
  });
  const defaults = {};
  String(parts[4] ?? "")
    .split(",")
    .forEach((pair) => {
      const [name, value] = pair.split("=");
      const number = Number(value);
      if (name && value !== undefined && Number.isFinite(number)) defaults[name.trim()] = number;
    });
  return { controls, colors, usesPalette: parts[2] === undefined || parts[2].trim() !== "", defaults };
}
