// Rollable named tables — an ordinary GFM table in a Journal page, named with
// a `^blockId` marker line directly underneath (Obsidian's "block reference"
// convention), rollable from anywhere dice already work via
// `` `dice:[[Page#^blockId]]` `` (Repository's inline chips — journal-dice.js)
// or the Dashboard Dice Roller widget, through one shared resolver here
// instead of a per-consumer reimplementation:
//
//   | Roll  | Result              |
//   | ----- | ------------------- |
//   | 01-02 | A merchant convoy   |
//   | 03-10 | Nothing of note     |
//   ^northern-sea-encounters
//
// Pure parsing/rolling/lookup only, no marked/DOM dependency for the base
// pieces (journal-encounter.js's parseEncounterBlock uses the same split:
// this parses, markdown.js renders). `resolveTableReference`/
// `listRollableTables` are the exception (need dataManager to list journal
// pages) but stay here since they're still pure Repository domain knowledge.
//
// NOT the same concept as forge/js/lib/tables.js's own "tables" (procedural
// NPC-generation weighting tables) — unrelated.
import { fetchKindEntriesWithIds } from "../../../common/js/lib/content-fetch.js";
import { wikiLinkPattern } from "./wiki-link-syntax.js";

const BLOCK_ID_LINE_PATTERN = /^\s*\^([A-Za-z0-9_-]+)\s*$/;

// Splits one `| a | b |`-shaped line into trimmed cells, honoring `\|` as a
// literal escaped pipe rather than a delimiter.
function splitTableRow(line) {
  const trimmed = String(line || "").trim();
  const withoutEdges = trimmed.replace(/^\|/, "").replace(/\|$/, "");
  const cells = [];
  let current = "";
  for (let index = 0; index < withoutEdges.length; index += 1) {
    const char = withoutEdges[index];
    if (char === "\\" && withoutEdges[index + 1] === "|") {
      current += "|";
      index += 1;
    } else if (char === "|") {
      cells.push(current.trim());
      current = "";
    } else {
      current += char;
    }
  }
  cells.push(current.trim());
  return cells;
}

function isTableRowLine(line) {
  return String(line || "").trim().length > 0 && line.includes("|");
}

// The delimiter row every GFM table has between header and body — cells made
// up of only `-`/`:` (`---`, `:--`, `--:`, `:-:`).
function isSeparatorRowLine(line) {
  const cells = splitTableRow(line);
  return cells.length > 0 && cells.every((cell) => /^:?-+:?$/.test(cell));
}

// One scan of the page, returning every GFM table found (named or not) with
// enough position info (`markerLine`) for stripNamedTableMarkers to remove
// just the marker lines. Tables with no `^blockId` line right after are
// still detected (so the scan only runs once) but filtered out by both
// public functions below — an unnamed table is left completely alone.
// Exported so journal-story-board.js can reuse this exact GFM table-scanning
// primitive for its own Nodes/Edges tables — a [!story-board] callout's
// tables have no `^blockId` marker at all, but the underlying "find every
// `| a | b |` + separator-row table" scan is identical.
export function scanTables(body) {
  const lines = String(body || "").replace(/\r\n/g, "\n").split("\n");
  const tables = [];
  let index = 0;
  while (index < lines.length) {
    if (isTableRowLine(lines[index]) && index + 1 < lines.length && isSeparatorRowLine(lines[index + 1])) {
      const headers = splitTableRow(lines[index]);
      let cursor = index + 2;
      const rows = [];
      while (cursor < lines.length && isTableRowLine(lines[cursor]) && !isSeparatorRowLine(lines[cursor])) {
        rows.push(splitTableRow(lines[cursor]));
        cursor += 1;
      }
      let markerLine = -1;
      let blockId = "";
      const markerMatch = cursor < lines.length ? BLOCK_ID_LINE_PATTERN.exec(lines[cursor]) : null;
      if (markerMatch) {
        markerLine = cursor;
        blockId = markerMatch[1];
      }
      tables.push({ blockId, headers, rows, markerLine });
      index = markerLine >= 0 ? markerLine + 1 : cursor;
      continue;
    }
    index += 1;
  }
  return { lines, tables };
}

// Every NAMED table on the page, in document order.
export function extractNamedTables(body) {
  return scanTables(body)
    .tables.filter((table) => table.blockId)
    .map(({ blockId, headers, rows }) => ({ blockId, headers, rows }));
}

// Removes every `^blockId` marker line — CommonMark doesn't know that
// syntax, so left in, a caret-only line breaks out of the table and renders
// as a stray paragraph underneath it. The table itself is untouched.
export function stripNamedTableMarkers(body) {
  const { lines, tables } = scanTables(body);
  const markerLines = new Set(tables.filter((table) => table.markerLine >= 0).map((table) => table.markerLine));
  if (!markerLines.size) return body;
  return lines.filter((_, lineIndex) => !markerLines.has(lineIndex)).join("\n");
}

const RANGE_CELL_PATTERN = /^(\d+)(?:\s*[-–—]\s*(\d+))?$/;

function parseRangeCell(cell) {
  const match = RANGE_CELL_PATTERN.exec(String(cell || "").trim());
  if (!match) return null;
  const low = parseInt(match[1], 10);
  const high = match[2] !== undefined ? parseInt(match[2], 10) : low;
  if (Number.isNaN(low) || Number.isNaN(high) || high < low) return null;
  return { low, high };
}

// Rolls against a table's own first column. If every row's first cell parses
// as a bare number or range (`03`, `04-06` — a weighted d100-style table,
// not one-row-per-face), the die size is the max value seen and the roll
// matches by range. Otherwise (a plain unnumbered list) falls back to a
// uniform roll over the row count, one row per face. Returns
// `{ roll, dieSize, row, headers }`, or null for an empty table.
export function rollAgainstTable({ headers = [], rows = [] } = {}, { random = Math.random } = {}) {
  if (!rows.length) return null;
  const ranges = rows.map((row) => parseRangeCell(row[0]));
  const isRanged = ranges.every((range) => range !== null);
  if (isRanged) {
    const dieSize = Math.max(...ranges.map((range) => range.high));
    const roll = Math.floor(random() * dieSize) + 1;
    const rowIndex = ranges.findIndex((range) => roll >= range.low && roll <= range.high);
    return { roll, dieSize, row: rows[rowIndex >= 0 ? rowIndex : rows.length - 1], headers };
  }
  const dieSize = rows.length;
  const roll = Math.floor(random() * dieSize) + 1;
  return { roll, dieSize, row: rows[roll - 1], headers };
}

// A `dice:`/rollExpression argument shaped like a wiki-link with a block-
// reference heading (`[[Page#^blockId]]`) — the same [[...]] syntax
// markdown.js's wiki-links already parse (the heading-capture group already
// accepts a leading "^" unchanged). Returns null for a plain numeric
// expression (`2d6`, `1d20+3`) or an ordinary page link with no `^`-prefixed
// heading — the whole trimmed expression has to be just the link.
export function parseTableReferenceExpression(expression) {
  const trimmed = String(expression || "").trim();
  if (!trimmed) return null;
  const match = wikiLinkPattern().exec(trimmed);
  if (!match || match[0] !== trimmed) return null;
  const title = (match[1] || "").trim();
  const heading = (match[2] || "").trim();
  if (!title || !heading.startsWith("^")) return null;
  const blockId = heading.slice(1).trim();
  if (!blockId) return null;
  return { title, blockId };
}

// A short display string for a table roll's own outcome row — used by both
// journal-dice.js's chip and the Dashboard Dice Roller widget's result line.
// When the first column is itself a roll number/range (a real ranged table),
// it's kept and shown alongside the rest ("03-10: Nothing of note") since
// which range was hit is meaningful on its own. For a table whose first
// column isn't a roll index, every column is real content, joined in order.
export function describeTableRow(row) {
  const cells = Array.isArray(row) ? row : [];
  if (!cells.length) return "";
  if (cells.length === 1) return cells[0];
  return parseRangeCell(cells[0]) ? `${cells[0]}: ${cells.slice(1).join(" — ")}` : cells.join(" — ");
}

async function fetchJournalEntries(dataManager) {
  return fetchKindEntriesWithIds(dataManager, "journal").catch(() => []);
}

// Looks up a named table by page title (case-insensitive, same convention as
// journal-links.js's buildTitleIndex) + blockId, and rolls it. Returns
// `{ pageTitle, blockId, roll, dieSize, row, headers }`, or null if the page
// or table can't be found — dice-roll.js's rollExpression turns that into a
// user-facing error.
export async function resolveTableReference(dataManager, { title, blockId } = {}) {
  if (!dataManager || !title || !blockId) return null;
  const targetTitle = String(title).trim().toLowerCase();
  const targetBlockId = String(blockId).trim();
  const entries = await fetchJournalEntries(dataManager);
  const page = entries.find((entry) => String(entry.entity?.title || "").trim().toLowerCase() === targetTitle);
  if (!page) return null;
  const table = extractNamedTables(page.entity?.body).find((candidate) => candidate.blockId === targetBlockId);
  if (!table) return null;
  const outcome = rollAgainstTable(table);
  if (!outcome) return null;
  return { pageTitle: page.entity?.title || title, blockId: targetBlockId, ...outcome };
}

// Every named table across the whole journal, for the Dice Roller widget's
// autocomplete — `[{ pageTitle, blockId }]`.
export async function listRollableTables(dataManager) {
  if (!dataManager) return [];
  const entries = await fetchJournalEntries(dataManager);
  const results = [];
  entries.forEach((entry) => {
    const pageTitle = entry.entity?.title || "Untitled page";
    extractNamedTables(entry.entity?.body).forEach((table) => {
      results.push({ pageTitle, blockId: table.blockId });
    });
  });
  return results;
}
