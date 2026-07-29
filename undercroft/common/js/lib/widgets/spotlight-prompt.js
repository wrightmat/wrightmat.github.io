// A GM's "show to table" is a decision for the viewer, not a passive log
// line — this renders a small, non-auto-dismissing prompt (status.js's
// status.show() has no action-button concept and times out on its own,
// which is wrong for something that needs a real Accept/Dismiss choice).
// Pinned bottom-right (status.js's own toasts sit bottom-center, see
// .status-root in shell.css) so the two never overlap. Only one shows at a
// time — the Dashboard runs exactly one spotlight watcher (spotlight-inbox.js),
// so there's only ever one thing to decide on.
import { el } from "../dom.js";

let activeToast = null;

export function dismissSpotlightPrompt() {
  if (activeToast) {
    activeToast.remove();
    activeToast = null;
  }
}

export function showSpotlightPrompt({ label, onAccept, onDismiss } = {}) {
  dismissSpotlightPrompt();
  const toast = el("div", "spotlight-prompt-toast shadow-theme border rounded-3 bg-body p-3 d-flex flex-column gap-2");
  toast.appendChild(el("div", "small", label || "Something new is being shown to the table."));
  const actions = el("div", "d-flex gap-2 justify-content-end");
  const dismissButton = el("button", "btn btn-outline-secondary btn-sm", "Dismiss");
  dismissButton.type = "button";
  const acceptButton = el("button", "btn btn-primary btn-sm", "Accept");
  acceptButton.type = "button";
  actions.append(dismissButton, acceptButton);
  toast.appendChild(actions);
  document.body.appendChild(toast);
  activeToast = toast;

  function cleanup() {
    toast.remove();
    if (activeToast === toast) activeToast = null;
  }
  acceptButton.addEventListener("click", () => {
    cleanup();
    onAccept?.();
  });
  dismissButton.addEventListener("click", () => {
    cleanup();
    onDismiss?.();
  });

  return { dismiss: cleanup };
}
