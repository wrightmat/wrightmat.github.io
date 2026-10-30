// Endorsing people you've shared a table with: one tag per person per campaign
// (or per session when it isn't in a campaign). The server only lists people
// who are eligible, and endorsers stay anonymous to everyone else.
import { el } from "../dom.js";
import { initHelpSystem } from "../help.js";
import { helpBadge } from "./help-badge.js";
import { loadCommunityReference } from "./reference.js";

// `groupId` limits the list to one group's tables.
export async function renderEndorsePanel(container, { dataManager, status, groupId = null } = {}) {
  container.replaceChildren(el("div", "text-body-secondary small", "Loading…"));
  let people;
  let reference;
  try {
    [people, reference] = await Promise.all([dataManager.listEndorsable(), loadCommunityReference()]);
  } catch (error) {
    container.replaceChildren(el("div", "text-danger small", error.message || "Unable to load who you can endorse."));
    return;
  }
  const eligible = people.people.filter((person) => !groupId || person.groupId === groupId);
  const wrap = el("div", "d-flex flex-column gap-2");
  const heading = el("div", "text-uppercase fs-6 fw-semibold text-body-secondary", "Endorse");
  heading.appendChild(helpBadge("community.endorsements"));
  wrap.appendChild(heading);
  if (!eligible.length) {
    wrap.appendChild(el("p", "small text-body-secondary mb-0", "Nobody to endorse right now. You can endorse someone once, for each campaign you've played together."));
    container.replaceChildren(wrap);
    void initHelpSystem({ root: container });
    return;
  }
  eligible.forEach((person) => {
    const tags = reference.endorsements.filter((tag) => tag.appliesTo === person.role || tag.appliesTo === "both");
    const row = el("div", "d-flex flex-wrap align-items-center gap-2 small");
    row.append(
      el("span", "fw-semibold", person.username),
      el("span", "text-body-secondary", `${person.role === "gm" ? "GM" : "player"} · ${person.label}`),
    );
    const select = el("select", "form-select form-select-sm w-auto");
    select.appendChild(new Option("Choose a tag…", ""));
    tags.forEach((tag) => select.appendChild(new Option(tag.name, tag.id)));
    const button = el("button", "btn btn-outline-primary btn-sm", "Endorse");
    button.type = "button";
    button.addEventListener("click", async () => {
      if (!select.value) {
        status?.show("Choose a tag first.", { type: "info" });
        return;
      }
      button.disabled = true;
      try {
        await dataManager.endorsePerson({ userId: person.userId, scopeKey: person.scopeKey, tagId: select.value });
        status?.show(`Endorsed ${person.username}.`, { type: "success", timeout: 2000 });
        row.remove();
      } catch (error) {
        status?.show(error.message || "Unable to endorse.", { type: "error" });
        button.disabled = false;
      }
    });
    row.append(select, button);
    wrap.appendChild(row);
  });
  container.replaceChildren(wrap);
  void initHelpSystem({ root: container });
}
