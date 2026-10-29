// The Inbox: mentions of you or your characters, replies/references to your
// messages, and direct messages, across every campaign you're in. Ordinary
// posts are never Inbox items — they show as unread counts on threads.
// A modal laid out like a mail client: the list on the left, the selected
// item (or the compose form) on the right.
import { el, setElementVisible } from "../dom.js";
import { initHelpSystem } from "../help.js";
import { createIconButton } from "../ui-components.js";
import { formatDateTime, formatTimestamp } from "./format.js";
import { openMessageSummary } from "./open-message.js";
import { renderEmojiPicker, renderReactionChips } from "./reactions.js";
import { listDirectMessageRecipients } from "./direct-message.js";
import { localDateToUtc } from "../sessions/local.js";
import { describeDuration, formatSessionRange } from "../sessions/format.js";

const POLL_INTERVAL_MS = 45000;
export const INBOX_CHANGED_EVENT = "undercroft:inbox-changed";

const REASON_LABELS = {
  mention: "Mention",
  reference: "Reply",
  direct: "Direct message",
  session: "Session",
  session_reminder: "Session reminder",
  session_alert: "Session needs players",
  session_promoted: "Waitlist: you're in",
};

// Keeps `onCount(unread)` current: immediately, then on a timer and whenever
// the inbox is read or a message sent. There is no per-user live stream, so
// this is polling.
export function watchInboxCount({ dataManager, onCount } = {}) {
  let stopped = false;
  async function refresh() {
    if (stopped || !dataManager.isAuthenticated()) return;
    try {
      const { unread } = await dataManager.getInboxCount();
      if (!stopped) onCount(unread || 0);
    } catch (error) {
      // Transient failure — try again next tick.
    }
  }
  void refresh();
  const timer = window.setInterval(refresh, POLL_INTERVAL_MS);
  window.addEventListener(INBOX_CHANGED_EVENT, refresh);
  window.addEventListener("focus", refresh);
  return {
    refresh,
    stop() {
      stopped = true;
      window.clearInterval(timer);
      window.removeEventListener(INBOX_CHANGED_EVENT, refresh);
      window.removeEventListener("focus", refresh);
    },
  };
}

function senderOf(item) {
  if (item.session) return item.session.title;
  return item.message ? item.message.voiceName : item.direct?.authorName || "Someone";
}

function previewOf(item) {
  if (item.session) {
    const when = formatSessionRange(item.session.startAt, item.session.endAt, { kind: item.session.kind });
    return item.session.status === "cancelled" ? `Cancelled · ${when}` : when;
  }
  if (item.message) return item.message.deleted ? "Message deleted" : item.message.excerpt;
  return item.direct?.body || "";
}

// A session date is finished (and its notice deletable) once it has ended or been cancelled.
function sessionIsOver(session) {
  return session.status === "cancelled" || new Date(`${session.endAt}Z`).getTime() <= Date.now();
}

// The mail-client view itself, shared by the modal and the Account page's tab.
// `onLeave` runs when the user jumps out to the chat message an item refers to.
function buildInbox({ dataManager, status, compose = null, onLeave = () => {} }) {
  const currentUserId = dataManager.session?.user?.id ?? null;
  let items = [];
  let selectedId = null;
  let groups = null;
  let reactionEmoji = [];

  // Floating buttons, each at the bottom right of the pane it acts on.
  const newButton = createIconButton({
    icon: "tabler:mail-plus",
    label: "New private message",
    variant: "primary",
    tooltipPlacement: "left",
    className: "chat-fab",
    onClick: () => void showCompose(),
  });
  const markAll = createIconButton({
    icon: "tabler:checks",
    label: "Mark all read",
    variant: "secondary",
    tooltipPlacement: "right",
    className: "chat-fab",
    onClick: async () => {
      await dataManager.markInboxRead({ all: true }).catch(() => {});
      window.dispatchEvent(new CustomEvent(INBOX_CHANGED_EVENT));
      items.forEach((item) => {
        item.read = true;
      });
      renderList();
    },
  });
  const body = el("div", "d-flex p-0");
  // Each pane scrolls inside a relative wrapper so its floating button stays put.
  const listWrap = el("div", "border-end position-relative");
  listWrap.style.flex = "0 0 min(22rem, 40%)";
  const listPane = el("div", "overflow-auto h-100 chat-fab-clearance");
  listWrap.append(listPane, markAll);
  const detailWrap = el("div", "flex-grow-1 position-relative");
  detailWrap.style.minWidth = "0";
  const detailPane = el("div", "overflow-auto h-100 p-3 d-flex flex-column gap-3 chat-fab-clearance");
  detailWrap.append(detailPane, newButton);
  body.append(listWrap, detailWrap);

  function placeholder(text) {
    return el("div", "text-body-secondary small m-auto text-center", text);
  }
  // The Reply button floats beside "New private message" and only exists while
  // a direct message is open.
  let replyFab = null;
  let deleteFab = null;
  let reactionHost = null;
  function clearReplyFab() {
    replyFab?.remove();
    replyFab = null;
    deleteFab?.remove();
    deleteFab = null;
    reactionHost?.remove();
    reactionHost = null;
  }
  function setPane(...nodes) {
    clearReplyFab();
    detailPane.replaceChildren(...nodes);
  }
  const idlePane = () => setPane(placeholder("Select a message, or write a new one."));

  function renderList() {
    listPane.textContent = "";
    if (!items.length) {
      listPane.appendChild(el("p", "text-body-secondary small p-3 mb-0", "Nothing here yet."));
      return;
    }
    const list = el("div", "list-group list-group-flush");
    items.forEach((item) => {
      const row = el("button", `list-group-item list-group-item-action d-flex flex-column gap-1${item.id === selectedId ? " active" : ""}`);
      row.type = "button";
      const top = el("div", "d-flex justify-content-between align-items-baseline gap-2");
      top.appendChild(el("span", `text-truncate${item.read ? "" : " fw-bold"}`, `${item.read ? "" : "● "}${senderOf(item)}`));
      top.appendChild(el("small", "flex-shrink-0 opacity-75", formatTimestamp(item.createdAt)));
      const meta = el("small", "opacity-75 text-truncate", `${REASON_LABELS[item.reason] || item.reason} · ${item.groupName}`);
      const excerpt = el("small", "text-truncate opacity-75", previewOf(item));
      row.append(top, meta, excerpt);
      row.addEventListener("click", () => void select(item.id));
      list.appendChild(row);
    });
    listPane.appendChild(list);
  }

  async function load() {
    try {
      const result = await dataManager.getInbox();
      items = result.items;
      reactionEmoji = result.reactionEmoji || [];
    } catch (error) {
      listPane.textContent = "";
      listPane.appendChild(el("p", "text-danger small p-3 mb-0", error.message || "Unable to load the inbox."));
      return;
    }
    renderList();
  }

  async function select(id) {
    selectedId = id;
    const item = items.find((entry) => entry.id === id);
    if (!item) return;
    if (!item.read) {
      item.read = true;
      await dataManager.markInboxRead({ ids: [id] }).catch(() => {});
      window.dispatchEvent(new CustomEvent(INBOX_CHANGED_EVENT));
    }
    renderList();
    showItem(item);
  }

  // Delete floats beside New private message while an item is open. A session
  // notice's stays disabled (and says why) until the session has ended.
  function addDeleteFab(item) {
    const over = !item.session || sessionIsOver(item.session);
    deleteFab = createIconButton({
      icon: "tabler:trash",
      label: over ? "Delete" : "Can be deleted once the session has ended",
      variant: "danger",
      tooltipPlacement: "top",
      className: "chat-fab chat-fab--second",
      onClick: async () => {
        try {
          const result = await dataManager.deleteInboxItems([item.id]);
          if (result.skipped?.length) {
            status?.show("That notice can't be deleted until the session has ended.", { type: "info" });
            return;
          }
          items = items.filter((entry) => entry.id !== item.id);
          selectedId = null;
          window.dispatchEvent(new CustomEvent(INBOX_CHANGED_EVENT));
          renderList();
          idlePane();
        } catch (error) {
          status?.show(error.message || "Unable to delete that.", { type: "error" });
        }
      },
    });
    deleteFab.disabled = !over;
    detailWrap.appendChild(deleteFab);
  }

  // A session notice shows the session as it is now, read fresh each time.
  function showSession(item) {
    const pane = el("div", "d-flex flex-column gap-3");
    pane.appendChild(el("div", "text-body-secondary small", "Loading…"));
    setPane(pane);
    addDeleteFab(item);
    const render = async () => {
      let detail;
      try {
        detail = await dataManager.getSessionOccurrence(item.session.occurrenceId);
      } catch (error) {
        pane.textContent = "";
        pane.appendChild(el("p", "text-danger small mb-0", error.message || "Unable to load the session."));
        return;
      }
      if (selectedId !== item.id) return;
      pane.textContent = "";
      const head = el("div", "d-flex flex-column gap-1");
      const titleRow = el("div", "d-flex flex-wrap align-items-center gap-2");
      titleRow.appendChild(el("h3", "h5 mb-0", detail.title));
      const sessionHelp = el("span", "align-middle");
      sessionHelp.dataset.helpTopic = "campaign.sessions";
      sessionHelp.dataset.helpInsert = "replace";
      titleRow.appendChild(sessionHelp);
      void initHelpSystem({ root: titleRow });
      if (detail.status === "cancelled") titleRow.appendChild(el("span", "badge text-bg-danger", "Cancelled"));
      else if (detail.ended) titleRow.appendChild(el("span", "badge text-bg-secondary", "Ended"));
      head.appendChild(titleRow);
      head.appendChild(
        el("div", "text-body-secondary small", `${REASON_LABELS[item.reason] || ""} · ${item.groupName}`)
      );
      head.appendChild(el("div", null, `${formatSessionRange(detail.startAt, detail.endAt, { kind: detail.kind })}${detail.kind === "live" ? ` (${describeDuration(detail.durationMinutes)})` : ""}`));
      if (detail.locationText || detail.locationUrl) {
        const where = el("div", "small");
        where.append(document.createTextNode(detail.locationText ? `${detail.locationText} ` : ""));
        if (detail.locationUrl) {
          const link = el("a", null, detail.locationUrl);
          link.href = detail.locationUrl;
          link.target = "_blank";
          link.rel = "noopener";
          where.appendChild(link);
        }
        head.appendChild(where);
      }
      if (detail.minPlayers !== null || detail.maxPlayers !== null) {
        head.appendChild(el("div", "small text-body-secondary", `Players: ${detail.minPlayers ?? "any"} to ${detail.maxPlayers ?? "any"}`));
      }
      pane.appendChild(head);
      if (detail.description) {
        const description = el("div", "small", detail.description);
        description.style.whiteSpace = "pre-wrap";
        pane.appendChild(description);
      }

      // Accept / Tentative / Decline: styled like message reactions, with counts.
      const respond = async (response) => {
        try {
          await dataManager.rsvpSessionOccurrence(detail.id, response);
          window.dispatchEvent(new CustomEvent(INBOX_CHANGED_EVENT));
          await render();
        } catch (error) {
          status?.show(error.message || "Unable to respond.", { type: "error" });
        }
      };
      const chips = el("div", "d-flex flex-wrap align-items-center gap-2");
      // A full session offers a waitlist in place of Accept, to anyone not already holding a place.
      const onWaitlist = detail.viewer.response === "waitlist";
      const offerWaitlist = detail.full && detail.viewer.response !== "accept";
      const choices = [
        offerWaitlist || onWaitlist ? ["waitlist", onWaitlist ? "On waitlist" : "Join waitlist"] : ["accept", "Accept"],
        ["tentative", "Tentative"],
        ["decline", "Decline"],
      ];
      choices.forEach(([response, label]) => {
        const mine = detail.viewer.response === response;
        const chip = el("button", `btn btn-sm chat-reaction${mine ? " chat-reaction--mine" : ""}`);
        chip.type = "button";
        chip.textContent = `${label} ${detail.counts[response]}`;
        chip.disabled = !detail.viewer.canRespond || mine && response === "waitlist";
        chip.addEventListener("click", () => void respond(response));
        chips.appendChild(chip);
      });
      pane.appendChild(chips);
      if (onWaitlist) {
        pane.appendChild(
          el("div", "small text-body-secondary", `You're number ${detail.viewer.waitlistPosition} on the waitlist. If a place opens before the session you're accepted automatically and told here.`)
        );
      }
      if (detail.viewer.isGm) {
        pane.appendChild(el("div", "small text-body-secondary", "Respond for players from the Sessions list in Loom."));
      } else if (!detail.viewer.hasActiveCharacter) {
        pane.appendChild(el("div", "small text-warning", "Make a character active in this group to respond."));
      } else if (detail.rsvpClosed && !detail.ended) {
        pane.appendChild(el("div", "small text-body-secondary", "RSVPs for this session have closed."));
      }

      // Who has answered.
      const groups = el("div", "d-flex flex-column gap-1 small");
      [["accept", "Accepted"], ["waitlist", "Waitlist"], ["tentative", "Tentative"], ["decline", "Declined"], [null, "No response"]].forEach(([response, label]) => {
        const people = detail.attendees.filter((person) => (person.response || null) === response);
        if (response === "waitlist") people.sort((a, b) => String(a.respondedAt).localeCompare(String(b.respondedAt)));
        if (!people.length) return;
        const line = el("div");
        line.append(
          el("span", "fw-semibold", `${label}: `),
          document.createTextNode(people.map((person) => (person.characterName ? `${person.username} (${person.characterName})` : person.username)).join(", "))
        );
        groups.appendChild(line);
      });
      pane.appendChild(groups);

      // The player's own characters in this group; picking one makes it the one they play.
      if (!detail.viewer.isGm && detail.viewer.characters.length > 1) {
        const picker = el("select", "form-select form-select-sm w-auto");
        detail.viewer.characters.forEach((character) => {
          const option = el("option", null, character.name);
          option.value = character.id;
          picker.appendChild(option);
        });
        const current = detail.viewer.characters.find((character) => character.active);
        if (current) picker.value = current.id;
        picker.addEventListener("change", async () => {
          try {
            await dataManager.setGroupMemberActive({ groupId: detail.groupId, characterId: picker.value, active: true });
            await render();
          } catch (error) {
            status?.show(error.message || "Unable to switch characters.", { type: "error" });
          }
        });
        const wrap = el("div", "d-flex align-items-center gap-2 small");
        wrap.append(el("span", "text-body-secondary", "Playing as"), picker);
        pane.appendChild(wrap);
      }

      // Decline everything in a stretch of time (e.g. a holiday) in one action.
      // Offered only once this date has been declined, behind its own button
      // beside the answers, with the form opening right under them.
      if (!detail.viewer.isGm && detail.viewer.response === "decline") {
        const from = el("input", "form-control form-control-sm w-auto");
        from.type = "date";
        const to = el("input", "form-control form-control-sm w-auto");
        to.type = "date";
        const go = el("button", "btn btn-outline-secondary btn-sm", "Decline all in range");
        go.type = "button";
        go.addEventListener("click", async () => {
          const start = localDateToUtc(from.value);
          const end = localDateToUtc(to.value, { endOfDay: true });
          if (!start || !end) {
            status?.show("Choose both dates.", { type: "info" });
            return;
          }
          try {
            const result = await dataManager.declineSessionRange(detail.groupId, start, end);
            status?.show(`Declined ${result.declined} session${result.declined === 1 ? "" : "s"} (and any later ones in that range).`, { type: "success" });
            await render();
          } catch (error) {
            status?.show(error.message || "Unable to decline that range.", { type: "error" });
          }
        });
        const range = el("div", "d-flex flex-wrap align-items-center gap-2 small");
        range.append(el("span", "text-body-secondary", "From"), from, el("span", "text-body-secondary", "to"), to, go);
        setElementVisible(range, false, "flex");
        const openRange = el("button", "btn btn-sm btn-outline-secondary", "Decline a range…");
        openRange.type = "button";
        openRange.addEventListener("click", () => setElementVisible(range, range.style.display === "none", "flex"));
        chips.appendChild(openRange);
        chips.insertAdjacentElement("afterend", range);
      }
    };
    void render();
  }

  // Reactions on a mention, reply or direct message (never a session notice).
  // On a mention or reply they land on the chat message itself.
  function reactionArea(item) {
    // Pinned to the bottom left of the pane; the emoji picker opens above the chips.
    const wrap = el("div", "d-flex flex-column gap-1 chat-pane-reactions");
    let picker = null;
    const toggle = async (emoji) => {
      try {
        const result = await dataManager.toggleInboxReaction(item.id, emoji);
        item.reactions = result.reactions;
        picker = null;
        render();
      } catch (error) {
        status?.show(error.message || "Unable to react.", { type: "error" });
      }
    };
    function render() {
      wrap.textContent = "";
      if (item.message?.deleted) return;
      const row = el("div", "d-flex flex-wrap align-items-center gap-2");
      row.appendChild(renderReactionChips(item.reactions || [], { onToggle: toggle, justify: "start" }));
      row.appendChild(
        createIconButton({
          icon: "tabler:mood-smile",
          label: "Add reaction",
          variant: "link",
          className: "p-0 px-1 text-body-secondary",
          onClick: () => {
            if (picker) {
              picker.remove();
              picker = null;
              return;
            }
            picker = renderEmojiPicker(reactionEmoji, toggle);
            wrap.prepend(picker);
          },
        })
      );
      wrap.appendChild(row);
    }
    render();
    return wrap;
  }

  function showItem(item) {
    if (item.session) {
      showSession(item);
      return;
    }
    const pane = el("div", "d-flex flex-column gap-3");
    const head = el("div", "d-flex flex-column gap-1");
    head.appendChild(el("h3", "h5 mb-0", senderOf(item)));
    head.appendChild(
      el("div", "text-body-secondary small", `${REASON_LABELS[item.reason] || item.reason} · ${item.groupName} · ${formatDateTime(item.createdAt)}`)
    );
    if (item.message) {
      head.appendChild(el("div", "text-body-secondary small", `${item.message.channelName} › ${item.message.threadTitle}`));
    }
    const text = el("div", null, item.message ? (item.message.deleted ? "This message was deleted." : item.message.text) : item.direct.body);
    text.style.whiteSpace = "pre-wrap";
    text.style.overflowWrap = "anywhere";
    pane.append(head, text);
    if (item.message) {
      const open = el("button", "btn btn-primary btn-sm align-self-start", "Open in group chat");
      open.type = "button";
      open.addEventListener("click", () => {
        onLeave();
        openMessageSummary(dataManager, item.message);
      });
      pane.appendChild(open);
    }
    setPane(pane);
    addDeleteFab(item);
    reactionHost = reactionArea(item);
    detailWrap.appendChild(reactionHost);
    if (item.direct && item.direct.authorId != null) {
      replyFab = createIconButton({
        icon: "tabler:arrow-back-up",
        label: "Reply",
        variant: "secondary",
        tooltipPlacement: "top",
        className: "chat-fab chat-fab--third",
        onClick: () =>
          void showCompose({ groupId: item.groupId, selectedIds: [item.direct.authorId], title: `Reply to ${item.direct.authorName}` }),
      });
      detailWrap.appendChild(replyFab);
    }
  }

  async function ensureGroups() {
    if (!groups) {
      const result = await dataManager.listGroups({ includeMemberGroups: true }).catch(() => ({ groups: [] }));
      groups = Array.isArray(result?.groups) ? result.groups.filter((group) => (group.type || "campaign") === "campaign") : [];
    }
    return groups;
  }

  // The compose form, in the right pane. Recipients follow the chosen campaign.
  async function showCompose({ groupId = "", selectedIds = [], title: heading = "New private message" } = {}) {
    selectedId = null;
    renderList();
    const campaigns = await ensureGroups();
    if (!campaigns.length) {
      setPane(placeholder("You aren't in any campaigns yet."));
      return;
    }
    const pane = el("form", "d-flex flex-column gap-3");
    pane.appendChild(el("h3", "h5 mb-0", heading));

    const groupSelect = el("select", "form-select");
    campaigns.forEach((group) => {
      const option = el("option", null, group.name);
      option.value = group.id;
      groupSelect.appendChild(option);
    });
    const active = dataManager.getActiveGroup()?.groupId;
    groupSelect.value = [groupId, active].find((id) => id && campaigns.some((group) => group.id === id)) || campaigns[0].id;

    const recipientsHost = el("div", "d-flex flex-wrap gap-3");
    let checks = [];
    function renderRecipients(preselected) {
      const group = campaigns.find((entry) => entry.id === groupSelect.value);
      const people = listDirectMessageRecipients({
        roster: group?.members || [],
        ownerId: group?.owner_id ?? null,
        currentUserId,
      });
      recipientsHost.textContent = "";
      checks = people.map((person) => {
        const label = el("label", "form-check small");
        const box = el("input", "form-check-input");
        box.type = "checkbox";
        box.checked = preselected.includes(person.id);
        label.append(box, el("span", "form-check-label", person.name));
        recipientsHost.appendChild(label);
        return { id: person.id, box };
      });
      if (!people.length) recipientsHost.appendChild(el("span", "text-body-secondary small", "Nobody else is in this campaign."));
    }
    renderRecipients(selectedIds);
    groupSelect.addEventListener("change", () => renderRecipients([]));

    const text = el("textarea", "form-control");
    text.rows = 8;
    text.maxLength = 2000;
    text.setAttribute("aria-label", "Message");
    const send = el("button", "btn btn-primary btn-sm", "Send");
    send.type = "submit";
    const cancel = el("button", "btn btn-outline-secondary btn-sm", "Cancel");
    cancel.type = "button";
    cancel.addEventListener("click", idlePane);
    const buttons = el("div", "d-flex gap-2");
    buttons.append(send, cancel);

    const field = (label, control) => {
      const wrap = el("div");
      wrap.append(el("label", "form-label small mb-1", label), control);
      return wrap;
    };
    pane.append(field("Campaign", groupSelect), field("To", recipientsHost), field("Message", text), buttons);
    pane.addEventListener("submit", async (event) => {
      event.preventDefault();
      const recipientIds = checks.filter((entry) => entry.box.checked).map((entry) => entry.id);
      if (!recipientIds.length || !text.value.trim()) {
        status?.show("Choose at least one recipient and write a message.", { type: "info" });
        return;
      }
      send.disabled = true;
      try {
        await dataManager.sendDirectMessage({ groupId: groupSelect.value, recipientIds, body: text.value.trim() });
        status?.show("Message sent.", { type: "success" });
        setPane(placeholder("Message sent."));
      } catch (error) {
        status?.show(error.message || "Unable to send the message.", { type: "error" });
        send.disabled = false;
      }
    });
    setPane(pane);
    text.focus();
  }

  return {
    body,
    start() {
      idlePane();
      void load();
      if (compose) void showCompose(compose);
    },
  };
}

// `compose`, when given, opens straight into a new message:
// { groupId, selectedIds, title } — e.g. "Message privately" on a chat message.
export function openInbox({ dataManager, status, compose = null } = {}) {
  if (!window.bootstrap?.Modal) return;
  const overlay = el("div", "modal fade");
  overlay.tabIndex = -1;
  overlay.setAttribute("aria-labelledby", "undercroft-inbox-title");
  overlay.setAttribute("aria-hidden", "true");
  const dialog = el("div", "modal-dialog modal-dialog-centered modal-xl");
  const content = el("div", "modal-content");
  const header = el("div", "modal-header");
  const title = el("h2", "modal-title fs-5", "Inbox");
  title.id = "undercroft-inbox-title";
  const titleHelp = el("span", "align-middle ms-2");
  titleHelp.dataset.helpTopic = "campaign.inbox";
  titleHelp.dataset.helpInsert = "replace";
  title.appendChild(titleHelp);
  const close = el("button", "btn-close ms-auto");
  close.type = "button";
  close.setAttribute("data-bs-dismiss", "modal");
  close.setAttribute("aria-label", "Close");
  header.append(title, close);
  void initHelpSystem({ root: header });
  document.body.appendChild(overlay);
  const instance = window.bootstrap.Modal.getOrCreateInstance(overlay);
  const view = buildInbox({ dataManager, status, compose, onLeave: () => instance.hide() });
  // A fixed height keeps the dialog from collapsing when there is little to show.
  view.body.classList.add("modal-body");
  view.body.style.height = "min(70vh, 40rem)";
  view.body.style.minHeight = "28rem";
  content.append(header, view.body);
  dialog.appendChild(content);
  overlay.appendChild(dialog);
  overlay.addEventListener("hidden.bs.modal", () => overlay.remove());
  instance.show();
  view.start();
}

// The same Inbox laid into a page, for the Account page's Inbox tab.
export function mountInbox(container, { dataManager, status } = {}) {
  const view = buildInbox({ dataManager, status });
  view.body.classList.add("border", "rounded");
  view.body.style.height = "min(70vh, 40rem)";
  view.body.style.minHeight = "28rem";
  container.replaceChildren(view.body);
  view.start();
}
