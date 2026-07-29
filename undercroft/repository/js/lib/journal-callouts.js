// Obsidian-style callouts (https://obsidian.md/help/callouts) — pure
// parsing/lookup here, no marked/DOM dependency, same split
// journal-encounter.js's own parseEncounterBlock uses (that file parses,
// markdown.js renders). A callout is a blockquote whose first line is
// `[!type]`, optionally followed directly by a fold marker (`+`/`-`) and a
// title:
//
//   > [!danger]- Custom title
//   > Body, itself full markdown.
//
// `type` selects the icon/color below (case-insensitive, alias-aware); an
// unrecognized type still renders (Obsidian allows arbitrary custom types),
// just with DEFAULT_CALLOUT's generic look. No title text after `[!type]`
// defaults to the type identifier itself, title-cased — same rule Obsidian
// documents. The fold marker is absent (never foldable, no toggle affordance
// at all), `+` (foldable, open by default), or `-` (foldable, collapsed by
// default) — markdown.js maps these to a plain `<div>` or a native
// `<details>`/`<summary>` pair respectively, which is what actually makes a
// callout collapsible in View mode with no extra click-handling JS needed.
//
// Colors are resolved here (not left as bare keywords for markdown.js to
// interpret) because this module is also what handout.js's Dashboard widget
// renders through via markdown.js's shared renderMarkdown — a page that
// never loads Repository's own stylesheet — so, same reasoning
// markdown.js's own applyWikiLinkStyling/styleAsChip already establish for
// exactly this cross-tool reuse, a callout's look has to travel as inline
// styles set from these resolved values, not a CSS class alone.

// Bootstrap's own extended named-color palette (already used suite-wide —
// see common/css/shell.css's own --undercroft-tool-accent, which pulls from
// this exact same set) — reused here instead of inventing a parallel color
// system, and automatically consistent with whatever light/dark theme
// Bootstrap itself is rendering under. Hex/rgb triples are the same fixed
// defaults Bootstrap 5.3 ships (unchanged since 5.0) — only ever used as the
// `var(--bs-x, FALLBACK)` fallback, for the rare host page where Bootstrap's
// own CSS somehow isn't loaded.
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

function resolveColor(name) {
  const entry = BOOTSTRAP_COLORS[name] || BOOTSTRAP_COLORS.secondary;
  return {
    value: `var(--bs-${name}, ${entry.hex})`,
    rgbValue: `var(--bs-${name}-rgb, ${entry.rgb})`,
  };
}

// The 13 types Obsidian documents as built in, with their documented
// aliases — "the basic types," per the user's own ask, nothing from the
// advanced feature set (custom CSS-only types, nested callouts as a
// deliberate feature, etc. — those aren't special-cased here, but nesting
// falls out for free since markdown.js re-parses a callout's body as
// ordinary markdown, which would hit this same machinery again for a nested
// `> [!type]` line).
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
};

const DEFAULT_CALLOUT = { icon: "tabler:message-circle", color: "secondary" };

const ALIAS_TO_TYPE = Object.entries(CALLOUT_TYPES).reduce((map, [type, def]) => {
  map[type] = type;
  (def.aliases || []).forEach((alias) => {
    map[alias] = type;
  });
  return map;
}, {});

// Exported so an eventual "insert callout" editor toolbar button could list
// every known type/alias without duplicating this table — not built yet,
// not part of this ask, but free to add later against this same export.
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
// own token.text for a "blockquote" token — every leading `>` and the single
// space after it already stripped, multi-line structure otherwise intact) —
// see markdown.js's own renderer override for where this comes from. Returns
// null for an ordinary blockquote (no `[!type]` marker on its first line),
// otherwise `{ type, style, title, fold, bodyRaw }` — `fold` is `""`
// (not foldable), `"+"` (foldable, open by default), or `"-"` (foldable,
// collapsed by default); `title` is already resolved to its default
// (title-cased type identifier) when the author didn't write one of their
// own; `bodyRaw` is everything after the first line, still raw markdown,
// ready for the caller to render independently (empty string for a
// title-only callout).
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
