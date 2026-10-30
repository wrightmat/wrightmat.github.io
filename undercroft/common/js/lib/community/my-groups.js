// The groups the signed-in user plays in, with Leave group. Leaving while one of
// the group's campaigns is running counts toward retention, so it asks first.
import { el } from "../dom.js";
import { showConfirmModal } from "../confirm-modal.js";

export async function renderMyGroups(container, { dataManager, status } = {}) {
  container.replaceChildren(el("div", "text-body-secondary small", "Loading…"));
  const myId = dataManager.session?.user?.id;
  let groups;
  try {
    groups = (await dataManager.listGroups({ refresh: true, includeMemberGroups: true })).groups || [];
  } catch (error) {
    container.replaceChildren(el("div", "text-danger small", error.message || "Unable to load your groups."));
    return;
  }
  const playing = groups.filter((group) => (group.players || []).some((player) => player.user_id === myId));
  const wrap = el("div", "d-flex flex-column gap-2");
  wrap.appendChild(el("div", "text-uppercase fs-6 fw-semibold text-body-secondary", "Groups I play in"));
  if (!playing.length) wrap.appendChild(el("p", "small text-body-secondary mb-0", "You aren't a player in any group."));
  playing.forEach((group) => {
    const row = el("div", "d-flex align-items-center justify-content-between gap-2 small");
    row.appendChild(el("span", "fw-semibold", group.name));
    const running = (group.campaigns || []).some((campaign) => campaign.status !== "completed");
    const leave = el("button", "btn btn-outline-danger btn-sm", "Leave group");
    leave.type = "button";
    leave.addEventListener("click", async () => {
      const confirmed = await showConfirmModal({
        title: `Leave ${group.name}?`,
        bodyHtml: running
          ? '<p class="mb-0">A campaign here is still running, so leaving counts as a departure in your retention and the GM\'s. Your characters come off the roster.</p>'
          : '<p class="mb-0">Your characters come off the roster.</p>',
        confirmLabel: "Leave group",
        confirmVariant: "danger",
      });
      if (!confirmed) return;
      try {
        await dataManager.leaveGroup(group.id);
        status?.show(`You left ${group.name}.`, { type: "success", timeout: 2000 });
        await renderMyGroups(container, { dataManager, status });
      } catch (error) {
        status?.show(error.message || "Unable to leave the group.", { type: "error" });
      }
    });
    row.appendChild(leave);
    wrap.appendChild(row);
  });
  container.replaceChildren(wrap);
}
