// Jumping to a chat message from outside the chat widget (the Inbox, a
// backlink, a Repository [[msg:ID]] link). `info` is a server message summary
// (chat.py's _message_summary).
import { buildKindToolUrl } from "../kind-tool-route.js";
import { resolveToolContextPath, resolveToolHref } from "../app-shell.js";
import { formatThreadLabel } from "./target.js";

export function openMessageSummary(dataManager, info) {
  if (info.archived && info.archivePageId) {
    const url = buildKindToolUrl("journal", info.archivePageId, { extraParams: { block: `m${info.id}` } });
    if (url) window.open(url, "_blank", "noopener");
    return;
  }
  dataManager.setActiveGroup(info.groupId, info.groupName);
  dataManager.setActiveThread(info.groupId, info.threadId, formatThreadLabel(info.channelName, info.threadTitle));
  window.dispatchEvent(
    new CustomEvent("undercroft:chat-open-message", {
      detail: { groupId: info.groupId, threadId: info.threadId, messageId: info.id },
    })
  );
  // Tools without a chat widget have nothing to scroll; the Dashboard does.
  if (!document.querySelector(".chat-scroll")) {
    window.location.href = resolveToolHref("home", resolveToolContextPath());
  }
}
