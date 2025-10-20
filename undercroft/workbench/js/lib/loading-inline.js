(() => {
  const doc = document;
  if (!doc) {
    return;
  }
  const existing = doc.querySelector("[data-page-loading-overlay]");
  if (existing instanceof HTMLElement) {
    existing.classList.add("is-visible");
    existing.dataset.pageLoadingInitial = "true";
    const message = existing.querySelector("[data-page-loading-message]");
    if (!message) {
      const body = existing.querySelector(".workbench-loading-dialog .card-body");
      const messageNode = doc.createElement("p");
      messageNode.className = "mb-0 text-body-secondary small text-center";
      messageNode.dataset.pageLoadingMessage = "";
      messageNode.textContent = "Loading…";
      if (body) {
        body.appendChild(messageNode);
      } else {
        existing.appendChild(messageNode);
      }
    }
    return;
  }
  const overlay = doc.createElement("div");
  overlay.className = "workbench-loading-overlay is-visible";
  overlay.dataset.pageLoadingOverlay = "";
  overlay.dataset.pageLoadingInitial = "true";

  const dialog = doc.createElement("div");
  dialog.className = "workbench-loading-dialog card border-0 shadow-lg bg-body";

  const body = doc.createElement("div");
  body.className = "card-body d-flex flex-column align-items-center gap-3";

  const spinner = doc.createElement("div");
  spinner.className = "spinner-border text-primary";
  spinner.setAttribute("role", "status");
  const spinnerLabel = doc.createElement("span");
  spinnerLabel.className = "visually-hidden";
  spinnerLabel.textContent = "Loading…";
  spinner.appendChild(spinnerLabel);
  body.appendChild(spinner);

  const message = doc.createElement("p");
  message.className = "mb-0 text-body-secondary small text-center";
  message.dataset.pageLoadingMessage = "";
  message.textContent = "Loading…";
  body.appendChild(message);

  dialog.appendChild(body);
  overlay.appendChild(dialog);

  const target = doc.body || doc.documentElement;
  if (!target) {
    return;
  }
  if (target.firstChild) {
    target.insertBefore(overlay, target.firstChild);
  } else {
    target.appendChild(overlay);
  }
})();
