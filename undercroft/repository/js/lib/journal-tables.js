// Rollable named tables — an ordinary GFM table in a Journal page, named with
// a `^blockId` marker line directly underneath it (Obsidian's own "block
// reference" convention), rollable from anywhere dice already work via
// `` `dice:[[Page#^blockId]]` `` (Repository's inline chips — journal-dice.js)
// or the Dashboard Dice Roller widget, through one shared resolver here
// rather than a per-consumer reimplementation:
//
//   | Roll  | Result              |
//   | ----- | ------------------- |
//   | 01-02 | A merchant convoy   |
//   | 03-10 | Nothing of note     |
//   ^northern-sea-encounters
//
// Pure parsing/rolling/lookup only — no marked/DOM dependency for the base
// pieces (same split journal-encounter.js's own parseEncounterBlock uses:
// that file parses, markdown.js renders). `resolveTableReference`/
// `listRollableTables` are the one exception (they need dataManager to list
// journal pages), kept in this same file since they're still pure Repository
// domain knowledge, not rendering.
//
// NOT the same concept as forge/js/lib/tables.js's own "tables" (procedural
// NPC-generation weighting tables) — unrelated, nothing here touches Forge.
import { fetchKindEntriesWithIds } from "../../../common/js/lib/content-fetch.js";
import { wikiLinkPattern } from "./wiki-link-syntax.js";

const BLOCK_ID_LINE_PATTERN = /^\s*\^([A-Za-z0-9_-]+)\s*$/;

// Splits one `| a | b |`-shaped line into trimmed cells, honoring `\|` as a
// literal escaped pipe (standard GFM table syntax) rather than a delimiter.
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

// The delimiter row every GFM table has between its header and body — cells
// made up of only `-`/`:` (`---`, `:--`, `--:`, `:-:`).
function isSeparatorRowLine(line) {
  const cells = splitTableRow(line);
  return cells.length > 0 && cells.every((cell) => /^:?-+:?$/.test(cell));
}

// One scan of the page, returning every GFM table found (named or not) with
// enough position info (`markerLine`) for stripNamedTableMarkers to remove
// just the marker lines, not the tables themselves. Tables with no `^blockId`
// line immediately after are still detected (so the scan only has to run
// once) but filtered out by both public functions below — an ordinary,
// unnamed table is left completely alone.
// Exported so journal-story-board.js can reuse the exact same GFM
// table-scanning primitive for its own Nodes/Edges tables — a
// [!story-board] callout's tables have no `^blockId` marker at all (that's
// this file's own named-table-specific concept), but the underlying
// "find every `| a | b |` + separator-row table in this text" scan is
// identical, and worth having exactly one implementation of.
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

// Removes every `^blockId` marker line this page's own named tables use —
// CommonMark doesn't know that syntax, so left in, a caret-only line breaks
// out of the table and renders as a stray paragraph underneath it. The table
// itself is untouched; only the marker line disappears. Returns the body
// unchanged (not even CRLF-normalized) if there's nothing to strip.
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
// as a bare number or a range (`03`, `04-06`) — real weighted d100-style
// tables, not just one-row-per-face lists — the die size is the max value
// seen and the roll matches by range. Otherwise (a plain list with no
// numbering at all) falls back to a uniform roll over the row count, one row
// per face. Returns `{ roll, dieSize, row, headers }`, or null for an empty
// table.
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
// markdown.js's own wiki-links already parse (the heading-capture group
// already accepts a leading "^" unchanged; no separate syntax to teach
// anything). Returns null for a plain numeric expression (`2d6`, `1d20+3`)
// or an ordinary page link with no `^`-prefixed heading. The whole trimmed
// expression has to be just the link — not a link embedded in other text.
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
// journal-dice.js's chip and the Dashboard Dice Roller widget's result line,
// so table results read consistently everywhere. When the first column is
// itself a roll number/range (a real ranged table, e.g. "03-10"), it's kept
// and shown alongside the rest ("03-10: Nothing of note") rather than
// dropped — seeing which range was actually hit is meaningful on its own,
// distinct from the abstract die roll shown elsewhere ("d10 → 6"). For a
// table whose first column ISN'T a roll index (the uniform-fallback case,
// or any other multi-column table), every column is real content, so
// nothing gets dropped — just joined in order.
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
// journal-links.js's own buildTitleIndex) + blockId, and rolls it. Returns
// `{ pageTitle, blockId, roll, dieSize, row, headers }`, or null if the page
// or the table within it can't be found — the caller (dice-roll.js's
// rollExpression) is what turns that into a user-facing error.
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
