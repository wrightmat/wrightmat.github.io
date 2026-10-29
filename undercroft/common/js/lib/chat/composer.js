// The chat composer: a "Post as" voice selector, a textarea with `[[` page and
// `@` mention autocomplete, and the Reply banner. The server re-validates the
// voice and every reference; this only builds them.
import { el, setElementVisible } from "../dom.js";
import { createIconButton } from "../ui-components.js";
import { EXCLUDED_KINDS } from "../library-reference.js";
import { attachWikiLinkAutocomplete } from "../../../../repository/js/lib/wiki-link-autocomplete.js";
import { buildMentionDirectory, collectRefs, replyPrefix } from "./refs.js";
import { voiceKey } from "./voice.js";

const MENTION_LIMIT = 8;
const MENTION_SEARCH_DELAY_MS = 250;

function voiceLabel(voice) {
  if (voice.type === "user") return `${voice.name} (you)`;
  if (voice.type === "character") return voice.name;
  return `${voice.name} (${voice.type})`;
}

export function createComposer({
  dataManager,
  status,
  voiceDirectory,
  roster = [],
  ownerId = null,
  groupId = "",
  shareToken = "",
  getJournalEntries,
  getJournalIndex,
  ensureJournal,
  onPosted,
} = {}) {
  const currentUserId = dataManager.session?.user?.id ?? null;
  const directory = buildMentionDirectory({ roster, ownerId, currentUserId });
  const confirmedMentions = new Map();
  let thread = { id: "", mode: null, lastVoice: null };
  let replyTo = null;
  let voices = new Map();
  const extraVoices = [];
  let mentionStart = -1;
  let mentionMatches = [];
  let mentionActive = 0;
  let mentionSearchTimer = 0;
  let mentionSearchToken = 0;

  const form = el("form", "d-flex flex-column gap-1 position-relative chat-composer");

  const replyBanner = el("div", "d-flex align-items-center justify-content-between gap-2 small text-body-secondary border-start ps-2");
  const replyText = el("span", "text-truncate");
  const replyCancel = createIconButton({
    icon: "tabler:x",
    label: "Cancel reply",
    variant: "link",
    className: "p-0 text-body-secondary",
    onClick: () => setReply(null),
  });
  replyBanner.append(replyText, replyCancel);
  setElementVisible(replyBanner, false, "flex");

  const voiceRow = el("div", "d-flex align-items-center gap-1");
  const voiceSelect = el("select", "form-select form-select-sm chat-voice-select");
  voiceSelect.setAttribute("aria-label", "Post as");
  const voiceSearchToggle = createIconButton({
    icon: "tabler:search",
    label: "Find an NPC or monster to speak as",
    variant: "outline-secondary",
    onClick: () => {
      const showing = voiceSearchWrap.style.display !== "none";
      setElementVisible(voiceSearchWrap, !showing, "block");
      if (!showing) voiceSearchInput.focus();
    },
  });
  voiceRow.append(el("span", "small text-body-secondary flex-shrink-0", "Post as"), voiceSelect, voiceSearchToggle);

  const voiceSearchWrap = el("div", "position-relative");
  const voiceSearchInput = el("input", "form-control form-control-sm");
  voiceSearchInput.type = "text";
  voiceSearchInput.placeholder = "Search NPCs and monsters…";
  const voiceResults = el("div", "list-group chat-dropdown");
  setElementVisible(voiceResults, false, "block");
  voiceSearchWrap.append(voiceSearchInput, voiceResults);
  setElementVisible(voiceSearchWrap, false, "block");

  const inputRow = el("div", "d-flex gap-2 align-items-end");
  const textarea = el("textarea", "form-control form-control-sm");
  textarea.rows = 1;
  textarea.placeholder = "Write a message… (@ to mention, [[ to link a page)";
  const sendButton = el("button", "btn btn-outline-primary btn-sm", "Send");
  sendButton.type = "submit";
  inputRow.append(textarea, sendButton);

  const mentionDropdown = el("div", "list-group chat-dropdown chat-mention-dropdown");
  setElementVisible(mentionDropdown, false, "block");

  form.append(replyBanner, voiceRow, voiceSearchWrap, inputRow, mentionDropdown);

  const wikiAutocomplete = attachWikiLinkAutocomplete(textarea, { getEntries: () => getJournalEntries?.() || [] });

  function setReply(message) {
    replyTo = message;
    if (message) {
      const who = message.voice?.name || message.author?.name || "message";
      replyText.textContent = `Replying to ${who}`;
    }
    setElementVisible(replyBanner, Boolean(message), "flex");
  }

  function rebuildVoices(preferred) {
    const wanted = preferred || (voices.get(voiceSelect.value) ?? null) || thread.lastVoice;
    const options = [...voiceDirectory.allowed(thread.mode)];
    if (voiceDirectory.isGm && thread.mode !== "ooc") {
      extraVoices.forEach((voice) => {
        if (!options.some((entry) => voiceKey(entry) === voiceKey(voice))) options.push(voice);
      });
    }
    voices = new Map(options.map((voice) => [voiceKey(voice), voice]));
    voiceSelect.textContent = "";
    options.forEach((voice) => {
      const option = el("option", null, voiceLabel(voice));
      option.value = voiceKey(voice);
      voiceSelect.appendChild(option);
    });
    const wantedKey = wanted ? `${wanted.type}:${wanted.id}` : "";
    voiceSelect.value = voices.has(wantedKey) ? wantedKey : options[0] ? voiceKey(options[0]) : "";
    const hasVoice = options.length > 0;
    textarea.disabled = !hasVoice || !thread.id;
    sendButton.disabled = !hasVoice || !thread.id;
    textarea.placeholder = hasVoice
      ? "Write a message… (@ to mention, [[ to link a page)"
      : "You have no character in this group to speak as here.";
    setElementVisible(voiceSearchToggle, voiceDirectory.isGm && thread.mode !== "ooc", "inline-flex");
    if (!(voiceDirectory.isGm && thread.mode !== "ooc")) setElementVisible(voiceSearchWrap, false, "block");
  }

  function closeMentions() {
    mentionStart = -1;
    mentionMatches = [];
    setElementVisible(mentionDropdown, false, "block");
  }

  function renderMentions() {
    mentionDropdown.textContent = "";
    mentionMatches.forEach((match, index) => {
      const item = el("button", `list-group-item list-group-item-action py-1 px-2 small${index === mentionActive ? " active" : ""}`);
      item.type = "button";
      item.textContent = `@${match.label}`;
      if (match.kind !== "user" && match.kind !== "character") {
        item.appendChild(el("span", "ms-2 opacity-75", match.kind));
      }
      // mousedown, not click: fires before the textarea's blur, so the caret
      // position is still valid when the mention is inserted.
      item.addEventListener("mousedown", (event) => {
        event.preventDefault();
        insertMention(match);
      });
      mentionDropdown.appendChild(item);
    });
    setElementVisible(mentionDropdown, mentionMatches.length > 0, "block");
  }

  function insertMention(match) {
    const cursor = textarea.selectionStart ?? textarea.value.length;
    const before = textarea.value.slice(0, mentionStart);
    const after = textarea.value.slice(cursor);
    const inserted = `@${match.label} `;
    textarea.value = `${before}${inserted}${after}`;
    confirmedMentions.set(match.label.toLowerCase(), { label: match.label, kind: match.kind, id: String(match.id) });
    closeMentions();
    textarea.focus();
    const next = before.length + inserted.length;
    textarea.setSelectionRange(next, next);
  }

  async function updateMentions() {
    const cursor = textarea.selectionStart ?? textarea.value.length;
    const upToCursor = textarea.value.slice(0, cursor);
    const atIndex = upToCursor.lastIndexOf("@");
    if (atIndex === -1 || (atIndex > 0 && !/\s/.test(upToCursor[atIndex - 1])) || /\s/.test(upToCursor.slice(atIndex + 1))) {
      closeMentions();
      return;
    }
    const query = upToCursor.slice(atIndex + 1).toLowerCase();
    mentionStart = atIndex;
    mentionMatches = directory.filter((entry) => entry.label.toLowerCase().startsWith(query)).slice(0, MENTION_LIMIT);
    mentionActive = 0;
    renderMentions();
    window.clearTimeout(mentionSearchTimer);
    if (query.length < 2) return;
    const token = ++mentionSearchToken;
    mentionSearchTimer = window.setTimeout(async () => {
      try {
        const results = await dataManager.searchContent(query);
        if (token !== mentionSearchToken || mentionStart !== atIndex) return;
        const known = new Set(mentionMatches.map((entry) => `${entry.kind}:${entry.id}`));
        results
          .filter((result) => result.kind && result.id && !EXCLUDED_KINDS.has(result.kind) && result.kind !== "group")
          .forEach((result) => {
            if (mentionMatches.length >= MENTION_LIMIT || known.has(`${result.kind}:${result.id}`)) return;
            mentionMatches.push({ label: result.title || result.id, kind: result.kind, id: String(result.id) });
          });
        renderMentions();
      } catch (error) {
        // Search is a convenience; the roster matches above still work.
      }
    }, MENTION_SEARCH_DELAY_MS);
  }

  async function renderVoiceResults() {
    const results = await voiceDirectory.search(voiceSearchInput.value, thread.mode);
    voiceResults.textContent = "";
    results.forEach((voice) => {
      const item = el("button", "list-group-item list-group-item-action py-1 px-2 small", voiceLabel(voice));
      item.type = "button";
      item.addEventListener("click", () => {
        if (!extraVoices.some((entry) => voiceKey(entry) === voiceKey(voice))) extraVoices.push(voice);
        rebuildVoices(voice);
        voiceSearchInput.value = "";
        setElementVisible(voiceResults, false, "block");
        setElementVisible(voiceSearchWrap, false, "block");
      });
      voiceResults.appendChild(item);
    });
    setElementVisible(voiceResults, results.length > 0, "block");
  }

  voiceSearchInput.addEventListener("input", () => void renderVoiceResults());

  textarea.addEventListener("focus", () => void ensureJournal?.());
  textarea.addEventListener("input", () => {
    textarea.style.height = "auto";
    textarea.style.height = `${Math.min(textarea.scrollHeight, 140)}px`;
    void updateMentions();
  });
  textarea.addEventListener("keydown", (event) => {
    if (mentionDropdown.style.display !== "none" && mentionMatches.length) {
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        const step = event.key === "ArrowDown" ? 1 : -1;
        mentionActive = (mentionActive + step + mentionMatches.length) % mentionMatches.length;
        renderMentions();
        return;
      }
      if (event.key === "Enter" || event.key === "Tab") {
        event.preventDefault();
        insertMention(mentionMatches[mentionActive]);
        return;
      }
      if (event.key === "Escape") {
        closeMentions();
        return;
      }
    }
    // The `[[` autocomplete registered its own keydown first and marks the
    // event handled when it consumed Enter.
    if (event.key === "Enter" && !event.shiftKey && !event.defaultPrevented) {
      event.preventDefault();
      form.requestSubmit();
    }
  });
  textarea.addEventListener("blur", () => window.setTimeout(closeMentions, 0));

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const typed = textarea.value.trim();
    if (!typed || !thread.id) return;
    const body = `${replyTo ? replyPrefix(replyTo.id) : ""}${typed}`;
    const voice = voices.get(voiceSelect.value);
    const refs = collectRefs(body, { directory, confirmed: confirmedMentions, journalIndex: getJournalIndex?.() || null });
    sendButton.disabled = true;
    try {
      const message = await dataManager.postChatMessage({
        groupId,
        shareToken,
        threadId: thread.id,
        body,
        voice: voice ? { type: voice.type, id: voice.id } : undefined,
        refs,
      });
      textarea.value = "";
      textarea.style.height = "auto";
      confirmedMentions.clear();
      setReply(null);
      closeMentions();
      onPosted?.(message);
    } catch (error) {
      status?.show(error.message || "Unable to post.", { type: "error" });
    } finally {
      sendButton.disabled = false;
    }
  });

  return {
    element: form,
    // `lastVoice` is what the server remembers for this person in this thread.
    setThread({ id, mode, lastVoice }) {
      const changed = id !== thread.id;
      thread = { id: id || "", mode: mode || null, lastVoice: lastVoice || null };
      if (changed) setReply(null);
      rebuildVoices(changed ? thread.lastVoice : null);
    },
    startReply(message) {
      setReply(message);
      textarea.focus();
    },
    focus: () => textarea.focus(),
    destroy() {
      window.clearTimeout(mentionSearchTimer);
      wikiAutocomplete.destroy();
      form.remove();
    },
  };
}
