// One chat message row: voice and body, the quoted reply preview, reactions,
// and the per-message actions the viewer is allowed.
import { el } from "../dom.js";
import { createIconButton } from "../ui-components.js";
import { formatDateTime, formatTimestamp } from "./format.js";
import { renderChatBody } from "./refs.js";
import { renderEmojiPicker as buildEmojiPicker, renderReactionChips } from "./reactions.js";

const VOICE_ICONS = { user: "tabler:user", character: "tabler:mask", npc: "tabler:mask", monster: "tabler:ghost" };
const SYSTEM_ICONS = {
  roll: "tabler:dice-5",
  card: "tabler:cards",
  shop: "tabler:building-store",
  loot: "tabler:backpack",
};
// What each leading icon stands for, shown as its tooltip.
const VOICE_LABELS = { user: "Posted by a person", character: "Speaking as a character", npc: "Speaking as an NPC", monster: "Speaking as a monster" };
const SYSTEM_LABELS = { roll: "Dice roll", card: "Deck widget", shop: "Shop widget", loot: "Map marker loot" };

function iconSpan(icon, className = "") {
  const span = el("span", `iconify ${className}`.trim());
  span.dataset.icon = icon;
  span.setAttribute("aria-hidden", "true");
  return span;
}

function actionButton(icon, label, onClick) {
  return createIconButton({ icon, label, variant: "link", className: "p-0 px-1 text-body-secondary", onClick });
}

function renderReply(message, ctx) {
  const quote = el("button", "btn btn-link text-start p-0 border-start ps-2 small text-body-secondary chat-reply-quote d-block text-decoration-none");
  quote.type = "button";
  const { reply } = message;
  quote.append(
    iconSpan("tabler:arrow-back-up", "me-1"),
    el("span", "fw-semibold", reply.voiceName),
    document.createTextNode(reply.deleted ? ": message deleted" : `: ${reply.excerpt}`)
  );
  quote.addEventListener("click", () => ctx.onOpenMessage?.(reply.id));
  return quote;
}

function renderReactions(message, ctx) {
  return renderReactionChips(message.reactions, { canReact: ctx.canReact, descriptions: ctx.reactionDescriptions, onToggle: (emoji) => ctx.onReact?.(message, emoji) });
}

function renderEmojiPicker(message, ctx) {
  return buildEmojiPicker(ctx.reactionEmoji, (emoji) => ctx.onReact?.(message, emoji), ctx.reactionDescriptions);
}

function renderEditor(message, ctx, bodyHost, restore) {
  bodyHost.textContent = "";
  const area = el("textarea", "form-control form-control-sm");
  area.rows = 2;
  area.value = message.body;
  const save = el("button", "btn btn-primary btn-sm", "Save");
  save.type = "button";
  const cancel = el("button", "btn btn-outline-secondary btn-sm", "Cancel");
  cancel.type = "button";
  cancel.addEventListener("click", restore);
  save.addEventListener("click", async () => {
    const text = area.value.trim();
    if (!text) return;
    save.disabled = true;
    try {
      await ctx.onEditSubmit?.(message, text);
    } catch (error) {
      save.disabled = false;
    }
  });
  const buttons = el("div", "d-flex gap-1 mt-1");
  buttons.append(save, cancel);
  bodyHost.append(area, buttons);
  area.focus();
}

export function renderMessage(message, ctx) {
  const mine = ctx.viewer.userId != null && message.author.id === ctx.viewer.userId;
  const row = el("div", "d-flex align-items-start gap-2 small border-bottom pb-1 mb-1 chat-message");
  row.dataset.messageId = String(message.id);

  const system = message.payload?.kind;
  const voice = message.voice || { type: "user", name: message.author.name };
  const iconWrap = el("span", "chat-message-icon flex-shrink-0 text-body-secondary");
  iconWrap.appendChild(
    iconSpan(system ? SYSTEM_ICONS[system] || "tabler:sparkles" : VOICE_ICONS[voice.type] || "tabler:user")
  );
  const iconLabel = system ? SYSTEM_LABELS[system] || "System message" : VOICE_LABELS[voice.type] || VOICE_LABELS.user;
  iconWrap.setAttribute("role", "img");
  iconWrap.setAttribute("aria-label", iconLabel);
  iconWrap.setAttribute("data-bs-toggle", "tooltip");
  iconWrap.setAttribute("data-bs-title", iconLabel);
  row.appendChild(iconWrap);

  const column = el("div", "flex-grow-1 chat-message-body");
  const header = el("div", "d-flex flex-wrap align-items-baseline gap-2");
  header.appendChild(el("span", "fw-semibold", voice.name || message.author.name || "Someone"));
  if (voice.type !== "user" && message.author.name && voice.name !== message.author.name) {
    header.appendChild(el("span", "text-body-secondary", `(${message.author.name})`));
  }
  const time = el("span", "text-body-secondary", formatTimestamp(message.createdAt));
  time.title = formatDateTime(message.createdAt);
  header.appendChild(time);
  if (message.editedAt && !message.deleted) header.appendChild(el("span", "text-body-secondary fst-italic", "edited"));
  column.appendChild(header);

  const bodyHost = el("div", "chat-message-text");
  const showBody = () => {
    bodyHost.textContent = "";
    if (message.deleted) {
      bodyHost.appendChild(el("em", "text-body-secondary", "Message deleted"));
      return;
    }
    if (message.reply) column.insertBefore(renderReply(message, ctx), bodyHost);
    if (system) {
      bodyHost.textContent = message.payload.summary || "";
      return;
    }
    renderChatBody(bodyHost, message.body, {
      refs: message.refs,
      dataManager: ctx.dataManager,
      resolveJournal: ctx.resolveJournal,
      onOpenMessage: ctx.onOpenMessage,
      stripReply: Boolean(message.reply),
    });
  };
  column.appendChild(bodyHost);
  showBody();
  // Reactions and the action buttons share one row on the right of the message.
  const side = el("div", "d-flex flex-wrap align-items-center justify-content-end gap-2 flex-shrink-0 chat-message-side");
  if (!message.deleted && message.reactions.length) side.appendChild(renderReactions(message, ctx));

  if (!message.deleted && !ctx.archived) {
    const actions = el("div", "d-flex align-items-center gap-1 chat-message-actions");
    let picker = null;
    if (ctx.canReact) {
      actions.appendChild(
        actionButton("tabler:mood-smile", "Add reaction", () => {
          if (picker) {
            picker.remove();
            picker = null;
            return;
          }
          picker = renderEmojiPicker(message, ctx);
          column.appendChild(picker);
        })
      );
    }
    if (ctx.canPost) actions.appendChild(actionButton("tabler:arrow-back-up", "Reply", () => ctx.onReply?.(message)));
    if (ctx.canPost && message.author.id != null && !mine) {
      actions.appendChild(actionButton("tabler:mail", "Message privately", () => ctx.onDirectMessage?.(message)));
    }
    const canChange = mine || ctx.viewer.isGm;
    if (canChange && !system) {
      actions.appendChild(
        actionButton("tabler:pencil", "Edit", () => {
          row.querySelector(".chat-reply-quote")?.remove();
          renderEditor(message, ctx, bodyHost, showBody);
        })
      );
    }
    if (canChange) actions.appendChild(actionButton("tabler:trash", "Delete", () => ctx.onDelete?.(message)));
    side.appendChild(actions);
  }
  row.append(column, side);
  return row;
}
