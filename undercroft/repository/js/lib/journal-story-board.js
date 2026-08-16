// Story Boards as Repository callouts — a `[!story-board]` callout IS a
// board: its title is the board's name (scoped to its page, multiple
// boards per page allowed, unique per page — same convention
// journal-quests.js's own quests use), its body is plain GFM content: a
// couple of `Key: value` metadata lines, a Nodes table, and an Edges table.
// No new Library kind, no JSON blob field — this is deliberately just more
// markdown, parsed/serialized here and rendered as a real interactive
// canvas by story-board-canvas.js (mounted by repository/js/app.js after
// the ordinary renderMarkdown pass — see that file's own header comment
// for why the interactive canvas itself stays out of markdown.js).
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
// A node's own "Node" column is its display name AND its reference key for
// the Edges table's From/To columns — no separate opaque id, so a
// hand-editing GM never has to invent or track one; must be unique within
// the board (same "one flat namespace, uniqueness required" convention
// quest titles use within a page). A `Ref` cell is the same `kindId:Name`
// compound text (or `quest:Title`) already used for inline kind-reference
// chips elsewhere in this suite — journal-story-board.js never needs to
// interpret it itself, only round-trip it; the visual canvas resolves it
// when it actually needs to (a click, the node inspector).
import { parseCallout } from "./journal-callouts.js";
import { scanTables } from "./journal-tables.js";

const METADATA_LINE_PATTERN = /^(layout|lanes|stages)\s*:\s*(.*)$/i;

function splitList(value) {
  return String(value || "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

// Lowercased header text -> column index, so row parsing reads columns by
// NAME rather than fixed position — a hand-editing GM can reorder columns,
// and a table missing an optional column (no "Color" column at all, say)
// just leaves that field empty rather than misaligning every other one.
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

// `bodyRaw` is a [!story-board] callout's own body — the same piece
// markdown.js's callout renderer/journal-quests.js's own extractQuests
// already work with, never a whole page.
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
  // Edges naming a node that isn't (or is no longer) in the Nodes table are
  // dropped rather than kept as a dangling reference — the same "an
  // unmatched reference just doesn't do anything" tolerance every chip in
  // this suite already follows, not a hard validation error.
  const nodeIds = new Set(nodes.map((node) => node.id.toLowerCase()));
  edges = edges.filter((edge) => nodeIds.has(edge.from.toLowerCase()) && nodeIds.has(edge.to.toLowerCase()));

  return { layoutMode, lanes, stages, nodes, edges };
}

function escapeCell(value) {
  return String(value ?? "").replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
}

// Right-pads every cell in a column to that column's own widest cell (across
// header + every row) — purely cosmetic (GFM tables parse identically
// unaligned), but matches what a GM authoring one by hand would naturally
// write, and reads far more easily in the raw-markdown editor.
function formatTable(headers, rows) {
  const allRows = [headers, ...rows];
  const widths = headers.map((_, col) => Math.max(...allRows.map((row) => escapeCell(row[col]).length)));
  const formatRow = (row) => `| ${row.map((value, col) => escapeCell(value).padEnd(widths[col])).join(" | ")} |`;
  const separator = `| ${widths.map((width) => "-".repeat(Math.max(width, 3))).join(" | ")} |`;
  return [formatRow(headers), separator, ...rows.map(formatRow)].join("\n");
}

// The reverse of parseStoryBoardCallout — deterministic (see this file's
// own header comment / the plan's stated tradeoff: a visual-editor save
// always regenerates the whole callout body from this model, it never
// patches a hand-edited body's individual lines).
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
// marked-lexer-based discovery as journal-quests.js's own extractQuests
// (see that file's own header comment for why: guaranteed to agree with
// how a board actually renders, including every block-parsing edge case a
// regex scanner would have to reinvent).
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

// Rebuilds one callout's own raw markdown source (the header line — type,
// fold marker, title — plus every body line) from parseCallout's own
// parsed shape, each line re-prefixed with `> `. A blank body line still
// gets a bare `>` (not a truly empty line) — GFM only keeps a blockquote
// going across a blank line when that line ITSELF still starts with `>`;
// a genuinely empty line would silently end the blockquote early and leave
// everything after it as stray top-level content.
// Exported — common/js/lib/widgets/handout.js's own anchor-aware
// quest-fragment spotlight reuses this exact reconstruction (a quest
// callout's own raw span, standalone) rather than a second copy.
export function buildCalloutRaw({ type, fold, title }, bodyRaw) {
  const header = `[!${type}]${fold || ""} ${title}`.trimEnd();
  const bodyLines = String(bodyRaw || "").split("\n");
  return [header, ...bodyLines].map((line) => (line ? `> ${line}` : ">")).join("\n");
}

// The core read-modify-write primitive every visual-editor action (drag a
// node, add/remove a node, connect/relabel an edge, promote a placeholder,
// switch layout mode) goes through: locate the named board's own callout
// span in the raw page body, parse it, run `mutateFn(model) -> nextModel`,
// serialize the result, splice it back into the page body, and return the
// new full body — ready for `dataManager.save("journal", pageId, {...})`.
// Position is found via `body.indexOf(token.raw, cursor)` — searching for
// each token's own exact raw text from a moving cursor, not by assuming
// consecutive tokens' raw lengths sum to exact offsets (safer if marked
// ever normalizes any whitespace between tokens; the cursor still
// correctly skips past an EARLIER token with identical raw text to a
// later one, e.g. two boards that happen to render byte-identical). Returns
// the body UNCHANGED if the named board can't be found (a stale reference —
// the page was edited elsewhere since) rather than throwing; callers should
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
