// Loom's Users tab, Invites card (admins): shareable sign-up links that start an account at a chosen tier and
// record where each account came from. The server owns every rule (server/invites.py); this is the editor.
import { el, setElementVisible } from "../../common/js/lib/dom.js";
import { createCollapsibleSection, createIconButton } from "../../common/js/lib/ui-components.js";
import { bindCopyButton } from "../../common/js/lib/clipboard.js";
import { showConfirmModal } from "../../common/js/lib/confirm-modal.js";
import { refreshTooltips } from "../../common/js/lib/tooltips.js";

const TIERS = [
  ["free", "Free"],
  ["player", "Player"],
  ["gm", "GM"],
  ["creator", "Creator"],
];

function tierLabel(tier) {
  return TIERS.find(([value]) => value === tier)?.[1] || tier;
}

// The link opens the Dashboard (one level above Loom) with the code in the address, which opens the sign-up form.
function inviteLink(code) {
  return new URL(`../?invite=${encodeURIComponent(code)}`, window.location.href).href;
}

function fromServerTime(iso) {
  return iso ? new Date(`${iso}Z`) : null;
}

// A datetime-local value is the visitor's own time; the server stores UTC.
function toServerTime(localValue) {
  return localValue ? new Date(localValue).toISOString().slice(0, 19) : "";
}

function toLocalInput(iso) {
  const date = fromServerTime(iso);
  if (!date) return "";
  const pad = (n) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function field(label, control) {
  const wrap = el("div", "d-flex flex-column gap-1");
  wrap.append(el("label", "form-label small fw-semibold mb-0", label), control);
  return wrap;
}

export function initInvitesAdmin({ dataManager, getStatus, mount }) {
  const say = (message, type = "success") => getStatus?.()?.show(message, { type, timeout: type === "danger" ? 4000 : 1600 });
  const list = el("div", "d-flex flex-column gap-2");
  let editingCode = "";

  // --- the create / edit form --------------------------------------------
  const labelInput = el("input", "form-control form-control-sm");
  labelInput.maxLength = 80;
  labelInput.placeholder = "Where this invite is going, e.g. Reddit post";
  const tierSelect = el("select", "form-select form-select-sm");
  TIERS.forEach(([value, text]) => tierSelect.appendChild(new Option(text, value)));
  tierSelect.value = "free";
  const limitInput = el("input", "form-control form-control-sm");
  limitInput.type = "number";
  limitInput.min = "1";
  limitInput.placeholder = "No limit";
  const expiresInput = el("input", "form-control form-control-sm");
  expiresInput.type = "datetime-local";

  const saveButton = el("button", "btn btn-primary btn-sm", "Create invite");
  saveButton.type = "button";
  const cancelButton = el("button", "btn btn-outline-secondary btn-sm", "Cancel");
  cancelButton.type = "button";
  const buttons = el("div", "d-flex gap-2");
  buttons.append(saveButton, cancelButton);

  const form = el("div", "border rounded-3 p-3 d-flex flex-column gap-3");
  const fields = el("div", "d-grid gap-3");
  fields.style.gridTemplateColumns = "repeat(auto-fit, minmax(12rem, 1fr))";
  fields.append(field("Label", labelInput), field("Starting tier", tierSelect), field("Use limit", limitInput), field("Expires", expiresInput));
  form.append(fields, buttons);
  setElementVisible(form, false, "flex");

  function openForm(invite = null) {
    editingCode = invite?.code || "";
    labelInput.value = invite?.label || "";
    tierSelect.value = invite?.tier || "free";
    limitInput.value = invite?.maxUses ?? "";
    expiresInput.value = toLocalInput(invite?.expiresAt);
    saveButton.textContent = invite ? "Save changes" : "Create invite";
    setElementVisible(form, true, "flex");
    labelInput.focus();
  }

  function closeForm() {
    editingCode = "";
    setElementVisible(form, false, "flex");
  }

  async function guard(work, failure) {
    try {
      await work();
    } catch (error) {
      say(error.message || failure, "danger");
    }
  }

  saveButton.addEventListener("click", () =>
    guard(async () => {
      const body = {
        label: labelInput.value,
        tier: tierSelect.value,
        maxUses: limitInput.value,
        expiresAt: toServerTime(expiresInput.value),
      };
      if (editingCode) {
        await dataManager.updateInvite(editingCode, body);
        say("Invite saved.");
      } else {
        const created = await dataManager.createInvite(body);
        say(`Invite created: ${created.label}.`);
      }
      closeForm();
      await refresh();
    }, "Unable to save the invite.")
  );
  cancelButton.addEventListener("click", closeForm);

  // --- the list ------------------------------------------------------------
  function badge(text, variant = "secondary") {
    return el("span", `badge text-bg-${variant}`, text);
  }

  function renderRow(invite) {
    const row = el("div", "border rounded-3 p-2 d-flex flex-column gap-1");
    const expires = fromServerTime(invite.expiresAt);
    const head = el("div", "d-flex flex-wrap align-items-center gap-2");
    head.append(
      el("span", "fw-semibold", invite.label),
      badge(tierLabel(invite.tier), invite.tier === "free" ? "secondary" : "info"),
      badge(invite.active ? "On" : "Off", invite.active ? "success" : "secondary"),
      el("span", "small text-body-secondary", invite.maxUses ? `${invite.uses} of ${invite.maxUses} used` : `${invite.uses} used`),
      el("span", "small text-body-secondary", expires ? `expires ${expires.toLocaleString()}` : "no expiry")
    );

    const link = inviteLink(invite.code);
    const linkLine = el("div", "d-flex flex-wrap align-items-center gap-2");
    const linkText = el("code", "small text-truncate flex-grow-1 user-select-all", link);
    linkText.style.minWidth = "0";
    const copyButton = createIconButton({ icon: "tabler:copy", label: "Copy the invite link" });
    bindCopyButton(copyButton, link);
    const toggleButton = createIconButton({
      icon: invite.active ? "tabler:player-pause" : "tabler:player-play",
      label: invite.active ? "Switch this invite off" : "Switch this invite on",
      onClick: () =>
        guard(async () => {
          await dataManager.updateInvite(invite.code, { active: !invite.active });
          await refresh();
        }, "Unable to change the invite."),
    });
    const editButton = createIconButton({ icon: "tabler:pencil", label: "Edit this invite", onClick: () => openForm(invite) });
    const deleteButton = createIconButton({
      icon: "tabler:trash",
      label: "Delete this invite",
      variant: "outline-danger",
      onClick: () =>
        guard(async () => {
          const confirmed = await showConfirmModal({
            title: `Delete "${invite.label}"?`,
            bodyHtml: '<p class="mb-0">The link stops working. Accounts that already joined with it keep working.</p>',
            confirmLabel: "Delete",
            confirmVariant: "danger",
          });
          if (!confirmed) return;
          await dataManager.deleteInvite(invite.code);
          say("Invite deleted.");
          await refresh();
        }, "Unable to delete the invite."),
    });
    linkLine.append(linkText, copyButton, toggleButton, editButton, deleteButton);
    row.append(head, linkLine);
    if (invite.members?.length) {
      row.appendChild(el("div", "small text-body-secondary", `Joined: ${invite.members.join(", ")}`));
    }
    return row;
  }

  async function refresh() {
    try {
      const invites = await dataManager.listInvites();
      list.replaceChildren(
        ...(invites.length ? invites.map(renderRow) : [el("p", "small text-body-secondary mb-0", "No invites yet. Create one to get a link you can share.")])
      );
      refreshTooltips(list);
    } catch (error) {
      list.replaceChildren(el("p", "small text-danger mb-0", error.message || "Unable to load the invites."));
    }
  }

  const content = el("div", "d-flex flex-column gap-3");
  content.append(form, list);
  const wrap = el("div", "card shadow-theme");
  const body = el("div", "card-body");
  body.appendChild(
    createCollapsibleSection({
      label: "Invites",
      collapsed: false,
      helpTopic: "loom.invites",
      actions: [{ icon: "tabler:plus", label: "Create an invite", onClick: () => openForm() }],
      content,
      className: "d-flex flex-column gap-3",
      panelClassName: "d-flex flex-column gap-2",
    }).section
  );
  wrap.appendChild(body);
  mount.appendChild(wrap);

  return { refresh };
}
