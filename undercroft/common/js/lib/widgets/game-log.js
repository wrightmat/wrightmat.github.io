// Group chat widget — mounted as a Dashboard widget card and inline in
// Workbench's own collapsible section (workbench-character-view.js), one real
// implementation for both. Channels -> threads -> messages; the pieces live in
// ../chat/ and this module only orchestrates them for one campaign.
import { connectLiveStream } from "../live.js";
import { el, setElementVisible } from "../dom.js";
import { fetchKindEntriesWithIds, fetchKindEntrySummaries } from "../content-fetch.js";
import { showConfirmModal } from "../confirm-modal.js";
import { buildKindToolUrl } from "../kind-tool-route.js";
import { disposeTooltips, refreshTooltips } from "../tooltips.js";
import { createChatNavigator } from "../chat/navigator.js";
import { createComposer } from "../chat/composer.js";
import { renderMessage } from "../chat/message.js";
import { createVoiceDirectory } from "../chat/voice.js";
import { buildJournalIndex, buildMentionDirectory, collectRefs } from "../chat/refs.js";
import { findThread, formatThreadLabel } from "../chat/target.js";
import { openInbox } from "../chat/inbox.js";

const POLL_INTERVAL_MS = 30000;
const PAGE_SIZE = 50;
const REFRESH_DEBOUNCE_MS = 300;
const FLASH_MS = 1500;

// `fill` — the container has a fixed height to use up (a Dashboard card): the
// message list grows into it. Without it the list is capped and the page scrolls.
export function initGameLogWidget(container, { dataManager, status, groupId = "", shareToken = "", roster = [], ownerId = null, fill = false } = {}) {
  if (!container || !dataManager) {
    return { destroy() {} };
  }
  if (!groupId && !shareToken) {
    container.appendChild(el("p", "text-body-secondary small mb-0", "No active campaign — pick one from the header menu."));
    return { refresh() {}, destroy: () => (container.innerHTML = "") };
  }

  const authed = dataManager.isAuthenticated();
  // A share-link visitor mounts with a token and no group id; the overview
  // reports the group the token points at.
  const campaignId = () => groupId || overview?.group?.id || "";
  const currentUserId = dataManager.session?.user?.id ?? null;
  let destroyed = false;
  let overview = null;
  let current = null; // { thread, channel }
  let messages = [];
  let hasMore = false;
  let refreshTimer = 0;
  let journalTitles = null;
  let journalEntries = [];
  let journalEntriesPromise = null;

  const voiceDirectory = createVoiceDirectory({ dataManager, roster, ownerId });
  const mentionDirectory = buildMentionDirectory({ roster, ownerId, currentUserId });
  let journalIndex = buildJournalIndex([]);

  const wrap = el("div", `d-flex flex-column gap-2${fill ? " flex-grow-1" : ""}`);
  wrap.style.minHeight = "0";
  const scroll = el("div", `chat-scroll${fill ? " chat-scroll--fill" : ""}`);
  const olderButton = el("button", "btn btn-link btn-sm w-100", "Load earlier messages");
  olderButton.type = "button";
  setElementVisible(olderButton, false, "block");
  const list = el("div");
  const archivedNote = el("div", "small text-body-secondary fst-italic");
  setElementVisible(archivedNote, false, "block");
  // Newest first: older messages continue below, so "load earlier" is last.
  scroll.append(list, olderButton);

  const navigator = createChatNavigator({
    dataManager,
    status,
    groupId,
    roster,
    ownerId,
    onSelectThread: (thread, channel) => void selectThread(thread.id, channel?.id),
    onChanged: () => refreshOverview(),
  });

  const composer = authed
    ? createComposer({
        dataManager,
        status,
        voiceDirectory,
        roster,
        ownerId,
        groupId,
        shareToken,
        getJournalEntries: () => journalEntries,
        getJournalIndex: () => journalIndex,
        ensureJournal: () => ensureJournalEntries(),
        onPosted: () => void loadMessages({ stickToTop: true }),
      })
    : null;

  // Composer sits under the channel/thread picker, above the newest-first list.
  wrap.appendChild(navigator.element);
  if (composer) wrap.appendChild(composer.element);
  wrap.append(archivedNote, scroll);
  container.appendChild(wrap);

  // Page titles resolve [[links]] in rendered bodies; the full bodies (for the
  // composer's heading/table completion) are only fetched once someone types.
  async function ensureJournalTitles() {
    if (journalTitles || !authed) return;
    journalTitles = fetchKindEntrySummaries(dataManager, "journal").catch(() => []);
    journalIndex = buildJournalIndex(await journalTitles);
    renderList();
  }

  function ensureJournalEntries() {
    if (!journalEntriesPromise && authed) {
      journalEntriesPromise = fetchKindEntriesWithIds(dataManager, "journal")
        .then((entries) => {
          journalEntries = entries.map((entry) => ({ id: entry.id, payload: entry.entity }));
        })
        .catch(() => {});
    }
    return journalEntriesPromise;
  }

  function showError(error) {
    list.textContent = "";
    const code = Number(error?.status) || 0;
    const message =
      code === 401 || code === 403
        ? "You don't have access to this campaign's messages."
        : code === 404
          ? "This campaign's messages couldn't be found."
          : code
            ? "Unable to load messages — the server returned an error."
            : "Unable to load messages — check your connection.";
    list.appendChild(el("p", "text-danger small mb-0", message));
  }

  function messageContext() {
    const archived = Boolean(current?.thread.archivedAt);
    return {
      viewer: { userId: currentUserId, isGm: Boolean(overview?.viewer?.isGm) },
      dataManager,
      reactionEmoji: overview?.reactionEmoji || [],
      canPost: authed && !archived,
      canReact: authed && !archived,
      archived,
      resolveJournal: (title) => journalIndex.resolve(title),
      onOpenMessage: (id) => void openMessage(id),
      onReply: (message) => composer?.startReply(message),
      onReact: (message, emoji) => void react(message, emoji),
      onDelete: (message) => void remove(message),
      onEditSubmit: (message, text) => edit(message, text),
      onDirectMessage: (message) => void directMessage(message),
    };
  }

  function renderList({ stickToTop = false } = {}) {
    const nearTop = scroll.scrollTop < 48;
    disposeTooltips(list);
    list.textContent = "";
    if (!messages.length) {
      list.appendChild(el("p", "text-body-secondary small mb-0", "No messages yet."));
    } else {
      const context = messageContext();
      [...messages].reverse().forEach((message) => list.appendChild(renderMessage(message, context)));
    }
    refreshTooltips(list);
    setElementVisible(olderButton, hasMore, "block");
    if (stickToTop || nearTop) scroll.scrollTop = 0;
  }

  async function loadMessages({ stickToTop = false } = {}) {
    if (destroyed || !current) return;
    try {
      const result = await dataManager.getChatMessages({ groupId, shareToken, threadId: current.thread.id, limit: PAGE_SIZE });
      if (destroyed || result.thread.id !== current.thread.id) return;
      messages = result.messages;
      hasMore = result.hasMore;
      current.thread = result.thread;
      renderList({ stickToTop });
      composer?.setThread({ id: current.thread.id, mode: current.channel.mode, lastVoice: result.lastVoice });
      setElementVisible(archivedNote, Boolean(current.thread.archivedAt), "block");
      archivedNote.textContent = current.thread.archivedAt ? "This thread is archived and read-only." : "";
      if (composer) setElementVisible(composer.element, !current.thread.archivedAt, "flex");
      if (authed && !current.thread.archivedAt) {
        await dataManager.markChatThreadRead({ groupId: campaignId(), threadId: current.thread.id }).catch(() => {});
      }
    } catch (error) {
      console.error("Chat widget: unable to load messages", error);
      showError(error);
    }
  }

  async function refreshOverview() {
    if (destroyed) return;
    overview = await dataManager.getChatOverview({ groupId, shareToken });
    const found = current ? findThread(overview, current.thread.id) : null;
    if (found) {
      current = { thread: found.thread, channel: found.channel };
    } else {
      const fallback = findThread(overview, overview.defaultThreadId);
      if (fallback) {
        await selectThread(fallback.thread.id, fallback.channel.id);
        return;
      }
    }
    navigator.update(overview, current?.thread.id);
  }

  async function selectThread(threadId, channelId) {
    if (!overview) return;
    const found = findThread(overview, threadId);
    if (!found || (channelId && found.channel.id !== channelId)) return;
    current = { thread: found.thread, channel: found.channel };
    if (authed) dataManager.setActiveThread(groupId || overview.group.id, found.thread.id, formatThreadLabel(found.channel.name, found.thread.title));
    navigator.update(overview, found.thread.id);
    messages = [];
    hasMore = false;
    await loadMessages({ stickToTop: true });
    // Unread counts changed now that this thread was read.
    overview = await dataManager.getChatOverview({ groupId, shareToken }).catch(() => overview);
    navigator.update(overview, current?.thread.id);
  }

  function flash(messageId) {
    const row = list.querySelector(`[data-message-id="${messageId}"]`);
    if (!row) return false;
    row.scrollIntoView({ block: "center" });
    row.classList.add("table-warning");
    window.setTimeout(() => row.classList.remove("table-warning"), FLASH_MS);
    return true;
  }

  // A message reference: scroll to it if it's loaded, switch threads if it's
  // elsewhere in this campaign, or open its archive page.
  async function openMessage(messageId) {
    if (flash(messageId)) return;
    try {
      const resolved = await dataManager.resolveChatMessages([messageId]);
      const info = resolved.messages?.[String(messageId)];
      if (!info) {
        status?.show("That message isn't available to you.", { type: "info" });
        return;
      }
      if (info.archived && info.archivePageId) {
        const url = buildKindToolUrl("journal", info.archivePageId, { extraParams: { block: `m${messageId}` } });
        if (url) window.open(url, "_blank", "noopener");
        return;
      }
      if (info.groupId === (groupId || overview?.group.id)) {
        await selectThread(info.threadId);
        flash(messageId);
      }
    } catch (error) {
      status?.show(error.message || "Unable to open that message.", { type: "error" });
    }
  }

  async function act(action, failure) {
    try {
      await action();
      await loadMessages();
    } catch (error) {
      status?.show(error.message || failure, { type: "error" });
    }
  }

  const react = (message, emoji) => act(() => dataManager.toggleChatReaction({ groupId: campaignId(), messageId: message.id, emoji }), "Unable to react.");

  async function remove(message) {
    const confirmed = await showConfirmModal({
      title: "Delete message?",
      bodyHtml: "<p class=\"mb-0\">Replies to it will show that it was deleted.</p>",
      confirmLabel: "Delete",
      confirmVariant: "danger",
    });
    if (confirmed) await act(() => dataManager.deleteChatMessage({ groupId: campaignId(), messageId: message.id }), "Unable to delete the message.");
  }

  async function edit(message, text) {
    const refs = collectRefs(text, { directory: mentionDirectory, journalIndex });
    try {
      await dataManager.editChatMessage({ groupId: campaignId(), messageId: message.id, body: text, refs });
      await loadMessages();
    } catch (error) {
      status?.show(error.message || "Unable to edit the message.", { type: "error" });
      throw error;
    }
  }

  // Private messages are written in the Inbox, addressed to the message's author.
  function directMessage(message) {
    openInbox({
      dataManager,
      status,
      compose: { groupId: campaignId(), selectedIds: [message.author.id], title: `Message ${message.author.name || "them"}` },
    });
  }

  olderButton.addEventListener("click", async () => {
    if (!messages.length || !current) return;
    try {
      const result = await dataManager.getChatMessages({
        groupId,
        shareToken,
        threadId: current.thread.id,
        before: messages[0].id,
        limit: PAGE_SIZE,
      });
      messages = [...result.messages, ...messages];
      hasMore = result.hasMore;
      renderList();
    } catch (error) {
      status?.show(error.message || "Unable to load earlier messages.", { type: "error" });
    }
  });

  function scheduleRefresh() {
    window.clearTimeout(refreshTimer);
    refreshTimer = window.setTimeout(() => {
      // A new message may be a mention or reply for this person.
      window.dispatchEvent(new CustomEvent("undercroft:inbox-changed"));
      void loadMessages();
      void refreshOverview().catch(() => {});
    }, REFRESH_DEBOUNCE_MS);
  }

  const onActiveThreadChanged = (event) => {
    const detail = event.detail || {};
    if (detail.groupId && detail.groupId === (groupId || overview?.group.id) && detail.threadId !== current?.thread.id) {
      void selectThread(detail.threadId);
    }
  };
  // Dispatched by the Inbox: open this message's thread and scroll to it.
  const onOpenMessageRequested = async (event) => {
    const detail = event.detail || {};
    if (detail.groupId !== (groupId || overview?.group.id)) return;
    if (detail.threadId) await selectThread(detail.threadId);
    if (detail.messageId) flash(detail.messageId);
  };
  window.addEventListener("undercroft:active-thread-changed", onActiveThreadChanged);
  window.addEventListener("undercroft:chat-open-message", onOpenMessageRequested);

  async function start() {
    try {
      overview = await dataManager.getChatOverview({ groupId, shareToken });
      const stored = authed ? dataManager.getActiveThread() : null;
      const wanted = (stored && findThread(overview, stored.threadId)) || findThread(overview, overview.defaultThreadId);
      if (!wanted) {
        showError();
        return;
      }
      navigator.update(overview, wanted.thread.id);
      await selectThread(wanted.thread.id, wanted.channel.id);
      void ensureJournalTitles();
    } catch (error) {
      console.error("Chat widget: unable to load", error);
      showError(error);
    }
  }
  void start();

  const pollTimer = window.setInterval(scheduleRefresh, POLL_INTERVAL_MS);
  const liveGroupId = groupId;
  const liveStream = connectLiveStream({ dataManager, groupId: liveGroupId, kinds: ["chat"], shareToken });
  liveStream.subscribe("chat", scheduleRefresh);

  return {
    refresh: async () => {
      await refreshOverview().catch(() => {});
      await loadMessages();
    },
    destroy() {
      destroyed = true;
      window.clearInterval(pollTimer);
      window.clearTimeout(refreshTimer);
      window.removeEventListener("undercroft:active-thread-changed", onActiveThreadChanged);
      window.removeEventListener("undercroft:chat-open-message", onOpenMessageRequested);
      liveStream.close();
      composer?.destroy();
      disposeTooltips(container);
      container.innerHTML = "";
    },
  };
}
