// Pure extraction of a page's markdown headings — no rendering, no DOM.
// Order here must match marked()'s own render order (both are a top-to-
// bottom scan of the same raw text) since app.js pairs entries positionally
// with rendered `repo-heading-<index>` ids rather than a text slug, which
// could collide on a repeated heading.
import { wikiLinkPattern } from "./wiki-link-syntax.js";

const HEADING_PATTERN = /^(#{1,6})\s+(.*)$/;

// "## [[Grimlock|the old man]]" should read as "the old man" in the
// outline, not the raw [[...]] syntax.
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
  // `depth` reflects nesting relative to prior headings, not raw `#` count —
  // a page using only ##/### still renders ## flush left, and a level that
  // jumps (# straight to ###) nests one step, not two.
  const stack = [];
  return raw.map((heading) => {
    while (stack.length && stack[stack.length - 1] >= heading.level) stack.pop();
    const depth = stack.length;
    stack.push(heading.level);
    return { ...heading, depth };
  });
}

// Case-insensitive exact match against a page's own outline — index, or -1.
export function findHeadingByText(body, headingText) {
  const target = (headingText || "").trim().toLowerCase();
  if (!target) return -1;
  const outline = extractOutline(body);
  return outline.findIndex((heading) => (heading.text || "").trim().toLowerCase() === target);
}
