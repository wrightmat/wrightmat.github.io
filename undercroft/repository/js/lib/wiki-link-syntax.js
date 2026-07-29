// Shared `[[Title]]` / `[[Title#Heading]]` / `[[Title|Alias]]` /
// `[[Title#Heading|Alias]]` syntax — one pattern, used everywhere this suite
// parses wiki-links (markdown.js's rendering, journal-links.js's backlink
// scanning, journal-outline.js's heading-text display), so "what counts as a
// wiki-link" can't drift between those call sites. `#Heading` (Obsidian's own
// convention for linking to a specific section of another page) is a later
// addition — kept here, not duplicated per caller, for the same reason.
//
// Returns a FRESH RegExp instance on every call rather than one shared
// module-level object — the `g` flag makes a shared instance stateful via
// `lastIndex`, a classic footgun for any caller doing more than a single
// `.exec()`/`.replace()` pass (journal-links.js's own previous copy had to
// manually reset `lastIndex = 0` before each use to avoid it).
export function wikiLinkPattern() {
  return /\[\[([^\]|#[]+?)(?:#([^\]|]+))?(?:\|([^\]]+))?\]\]/g;
}
