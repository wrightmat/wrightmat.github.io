import { initAppShell } from "./js/lib/app-shell.js";
import { DataManager, ROLE_ORDER, WRITE_ROLE_REQUIREMENTS, roleRank } from "./js/lib/data-manager.js";
import { resolveApiBase } from "./js/lib/api.js";
import { initAuthControls } from "./js/lib/auth-ui.js";
import { initHelpSystem, loadHelpTopics } from "./js/lib/help.js";
import { initFavoriteDocsPane } from "./js/lib/doc-favorites-pane.js";
import { mountInbox } from "./js/lib/chat/inbox.js";
import { mountProfileEditor } from "./js/lib/community/profile-editor.js";
import { renderMyGroups } from "./js/lib/community/my-groups.js";
import { renderEndorsePanel } from "./js/lib/community/endorse-panel.js";
import { confirmDelete } from "./js/lib/ownership.js";
import { initShareModal } from "./js/lib/share-modal.js";
import { showConfirmModal } from "./js/lib/confirm-modal.js";
import { disableForm, el } from "./js/lib/dom.js";
import {
  DICE_THEMES,
  DICE_THEME_NAMES,
  getThemeColorSupport,
  getThemeDefaultColor,
  previewDiceTheme,
} from "./js/lib/widgets/dice-overlay.js";

const { status } = initAppShell({
  namespace: "account",
  leftPane: { size: "lg", initial: "expanded" },
});
// No storagePrefix override — see dashboard.js's own comment on the same
// line: unifies this page's local record cache with the rest of the suite's
// default DataManager namespace, so a delete/save anywhere is visible everywhere.
const dataManager = new DataManager({ baseUrl: resolveApiBase() });
const auth = initAuthControls({ root: document, status, dataManager });
const shareModal = initShareModal({ dataManager, status });
initHelpSystem({ root: document });

const elements = {
  panel: document.querySelector("[data-admin-panel]"),
  gate: document.querySelector("[data-admin-gate]"),
  openLogin: document.querySelector("[data-admin-open-login]"),
  tabs: document.querySelector("[data-admin-tabs]"),
  tabButtons: Array.from(document.querySelectorAll("[data-admin-tab]")),
  tabPanels: Array.from(document.querySelectorAll("[data-admin-tab-panel]")),
  ownedTable: document.querySelector("[data-admin-owned-table]"),
  ownedBody: document.querySelector("[data-admin-owned-rows]"),
  ownedEmpty: document.querySelector("[data-admin-owned-empty]"),
  ownedSummary: document.querySelector("[data-admin-owned-summary]"),
  ownedUserSelect: document.querySelector("[data-admin-owned-user]"),
  ownedFilter: document.querySelector("[data-admin-owned-filter]"),
  ownedTypeSelect: document.querySelector("[data-admin-owned-type]"),
  ownedSortHeaders: Array.from(document.querySelectorAll("[data-admin-owned-sort]")),
  favoritesList: document.querySelector("[data-doc-favorites]"),
  inboxMount: document.querySelector("[data-account-inbox]"),
  profileMount: document.querySelector("[data-account-profile]"),
  myGroupsMount: document.querySelector("[data-account-my-groups]"),
  endorseMount: document.querySelector("[data-account-endorse]"),
  emailForm: document.querySelector("[data-admin-email-form]"),
  emailError: document.querySelector("[data-admin-email-error]"),
  emailInput: document.getElementById("admin-settings-email"),
  passwordForm: document.querySelector("[data-admin-password-form]"),
  revokeSessionsButton: document.querySelector("[data-admin-revoke-sessions]"),
  passwordError: document.querySelector("[data-admin-password-error]"),
  passwordConfirm: document.getElementById("admin-settings-password-confirm"),
  favoriteColorControl: document.querySelector("[data-favorite-color-control]"),
  favoriteColorInput: document.getElementById("admin-settings-favorite-color"),
  favoriteColorClear: document.querySelector("[data-favorite-color-clear]"),
  diceThemeSelect: document.querySelector("[data-dice-theme-select]"),
  diceColorControl: document.querySelector("[data-dice-color-control]"),
  diceColorInput: document.getElementById("admin-settings-dice-color"),
  diceColorReset: document.querySelector("[data-dice-color-reset]"),
  dicePreview: document.querySelector("[data-dice-preview]"),
  upgradeCurrent: document.querySelector("[data-upgrade-current]"),
  upgradeCards: document.querySelector("[data-upgrade-cards]"),
};

const TIER_OPTIONS = [
  { value: "free", label: "Free" },
  { value: "player", label: "Player" },
  { value: "gm", label: "GM" },
  { value: "creator", label: "Creator" },
  { value: "admin", label: "Admin" },
];

// Keyed by Library `kind` id (singular — "character", "template", "system"),
// matching list_owned_content()'s item.bucket directly. A kind not listed
// here falls back to its raw id — it still shows up in Owned Content, just
// without a prettier label.
const OWNED_TYPE_LABELS = {
  character: "Character",
  template: "Template",
  system: "System",
};

// The inverse of server/kinds.py's own _LEGACY_BUCKET_ALIASES:
// character/template/system predate the unified kind registry and still
// use plural DataManager bucket names everywhere else in the client, while
// item.bucket (from list_owned_content()) uses the singular kind id.
// WRITE_ROLE_REQUIREMENTS is keyed by the plural form, so this translates
// before looking it up.
const OWNER_BUCKET_ALIASES = { character: "characters", template: "templates", system: "systems" };

const TAB_SETTINGS = "settings";
const TAB_OWNED = "owned";
const TAB_INBOX = "inbox";
const TAB_PROFILE = "profile";
const AVAILABLE_TABS = [TAB_PROFILE, TAB_SETTINGS, TAB_INBOX, TAB_OWNED];

// Self-service upgrade targets only — "admin" is deliberately excluded (and
// rejected server-side regardless) since it can only be granted by an
// existing admin, never chosen here.
//
// TEMPORARY: prices are placeholders, not settled figures, and there's no
// billing integration yet (dataManager.upgradeTier applies the tier change
// for free today, immediately). A future payment-token check would slot in
// ahead of that call without changing this UI.
const TIER_UPGRADE_PLANS = [
  { value: "free", label: "Free", price: "Free", description: "A limited number of saves to your account." },
  { value: "player", label: "Player", price: "$10 one-time", description: "Unlimited saves of your characters and content." },
  { value: "gm", label: "GM", price: "$50 one-time", description: "Run live games: Combat Tracker, Show-to-table, Groups." },
  { value: "creator", label: "Creator", price: "$99 one-time", description: "Author and share Systems, Templates, and other reusable content." },
];

const dateFormatter = typeof Intl !== "undefined" && typeof Intl.DateTimeFormat === "function"
  ? new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" })
  : null;

const viewState = {
  activeTab: TAB_PROFILE,
  users: [],
  owned: {
    owner: null,
    items: [],
    selectedUsername: "",
    selectedType: "",
    loading: false,
    stale: true,
    sort: { key: "last_accessed_at", direction: "desc" },
  },
};

function isAdminSession() {
  const session = dataManager.session;
  return Boolean(session && session.user && session.user.tier === "admin");
}

function currentUser() {
  return dataManager.session?.user || null;
}

// Derived from data-manager.js's own WRITE_ROLE_REQUIREMENTS/ROLE_ORDER
// rather than a second hand-maintained tier list — an earlier independent
// OWNER_ROLE_REQUIREMENTS array had drifted out of sync with it (excluding
// "free" from character ownership, while WRITE_ROLE_REQUIREMENTS and
// character.json's own writeTier both agreed free tier can own one).
function tierMeetsOwnerRequirement(tier, bucket) {
  const requirement = WRITE_ROLE_REQUIREMENTS[OWNER_BUCKET_ALIASES[bucket] || bucket];
  if (!requirement) {
    return true;
  }
  const minRank = roleRank(requirement);
  if (minRank < 0) {
    return true;
  }
  return roleRank(tier) >= minRank;
}

function resolveTabFromHash() {
  const hash = window.location.hash ? window.location.hash.slice(1).toLowerCase() : "";
  return AVAILABLE_TABS.includes(hash) ? hash : TAB_PROFILE;
}

viewState.activeTab = resolveTabFromHash();

function showPanel() {
  if (elements.panel) {
    elements.panel.hidden = false;
  }
  if (elements.gate) {
    elements.gate.hidden = true;
  }
}

function showGate() {
  if (elements.panel) {
    elements.panel.hidden = true;
  }
  if (elements.gate) {
    elements.gate.hidden = false;
  }
}

function updateLocationHash(tab) {
  if (!window.history || typeof window.history.replaceState !== "function") {
    return;
  }
  const base = `${window.location.pathname}${window.location.search || ""}`;
  if (tab === TAB_PROFILE) {
    window.history.replaceState(null, "", base);
  } else {
    window.history.replaceState(null, "", `${base}#${tab}`);
  }
}

function setActiveTab(name, { updateHash = true, force = false } = {}) {
  const target = name;
  if (!force && viewState.activeTab === target) {
    if (updateHash) {
      updateLocationHash(target);
    }
    return;
  }
  viewState.activeTab = target;
  if (elements.tabButtons) {
    elements.tabButtons.forEach((button) => {
      if (!button) return;
      const tabName = button.getAttribute("data-admin-tab");
      const isActive = tabName === target;
      button.classList.toggle("active", isActive);
      button.setAttribute("aria-selected", isActive ? "true" : "false");
    });
  }
  if (elements.tabPanels) {
    elements.tabPanels.forEach((panel) => {
      if (!panel) return;
      const tabName = panel.getAttribute("data-admin-tab-panel");
      const isActive = tabName === target;
      panel.classList.toggle("show", isActive);
      panel.classList.toggle("active", isActive);
      panel.setAttribute("aria-hidden", isActive ? "false" : "true");
      panel.hidden = !isActive;
    });
  }
  if (updateHash) {
    updateLocationHash(target);
  }
  if (target === TAB_OWNED) {
    if (isAdminSession() && !viewState.users.length) {
      void loadUsers({ force: true });
    }
    populateOwnedUserFilter();
    loadOwnedContent();
  }
  if (target === TAB_INBOX && elements.inboxMount) {
    mountInbox(elements.inboxMount, { dataManager, status });
  }
  if (target === TAB_PROFILE && elements.profileMount && !dataManager.isAuthenticated()) {
    elements.profileMount.replaceChildren(el("p", "text-body-secondary mb-0", "Sign in to edit your profile."));
    elements.myGroupsMount?.replaceChildren();
    elements.endorseMount?.replaceChildren();
  } else if (target === TAB_PROFILE && elements.profileMount) {
    mountProfileEditor(elements.profileMount, { dataManager, status }).catch((error) => {
      status?.show(error.message || "Unable to load your profile.", { type: "error" });
    });
    if (elements.myGroupsMount) void renderMyGroups(elements.myGroupsMount, { dataManager, status });
    if (elements.endorseMount) void renderEndorsePanel(elements.endorseMount, { dataManager, status });
  }
}

// The tier cards in the right pane. Excludes "admin" by construction (TIER_UPGRADE_PLANS never lists it) —
// the server rejects it unconditionally too, so this is a UX nicety on top
// of a real enforced restriction, not the restriction itself.
function renderUpgrade() {
  if (!elements.upgradeCards) {
    return;
  }
  const user = currentUser();
  if (elements.upgradeCurrent) {
    elements.upgradeCurrent.textContent = user
      ? `Your current tier: ${formatTier(user.tier)}.`
      : "Sign in to change your tier.";
  }
  const userRank = user ? roleRank(user.tier) : -1;
  const fragment = document.createDocumentFragment();
  TIER_UPGRADE_PLANS.forEach((plan) => {
    const isCurrent = Boolean(user) && user.tier === plan.value;
    // Server-enforced too (upgrade_own_tier rejects any rank below the
    // user's current one) — disabling here is just the matching UX, not the
    // real restriction.
    const isBelowCurrent = Boolean(user) && !isCurrent && roleRank(plan.value) < userRank;
    const col = document.createElement("div");
    const card = document.createElement("div");
    card.className = `card${isCurrent ? " border-primary" : ""}`;
    const body = document.createElement("div");
    body.className = "card-body d-flex flex-column gap-2";

    const title = document.createElement("h4");
    title.className = "h6 mb-0 d-flex align-items-center justify-content-between";
    const titleLabel = document.createElement("span");
    titleLabel.textContent = plan.label;
    title.appendChild(titleLabel);
    if (isCurrent) {
      const badge = document.createElement("span");
      badge.className = "badge text-bg-primary";
      badge.textContent = "Current";
      title.appendChild(badge);
    }

    const price = document.createElement("div");
    price.className = "fw-semibold";
    price.textContent = plan.price;

    const description = document.createElement("p");
    description.className = "text-body-secondary small mb-0 flex-grow-1";
    description.textContent = plan.description;

    const button = document.createElement("button");
    button.type = "button";
    button.className = "btn btn-outline-primary btn-sm align-self-start";
    button.textContent = isCurrent
      ? "Current tier"
      : isBelowCurrent
        ? "Included in your tier"
        : `Upgrade to ${plan.label}`;
    button.disabled = isCurrent || isBelowCurrent || !user;
    button.addEventListener("click", () => void handleUpgradeClick(plan));

    body.append(title, price, description, button);
    card.appendChild(body);
    col.appendChild(card);
    fragment.appendChild(col);
  });
  elements.upgradeCards.replaceChildren(fragment);
}

async function handleUpgradeClick(plan) {
  const user = currentUser();
  if (!user) {
    return;
  }
  const confirmed = await showConfirmModal({
    title: `Upgrade to ${plan.label}?`,
    bodyHtml: `
      <p>Your account will upgrade from <strong>${formatTier(user.tier)}</strong> to <strong>${plan.label}</strong> (${plan.price}).</p>
      <p class="text-body-secondary small mb-0">Billing isn't live yet — this applies immediately, for free.</p>
    `,
    confirmLabel: `Upgrade to ${plan.label}`,
  });
  if (!confirmed) {
    return;
  }
  try {
    await dataManager.upgradeTier({ tier: plan.value });
    renderUpgrade();
    if (status) {
      status.show(`Upgraded to ${plan.label}`, { type: "success", timeout: 2000 });
    }
    if (auth && typeof auth.refreshDisplay === "function") {
      auth.refreshDisplay();
    }
  } catch (error) {
    if (status) {
      status.show(error.message || "Unable to switch tiers", { type: "danger" });
    }
  }
}

function populateSettings({ force = false } = {}) {
  const user = currentUser();
  // Lets a password manager tie the password fields to this account.
  document.querySelectorAll("[data-admin-username-hint]").forEach((input) => {
    input.value = user?.username || "";
  });
  if (elements.emailInput && (force || document.activeElement !== elements.emailInput)) {
    elements.emailInput.value = user?.email || "";
  }
  if (elements.emailForm) {
    const passwordField = elements.emailForm.querySelector("[name='password']");
    if (passwordField && (force || !document.activeElement || document.activeElement === passwordField)) {
      passwordField.value = "";
    }
  }
  if (elements.favoriteColorInput && (force || document.activeElement !== elements.favoriteColorInput)) {
    void loadFavoriteColor();
  }
  if (elements.diceThemeSelect && (force || document.activeElement !== elements.diceColorInput)) {
    void loadDiceSettings();
  }
}

// Static — every option comes from dice-overlay.js's curated DICE_THEMES,
// not anything user- or session-specific, so this only needs to run once.
function populateDiceThemeOptions() {
  const select = elements.diceThemeSelect;
  if (!select) {
    return;
  }
  const fragment = document.createDocumentFragment();
  DICE_THEMES.forEach(({ name, label }) => {
    const option = document.createElement("option");
    option.value = name;
    option.textContent = label;
    fragment.appendChild(option);
  });
  select.replaceChildren(fragment);
}

// Hides the whole color control for a theme getThemeColorSupport says
// can't be tinted at all — no point showing a control that would visibly
// do nothing. Unlike Favorite color below, there's no "unset" state here: a
// colorable theme's swatch always shows a real, already-meaningful value
// (the saved one, or getThemeDefaultColor), never a blank left for
// something else to invent silently later.
function refreshDiceColorVisibility(theme) {
  elements.diceColorControl?.classList.toggle("d-none", !getThemeColorSupport(theme));
}

async function loadDiceSettings() {
  if (!elements.diceThemeSelect || !dataManager.isAuthenticated()) {
    return;
  }
  let theme = "default";
  let themeColor = "";
  try {
    const settings = await dataManager.getUserSettings();
    if (DICE_THEME_NAMES.includes(settings?.diceSettings?.theme)) {
      theme = settings.diceSettings.theme;
    }
    if (typeof settings?.diceSettings?.themeColor === "string") {
      themeColor = settings.diceSettings.themeColor;
    }
  } catch (error) {
    // Falls through to the "default theme, its own default color" starting
    // point below either way.
  }
  elements.diceThemeSelect.value = theme;
  refreshDiceColorVisibility(theme);
  if (elements.diceColorInput) {
    elements.diceColorInput.value = themeColor || getThemeDefaultColor(theme);
  }
}

async function saveDiceSettings() {
  if (!dataManager.isAuthenticated()) {
    return;
  }
  const theme = elements.diceThemeSelect?.value || "default";
  const themeColor = getThemeColorSupport(theme) ? elements.diceColorInput?.value || "" : "";
  try {
    await dataManager.saveUserSettings({ diceSettings: { theme, themeColor } });
    status?.show("Dice appearance saved", { type: "success", timeout: 1500 });
  } catch (error) {
    status?.show(error.message || "Unable to save your dice appearance.", { type: "error" });
  }
}

// No default — deliberately NOT auto-saved or shown as "already chosen."
// .template-color-control--unset (the same checkerboard-X treatment
// color-picker.js uses for "nothing set") is the ONLY thing that stands in
// for a value here; the user has to actually pick a color for one to exist.
// Any tool can read it back via dataManager.getUserSettings() →
// .favoriteColor — no dedicated endpoint, just another key in the same
// general-purpose settings blob dashboardLayout/dashboardBackground share.
function setFavoriteColorUnset(isUnset) {
  elements.favoriteColorControl?.classList.toggle("template-color-control--unset", isUnset);
  if (elements.favoriteColorClear) {
    elements.favoriteColorClear.disabled = isUnset;
  }
}

async function loadFavoriteColor() {
  if (!elements.favoriteColorInput || !dataManager.isAuthenticated()) {
    return;
  }
  try {
    const settings = await dataManager.getUserSettings();
    if (typeof settings?.favoriteColor === "string" && settings.favoriteColor) {
      elements.favoriteColorInput.value = settings.favoriteColor;
      setFavoriteColorUnset(false);
      return;
    }
  } catch (error) {
    // Falls through to the unset state below either way.
  }
  setFavoriteColorUnset(true);
}

function formatTier(tier) {
  if (!tier) return "Free";
  const option = TIER_OPTIONS.find((item) => item.value === tier);
  return option ? option.label : tier;
}

function formatTimestamp(value, fallback = "Unknown") {
  if (!value) {
    return fallback;
  }
  let source = value;
  if (typeof source === "string" && source.includes(" ") && !source.includes("T")) {
    source = source.replace(" ", "T");
  }
  const date = new Date(source);
  if (Number.isNaN(date.getTime())) {
    return value || fallback;
  }
  return dateFormatter ? dateFormatter.format(date) : date.toLocaleString();
}

// Doesn't render a users table (that lives in Loom) — this just keeps
// viewState.users populated so buildOwnerOptions has the full user list to
// offer as ownership-transfer targets.
async function loadUsers({ force = false } = {}) {
  if (!isAdminSession()) {
    return;
  }
  if (!force && viewState.users.length) {
    return;
  }
  try {
    const payload = await dataManager.listUsers();
    const users = Array.isArray(payload?.users) ? payload.users : [];
    viewState.users = users;
    populateOwnedUserFilter();
    if (viewState.activeTab === TAB_OWNED) {
      renderOwnedItems(viewState.owned.items, viewState.owned.owner);
    }
  } catch (error) {
    if (status) {
      status.show(error.message || "Unable to load users", { type: "danger" });
    }
  }
}

function populateOwnedUserFilter() {
  if (!elements.ownedFilter) {
    return;
  }
  const admin = isAdminSession();
  elements.ownedFilter.classList.toggle("d-none", !admin);
  if (!admin) {
    if (elements.ownedUserSelect) {
      elements.ownedUserSelect.innerHTML = "";
    }
    viewState.owned.selectedUsername = "";
    return;
  }
  const select = elements.ownedUserSelect;
  if (!select) {
    return;
  }
  const selected = viewState.owned.selectedUsername === "__all__" ? "__all__" : "";
  const fragment = document.createDocumentFragment();
  const meOption = document.createElement("option");
  meOption.value = "";
  meOption.textContent = "Me";
  fragment.appendChild(meOption);
  const everyoneOption = document.createElement("option");
  everyoneOption.value = "__all__";
  everyoneOption.textContent = "Everyone";
  fragment.appendChild(everyoneOption);
  select.replaceChildren(fragment);
  select.value = selected;
  viewState.owned.selectedUsername = selected;
}

// Options come from whichever kinds are actually present in the current
// owned-content result set, not a hardcoded kind list — the suite's set of
// Library kinds is open-ended, and a filter option that would show an
// empty table isn't worth offering.
function populateOwnedTypeFilter() {
  const select = elements.ownedTypeSelect;
  if (!select) {
    return;
  }
  const previous = viewState.owned.selectedType;
  const buckets = Array.from(new Set(viewState.owned.items.map((item) => item.bucket).filter(Boolean))).sort((a, b) =>
    (OWNED_TYPE_LABELS[a] || a).localeCompare(OWNED_TYPE_LABELS[b] || b)
  );
  const fragment = document.createDocumentFragment();
  const allOption = document.createElement("option");
  allOption.value = "";
  allOption.textContent = "All types";
  fragment.appendChild(allOption);
  buckets.forEach((bucket) => {
    const option = document.createElement("option");
    option.value = bucket;
    option.textContent = OWNED_TYPE_LABELS[bucket] || bucket;
    fragment.appendChild(option);
  });
  select.replaceChildren(fragment);
  const stillValid = previous && buckets.includes(previous);
  select.value = stillValid ? previous : "";
  viewState.owned.selectedType = stillValid ? previous : "";
}

function setOwnedLoading(message = "Loading content…") {
  if (!elements.ownedBody) {
    return;
  }
  if (elements.ownedTable) {
    elements.ownedTable.hidden = false;
  }
  if (elements.ownedEmpty) {
    elements.ownedEmpty.hidden = true;
  }
  const row = document.createElement("tr");
  const cell = document.createElement("td");
  cell.colSpan = 6;
  cell.className = "text-center py-4 text-body-secondary";
  cell.textContent = message;
  row.appendChild(cell);
  elements.ownedBody.replaceChildren(row);
}

function showOwnedEmpty(message = "No saved content yet.") {
  if (elements.ownedTable) {
    elements.ownedTable.hidden = true;
  }
  if (elements.ownedEmpty) {
    elements.ownedEmpty.hidden = false;
    elements.ownedEmpty.textContent = message;
  }
  if (elements.ownedBody) {
    elements.ownedBody.innerHTML = "";
  }
}

function updateOwnedSummary(owner, itemCount = 0) {
  if (!elements.ownedSummary) {
    return;
  }
  if (!owner) {
    elements.ownedSummary.textContent = "";
    return;
  }
  const countLabel = itemCount === 1 ? "1 item" : `${itemCount} items`;
  const viewingEveryone = viewState.owned.selectedUsername === "__all__";
  if (viewingEveryone) {
    const subject = owner.display_name || owner.username || "everyone";
    elements.ownedSummary.textContent = `Viewing ${subject} — ${countLabel}.`;
    return;
  }
  const tierLabel = formatTier(owner.tier);
  const viewingSelf = !viewState.owned.selectedUsername || viewState.owned.selectedUsername === owner.username;
  const subject = viewingSelf ? "your account" : owner.username;
  elements.ownedSummary.textContent = `Viewing ${subject} (${tierLabel}) — ${countLabel}.`;
}

function describeOwnerOption(username, tier) {
  if (!username) {
    return "";
  }
  const base = `${username} (${formatTier(tier)})`;
  const current = currentUser();
  if (current && current.username === username) {
    return `${base} (You)`;
  }
  return base;
}

function buildOwnerOptions(bucket, currentOwner = { username: "", tier: "" }) {
  const options = [];
  const seen = new Set();
  const ownerUsername = currentOwner?.username || "";
  const ownerTier = currentOwner?.tier || "";
  if (ownerUsername) {
    options.push({ value: ownerUsername, label: describeOwnerOption(ownerUsername, ownerTier) });
    seen.add(ownerUsername);
  }
  if (!isAdminSession()) {
    return options;
  }
  const current = currentUser();
  if (current && !seen.has(current.username) && tierMeetsOwnerRequirement(current.tier, bucket)) {
    options.push({ value: current.username, label: describeOwnerOption(current.username, current.tier) });
    seen.add(current.username);
  }
  const eligibleUsers = viewState.users
    .filter((user) => user && user.username && tierMeetsOwnerRequirement(user.tier, bucket))
    .sort((a, b) => a.username.localeCompare(b.username, undefined, { sensitivity: "base" }));
  eligibleUsers.forEach((user) => {
    if (seen.has(user.username)) {
      return;
    }
    options.push({ value: user.username, label: describeOwnerOption(user.username, user.tier) });
    seen.add(user.username);
  });
  return options;
}

// `bucket` (from list_owned_content's `item.bucket`) is already the Library
// `kind` id directly (e.g. "species", "character", "template").
function ownedSortValue(item, key) {
  switch (key) {
    case "name":
      return (item.label || item.id || "").toLowerCase();
    case "type":
      return (OWNED_TYPE_LABELS[item.bucket] || item.bucket || "").toLowerCase();
    case "created_at":
    case "modified_at":
    case "last_accessed_at": {
      const raw = item[key] || "";
      if (!raw) {
        return 0;
      }
      const normalized = raw.includes(" ") && !raw.includes("T") ? raw.replace(" ", "T") : raw;
      const value = Date.parse(normalized);
      return Number.isNaN(value) ? 0 : value;
    }
    case "owner":
      return (viewState.owned.owner?.username || "").toLowerCase();
    default:
      return (item[key] || "").toString().toLowerCase();
  }
}

function sortOwnedItems(items) {
  const { key, direction } = viewState.owned.sort;
  const factor = direction === "desc" ? -1 : 1;
  return [...items].sort((a, b) => {
    const aValue = ownedSortValue(a, key);
    const bValue = ownedSortValue(b, key);
    if (aValue === bValue) {
      return 0;
    }
    if (typeof aValue === "number" && typeof bValue === "number") {
      return aValue > bValue ? factor : -factor;
    }
    return aValue > bValue ? factor : -factor;
  });
}

function updateOwnedSortIndicators() {
  if (!Array.isArray(elements.ownedSortHeaders)) {
    return;
  }
  const { key, direction } = viewState.owned.sort;
  elements.ownedSortHeaders.forEach((header) => {
    if (!header) {
      return;
    }
    const sortKey = header.getAttribute("data-admin-owned-sort");
    if (sortKey === key) {
      header.setAttribute("aria-sort", direction === "desc" ? "descending" : "ascending");
    } else {
      header.setAttribute("aria-sort", "none");
    }
  });
}

function defaultOwnedSortDirection(key) {
  if (key === "created_at" || key === "last_accessed_at" || key === "modified_at") {
    return "desc";
  }
  return "asc";
}

function setOwnedSort(key) {
  if (!key) {
    return;
  }
  if (viewState.owned.sort.key === key) {
    viewState.owned.sort.direction = viewState.owned.sort.direction === "asc" ? "desc" : "asc";
  } else {
    viewState.owned.sort = { key, direction: defaultOwnedSortDirection(key) };
  }
  renderOwnedItems(viewState.owned.items, viewState.owned.owner);
}

function renderOwnedItems(rawItems, owner) {
  if (!elements.ownedBody) {
    return;
  }
  const selectedType = viewState.owned.selectedType;
  const items = selectedType ? (rawItems || []).filter((item) => item.bucket === selectedType) : rawItems;
  if (!Array.isArray(items) || !items.length) {
    const viewingEveryone = viewState.owned.selectedUsername === "__all__";
    const message = viewingEveryone
      ? "No content available."
      : selectedType
        ? "No saved content of this type yet."
        : "No saved content yet.";
    showOwnedEmpty(message);
    updateOwnedSummary(owner, 0);
    updateOwnedSortIndicators();
    return;
  }
  if (elements.ownedTable) {
    elements.ownedTable.hidden = false;
  }
  if (elements.ownedEmpty) {
    elements.ownedEmpty.hidden = true;
  }
  const fragment = document.createDocumentFragment();
  const sortedItems = sortOwnedItems(items);
  sortedItems.forEach((item) => {
    const row = document.createElement("tr");

    const nameCell = document.createElement("td");
    const namePrimary = document.createElement("div");
    namePrimary.className = "fw-semibold";
    namePrimary.textContent = item.label || item.id;
    const nameSecondary = document.createElement("div");
    nameSecondary.className = "text-body-secondary small";
    nameSecondary.textContent = item.id;
    nameCell.appendChild(namePrimary);
    nameCell.appendChild(nameSecondary);

    const typeCell = document.createElement("td");
    typeCell.textContent = OWNED_TYPE_LABELS[item.bucket] || item.bucket;

    const createdCell = document.createElement("td");
    createdCell.textContent = formatTimestamp(item.created_at, "Unknown");

    const accessedCell = document.createElement("td");
    accessedCell.textContent = formatTimestamp(item.last_accessed_at, "Never");

    const shareCell = document.createElement("td");
    shareCell.className = "text-end";
    const ownerCell = document.createElement("td");
    ownerCell.className = "text-end";

    const ownerRow = document.createElement("div");
    ownerRow.className = "d-flex flex-wrap justify-content-end gap-2 align-items-center";
    const ownerSelect = document.createElement("select");
    ownerSelect.className = "form-select form-select-sm w-auto";
    ownerSelect.setAttribute("aria-label", `Change owner for ${item.label || item.id}`);
    const currentOwnerUsername = item.owner_username || owner?.username || "";
    const currentOwnerTier = item.owner_tier || owner?.tier || "";
    const shareButton = document.createElement("button");
    shareButton.type = "button";
    shareButton.className = "btn btn-outline-primary btn-sm";
    shareButton.textContent = "Share";
    shareButton.addEventListener("click", () => {
      shareModal.open({
        bucket: item.bucket,
        id: item.id,
        label: item.label || item.id,
        typeLabel: OWNED_TYPE_LABELS[item.bucket] || item.bucket,
      });
    });

    shareCell.appendChild(shareButton);

    const ownerOptions = buildOwnerOptions(item.bucket, { username: currentOwnerUsername, tier: currentOwnerTier });
    ownerOptions.forEach((option) => {
      const opt = document.createElement("option");
      opt.value = option.value;
      opt.textContent = option.label;
      if (option.disabled) {
        opt.disabled = true;
      }
      if (option.value === currentOwnerUsername) {
        opt.selected = true;
      }
      ownerSelect.appendChild(opt);
    });
    if (!ownerOptions.length) {
      const opt = document.createElement("option");
      opt.value = "";
      opt.textContent = currentOwnerUsername ? describeOwnerOption(currentOwnerUsername, currentOwnerTier) : "Unassigned";
      opt.selected = true;
      opt.disabled = true;
      ownerSelect.appendChild(opt);
    }
    ownerSelect.value = currentOwnerUsername;
    ownerSelect.disabled = !isAdminSession() || ownerOptions.length <= 1;

    const deleteButton = document.createElement("button");
    deleteButton.type = "button";
    deleteButton.className = "btn btn-outline-danger btn-sm";
    deleteButton.textContent = "Delete";

    if (isAdminSession()) {
      ownerSelect.addEventListener("change", async () => {
        const selected = ownerSelect.value;
        if (!selected || selected === currentOwnerUsername) {
          ownerSelect.value = currentOwnerUsername;
          return;
        }
        ownerSelect.disabled = true;
        deleteButton.disabled = true;
        try {
          await dataManager.updateContentOwner(item.bucket, item.id, selected);
          if (status) {
            status.show(`Transferred ownership to ${selected}.`, { type: "success", timeout: 2000 });
          }
          await loadOwnedContent({ refresh: true });
        } catch (error) {
          console.error("Failed to change owner", error);
          if (status) {
            status.show(error.message || "Unable to update owner", { type: "danger" });
          }
          ownerSelect.value = currentOwnerUsername;
          ownerSelect.disabled = false;
          deleteButton.disabled = false;
        }
      });
    }

    deleteButton.addEventListener("click", async () => {
      const typeLabel = OWNED_TYPE_LABELS[item.bucket] || item.bucket;
      if (!confirmDelete({ label: `this ${typeLabel.toLowerCase()}` })) {
        return;
      }
      deleteButton.disabled = true;
      ownerSelect.disabled = true;
      try {
        await dataManager.delete(item.bucket, item.id, { mode: "remote" });
        if (status) {
          status.show(`${typeLabel} deleted.`, { type: "success", timeout: 2000 });
        }
        await loadOwnedContent({ refresh: true });
      } catch (error) {
        console.error("Failed to delete content", error);
        if (status) {
          status.show(error.message || "Unable to delete content", { type: "danger" });
        }
        deleteButton.disabled = false;
        ownerSelect.disabled = !isAdminSession() || ownerOptions.length <= 1;
      }
    });

    ownerRow.appendChild(ownerSelect);
    ownerRow.appendChild(deleteButton);

    ownerCell.appendChild(ownerRow);

    row.appendChild(nameCell);
    row.appendChild(typeCell);
    row.appendChild(createdCell);
    row.appendChild(accessedCell);
    row.appendChild(shareCell);
    row.appendChild(ownerCell);
    fragment.appendChild(row);
  });

  elements.ownedBody.replaceChildren(fragment);
  updateOwnedSummary(owner, items.length);
  updateOwnedSortIndicators();
}

function isViewingCurrentUser() {
  const current = currentUser();
  if (!current) {
    return false;
  }
  if (viewState.owned.selectedUsername === "__all__") {
    return false;
  }
  return !viewState.owned.selectedUsername || viewState.owned.selectedUsername === current.username;
}

async function loadOwnedContent({ refresh = false } = {}) {
  if (!elements.ownedBody) {
    return;
  }
  if (!dataManager.isAuthenticated()) {
    viewState.owned.owner = null;
    viewState.owned.items = [];
    viewState.owned.stale = true;
    showOwnedEmpty("Sign in to see your saved content.");
    updateOwnedSummary(null, 0);
    updateOwnedSortIndicators();
    return;
  }
  if (viewState.owned.loading) {
    return;
  }
  viewState.owned.loading = true;
  const shouldRefresh = refresh || viewState.owned.stale;
  if (shouldRefresh || !viewState.owned.items.length) {
    setOwnedLoading();
  }
  const viewingEveryone = viewState.owned.selectedUsername === "__all__";
  const username = viewingEveryone ? "" : viewState.owned.selectedUsername || "";
  const scope = viewingEveryone ? "all" : "";
  try {
    const payload = await dataManager.listOwnedContent({ username, scope, refresh: shouldRefresh });
    const owner = payload?.owner || null;
    const items = Array.isArray(payload?.items) ? payload.items : [];
    viewState.owned.owner = owner;
    viewState.owned.items = items;
    viewState.owned.stale = false;
    populateOwnedTypeFilter();
    renderOwnedItems(items, owner);
  } catch (error) {
    console.error("Failed to load owned content", error);
    if (status) {
      status.show(error.message || "Unable to load content", { type: "danger" });
    }
    setOwnedLoading("Unable to load content");
    updateOwnedSortIndicators();
  } finally {
    viewState.owned.loading = false;
  }
}

function handleOwnedContentEvent() {
  if (!dataManager.isAuthenticated()) {
    return;
  }
  const viewingEveryone = viewState.owned.selectedUsername === "__all__";
  const relevant = isViewingCurrentUser() || viewingEveryone;
  if (!relevant) {
    return;
  }
  if (viewState.activeTab === TAB_OWNED) {
    loadOwnedContent({ refresh: true });
  } else {
    viewState.owned.stale = true;
  }
}

if (elements.openLogin && auth) {
  elements.openLogin.addEventListener("click", () => auth.showLogin());
}

function setEmailError(message = "") {
  if (elements.emailError) {
    elements.emailError.textContent = message;
  }
}

function setPasswordError(message = "") {
  if (elements.passwordError) {
    elements.passwordError.textContent = message;
  }
}


function handleAuthChanged() {
  renderUpgrade();
  const user = currentUser();
  if (user) {
    showPanel();
    populateSettings({ force: true });
    if (isAdminSession()) {
      void loadUsers({ force: true });
    }
    populateOwnedUserFilter();
    viewState.owned.selectedUsername = "";
    viewState.owned.stale = true;
    loadOwnedContent({ refresh: true });
    setActiveTab(resolveTabFromHash(), { updateHash: false, force: true });
  } else {
    showGate();
    viewState.users = [];
    viewState.owned.owner = null;
    viewState.owned.items = [];
    viewState.owned.selectedUsername = "";
    viewState.owned.stale = true;
    populateOwnedUserFilter();
    showOwnedEmpty("Sign in to see your saved content.");
    updateOwnedSummary(null, 0);
    setActiveTab(TAB_PROFILE, { updateHash: false, force: true });
  }
}

window.addEventListener("undercroft:auth-changed", () => {
  handleAuthChanged();
});

window.addEventListener("hashchange", () => {
  setActiveTab(resolveTabFromHash(), { updateHash: false });
});

if (elements.tabs) {
  elements.tabs.addEventListener("click", (event) => {
    const button = event.target.closest("[data-admin-tab]");
    if (!button) {
      return;
    }
    const tab = button.getAttribute("data-admin-tab") || TAB_PROFILE;
    setActiveTab(tab, { updateHash: true });
  });
}

if (elements.ownedUserSelect) {
  elements.ownedUserSelect.addEventListener("change", () => {
    viewState.owned.selectedUsername = elements.ownedUserSelect.value || "";
    viewState.owned.stale = true;
    loadOwnedContent({ refresh: true });
  });
}

if (elements.ownedTypeSelect) {
  elements.ownedTypeSelect.addEventListener("change", () => {
    viewState.owned.selectedType = elements.ownedTypeSelect.value || "";
    renderOwnedItems(viewState.owned.items, viewState.owned.owner);
  });
}

if (Array.isArray(elements.ownedSortHeaders)) {
  elements.ownedSortHeaders.forEach((header) => {
    if (!header) {
      return;
    }
    header.addEventListener("click", () => {
      const key = header.getAttribute("data-admin-owned-sort");
      setOwnedSort(key);
    });
    header.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        const key = header.getAttribute("data-admin-owned-sort");
        setOwnedSort(key);
      }
    });
  });
}

updateOwnedSortIndicators();

if (elements.favoriteColorInput) {
  elements.favoriteColorInput.addEventListener("change", async () => {
    if (!dataManager.isAuthenticated()) {
      return;
    }
    setFavoriteColorUnset(false);
    try {
      await dataManager.saveUserSettings({ favoriteColor: elements.favoriteColorInput.value });
      status?.show("Favorite color saved", { type: "success", timeout: 1500 });
    } catch (error) {
      status?.show(error.message || "Unable to save your favorite color.", { type: "error" });
    }
  });
}

if (elements.favoriteColorClear) {
  elements.favoriteColorClear.addEventListener("click", async () => {
    if (!dataManager.isAuthenticated()) {
      return;
    }
    setFavoriteColorUnset(true);
    try {
      // "" (not deleting the key) — saveUserSettings is a merge-patch, and
      // the read side above already treats a falsy favoriteColor exactly
      // like a missing one, so this is an explicit "user chose to clear
      // this," not silent data loss.
      await dataManager.saveUserSettings({ favoriteColor: "" });
      status?.show("Favorite color cleared", { type: "info", timeout: 1500 });
    } catch (error) {
      status?.show(error.message || "Unable to clear your favorite color.", { type: "error" });
    }
  });
}

populateDiceThemeOptions();

if (elements.diceThemeSelect) {
  elements.diceThemeSelect.addEventListener("change", () => {
    const theme = elements.diceThemeSelect.value;
    refreshDiceColorVisibility(theme);
    // Switching themes always resets the swatch to THIS theme's own default
    // color — never a blank, and never the previous theme's color carried
    // over somewhere it was never chosen for.
    if (elements.diceColorInput) {
      elements.diceColorInput.value = getThemeDefaultColor(theme);
    }
    void saveDiceSettings();
  });
}

if (elements.diceColorInput) {
  elements.diceColorInput.addEventListener("change", () => void saveDiceSettings());
}

if (elements.diceColorReset) {
  elements.diceColorReset.addEventListener("click", () => {
    if (elements.diceColorInput) {
      elements.diceColorInput.value = getThemeDefaultColor(elements.diceThemeSelect?.value || "default");
    }
    void saveDiceSettings();
  });
}

if (elements.dicePreview) {
  elements.dicePreview.addEventListener("click", async () => {
    const theme = elements.diceThemeSelect?.value || "default";
    const themeColor = getThemeColorSupport(theme) ? elements.diceColorInput?.value || "" : "";
    const ok = await previewDiceTheme(theme, themeColor);
    if (!ok) {
      status?.show("Unable to preview that theme right now.", { type: "error" });
    }
  });
}

if (elements.emailForm) {
  elements.emailForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    setEmailError("");
    const formData = new FormData(elements.emailForm);
    const email = String(formData.get("email") || "").trim();
    const password = String(formData.get("password") || "");
    const user = currentUser();
    if (!email) {
      setEmailError("Email is required");
      return;
    }
    if (user && email.toLowerCase() === String(user.email || "").toLowerCase()) {
      setEmailError("That is already your email address");
      return;
    }
    if (!password) {
      setEmailError("Password is required");
      return;
    }
    disableForm(elements.emailForm, true);
    try {
      const result = await dataManager.updateEmail({ email, password });
      if (result && result.user) {
        populateSettings({ force: true });
        if (status) {
          status.show("Email updated", { type: "success", timeout: 2000 });
        }
        if (auth && typeof auth.refreshDisplay === "function") {
          auth.refreshDisplay();
        }
      }
    } catch (error) {
      setEmailError(error.message || "Unable to update email");
    } finally {
      disableForm(elements.emailForm, false);
      const passwordField = elements.emailForm.querySelector("[name='password']");
      if (passwordField) {
        passwordField.value = "";
      }
    }
  });
}

elements.revokeSessionsButton?.addEventListener("click", async () => {
  try {
    await dataManager.revokeOtherSessions();
    status?.show("Signed out of your other devices.", { type: "success", timeout: 2500 });
  } catch (error) {
    status?.show(error.message || "Unable to sign out other devices.", { type: "error" });
  }
});

if (elements.passwordForm) {
  elements.passwordForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    setPasswordError("");
    const formData = new FormData(elements.passwordForm);
    const currentPassword = String(formData.get("current_password") || "");
    const newPassword = String(formData.get("new_password") || "");
    const confirmPassword = String(formData.get("confirm_password") || "");
    if (!currentPassword) {
      setPasswordError("Current password is required");
      return;
    }
    if (newPassword.length < 10) {
      setPasswordError("New password must be at least 10 characters long");
      return;
    }
    if (newPassword !== confirmPassword) {
      setPasswordError("New passwords do not match");
      return;
    }
    disableForm(elements.passwordForm, true);
    try {
      await dataManager.updatePassword({ current_password: currentPassword, new_password: newPassword });
      elements.passwordForm.reset();
      if (status) {
        status.show("Password updated", { type: "success", timeout: 2000 });
      }
    } catch (error) {
      setPasswordError(error.message || "Unable to change password");
    } finally {
      disableForm(elements.passwordForm, false);
    }
  });
}

// ===== Favorite documentation (left pane) ====================================
initFavoriteDocsPane({
  list: elements.favoritesList,
  dataManager,
  topicsUrl: "data/help-topics.json",
  docsHref: "docs.html",
});

window.addEventListener("workbench:content-saved", handleOwnedContentEvent);
window.addEventListener("workbench:content-deleted", handleOwnedContentEvent);

handleAuthChanged();
