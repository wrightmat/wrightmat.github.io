// After a session has ended: who attended, who was marked a no-show, and the
// actions on that. The GM (or an admin) marks or clears a no-show; the player
// can contest their own, and a contested no-show stops counting.
import { el } from "../dom.js";

const OUTCOME_LABELS = { attended: "Attended", no_show: "No-show", contested: "Contested" };
const OUTCOME_CLASSES = { attended: "text-bg-success", no_show: "text-bg-danger", contested: "text-bg-warning" };

// `detail` is the server's occurrence view (sessions.get_occurrence). Returns null
// when there's nothing to show. `onChange` runs after a successful change.
export function renderAttendance(detail, { dataManager, status, onChange } = {}) {
  if (!detail.ended || detail.status === "cancelled") return null;
  const recorded = detail.attendees.filter((person) => person.attendance);
  if (!recorded.length) return null;
  const myId = dataManager.session?.user?.id;
  const isGm = detail.viewer.isGm;
  const rows = recorded.filter((person) => isGm || person.userId === myId);
  if (!rows.length) return null;

  const act = async (work, failure) => {
    try {
      await work();
      onChange?.();
    } catch (error) {
      status?.show(error.message || failure, { type: "error" });
    }
  };

  const wrap = el("div", "d-flex flex-column gap-2");
  wrap.appendChild(el("div", "text-uppercase fs-6 fw-semibold text-body-secondary", "Attendance"));
  rows.forEach((person) => {
    const row = el("div", "d-flex flex-wrap align-items-center gap-2 small");
    row.appendChild(el("span", "fw-semibold", person.characterName ? `${person.username} (${person.characterName})` : person.username));
    row.appendChild(el("span", `badge ${OUTCOME_CLASSES[person.attendance]}`, OUTCOME_LABELS[person.attendance]));
    if (person.attendance === "no_show" && person.attendanceAuto) {
      row.appendChild(el("span", "text-body-secondary", "recorded automatically (no posts in the linked thread)"));
    }
    if (isGm) {
      const button = el("button", "btn btn-outline-secondary btn-sm", person.attendance === "attended" ? "Mark no-show" : "Clear");
      button.type = "button";
      button.addEventListener("click", () =>
        act(
          () => dataManager.setSessionNoShow(detail.id, person.userId, person.attendance === "attended"),
          "Unable to update attendance.",
        ),
      );
      row.appendChild(button);
    } else if (person.attendance === "no_show") {
      row.appendChild(el("span", "text-body-secondary", "If this is wrong, you can dispute it."));
      const button = el("button", "btn btn-outline-secondary btn-sm", "Dispute");
      button.type = "button";
      button.addEventListener("click", () => act(() => dataManager.disputeSessionNoShow(detail.id), "Unable to dispute that."));
      row.appendChild(button);
    } else if (person.attendance === "contested") {
      row.appendChild(el("span", "text-body-secondary", "You disputed this; it no longer counts."));
    }
    wrap.appendChild(row);
  });
  return wrap;
}
