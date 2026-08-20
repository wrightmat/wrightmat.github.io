// Compact Game Log widget — mounted as a Dashboard widget card, and (as of
// the Game Log/Now Showing parity pass) inline in Workbench's own
// collapsible section too (workbench-character-view.js) — one real
// implementation, not two independently-drifting copies of the same
// getGroupLog/createGroupLogEntry-backed log.
import { connectLiveStream } from "../live.js";
import { el, setElementVisible } from "../dom.js";
import { resolveToolHref, resolveToolContextPath } from "../app-shell.js";
import { fetchKindEntrySummaries } from "../content-fetch.js";

const POLL_INTERVAL_MS = 30000;
const CLEARED_WATERMARK_PREFIX = "undercroft.gamelog.clearedBefore.";
// Separate from CLEARED_WATERMARK_PREFIX above — that one hides entries
// entirely; this one only tracks "have I seen a mention that arrived since I
// last had this open," never hides anything. Advances to "now" when the
// widget unmounts (see initGameLogWidget's own destroy()), not on every
// render — so a whisper that arrives WHILE the log is open stays flagged as
// new for the rest of that viewing session, not just until the next poll.
const MENTION_SEEN_WATERMARK_PREFIX = "undercroft.gamelog.mentionsSeenBefore.";

// "Clear log" only ever hides entries from *this browser's own view* of a
// campaign's log — the log itself is shared, persistent history for the
// whole group (server/groups.py has no delete-entries capability at all, by
// design), so clearing here is a purely local watermark, not a server call.
// Keyed by whatever this widget instance itself uses to identify the log
// (groupId normally; shareToken for an anonymous share-link viewer with no
// groupId) — same fallback dashboard.js's own catalog entry computes when
// triggering a clear, so the two stay in sync.
function watermarkKey(scope) {
  return `${CLEARED_WATERMARK_PREFIX}${scope}`;
}

// server/groups.py stamps every entry's created_at via Python's
// `datetime.utcnow().isoformat()` — a NAIVE string with no "Z"/offset
// suffix, even though the instant it represents is UTC. JS's Date.parse (and
// `new Date(...)`) both treat a zone-less ISO string as *local* time, not
// UTC — appending "Z" when that naive shape is detected is what makes it
// actually mean UTC, for every consumer, not just the watermark comparisons
// below. Confirmed real bug this also fixes: formatTimestamp's own display
// used to skip this normalization entirely, so every entry's shown time was
// off by the viewer's own UTC offset (displaying the raw UTC clock digits,
// unconverted, as if they were already local — which is exactly why it read
// as "showing UTC" rather than merely "off by a few minutes").
// Exported — the Audio Recorder widget's own combined session-record export
// (audio-recorder.js) sorts transcript lines and Game Log entries into one
// chronological document, and needs this exact same UTC-string normalization
// to compare their timestamps correctly against each other.
export function normalizeTimestamp(value) {
  if (!value) return "";
  return /[zZ]|[+-]\d{2}:?\d{2}$/.test(value) ? value : `${value}Z`;
}

export function parseTimestamp(value) {
  if (!value) return 0;
  return Date.parse(normalizeTimestamp(value)) || 0;
}

function loadClearedWatermark(scope) {
  if (!scope) return "";
  try {
    return localStorage.getItem(watermarkKey(scope)) || "";
  } catch (error) {
    return "";
  }
}

function mentionSeenWatermarkKey(scope) {
  return `${MENTION_SEEN_WATERMARK_PREFIX}${scope}`;
}

function loadMentionSeenWatermark(scope) {
  if (!scope) return "";
  try {
    return localStorage.getItem(mentionSeenWatermarkKey(scope)) || "";
  } catch (error) {
    return "";
  }
}

function saveMentionSeenWatermark(scope) {
  if (!scope) return;
  try {
    localStorage.setItem(mentionSeenWatermarkKey(scope), new Date().toISOString());
  } catch (error) {
    // Local storage unavailable — harmless no-op, same as clearGameLogView's
    // own graceful-degrade; worst case, a mention just stays flagged "new"
    // on the very next open instead of clearing.
  }
}

// Exported so dashboard.js's Game Log catalog entry (the header/inspector
// "Clear log" buttons) can set this without reaching into this widget's own
// module-private state — `scope` is `groupId || shareToken`, same as the
// widget's own internal use below.
export function clearGameLogView(scope) {
  if (!scope) return;
  try {
    localStorage.setItem(watermarkKey(scope), new Date().toISOString());
  } catch (error) {
    // Local storage unavailable (private browsing, quota) — nothing to clear
    // locally; harmless no-op, same graceful-degrade as dashboard.js's own
    // saveLocalSetting.
  }
}

// Exported so dashboard.js's spotlight panel can phrase things the same way
// this widget's own inline entry does — one label table, not two copies
// that could drift apart. Also the fallback text whenever a real resource
// title (fetched separately, see describeEntry/dashboard.js's own title
// cache) isn't available yet or doesn't apply.
export const SPOTLIGHT_KIND_LABELS = {
  npc: "an NPC",
  location: "a Location",
  monster: "a Monster",
  wonder: "a Wonder",
  journal: "a Journal page",
  map: "a Map",
  encounter: "an Encounter",
  clock: "a Clock",
  browser: "a link",
  calendar: "a calendar",
  soundboard: "a soundboard",
};

// One icon per spotlight kind — mirrors dashboard.js's own WIDGET_CATALOG
// icon for whichever widget type that kind becomes there (handout/map/
// combat/clock/browser/calendar/soundboard), kept as its own small table
// rather than derived from the catalog itself: the catalog's own icon
// doubles there as "is this kind even addable to a dashboard" (a widget
// catalog entry existing at all), a question that only makes sense on the
// Dashboard. A purely-display consumer with no such concept — Workbench's
// own read-only "Now Showing" panel — just needs "what icon represents this
// kind," full stop.
export const SPOTLIGHT_KIND_ICONS = {
  npc: "tabler:file-text",
  location: "tabler:file-text",
  monster: "tabler:file-text",
  wonder: "tabler:file-text",
  journal: "tabler:file-text",
  encounter: "tabler:swords",
  map: "tabler:map-2",
  clock: "tabler:clock",
  browser: "tabler:world",
  calendar: "tabler:calendar-time",
  soundboard: "tabler:music",
};

// The four kinds with no Library record to fetch a title from at all — they
// spotlight by widget instanceId, not a `kind/id` Library path (see
// dashboard.js's own INLINE_FOLLOW_KINDS, a Dashboard-specific superset
// concept this happens to share every member with). Guards a title-cache
// fetch attempt that would otherwise 404 forever, once per poll.
export const SPOTLIGHT_INLINE_KINDS = new Set(["clock", "browser", "calendar", "soundboard"]);

// Leading icon + whether it should be a clickable on/off toggle for every
// entry type — `resolveKindIcon(kind)` (dashboard.js's own, threaded
// through from initGameLogWidget below) returns undefined for a kind
// KIND_WIDGET_MAP doesn't recognize, which is exactly the signal used here
// to render a plain, non-interactive icon instead of a dead click target
// (the old Accept button had no such gate at all — a real inconsistency
// with the toast's own equivalent check, fixed here).
function resolveEntryIcon(entry, resolveKindIcon) {
  if (entry?.type === "message") {
    // A distinct icon for an in-character line — the "Speaking as X:"
    // prefix already carries the information, but a different icon lets it
    // register at a glance while scrolling, the same way the badge row
    // used to before it was replaced by the inline "Name:" prefix.
    return entry.in_character
      ? { icon: "tabler:mask", clickable: false }
      : { icon: "tabler:message-circle", clickable: false };
  }
  if (entry?.type === "roll") {
    return { icon: "tabler:dice-5", clickable: false };
  }
  if (entry?.type === "card") {
    return { icon: "tabler:cards", clickable: false };
  }
  if (entry?.type === "spotlight") {
    const kind = String(entry.payload?.kind || "").trim();
    const id = String(entry.payload?.id || "").trim();
    const templateId = String(entry.payload?.templateId || "").trim();
    const icon = kind ? resolveKindIcon?.(kind) : undefined;
    return { icon: icon || "tabler:sparkles", clickable: Boolean(icon), kind, id, templateId };
  }
  if (entry?.type === "spotlight-clear") {
    const kind = String(entry.payload?.kind || "").trim();
    const icon = kind ? resolveKindIcon?.(kind) : undefined;
    return { icon: icon || "tabler:eye-off", clickable: false, muted: true };
  }
  return { icon: "tabler:message-circle", clickable: false };
}

// One entry per kind with a real "open the source record in its owning
// tool" link — mirrors that kind's own widget-level "Open in X" header
// action exactly (map.js's own "Open in Orrery" is the only one that exists
// anywhere in the suite today: same URL shape, same same-tab navigation, no
// target/rel). A kind with no entry here just renders as plain, non-linked
// text — most notably every Handout kind (npc/location/monster/wonder/
// journal), none of which has an "Open in [owning tool]" affordance
// anywhere yet to mirror.
function resolveSpotlightLink(kind, id, shareToken) {
  if (kind === "map") {
    const params = new URLSearchParams({ map: id });
    if (shareToken) params.set("share", shareToken);
    return `${resolveToolHref("orrery", resolveToolContextPath())}?${params.toString()}`;
  }
  return "";
}

// Returns { before, detail, after, href } instead of a plain string — the
// caller (renderEntries below) renders `detail` as a link when `href` is
// non-empty, everything else as plain text either side of it. Only a
// `spotlight` entry ever has a linkable `detail` (the spotlighted item's own
// name); every other shape puts its whole sentence in `before` and leaves
// `detail`/`href` empty.
// `getCachedTitle(kind,id)`/`ensureTitleCached(kind,id,onLoaded)` — dashboard
// .js's own shared title cache (fetch-once, cache, re-render-on-resolve,
// same shape as the character-payload caches elsewhere in this suite).
// Spotlight log entries never carry a title themselves (server/groups.py's
// own payload validation only ever requires kind+id) — a real name for a
// Library-backed kind needs that separate fetch. The four inline kinds
// (clock/browser/calendar/soundboard) have no Library record to fetch at
// all; clock/browser are the only two whose own spotlight `data` payload
// happens to carry something nameable (a GM-set clock name, a raw URL) —
// calendar/soundboard fall back to the generic label like before.
function describeEntry(entry, { getCachedTitle, ensureTitleCached, onTitleLoaded, shareToken } = {}) {
  if (entry?.type === "spotlight") {
    const kind = String(entry.payload?.kind || "").trim();
    const id = String(entry.payload?.id || "").trim();
    const genericArticle = SPOTLIGHT_KIND_LABELS[kind] || (kind ? `a "${kind}"` : "something");
    let detail = "";
    if (kind === "clock") {
      detail = entry.payload?.data?.name || "";
    } else if (kind === "browser") {
      detail = entry.payload?.data?.url || "";
    } else if (kind === "card") {
      // Legacy-compatible only — no NEW "card" spotlight entries are ever
      // created any more (Cards/Decks plan, Part 5 revised: card reveals now
      // use the same ephemeral broadcast transport as dice, never spotlight
      // — see dashboard.js's own startDiceRevealWatcher). But the Game Log
      // renders EVERY entry ever posted, not just currently-active ones the
      // way the icon tray's own resolveActiveSpotlights does — so old rows
      // from before that redesign still render here, and without this
      // branch they fall into the generic Library-fetch case below and
      // 404 forever trying to fetch a title for an id that was never a
      // Library record (confirmed real bug this fixes, again).
      const cards = Array.isArray(entry.payload?.data?.cards) ? entry.payload.data.cards : [];
      detail = cards.map((card) => card?.label).filter(Boolean).join(", ");
    } else if (kind && id) {
      detail = getCachedTitle?.(kind, id) || "";
      if (!detail) ensureTitleCached?.(kind, id, onTitleLoaded);
    }
    return {
      before: "Showed ",
      detail: detail || genericArticle,
      after: " to the table",
      href: kind && id ? resolveSpotlightLink(kind, id, shareToken) : "",
    };
  }
  if (entry?.type === "spotlight-clear") {
    return { before: "Stopped showing to the table", detail: "", after: "", href: "" };
  }
  if (entry?.type === "roll") {
    // A roll entry's own `message` is always empty — the real data lives in
    // `payload.{label,expression,notation,total,verdict}` (dice-roll.js's
    // own rollExpression/rollSystemMove).
    const payload = entry.payload || {};
    const label = typeof payload.label === "string" ? payload.label.trim() : "";
    const notation =
      typeof payload.expression === "string" && payload.expression.trim()
        ? payload.expression.trim()
        : typeof payload.notation === "string" && payload.notation.trim()
          ? payload.notation.trim()
          : "";
    const total = payload.total !== undefined && payload.total !== null ? payload.total : "";
    let text = label && notation ? `${label} (${notation})` : label || notation || "Roll";
    if (total || total === 0) text += ` → ${total}`;
    // A System-defined Move's own matched band/compare label (Section
    // 1.3/4, e.g. "Partial Success") — absent for a plain roll, which
    // already reads fine without it.
    const verdict = typeof payload.verdict === "string" ? payload.verdict.trim() : "";
    if (verdict) text += ` — ${verdict}`;
    return { before: text, detail: "", after: "", href: "" };
  }
  if (entry?.type === "card") {
    // A card entry's own `message` is always empty — the real data lives in
    // `payload.{deckLabel,cards}` (deck.js's own handleDraw/
    // runDeckMacroAction), same shape as a roll entry's own payload-only
    // data. `cards` is always an array (one entry for a single draw, several
    // for a multi-card spread) — no separate singular-card shape.
    const payload = entry.payload || {};
    const deckLabel = typeof payload.deckLabel === "string" ? payload.deckLabel.trim() : "";
    const cardLabels = (Array.isArray(payload.cards) ? payload.cards : [])
      .map((card) => (typeof card?.label === "string" ? card.label.trim() : ""))
      .filter(Boolean)
      .join(", ");
    const text = cardLabels && deckLabel ? `${cardLabels} — ${deckLabel}` : cardLabels || deckLabel || "Drew a card";
    return { before: text, detail: "", after: "", href: "" };
  }
  return { before: entry?.message || "", detail: "", after: "", href: "" };
}

// A plain-text one-liner for the same entry describeEntry above renders as
// DOM — used by the Audio Recorder widget's own combined session-record
// export (audio-recorder.js), which has no title cache/async-fetch
// machinery of its own to resolve a spotlighted record's real name the way
// the live widget does, so a spotlight entry here always reads as its
// generic kind article ("a Monster") rather than the specific record title.
// Kept in sync with describeEntry's own branches by hand (not literally
// shared code — that function is DOM+title-cache-shaped in a way a plain
// string return can't reuse directly), so update both together if either
// entry type's phrasing changes.
export function summarizeLogEntry(entry) {
  if (entry?.type === "spotlight") {
    const kind = String(entry.payload?.kind || "").trim();
    const genericArticle = SPOTLIGHT_KIND_LABELS[kind] || (kind ? `a "${kind}"` : "something");
    let detail = "";
    if (kind === "clock") detail = entry.payload?.data?.name || "";
    else if (kind === "browser") detail = entry.payload?.data?.url || "";
    return `Showed ${detail || genericArticle} to the table`;
  }
  if (entry?.type === "spotlight-clear") {
    return "Stopped showing to the table";
  }
  if (entry?.type === "roll") {
    const payload = entry.payload || {};
    const label = typeof payload.label === "string" ? payload.label.trim() : "";
    const notation =
      typeof payload.expression === "string" && payload.expression.trim()
        ? payload.expression.trim()
        : typeof payload.notation === "string" && payload.notation.trim()
          ? payload.notation.trim()
          : "";
    const total = payload.total !== undefined && payload.total !== null ? payload.total : "";
    let text = label && notation ? `${label} (${notation})` : label || notation || "Roll";
    if (total || total === 0) text += ` → ${total}`;
    const verdict = typeof payload.verdict === "string" ? payload.verdict.trim() : "";
    if (verdict) text += ` — ${verdict}`;
    return text;
  }
  if (entry?.type === "card") {
    const payload = entry.payload || {};
    const deckLabel = typeof payload.deckLabel === "string" ? payload.deckLabel.trim() : "";
    const cardLabels = (Array.isArray(payload.cards) ? payload.cards : [])
      .map((card) => (typeof card?.label === "string" ? card.label.trim() : ""))
      .filter(Boolean)
      .join(", ");
    return cardLabels && deckLabel ? `${cardLabels} — ${deckLabel}` : cardLabels || deckLabel || "Drew a card";
  }
  return entry?.message || "";
}

export function formatTimestamp(value) {
  if (!value) return "";
  const date = new Date(normalizeTimestamp(value));
  if (Number.isNaN(date.getTime())) return value;
  try {
    // No explicit timeZone option — defaults to the browser's own local
    // zone, which is the whole point; `date` itself just has to actually
    // represent the right UTC instant first (see normalizeTimestamp above).
    return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  } catch (error) {
    return date.toISOString();
  }
}

// Reserved literal mention token for the GM — always available regardless
// of roster content (a group with no members at all still has an owner),
// checked ahead of any character label so a character named literally "GM"
// (extremely unlikely, not specially handled) can't shadow it.
const MENTION_GM_LABEL = "GM";

// Built once per widget mount from `roster` (the group's own member array —
// {content_type, content_id, label, owner_id, owner_username, ...} per
// entry, see server/groups.py's _fetch_group_members_batch) + `ownerId` +
// `currentUserId` (this viewer's own account) + `npcs` (GM only — see
// initGameLogWidget's own fetch) — backs @mention autocomplete, submit-time
// recipient/identity scanning, and whisper "to/from" display, all off the
// one shared label map so they can never drift out of sync with each other.
//
// Each mentionable label resolves to EITHER a `recipientId` (mentioning
// someone ELSE — a whisper target) OR an `identityLabel` (mentioning
// YOURSELF — a player's own character, or an NPC for the GM), never both:
// confirmed real design call — whispering yourself is meaningless, so
// mentioning your own character instead means "I'm speaking AS them,"
// exactly the same way an NPC mention means the GM is voicing it. This is
// what lets the compose form derive in-character posting entirely from who
// got @mentioned, with no separate manual toggle.
function buildMentionDirectory(roster, ownerId, currentUserId, npcs = []) {
  const characters = Array.isArray(roster)
    ? roster.filter((entry) => entry?.content_type === "character" && entry?.owner_id != null)
    : [];
  const byLabelLower = new Map();

  function registerKey(matchText, recipientId, identityLabel) {
    const key = matchText.toLowerCase();
    // First entry for a given key wins on a collision (two characters/NPCs
    // that happen to share a name, or a shorthand that collides with
    // another entry's own full name) — not worth resolving further than
    // "still mentionable by whichever one claimed the key first, just not
    // ambiguously by a shared one" — the loser just falls back to needing
    // its own fuller name instead.
    if (byLabelLower.has(key)) return;
    byLabelLower.set(key, { label: matchText, recipientId: recipientId ?? null, identityLabel: identityLabel ?? null });
  }

  function addEntry(rawLabel, recipientId, identityLabel) {
    const label = (rawLabel || "").trim();
    if (!label) return;
    registerKey(label, recipientId, identityLabel);
    // Also register the label's first word as a shorthand alias ("Maris"
    // for "Maris Wavedeep") — confirmed real bug this fixes: a GM whispered
    // "@Maris" (how someone actually types a name in chat, not necessarily
    // a character's full registered title) and it silently matched
    // NOTHING, since the old exact-full-label-only match required the
    // ENTIRE "Maris Wavedeep" to appear — the message posted as a
    // completely ordinary public one with no recipient at all, and no
    // visible sign anything had gone wrong. Still displays/identifies as
    // the FULL name once matched (see registerKey's identityLabel arg
    // below) — "Speaking as Maris Wavedeep," not "Speaking as Maris" —
    // regardless of which form triggered it.
    const firstWord = label.split(/\s+/)[0];
    if (firstWord && firstWord.length !== label.length) {
      registerKey(firstWord, recipientId, identityLabel ? label : null);
    }
  }

  // The GM is only a meaningful MENTION (a whisper target) for someone who
  // ISN'T the GM — the GM mentioning themselves has no recipient and no
  // distinct "speaking as" identity beyond just posting normally, so it's
  // omitted entirely from their own directory rather than being a dead entry.
  if (ownerId != null && currentUserId !== ownerId) {
    addEntry(MENTION_GM_LABEL, ownerId, null);
  }
  characters.forEach((entry) => {
    const label = entry.label || entry.owner_username || "";
    const isSelf = entry.owner_id === currentUserId;
    addEntry(label, isSelf ? null : entry.owner_id, isSelf ? label : null);
    // Also mentionable by the owning player's real account username, not
    // just their character's name — explicit ask: "reference by either the
    // character name OR the user name." Same recipientId/identityLabel as
    // the character-name registration above (identityLabel still resolves
    // to the CHARACTER's name, not the username — "Speaking as Cordelia,"
    // never "Speaking as alex.heath," regardless of which form triggered
    // it). Skipped when it's identical to the character label already
    // registered (nothing to add) — addEntry's own first-registered-wins
    // collision rule handles any other overlap gracefully.
    if (entry.owner_username && entry.owner_username.toLowerCase() !== label.toLowerCase()) {
      addEntry(entry.owner_username, isSelf ? null : entry.owner_id, isSelf ? label : null);
    }
  });
  // NPCs — always identity-only (no user account to whisper); only ever
  // non-empty when this directory is being built for the GM (see
  // initGameLogWidget's own fetchKindEntrySummaries call).
  npcs.forEach((npc) => addEntry(npc.name, null, npc.name));

  const allLabels = Array.from(byLabelLower.values());
  // Longest-label-first — scanMentions below relies on this ordering so
  // "Cordelia Ashworth" isn't shadowed by a shorter "Cordelia" collision at
  // the same text position.
  const byLengthDesc = allLabels.slice().sort((a, b) => b.label.length - a.label.length);
  return {
    allLabels,
    byLengthDesc,
    // For rendering a whisper pill's own name from a stored recipient user
    // id (server data — always a real account id, an NPC is never a
    // recipient). The `allLabels` lookup alone isn't enough on its own:
    // confirmed real bug this fixes — a recipient viewing their OWN whisper
    // (their own character was the target) has that same character
    // registered as an IDENTITY entry in THEIR OWN directory (recipientId:
    // null — see buildMentionDirectory's own comment on why your own
    // characters are never recipient-matchable to yourself), so the
    // `allLabels.find` below came back empty and fell straight through to
    // owner_username — showing "@alex.heath" (the account) in the pill
    // instead of "@Maris Wavedeep" (the character), only ever for the
    // recipient's own view of their own whisper. Checking `characters`
    // directly for the roster label first fixes this for every viewer.
    idToLabel(id) {
      if (id == null) return "";
      if (id === ownerId) return MENTION_GM_LABEL;
      const match = allLabels.find((entry) => entry.recipientId === id);
      if (match) return match.label;
      const rosterEntry = characters.find((entry) => entry.owner_id === id);
      return rosterEntry?.label || rosterEntry?.owner_username || "";
    },
    // The recipient's real account username — shown as a tooltip on the
    // whisper pill (renderEntries) on hover only, never as the pill's own
    // visible text. No username to show for the GM specifically (their
    // account isn't threaded through this client — only their id, via
    // ownerId) — the pill already reads "@GM" outright in that case, so
    // there's nothing a tooltip would add.
    idToUsername(id) {
      if (id == null || id === ownerId) return "";
      const rosterEntry = characters.find((entry) => entry.owner_id === id);
      return rosterEntry?.owner_username || "";
    },
  };
}

// Finds whichever directory entry (whisper OR identity type — the caller
// decides what to do with each) matches the text right after an "@" at
// this position (`rest`, already lowercased) — confirmed selections first
// (from confirmedMentions, an explicit dropdown pick — see insertMention's
// own comment for why those are trusted outright, no ambiguity to resolve),
// then the full roster as a fallback for free-typed text that never
// touched the dropdown. Word-boundary-checked on both sides by the
// caller's own "@" gate and the `after` check here — an unrelated
// "bob@Cordelia" (no space before "@") or "@Cordelia123" (no boundary
// after) never misfires.
function findMentionAt(rest, directory, confirmedMentions) {
  const matchesAt = (entry) => {
    const label = entry.label.toLowerCase();
    if (!rest.startsWith(label)) return false;
    const after = rest.charAt(label.length);
    return after === "" || /[\s.,!?;:]/.test(after);
  };
  if (confirmedMentions && confirmedMentions.size) {
    // Longest first here too — a confirmed "Maris" shouldn't get shadowed
    // by a confirmed "Maris Wavedeep" at the same spot, or vice versa,
    // same reasoning as the roster fallback below.
    const confirmed = Array.from(confirmedMentions.values()).sort((a, b) => b.label.length - a.label.length);
    const confirmedMatch = confirmed.find(matchesAt);
    if (confirmedMatch) return confirmedMatch;
  }
  return directory.byLengthDesc.find(matchesAt);
}

// Positional scan for @Label tokens in a composed message. Returns the
// matched directory entries themselves (deduped by label, each carrying its
// own recipientId/identityLabel) — an empty result means "no mentions
// found," the caller's signal to post as an ordinary public, out-of-
// character message.
function scanMentions(message, directory, confirmedMentions) {
  const foundByLabel = new Map();
  const lower = message.toLowerCase();
  for (let i = 0; i < message.length; i += 1) {
    if (message[i] !== "@" || (i > 0 && !/\s/.test(message[i - 1]))) continue;
    const match = findMentionAt(lower.slice(i + 1), directory, confirmedMentions);
    if (match) {
      if (!foundByLabel.has(match.label)) foundByLabel.set(match.label, match);
      i += match.label.length; // skip past the matched label (loop's own += 1 covers the "@")
    }
  }
  return Array.from(foundByLabel.values());
}

// Strips a LEADING run of recognized @mentions — of EITHER kind, whisper or
// identity, in any mix ("@Maris @Cordelia let's meet", "@Belimmar Welcome")
// — from the message, one at a time (each consuming its own optional
// trailing ":"/comma/whitespace separator) until nothing @-recognized is
// left at the front. A whisper-type match found here is discarded — its
// recipientId already comes from scanMentions, run separately over the
// UNSTRIPPED original text (see the submit handler/updateIdentityHint
// below), since access control has to stay correct regardless of what
// display-stripping decides — this function only needs the first
// identity-type match, if any, as the "speaking as" tag.
//
// Only a LEADING run gets this treatment, never a mid-sentence mention —
// there's no clean way to remove "@Maris" from "tell @Maris to come home"
// without leaving an awkward gap, so a non-leading mention is simply left
// visible as literal text. Confirmed real complaint this fixes (twice,
// for each mention kind): a leading identity mention left the raw
// "@Belimmar" token sitting right next to a redundant "IC" badge; a
// leading whisper mention left the raw "@Maris Wavedeep" sitting right
// next to the very whisper pill that already names the same recipient —
// both were showing the same information twice.
//
// `body` CAN come back empty (a leading run with nothing else typed yet,
// or at all) — that's deliberate, not an error: the live hint wants
// "Speaking as Belimmar" to show the instant the name itself is
// recognized, mid-typing, before the rest of the line even exists yet.
// It's the SUBMIT handler's own job to decide an empty body means nothing
// to actually post, not this function's.
function stripLeadingMentions(message, directory, confirmedMentions) {
  let body = message;
  let identityLabel = "";
  while (body.startsWith("@")) {
    const lower = body.toLowerCase();
    const match = findMentionAt(lower.slice(1), directory, confirmedMentions);
    if (!match) break;
    if (match.identityLabel != null && !identityLabel) {
      identityLabel = match.identityLabel;
    }
    const consumed = 1 + match.label.length;
    body = body.slice(consumed).replace(/^[:,]?\s*/, "");
  }
  return { body, identityLabel };
}

export function initGameLogWidget(
  container,
  {
    dataManager,
    status,
    groupId = "",
    shareToken = "",
    roster = [],
    ownerId = null,
    resolveKindIcon,
    isSpotlightOnDashboard,
    onToggleSpotlight,
    ensureTitleCached,
    getCachedTitle,
    setRightAction,
  } = {}
) {
  if (!container || !dataManager) {
    return { destroy() {} };
  }
  let pollTimer = 0;
  let destroyed = false;
  let activeList = null;
  // Set once the compose form below actually exists (authenticated only —
  // an anonymous share viewer has no account to reply FROM) — renderEntries
  // is defined before that form, so it calls this indirectly rather than
  // reaching into the form's own local input/confirmedMentions directly.
  let replyHandler = null;
  const currentUserId = dataManager.session?.user?.id ?? null;
  // Loaded ONCE at mount, not re-read on every refresh — see
  // MENTION_SEEN_WATERMARK_PREFIX's own comment for why it only advances at
  // destroy() time.
  const mentionSeenWatermark = loadMentionSeenWatermark(groupId || shareToken);
  // Reassigned (not const) once the GM's own NPC fetch below resolves —
  // every reader below always goes through this variable at call time
  // (never destructures/caches allLabels etc. up front), so the async NPC
  // arrival is picked up live without needing to re-render anything.
  // Built once from the roster this widget was mounted with — party
  // membership doesn't change mid-session often enough to warrant live
  // invalidation here (the caller re-mounts this whole widget whenever the
  // active campaign itself changes, which already gives a fresh roster).
  let mentionDirectory = buildMentionDirectory(roster, ownerId, currentUserId);
  // NPCs are mentionable ("speaking as") for the GM only — a player has no
  // equivalent use for them, and fetchKindEntrySummaries' own unfiltered
  // "every NPC this account can see" list (no Setting scoping — it only
  // returns {id,name}, not the full payload a Setting filter would need)
  // is fine for a GM's own mention autocomplete specifically because typing
  // narrows it immediately; not fine as a suite-wide NPC picker, which is
  // why this stays local to this one use rather than becoming shared logic.
  if (currentUserId != null && currentUserId === ownerId) {
    fetchKindEntrySummaries(dataManager, "npc")
      .then((npcs) => {
        if (destroyed) return;
        mentionDirectory = buildMentionDirectory(roster, ownerId, currentUserId, npcs);
      })
      .catch(() => {
        // Best-effort — the GM's own directory just won't offer NPC mentions
        // if this fails; whisper/self-mention (their own characters, if
        // any) still works fine without it.
      });
  }

  function renderEntries(list, entries) {
    list.innerHTML = "";
    if (!entries.length) {
      list.appendChild(el("p", "text-body-secondary small mb-0", "No log activity yet."));
      return;
    }
    entries
      .slice()
      .sort((a, b) => (Date.parse(b.created_at) || 0) - (Date.parse(a.created_at) || 0))
      .forEach((entry) => {
        const visual = resolveEntryIcon(entry, resolveKindIcon);
        const row = el("div", "d-flex align-items-start gap-2 small border-bottom pb-1 mb-1");

        // Reuses the entry's own leading icon as a "quick reply" button —
        // explicit ask, e.g. a player pings the GM, GM clicks the icon on
        // that entry to reply without retyping the @mention by hand.
        // Message-only (a roll/spotlight has an "author" but nothing to
        // reply TO in this sense), never on your own message (nothing to
        // reply to yourself), and only once a compose form actually exists
        // to reply INTO (replyHandler stays null for an anonymous share
        // viewer, who has no account to reply from).
        const isReplyable =
          entry.type === "message" &&
          Boolean(replyHandler) &&
          entry.author?.id != null &&
          entry.author.id !== currentUserId;
        const iconEl = el(visual.clickable || isReplyable ? "button" : "span", "gamelog-entry-icon");
        if (isReplyable) {
          iconEl.type = "button";
          iconEl.classList.add("gamelog-entry-icon--clickable");
          iconEl.title = `Reply to ${entry.author?.name || "them"}`;
          iconEl.addEventListener("click", () => replyHandler(entry));
        } else if (visual.clickable) {
          iconEl.type = "button";
          iconEl.classList.add("gamelog-entry-icon--clickable");
          // Not gated on authorship — a GM's own spotlighted item is
          // "on their dashboard" by construction (their own widget is what
          // gets toggled), and toggling it off here is exactly as
          // meaningful as doing it from the panel; keeping both surfaces
          // consistent is the whole point of this rework.
          const isOn = Boolean(isSpotlightOnDashboard?.({ kind: visual.kind, id: visual.id }));
          iconEl.classList.add(isOn ? "spotlight-panel-icon--mine" : "spotlight-panel-icon--available");
          iconEl.title = isOn ? "On your dashboard — click to remove" : "Click to add to your dashboard";
          iconEl.addEventListener("click", () =>
            onToggleSpotlight?.({ kind: visual.kind, id: visual.id, templateId: visual.templateId })
          );
        } else if (visual.muted) {
          iconEl.classList.add("gamelog-entry-icon--muted");
        }
        const iconGlyph = el("span", "iconify");
        iconGlyph.dataset.icon = visual.icon;
        iconGlyph.setAttribute("aria-hidden", "true");
        iconEl.appendChild(iconGlyph);
        row.appendChild(iconEl);

        const body = el("div", "d-flex flex-column gap-1 flex-grow-1 gamelog-entry-body");
        // A whisper/IC entry never reaches here at all unless the server
        // already decided this viewer may see it (author or an explicit
        // recipient) — see _entry_visible_to, server/groups.py — so the
        // badges below are purely informational, not a client-side gate.
        const isWhisper = entry.type === "message" && Array.isArray(entry.recipient_ids) && entry.recipient_ids.length > 0;
        // A self-only Private roll/card (Cards/Decks plan, Part 1) —
        // recipient_ids here is always just [the poster's own id] (a
        // self-whisper, never a real whisper to someone else — see
        // dice-roller.js's/deck.js's own resolveVisibility), so this gets a
        // plain "Private" indicator below instead of the @mention pill,
        // which only makes sense when there's an actual person being named.
        const isPrivateRoll =
          (entry.type === "roll" || entry.type === "card") &&
          Array.isArray(entry.recipient_ids) &&
          entry.recipient_ids.length > 0;
        const isInCharacter = entry.type === "message" && Boolean(entry.in_character);
        const characterName = isInCharacter ? String(entry.payload?.characterName || "").trim() : "";
        // Someone ELSE @mentioned me (a real recipient match, not my own
        // characters — those never become recipients, see
        // buildMentionDirectory's own comment) since I last had this log
        // open — the notification the user asked for: "so it's clear to
        // them it's been done." A gold highlight on the row itself, nothing
        // more — a separate persistent banner was tried and dropped (see
        // MENTION_SEEN_WATERMARK_PREFIX's own comment on when this clears):
        // it never went away for the rest of the viewing session and just
        // nagged. The highlight naturally sits near the top of the list too
        // (newest-first sort), so it's not lost either.
        const isUnreadMention =
          isWhisper &&
          currentUserId != null &&
          entry.author?.id !== currentUserId &&
          entry.recipient_ids.includes(currentUserId) &&
          parseTimestamp(entry.created_at) > parseTimestamp(mentionSeenWatermark);
        if (isUnreadMention) {
          row.classList.add("gamelog-entry--unread-mention");
        }
        const line = el("div", "d-flex justify-content-between gap-2");
        const sentence = describeEntry(entry, {
          getCachedTitle,
          ensureTitleCached,
          onTitleLoaded: () => refreshNow(),
          shareToken,
        });
        const textEl = el("span", "gamelog-entry-text");
        // "Belimmar: <dialogue>" — the character/NPC's name stays upright
        // and bold (a speaker tag), only the dialogue itself is italicized,
        // so the two read as distinct roles rather than one undifferentiated
        // italic run.
        if (isInCharacter && characterName) {
          textEl.appendChild(el("span", "fw-semibold", `${characterName}: `));
        }
        if (isWhisper) {
          // One compact inline pill, not a whole second row — the pill
          // text itself IS the @mention (who this was whispered to), and
          // the real account username (when known — see idToUsername's own
          // comment on the GM case) only ever shows on hover, via the
          // native title tooltip rather than this suite's Bootstrap
          // tooltip machinery — that needs an explicit dispose/refresh
          // cycle around every re-render (this list rebuilds on every
          // poll), which is real ongoing upkeep this compact a hint doesn't
          // justify.
          const pill = el("span", "badge text-bg-secondary gamelog-mention-pill");
          pill.textContent = entry.recipient_ids.map((id) => `@${mentionDirectory.idToLabel(id) || "someone"}`).join(" ");
          const usernames = entry.recipient_ids.map((id) => mentionDirectory.idToUsername(id)).filter(Boolean);
          if (usernames.length) pill.title = usernames.join(", ");
          textEl.appendChild(pill);
          textEl.appendChild(document.createTextNode(" "));
        }
        if (isPrivateRoll) {
          const pill = el("span", "badge text-bg-secondary gamelog-mention-pill", "Private");
          textEl.appendChild(pill);
          textEl.appendChild(document.createTextNode(" "));
        }
        const dialogueEl = isInCharacter ? el("span", "fst-italic") : textEl;
        if (sentence.before) dialogueEl.appendChild(document.createTextNode(sentence.before));
        if (sentence.detail) {
          if (sentence.href) {
            // No target/rel — same same-tab navigation as the source
            // widget's own "Open in X" header action (see
            // resolveSpotlightLink's own comment).
            const link = document.createElement("a");
            link.href = sentence.href;
            link.textContent = sentence.detail;
            dialogueEl.appendChild(link);
          } else {
            dialogueEl.appendChild(document.createTextNode(sentence.detail));
          }
        }
        if (sentence.after) dialogueEl.appendChild(document.createTextNode(sentence.after));
        if (dialogueEl !== textEl) textEl.appendChild(dialogueEl);
        line.appendChild(textEl);
        const meta = el("span", "text-body-secondary gamelog-entry-meta");
        meta.textContent = `${entry.author?.name || "System"} · ${formatTimestamp(entry.created_at)}`;
        line.appendChild(meta);
        body.appendChild(line);
        row.appendChild(body);

        list.appendChild(row);
      });
  }

  async function refresh(list) {
    if (destroyed || !groupId && !shareToken) return;
    try {
      const log = await dataManager.getGroupLog({ groupId, shareToken, limit: 20 });
      // `spotlight-update` (data-manager.js's updateSpotlightData) is a
      // silent data refresh on an already-shown inline widget (a Clock tick,
      // a Browser URL edit) — the original `spotlight` entry already
      // announced it, so these carry nothing worth a log row and would
      // otherwise spam one on every single edit.
      const entries = Array.isArray(log?.entries)
        ? log.entries.filter((entry) => entry?.type !== "spotlight-update")
        : [];
      const watermark = loadClearedWatermark(groupId || shareToken);
      const visible = watermark
        ? entries.filter((entry) => parseTimestamp(entry.created_at) > parseTimestamp(watermark))
        : entries;
      renderEntries(list, visible);
    } catch (error) {
      list.innerHTML = "";
      list.appendChild(el("p", "text-danger small mb-0", "Unable to load the log."));
    }
  }

  function render() {
    container.innerHTML = "";
    activeList = null;
    if (!groupId && !shareToken) {
      container.appendChild(el("p", "text-body-secondary small mb-0", "No active campaign — pick one from the header menu."));
      return;
    }
    const wrap = el("div", "d-flex flex-column gap-2");
    const list = el("div");
    activeList = list;

    // Posting form goes FIRST, above the entries list — confirmed real
    // complaint: with the list on top, "Post a message" sank below however
    // many entries were showing, and a GM/player who'd scrolled down to read
    // older history had to scroll back up just to type. The newest entry is
    // still the first thing in the list itself (renderEntries sorts
    // newest-first), so nothing about reading order actually changes, only
    // where the compose box sits relative to it.
    if (dataManager.isAuthenticated()) {
      const form = el("form", "d-flex flex-column gap-1 position-relative");
      const composeRow = el("div", "d-flex gap-2");
      const input = el("input", "form-control form-control-sm");
      input.type = "text";
      input.placeholder = "Post a message… (@ to whisper, or @ your own character to speak in character)";
      const button = el("button", "btn btn-outline-primary btn-sm", "Send");
      button.type = "submit";
      composeRow.append(input, button);

      // Read-only feedback, not a control — there's no separate "in
      // character" toggle at all (confirmed design call): mentioning your
      // own character (or, for the GM, an NPC) IS what makes a message in
      // character, since whispering yourself is meaningless anyway, so that
      // @mention was doing nothing else useful. This just surfaces what
      // will happen before Send, off the exact same scanMentions call the
      // submit handler below uses, so it can never disagree with the
      // message that actually posts.
      const identityHint = el("div", "text-body-secondary small fst-italic");
      setElementVisible(identityHint, false, "block");

      // --- @mention autocomplete — bespoke, not a shared picker, since it
      // has to anchor to a moving text-cursor position inside a plain
      // <input>, which none of this suite's existing dropdown helpers do.
      let mentionEl = null;
      let mentionMatches = [];
      let mentionActiveIndex = 0;
      let mentionTokenStart = -1;
      // Every entry the user picked EXPLICITLY (click or Tab/Enter) from
      // the dropdown below, keyed by its own label (lowercase). Confirmed
      // real complaint this fixes: even a picked suggestion still had to be
      // re-derived from raw text at submit time — a strict/shorthand match
      // against the whole roster — when the picker already knew EXACTLY
      // which character/NPC was meant the moment it was chosen, no
      // ambiguity possible. scanMentions/stripLeadingMentions below check
      // this first and trust it outright; free-typed text (never touched
      // the dropdown) still falls back to the roster heuristic, since
      // there's no other way to know what THAT was supposed to mean.
      // Cleared on a successful send — a stale confirmation from a
      // previous message shouldn't silently apply to a new one.
      const confirmedMentions = new Map();

      function closeMentionDropdown() {
        mentionEl?.remove();
        mentionEl = null;
        mentionMatches = [];
        mentionTokenStart = -1;
      }

      function insertMention(match) {
        const value = input.value;
        const cursor = input.selectionStart ?? value.length;
        const before = value.slice(0, mentionTokenStart);
        const after = value.slice(cursor);
        const inserted = `@${match.label} `;
        input.value = `${before}${inserted}${after}`;
        const nextCursor = before.length + inserted.length;
        confirmedMentions.set(match.label.toLowerCase(), match);
        closeMentionDropdown();
        input.focus();
        input.setSelectionRange(nextCursor, nextCursor);
        // Setting .value programmatically doesn't dispatch a native "input"
        // event, so the hint (normally kept in sync by the real input
        // listener below) needs this explicit nudge here too.
        updateIdentityHint();
      }

      function renderMentionDropdown() {
        mentionEl?.remove();
        mentionEl = el("div", "list-group gamelog-mention-dropdown");
        mentionMatches.forEach((match, index) => {
          const item = el("button", "list-group-item list-group-item-action py-1 px-2 small", `@${match.label}`);
          item.type = "button";
          if (index === mentionActiveIndex) item.classList.add("active");
          // mousedown, not click — fires before the input's own blur
          // handler below, so mentionTokenStart/selectionStart are still
          // meaningful when insertMention reads them.
          item.addEventListener("mousedown", (event) => {
            event.preventDefault();
            insertMention(match);
          });
          mentionEl.appendChild(item);
        });
        form.appendChild(mentionEl);
      }

      function updateMentionSuggestions() {
        const cursor = input.selectionStart ?? input.value.length;
        const uptoCursor = input.value.slice(0, cursor);
        const atIndex = uptoCursor.lastIndexOf("@");
        if (atIndex === -1 || /\s/.test(uptoCursor.slice(atIndex + 1))) {
          closeMentionDropdown();
          return;
        }
        const query = uptoCursor.slice(atIndex + 1).toLowerCase();
        const matches = mentionDirectory.allLabels
          .filter((entry) => entry.label.toLowerCase().startsWith(query))
          .slice(0, 6);
        if (!matches.length) {
          closeMentionDropdown();
          return;
        }
        mentionTokenStart = atIndex;
        mentionMatches = matches;
        mentionActiveIndex = 0;
        renderMentionDropdown();
      }

      function updateIdentityHint() {
        const { identityLabel } = stripLeadingMentions(input.value.trim(), mentionDirectory, confirmedMentions);
        if (identityLabel) {
          identityHint.textContent = `Speaking as ${identityLabel}`;
          setElementVisible(identityHint, true, "block");
        } else {
          setElementVisible(identityHint, false, "block");
        }
      }

      input.addEventListener("input", () => {
        updateMentionSuggestions();
        updateIdentityHint();
      });
      input.addEventListener("keydown", (event) => {
        if (!mentionEl || !mentionMatches.length) return;
        if (event.key === "ArrowDown") {
          event.preventDefault();
          mentionActiveIndex = (mentionActiveIndex + 1) % mentionMatches.length;
          renderMentionDropdown();
        } else if (event.key === "ArrowUp") {
          event.preventDefault();
          mentionActiveIndex = (mentionActiveIndex - 1 + mentionMatches.length) % mentionMatches.length;
          renderMentionDropdown();
        } else if (event.key === "Enter" || event.key === "Tab") {
          event.preventDefault();
          insertMention(mentionMatches[mentionActiveIndex]);
        } else if (event.key === "Escape") {
          closeMentionDropdown();
        }
      });
      // Deferred — a suggestion's own mousedown (above) already handles the
      // insert, and preventDefault there stops it from ever stealing focus
      // in the first place; this only ever catches a genuine focus-away.
      input.addEventListener("blur", () => window.setTimeout(closeMentionDropdown, 0));

      // Wired to the entry icon's own click above (renderEntries) — starts
      // a fresh reply addressed to whoever posted that entry, overwriting
      // any in-progress draft (this is a deliberate "start replying to X"
      // action, not a continuation of what was being typed). Uses the
      // author's real account username, not their character name — the
      // reserved "GM" token instead when the author IS the GM, since the
      // GM's own username isn't threaded through this client at all (only
      // their id, via ownerId), and "GM" is already guaranteed mentionable
      // by everyone else's own directory regardless.
      replyHandler = (entry) => {
        const authorId = entry.author?.id;
        if (authorId == null) return;
        const mentionText = authorId === ownerId ? MENTION_GM_LABEL : entry.author?.name || "";
        if (!mentionText) return;
        const directoryMatch = mentionDirectory.allLabels.find(
          (candidate) => candidate.label.toLowerCase() === mentionText.toLowerCase()
        );
        input.value = `@${mentionText} `;
        // Known outright, no ambiguity — same "trust an explicit UI action
        // over re-deriving from text" reasoning as insertMention's own
        // dropdown picks.
        if (directoryMatch) confirmedMentions.set(mentionText.toLowerCase(), directoryMatch);
        closeMentionDropdown();
        input.focus();
        input.setSelectionRange(input.value.length, input.value.length);
        updateIdentityHint();
      };

      form.addEventListener("submit", async (event) => {
        event.preventDefault();
        const trimmed = input.value.trim();
        if (!trimmed) return;
        // Whisper scope is scanned from the ORIGINAL, unstripped text —
        // access control has to stay correct no matter what the display
        // stripping right below decides to do with the visible text.
        const matches = scanMentions(trimmed, mentionDirectory, confirmedMentions);
        const recipientIds = Array.from(
          new Set(matches.filter((entry) => entry.recipientId != null).map((entry) => entry.recipientId))
        );
        // A leading "@Belimmar"/"@Maris" is a speaker tag or a whisper
        // address, not part of what got said — stripped here so it never
        // posts (or displays) as literal "@" text right alongside the
        // character name/whisper pill that already convey the same thing.
        const { body: message, identityLabel } = stripLeadingMentions(trimmed, mentionDirectory, confirmedMentions);
        // A leading run with nothing after it ("@Belimmar" alone, or
        // "@Maris:" with no line to say) — nothing to actually post, same
        // silent no-op as the plain-empty-input guard above rather than
        // sending an empty dialogue line.
        if (!message) return;
        const characterName = identityLabel || "";
        try {
          await dataManager.createGroupLogEntry({
            groupId,
            shareToken,
            type: "message",
            message,
            payload: characterName ? { characterName } : undefined,
            recipientIds: recipientIds.length ? recipientIds : undefined,
            inCharacter: characterName ? true : undefined,
          });
          input.value = "";
          closeMentionDropdown();
          confirmedMentions.clear();
          setElementVisible(identityHint, false, "block");
          await refresh(list);
        } catch (error) {
          status?.show(error.message || "Unable to post to the log.", { type: "error" });
        }
      });
      form.append(composeRow, identityHint);
      wrap.appendChild(form);
    }

    wrap.appendChild(list);
    container.appendChild(wrap);
    void refresh(list);
  }

  function refreshNow() {
    return activeList ? refresh(activeList) : undefined;
  }

  // Purely local — only hides older entries from THIS browser's own view
  // (clearGameLogView's localStorage watermark above); the log itself stays
  // shared, persistent history for the whole campaign, and nothing here
  // ever deletes from it. Always visible (not edit-mode gated like Remove),
  // same convention as Map/Combat Tracker/Handout's own visibility toggle —
  // this is Game Log's equivalent of that same right-side action slot.
  setRightAction?.({
    icon: "tabler:trash",
    tooltip: "Clear log",
    onClick: () => {
      clearGameLogView(groupId || shareToken);
      void refreshNow();
    },
  });

  render();
  pollTimer = window.setInterval(() => {
    if (activeList) void refresh(activeList);
  }, POLL_INTERVAL_MS);

  // Wakes the existing 30s poll up sooner on a relevant change — see
  // live.js's own comment; polling above keeps running unchanged either way.
  const liveStream = connectLiveStream({ dataManager, groupId, kinds: ["group_log"], shareToken });
  liveStream.subscribe("group_log", () => {
    if (activeList) void refresh(activeList);
  });

  return {
    // Exposed for the Widget Inspector's own "Clear log" button too.
    refresh: refreshNow,
    destroy() {
      destroyed = true;
      if (pollTimer) window.clearInterval(pollTimer);
      liveStream.close();
      container.innerHTML = "";
      // Advance the "seen" watermark now, not at mount — see
      // MENTION_SEEN_WATERMARK_PREFIX's own comment: a mention that arrived
      // while this was open stays flagged "new" for the whole session, only
      // clearing once the widget actually goes away (a campaign switch, a
      // page navigation, this card being removed from the dashboard).
      saveMentionSeenWatermark(groupId || shareToken);
    },
  };
}
