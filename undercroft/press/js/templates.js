import { renderLayout } from "./template-renderer.js";

const pageSizes = {
  letter: {
    id: "letter",
    label: "US Letter",
    width: 8.5,
    height: 11,
    margin: 0.25,
    orientations: ["portrait", "landscape"],
  },
  a4: {
    id: "a4",
    label: "A4",
    width: 8.27,
    height: 11.69,
    margin: 0.25,
    orientations: ["portrait", "landscape"],
  },
  a6: {
    id: "a6",
    label: "A6",
    width: 4.1,
    height: 5.8,
    margin: 0.2,
    orientations: ["portrait"],
  },
};

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

function getRepeatData(template, pageConfig) {
  if (!pageConfig) return [];
  if (pageConfig.repeat) {
    const bound = resolveBinding(pageConfig.repeat, template.sampleData ?? {});
    if (Array.isArray(bound)) return bound;
  }
  if (Array.isArray(template.sampleData)) {
    return template.sampleData;
  }
  if (Array.isArray(template.sampleData?.cards)) {
    return template.sampleData.cards;
  }
  return [];
}

function renderCardGrid(template, side, context) {
  const { page, inner } = createPageWrapper(template, side, context);
  const pageConfig = context.page ?? template.pages?.[side] ?? {};
  const data = getRepeatData(template, pageConfig);
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
  cards.forEach((card) => {
    const tile = document.createElement("article");
    tile.className = "card-tile";
    tile.style.padding = `${safeInset}in`;
    const layout = pageConfig.layout ?? null;
    const content = layout
      ? renderLayout(layout, card, context.renderOptions)
      : document.createTextNode(card?.title ?? "Card");
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
  const data = resolveBinding(pageConfig.data ?? "@", template.sampleData ?? {}) ?? template.sampleData ?? {};
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

  template.createPage = (side, { size, format, source, page, renderOptions } = {}) => {
    if (template.type === "card") {
      return renderCardGrid(template, side, { size, format, source, page, renderOptions });
    }
    return renderSheet(template, side, { size, format, source, page, renderOptions });
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

export function getSupportedSources(template) {
  return template?.supportedSources ?? ["ddb", "srd", "json", "manual"];
}
