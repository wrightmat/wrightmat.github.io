// Loom's Users tab, Invites card (admins): shareable sign-up links that start an account at a chosen tier and
// record where each account came from. The server owns every rule (server/invites.py); this is the editor.
// Same shape as the Groups tab's Recruitment: a selectable list here, add and edit in the right pane.
import { el, setElementVisible } from "../../common/js/lib/dom.js";
import { createCollapsibleSection, createIconButton, createListRow } from "../../common/js/lib/ui-components.js";
import { bindCopyButton } from "../../common/js/lib/clipboard.js";
import { showConfirmModal } from "../../common/js/lib/confirm-modal.js";
import { disposeTooltips, refreshTooltips } from "../../common/js/lib/tooltips.js";

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

function badge(text, variant = "secondary") {
  return el("span", `badge text-bg-${variant}`, text);
}

export function initInvitesAdmin({ dataManager, getStatus, mount, inspectorMount }) {
  const say = (message, type = "success") => getStatus?.()?.show(message, { type, timeout: type === "danger" ? 4000 : 1600 });
  let invites = [];
  let selection = null; // { kind: "new" } | { kind: "invite", code }

  async function guard(work, failure) {
    try {
      await work();
    } catch (error) {
      say(error.message || failure, "danger");
    }
  }

  // --- the list ------------------------------------------------------------
  const list = el("div", "d-flex flex-column gap-2");
  const content = el("div", "d-flex flex-column gap-2 border rounded-3 p-2");
  content.appendChild(list);
  const wrap = el("div", "card shadow-theme");
  const body = el("div", "card-body");
  body.appendChild(
    createCollapsibleSection({
      label: "Invites",
      collapsed: false,
      helpTopic: "loom.invites",
      actions: [{ icon: "tabler:plus", label: "Create an invite", onClick: () => choose({ kind: "new" }) }],
      content,
      className: "d-flex flex-column gap-2",
      panelClassName: "d-flex flex-column gap-2",
    }).section
  );
  wrap.appendChild(body);
  mount.appendChild(wrap);

  function describe(invite) {
    const expires = fromServerTime(invite.expiresAt);
    const used = invite.maxUses ? `${invite.uses} of ${invite.maxUses} used` : `${invite.uses} used`;
    return `${used} · ${expires ? `expires ${expires.toLocaleString()}` : "no expiry"}`;
  }

  function renderList() {
    disposeTooltips(list);
    list.textContent = "";
    if (!invites.length) list.appendChild(el("p", "small text-body-secondary mb-0", "No invites yet. Use + to create one and get a link you can share."));
    invites.forEach((invite) => {
      // The same row as a session's or a listing's, so every list highlights alike.
      const row = createListRow({
        title: invite.label,
        description: describe(invite),
        onSelect: () => choose({ kind: "invite", code: invite.code }),
      });
      row.classList.add("loom-session-row");
      if (selection?.kind === "invite" && selection.code === invite.code) row.classList.add("border-primary");
      const chips = el("div", "d-flex flex-wrap gap-1 mt-1");
      chips.append(badge(tierLabel(invite.tier), invite.tier === "free" ? "secondary" : "info"), badge(invite.active ? "On" : "Off", invite.active ? "success" : "secondary"));
      row.querySelector(".flex-grow-1").appendChild(chips);
      list.appendChild(row);
    });
    refreshTooltips(list);
  }

  // --- the inspector (right pane) -------------------------------------------
  const inspectorBody = el("div", "d-flex flex-column gap-3");
  const inspectorParts = createCollapsibleSection({
    label: "Invite Inspector",
    collapsed: false,
    content: inspectorBody,
    className: "d-flex flex-column gap-3",
    panelClassName: "d-flex flex-column gap-3",
  });
  inspectorMount.appendChild(inspectorParts.section);
  setElementVisible(inspectorParts.section, false, "flex");

  const toolbarButton = (config) => createIconButton({ variant: "outline-secondary", kind: "toolbar", tooltipPlacement: "top", ...config });

  function choose(next) {
    selection = next;
    renderList();
    renderInspector();
  }

  function renderInspector() {
    disposeTooltips(inspectorBody);
    inspectorBody.textContent = "";
    const existing = selection?.kind === "invite" ? invites.find((invite) => invite.code === selection.code) : null;
    if (!selection || (selection.kind === "invite" && !existing)) {
      selection = null;
      setElementVisible(inspectorParts.section, false, "flex");
      return;
    }
    setElementVisible(inspectorParts.section, true, "flex");

    const labelInput = el("input", "form-control form-control-sm");
    labelInput.maxLength = 80;
    labelInput.placeholder = "Where this invite is going, e.g. Reddit post";
    labelInput.value = existing?.label || "";
    const tierSelect = el("select", "form-select form-select-sm");
    TIERS.forEach(([value, text]) => tierSelect.appendChild(new Option(text, value)));
    tierSelect.value = existing?.tier || "free";
    const limitInput = el("input", "form-control form-control-sm");
    limitInput.type = "number";
    limitInput.min = "1";
    limitInput.placeholder = "No limit";
    limitInput.value = existing?.maxUses ?? "";
    const expiresInput = el("input", "form-control form-control-sm");
    expiresInput.type = "datetime-local";
    expiresInput.value = toLocalInput(existing?.expiresAt);
    const stateSelect = el("select", "form-select form-select-sm");
    stateSelect.append(new Option("On", "on"), new Option("Off", "off"));
    stateSelect.value = existing && !existing.active ? "off" : "on";

    const save = toolbarButton({
      icon: "tabler:device-floppy",
      label: existing ? "Save invite" : "Create invite",
      variant: "primary",
      onClick: () =>
        guard(async () => {
          const payload = { label: labelInput.value, tier: tierSelect.value, maxUses: limitInput.value, expiresAt: toServerTime(expiresInput.value) };
          if (existing) {
            await dataManager.updateInvite(existing.code, { ...payload, active: stateSelect.value === "on" });
            say("Invite saved.");
            selection = { kind: "invite", code: existing.code };
          } else {
            const created = await dataManager.createInvite(payload);
            say(`Invite created: ${created.label}.`);
            selection = { kind: "invite", code: created.code };
          }
          await refresh({ rerenderInspector: true });
        }, "Unable to save the invite."),
    });
    const buttons = [save, toolbarButton({ icon: "tabler:x", label: "Close", onClick: () => choose(null) })];

    if (existing) {
      const link = inviteLink(existing.code);
      const copy = toolbarButton({ icon: "tabler:copy", label: "Copy the invite link" });
      bindCopyButton(copy, link);
      buttons.push(
        copy,
        toolbarButton({
          icon: "tabler:trash",
          label: "Delete invite",
          variant: "outline-danger",
          onClick: () =>
            guard(async () => {
              const confirmed = await showConfirmModal({
                title: `Delete "${existing.label}"?`,
                bodyHtml: '<p class="mb-0">The link stops working. Accounts that already joined with it keep working.</p>',
                confirmLabel: "Delete",
                confirmVariant: "danger",
              });
              if (!confirmed) return;
              await dataManager.deleteInvite(existing.code);
              say("Invite deleted.");
              selection = null;
              await refresh({ rerenderInspector: true });
            }, "Unable to delete the invite."),
        })
      );
    }

    const toolbar = el("div", "btn-toolbar justify-content-center overflow-x-auto");
    toolbar.setAttribute("role", "toolbar");
    toolbar.setAttribute("aria-label", "Invite actions");
    const group = el("div", "btn-group");
    group.append(...buttons);
    toolbar.appendChild(group);
    inspectorBody.append(toolbar, el("h3", "h6 mb-0", existing ? "Edit invite" : "New invite"));

    if (existing) {
      const linkText = el("code", "small text-break user-select-all", inviteLink(existing.code));
      inspectorBody.append(field("Link", linkText));
    }
    inspectorBody.append(field("Label", labelInput), field("Starting tier", tierSelect), field("Use limit", limitInput), field("Expires", expiresInput));
    if (existing) {
      inspectorBody.append(field("Invite is", stateSelect));
      inspectorBody.appendChild(el("div", "small text-body-secondary", describe(existing)));
      if (existing.members?.length) inspectorBody.appendChild(el("div", "small text-body-secondary", `Joined: ${existing.members.join(", ")}`));
    }
    refreshTooltips(inspectorBody);
  }

  async function refresh({ rerenderInspector = false } = {}) {
    try {
      invites = await dataManager.listInvites();
    } catch (error) {
      invites = [];
      list.replaceChildren(el("p", "small text-danger mb-0", error.message || "Unable to load the invites."));
      return;
    }
    renderList();
    const stillThere = selection?.kind !== "invite" || invites.some((invite) => invite.code === selection.code);
    // The inspector is left alone on a plain reload so a half-typed edit isn't lost.
    if (rerenderInspector || !stillThere) renderInspector();
  }

  return { refresh };
}
