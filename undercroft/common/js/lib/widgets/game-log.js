// Compact Game Log widget — mounted as a Dashboard widget card, and inline in
// Workbench's own collapsible section too (workbench-character-view.js) —
// one real implementation, not two independently-drifting copies.
import { connectLiveStream } from "../live.js";
import { el, setElementVisible } from "../dom.js";
import { resolveToolHref, resolveToolContextPath } from "../app-shell.js";
import { fetchKindEntrySummaries } from "../content-fetch.js";
import { disposeTooltips, refreshTooltips } from "../tooltips.js";

const POLL_INTERVAL_MS = 30000;
const CLEARED_WATERMARK_PREFIX = "undercroft.gamelog.clearedBefore.";
// Separate from CLEARED_WATERMARK_PREFIX — that one hides entries entirely;
// this one only tracks "have I seen a mention since I last had this open,"
// and advances only when the widget unmounts, not on every render — so a
// whisper arriving while the log is open stays flagged new for the rest of
// that viewing session.
const MENTION_SEEN_WATERMARK_PREFIX = "undercroft.gamelog.mentionsSeenBefore.";

// "Clear log" only hides entries from this browser's own view — the log
// itself is shared, persistent campaign history (server has no delete-entry
// capability by design), so clearing is a local watermark, not a server call.
// Keyed by groupId, or shareToken for an anonymous share-link viewer.
function watermarkKey(scope) {
  return `${CLEARED_WATERMARK_PREFIX}${scope}`;
}

// server/groups.py stamps created_at via Python's naive `datetime.utcnow()
// .isoformat()` — no "Z"/offset suffix, even though the instant is UTC. JS's
// Date.parse treats a zone-less ISO string as local time, so appending "Z"
// when that naive shape is detected is what makes every consumer (display,
// watermark comparisons) treat it as the UTC instant it actually is.
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
    // Local storage unavailable — harmless no-op.
  }
}

// Exported so dashboard.js's Game Log catalog entry ("Clear log" buttons)
// can set this without reaching into this widget's own module-private state.
export function clearGameLogView(scope) {
  if (!scope) return;
  try {
    localStorage.setItem(watermarkKey(scope), new Date().toISOString());
  } catch (error) {
    // Local storage unavailable — nothing to clear locally.
  }
}

// Exported so dashboard.js's spotlight panel phrases things the same way
// this widget's own inline entry does, and as the fallback whenever a real
// resource title (fetched separately) isn't available yet.
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
  shop: "a Shop",
};

// Mirrors dashboard.js's own WIDGET_CATALOG icon for whichever widget type
// each kind becomes there, kept as its own table since the catalog's icon
// there doubles as "is this addable to a dashboard" — a question that only
// makes sense on the Dashboard, whereas Workbench's read-only "Now Showing"
// panel just needs "what icon represents this kind."
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
  shop: "tabler:building-store",
};

// Kinds with no Library record to fetch a title from at all — spotlighted by
// an id that isn't a `kind/id` Library path. Guards a title-cache fetch that
// would otherwise 404 forever, once per poll. `shop`'s own state lives on the
// campaign Group (shop-transactions.js), not on any one GM's widget instance,
// but there's still no Library record to fetch a title from, so it shares
// this guard — a Shop widget reads its id straight off contentRef.followId.
export const SPOTLIGHT_INLINE_KINDS = new Set(["clock", "browser", "calendar", "soundboard", "shop"]);

// Leading icon + whether it's a clickable toggle, per entry type.
// `resolveKindIcon(kind)` returns undefined for an unrecognized kind, which
// is the signal to render a plain, non-interactive icon instead of a dead
// click target.
function resolveEntryIcon(entry, resolveKindIcon) {
  if (entry?.type === "message") {
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

// Kinds with a real "open the source record in its owning tool" link —
// mirrors that kind's own widget-level "Open in X" header action exactly
// (map.js's "Open in Orrery" is the only one that exists today). A kind with
// no entry here renders as plain, non-linked text.
function resolveSpotlightLink(kind, id, shareToken) {
  if (kind === "map") {
    const params = new URLSearchParams({ map: id });
    if (shareToken) params.set("share", shareToken);
    return `${resolveToolHref("orrery", resolveToolContextPath())}?${params.toString()}`;
  }
  return "";
}

// Returns {before, detail, after, href} instead of a plain string — the
// caller renders `detail` as a link when `href` is non-empty. Only a
// `spotlight` entry ever has a linkable `detail` (the spotlighted item's own
// name). Spotlight entries never carry a title themselves (server payload
// validation only requires kind+id) — a real name needs a separate title
// fetch via getCachedTitle/ensureTitleCached (dashboard.js's shared cache).
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
      // Legacy-compatible only — card reveals now use the ephemeral
      // broadcast transport (dashboard.js's startDiceRevealWatcher), never
      // spotlight, but old rows from before that redesign still render here.
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
    // A roll entry's own `message` is always empty — real data lives in
    // `payload.{label,expression,notation,total,verdict}`.
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
    return { before: text, detail: "", after: "", href: "" };
  }
  if (entry?.type === "card") {
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

// A plain-text one-liner for the same entry describeEntry renders as DOM —
// used by the Audio Recorder's combined session-record export, which has no
// title-cache/async-fetch machinery of its own, so a spotlight entry here
// always reads as its generic kind article rather than the record's real
// title. Kept in sync with describeEntry by hand (not shared code — that
// function is DOM+title-cache-shaped in a way this can't reuse directly).
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
    // No explicit timeZone — defaults to the browser's local zone, which is
    // the point; `date` just has to represent the right UTC instant first.
    return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  } catch (error) {
    return date.toISOString();
  }
}

// Reserved literal mention token for the GM — always available (a group with
// no members still has an owner), checked ahead of any character label so a
// character named literally "GM" can't shadow it.
const MENTION_GM_LABEL = "GM";

// Built once per widget mount from `roster` (the group's member array) +
// `ownerId` + `currentUserId` + `npcs` (GM only) — backs @mention
// autocomplete, submit-time recipient/identity scanning, and whisper
// to/from display, all off one shared label map so they can't drift.
//
// Each mentionable label resolves to EITHER a `recipientId` (mentioning
// someone else — a whisper target) OR an `identityLabel` (mentioning
// yourself — speaking as your own character, or an NPC for the GM), never
// both: whispering yourself is meaningless, so self-mention instead means
// "I'm speaking as them" — the same way an NPC mention means the GM is
// voicing it.
function buildMentionDirectory(roster, ownerId, currentUserId, npcs = []) {
  const characters = Array.isArray(roster)
    ? roster.filter((entry) => entry?.content_type === "character" && entry?.owner_id != null)
    : [];
  const byLabelLower = new Map();

  function registerKey(matchText, recipientId, identityLabel) {
    const key = matchText.toLowerCase();
    // First entry for a key wins on a collision (two characters/NPCs sharing
    // a name); the loser just needs its own fuller name instead.
    if (byLabelLower.has(key)) return;
    byLabelLower.set(key, { label: matchText, recipientId: recipientId ?? null, identityLabel: identityLabel ?? null });
  }

  function addEntry(rawLabel, recipientId, identityLabel) {
    const label = (rawLabel || "").trim();
    if (!label) return;
    registerKey(label, recipientId, identityLabel);
    // Also register the label's first word as a shorthand alias ("Maris" for
    // "Maris Wavedeep") — how someone actually types a name in chat. Still
    // displays as the FULL name once matched ("Speaking as Maris Wavedeep,"
    // not "Speaking as Maris"), regardless of which form triggered it.
    const firstWord = label.split(/\s+/)[0];
    if (firstWord && firstWord.length !== label.length) {
      registerKey(firstWord, recipientId, identityLabel ? label : null);
    }
  }

  // The GM is only a meaningful mention (whisper target) for someone who
  // isn't the GM — omitted from their own directory rather than a dead entry.
  if (ownerId != null && currentUserId !== ownerId) {
    addEntry(MENTION_GM_LABEL, ownerId, null);
  }
  characters.forEach((entry) => {
    const label = entry.label || entry.owner_username || "";
    const isSelf = entry.owner_id === currentUserId;
    addEntry(label, isSelf ? null : entry.owner_id, isSelf ? label : null);
    // Also mentionable by the owning player's real account username, not
    // just their character's name. identityLabel still resolves to the
    // CHARACTER's name ("Speaking as Cordelia," never "...as alex.heath").
    if (entry.owner_username && entry.owner_username.toLowerCase() !== label.toLowerCase()) {
      addEntry(entry.owner_username, isSelf ? null : entry.owner_id, isSelf ? label : null);
    }
  });
  // NPCs — identity-only (no user account to whisper); only non-empty when
  // this directory is built for the GM.
  npcs.forEach((npc) => addEntry(npc.name, null, npc.name));

  const allLabels = Array.from(byLabelLower.values());
  // Longest-label-first so "Cordelia Ashworth" isn't shadowed by a shorter
  // "Cordelia" collision at the same text position.
  const byLengthDesc = allLabels.slice().sort((a, b) => b.label.length - a.label.length);
  return {
    allLabels,
    byLengthDesc,
    // For rendering a whisper pill's own name from a stored recipient user
    // id. `allLabels` alone isn't enough: a recipient viewing their OWN
    // whisper has that same character registered as an IDENTITY entry in
    // THEIR OWN directory (recipientId: null), so it falls through to
    // owner_username otherwise. Checking `characters` directly first fixes
    // this for every viewer.
    idToLabel(id) {
      if (id == null) return "";
      if (id === ownerId) return MENTION_GM_LABEL;
      const match = allLabels.find((entry) => entry.recipientId === id);
      if (match) return match.label;
      const rosterEntry = characters.find((entry) => entry.owner_id === id);
      return rosterEntry?.label || rosterEntry?.owner_username || "";
    },
    // Shown as a tooltip on the whisper pill, hover only. Nothing to show
    // for the GM specifically (their username isn't threaded through this
    // client) — the pill already reads "@GM" outright.
    idToUsername(id) {
      if (id == null || id === ownerId) return "";
      const rosterEntry = characters.find((entry) => entry.owner_id === id);
      return rosterEntry?.owner_username || "";
    },
  };
}

// Finds whichever directory entry matches the text right after an "@" at
// this position — confirmed selections first (an explicit dropdown pick,
// trusted outright), then the full roster as a fallback for free-typed text.
function findMentionAt(rest, directory, confirmedMentions) {
  const matchesAt = (entry) => {
    const label = entry.label.toLowerCase();
    if (!rest.startsWith(label)) return false;
    const after = rest.charAt(label.length);
    return after === "" || /[\s.,!?;:]/.test(after);
  };
  if (confirmedMentions && confirmedMentions.size) {
    const confirmed = Array.from(confirmedMentions.values()).sort((a, b) => b.label.length - a.label.length);
    const confirmedMatch = confirmed.find(matchesAt);
    if (confirmedMatch) return confirmedMatch;
  }
  return directory.byLengthDesc.find(matchesAt);
}

// Positional scan for @Label tokens in a composed message. An empty result
// means "no mentions found," the caller's signal to post as an ordinary
// public, out-of-character message.
function scanMentions(message, directory, confirmedMentions) {
  const foundByLabel = new Map();
  const lower = message.toLowerCase();
  for (let i = 0; i < message.length; i += 1) {
    if (message[i] !== "@" || (i > 0 && !/\s/.test(message[i - 1]))) continue;
    const match = findMentionAt(lower.slice(i + 1), directory, confirmedMentions);
    if (match) {
      if (!foundByLabel.has(match.label)) foundByLabel.set(match.label, match);
      i += match.label.length; // skip past the matched label
    }
  }
  return Array.from(foundByLabel.values());
}

// Strips a LEADING run of recognized @mentions (either kind, any mix) from
// the message. A whisper-type match found here is discarded — recipientId
// already comes from scanMentions run separately over the unstripped
// original text, since access control has to stay correct regardless of
// what display-stripping decides.
//
// Only a leading run gets stripped, never a mid-sentence mention — there's
// no clean way to remove "@Maris" from "tell @Maris to come home" without an
// awkward gap, so a non-leading mention stays visible as literal text.
//
// `body` can come back empty (a leading run with nothing else typed) — the
// live hint wants "Speaking as Belimmar" to show the instant the name is
// recognized, mid-typing. It's the submit handler's job to decide an empty
// body means nothing to post.
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
  // Set once the compose form actually exists (authenticated only) —
  // renderEntries is defined before that form, so it calls this indirectly.
  let replyHandler = null;
  const currentUserId = dataManager.session?.user?.id ?? null;
  const mentionSeenWatermark = loadMentionSeenWatermark(groupId || shareToken);
  // Reassigned once the GM's own NPC fetch resolves — every reader below
  // always goes through this variable, so the async arrival is picked up
  // live. Built once from the roster this widget mounted with — party
  // membership doesn't change often enough to warrant live invalidation
  // (the caller re-mounts the whole widget on a campaign switch anyway).
  let mentionDirectory = buildMentionDirectory(roster, ownerId, currentUserId);
  // NPCs are mentionable ("speaking as") for the GM only.
  if (currentUserId != null && currentUserId === ownerId) {
    fetchKindEntrySummaries(dataManager, "npc")
      .then((npcs) => {
        if (destroyed) return;
        mentionDirectory = buildMentionDirectory(roster, ownerId, currentUserId, npcs);
      })
      .catch(() => {
        // Best-effort — the GM's directory just won't offer NPC mentions.
      });
  }

  function renderEntries(list, entries) {
    // Disposed before the wipe — this rebuilds on every poll, including
    // while a tooltip from a previous render might still be open.
    disposeTooltips(list);
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

        // Reuses the entry's own leading icon as a quick-reply button —
        // message-only, never on your own message, and only once a compose
        // form actually exists (an anonymous share viewer has none).
        const isReplyable =
          entry.type === "message" &&
          Boolean(replyHandler) &&
          entry.author?.id != null &&
          entry.author.id !== currentUserId;
        const iconEl = el(visual.clickable || isReplyable ? "button" : "span", "gamelog-entry-icon");
        if (isReplyable) {
          iconEl.type = "button";
          iconEl.classList.add("gamelog-entry-icon--clickable");
          iconEl.setAttribute("data-bs-toggle", "tooltip");
          iconEl.setAttribute("data-bs-title", `Reply to ${entry.author?.name || "them"}`);
          iconEl.addEventListener("click", () => replyHandler(entry));
        } else if (visual.clickable) {
          iconEl.type = "button";
          iconEl.classList.add("gamelog-entry-icon--clickable");
          // Not gated on authorship — a GM's own spotlighted item is "on
          // their dashboard" by construction; toggling from here is exactly
          // as meaningful as doing it from the spotlight panel.
          const isOn = Boolean(isSpotlightOnDashboard?.({ kind: visual.kind, id: visual.id }));
          iconEl.classList.add(isOn ? "spotlight-panel-icon--mine" : "spotlight-panel-icon--available");
          iconEl.setAttribute("data-bs-toggle", "tooltip");
          iconEl.setAttribute(
            "data-bs-title",
            isOn ? "On your dashboard — click to remove" : "Click to add to your dashboard"
          );
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
        // A whisper/IC entry never reaches here unless the server already
        // decided this viewer may see it (server/groups.py's
        // _entry_visible_to) — the badges below are purely informational.
        const isWhisper = entry.type === "message" && Array.isArray(entry.recipient_ids) && entry.recipient_ids.length > 0;
        // A self-only Private roll/card — recipient_ids is always just [the
        // poster's own id], a self-whisper never a real whisper to someone
        // else — so this gets a plain "Private" indicator instead of the
        // @mention pill.
        const isPrivateRoll =
          (entry.type === "roll" || entry.type === "card") &&
          Array.isArray(entry.recipient_ids) &&
          entry.recipient_ids.length > 0;
        const isInCharacter = entry.type === "message" && Boolean(entry.in_character);
        const characterName = isInCharacter ? String(entry.payload?.characterName || "").trim() : "";
        // Someone ELSE @mentioned me since I last had this log open. A gold
        // highlight on the row itself, nothing more — a separate persistent
        // banner was tried and dropped since it never went away for the rest
        // of the viewing session; the highlight naturally sits near the top
        // too (newest-first sort).
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
        // "Belimmar: <dialogue>" — the speaker name stays upright and bold,
        // only the dialogue itself is italicized.
        if (isInCharacter && characterName) {
          textEl.appendChild(el("span", "fw-semibold", `${characterName}: `));
        }
        if (isWhisper) {
          // One compact inline pill — the pill text IS the @mention; the
          // real account username only shows on hover.
          const pill = el("span", "badge text-bg-secondary gamelog-mention-pill");
          pill.textContent = entry.recipient_ids.map((id) => `@${mentionDirectory.idToLabel(id) || "someone"}`).join(" ");
          const usernames = entry.recipient_ids.map((id) => mentionDirectory.idToUsername(id)).filter(Boolean);
          if (usernames.length) {
            pill.setAttribute("data-bs-toggle", "tooltip");
            pill.setAttribute("data-bs-title", usernames.join(", "));
          }
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
    refreshTooltips(list);
  }

  async function refresh(list) {
    if (destroyed || !groupId && !shareToken) return;
    try {
      const log = await dataManager.getGroupLog({ groupId, shareToken, limit: 20 });
      // `spotlight-update` is a silent data refresh on an already-shown
      // inline widget (a Clock tick, a Browser URL edit) — the original
      // `spotlight` entry already announced it, so these carry nothing worth
      // a log row.
      const entries = Array.isArray(log?.entries)
        ? log.entries.filter((entry) => entry?.type !== "spotlight-update")
        : [];
      const watermark = loadClearedWatermark(groupId || shareToken);
      const visible = watermark
        ? entries.filter((entry) => parseTimestamp(entry.created_at) > parseTimestamp(watermark))
        : entries;
      renderEntries(list, visible);
    } catch (error) {
      console.error("Game log widget: unable to load the log", error);
      list.innerHTML = "";
      const status = Number(error?.status) || 0;
      const message =
        status === 401 || status === 403
          ? "You don't have access to this campaign's log."
          : status === 404
            ? "This campaign's log couldn't be found."
            : status
              ? "Unable to load the log — the server returned an error."
              : "Unable to load the log — check your connection.";
      list.appendChild(el("p", "text-danger small mb-0", message));
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

    // Posting form goes first, above the entries list — with the list on
    // top, "Post a message" sank below however many entries were showing.
    // The newest entry is still first in the list (newest-first sort), so
    // reading order doesn't change, only where the compose box sits.
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
      // character" toggle: mentioning your own character (or, for the GM,
      // an NPC) IS what makes a message in character, since whispering
      // yourself is meaningless. This surfaces what will happen before Send,
      // off the same scanMentions call the submit handler uses.
      const identityHint = el("div", "text-body-secondary small fst-italic");
      setElementVisible(identityHint, false, "block");

      // @mention autocomplete — bespoke, not a shared picker, since it has
      // to anchor to a moving text-cursor position inside a plain <input>.
      let mentionEl = null;
      let mentionMatches = [];
      let mentionActiveIndex = 0;
      let mentionTokenStart = -1;
      // Every entry explicitly picked (click or Tab/Enter) from the
      // dropdown, keyed by its label — the picker already knows exactly
      // which character/NPC was meant, no ambiguity to re-derive at submit
      // time. Free-typed text (never touched the dropdown) still falls back
      // to the roster heuristic. Cleared on a successful send.
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
        // event, so the hint needs this explicit nudge.
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
          // handler, so mentionTokenStart/selectionStart are still valid.
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
      // Deferred — a suggestion's own mousedown already handles the insert
      // and preventDefault stops focus loss; this only catches a genuine
      // focus-away.
      input.addEventListener("blur", () => window.setTimeout(closeMentionDropdown, 0));

      // Wired to the entry icon's own click above — starts a fresh reply
      // addressed to whoever posted that entry, overwriting any in-progress
      // draft. Uses the author's real username, or the reserved "GM" token
      // when the author IS the GM (their username isn't threaded through
      // this client, only their id via ownerId).
      replyHandler = (entry) => {
        const authorId = entry.author?.id;
        if (authorId == null) return;
        const mentionText = authorId === ownerId ? MENTION_GM_LABEL : entry.author?.name || "";
        if (!mentionText) return;
        const directoryMatch = mentionDirectory.allLabels.find(
          (candidate) => candidate.label.toLowerCase() === mentionText.toLowerCase()
        );
        input.value = `@${mentionText} `;
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
        // access control has to stay correct regardless of display
        // stripping below.
        const matches = scanMentions(trimmed, mentionDirectory, confirmedMentions);
        const recipientIds = Array.from(
          new Set(matches.filter((entry) => entry.recipientId != null).map((entry) => entry.recipientId))
        );
        // A leading "@Belimmar"/"@Maris" is a speaker tag or whisper
        // address, not part of what got said — stripped so it never
        // posts/displays as literal "@" text alongside the name/pill that
        // already convey the same thing.
        const { body: message, identityLabel } = stripLeadingMentions(trimmed, mentionDirectory, confirmedMentions);
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

  // Purely local — hides older entries from this browser's own view only;
  // the log itself stays shared, persistent history, and nothing here ever
  // deletes from it.
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

  // Wakes the existing poll up sooner on a relevant change; polling above
  // keeps running unchanged either way.
  const liveStream = connectLiveStream({ dataManager, groupId, kinds: ["group_log"], shareToken });
  liveStream.subscribe("group_log", () => {
    if (activeList) void refresh(activeList);
  });

  return {
    refresh: refreshNow,
    destroy() {
      destroyed = true;
      if (pollTimer) window.clearInterval(pollTimer);
      liveStream.close();
      container.innerHTML = "";
      // Advance the "seen" watermark now, not at mount — a mention that
      // arrived while open stays flagged new for the whole session.
      saveMentionSeenWatermark(groupId || shareToken);
    },
  };
}
