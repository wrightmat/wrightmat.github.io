// Pure extraction of a page's markdown headings — no rendering, no DOM.
// Order here has to match the order marked() renders headings in (both are
// a straight top-to-bottom scan of the same raw text), since app.js pairs
// each entry up positionally with the matching rendered heading via
// `repo-heading-<index>` ids (see renderPreview/renderOutline there) rather
// than a text-based slug that could collide on a heading used twice.
import { wikiLinkPattern } from "./wiki-link-syntax.js";

const HEADING_PATTERN = /^(#{1,6})\s+(.*)$/;

// A heading like "## [[Grimlock]]" or "## [[Grimlock#Backstory|the old man]]"
// should read as "Grimlock"/"the old man" in the outline, not the raw
// [[...]] syntax (heading fragment included) — doesn't fit and isn't the
// point of a table of contents.
function stripWikiLinkSyntax(text) {
  return text.replace(wikiLinkPattern(), (match, title, heading, alias) => (alias || title).trim());
}

export function extractOutline(body) {
  const lines = String(body || "").split("\n");
  const raw = [];
  lines.forEach((line, index) => {
    const match = HEADING_PATTERN.exec(line.trim());
    if (!match) return;
    raw.push({ level: match[1].length, text: stripWikiLinkSyntax(match[2].trim()), line: index });
  });
  // `depth` reflects actual nesting under the headings that came before it,
  // not its raw `#` count — a page that only ever uses ## and ### (no #)
  // should still read with ## flush against the left edge, not artificially
  // indented one level in just because "2" isn't "1"; and a level that
  // jumps (# straight to ###, no ## in between) nests one step under #,
  // not two, since there's no ## sibling it's actually nesting under.
  const stack = [];
  return raw.map((heading) => {
    while (stack.length && stack[stack.length - 1] >= heading.level) stack.pop();
    const depth = stack.length;
    stack.push(heading.level);
    return { ...heading, depth };
  });
}
