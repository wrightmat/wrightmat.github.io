import { initAppShell } from "./js/lib/app-shell.js";
import { DataManager } from "./js/lib/data-manager.js";
import { resolveApiBase } from "./js/lib/api.js";
import { initAuthControls } from "./js/lib/auth-ui.js";
import { initHelpSystem } from "./js/lib/help.js";
import { el, setElementVisible } from "./js/lib/dom.js";
import { createModeToggleGroup } from "./js/lib/ui-components.js";
import { loadCommunityReference, loadSystemChoices, optionLabel, systemTitle } from "./js/lib/community/reference.js";
import { renderListingCard } from "./js/lib/community/listing-card.js";
import { renderProfileView } from "./js/lib/community/profile-view.js";
import { renderScaleComparison, scaleCloseness, closenessText } from "./js/lib/community/scale-control.js";
import { renderTrustProfile } from "./js/lib/community/trust-profile.js";
import { describeDuration, describeRecurrence, formatSessionRange } from "./js/lib/sessions/format.js";

(() => {
  const { status } = initAppShell({
    namespace: "find-a-game",
    leftPaneLabel: "Toggle filters pane",
    rightPaneLabel: "Toggle details pane",
    leftPane: { size: "lg", initial: "expanded" },
    rightPane: { size: "lg", initial: "expanded" },
  });
  const dataManager = new DataManager({ baseUrl: resolveApiBase() });
  initAuthControls({ root: document, status, dataManager });
  initHelpSystem({ root: document });

  const refs = {
    mode: document.querySelector("[data-fag-mode]"),
    filters: document.querySelector("[data-fag-filters]"),
    title: document.querySelector("[data-fag-title]"),
    sort: document.querySelector("[data-fag-sort]"),
    sortWrap: document.querySelector("[data-fag-sort-wrap]"),
    results: document.querySelector("[data-fag-results]"),
    detail: document.querySelector("[data-fag-detail]"),
  };
  const state = {
    mode: "listings",
    reference: null,
    systems: [],
    mine: null,
    listings: [],
    people: [],
    selectedId: null,
    filters: { listings: {}, people: {} },
    sort: "newest",
  };

  const signedIn = () => dataManager.isAuthenticated();

  function filterField(label, control) {
    const wrap = el("div", "d-flex flex-column gap-1");
    wrap.append(el("label", "form-label small fw-semibold mb-0", label), control);
    return wrap;
  }

  function filterSelect(key, options, anyLabel) {
    const select = el("select", "form-select form-select-sm");
    select.appendChild(new Option(anyLabel, ""));
    options.forEach(({ value, label }) => select.appendChild(new Option(label, value)));
    select.value = state.filters[state.mode][key] || "";
    select.addEventListener("change", () => {
      state.filters[state.mode][key] = select.value;
      void load();
    });
    return select;
  }

  // Your own profile and the listings of groups you already belong to are left out unless asked for.
  function showAllToggle() {
    const wrap = el("label", "form-check small d-flex align-items-center gap-2 mb-0");
    const box = el("input", "form-check-input mt-0");
    box.type = "checkbox";
    box.checked = state.filters[state.mode].all === "1";
    box.addEventListener("change", () => {
      state.filters[state.mode].all = box.checked ? "1" : "";
      void load();
    });
    wrap.append(box, el("span", "form-check-label", state.mode === "listings" ? "Show my own groups' listings" : "Show me"));
    return wrap;
  }

  async function renderFilters() {
    const { options } = state.reference;
    const pick = (group) => options[group].map((entry) => ({ value: entry.id, label: entry.label }));
    refs.filters.replaceChildren();
    if (state.mode === "listings") {
      const usedSystems = state.systems.map((system) => ({ value: system.id, label: system.title }));
      refs.filters.append(
        filterField("Kind", filterSelect("targetKind", [{ value: "session", label: "Single session" }, { value: "campaign", label: "Campaign" }], "Any")),
        filterField("System", filterSelect("systemId", usedSystems, "Any")),
        filterField("Platform", filterSelect("platform", pick("platform"), "Any")),
        filterField("Session length", filterSelect("sessionLength", pick("sessionLength"), "Any")),
        filterField("Age range", filterSelect("ageRange", pick("ageRange"), "Any")),
      );
      const tag = el("input", "form-control form-control-sm");
      tag.setAttribute("list", "fag-tags");
      tag.placeholder = "Tag";
      tag.value = state.filters.listings.tag || "";
      tag.addEventListener("change", () => {
        state.filters.listings.tag = tag.value.trim();
        void load();
      });
      const datalist = el("datalist");
      datalist.id = "fag-tags";
      try {
        const usage = await dataManager.getCommunityTags();
        usage.forEach((entry) => datalist.appendChild(new Option(entry.tag)));
      } catch (error) {
        // Suggestions are optional.
      }
      refs.filters.append(filterField("Tag", tag), datalist);
      if (signedIn()) refs.filters.appendChild(showAllToggle());
    } else {
      refs.filters.append(
        filterField("Open to", filterSelect("openTo", pick("openTo"), "Either")),
        filterField("Role", filterSelect("role", pick("role"), "Any")),
        filterField("Play", filterSelect("playMode", pick("playMode"), "Any")),
        showAllToggle(),
      );
    }
  }

  function renderModeToggle() {
    createModeToggleGroup({
      container: refs.mode,
      ariaLabel: "What to browse",
      value: state.mode,
      options: [
        { value: "listings", label: "Listings", icon: "tabler:list-search" },
        { value: "people", label: "People", icon: "tabler:users", disabled: !signedIn(), tooltip: signedIn() ? undefined : "Profiles are only shown to signed-in users. Sign in to browse people." },
      ],
      onChange: (value) => {
        state.mode = value;
        state.selectedId = null;
        void refresh();
      },
    });
  }

  function renderSortOptions() {
    setElementVisible(refs.sortWrap, state.mode === "listings", "flex");
    refs.sort.replaceChildren(new Option("Newest", "newest"));
    if (state.mine && Object.keys(state.mine).length) refs.sort.appendChild(new Option("Closest match", "match"));
    refs.sort.value = state.sort;
    if (refs.sort.value !== state.sort) {
      state.sort = "newest";
      refs.sort.value = "newest";
    }
  }

  function sortedListings() {
    const items = [...state.listings];
    if (state.sort === "match" && state.mine) {
      items.sort((a, b) => {
        const left = scaleCloseness(state.mine, a.scales);
        const right = scaleCloseness(state.mine, b.scales);
        return right.close - left.close || right.shared - left.shared;
      });
    }
    return items;
  }

  function renderResults() {
    refs.title.textContent = state.mode === "listings" ? "Open listings" : "People looking for a game or recruiting";
    refs.results.replaceChildren();
    if (state.mode === "listings") {
      const items = sortedListings();
      if (!items.length) {
        refs.results.appendChild(el("p", "text-body-secondary mb-0", "No listings match."));
        return;
      }
      items.forEach((listing) => {
        refs.results.appendChild(
          renderListingCard(listing, {
            reference: state.reference,
            systems: state.systems,
            mineScales: state.mine,
            selected: listing.id === state.selectedId,
            onSelect: (picked) => {
              state.selectedId = picked.id;
              renderResults();
              void renderListingDetail(picked);
            },
          }),
        );
      });
      return;
    }
    if (!state.people.length) {
      refs.results.appendChild(el("p", "text-body-secondary mb-0", "Nobody matches."));
      return;
    }
    state.people.forEach((person) => {
      const card = el("div", `card shadow-theme${person.userId === state.selectedId ? " border-primary" : ""}`);
      card.style.cursor = "pointer";
      const body = el("div", "card-body d-flex flex-column gap-1");
      const profile = person.profile || {};
      body.append(
        el("div", "fw-semibold", person.username),
        el("div", "small text-body-secondary", [
          optionLabel(state.reference.options, "openTo", profile.openTo),
          optionLabel(state.reference.options, "role", profile.role),
          profile.locationLabel,
        ].filter(Boolean).join(" · ")),
      );
      if (state.mine && Object.keys(state.mine).length) body.appendChild(el("div", "small text-body-secondary", closenessText(state.mine, profile.scales)));
      card.appendChild(body);
      card.addEventListener("click", () => {
        state.selectedId = person.userId;
        renderResults();
        void renderPersonDetail(person);
      });
      refs.results.appendChild(card);
    });
  }

  function section(title, content) {
    const wrap = el("div", "d-flex flex-column gap-2");
    wrap.appendChild(el("div", "text-uppercase fs-6 fw-semibold text-body-secondary", title));
    wrap.appendChild(content);
    return wrap;
  }

  function trustDetails(label, userId) {
    const details = el("details", "border rounded p-2");
    details.appendChild(el("summary", "small fw-semibold", label));
    const body = el("div", "pt-2");
    details.appendChild(body);
    let loaded = false;
    details.addEventListener("toggle", () => {
      if (details.open && !loaded) {
        loaded = true;
        void renderTrustProfile(body, { dataManager, userId, systems: state.systems, heading: false });
      }
    });
    return details;
  }

  function applyPanel(listing) {
    const wrap = el("div", "d-flex flex-column gap-2");
    if (!signedIn()) {
      wrap.appendChild(el("p", "small text-body-secondary mb-0", "Sign in to apply."));
      return wrap;
    }
    if (listing.isMember) {
      wrap.appendChild(el("p", "small text-body-secondary mb-0", "You're already a member of this group."));
      return wrap;
    }
    if (listing.gm?.userId === dataManager.session?.user?.id) {
      wrap.appendChild(el("p", "small text-body-secondary mb-0", "This is your own listing."));
      return wrap;
    }
    if (listing.status !== "open") {
      wrap.appendChild(el("p", "small text-body-secondary mb-0", "This listing isn't open."));
      return wrap;
    }
    const message = el("textarea", "form-control form-control-sm");
    message.rows = 4;
    message.placeholder = "Introduce yourself to the GM";
    const button = el("button", "btn btn-primary btn-sm align-self-start", "Apply");
    button.type = "button";
    button.addEventListener("click", async () => {
      button.disabled = true;
      try {
        await dataManager.applyToListing(listing.id, message.value);
        status.show("Application sent. The conversation continues in your Inbox.", { type: "success" });
        wrap.replaceChildren(el("p", "small mb-0", "Application sent. Replies from the GM arrive in your Inbox."));
      } catch (error) {
        status.show(error.message || "Could not send the application.", { type: "error" });
        button.disabled = false;
      }
    });
    wrap.append(message, button);
    return wrap;
  }

  async function renderListingDetail(listing) {
    const { reference } = state;
    const root = el("div", "d-flex flex-column gap-3");
    root.appendChild(el("h2", "h5 mb-0", listing.systemId ? systemTitle(state.systems, listing.systemId) : listing.systemName));
    root.appendChild(
      el("div", "small text-body-secondary", `${listing.targetKind === "campaign" ? `Campaign: ${listing.campaignName || ""}` : "Single session"} · ${listing.openSeats} of ${listing.seatsOffered} seats open`),
    );
    if (listing.description) root.appendChild(el("p", "small mb-0", listing.description));
    const schedule = el("div", "d-flex flex-column gap-1");
    listing.schedule.forEach((series) => {
      schedule.appendChild(
        el("div", "small", `${series.title}: ${describeRecurrence(series.recurrence)} · ${describeDuration(series.durationMinutes)}${series.nextSlot ? ` · next ${formatSessionRange(series.nextSlot, null, { kind: series.kind })}` : ""}`),
      );
    });
    if (schedule.childElementCount) root.appendChild(section("Schedule", schedule));
    if (state.mine && Object.keys(state.mine).length) {
      root.appendChild(el("div", "small", closenessText(state.mine, listing.scales)));
    }
    root.appendChild(section("What this game is like", renderScaleComparison(reference.scales, listing.scales, state.mine, { points: reference.points, theirsLabel: "Listing" })));
    const people = el("div", "d-flex flex-column gap-2");
    if (listing.gm) people.appendChild(trustDetails(`GM: ${listing.gm.username}`, listing.gm.userId));
    listing.members.forEach((member) => people.appendChild(trustDetails(member.username, member.userId)));
    if (!signedIn()) people.appendChild(el("p", "small text-body-secondary mb-0", "Sign in to see the GM's and members' history."));
    root.appendChild(section("Who's at the table", people));
    root.appendChild(section("Apply", applyPanel(listing)));
    refs.detail.replaceChildren(root);
  }

  async function renderPersonDetail(person) {
    const root = el("div", "d-flex flex-column gap-3");
    root.appendChild(renderProfileView(person, { reference: state.reference, systems: state.systems, mineScales: state.mine }));
    const history = el("div");
    root.appendChild(section("History", history));
    refs.detail.replaceChildren(root);
    await renderTrustProfile(history, { dataManager, userId: person.userId, systems: state.systems, heading: false });
  }

  async function load() {
    refs.results.replaceChildren(el("p", "text-body-secondary mb-0", "Loading…"));
    try {
      if (state.mode === "listings") {
        state.listings = (await dataManager.listCommunityListings(state.filters.listings)).listings;
      } else {
        state.people = (await dataManager.listCommunityPeople(state.filters.people)).people;
      }
    } catch (error) {
      status.show(error.message || "Could not load results.", { type: "error" });
    }
    renderSortOptions();
    renderResults();
  }

  async function refresh() {
    renderModeToggle();
    await renderFilters();
    await load();
    refs.detail.replaceChildren(el("p", "text-body-secondary small mb-0", "Pick a listing or a person to see the details."));
  }

  refs.sort.addEventListener("change", () => {
    state.sort = refs.sort.value;
    renderResults();
  });

  async function boot() {
    state.reference = await loadCommunityReference();
    state.systems = await loadSystemChoices(dataManager);
    if (signedIn()) {
      try {
        state.mine = (await dataManager.getCommunityProfile()).profile?.scales || null;
      } catch (error) {
        state.mine = null;
      }
    }
    await refresh();
    const wanted = new URLSearchParams(window.location.search).get("listing");
    const match = wanted && state.listings.find((listing) => listing.id === wanted);
    if (match) {
      state.selectedId = match.id;
      renderResults();
      void renderListingDetail(match);
    }
  }

  boot().catch((error) => {
    console.error(error);
    status.show(error.message || "Could not load Find a Game.", { type: "error" });
  });
})();
