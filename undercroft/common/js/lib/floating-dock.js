// Lets a floating control panel be dragged anywhere inside its container (mouse or touch) from any part of it that
// isn't a control, and pulls it back inside when the container shrinks. The panel starts wherever its CSS puts it.
export function initFloatingDock(panel, container) {
  if (!panel || !container) {
    return { destroy() {} };
  }

  const clampTo = (left, top) => {
    const containerRect = container.getBoundingClientRect();
    const panelRect = panel.getBoundingClientRect();
    return {
      left: Math.min(Math.max(left, 0), Math.max(containerRect.width - panelRect.width, 0)),
      top: Math.min(Math.max(top, 0), Math.max(containerRect.height - panelRect.height, 0)),
    };
  };

  const place = (left, top) => {
    const next = clampTo(left, top);
    panel.style.left = `${next.left}px`;
    panel.style.top = `${next.top}px`;
    panel.style.right = "auto";
  };

  const keepInside = () => {
    if (!panel.style.left) return;
    const containerRect = container.getBoundingClientRect();
    const panelRect = panel.getBoundingClientRect();
    place(panelRect.left - containerRect.left, panelRect.top - containerRect.top);
  };

  let startX = 0;
  let startY = 0;
  let originLeft = 0;
  let originTop = 0;
  let dragging = false;

  const onMove = (event) => {
    if (dragging) place(originLeft + event.clientX - startX, originTop + event.clientY - startY);
  };

  const onEnd = () => {
    if (!dragging) return;
    dragging = false;
    panel.classList.remove("is-dragging");
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", onEnd);
  };

  // preventDefault would stop a native <select> from opening, so real controls are left alone.
  const onDown = (event) => {
    if (event.target.closest("button, select, input, textarea, a, [data-dock-no-drag]")) return;
    event.preventDefault();
    const panelRect = panel.getBoundingClientRect();
    const containerRect = container.getBoundingClientRect();
    dragging = true;
    startX = event.clientX;
    startY = event.clientY;
    originLeft = panelRect.left - containerRect.left;
    originTop = panelRect.top - containerRect.top;
    panel.classList.add("is-dragging");
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onEnd);
  };

  panel.addEventListener("pointerdown", onDown);
  window.addEventListener("resize", keepInside);

  return {
    destroy() {
      onEnd();
      panel.removeEventListener("pointerdown", onDown);
      window.removeEventListener("resize", keepInside);
    },
  };
}
