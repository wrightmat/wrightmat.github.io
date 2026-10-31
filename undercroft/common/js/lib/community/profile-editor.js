// The signed-in user's own community profile: every field, saved in one go
// through the validated profile endpoint.
import { el } from "../dom.js";
import { createLocationPicker } from "./location-picker.js";
import { loadCommunityReference, loadSystemChoices } from "./reference.js";
import { createScaleControl } from "./scale-control.js";
import { renderProfileView } from "./profile-view.js";
import { renderAccountBadge } from "./service-badge.js";
import { initHelpSystem } from "../help.js";
import { helpBadge } from "./help-badge.js";

function field(label, control, hint, topic) {
  const wrap = el("div", "d-flex flex-column gap-1");
  const heading = el("label", "form-label small fw-semibold mb-0", label);
  if (topic) heading.appendChild(helpBadge(topic));
  wrap.appendChild(heading);
  wrap.appendChild(control);
  if (hint) wrap.appendChild(el("div", "text-body-secondary small", hint));
  return wrap;
}

function optionSelect(options, value, placeholder) {
  const node = el("select", "form-select form-select-sm");
  node.appendChild(new Option(placeholder, ""));
  options.forEach((entry) => node.appendChild(new Option(entry.label, entry.id)));
  node.value = value || "";
  return node;
}

function checkRow(label, checked, onChange) {
  const row = el("label", "form-check small");
  const input = el("input", "form-check-input");
  input.type = "checkbox";
  input.checked = checked;
  input.addEventListener("change", () => onChange(input.checked));
  row.append(input, el("span", "form-check-label", label));
  return row;
}

function timeZones() {
  try {
    return Intl.supportedValuesOf("timeZone");
  } catch (error) {
    return [];
  }
}

// Whichever profile editor is mounted answers this; a single listener covers re-mounts.
let hasUnsavedProfile = () => false;
window.addEventListener("beforeunload", (event) => {
  if (!hasUnsavedProfile()) return;
  event.preventDefault();
  event.returnValue = "";
});

export async function mountProfileEditor(container, { dataManager, status } = {}) {
  container.replaceChildren(el("div", "text-body-secondary small", "Loading…"));
  const [reference, systems, saved] = await Promise.all([
    loadCommunityReference(),
    loadSystemChoices(dataManager),
    dataManager.getCommunityProfile(),
  ]);
  const profile = {
    public: false, bio: "", role: "", experience: "", openTo: "", playMode: "", sessionLength: "", timezone: "",
    systems: [], externalAccounts: [], availability: {}, safetyTools: [], scales: {}, location: { precision: "hidden" }, ...(saved.profile || {}),
  };
  profile.timezone = profile.timezone || "";
  profile.role = profile.role || "";
  profile.experience = profile.experience || "";
  profile.openTo = profile.openTo || "";
  profile.playMode = profile.playMode || "";
  profile.sessionLength = profile.sessionLength || "";
  const opt = reference.options;
  const root = el("div", "d-flex flex-column gap-3");

  const publicRow = checkRow("Make my profile public", profile.public, (v) => (profile.public = v));
  publicRow.appendChild(helpBadge("community.privacy"));
  const bio = el("textarea", "form-control form-control-sm");
  bio.rows = 3;
  bio.maxLength = 2000;
  bio.value = profile.bio;
  bio.addEventListener("input", () => (profile.bio = bio.value));
  const selects = {
    openTo: optionSelect(opt.openTo, profile.openTo, "Not looking"),
    role: optionSelect(opt.role, profile.role, "Not set"),
    experience: optionSelect(opt.experience, profile.experience, "Not set"),
    sessionLength: optionSelect(opt.sessionLength, profile.sessionLength, "No preference"),
    playMode: optionSelect(opt.playMode, profile.playMode, "No preference"),
  };
  Object.entries(selects).forEach(([key, node]) => node.addEventListener("change", () => (profile[key] = node.value)));

  const zones = timeZones();
  const timezone = el("input", "form-control form-control-sm");
  timezone.setAttribute("list", "profile-timezones");
  timezone.value = profile.timezone;
  timezone.placeholder = Intl.DateTimeFormat().resolvedOptions().timeZone || "Time zone";
  timezone.addEventListener("input", () => (profile.timezone = timezone.value.trim()));
  const zoneList = el("datalist");
  zoneList.id = "profile-timezones";
  zones.forEach((zone) => zoneList.appendChild(new Option(zone)));

  // Systems known: Library systems plus free text.
  const systemList = el("div", "d-flex flex-wrap gap-1");
  const systemSelect = el("select", "form-select form-select-sm");
  const systemText = el("input", "form-control form-control-sm");
  systemText.placeholder = "Other system";
  systemText.maxLength = 100;
  const systemAdd = el("button", "btn btn-outline-primary btn-sm flex-shrink-0", "Add");
  systemAdd.type = "button";
  // A system that isn't in the list is typed in only after choosing "Other system…", so the list stays the easy path.
  const OTHER_SYSTEM = "__other__";
  // Names other people have used, so the same system gets the same spelling.
  const systemSuggestions = el("datalist");
  systemSuggestions.id = "profile-system-suggestions";
  systemText.setAttribute("list", systemSuggestions.id);
  void dataManager
    .getSystemNameSuggestions()
    .then((names) => systemSuggestions.replaceChildren(...names.map((name) => new Option(name))))
    .catch(() => {});
  function renderSystems() {
    systemList.replaceChildren(
      ...profile.systems.map((entry, index) => {
        const chip = el("span", "badge text-bg-secondary d-inline-flex align-items-center gap-1");
        chip.append(entry.systemId ? systems.find((s) => s.id === entry.systemId)?.title || entry.systemId : entry.name);
        const remove = el("button", "btn-close btn-close-white");
        remove.type = "button";
        remove.style.fontSize = "0.55rem";
        remove.setAttribute("aria-label", "Remove system");
        remove.addEventListener("click", () => {
          profile.systems.splice(index, 1);
          renderSystems();
        });
        chip.appendChild(remove);
        return chip;
      }),
    );
    systemSelect.replaceChildren(
      new Option("Add a system…", ""),
      ...systems.map((s) => new Option(s.title, s.id)),
      new Option("Other system…", OTHER_SYSTEM),
    );
    systemSelect.value = otherSystemOpen ? OTHER_SYSTEM : "";
  }
  // One inline row: the select, and once "Other system…" is chosen the name box and its Add button beside it.
  let otherSystemOpen = false;
  function setOtherSystemOpen(open) {
    otherSystemOpen = open;
    // Inline display, since Bootstrap's own display on .form-control/.btn would override the hidden attribute.
    systemText.style.display = open ? "" : "none";
    systemAdd.style.display = open ? "" : "none";
    systemSelect.classList.toggle("flex-grow-1", !open);
    systemSelect.classList.toggle("flex-shrink-0", open);
    systemSelect.style.width = open ? "8.5rem" : "";
    if (open) systemText.focus();
  }
  systemSelect.addEventListener("change", () => {
    if (systemSelect.value === OTHER_SYSTEM) {
      setOtherSystemOpen(true);
      return;
    }
    if (systemSelect.value && !profile.systems.some((e) => e.systemId === systemSelect.value)) {
      profile.systems.push({ systemId: systemSelect.value, name: systems.find((s) => s.id === systemSelect.value)?.title || "" });
    }
    setOtherSystemOpen(false);
    renderSystems();
  });
  const systemKey = (text) => text.toLowerCase().replace(/[^a-z0-9]+/g, "");
  function addOtherSystem() {
    const typed = systemText.value.trim();
    if (!typed) {
      status?.show("Enter the name of the system.", { type: "warning", timeout: 2500 });
      return;
    }
    // A name that is really a Library System is added as that System, not as a free-text one.
    const known = systems.find((entry) => systemKey(entry.title) === systemKey(typed) || systemKey(entry.id) === systemKey(typed));
    if (known) {
      if (!profile.systems.some((entry) => entry.systemId === known.id)) profile.systems.push({ systemId: known.id, name: known.title });
    } else if (!profile.systems.some((entry) => !entry.systemId && systemKey(entry.name) === systemKey(typed))) {
      profile.systems.push({ systemId: null, name: typed });
    }
    systemText.value = "";
    setOtherSystemOpen(false);
    renderSystems();
  }
  systemAdd.addEventListener("click", addOtherSystem);
  systemText.addEventListener("keydown", (event) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    addOtherSystem();
  });
  const systemControls = el("div", "d-flex flex-nowrap gap-2");
  systemText.style.minWidth = "0";
  systemControls.append(systemSelect, systemText, systemAdd, systemSuggestions);
  setOtherSystemOpen(false);
  renderSystems();

  // Other accounts: pick a service and give a username. One per service; adding it again replaces the username.
  const services = reference.services || [];
  const accountList = el("div", "d-flex flex-wrap gap-2");
  const serviceSelect = el("select", "form-select form-select-sm");
  const accountName = el("input", "form-control form-control-sm");
  accountName.placeholder = "Username";
  accountName.maxLength = 100;
  const accountAdd = el("button", "btn btn-outline-primary btn-sm flex-shrink-0", "Add");
  accountAdd.type = "button";
  [["play", "Play services"], ["social", "Social media"]].forEach(([category, title]) => {
    const group = document.createElement("optgroup");
    group.label = title;
    services.filter((service) => service.category === category).forEach((service) => group.appendChild(new Option(service.name, service.id)));
    if (group.children.length) serviceSelect.appendChild(group);
  });
  serviceSelect.insertBefore(new Option("Service…", ""), serviceSelect.firstChild);
  serviceSelect.value = "";
  function renderAccounts() {
    accountList.replaceChildren(
      ...profile.externalAccounts
        .map((account, index) =>
          renderAccountBadge(account, services, {
            onRemove: () => {
              profile.externalAccounts.splice(index, 1);
              renderAccounts();
            },
          }),
        )
        .filter(Boolean),
    );
  }
  function addAccount() {
    const username = accountName.value.trim();
    if (!serviceSelect.value || !username) {
      status?.show("Choose a service and enter your username there.", { type: "warning", timeout: 2500 });
      return;
    }
    profile.externalAccounts = profile.externalAccounts.filter((account) => account.serviceId !== serviceSelect.value);
    profile.externalAccounts.push({ serviceId: serviceSelect.value, username });
    accountName.value = "";
    serviceSelect.value = "";
    renderAccounts();
  }
  accountAdd.addEventListener("click", addAccount);
  accountName.addEventListener("keydown", (event) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    addAccount();
  });
  renderAccounts();
  // One inline row; the service gets a fixed width and the username takes the rest.
  serviceSelect.classList.add("flex-shrink-0");
  serviceSelect.style.width = "8.5rem";
  accountName.style.minWidth = "0";
  const accountControls = el("div", "d-flex flex-nowrap gap-2");
  accountControls.append(serviceSelect, accountName, accountAdd);

  // Availability: a day × time-of-day grid in the profile's own time zone.
  const grid = el("table", "table table-sm table-bordered text-center align-middle mb-0 small");
  const header = el("tr");
  header.appendChild(el("th"));
  opt.dayParts.forEach((part) => header.appendChild(el("th", "fw-normal", part.label)));
  grid.appendChild(el("thead")).appendChild(header);
  const gridBody = el("tbody");
  opt.weekdays.forEach((day) => {
    const row = el("tr");
    row.appendChild(el("th", "fw-normal text-start", day.label));
    opt.dayParts.forEach((part) => {
      const cell = el("td");
      const box = el("input", "form-check-input");
      box.type = "checkbox";
      box.setAttribute("aria-label", `${day.label} ${part.label}`);
      box.checked = Boolean(profile.availability[day.id]?.includes(part.id));
      box.addEventListener("change", () => {
        const set = new Set(profile.availability[day.id] || []);
        box.checked ? set.add(part.id) : set.delete(part.id);
        if (set.size) profile.availability[day.id] = [...set];
        else delete profile.availability[day.id];
      });
      cell.appendChild(box);
      row.appendChild(cell);
    });
    gridBody.appendChild(row);
  });
  grid.appendChild(gridBody);

  // Safety tools, grouped by when they're used.
  const tools = el("div", "d-flex flex-column gap-2");
  [["before", "Before play"], ["during", "During play"], ["after", "After play"]].forEach(([phase, title]) => {
    const entries = reference.safetyTools.filter((tool) => tool.phase === phase);
    if (!entries.length) return;
    const group = el("div", "d-flex flex-column");
    group.appendChild(el("span", "small fw-semibold text-body-secondary", title));
    entries.forEach((tool) => {
      const row = checkRow(tool.name, profile.safetyTools.includes(tool.id), (on) => {
        profile.safetyTools = on ? [...profile.safetyTools, tool.id] : profile.safetyTools.filter((id) => id !== tool.id);
      });
      row.title = tool.description;
      group.appendChild(row);
    });
    tools.appendChild(group);
  });

  const scales = el("div", "d-flex flex-column gap-3");
  reference.scales.forEach((scale) => {
    scales.appendChild(
      createScaleControl(scale, profile.scales[scale.id], {
        points: reference.points,
        onChange: (value) => {
          if (value == null) delete profile.scales[scale.id];
          else profile.scales[scale.id] = value;
        },
      }).element,
    );
  });

  const picker = await createLocationPicker(profile.location, { onChange: (value) => (profile.location = value) });

  const preview = el("div", "border rounded p-3");
  preview.hidden = true;
  const saveButton = el("button", "btn btn-primary btn-sm", "Save profile");
  saveButton.type = "button";
  const previewButton = el("button", "btn btn-outline-secondary btn-sm", "See how others see my profile");
  previewButton.type = "button";
  const payload = () => ({ ...profile, location: picker.getValue() });
  // Save stays disabled until something differs from what was last loaded or saved.
  let savedSnapshot = JSON.stringify(payload());
  const syncSaveState = () => {
    saveButton.disabled = JSON.stringify(payload()) === savedSnapshot;
  };
  syncSaveState();
  hasUnsavedProfile = () => container.isConnected && !saveButton.disabled;
  saveButton.addEventListener("click", async () => {
    saveButton.disabled = true;
    try {
      const result = await dataManager.saveCommunityProfile(payload());
      Object.assign(profile, result.profile);
      savedSnapshot = JSON.stringify(payload());
      status?.show("Profile saved.", { type: "success", timeout: 2500 });
    } catch (error) {
      status?.show(error.message || "Could not save the profile.", { type: "error" });
    } finally {
      syncSaveState();
    }
  });
  previewButton.addEventListener("click", () => {
    preview.hidden = !preview.hidden;
    if (!preview.hidden) {
      preview.replaceChildren(
        renderProfileView({ username: "You", profile: { ...payload(), locationLabel: "" } }, { reference, systems }),
      );
    }
  });

  const col = (...children) => {
    const wrap = el("div", "d-flex flex-column gap-3");
    wrap.append(...children);
    return wrap;
  };
  const row = el("div", "row g-4");
  const left = el("div", "col-12 col-xl-6");
  const right = el("div", "col-12 col-xl-6");
  left.appendChild(
    col(
      field("Bio", bio),
      field("Open to", selects.openTo),
      field("Role", selects.role),
      field("Experience", selects.experience),
      field("Systems known", col(systemList, systemControls)),
      field("Other accounts", col(accountList, accountControls), undefined, "community.profile"),
      field("Preferred session length", selects.sessionLength),
      field("In-person or online", selects.playMode),
      field("Time zone", col(timezone, zoneList)),
      field("Typical availability", grid, "In your time zone."),
      field("Location", picker.element, undefined, "community.location"),
      field("Safety tools", tools, undefined, "community.safetyTools"),
    ),
  );
  const scalesHeading = el("div", "text-uppercase fs-6 fw-semibold text-body-secondary", "What I like in a game");
  scalesHeading.appendChild(helpBadge("community.scales"));
  right.appendChild(col(scalesHeading, scales));
  row.append(left, right);
  const actions = el("div", "d-flex flex-wrap align-items-center gap-3");
  actions.append(saveButton, previewButton, publicRow);
  // Setting Open to only lists you in Find a Game once the profile is public.
  const openToHint = el("div", "small text-warning", "You'll only appear in Find a Game once your profile is public.");
  const syncOpenToHint = () => {
    openToHint.hidden = !(profile.openTo && !profile.public);
  };
  syncOpenToHint();
  ["input", "change", "click"].forEach((type) => root.addEventListener(type, () => window.setTimeout(syncOpenToHint, 0)));
  root.append(actions, openToHint, preview, row);
  ["input", "change", "click", "keydown"].forEach((type) => root.addEventListener(type, () => window.setTimeout(syncSaveState, 0)));
  container.replaceChildren(root);
  void initHelpSystem({ root: container });
}
