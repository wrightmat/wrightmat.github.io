import { renderLayout, normalizeLegacyLayoutNode } from "./template-renderer.js";
import { getSampleData } from "./sample-data.js";
import { resolveBinding } from "../../common/js/lib/bindings.js";

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

export function registerCustomPageSize({ id, label, width, height, margin, orientations } = {}) {
  if (!id || !(width > 0) || !(height > 0) || pageSizes[id]) return null;
  registerPageSize({ id, label: label || id, width, height, margin, orientations });
  return pageSizes[id];
}

export async function loadCustomPageSizes() {
  try {
    const url = new URL("../data/custom-page-sizes.json", import.meta.url);
    const payload = await loadJson(url);
    const sizes = Array.isArray(payload?.sizes) ? payload.sizes : [];
    sizes.forEach((size) => registerCustomPageSize(size));
    return sizes;
  } catch (error) {
    return [];
  }
}

export async function saveCustomPageSize(size) {
  const response = await fetch("/press/custom-sizes", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ size }),
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload.error || "Unable to save custom page size.");
  }
  return response.json();
}

function resolveTemplateData(template, data) {
  if (data && typeof data === "object") {
    return data;
  }
  return getSampleData();
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

// A back side can set `repeat: "same"` to reuse the front side's own repeat
// binding against the same data, guaranteeing front[i]/back[i] stay index-aligned
// (the same physical card, two sides) instead of independently repeating over
// whatever array each side happens to name.
export function getRepeatData(template, pageConfig, data) {
  if (!pageConfig) return [];
  const repeat = pageConfig.repeat === "same" ? template?.pages?.front?.repeat : pageConfig.repeat;
  if (repeat) {
    const bound = resolveBinding(repeat, data);
    if (Array.isArray(bound) && bound.length) return bound;
    if (bound && typeof bound === "object") return [bound];
    if (repeat === "@") return [data];
  }
  if (Array.isArray(data) && data.length) {
    return data;
  }
  if (Array.isArray(data?.cards) && data.cards.length) {
    return data.cards;
  }
  // The named repeat path (e.g. "@features") doesn't exist on this data — rather
  // than render nothing (and leave the preview with no editable root at all),
  // fall back to treating the whole object as a single card so at least whatever
  // basic fields (e.g. @name) do exist still show up.
  if (data && typeof data === "object") {
    return [data];
  }
  return [];
}

// Bleed can only extend into the gutter (shared with a neighboring card) or the
// page margin (at the sheet's outer edge) — never both, and never past whichever
// is smaller, so adjacent cards' bleed can't overwrite each other and the sheet's
// bleed can't run off the physical page.
export function computeBleedInsets(bleed, { row, col, rows, columns, gutter = 0, margin = 0 }) {
  const raw = Number(bleed) || 0;
  if (raw <= 0) return { top: 0, right: 0, bottom: 0, left: 0 };
  const interior = gutter / 2;
  const limit = (isEdge) => Math.max(0, Math.min(raw, isEdge ? margin : interior));
  return {
    top: limit(row === 0),
    bottom: limit(row === rows - 1),
    left: limit(col === 0),
    right: limit(col === columns - 1),
  };
}

function applyBackground(element, background) {
  if (!background) return;
  if (background.color) {
    element.style.backgroundColor = background.color;
  }
  if (background.image) {
    element.style.backgroundImage = `url("${background.image}")`;
    element.style.backgroundSize = "cover";
    element.style.backgroundPosition = "center";
  }
}

function createBleedLayer(background, insets, { circle = false } = {}) {
  const layer = document.createElement("div");
  layer.className = circle ? "card-bleed-layer card-bleed-layer--circle" : "card-bleed-layer";
  layer.style.position = "absolute";
  layer.style.top = `-${insets.top}in`;
  layer.style.right = `-${insets.right}in`;
  layer.style.bottom = `-${insets.bottom}in`;
  layer.style.left = `-${insets.left}in`;
  applyBackground(layer, background);
  return layer;
}

function hasBleed(insets) {
  return insets.top > 0 || insets.right > 0 || insets.bottom > 0 || insets.left > 0;
}

// A root `layer` node can opt out of the default safe-inset padding via
// `origin: "trim" | "bleed"` — "trim" fills the tile/circle exactly (no
// padding), "bleed" extends past it using the same per-edge insets the
// bleed color/image layer itself uses (computeBleedInsets). Flow-based root
// layouts (stack/row, or a layer with no `origin`/`origin:"safe"`) are
// unaffected — this only changes how the *root* layout is mounted; nested
// layers (children of a stack, not the root) always size to their own
// parent's content box regardless of this template-level setting.
function applyRootLayoutOrigin(container, layout, { safeInset = 0, insets } = {}) {
  const origin = layout?.type === "layer" ? layout.origin || "safe" : "safe";
  if (origin === "bleed" && insets) {
    container.style.position = "absolute";
    container.style.top = `-${insets.top}in`;
    container.style.right = `-${insets.right}in`;
    container.style.bottom = `-${insets.bottom}in`;
    container.style.left = `-${insets.left}in`;
    container.style.width = "auto";
    container.style.height = "auto";
    container.style.padding = "0";
  } else if (origin === "trim") {
    container.style.padding = "0";
  } else {
    container.style.padding = `${safeInset}in`;
  }
}

function renderCardGrid(template, side, context) {
  const { page, inner, resolvedSize } = createPageWrapper(template, side, context);
  const pageConfig = context.page ?? template.pages?.[side] ?? {};
  const templateData = resolveTemplateData(template, context.data);
  const data = getRepeatData(template, pageConfig, templateData);
  const { onRootReady, ...renderOptions } = context.renderOptions ?? {};
  const { width, height, gutter = 0, safeInset = 0, bleed = 0, cornerRadius = 0, background, columns = 1, rows = 1 } = template.card ?? {};
  const margin = resolvedSize.margin ?? 0;
  const grid = document.createElement("div");
  grid.className = "card-grid";
  grid.style.gridTemplateColumns = `repeat(${columns}, ${width}in)`;
  grid.style.gridAutoRows = `${height}in`;
  grid.style.gap = `${gutter}in`;
  const gridWidth = width * columns + gutter * (columns - 1);
  const gridHeight = height * rows + gutter * (rows - 1);
  grid.style.width = `${gridWidth}in`;
  grid.style.height = `${gridHeight}in`;
  grid.style.margin = "auto";

  const cards = data.slice(0, columns * rows);
  cards.forEach((card, index) => {
    const row = Math.floor(index / columns);
    const col = index % columns;
    const insets = computeBleedInsets(bleed, { row, col, rows, columns, gutter, margin });
    const tile = document.createElement("article");
    tile.className = "card-tile";
    tile.style.borderRadius = `${cornerRadius}in`;
    applyBackground(tile, background);
    if (hasBleed(insets)) {
      tile.appendChild(createBleedLayer(background, insets));
    }
    const contentWrapper = document.createElement("div");
    contentWrapper.className = "card-tile-content";
    // Clips content to the same real corner radius as the tile itself, so a
    // full-bleed background/image visually matches what the die cut will
    // actually leave rather than showing square corners under a rounded
    // trim guide.
    contentWrapper.style.borderRadius = `${cornerRadius}in`;
    contentWrapper.style.overflow = cornerRadius > 0 ? "hidden" : "";
    const layout = pageConfig.layout ?? null;
    applyRootLayoutOrigin(contentWrapper, layout, { safeInset, insets });
    const options = index === 0 && typeof onRootReady === "function"
      ? { ...renderOptions, onRootReady }
      : renderOptions;
    const content = layout ? renderLayout(layout, card, options) : document.createTextNode(card?.title ?? "Card");
    contentWrapper.append(content);
    tile.append(contentWrapper);
    grid.appendChild(tile);
  });

  inner.appendChild(grid);
  return page;
}

function renderChipGrid(template, side, context) {
  const { page, inner, resolvedSize } = createPageWrapper(template, side, context);
  const pageConfig = context.page ?? template.pages?.[side] ?? {};
  const templateData = resolveTemplateData(template, context.data);
  const data = getRepeatData(template, pageConfig, templateData);
  const { onRootReady, ...renderOptions } = context.renderOptions ?? {};
  const { width = 1, height = 1, gutter = 0, safeInset = 0, bleed = 0, background, columns = 1, rows = 1 } = template.card ?? {};
  const diameter = width || height || 1;
  const margin = resolvedSize.margin ?? 0;
  const grid = document.createElement("div");
  grid.className = "chip-grid";
  grid.style.gridTemplateColumns = `repeat(${columns}, ${diameter}in)`;
  grid.style.gridAutoRows = `${diameter}in`;
  grid.style.gap = `${gutter}in`;
  const gridWidth = diameter * columns + gutter * (columns - 1);
  const gridHeight = diameter * rows + gutter * (rows - 1);
  grid.style.width = `${gridWidth}in`;
  grid.style.height = `${gridHeight}in`;
  const availableWidth = context.size ? context.size.width - context.size.margin * 2 : gridWidth;
  const availableHeight = context.size ? context.size.height - context.size.margin * 2 : gridHeight;
  const horizontalOffset = Math.max(0, (availableWidth - gridWidth) / 2);
  const verticalOffset = Math.max(0, (availableHeight - gridHeight) / 2);
  grid.style.marginLeft = `${horizontalOffset}in`;
  grid.style.marginTop = `${verticalOffset}in`;
  grid.style.alignSelf = "flex-start";

  const chips = data.slice(0, columns * rows);
  chips.forEach((chip, index) => {
    const row = Math.floor(index / columns);
    const col = index % columns;
    const insets = computeBleedInsets(bleed, { row, col, rows, columns, gutter, margin });
    const tile = document.createElement("article");
    tile.className = "chip-tile";
    if (hasBleed(insets)) {
      tile.appendChild(createBleedLayer(background, insets, { circle: true }));
    }
    const circle = document.createElement("div");
    circle.className = "chip-circle";
    circle.style.width = `${diameter}in`;
    circle.style.height = `${diameter}in`;
    applyBackground(circle, background);
    const layout = pageConfig.layout ?? null;
    applyRootLayoutOrigin(circle, layout, { safeInset, insets });
    const options = index === 0 && typeof onRootReady === "function"
      ? { ...renderOptions, onRootReady }
      : renderOptions;
    const content = layout ? renderLayout(layout, chip, options) : document.createTextNode(chip?.title ?? "Chip");
    circle.append(content);
    tile.appendChild(circle);
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

function resolveBindingsDeep(value, context) {
  if (typeof value === "string" && value.startsWith("@")) {
    return resolveBinding(value, context);
  }
  if (Array.isArray(value)) {
    return value.map((entry) => resolveBindingsDeep(entry, context));
  }
  if (value && typeof value === "object") {
    return Object.entries(value).reduce((acc, [key, entry]) => {
      acc[key] = resolveBindingsDeep(entry, context);
      return acc;
    }, {});
  }
  return value;
}

function asArray(value) {
  if (Array.isArray(value)) return value;
  if (value === undefined || value === null) return [];
  return [value];
}

function resolveLayoutBindings(node, context) {
  if (!node || typeof node !== "object") {
    return resolveBindingsDeep(node, context);
  }

  if (Array.isArray(node)) {
    return node.map((entry) => resolveLayoutBindings(entry, context));
  }

  const resolved = resolveBindingsDeep(node, context);

  if (node.type === "grid" && Array.isArray(node.cells)) {
    resolved.cells = node.cells.map((rowCells) =>
      asArray(rowCells).map((cellNodes) => asArray(cellNodes).map((cellNode) => resolveLayoutBindings(cellNode, context)))
    );
  }

  if (node.type === "layer" && Array.isArray(node.placements)) {
    resolved.placements = node.placements.map((placement) => {
      if (!placement || typeof placement !== "object") {
        return placement;
      }
      const resolvedPlacement = resolveBindingsDeep(placement, context);
      if (placement.node) {
        resolvedPlacement.node = resolveLayoutBindings(placement.node, context);
      }
      return resolvedPlacement;
    });
  }

  if (node.type === "field" && node.component === "list") {
    const items = resolveBinding(node.itemsBind, context) ?? node.items ?? [];
    resolved.items = asArray(items).map((item) => resolveBindingsDeep(item, context));
  }

  if (node.type === "field" && node.component === "table") {
    const rows = resolveBinding(node.rowsBind ?? node.itemsBind, context) ?? node.rows ?? [];
    const columns = Array.isArray(node.columns) ? node.columns : [];
    const cells = Array.isArray(node.cells) ? node.cells : [];
    resolved.rows = asArray(rows).map((row, rowIndex) => {
      const rowContext = typeof row === "object" && row !== null ? { ...context, ...row } : { ...context, value: row };
      rowContext.item = row;
      rowContext.index = rowIndex;
      return columns.map((column, columnIndex) => {
        const cellNodes = Array.isArray(cells[rowIndex]?.[columnIndex]) ? cells[rowIndex][columnIndex] : null;
        if (cellNodes) {
          return cellNodes.map((cellNode) => resolveLayoutBindings(cellNode, rowContext));
        }
        const fallbackNode = {
          type: "field",
          component: column.component ?? "text",
          text: column.bind ?? column.text ?? column.value ?? "",
        };
        return [resolveLayoutBindings(fallbackNode, rowContext)];
      });
    });
  }

  return resolved;
}

// Collects the root data-scope keys a template's sides expect (its `repeat`/`data`
// bindings, e.g. "@features"/"@attacks") so they can be checked against whatever
// data was actually loaded, without needing to resolve every per-field binding
// inside a repeated item's own (different) context.
export function collectTemplateBindingPaths(template) {
  const paths = new Set();
  const pages = template?.pages ?? {};
  Object.values(pages).forEach((pageConfig) => {
    if (!pageConfig) return;
    [pageConfig.repeat, pageConfig.data].forEach((binding) => {
      if (typeof binding !== "string" || !binding.startsWith("@") || binding === "@") return;
      const match = binding.slice(1).match(/^[A-Za-z0-9_]+/);
      if (match) paths.add(match[0]);
    });
  });
  return paths;
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
  };

  template.createPage = (side, { size, format, source, data, page, renderOptions } = {}) => {
    if (template.type === "card") {
      return renderCardGrid(template, side, { size, format, source, data, page, renderOptions });
    }
    if (template.type === "chip") {
      return renderChipGrid(template, side, { size, format, source, data, page, renderOptions });
    }
    return renderSheet(template, side, { size, format, source, data, page, renderOptions });
  };

  return template;
}

export function createTemplate(definition) {
  return normalizeTemplate(definition);
}

export function buildTemplatePreview(template, data) {
  if (!template) return {};
  const templateData = resolveTemplateData(template, data);
  const resolvedPages = {};

  template.sides.forEach((side) => {
    const pageConfig = template.pages?.[side] ?? {};
    const layout = pageConfig.layout ? normalizeLegacyLayoutNode(pageConfig.layout) : null;
    if (template.type === "sheet") {
      const pageData = resolveBinding(pageConfig.data ?? "@", templateData) ?? templateData ?? {};
      resolvedPages[side] = {
        ...pageConfig,
        data: pageData,
        layout: layout ? resolveLayoutBindings(layout, pageData) : null,
      };
      return;
    }

    const items = getRepeatData(template, pageConfig, templateData);
    resolvedPages[side] = {
      ...pageConfig,
      items: items.map((item) => resolveLayoutBindings(layout, item)),
    };
  });

  return {
    id: template.id,
    name: template.name,
    description: template.description,
    type: template.type,
    formats: template.formats,
    supportedSources: template.supportedSources,
    card: template.card,
    pages: resolvedPages,
  };
}

function templateNameFromFile(file) {
  return file.replace(/^\.\//, "").replace(/\.json$/, "");
}

// Prefers server-side directory listing (so templates saved via the /press/templates
// endpoint are discovered without hand-editing index.json), falling back to the
// static manifest for non-server hosting. When both are available, the manifest's
// order is kept for files it already lists (so the default/first template doesn't
// change), and newly discovered files are appended after it.
async function listTemplateFiles(manifestUrl) {
  let discovered = null;
  try {
    const response = await fetch("/list/press-templates");
    if (response.ok) {
      const payload = await response.json();
      const names = new Set(
        (payload.files || [])
          .map((entry) => entry.filename)
          .filter((name) => Boolean(name) && name !== "index"),
      );
      if (names.size) {
        discovered = names;
      }
    }
  } catch (error) {
    // No shared server available — fall back to the static manifest below.
  }

  const manifest = await loadJson(manifestUrl).catch(() => ({ templates: [] }));
  const manifestFiles = manifest.templates || [];
  if (!discovered) {
    return manifestFiles;
  }

  const manifestNames = new Set(manifestFiles.map(templateNameFromFile));
  const ordered = manifestFiles.filter((file) => discovered.has(templateNameFromFile(file)));
  const extra = [...discovered].filter((name) => !manifestNames.has(name)).sort();
  return [...ordered, ...extra.map((name) => `./${name}.json`)];
}

export async function loadTemplates() {
  if (templates.length) return templates;
  const manifestUrl = new URL("../templates/index.json", import.meta.url);
  const files = await listTemplateFiles(manifestUrl);
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
