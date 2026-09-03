// Obsidian-style callouts (https://obsidian.md/help/callouts) — pure
// parsing/lookup here, no marked/DOM dependency (markdown.js renders). A
// callout is a blockquote whose first line is `[!type]`, optionally
// followed by a fold marker (`+`/`-`) and a title:
//
//   > [!danger]- Custom title
//   > Body, itself full markdown.
//
// An unrecognized type still renders, with DEFAULT_CALLOUT's generic look.
// No title text defaults to the type identifier, title-cased. Fold marker:
// absent (not foldable), `+` (open by default), `-` (collapsed by default)
// — markdown.js maps these to a plain `<div>` or a native `<details>` pair.
//
// Colors are resolved here rather than left as bare keywords, since this
// also renders through handout.js's Dashboard widget, which never loads
// Repository's own stylesheet — a callout's look has to travel as inline
// styles.

// Bootstrap's own extended named-color palette (also used by shell.css's
// --undercroft-tool-accent) — automatically consistent with whichever
// theme Bootstrap is rendering under. Hex/rgb triples are only ever the
// `var(--bs-x, FALLBACK)` fallback for the rare host where Bootstrap's own
// CSS isn't loaded.
const BOOTSTRAP_COLORS = {
  blue: { hex: "#0d6efd", rgb: "13, 110, 253" },
  teal: { hex: "#20c997", rgb: "32, 201, 151" },
  cyan: { hex: "#0dcaf0", rgb: "13, 202, 240" },
  green: { hex: "#198754", rgb: "25, 135, 84" },
  yellow: { hex: "#ffc107", rgb: "255, 193, 7" },
  orange: { hex: "#fd7e14", rgb: "253, 126, 20" },
  red: { hex: "#dc3545", rgb: "220, 53, 69" },
  pink: { hex: "#d63384", rgb: "214, 51, 132" },
  purple: { hex: "#6f42c1", rgb: "111, 66, 193" },
  secondary: { hex: "#6c757d", rgb: "108, 117, 125" },
};

// Exported so journal-quests.js's own status badge can resolve the same
// Bootstrap-named colors, rather than inventing a second color system.
export function resolveColor(name) {
  const entry = BOOTSTRAP_COLORS[name] || BOOTSTRAP_COLORS.secondary;
  return {
    value: `var(--bs-${name}, ${entry.hex})`,
    rgbValue: `var(--bs-${name}-rgb, ${entry.rgb})`,
  };
}

// The 13 types Obsidian documents as built in, with their aliases. Nesting
// falls out for free since markdown.js re-parses a callout's body as
// ordinary markdown, hitting this same machinery again for a nested line.
export const CALLOUT_TYPES = {
  note: { icon: "tabler:pencil", color: "blue" },
  abstract: { icon: "tabler:clipboard-list", color: "teal", aliases: ["summary", "tldr"] },
  info: { icon: "tabler:info-circle", color: "cyan" },
  todo: { icon: "tabler:list-check", color: "blue" },
  tip: { icon: "tabler:bulb", color: "cyan", aliases: ["hint", "important"] },
  success: { icon: "tabler:circle-check", color: "green", aliases: ["check", "done"] },
  question: { icon: "tabler:help-circle", color: "orange", aliases: ["help", "faq"] },
  warning: { icon: "tabler:alert-triangle", color: "yellow", aliases: ["caution", "attention"] },
  failure: { icon: "tabler:circle-x", color: "orange", aliases: ["fail", "missing"] },
  danger: { icon: "tabler:alert-octagon", color: "red", aliases: ["error"] },
  bug: { icon: "tabler:bug", color: "pink" },
  example: { icon: "tabler:list-details", color: "purple" },
  quote: { icon: "tabler:quote", color: "secondary", aliases: ["cite"] },
  // This suite's own addition — a GM-authored quest (journal-quests.js).
  // Parsing/nesting already work generically for any [!type]; this just
  // gives it a real look instead of DEFAULT_CALLOUT's generic gray.
  quest: { icon: "tabler:map-2", color: "purple" },
  // Also this suite's own — authored planning structure (journal-story-
  // board.js). Rendered as a plain callout here; app.js separately upgrades
  // a `[data-callout="story-board"]` element into a live interactive canvas.
  "story-board": { icon: "tabler:layout-board-split", color: "teal" },
};

const DEFAULT_CALLOUT = { icon: "tabler:message-circle", color: "secondary" };

const ALIAS_TO_TYPE = Object.entries(CALLOUT_TYPES).reduce((map, [type, def]) => {
  map[type] = type;
  (def.aliases || []).forEach((alias) => {
    map[alias] = type;
  });
  return map;
}, {});

export function resolveCalloutStyle(rawType) {
  const key = String(rawType || "").toLowerCase();
  const def = CALLOUT_TYPES[ALIAS_TO_TYPE[key]] || DEFAULT_CALLOUT;
  return { icon: def.icon, ...resolveColor(def.color) };
}

function titleCase(word) {
  const trimmed = String(word || "").trim();
  return trimmed ? trimmed[0].toUpperCase() + trimmed.slice(1) : "";
}

// `rawBlockquoteText` is a blockquote's already-dedented content (marked's
// token.text — leading `>` and the space after it already stripped).
// Returns null for an ordinary blockquote, otherwise
// `{type, style, title, fold, bodyRaw}` — `bodyRaw` is everything after the
// first line, still raw markdown, ready for the caller to render.
const CALLOUT_HEADER_PATTERN = /^\[!([A-Za-z][\w-]*)\]([+-]?)[ \t]*([^\n]*)\n?([\s\S]*)$/;

export function parseCallout(rawBlockquoteText) {
  const normalized = String(rawBlockquoteText || "")
    .replace(/\r\n/g, "\n")
    .replace(/^\n+/, "");
  const match = CALLOUT_HEADER_PATTERN.exec(normalized);
  if (!match) return null;
  const [, rawType, fold, rawTitle, bodyRaw] = match;
  return {
    type: rawType.toLowerCase(),
    style: resolveCalloutStyle(rawType),
    title: rawTitle.trim() || titleCase(rawType),
    fold,
    bodyRaw,
  };
}
