import { renderLayout } from "./template-renderer.js";

const MILLIMETERS_PER_INCH = 25.4;
const pageSizes = {};
const pageSizeOrder = [];

function registerPageSize({ id, label, width, height, margin = 0.25, orientations = ["portrait", "landscape"] }) {
  pageSizes[id] = {
    id,
    label,
    width,
    height,
    margin,
    orientations,
  };
  pageSizeOrder.push(id);
}

function registerIsoSize({ id, label, widthMm, heightMm, margin }) {
  registerPageSize({
    id,
    label,
    width: widthMm / MILLIMETERS_PER_INCH,
    height: heightMm / MILLIMETERS_PER_INCH,
    margin,
  });
}

registerPageSize({
  id: "letter",
  label: "Letter",
  width: 8.5,
  height: 11,
  margin: 0.25,
});
registerPageSize({
  id: "legal",
  label: "Legal",
  width: 8.5,
  height: 14,
  margin: 0.25,
});

[
  { id: "a0", label: "A0", widthMm: 841, heightMm: 1189 },
  { id: "a1", label: "A1", widthMm: 594, heightMm: 841 },
  { id: "a2", label: "A2", widthMm: 420, heightMm: 594 },
  { id: "a3", label: "A3", widthMm: 297, heightMm: 420 },
  { id: "a4", label: "A4", widthMm: 210, heightMm: 297 },
  { id: "a5", label: "A5", widthMm: 148, heightMm: 210 },
  { id: "a6", label: "A6", widthMm: 105, heightMm: 148, margin: 0.2 },
  { id: "a7", label: "A7", widthMm: 74, heightMm: 105, margin: 0.2 },
  { id: "a8", label: "A8", widthMm: 52, heightMm: 74, margin: 0.2 },
  { id: "a9", label: "A9", widthMm: 37, heightMm: 52, margin: 0.2 },
  { id: "a10", label: "A10", widthMm: 26, heightMm: 37, margin: 0.2 },
].forEach((size) => registerIsoSize(size));

[
  { id: "b0", label: "B0", widthMm: 1000, heightMm: 1414 },
  { id: "b1", label: "B1", widthMm: 707, heightMm: 1000 },
  { id: "b2", label: "B2", widthMm: 500, heightMm: 707 },
  { id: "b3", label: "B3", widthMm: 353, heightMm: 500 },
  { id: "b4", label: "B4", widthMm: 250, heightMm: 353 },
  { id: "b5", label: "B5", widthMm: 176, heightMm: 250 },
  { id: "b6", label: "B6", widthMm: 125, heightMm: 176 },
  { id: "b7", label: "B7", widthMm: 88, heightMm: 125, margin: 0.2 },
  { id: "b8", label: "B8", widthMm: 62, heightMm: 88, margin: 0.2 },
  { id: "b9", label: "B9", widthMm: 44, heightMm: 62, margin: 0.2 },
  { id: "b10", label: "B10", widthMm: 31, heightMm: 44, margin: 0.2 },
].forEach((size) => registerIsoSize(size));

let templates = [];

async function loadJson(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Unable to load ${url}: ${response.status}`);
  }
  return response.json();
}

function resolveBinding(binding, context) {
  if (typeof binding !== "string" || !binding.startsWith("@")) {
    return binding;
  }
  const path = binding.slice(1).split(".");
  return path.reduce((acc, key) => {
    if (acc && typeof acc === "object" && key in acc) {
      return acc[key];
    }
    return undefined;
  }, context);
}

function resolveTemplateData(template, data) {
  if (data && typeof data === "object") {
    return data;
  }
  return template.sampleData ?? {};
}

function resolvePageSize(format, orientation) {
  const fallback = pageSizes.letter;
  const base = format?.size ?? pageSizes[format?.sizeId] ?? fallback;
  const desired = orientation ?? format?.defaultOrientation ?? "portrait";
  const portrait = {
    width: base.width,
    height: base.height,
    margin: base.margin,
    label: format?.label ?? base.label,
    orientation: "portrait",
  };
  if (desired === "landscape") {
    return { ...portrait, width: portrait.height, height: portrait.width, orientation: "landscape" };
  }
  return portrait;
}

function applyPageMeta(page, template, resolvedSize, side, source) {
  page.className = `print-page side-${side}`;
  page.style.width = `${resolvedSize.width}in`;
  page.style.height = `${resolvedSize.height}in`;
  page.style.padding = `${resolvedSize.margin}in`;
  const sourceLabel = source?.name ?? "Local";
  page.dataset.label = `${template.name} — ${resolvedSize.label} ${resolvedSize.orientation} — ${sourceLabel} — ${side}`;
}

function createPageWrapper(template, side, { size, format, source }) {
  const activeFormat = format ?? template.formats?.[0];
  const resolvedSize = size ?? resolvePageSize(activeFormat);
  const page = document.createElement("div");
  applyPageMeta(page, template, resolvedSize, side, source);
  const inner = document.createElement("div");
  inner.className = "page-inner";
  page.appendChild(inner);
  return { page, inner, resolvedSize };
}

function getRepeatData(template, pageConfig, data) {
  if (!pageConfig) return [];
  if (pageConfig.repeat) {
    const bound = resolveBinding(pageConfig.repeat, data);
    if (Array.isArray(bound)) return bound;
  }
  if (Array.isArray(data)) {
    return data;
  }
  if (Array.isArray(data?.cards)) {
    return data.cards;
  }
  return [];
}

function renderCardGrid(template, side, context) {
  const { page, inner } = createPageWrapper(template, side, context);
  const pageConfig = context.page ?? template.pages?.[side] ?? {};
  const templateData = resolveTemplateData(template, context.data);
  const data = getRepeatData(template, pageConfig, templateData);
  const { onRootReady, ...renderOptions } = context.renderOptions ?? {};
  const { width, height, gutter = 0, safeInset = 0, columns = 1, rows = 1 } = template.card ?? {};
  const grid = document.createElement("div");
  grid.className = "card-grid";
  grid.style.gridTemplateColumns = `repeat(${columns}, ${width}in)`;
  grid.style.gridAutoRows = `${height}in`;
  grid.style.gap = `${gutter}in`;
  const gridWidth = width * columns + gutter * (columns - 1);
  const gridHeight = height * rows + gutter * (rows - 1);
  grid.style.width = `${gridWidth}in`;
  grid.style.height = `${gridHeight}in`;
  grid.style.margin = "0 auto";

  const cards = data.slice(0, columns * rows);
  cards.forEach((card, index) => {
    const tile = document.createElement("article");
    tile.className = "card-tile";
    tile.style.padding = `${safeInset}in`;
    const layout = pageConfig.layout ?? null;
    const options = index === 0 && typeof onRootReady === "function"
      ? { ...renderOptions, onRootReady }
      : renderOptions;
    const content = layout ? renderLayout(layout, card, options) : document.createTextNode(card?.title ?? "Card");
    tile.append(content);
    grid.appendChild(tile);
  });

  inner.appendChild(grid);
  return page;
}

function renderSheet(template, side, context) {
  const { page, inner } = createPageWrapper(template, side, context);
  const pageConfig = context.page ?? template.pages?.[side] ?? {};
  const layout = pageConfig.layout ?? null;
  const templateData = resolveTemplateData(template, context.data);
  const data = resolveBinding(pageConfig.data ?? "@", templateData) ?? templateData ?? {};
  if (layout) {
    inner.appendChild(renderLayout(layout, data, context.renderOptions));
  }
  return page;
}

function normalizeTemplate(raw) {
  const template = {
    ...raw,
    id: raw.id,
    name: raw.title ?? raw.name,
    description: raw.description ?? raw.summary ?? "",
    sides: raw.sides ?? Object.keys(raw.pages ?? { front: {}, back: {} }),
    formats: raw.formats ?? [],
    supportedSources: raw.supportedSources ?? ["ddb", "srd", "json", "manual"],
    sampleData: raw.sampleData ?? {},
  };

  template.createPage = (side, { size, format, source, data, page, renderOptions } = {}) => {
    if (template.type === "card") {
      return renderCardGrid(template, side, { size, format, source, data, page, renderOptions });
    }
    return renderSheet(template, side, { size, format, source, data, page, renderOptions });
  };

  return template;
}

export async function loadTemplates() {
  if (templates.length) return templates;
  const manifestUrl = new URL("../templates/index.json", import.meta.url);
  const manifest = await loadJson(manifestUrl);
  const files = manifest.templates || [];
  const loaded = await Promise.all(files.map((file) => loadJson(new URL(file, manifestUrl))));
  templates = loaded.map(normalizeTemplate);
  return templates;
}

export function getTemplates() {
  return templates;
}

export function getTemplateById(id) {
  return templates.find((template) => template.id === id) ?? templates[0];
}

export function getFormatById(template, formatId) {
  return template?.formats?.find((format) => format.id === formatId) ?? template?.formats?.[0];
}

export function getPageSize(template, formatId, orientation) {
  const format = getFormatById(template, formatId) ?? template?.formats?.[0];
  return resolvePageSize(format, orientation);
}

export function getStandardFormats() {
  return pageSizeOrder.map((id) => {
    const size = pageSizes[id];
    return {
      id: size.id,
      label: size.label,
      sizeId: size.id,
      orientations: size.orientations,
      defaultOrientation: size.orientations?.[0] ?? "portrait",
    };
  });
}

export function getSupportedSources(template) {
  return template?.supportedSources ?? ["ddb", "srd", "json", "manual"];
}
