// An application in the Inbox: the private conversation between an applicant
// and the GM, with Accept / Decline (GM), Withdraw (applicant), and, once
// accepted, the step that gets the new player a character in the group.
import { el } from "../dom.js";
import { formatDateTime } from "./format.js";
import { initHelpSystem } from "../help.js";
import { helpBadge } from "../community/help-badge.js";

const STATUS_BADGES = {
  pending: ["Pending", "text-bg-primary"],
  accepted: ["Accepted", "text-bg-success"],
  declined: ["Declined", "text-bg-danger"],
  expired: ["Expired", "text-bg-secondary"],
  withdrawn: ["Withdrawn", "text-bg-secondary"],
};

// The other person's name from the viewer's side of the conversation.
export function applicationCounterpart(application, viewerId) {
  return viewerId === application.applicantId ? application.gmName : application.applicantName;
}

async function renderClaimPanel(container, application, { dataManager, status, onChanged }) {
  container.replaceChildren(el("div", "text-body-secondary small", "Loading…"));
  let group = null;
  let own = [];
  try {
    const groups = await dataManager.listGroups({ refresh: true, includeMemberGroups: true });
    group = (groups.groups || []).find((entry) => entry.id === application.groupId) || null;
    const listing = await dataManager.list("character", { refresh: true });
    own = dataManager.collectListEntries(listing.remote, ["owned", "items"]);
  } catch (error) {
    container.replaceChildren(el("div", "text-danger small", error.message || "Unable to load the group."));
    return;
  }
  if (!group) {
    container.replaceChildren(el("div", "text-body-secondary small", "The group is no longer available."));
    return;
  }
  const roster = group.members.filter((member) => member.content_type === "character");
  const rostered = new Set(roster.map((member) => member.content_id));
  const mine = roster.filter((member) => member.is_claimed && member.owner_id === dataManager.session?.user?.id);
  const unclaimed = roster.filter((member) => !member.is_claimed);
  const wrap = el("div", "d-flex flex-column gap-2");
  wrap.appendChild(el("div", "text-uppercase fs-6 fw-semibold text-body-secondary", `Join ${application.groupName}`));
  wrap.appendChild(
    el("p", "small mb-0", mine.length
      ? `You're playing ${mine.map((member) => member.label || member.content_id).join(", ")} in this group.`
      : "You're in. To receive session invitations, claim a character from the GM's slate or add one of your own."),
  );
  const run = async (work, success) => {
    try {
      await work();
      status?.show(success, { type: "success", timeout: 2500 });
      await renderClaimPanel(container, application, { dataManager, status, onChanged });
    } catch (error) {
      status?.show(error.message || "That didn't work.", { type: "error" });
    }
  };
  if (unclaimed.length) {
    const list = el("div", "d-flex flex-column gap-1");
    unclaimed.forEach((member) => {
      const row = el("div", "d-flex align-items-center justify-content-between gap-2 small");
      row.appendChild(el("span", "", member.label || member.content_id));
      const button = el("button", "btn btn-outline-primary btn-sm", "Claim");
      button.type = "button";
      button.addEventListener("click", () =>
        run(() => dataManager.claimRosterCharacter(application.groupId, member.content_id), `Claimed ${member.label || "character"}.`),
      );
      row.appendChild(button);
      list.appendChild(row);
    });
    wrap.append(el("div", "small fw-semibold", "From the GM's slate"), list);
  }
  const addable = own.filter((entry) => !rostered.has(entry.id));
  if (addable.length) {
    const select = el("select", "form-select form-select-sm w-auto");
    select.appendChild(new Option("Add one of my characters…", ""));
    addable.forEach((entry) => select.appendChild(new Option(entry.title || entry.name || entry.id, entry.id)));
    select.addEventListener("change", () => {
      if (select.value) {
        const name = select.selectedOptions[0].textContent;
        void run(() => dataManager.addOwnRosterCharacter(application.groupId, select.value), `Added ${name}.`);
      }
    });
    wrap.appendChild(select);
  }
  const create = el("a", "small", "Create a new character in Workbench ↗");
  create.href = new URL("../../../../workbench/index.html", import.meta.url).toString();
  create.target = "_blank";
  create.rel = "noopener";
  wrap.appendChild(create);
  container.replaceChildren(wrap);
}

// Returns the pane's root node. `onChanged(application)` is called after any action
// so the Inbox can refresh its list and unread count.
export function renderApplicationPane(initial, { dataManager, status, onChanged } = {}) {
  const root = el("div", "d-flex flex-column gap-3");
  const viewerId = dataManager.session?.user?.id;
  let application = initial;

  function draw() {
    root.replaceChildren();
    const [statusText, statusClass] = STATUS_BADGES[application.status] || [application.status, "text-bg-secondary"];
    const head = el("div", "d-flex flex-column gap-1");
    const title = el("div", "d-flex flex-wrap align-items-center gap-2");
    title.append(
      el("h3", "h5 mb-0", `Application · ${applicationCounterpart(application, viewerId)}`),
      el("span", `badge ${statusClass}`, statusText),
      helpBadge("community.applications"),
    );
    head.appendChild(title);
    head.appendChild(el("div", "text-body-secondary small", `${application.groupName} · ${formatDateTime(application.createdAt)}`));
    if (application.status === "pending") {
      head.appendChild(el("div", "text-body-secondary small", `Declined automatically if unanswered by ${formatDateTime(application.expiresAt)}.`));
    }
    root.appendChild(head);

    const thread = el("div", "d-flex flex-column gap-2");
    application.messages.forEach((message) => {
      const mine = message.authorId === viewerId;
      const bubble = el("div", `border rounded p-2 small ${mine ? "align-self-end bg-body-secondary" : "align-self-start"}`);
      bubble.style.maxWidth = "90%";
      bubble.appendChild(el("div", "text-body-secondary", `${message.authorName} · ${formatDateTime(message.createdAt)}`));
      const text = el("div", "", message.body);
      text.style.whiteSpace = "pre-wrap";
      text.style.overflowWrap = "anywhere";
      bubble.appendChild(text);
      thread.appendChild(bubble);
    });
    root.appendChild(thread);

    const act = async (work) => {
      try {
        application = await work();
        onChanged?.(application);
        draw();
      } catch (error) {
        status?.show(error.message || "That didn't work.", { type: "error" });
      }
    };
    if (application.canReply) {
      const reply = el("textarea", "form-control form-control-sm");
      reply.rows = 3;
      reply.placeholder = "Write a reply";
      const send = el("button", "btn btn-primary btn-sm", "Send");
      send.type = "button";
      send.addEventListener("click", () => {
        const body = reply.value.trim();
        if (body) void act(() => dataManager.replyToApplication(application.id, body));
      });
      const actions = el("div", "d-flex flex-wrap gap-2");
      actions.appendChild(send);
      if (application.canDecide) {
        const accept = el("button", "btn btn-success btn-sm", "Accept");
        accept.type = "button";
        accept.addEventListener("click", () => void act(() => dataManager.answerApplication(application.id, "accept")));
        const decline = el("button", "btn btn-outline-danger btn-sm", "Decline");
        decline.type = "button";
        decline.addEventListener("click", () => void act(() => dataManager.answerApplication(application.id, "decline")));
        actions.append(accept, decline);
      }
      if (application.canWithdraw) {
        const withdraw = el("button", "btn btn-outline-secondary btn-sm", "Withdraw");
        withdraw.type = "button";
        withdraw.addEventListener("click", () => void act(() => dataManager.answerApplication(application.id, "withdraw")));
        actions.appendChild(withdraw);
      }
      root.append(reply, actions);
    }
    if (application.canClaim) {
      const claim = el("div", "border-top pt-3");
      root.appendChild(claim);
      void renderClaimPanel(claim, application, { dataManager, status, onChanged });
    }
  }
  draw();
  void initHelpSystem({ root });
  return root;
}
