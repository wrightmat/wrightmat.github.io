// A chat message body's reference vocabulary: @mentions, [[wikilinks]] to
// Repository pages, and [[msg:ID]] references to other messages (a reply is a
// message whose body opens with one). The composer turns what was typed into a
// `refs` list for the server to index; renderChatBody turns a stored body back
// into DOM. No innerHTML anywhere — bodies are user text.
import { el } from "../dom.js";
import { createReferenceChip } from "../library-reference.js";
import { buildKindToolUrl } from "../kind-tool-route.js";

const LEADING_REPLY = /^\s*\[\[msg:\d+(?:\|[^\]]*)?\]\]\s*/;
const MESSAGE_REF = /\[\[msg:(\d+)(?:\|[^\]]*)?\]\]/g;
const WIKILINK = /\[\[([^\]|#[]+?)(?:#([^\]|]+))?(?:\|([^\]]+))?\]\]/g;

export function replyPrefix(messageId) {
  return `[[msg:${messageId}]] `;
}

export function stripLeadingReply(body) {
  return String(body || "").replace(LEADING_REPLY, "");
}

function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Who can be @mentioned without searching: the GM, each rostered character,
// and each character's owner. `kind: "user"` entries notify that person;
// anything else is a Library record (which also gets a backlink).
export function buildMentionDirectory({ roster = [], ownerId = null, currentUserId = null } = {}) {
  const entries = [];
  const seen = new Set();
  const add = (label, kind, id) => {
    const text = String(label || "").trim();
    const key = text.toLowerCase();
    if (!text || id == null || seen.has(key)) return;
    seen.add(key);
    entries.push({ label: text, kind, id: String(id) });
  };
  if (ownerId != null && ownerId !== currentUserId) add("GM", "user", ownerId);
  (Array.isArray(roster) ? roster : []).forEach((entry) => {
    if (entry?.content_type !== "character") return;
    add(entry.label, "character", entry.content_id);
    if (entry.owner_id != null && entry.owner_id !== currentUserId) add(entry.owner_username, "user", entry.owner_id);
  });
  return entries;
}

// A page-title lookup built from Repository page summaries ({id, name}).
export function buildJournalIndex(summaries = []) {
  const byTitle = new Map();
  summaries.forEach((entry) => {
    const key = String(entry?.name || "").trim().toLowerCase();
    if (key && !byTitle.has(key)) byTitle.set(key, { id: entry.id, title: entry.name });
  });
  return { resolve: (title) => byTitle.get(String(title || "").trim().toLowerCase()) || null };
}

function mentionPresent(lowerBody, lowerLabel) {
  let index = lowerBody.indexOf(`@${lowerLabel}`);
  while (index !== -1) {
    const before = index === 0 ? " " : lowerBody[index - 1];
    const after = lowerBody[index + 1 + lowerLabel.length];
    if (/\s/.test(before) && (after === undefined || /\W/.test(after))) return true;
    index = lowerBody.indexOf(`@${lowerLabel}`, index + 1);
  }
  return false;
}

// Everything in `body` the server should index. `confirmed` holds mentions
// picked from the dropdown (any Library record, not just the roster).
export function collectRefs(body, { directory = [], confirmed = new Map(), journalIndex = null } = {}) {
  const text = String(body || "");
  const lower = text.toLowerCase();
  const refs = [];
  const seen = new Set();
  const push = (ref) => {
    const key = `${ref.type}:${ref.kind}:${ref.id}`;
    if (seen.has(key)) return;
    seen.add(key);
    refs.push(ref);
  };
  [...confirmed.values(), ...directory]
    .sort((a, b) => b.label.length - a.label.length)
    .forEach((candidate) => {
      if (mentionPresent(lower, candidate.label.toLowerCase())) {
        push({ type: "mention", kind: candidate.kind, id: String(candidate.id), label: candidate.label });
      }
    });
  for (const match of text.matchAll(MESSAGE_REF)) {
    push({ type: "message", kind: "message", id: match[1], label: "" });
  }
  for (const match of text.matchAll(WIKILINK)) {
    const title = match[1].trim();
    if (/^msg:/i.test(title)) continue;
    const page = journalIndex?.resolve(title);
    if (page) push({ type: "wikilink", kind: "journal", id: page.id, label: title });
  }
  return refs;
}

function openKindInTool(kind, id) {
  const url = buildKindToolUrl(kind, id);
  if (url) window.open(url, "_blank", "noopener");
}

function appendFormatted(container, line, pattern, context) {
  let cursor = 0;
  for (const match of line.matchAll(pattern)) {
    if (match.index > cursor) container.appendChild(document.createTextNode(line.slice(cursor, match.index)));
    cursor = match.index + match[0].length;
    const groups = match.groups;
    if (groups.msg) {
      const button = el("button", "btn btn-link btn-sm p-0 align-baseline chat-msgref", `↩ #${groups.msg}`);
      button.type = "button";
      button.addEventListener("click", () => context.onOpenMessage?.(Number(groups.msg)));
      container.appendChild(button);
    } else if (groups.title) {
      const title = groups.title.trim();
      const label = (groups.alias || title).trim();
      const page = context.resolveJournal?.(title);
      if (page) {
        const link = el("a", null, label);
        link.href = buildKindToolUrl("journal", page.id, { extraParams: { heading: groups.heading } }) || "#";
        link.target = "_blank";
        link.rel = "noopener";
        container.appendChild(link);
      } else {
        container.appendChild(el("span", "text-body-secondary", label));
      }
    } else if (groups.mention) {
      const ref = context.mentionRefs.find((entry) => entry.label.toLowerCase() === groups.mention.toLowerCase());
      if (ref && ref.kind !== "user") {
        container.appendChild(
          createReferenceChip({
            kind: ref.kind,
            id: ref.id,
            name: `@${ref.label}`,
            dataManager: context.dataManager,
            interactive: true,
            onOpen: openKindInTool,
          })
        );
      } else {
        container.appendChild(el("span", "badge text-bg-secondary chat-mention", `@${groups.mention}`));
      }
    } else if (groups.bold) {
      container.appendChild(el("strong", null, groups.bold));
    } else if (groups.italic) {
      container.appendChild(el("em", null, groups.italic));
    } else if (groups.code) {
      container.appendChild(el("code", null, groups.code));
    }
  }
  if (cursor < line.length) container.appendChild(document.createTextNode(line.slice(cursor)));
}

// `stripReply` drops the opening [[msg:ID]] when the message shows its parent
// as a quoted preview instead.
export function renderChatBody(container, body, { refs = [], dataManager, resolveJournal, onOpenMessage, stripReply = false } = {}) {
  const text = stripReply ? stripLeadingReply(body) : String(body || "");
  const mentionRefs = refs.filter((ref) => ref.type === "mention" && ref.label);
  const mentionAlternatives = mentionRefs
    .map((ref) => escapeRegExp(ref.label))
    .sort((a, b) => b.length - a.length)
    .join("|");
  const sources = [
    "\\[\\[msg:(?<msg>\\d+)(?:\\|[^\\]]*)?\\]\\]",
    "\\[\\[(?<title>[^\\]|#[]+?)(?:#(?<heading>[^\\]|]+))?(?:\\|(?<alias>[^\\]]+))?\\]\\]",
    mentionAlternatives ? `@(?<mention>${mentionAlternatives})(?!\\w)` : null,
    "\\*\\*(?<bold>[^*\\n]+)\\*\\*",
    "(?<![\\w*])\\*(?<italic>[^*\\n]+)\\*(?![\\w*])",
    "`(?<code>[^`\\n]+)`",
  ].filter(Boolean);
  const pattern = new RegExp(sources.join("|"), "gi");
  const context = { dataManager, resolveJournal, onOpenMessage, mentionRefs };
  text.split("\n").forEach((line, index) => {
    if (index) container.appendChild(document.createElement("br"));
    appendFormatted(container, line, pattern, context);
  });
}
