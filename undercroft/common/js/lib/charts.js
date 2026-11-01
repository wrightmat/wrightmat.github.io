// Small SVG charts for a query result: bar, stacked bar, line and area. Plain DOM, no library; colors come from
// shell.css (.chart-s0 … .chart-s7) so they follow the theme and keep working in dark mode.
import { el } from "./dom.js";

const SVG_NS = "http://www.w3.org/2000/svg";
const WIDTH = 760;
const MARGIN = { top: 12, right: 16, bottom: 52, left: 56 };
const PLOT_HEIGHT = 280;
const MAX_CATEGORIES = 60;
const SERIES_CLASSES = 8;

function svg(name, attrs = {}, text) {
  const node = document.createElementNS(SVG_NS, name);
  Object.entries(attrs).forEach(([key, value]) => node.setAttribute(key, String(value)));
  if (text != null) node.textContent = text;
  return node;
}

export function formatValue(value, format) {
  if (value == null || value === "") return "";
  const number = Number(value);
  if (!Number.isFinite(number)) return String(value);
  if (format === "percent") return `${number.toFixed(1)}%`;
  if (format === "decimal") return number.toLocaleString(undefined, { maximumFractionDigits: 2, minimumFractionDigits: 2 });
  return number.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

// A readable axis ceiling and step for 0..max.
function niceScale(max) {
  if (!(max > 0)) return { max: 1, step: 0.25 };
  const rough = max / 4;
  const power = 10 ** Math.floor(Math.log10(rough));
  const unit = [1, 2, 2.5, 5, 10].find((u) => u * power >= rough) * power;
  return { max: Math.ceil(max / unit) * unit, step: unit };
}

function shorten(label, limit = 14) {
  const text = String(label ?? "");
  return text.length > limit ? `${text.slice(0, limit - 1)}…` : text;
}

// Turns columns/rows into {categories, series:[{label, values[]}], format, note}. One group-by field: its values are
// the categories and each measure is a series. Two or more: the first is the category, the second splits the first
// measure into series. A time field always becomes the category.
function shape(columns, rows) {
  const dims = columns.map((c, i) => ({ c, i })).filter((x) => x.c.kind === "dimension");
  const allMeasures = columns.map((c, i) => ({ c, i })).filter((x) => x.c.kind === "measure");
  if (!allMeasures.length) return null;
  // One axis can only carry one unit: keep the measures that share the first one's (counts vs percentages), say so.
  const meas = allMeasures.filter((m) => (m.c.format || "number") === (allMeasures[0].c.format || "number"));
  const skipped = allMeasures.filter((m) => !meas.includes(m)).map((m) => m.c.label);
  const unitNote = skipped.length ? `Not charted (different unit): ${skipped.join(", ")}.` : "";
  const timeFirst = dims.findIndex((d) => d.c.type === "time");
  if (timeFirst > 0) dims.unshift(...dims.splice(timeFirst, 1));
  const label = (row, d) => (row[d.i] == null || row[d.i] === "" ? "(blank)" : d.c.type === "boolean" ? (row[d.i] ? "Yes" : "No") : String(row[d.i]));
  if (dims.length === 0) {
    return { categories: ["Total"], series: meas.map((m) => ({ label: m.c.label, values: [Number(rows[0]?.[m.i]) || 0] })), format: meas[0].c.format, categoryIsTime: false, note: unitNote };
  }
  const categories = [];
  const seen = new Map();
  rows.forEach((row) => {
    const name = label(row, dims[0]);
    if (!seen.has(name)) {
      seen.set(name, categories.length);
      categories.push(name);
    }
  });
  const categoryIsTime = dims[0].c.type === "time";
  if (dims.length === 1) {
    const series = meas.map((m) => ({ label: m.c.label, values: new Array(categories.length).fill(0) }));
    rows.forEach((row) => {
      const at = seen.get(label(row, dims[0]));
      meas.forEach((m, n) => {
        series[n].values[at] = Number(row[m.i]) || 0;
      });
    });
    return { categories, series, format: meas[0].c.format, categoryIsTime, note: unitNote };
  }
  const splitNames = [];
  const splitSeen = new Map();
  rows.forEach((row) => {
    const name = label(row, dims[1]);
    if (!splitSeen.has(name)) {
      splitSeen.set(name, splitNames.length);
      splitNames.push(name);
    }
  });
  const series = splitNames.map((name) => ({ label: name, values: new Array(categories.length).fill(0) }));
  rows.forEach((row) => {
    series[splitSeen.get(label(row, dims[1]))].values[seen.get(label(row, dims[0]))] = Number(row[meas[0].i]) || 0;
  });
  return {
    categories,
    series,
    format: meas[0].c.format,
    categoryIsTime,
    note: [`${meas[0].c.label} by ${dims[0].c.label} and ${dims[1].c.label}${allMeasures.length > 1 || dims.length > 2 ? " (first measure and first two fields only)" : ""}`].join(""),
  };
}

// type: "bar" | "stacked" | "line" | "area"
export function renderChart(container, { columns, rows, type = "bar" } = {}) {
  container.replaceChildren();
  const data = shape(columns || [], rows || []);
  if (!data || !data.categories.length) {
    container.appendChild(el("p", "text-body-secondary small mb-0", "No rows to chart."));
    return;
  }
  let { categories, series } = data;
  const clipped = categories.length > MAX_CATEGORIES;
  if (clipped) {
    categories = categories.slice(0, MAX_CATEGORIES);
    series = series.map((s) => ({ ...s, values: s.values.slice(0, MAX_CATEGORIES) }));
  }
  const stacked = type === "stacked" || type === "area";
  const totals = categories.map((_, at) => series.reduce((sum, s) => sum + Math.max(0, s.values[at]), 0));
  const top = Math.max(...(stacked ? totals : series.flatMap((s) => s.values)), 0);
  const scale = niceScale(top);
  const plotWidth = WIDTH - MARGIN.left - MARGIN.right;
  const y = (value) => MARGIN.top + PLOT_HEIGHT - (value / scale.max) * PLOT_HEIGHT;
  const root = svg("svg", { viewBox: `0 0 ${WIDTH} ${MARGIN.top + PLOT_HEIGHT + MARGIN.bottom}`, role: "img", class: "analytics-chart w-100", "aria-label": "Chart of the query result" });
  for (let value = 0; value <= scale.max + scale.step / 2; value += scale.step) {
    root.append(
      svg("line", { x1: MARGIN.left, x2: WIDTH - MARGIN.right, y1: y(value), y2: y(value), class: "chart-grid" }),
      svg("text", { x: MARGIN.left - 6, y: y(value) + 4, "text-anchor": "end", class: "chart-label" }, formatValue(value, data.format))
    );
  }
  const slot = plotWidth / categories.length;
  const x = (at) => MARGIN.left + slot * at + slot / 2;
  const every = Math.ceil(categories.length / Math.max(1, Math.floor(plotWidth / 56)));
  categories.forEach((name, at) => {
    if (at % every) return;
    const label = svg("text", { x: x(at), y: MARGIN.top + PLOT_HEIGHT + 16, "text-anchor": categories.length > 8 ? "end" : "middle", class: "chart-label" }, shorten(name));
    if (categories.length > 8) label.setAttribute("transform", `rotate(-35 ${x(at)} ${MARGIN.top + PLOT_HEIGHT + 16})`);
    label.appendChild(svg("title", {}, name));
    root.appendChild(label);
  });
  const hover = (series2, at) => `${categories[at]} · ${series2.label}: ${formatValue(series2.values[at], data.format)}`;
  if (type === "bar" || type === "stacked") {
    const group = type === "bar" ? series.length : 1;
    const barWidth = Math.max(2, (slot * 0.76) / group);
    categories.forEach((_, at) => {
      let base = 0;
      series.forEach((s, n) => {
        const value = Math.max(0, s.values[at]);
        const left = type === "bar" ? x(at) - (barWidth * group) / 2 + barWidth * n : x(at) - barWidth / 2;
        const from = type === "bar" ? 0 : base;
        const rect = svg("rect", { x: left, y: y(from + value), width: barWidth, height: Math.max(0, y(from) - y(from + value)), class: `chart-s${n % SERIES_CLASSES}` });
        rect.appendChild(svg("title", {}, hover(s, at)));
        root.appendChild(rect);
        base += value;
      });
    });
  } else {
    const base = new Array(categories.length).fill(0);
    series.forEach((s, n) => {
      const upper = s.values.map((value, at) => (type === "area" ? base[at] + Math.max(0, value) : value));
      const points = upper.map((value, at) => `${x(at)},${y(value)}`);
      if (type === "area") {
        const lower = base.map((value, at) => `${x(at)},${y(value)}`).reverse();
        root.appendChild(svg("polygon", { points: [...points, ...lower].join(" "), class: `chart-fill chart-s${n % SERIES_CLASSES}` }));
        upper.forEach((value, at) => {
          base[at] = value;
        });
      }
      root.appendChild(svg("polyline", { points: points.join(" "), class: `chart-line chart-s${n % SERIES_CLASSES}` }));
      s.values.forEach((value, at) => {
        const dot = svg("circle", { cx: x(at), cy: y(upper[at]), r: 3.5, class: `chart-dot chart-s${n % SERIES_CLASSES}` });
        dot.appendChild(svg("title", {}, hover(s, at)));
        root.appendChild(dot);
      });
    });
  }
  root.appendChild(svg("line", { x1: MARGIN.left, x2: MARGIN.left, y1: MARGIN.top, y2: MARGIN.top + PLOT_HEIGHT, class: "chart-axis" }));
  root.appendChild(svg("line", { x1: MARGIN.left, x2: WIDTH - MARGIN.right, y1: MARGIN.top + PLOT_HEIGHT, y2: MARGIN.top + PLOT_HEIGHT, class: "chart-axis" }));
  container.appendChild(root);
  if (series.length > 1 || data.note) {
    const legend = el("div", "d-flex flex-wrap gap-3 small mt-1");
    series.forEach((s, n) => {
      const item = el("span", "d-inline-flex align-items-center gap-1");
      const swatch = el("span", `chart-swatch chart-s${n % SERIES_CLASSES}`);
      item.append(swatch, document.createTextNode(s.label));
      legend.appendChild(item);
    });
    container.appendChild(legend);
  }
  const notes = [data.note, clipped ? `Showing the first ${MAX_CATEGORIES} categories.` : ""].filter(Boolean);
  if (notes.length) container.appendChild(el("div", "text-body-secondary small mt-1", notes.join(" ")));
}
