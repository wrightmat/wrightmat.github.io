// Story Boards as Repository callouts — a `[!story-board]` callout IS a
// board: title is the board's name (scoped/unique per page, same convention
// as journal-quests.js), body is plain GFM: a couple `Key: value` metadata
// lines, a Nodes table, an Edges table. No new Library kind, no JSON blob —
// parsed/serialized here, rendered as an interactive canvas by
// story-board-canvas.js (mounted by repository/js/app.js after the ordinary
// renderMarkdown pass).
//
//   > [!story-board] The Sunken City Mystery
//   > Layout: swimlane
//   > Lanes: Investigation, Politics, The Cult
//   > Stages: Act 1, Act 2, Act 3
//   >
//   > | Node                 | Type        | Ref                     | Lane          | Stage | X   | Y  | Color |
//   > |----------------------|-------------|-------------------------|---------------|-------|-----|----|-------|
//   > | Find the Merchant    | ref         | quest:Find the Merchant | Investigation | Act 1 | 120 | 80 |       |
//   > | Mysterious Stranger  | placeholder |                         | Politics      | Act 1 | 300 | 80 | blue  |
//   >
//   > | From              | To                  | Label    |
//   > |-------------------|---------------------|----------|
//   > | Find the Merchant | Mysterious Stranger | leads to |
//
// A node's "Node" column is both its display name and its reference key for
// the Edges table's From/To — no separate opaque id, so a hand-editing GM
// never has to invent or track one; must be unique within the board. A `Ref`
// cell is the same `kindId:Name` (or `quest:Title`) compound text used for
// inline kind-reference chips elsewhere — this module never interprets it,
// only round-trips it; the canvas resolves it when it needs to.
import { parseCallout } from "./journal-callouts.js";
import { scanTables } from "./journal-tables.js";

const METADATA_LINE_PATTERN = /^(layout|lanes|stages)\s*:\s*(.*)$/i;

function splitList(value) {
  return String(value || "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

// Lowercased header text -> column index, so rows read columns by NAME, not
// fixed position — a GM can reorder columns, and an omitted optional column
// (no "Color") just leaves that field empty rather than misaligning others.
function headerIndex(headers) {
  const index = {};
  (headers || []).forEach((header, i) => {
    const key = String(header || "").trim().toLowerCase();
    if (key && !(key in index)) index[key] = i;
  });
  return index;
}

function cell(row, index, key) {
  const i = index[key];
  return i === undefined ? "" : String(row[i] || "").trim();
}

function isNodesTable(headers) {
  const index = headerIndex(headers);
  return "node" in index && "type" in index;
}

function isEdgesTable(headers) {
  const index = headerIndex(headers);
  return "from" in index && "to" in index;
}

function parseNodesTable(table) {
  const index = headerIndex(table.headers);
  const nodes = [];
  const seen = new Set();
  table.rows.forEach((row) => {
    const id = cell(row, index, "node");
    if (!id || seen.has(id.toLowerCase())) return;
    seen.add(id.toLowerCase());
    const type = cell(row, index, "type").toLowerCase() === "ref" ? "ref" : "placeholder";
    nodes.push({
      id,
      type,
      ref: cell(row, index, "ref"),
      lane: cell(row, index, "lane"),
      stage: cell(row, index, "stage"),
      x: Number(cell(row, index, "x")) || 0,
      y: Number(cell(row, index, "y")) || 0,
      color: cell(row, index, "color"),
    });
  });
  return nodes;
}

function parseEdgesTable(table) {
  const index = headerIndex(table.headers);
  return table.rows
    .map((row) => ({
      from: cell(row, index, "from"),
      to: cell(row, index, "to"),
      label: cell(row, index, "label"),
    }))
    .filter((edge) => edge.from && edge.to);
}

// `bodyRaw` is a [!story-board] callout's own body, same as
// journal-quests.js's extractQuests — never a whole page.
export function parseStoryBoardCallout(bodyRaw) {
  const text = String(bodyRaw || "");
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  let layoutMode = "freeform";
  let lanes = [];
  let stages = [];
  lines.forEach((line) => {
    const match = METADATA_LINE_PATTERN.exec(line.trim());
    if (!match) return;
    const key = match[1].toLowerCase();
    const value = match[2].trim();
    if (key === "layout") layoutMode = value.toLowerCase() === "swimlane" ? "swimlane" : "freeform";
    else if (key === "lanes") lanes = splitList(value);
    else if (key === "stages") stages = splitList(value);
  });

  const { tables } = scanTables(text);
  let nodes = [];
  let edges = [];
  tables.forEach((table) => {
    if (isNodesTable(table.headers)) nodes = parseNodesTable(table);
    else if (isEdgesTable(table.headers)) edges = parseEdgesTable(table);
  });
  // An edge naming a node no longer in the Nodes table is dropped, not kept
  // as a dangling reference — same tolerant handling every chip in this
  // suite gives an unmatched reference.
  const nodeIds = new Set(nodes.map((node) => node.id.toLowerCase()));
  edges = edges.filter((edge) => nodeIds.has(edge.from.toLowerCase()) && nodeIds.has(edge.to.toLowerCase()));

  return { layoutMode, lanes, stages, nodes, edges };
}

function escapeCell(value) {
  return String(value ?? "").replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
}

// Right-pads every cell to its column's widest cell — purely cosmetic (GFM
// parses unaligned tables identically), but matches how a GM would author
// one by hand and is easier to read in the raw editor.
function formatTable(headers, rows) {
  const allRows = [headers, ...rows];
  const widths = headers.map((_, col) => Math.max(...allRows.map((row) => escapeCell(row[col]).length)));
  const formatRow = (row) => `| ${row.map((value, col) => escapeCell(value).padEnd(widths[col])).join(" | ")} |`;
  const separator = `| ${widths.map((width) => "-".repeat(Math.max(width, 3))).join(" | ")} |`;
  return [formatRow(headers), separator, ...rows.map(formatRow)].join("\n");
}

// The reverse of parseStoryBoardCallout — deterministic; a visual-editor
// save always regenerates the whole callout body from this model rather than
// patching a hand-edited body's individual lines.
export function serializeStoryBoard(model) {
  const layoutMode = model?.layoutMode === "swimlane" ? "swimlane" : "freeform";
  const lanes = Array.isArray(model?.lanes) ? model.lanes : [];
  const stages = Array.isArray(model?.stages) ? model.stages : [];
  const nodes = Array.isArray(model?.nodes) ? model.nodes : [];
  const edges = Array.isArray(model?.edges) ? model.edges : [];

  const lines = [`Layout: ${layoutMode}`];
  if (lanes.length) lines.push(`Lanes: ${lanes.join(", ")}`);
  if (stages.length) lines.push(`Stages: ${stages.join(", ")}`);

  const nodesTable = formatTable(
    ["Node", "Type", "Ref", "Lane", "Stage", "X", "Y", "Color"],
    nodes.map((node) => [
      node.id,
      node.type === "ref" ? "ref" : "placeholder",
      node.ref || "",
      node.lane || "",
      node.stage || "",
      Math.round(Number(node.x) || 0),
      Math.round(Number(node.y) || 0),
      node.color || "",
    ])
  );
  const edgesTable = formatTable(
    ["From", "To", "Label"],
    edges.map((edge) => [edge.from, edge.to, edge.label || ""])
  );

  return [lines.join("\n"), nodesTable, edgesTable].join("\n\n");
}

// Every `[!story-board]` callout on a page, in document order — same
// marked-lexer-based discovery as journal-quests.js's extractQuests, for the
// same reason (guaranteed to agree with how a board actually renders).
export function extractStoryBoards(pageBody) {
  const marked = window.marked;
  if (!marked || typeof marked.lexer !== "function") return [];
  let tokens;
  try {
    tokens = marked.lexer(String(pageBody || ""));
  } catch (error) {
    return [];
  }
  const boards = [];
  tokens.forEach((token) => {
    if (token.type !== "blockquote") return;
    const parsed = parseCallout(token.text);
    if (!parsed || parsed.type !== "story-board") return;
    boards.push({ title: parsed.title, model: parseStoryBoardCallout(parsed.bodyRaw) });
  });
  return boards;
}

// Rebuilds one callout's raw markdown source (header line — type, fold
// marker, title — plus every body line) from parseCallout's parsed shape,
// each line re-prefixed with `> `. A blank body line still gets a bare `>`,
// not a truly empty line — GFM only keeps a blockquote going across a blank
// line when that line itself still starts with `>`; a genuinely empty line
// would silently end the blockquote early.
// Exported — handout.js's anchor-aware quest-fragment spotlight reuses this
// same reconstruction for a quest callout's own raw span.
export function buildCalloutRaw({ type, fold, title }, bodyRaw) {
  const header = `[!${type}]${fold || ""} ${title}`.trimEnd();
  const bodyLines = String(bodyRaw || "").split("\n");
  return [header, ...bodyLines].map((line) => (line ? `> ${line}` : ">")).join("\n");
}

// The core read-modify-write primitive every visual-editor action (drag a
// node, add/remove a node, connect/relabel an edge, promote a placeholder,
// switch layout mode) goes through: locate the named board's callout span in
// the raw page body, parse it, run `mutateFn(model) -> nextModel`, serialize
// the result, splice it back into the page body, return the new full body —
// ready for `dataManager.save("journal", pageId, {...})`.
// Position is found via `body.indexOf(token.raw, cursor)` from a moving
// cursor rather than assuming consecutive tokens' raw lengths sum to exact
// offsets — also correctly skips past an earlier token with byte-identical
// raw text (two boards that happen to render the same) to a later one.
// Returns the body UNCHANGED if the named board can't be found (a stale
// reference — edited elsewhere since) rather than throwing; callers should
// treat an unchanged return as "nothing happened."
export function updateStoryBoardInPage(pageBody, boardTitle, mutateFn) {
  const marked = window.marked;
  const body = String(pageBody || "");
  if (!marked || typeof marked.lexer !== "function") return body;
  let tokens;
  try {
    tokens = marked.lexer(body);
  } catch (error) {
    return body;
  }
  const targetKey = String(boardTitle || "").trim().toLowerCase();
  let cursor = 0;
  for (const token of tokens) {
    const rawIndex = body.indexOf(token.raw, cursor);
    if (rawIndex === -1) continue;
    if (token.type === "blockquote") {
      const parsed = parseCallout(token.text);
      if (parsed && parsed.type === "story-board" && parsed.title.trim().toLowerCase() === targetKey) {
        const model = parseStoryBoardCallout(parsed.bodyRaw);
        const nextModel = (typeof mutateFn === "function" ? mutateFn(model) : model) || model;
        const newCalloutRaw = buildCalloutRaw(parsed, serializeStoryBoard(nextModel));
        return body.slice(0, rawIndex) + newCalloutRaw + body.slice(rawIndex + token.raw.length);
      }
    }
    cursor = rawIndex + token.raw.length;
  }
  return body;
}
