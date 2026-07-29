// Pure SVG-string generators for the pattern/shape picker — no DOM
// dependency, so this can be unit-reasoned-about and reused by both the
// modal's live thumbnails/preview and the final "Insert" write into an
// image node's url. Every preset is recolorable (1-3 color slots) and a
// few also take small numeric params (angle, spacing, point count, etc.).
// Shared by Press (its own Image component) and Workbench (ported into its
// own Image component) — promoted here rather than kept as a Press-only
// file so both stay byte-for-byte identical instead of drifting.

function polygonPoints(cx, cy, r, sides, rotationDeg = -90) {
  const points = [];
  for (let i = 0; i < sides; i += 1) {
    const angle = (Math.PI * 2 * i) / sides + (rotationDeg * Math.PI) / 180;
    points.push(`${(cx + r * Math.cos(angle)).toFixed(1)},${(cy + r * Math.sin(angle)).toFixed(1)}`);
  }
  return points.join(" ");
}

function starPoints(cx, cy, outerR, innerR, points) {
  const coords = [];
  const step = Math.PI / points;
  for (let i = 0; i < points * 2; i += 1) {
    const r = i % 2 === 0 ? outerR : innerR;
    const angle = i * step - Math.PI / 2;
    coords.push(`${(cx + r * Math.cos(angle)).toFixed(1)},${(cy + r * Math.sin(angle)).toFixed(1)}`);
  }
  return coords.join(" ");
}

// A viewBox-only <svg> (no width/height attributes) hits a real browser
// quirk where object-fit ("contain" especially, but this user report shows
// "fill" isn't reliable either) doesn't compute against a well-defined
// intrinsic size — every generated preset must declare explicit width/height
// matching its viewBox so object-fit has an unambiguous box to work from.
//
// preserveAspectRatio='none' is the actual fix for "fill" specifically: SVG
// has its own internal scaling instruction (default "xMidYMid meet" — fit
// and center, preserving aspect ratio) that's entirely separate from the
// outer CSS object-fit. When the browser hands the SVG a viewport whose
// aspect ratio doesn't match its viewBox (which is exactly what "fill" does
// whenever the target box's proportions differ from the artwork's), that
// internal default can still letterbox on top of object-fit's own decision
// — disabling it here makes object-fit the sole authority over fitting, for
// every preset, regardless of which fit mode is chosen downstream.
function svgOpen(width, height) {
  return `<svg xmlns='http://www.w3.org/2000/svg' width='${width}' height='${height}' viewBox='0 0 ${width} ${height}' preserveAspectRatio='none'>`;
}

export const PATTERN_CATEGORIES = [
  { id: "fills", label: "Fills" },
  { id: "patterns", label: "Patterns" },
  { id: "banners", label: "Banners" },
  { id: "shapes", label: "Shapes" },
];

export const PATTERN_PRESETS = [
  // Fills
  {
    id: "solid-fill",
    category: "fills",
    label: "Solid color",
    colorSlots: [{ key: "fill", label: "Color", default: "#4b3f72" }],
    buildSvg: (v) => `${svgOpen(200, 200)}<rect width='200' height='200' fill='${v.fill}'/></svg>`,
  },
  {
    id: "linear-gradient",
    category: "fills",
    label: "Linear gradient",
    colorSlots: [
      { key: "color1", label: "Start color", default: "#4b3f72" },
      { key: "color2", label: "End color", default: "#182848" },
    ],
    params: [{ key: "angle", label: "Angle", type: "number", default: 135, min: 0, max: 360, step: 1 }],
    buildSvg: (v) => {
      const rad = (Number(v.angle) * Math.PI) / 180;
      const x1 = (50 - 50 * Math.cos(rad)).toFixed(1);
      const y1 = (50 - 50 * Math.sin(rad)).toFixed(1);
      const x2 = (50 + 50 * Math.cos(rad)).toFixed(1);
      const y2 = (50 + 50 * Math.sin(rad)).toFixed(1);
      return `${svgOpen(200, 200)}<defs><linearGradient id='g' x1='${x1}%' y1='${y1}%' x2='${x2}%' y2='${y2}%'><stop offset='0' stop-color='${v.color1}'/><stop offset='1' stop-color='${v.color2}'/></linearGradient></defs><rect width='200' height='200' fill='url(#g)'/></svg>`;
    },
  },
  {
    id: "radial-gradient",
    category: "fills",
    label: "Radial gradient",
    colorSlots: [
      { key: "color1", label: "Center color", default: "#6a5acd" },
      { key: "color2", label: "Edge color", default: "#1a1a2e" },
    ],
    buildSvg: (v) =>
      `${svgOpen(200, 200)}<defs><radialGradient id='g' cx='50%' cy='50%' r='70%'><stop offset='0' stop-color='${v.color1}'/><stop offset='1' stop-color='${v.color2}'/></radialGradient></defs><rect width='200' height='200' fill='url(#g)'/></svg>`,
  },

  // Patterns (tileable, via a <pattern> tile covering the whole viewBox)
  {
    id: "stripes",
    category: "patterns",
    label: "Stripes",
    colorSlots: [
      { key: "color1", label: "Stripe color", default: "#d4af37" },
      { key: "color2", label: "Background", default: "#1a1a1a" },
    ],
    params: [
      { key: "width", label: "Stripe width", type: "number", default: 10, min: 2, max: 40, step: 1 },
      { key: "angle", label: "Angle", type: "number", default: 45, min: 0, max: 180, step: 1 },
    ],
    buildSvg: (v) => {
      const w = Number(v.width);
      const size = w * 2;
      return `${svgOpen(200, 200)}<defs><pattern id='p' width='${size}' height='${size}' patternTransform='rotate(${Number(v.angle)})' patternUnits='userSpaceOnUse'><rect width='${size}' height='${size}' fill='${v.color2}'/><rect width='${w}' height='${size}' fill='${v.color1}'/></pattern></defs><rect width='200' height='200' fill='url(#p)'/></svg>`;
    },
  },
  {
    id: "ruled-lines",
    category: "patterns",
    label: "Ruled lines",
    colorSlots: [
      // Matches the old fixed noteLines component's own look (a faint
      // 8%-opacity line on a transparent background) as the default, so
      // swapping to this preset for the same use case (ruled space for
      // handwriting) looks the same out of the box — fully configurable
      // from there.
      { key: "line", label: "Line color", default: "#00000014" },
      { key: "background", label: "Background", default: "#00000000" },
    ],
    params: [
      { key: "thickness", label: "Line thickness", type: "number", default: 1, min: 1, max: 10, step: 1 },
      { key: "spacing", label: "Line spacing", type: "number", default: 20, min: 6, max: 80, step: 1 },
      {
        key: "orientation",
        label: "Orientation",
        type: "select",
        default: "horizontal",
        options: [
          { value: "horizontal", label: "Horizontal" },
          { value: "vertical", label: "Vertical" },
        ],
      },
    ],
    buildSvg: (v) => {
      const thickness = Number(v.thickness);
      const spacing = Math.max(thickness, Number(v.spacing));
      const horizontal = v.orientation !== "vertical";
      const tileWidth = horizontal ? 200 : spacing;
      const tileHeight = horizontal ? spacing : 200;
      const lineRect = horizontal
        ? `<rect width='200' height='${thickness}' fill='${v.line}'/>`
        : `<rect width='${thickness}' height='200' fill='${v.line}'/>`;
      return `${svgOpen(200, 200)}<defs><pattern id='p' width='${tileWidth}' height='${tileHeight}' patternUnits='userSpaceOnUse'><rect width='${tileWidth}' height='${tileHeight}' fill='${v.background}'/>${lineRect}</pattern></defs><rect width='200' height='200' fill='url(#p)'/></svg>`;
    },
  },
  {
    id: "polka-dots",
    category: "patterns",
    label: "Polka dots",
    colorSlots: [
      { key: "color1", label: "Dot color", default: "#ffffff" },
      { key: "color2", label: "Background", default: "#2b6cb0" },
    ],
    params: [
      { key: "size", label: "Dot size", type: "number", default: 6, min: 2, max: 20, step: 1 },
      { key: "spacing", label: "Spacing", type: "number", default: 24, min: 10, max: 60, step: 1 },
    ],
    buildSvg: (v) => {
      const spacing = Number(v.spacing);
      const half = (spacing / 2).toFixed(1);
      return `${svgOpen(200, 200)}<defs><pattern id='p' width='${spacing}' height='${spacing}' patternUnits='userSpaceOnUse'><rect width='${spacing}' height='${spacing}' fill='${v.color2}'/><circle cx='${half}' cy='${half}' r='${Number(v.size)}' fill='${v.color1}'/></pattern></defs><rect width='200' height='200' fill='url(#p)'/></svg>`;
    },
  },
  {
    id: "checkerboard",
    category: "patterns",
    label: "Checkerboard",
    colorSlots: [
      { key: "color1", label: "Color A", default: "#e2e8f0" },
      { key: "color2", label: "Color B", default: "#2d3748" },
    ],
    params: [{ key: "size", label: "Square size", type: "number", default: 20, min: 5, max: 50, step: 1 }],
    buildSvg: (v) => {
      const s = Number(v.size);
      return `${svgOpen(200, 200)}<defs><pattern id='p' width='${s * 2}' height='${s * 2}' patternUnits='userSpaceOnUse'><rect width='${s * 2}' height='${s * 2}' fill='${v.color1}'/><rect width='${s}' height='${s}' fill='${v.color2}'/><rect x='${s}' y='${s}' width='${s}' height='${s}' fill='${v.color2}'/></pattern></defs><rect width='200' height='200' fill='url(#p)'/></svg>`;
    },
  },
  {
    id: "grid-lines",
    category: "patterns",
    label: "Grid lines",
    colorSlots: [
      { key: "color1", label: "Line color", default: "#4a5568" },
      { key: "color2", label: "Background", default: "#f7fafc" },
    ],
    params: [
      { key: "spacing", label: "Spacing", type: "number", default: 20, min: 5, max: 60, step: 1 },
      { key: "thickness", label: "Line thickness", type: "number", default: 1, min: 1, max: 6, step: 1 },
    ],
    buildSvg: (v) => {
      const spacing = Number(v.spacing);
      return `${svgOpen(200, 200)}<defs><pattern id='p' width='${spacing}' height='${spacing}' patternUnits='userSpaceOnUse'><rect width='${spacing}' height='${spacing}' fill='${v.color2}'/><path d='M ${spacing} 0 L 0 0 0 ${spacing}' fill='none' stroke='${v.color1}' stroke-width='${Number(v.thickness)}'/></pattern></defs><rect width='200' height='200' fill='url(#p)'/></svg>`;
    },
  },

  // Banners
  {
    id: "swooped-banner",
    category: "banners",
    label: "Flat banner",
    colorSlots: [
      { key: "fill", label: "Fill", default: "#8b1e2b" },
      { key: "outline", label: "Outline", default: "#d4af37" },
    ],
    buildSvg: (v) =>
      `${svgOpen(200, 50)}<path d='M 10,5 L 190,5 L 175,25 L 190,45 L 10,45 L 25,25 Z' fill='${v.fill}' stroke='${v.outline}' stroke-width='3' stroke-linejoin='round'/></svg>`,
  },
  // A bottom-of-card type band: mostly a flat ~1in-tall bar, but the top
  // edge lifts near the left edge and eases back down to the base height
  // over a short stretch of the width — the "swoop start"/"swoop extent"
  // params define where that lift begins and how much of the width it
  // takes to settle back to base, so it isn't locked to exactly the left
  // 10%. The viewBox height (100 units) is the ~1in base reference, so
  // "swoop rise (in)" maps 1:1 onto it (0.1in == 10 units).
  {
    id: "swoop-banner",
    category: "banners",
    label: "Swoop banner",
    colorSlots: [
      { key: "fill", label: "Fill", default: "#8b1e2b" },
      { key: "outline", label: "Outline", default: "#d4af37" },
    ],
    params: [
      {
        key: "side",
        label: "Swoop side",
        type: "select",
        options: [
          { value: "left", label: "Left" },
          { value: "right", label: "Right" },
        ],
        default: "left",
      },
      { key: "swoopStart", label: "Swoop start (%)", type: "number", default: 0, min: 0, max: 80, step: 1 },
      { key: "swoopExtent", label: "Swoop extent (%)", type: "number", default: 10, min: 2, max: 90, step: 1 },
      { key: "swoopHeight", label: "Swoop rise (in)", type: "number", default: 0.1, min: 0, max: 0.5, step: 0.01 },
    ],
    buildSvg: (v) => {
      const width = 250;
      const bodyHeight = 90; // fixed "flat banner" reference height
      const margin = 5; // keeps the stroke from clipping at the very top even at zero rise
      const rise = Math.max(0, Number(v.swoopHeight)) * 100;
      // The viewBox grows to fit whatever rise is requested (rather than
      // clamping the peak to a fixed headroom), so the shape always fills
      // its own bounds exactly — no dead space for "fill" to have to
      // stretch through, and no ceiling on how tall the rise can go.
      const baseTop = margin + rise;
      const height = baseTop + bodyHeight;
      const startPct = Math.max(0, Math.min(95, Number(v.swoopStart)));
      const maxExtentPct = Math.max(1, 100 - startPct);
      const extentPct = Math.min(maxExtentPct, Math.max(1, Number(v.swoopExtent)));
      const startX = (startPct / 100) * width;
      const endX = Math.min(width, startX + (extentPct / 100) * width);
      const peakY = margin;
      const controlX = startX + (endX - startX) * 0.35;
      const path = `<path d='M 0,${peakY} L ${startX},${peakY} Q ${controlX},${peakY} ${endX},${baseTop} L ${width},${baseTop} L ${width},${height} L 0,${height} Z' fill='${v.fill}' stroke='${v.outline}' stroke-width='3'/>`;
      // A true left/right flip needs to mirror the path's own coordinates —
      // rotating the whole image (the only transform layer/position offers)
      // would flip both axes at once and turn the banner upside down too.
      const content = v.side === "right" ? `<g transform='translate(${width},0) scale(-1,1)'>${path}</g>` : path;
      return `${svgOpen(width, height)}${content}</svg>`;
    },
  },
  {
    id: "corner-ribbon",
    category: "banners",
    label: "Corner ribbon",
    colorSlots: [
      { key: "fill", label: "Fill", default: "#2f6f4f" },
      { key: "outline", label: "Outline", default: "#f4e7c1" },
    ],
    buildSvg: (v) =>
      `${svgOpen(200, 200)}<g transform='rotate(45 100 100)'><rect x='-20' y='85' width='240' height='30' fill='${v.fill}' stroke='${v.outline}' stroke-width='2'/></g></svg>`,
  },

  // Shapes
  {
    id: "circle-seal",
    category: "shapes",
    label: "Circle / seal",
    colorSlots: [
      { key: "fill", label: "Fill", default: "#2b6cb0" },
      { key: "outline", label: "Outline", default: "#ffffff" },
    ],
    buildSvg: (v) =>
      `${svgOpen(200, 200)}<circle cx='100' cy='100' r='90' fill='${v.fill}' stroke='${v.outline}' stroke-width='6'/></svg>`,
  },
  {
    id: "rounded-rect",
    category: "shapes",
    label: "Rounded rectangle",
    colorSlots: [
      { key: "fill", label: "Fill", default: "#4a5568" },
      { key: "outline", label: "Outline", default: "#e2e8f0" },
    ],
    params: [{ key: "radius", label: "Corner radius", type: "number", default: 20, min: 0, max: 100, step: 1 }],
    buildSvg: (v) =>
      `${svgOpen(200, 200)}<rect x='10' y='10' width='180' height='180' rx='${Number(v.radius)}' fill='${v.fill}' stroke='${v.outline}' stroke-width='4'/></svg>`,
  },
  {
    id: "hexagon",
    category: "shapes",
    label: "Hexagon",
    colorSlots: [
      { key: "fill", label: "Fill", default: "#805ad5" },
      { key: "outline", label: "Outline", default: "#ffffff" },
    ],
    buildSvg: (v) =>
      `${svgOpen(200, 200)}<polygon points='${polygonPoints(100, 100, 90, 6)}' fill='${v.fill}' stroke='${v.outline}' stroke-width='5' stroke-linejoin='round'/></svg>`,
  },
  {
    id: "star-burst",
    category: "shapes",
    label: "Star / burst",
    colorSlots: [
      { key: "fill", label: "Fill", default: "#d4af37" },
      { key: "outline", label: "Outline", default: "#7a5c00" },
    ],
    params: [{ key: "points", label: "Points", type: "number", default: 8, min: 4, max: 16, step: 1 }],
    buildSvg: (v) =>
      `${svgOpen(200, 200)}<polygon points='${starPoints(100, 100, 90, 45, Number(v.points))}' fill='${v.fill}' stroke='${v.outline}' stroke-width='3' stroke-linejoin='round'/></svg>`,
  },
  {
    id: "scalloped-badge",
    category: "shapes",
    label: "Scalloped badge",
    colorSlots: [
      { key: "fill", label: "Fill", default: "#b7791f" },
      { key: "outline", label: "Outline", default: "#fffbea" },
    ],
    params: [{ key: "scallops", label: "Scallops", type: "number", default: 12, min: 6, max: 24, step: 1 }],
    buildSvg: (v) => {
      const n = Number(v.scallops);
      const ringR = 75;
      const bumpR = (2 * Math.PI * ringR) / n / 2 + 3;
      const bumps = [];
      for (let i = 0; i < n; i += 1) {
        const angle = (i / n) * Math.PI * 2;
        const cx = (100 + ringR * Math.cos(angle)).toFixed(1);
        const cy = (100 + ringR * Math.sin(angle)).toFixed(1);
        bumps.push(`<circle cx='${cx}' cy='${cy}' r='${bumpR.toFixed(1)}' fill='${v.fill}'/>`);
      }
      // A slightly larger outline-colored disc sits behind everything, so
      // its rim peeking out between the fill-colored bumps reads as one
      // clean scalloped border rather than a seam around every bump.
      return `${svgOpen(200, 200)}<circle cx='100' cy='100' r='${(ringR + bumpR + 2).toFixed(1)}' fill='${v.outline}'/><circle cx='100' cy='100' r='70' fill='${v.fill}'/>${bumps.join("")}</svg>`;
    },
  },
  // A plain rule/line — the one shape this library was missing (previously
  // only reachable outside the picker via Workbench's now-retired Divider
  // component, which had no picker/preview at all). Style/Thickness mirror
  // Divider's own old fields exactly, so the migration is a straight
  // upgrade, not a loss of capability.
  {
    id: "horizontal-rule",
    category: "shapes",
    label: "Horizontal rule",
    colorSlots: [{ key: "line", label: "Line color", default: "#000000" }],
    params: [
      { key: "thickness", label: "Thickness", type: "number", default: 2, min: 1, max: 12, step: 1 },
      {
        key: "style",
        label: "Style",
        type: "select",
        default: "solid",
        options: [
          { value: "solid", label: "Solid" },
          { value: "dashed", label: "Dashed" },
          { value: "dotted", label: "Dotted" },
        ],
      },
    ],
    buildSvg: (v) => {
      const thickness = Math.max(1, Number(v.thickness));
      const height = thickness + 6;
      const y = height / 2;
      const dashAttr =
        v.style === "dashed"
          ? ` stroke-dasharray='${thickness * 4} ${thickness * 2}'`
          : v.style === "dotted"
            ? ` stroke-dasharray='0.1 ${thickness * 2.5}' stroke-linecap='round'`
            : "";
      return `${svgOpen(200, height)}<line x1='0' y1='${y}' x2='200' y2='${y}' stroke='${v.line}' stroke-width='${thickness}'${dashAttr}/></svg>`;
    },
  },
];

export function getPresetById(id) {
  return PATTERN_PRESETS.find((preset) => preset.id === id) ?? null;
}

export function getPresetsByCategory(categoryId) {
  return PATTERN_PRESETS.filter((preset) => preset.category === categoryId);
}

export function getPresetDefaultValues(preset) {
  const values = {};
  (preset?.colorSlots ?? []).forEach((slot) => {
    values[slot.key] = slot.default;
  });
  (preset?.params ?? []).forEach((param) => {
    values[param.key] = param.default;
  });
  return values;
}

export function svgToDataUri(svg) {
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

// Embeds which preset + parameter values produced this SVG directly into
// the markup itself (a data attribute on the root <svg>), so re-opening
// the picker on an already-inserted pattern can detect and restore it. A
// separate field on the node was the alternative, but that needs its own
// sync story and wouldn't travel with the URL if it's ever copied
// elsewhere — this way the URL is fully self-describing.
export function embedPatternMetadata(svg, presetId, values) {
  const meta = JSON.stringify({ id: presetId, values });
  const escaped = meta.replace(/'/g, "&apos;");
  return svg.replace(/^<svg /, `<svg data-press-pattern='${escaped}' `);
}

const DATA_URI_PREFIX = "data:image/svg+xml,";

// Inverse of embedPatternMetadata + svgToDataUri combined — given a stored
// image url, returns { preset, values } if it was generated by this
// picker, or null for anything else (a hand-pasted URL, a plain image, an
// SVG from before this metadata existed).
export function extractPatternMetadata(url) {
  if (typeof url !== "string" || !url.startsWith(DATA_URI_PREFIX)) return null;
  let svg;
  try {
    svg = decodeURIComponent(url.slice(DATA_URI_PREFIX.length));
  } catch {
    return null;
  }
  const match = svg.match(/data-press-pattern='([^']*)'/);
  if (!match) return null;
  try {
    const meta = JSON.parse(match[1].replace(/&apos;/g, "'"));
    if (!meta || typeof meta.id !== "string" || typeof meta.values !== "object" || !meta.values) return null;
    const preset = getPresetById(meta.id);
    if (!preset) return null;
    return { preset, values: meta.values };
  } catch {
    return null;
  }
}
