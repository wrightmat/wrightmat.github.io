// The reaction chips and emoji picker shared by chat messages and Inbox items.
import { el } from "../dom.js";

// `reactions` is [{emoji, count, users, mine}]. A chip you added gets a firmer outline.
export function renderReactionChips(reactions, { canReact = true, onToggle, justify = "end", descriptions = {} } = {}) {
  const bar = el("div", `d-flex flex-wrap align-items-center justify-content-${justify} gap-1`);
  reactions.forEach((reaction) => {
    const chip = el("button", `btn btn-sm py-0 px-1 chat-reaction${reaction.mine ? " chat-reaction--mine" : ""}`);
    chip.type = "button";
    chip.textContent = `${reaction.emoji} ${reaction.count}`;
    chip.setAttribute("data-bs-toggle", "tooltip");
    chip.setAttribute("data-bs-title", [descriptions[reaction.emoji], reaction.users.filter(Boolean).join(", ")].filter(Boolean).join(" — "));
    chip.disabled = !canReact;
    chip.addEventListener("click", () => onToggle?.(reaction.emoji));
    bar.appendChild(chip);
  });
  return bar;
}

// `descriptions` maps each emoji to the tooltip shown on hover.
export function renderEmojiPicker(emoji, onPick, descriptions = {}) {
  const picker = el("div", "d-flex flex-wrap gap-1 mt-1");
  emoji.forEach((entry) => {
    const button = el("button", "btn btn-sm btn-outline-secondary py-0 px-1", entry);
    button.type = "button";
    if (descriptions[entry]) {
      button.setAttribute("data-bs-toggle", "tooltip");
      button.setAttribute("data-bs-title", descriptions[entry]);
      button.setAttribute("aria-label", descriptions[entry]);
    }
    button.addEventListener("click", () => onPick?.(entry));
    picker.appendChild(button);
  });
  return picker;
}
