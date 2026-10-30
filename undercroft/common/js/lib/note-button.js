import { setDisabledTooltip } from "./tooltips.js";

export const NOTE_USED_EVENT = "undercroft:note-used";

// Keeps an AI-note button disabled, with the reason as its tooltip, while nobody is signed in or the
// signed-in user has used up their hourly notes. Tools fire NOTE_USED_EVENT after each attempt.
export function bindNoteButton(button, dataManager) {
  if (!button) return;
  let timer = null;
  let generation = 0;

  async function apply() {
    window.clearTimeout(timer);
    const mine = ++generation;
    if (!dataManager.isAuthenticated()) {
      setDisabledTooltip(button, "Generating a note requires being logged in.");
      return;
    }
    let quota = null;
    try {
      quota = await dataManager.getNoteQuota();
    } catch (error) {
      // An unreadable quota leaves the button usable; the server still enforces the limit.
    }
    if (mine !== generation) return;
    if (quota && quota.remaining <= 0) {
      const minutes = Math.max(1, Math.ceil(quota.resetsInSeconds / 60));
      setDisabledTooltip(button, `You've used all ${quota.limit} notes for this hour. Available again in about ${minutes} minute${minutes === 1 ? "" : "s"}.`);
      timer = window.setTimeout(apply, quota.resetsInSeconds * 1000);
      return;
    }
    setDisabledTooltip(button, "");
  }

  void apply();
  window.addEventListener("undercroft:auth-changed", apply);
  window.addEventListener(NOTE_USED_EVENT, apply);
}
