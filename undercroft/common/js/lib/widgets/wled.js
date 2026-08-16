// A control panel for WLED (https://kno.wled.ge) instances — table/room
// lighting rigs a GM points at the WLED JSON API directly from the browser
// (no server involvement; WLED's HTTP API is served by the device itself on
// the LAN and already allows cross-origin requests). Loosely rebuilt from an
// old standalone page (dnd/wled.htm + wled.json at the repo root) — that
// page hardcoded one GM's own physical rig (fixed segment ids/starts/stops,
// a personal preset list) directly into shared script, which doesn't belong
// in a suite-wide widget (see feedback_undercroft_avoid_hardcoding). This
// version reads segments/effects/palettes/presets live from whichever device
// is selected instead, so it works with any WLED instance's own
// configuration, not just one specific rig.
//
// Two persistence scopes, matching Clock's own instance-vs-shared split:
//  - The list of known devices ({type,ip,entityId,label}) is account-wide
//    (GM-tied, not per-widget-card) — dashboard.js owns it via
//    persistSetting, the same local+server merge-patch sync layout/
//    background use, passed in here as `devices`/`onDevicesChange`.
//  - Which device THIS card is currently showing/controlling is per-instance
//    state — small enough to live directly in this widget's own contentRef
//    (the same generic per-instance slot Clock/Calendar/Browser already
//    repurpose for "this instance's own config" — see clocks.js's own
//    comment), not a Library kind of its own. `multiple: true` in the
//    dashboard catalog — a GM with two lighting zones adds the widget twice,
//    each pointed at its own device.
//
// This widget generalized from "WLED control panel" to "Lighting" — a known
// device is now either a real WLED instance (type: "wled", its own rich
// segment/effect/palette JSON API, handled entirely in this file) or an HA
// `light.*` entity (type: "haLight", a much smaller on/off + brightness +
// color surface — see ha-light.js). Kept as two separate driver modules
// rather than merging their JSON shapes into one, since they don't share
// one; this file is the composer that picks which driver to call based on
// the selected device's own type. Follow-a-Clock and Advanced Mode stay
// WLED-only for now — extending either to HA lights is a reasonable later
// addition, not something either device type needs to function today.
import { el } from "../dom.js";
import { resolveActiveSpotlightId, resolveSpotlightData } from "../spotlight.js";
import { connectLiveStream } from "../live.js";
import { createReliableInterval } from "../reliable-interval.js";
import { listHaEntities, ensureHaConnection, manageHaConnection } from "./home-assistant.js";
import {
  fetchHaLightState,
  setHaLightPower,
  setHaLightBrightness,
  setHaLightColor,
  haLightSupportsBrightness,
  haLightSupportsColor,
} from "./ha-light.js";

// Phase 2 — "Follow a Clock": deliberately reuses the exact same spotlight/
// group-log transport every other follower in this suite already polls
// (Clock's own follower-of-itself, Combat Tracker's player-mode poll, ...)
// rather than a new same-page mechanism — see the plan this was built from
// for why a same-page-only bus would have duplicated existing plumbing for
// no reason. `followTarget` is always "active" for now (whichever Clock is
// currently spotlighted to the group) — resolved fresh via
// resolveActiveSpotlightId every poll, never a baked-in instance id.
const FOLLOW_POLL_INTERVAL_MS = 5000;

const DEFAULT_CONFIG = {
  // Absent/"wled" on any card saved before the Lighting generalization —
  // selectedIp being set is exactly what "wled" already implies, so no
  // migration step is needed for existing saved cards.
  selectedType: "wled",
  selectedIp: "",
  selectedEntityId: "",
  followEnabled: false,
  // "brightness" maps the clock's fill percentage onto master brightness;
  // "segments" lights up a prefix of followSegmentIds proportional to fill
  // — a real dot-clock look, not just a dimmer.
  followMode: "brightness",
  followSegmentIds: [],
};

function normalizeWledBase(raw) {
  const trimmed = (raw || "").trim();
  if (!trimmed) return "";
  const withProtocol = /^https?:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`;
  return withProtocol.replace(/\/+$/, "");
}

async function wledFetchJson(base, path) {
  const response = await fetch(`${base}${path}`, { method: "GET" });
  if (!response.ok) {
    throw new Error(`WLED returned ${response.status}`);
  }
  return response.json();
}

// POST to /json (not /json/state) — supported by every WLED version this
// widget might meet, unlike the newer /json/state-only shorthand. Also
// exactly what the Advanced/raw-JSON textarea below sends, so "basic"
// controls and "advanced" commands are the same request shape underneath.
async function wledPostState(base, body) {
  const response = await fetch(`${base}/json`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
  if (!response.ok) {
    throw new Error(`WLED returned ${response.status}`);
  }
  try {
    return await response.json();
  } catch (error) {
    return {};
  }
}

// Best-effort — a device with no presets saved (or an older firmware
// without this endpoint) just gets an empty preset list, not an error;
// presets are a bonus, not a required capability.
async function wledFetchPresets(base) {
  try {
    const presets = await wledFetchJson(base, "/presets.json");
    return presets && typeof presets === "object" ? presets : {};
  } catch (error) {
    return {};
  }
}

function icon(name) {
  const span = el("span", "iconify");
  span.dataset.icon = name;
  span.setAttribute("aria-hidden", "true");
  return span;
}

// `active` (e.g. a section toggle like Follow/Advanced Mode — see
// renderDeviceRow) swaps to the "pressed" (primary) variant and sets
// aria-pressed, so a toggle icon button reads its own current state the
// same way a plain action icon button (Refresh, Forget) always looks the
// same regardless of anything — one helper for both, not two near-
// duplicates.
function iconButton(name, label, { variant = "outline-secondary", size = "sm", active = false } = {}) {
  const button = el(
    "button",
    `btn btn-${size} btn-${active ? "primary" : variant} d-inline-flex align-items-center justify-content-center`
  );
  button.type = "button";
  button.setAttribute("aria-label", label);
  button.title = label;
  if (active) button.setAttribute("aria-pressed", "true");
  button.appendChild(icon(name));
  return button;
}

function rgbToHex([r, g, b]) {
  const clamp = (n) => Math.max(0, Math.min(255, Number(n) || 0));
  return `#${[clamp(r), clamp(g), clamp(b)].map((n) => n.toString(16).padStart(2, "0")).join("")}`;
}

function hexToRgb(hex) {
  const match = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex || "");
  if (!match) return [0, 0, 0];
  return [parseInt(match[1], 16), parseInt(match[2], 16), parseInt(match[3], 16)];
}

export function initWledWidget(
  container,
  { contentRef, setContentRef, setTitle, status, devices = [], onDevicesChange, dataManager, groupContext } = {}
) {
  if (!container) {
    return { destroy() {} };
  }

  let config = { ...DEFAULT_CONFIG, ...(contentRef || {}) };
  let deviceList = Array.isArray(devices) ? devices.slice() : [];
  let deviceState = null; // last full /json GET (state + info + effects + palettes) — WLED only
  let presets = {}; // id -> {n: name, ...} — WLED only
  let haLightState = null; // last {state, brightness, rgbColor, supportedColorModes, friendlyName} — HA light only
  // The Add-device form's own type toggle (WLED vs HA Light) — local UI
  // state, not persisted; defaults to whichever type the currently-selected
  // device already is, so re-opening the form to add a SECOND device of the
  // same kind doesn't require re-picking the type every time.
  let addDeviceType = "wled";
  let haEntityOptions = []; // populated lazily when the Add-device form switches to HA Light
  let haEntityLoadFailed = false; // distinguishes "still loading" from "the fetch actually failed" in the placeholder below
  // Which segment id(s) the Basic controls below apply to — empty means
  // "the device's own main segment" (WLED's own top-level bri/on/col/fx/pal
  // shorthand), matching the old page's identical seg-array-or-bare-field
  // branching.
  const targetSegmentIds = new Set();
  let loading = false;
  let loadError = "";
  let showAddDevice = false;
  let destroyed = false;
  // The Advanced section's own draft/expanded state, kept outside render()
  // — every render() call fully rebuilds the DOM (this widget's own
  // convention, same as most others in this suite), which would otherwise
  // wipe out an in-progress custom JSON command the moment an unrelated
  // Basic control (brightness, color, ...) triggered a refresh mid-edit.
  // A plain show/hide toggle button, not tied to any persisted setting —
  // unlike Follow (below), there's no "enabled" state to remember, just
  // whether the section is currently open.
  let advancedExpanded = false;
  let advancedDraft = "";
  // Follow-a-Clock's own poll/live-stream handles — only running while
  // config.followEnabled and a device is selected (see syncFollowWatch).
  let followTimer = null;
  let followLiveStream = null;
  // Dedupes identical clock states between polls so an unchanged clock
  // doesn't repeatedly re-POST the same brightness/segment state to the
  // device every 5s for no reason.
  let lastAppliedFollowKey = "";

  function persistInstanceConfig(patch) {
    config = { ...config, ...patch };
    if (typeof setContentRef === "function") setContentRef({ ...config });
  }

  function persistDevices(next) {
    deviceList = next;
    if (typeof onDevicesChange === "function") onDevicesChange(deviceList.slice());
  }

  function currentBase() {
    return normalizeWledBase(config.selectedIp);
  }

  function currentDeviceType() {
    return config.selectedType === "haLight" ? "haLight" : "wled";
  }

  // Dispatches to whichever driver the currently-selected device type
  // needs — WLED's own /json+presets fetch, or a single HA entity-state
  // read (ha-light.js). Both set loading/loadError/render the same way, so
  // every caller below (selectDevice, the manual Refresh button, sendRaw's
  // own post-command refresh) stays type-agnostic.
  async function refreshState({ silent = false } = {}) {
    if (currentDeviceType() === "haLight") {
      await refreshHaLightState({ silent });
      return;
    }
    await refreshWledState({ silent });
  }

  async function refreshHaLightState({ silent = false } = {}) {
    const entityId = config.selectedEntityId;
    if (!entityId) {
      haLightState = null;
      loadError = "";
      render();
      return;
    }
    if (!silent) {
      loading = true;
      loadError = "";
      render();
    }
    try {
      const state = await fetchHaLightState(dataManager, entityId);
      if (destroyed) return;
      if (!state) throw new Error(`Unable to reach "${entityId}" — check your Home Assistant connection.`);
      haLightState = state;
      loadError = "";
      if (typeof setTitle === "function") setTitle(state.friendlyName ? `— ${state.friendlyName}` : "");
    } catch (error) {
      if (destroyed) return;
      haLightState = null;
      loadError = (error && error.message) || "Unable to reach this light.";
    } finally {
      if (!destroyed) {
        loading = false;
        render();
      }
    }
  }

  async function refreshWledState({ silent = false } = {}) {
    const base = currentBase();
    if (!base) {
      deviceState = null;
      loadError = "";
      render();
      return;
    }
    if (!silent) {
      loading = true;
      loadError = "";
      render();
    }
    try {
      const [state, presetMap] = await Promise.all([wledFetchJson(base, "/json"), wledFetchPresets(base)]);
      if (destroyed) return;
      deviceState = state;
      presets = presetMap;
      loadError = "";
      const deviceName = state?.info?.name || "";
      if (typeof setTitle === "function") setTitle(deviceName ? `— ${deviceName}` : "");
    } catch (error) {
      if (destroyed) return;
      deviceState = null;
      loadError =
        (error && error.message) ||
        "Unable to reach this device. Check the IP/hostname, that it's powered on and on the same network, and that this page and WLED are loaded over the same protocol (http vs https).";
    } finally {
      if (!destroyed) {
        loading = false;
        render();
      }
    }
  }

  // Shared by every failable device request below — one place to surface a
  // network/HTTP error as a toast and refresh afterward, rather than each
  // call site repeating the same try/catch.
  async function sendRaw(body) {
    const base = currentBase();
    if (!base) return;
    try {
      await wledPostState(base, body);
      await refreshState({ silent: true });
    } catch (error) {
      status?.show?.(error?.message || "Unable to send command to WLED.", { type: "error", timeout: 3000 });
    }
  }

  // on/bri only — these have a real top-level/master meaning in WLED (the
  // overall device power and brightness multiplier), distinct from any one
  // segment's own on/bri. Falls back to per-segment when specific segments
  // are targeted, so toggling/dimming a selected segment doesn't affect the
  // whole device.
  async function sendCommand(fields) {
    const body = targetSegmentIds.size
      ? { seg: Array.from(targetSegmentIds).map((id) => ({ id, ...fields })) }
      : fields;
    await sendRaw(body);
  }

  // Effect/palette/color have NO top-level/master equivalent in WLED at
  // all — they're exclusively per-segment properties, always. This is why
  // the old dnd/wled.htm script this widget was rebuilt from only ever sent
  // these wrapped in a `seg` array, never bare (unlike on/bri above, which
  // it did send bare when nothing was selected). Sending them bare (as an
  // earlier version of this widget did) silently no-ops on real hardware —
  // confirmed live: the Effect dropdown changing nothing and reverting to
  // the prior value on refresh was exactly that bug. Defaults to the
  // device's own current main segment when nothing is explicitly targeted,
  // rather than doing nothing.
  async function sendSegmentCommand(fields) {
    const ids = targetSegmentIds.size ? Array.from(targetSegmentIds) : [mainSegment()?.id ?? 0];
    await sendRaw({ seg: ids.map((id) => ({ id, ...fields })) });
  }

  function mainSegment() {
    const segs = Array.isArray(deviceState?.state?.seg) ? deviceState.state.seg : [];
    if (!segs.length) return null;
    if (targetSegmentIds.size) {
      const firstId = Array.from(targetSegmentIds)[0];
      return segs.find((seg) => seg.id === firstId) || segs[0];
    }
    const mainIndex = Number.isFinite(deviceState?.state?.mainseg) ? deviceState.state.mainseg : 0;
    return segs[mainIndex] || segs[0];
  }

  // Translates a Clock's own posted config ({filled, segments, ...} — see
  // clocks.js's own DEFAULT_CONFIG) into a WLED command. "segments" mode
  // lights a prefix of config.followSegmentIds proportional to fill —
  // real dot-clock behavior, not just a dimmer; falls back to "brightness"
  // if no segments are assigned yet, so turning the feature on always does
  // *something* visible even before the GM picks specific segments.
  async function applyClockState(clockConfig) {
    const segments = Number(clockConfig?.segments) || 0;
    const filled = Math.max(0, Math.min(segments, Number(clockConfig?.filled) || 0));
    if (!segments) return;
    const key = `${filled}/${segments}/${config.followMode}/${config.followSegmentIds.join(",")}`;
    if (key === lastAppliedFollowKey) return;
    lastAppliedFollowKey = key;
    if (config.followMode === "segments" && config.followSegmentIds.length) {
      const ids = config.followSegmentIds;
      const onCount = Math.round((filled / segments) * ids.length);
      await sendRaw({ seg: ids.map((id, index) => ({ id, on: index < onCount })) });
    } else {
      const bri = Math.max(1, Math.round((filled / segments) * 255));
      await sendRaw({ bri });
    }
  }

  async function refreshFollow() {
    if (!config.followEnabled || !currentBase() || !dataManager || !groupContext?.groupId) return;
    try {
      const clockId = await resolveActiveSpotlightId(dataManager, {
        groupId: groupContext.groupId,
        shareToken: groupContext.shareToken,
        kind: "clock",
      });
      if (!clockId) return;
      const clockConfig = await resolveSpotlightData(dataManager, {
        groupId: groupContext.groupId,
        shareToken: groupContext.shareToken,
        kind: "clock",
        id: clockId,
      });
      if (clockConfig) await applyClockState(clockConfig);
    } catch (error) {
      // Best-effort — a missed poll just means the next one (5s later, or
      // the next group-log change) catches up.
    }
  }

  // Started/stopped whenever followEnabled or the selected device changes
  // — never runs at all with nothing to follow or nowhere to send it,
  // rather than polling pointlessly in the background.
  function syncFollowWatch() {
    if (followTimer) {
      followTimer.stop();
      followTimer = null;
    }
    if (followLiveStream) {
      followLiveStream.close();
      followLiveStream = null;
    }
    if (!config.followEnabled || !currentBase() || !dataManager || !groupContext?.groupId) return;
    lastAppliedFollowKey = "";
    void refreshFollow();
    // createReliableInterval (not plain setInterval) — same reasoning
    // clocks.js's own follower uses: a Dashboard tab can sit unfocused for
    // a whole session and plain setInterval was confirmed to stall there.
    followTimer = createReliableInterval(() => void refreshFollow(), FOLLOW_POLL_INTERVAL_MS);
    // The group log itself is the one live channel every inline-kind
    // follower watches (Clock has no dedicated "clock" live-stream kind of
    // its own) — matches clocks.js's own initFollowerClock exactly.
    followLiveStream = connectLiveStream({
      dataManager,
      groupId: groupContext.groupId,
      kinds: ["group_log"],
      shareToken: groupContext.shareToken,
    });
    followLiveStream.subscribe("group_log", () => void refreshFollow());
  }

  // A composite key so ONE <select> can list both device types without
  // colliding (a WLED IP and an HA entity id live in different namespaces
  // entirely) — encode/decode kept together so renderDeviceRow's population
  // and selectDevice's parsing can never drift out of sync with each other.
  function deviceKey(device) {
    return device.type === "haLight" ? `haLight::${device.entityId}` : `wled::${device.ip}`;
  }

  function currentSelectionKey() {
    return currentDeviceType() === "haLight" ? `haLight::${config.selectedEntityId || ""}` : `wled::${config.selectedIp || ""}`;
  }

  function hasSelection() {
    return currentDeviceType() === "haLight" ? Boolean(config.selectedEntityId) : Boolean(config.selectedIp);
  }

  function selectDevice(key) {
    const [type, id] = String(key || "").split("::");
    if (type === "haLight") {
      persistInstanceConfig({ selectedType: "haLight", selectedEntityId: id || "", selectedIp: "" });
    } else {
      persistInstanceConfig({ selectedType: "wled", selectedIp: id || "", selectedEntityId: "" });
    }
    targetSegmentIds.clear();
    deviceState = null;
    haLightState = null;
    void refreshState();
    syncFollowWatch();
  }

  function renderDeviceRow() {
    const row = el("div", "d-flex flex-wrap align-items-center gap-1");

    const select = document.createElement("select");
    select.className = "form-select form-select-sm";
    select.style.maxWidth = "14rem";
    const blank = document.createElement("option");
    blank.value = "";
    blank.textContent = deviceList.length ? "Select a device…" : "No devices saved yet";
    select.appendChild(blank);
    deviceList.forEach((device) => {
      const option = document.createElement("option");
      option.value = deviceKey(device);
      option.textContent = device.label || (device.type === "haLight" ? device.entityId : device.ip);
      select.appendChild(option);
    });
    select.value = hasSelection() ? currentSelectionKey() : "";
    select.addEventListener("change", () => selectDevice(select.value));
    row.appendChild(select);

    const addButton = iconButton("tabler:plus", "Add a device");
    addButton.addEventListener("click", () => {
      showAddDevice = !showAddDevice;
      addDeviceType = currentDeviceType();
      render();
    });
    row.appendChild(addButton);

    const refreshButton = iconButton("tabler:refresh", "Reconnect / refresh");
    refreshButton.disabled = !hasSelection();
    refreshButton.addEventListener("click", () => void refreshState());
    row.appendChild(refreshButton);

    const removeButton = iconButton("tabler:trash", "Forget this device", { variant: "outline-danger" });
    removeButton.disabled = !hasSelection();
    removeButton.addEventListener("click", () => {
      if (!hasSelection()) return;
      const key = currentSelectionKey();
      persistDevices(deviceList.filter((device) => deviceKey(device) !== key));
      persistInstanceConfig({ selectedIp: "", selectedEntityId: "" });
      deviceState = null;
      haLightState = null;
      syncFollowWatch();
      render();
    });
    row.appendChild(removeButton);

    // Section toggles live here too, on the same icon-button row, rather
    // than a separate row of their own — same active/pressed styling
    // iconButton already gives any toggle, just fewer rows competing for
    // space on a small widget card (see this widget's own render() for
    // what each one shows/hides). Both stay WLED-only for now — see this
    // file's own header comment on why HA lights don't get Follow/Advanced
    // yet.
    const isWledSelected = currentDeviceType() === "wled" && Boolean(config.selectedIp);
    const followButton = iconButton("tabler:clock", "Follow a Clock", { active: config.followEnabled });
    followButton.disabled = !isWledSelected;
    followButton.title = isWledSelected ? "Follow a Clock" : "Follow a Clock (WLED devices only)";
    followButton.addEventListener("click", () => {
      const next = !config.followEnabled;
      persistInstanceConfig({ followEnabled: next });
      syncFollowWatch();
      render();
    });
    row.appendChild(followButton);

    const advancedButton = iconButton("tabler:code", "Advanced Mode", { active: advancedExpanded });
    advancedButton.disabled = !isWledSelected;
    advancedButton.title = isWledSelected ? "Advanced Mode" : "Advanced Mode (WLED devices only)";
    advancedButton.addEventListener("click", () => {
      advancedExpanded = !advancedExpanded;
      render();
    });
    row.appendChild(advancedButton);

    return row;
  }

  // Two device types, two rows — a type toggle on its own line (WLED vs HA
  // light/group), then a second line that always holds the device
  // select/input, Label, and the +/x buttons together — a free-text IP
  // (WLED, unauthenticated LAN device, no directory to pick from) or a
  // populated select of live HA entities (HA has a real directory to pick
  // from, via listHaEntities — the "populated select" this widget's own
  // generalization was built around). Two separate rows, not one, since
  // type+device+label+buttons genuinely doesn't fit on one physical line at
  // this widget's normal card width — confirmed real problem trying it as
  // one row.
  function renderAddDeviceForm() {
    const form = el("div", "d-flex flex-column gap-1");

    const typeRow = el("div", "d-flex align-items-center gap-1");
    const typeSelect = document.createElement("select");
    typeSelect.className = "form-select form-select-sm";
    typeSelect.style.maxWidth = "12rem";
    [
      ["wled", "WLED"],
      ["haLight", "HA light/group"],
    ].forEach(([value, optionLabel]) => {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = optionLabel;
      option.selected = value === addDeviceType;
      typeSelect.appendChild(option);
    });
    typeSelect.addEventListener("change", () => {
      addDeviceType = typeSelect.value;
      render();
    });
    typeRow.appendChild(typeSelect);

    // Only when HA is the selected type — the one entry point for fixing a
    // wrong Home Assistant base URL or disconnecting entirely. Confirmed a
    // real gap without this: ensureHaConnection (invoked below when the
    // entity picker loads) only ever prompts once, the first time there's
    // no connection at all — once configured, however wrong, there was no
    // way back into that modal short of clearing the row directly in the
    // database.
    if (addDeviceType === "haLight") {
      const manageButton = el("button", "btn btn-sm btn-outline-secondary", "Manage connection");
      manageButton.type = "button";
      manageButton.addEventListener("click", () => void manageHaConnection({ dataManager, status }));
      typeRow.appendChild(manageButton);
    }
    form.appendChild(typeRow);

    const fieldsRow = el("div", "d-flex flex-wrap align-items-center gap-1");

    const labelInput = document.createElement("input");
    labelInput.type = "text";
    labelInput.className = "form-control form-control-sm";
    labelInput.style.maxWidth = "9rem";
    labelInput.placeholder = "Label (optional)";

    // WLED-only — this is the stable name a shared `wled`-type Macro action
    // references this device by (see runWledMacroAction below), not what
    // shows up in this dropdown. Keeping it separate from Label means
    // renaming how a device displays here never breaks a macro that already
    // references it. HA's own macro actions (home-assistant.js) target an
    // entityId directly — there's no alias-resolution step for them at all,
    // so an HA-light entry has nothing to put here.
    const aliasInput = document.createElement("input");
    aliasInput.type = "text";
    aliasInput.className = "form-control form-control-sm";
    aliasInput.style.maxWidth = "9rem";
    aliasInput.placeholder = "Macro alias (optional)";

    let confirmAdd = () => {};

    if (addDeviceType === "haLight") {
      const entitySelect = document.createElement("select");
      entitySelect.className = "form-select form-select-sm";
      entitySelect.style.maxWidth = "12rem";
      const populateEntitySelect = () => {
        const previous = entitySelect.value;
        entitySelect.innerHTML = "";
        const blank = document.createElement("option");
        blank.value = "";
        blank.textContent = haEntityOptions.length
          ? "Select a light…"
          : haEntityLoadFailed
            ? "Unable to load lights — see the error above"
            : "Loading…";
        entitySelect.appendChild(blank);
        haEntityOptions.forEach((entity) => {
          const option = document.createElement("option");
          option.value = entity.entityId;
          option.textContent = entity.friendlyName;
          option.selected = entity.entityId === previous;
          entitySelect.appendChild(option);
        });
      };
      populateEntitySelect();
      // Prompts to connect (ensureHaConnection's own modal) only if this
      // account hasn't already — a no-op resolve(true) otherwise, same
      // "connect once, remembered" flow every entry point into HA shares.
      void ensureHaConnection({ dataManager, status }).then((connected) => {
        if (!connected || destroyed) return;
        // "light" covers both a real HA Light Group helper AND a Hubitat
        // "Group Dimmer" virtual device (Hubitat's own driver for combining
        // several bulbs into one dimmer, synced into HA as an ordinary
        // light.* entity by the Hubitat integration — confirmed against a
        // real instance; this is what "Group Dimmer" in HA's UI turned out
        // to mean). "group" stays in the list defensively for HA's own
        // classic Group platform, which can expose a homogeneous group
        // under its own group.* domain instead.
        void listHaEntities(dataManager, { domainFilter: ["light", "group"], status }).then((entities) => {
          if (destroyed) return;
          haEntityOptions = entities;
          haEntityLoadFailed = entities.length === 0;
          populateEntitySelect();
        });
      });

      confirmAdd = () => {
        const entityId = entitySelect.value;
        if (!entityId) {
          status?.show?.("Pick a light first.", { type: "warning", timeout: 2400 });
          return;
        }
        if (deviceList.some((device) => device.type === "haLight" && device.entityId === entityId)) {
          status?.show?.("That device is already saved.", { type: "warning", timeout: 2400 });
          return;
        }
        // Falls back to HA's own friendly name (already fetched to build
        // this very picker) rather than the raw entityId — confirmed real
        // gap: leaving Label blank (its whole point being optional) meant
        // the device row/select showed "light.living_room_lamp" forever
        // instead of what the picker itself already displayed.
        const selectedEntity = haEntityOptions.find((entity) => entity.entityId === entityId);
        const label = labelInput.value.trim() || selectedEntity?.friendlyName || "";
        persistDevices([...deviceList, { type: "haLight", entityId, label }]);
        showAddDevice = false;
        selectDevice(`haLight::${entityId}`);
      };

      fieldsRow.append(entitySelect, labelInput);
    } else {
      const ipInput = document.createElement("input");
      ipInput.type = "text";
      ipInput.className = "form-control form-control-sm";
      ipInput.style.maxWidth = "10rem";
      ipInput.placeholder = "IP or hostname";

      confirmAdd = () => {
        const base = normalizeWledBase(ipInput.value);
        if (!base) {
          ipInput.focus();
          return;
        }
        if (deviceList.some((device) => device.type !== "haLight" && device.ip === base)) {
          status?.show?.("That device is already saved.", { type: "warning", timeout: 2400 });
          return;
        }
        const label = labelInput.value.trim();
        const alias = aliasInput.value.trim();
        persistDevices([...deviceList, { type: "wled", ip: base, label, alias }]);
        showAddDevice = false;
        selectDevice(`wled::${base}`);
      };

      fieldsRow.append(ipInput, labelInput, aliasInput);
    }

    // Delegated rather than per-input — covers whichever fields the branch
    // above actually added, without each one needing its own listener.
    // Excludes SELECT so Enter still navigates the entity dropdown normally
    // instead of submitting early.
    fieldsRow.addEventListener("keydown", (event) => {
      if (event.key === "Enter" && event.target.tagName !== "SELECT") {
        event.preventDefault();
        confirmAdd();
      }
    });

    const addButton = iconButton("tabler:plus", "Add", { variant: "primary" });
    addButton.addEventListener("click", () => confirmAdd());
    fieldsRow.appendChild(addButton);

    const cancelButton = iconButton("tabler:x", "Cancel");
    cancelButton.addEventListener("click", () => {
      showAddDevice = false;
      render();
    });
    fieldsRow.appendChild(cancelButton);

    form.appendChild(fieldsRow);
    return form;
  }

  function renderSegmentPicker() {
    const segs = Array.isArray(deviceState?.state?.seg) ? deviceState.state.seg : [];
    if (segs.length <= 1) return null;
    const wrap = el("div", "d-flex flex-column gap-1");
    wrap.appendChild(el("label", "small text-body-secondary mb-0", "Segments (none = main segment)"));
    const select = document.createElement("select");
    select.className = "form-select form-select-sm";
    select.multiple = true;
    select.size = Math.min(6, segs.length);
    segs.forEach((seg, index) => {
      const option = document.createElement("option");
      option.value = String(seg.id);
      option.textContent = seg.n || `Segment ${index}`;
      option.selected = targetSegmentIds.has(seg.id);
      select.appendChild(option);
    });
    select.addEventListener("change", () => {
      targetSegmentIds.clear();
      Array.from(select.selectedOptions).forEach((option) => targetSegmentIds.add(Number(option.value)));
      render();
    });
    wrap.appendChild(select);
    return wrap;
  }

  function renderWledBasicControls() {
    const seg = mainSegment();
    const isOn = targetSegmentIds.size ? Boolean(seg?.on) : Boolean(deviceState?.state?.on);
    const bri = targetSegmentIds.size ? seg?.bri ?? 128 : deviceState?.state?.bri ?? 128;

    const wrap = el("div", "d-flex flex-column gap-2");

    const powerBriRow = el("div", "d-flex align-items-center gap-2");
    const powerButton = el("button", `btn btn-sm ${isOn ? "btn-primary" : "btn-outline-secondary"}`, isOn ? "On" : "Off");
    powerButton.type = "button";
    powerButton.addEventListener("click", () => void sendCommand({ on: !isOn }));
    powerBriRow.appendChild(powerButton);
    const briInput = document.createElement("input");
    briInput.type = "range";
    briInput.min = "1";
    briInput.max = "255";
    briInput.value = String(bri);
    briInput.className = "form-range flex-grow-1";
    briInput.setAttribute("aria-label", "Brightness");
    briInput.addEventListener("change", () => void sendCommand({ bri: Number(briInput.value) }));
    powerBriRow.appendChild(briInput);
    wrap.appendChild(powerBriRow);

    const colors = Array.isArray(seg?.col) ? seg.col : [];
    const colorRow = el("div", "d-flex align-items-center gap-2");
    colorRow.appendChild(el("label", "small text-body-secondary mb-0", "Colors"));
    const colorInputs = [0, 1, 2].map((slot) => {
      const input = document.createElement("input");
      input.type = "color";
      input.className = "form-control form-control-color";
      input.value = colors[slot] ? rgbToHex(colors[slot]) : "#000000";
      input.title = ["Primary", "Secondary", "Tertiary"][slot];
      return input;
    });
    const commitColors = () => {
      void sendSegmentCommand({ col: colorInputs.map((input) => hexToRgb(input.value)) });
    };
    colorInputs.forEach((input) => {
      input.addEventListener("change", commitColors);
      colorRow.appendChild(input);
    });
    wrap.appendChild(colorRow);

    // id "0" is WLED's own "no preset" placeholder slot — never a real,
    // nameable preset, so it's excluded rather than shown as a blank entry.
    const presetEntries = Object.entries(presets).filter(([id, entry]) => id !== "0" && entry?.n);
    if (presetEntries.length) {
      const psRow = el("div", "d-flex flex-column gap-1");
      psRow.appendChild(el("label", "small text-body-secondary mb-0", "Preset"));
      const psSelect = document.createElement("select");
      psSelect.className = "form-select form-select-sm";
      const psBlank = document.createElement("option");
      psBlank.value = "";
      psBlank.textContent = "";
      psSelect.appendChild(psBlank);
      presetEntries.forEach(([id, entry]) => {
        const option = document.createElement("option");
        option.value = id;
        option.textContent = entry.n;
        option.selected = Number(id) === deviceState?.state?.ps;
        psSelect.appendChild(option);
      });
      // Presets apply device-wide in WLED (they can carry their own segment
      // config) — not re-targeted through targetSegmentIds the way the
      // controls above are.
      psSelect.addEventListener("change", () => {
        if (!psSelect.value) return;
        void sendRaw({ ps: Number(psSelect.value) });
      });
      psRow.appendChild(psSelect);
      wrap.appendChild(psRow);
    }

    const effects = Array.isArray(deviceState?.effects) ? deviceState.effects : [];
    const palettes = Array.isArray(deviceState?.palettes) ? deviceState.palettes : [];

    if (effects.length) {
      const fxRow = el("div", "d-flex flex-column gap-1");
      fxRow.appendChild(el("label", "small text-body-secondary mb-0", "Effect"));
      const fxSelect = document.createElement("select");
      fxSelect.className = "form-select form-select-sm";
      effects.forEach((name, index) => {
        const option = document.createElement("option");
        option.value = String(index);
        option.textContent = name;
        option.selected = index === (seg?.fx ?? -1);
        fxSelect.appendChild(option);
      });
      fxSelect.addEventListener("change", () => void sendSegmentCommand({ fx: Number(fxSelect.value) }));
      fxRow.appendChild(fxSelect);
      wrap.appendChild(fxRow);
    }

    if (palettes.length) {
      const palRow = el("div", "d-flex flex-column gap-1");
      palRow.appendChild(el("label", "small text-body-secondary mb-0", "Palette"));
      const palSelect = document.createElement("select");
      palSelect.className = "form-select form-select-sm";
      palettes.forEach((name, index) => {
        const option = document.createElement("option");
        option.value = String(index);
        option.textContent = name;
        option.selected = index === (seg?.pal ?? -1);
        palSelect.appendChild(option);
      });
      palSelect.addEventListener("change", () => void sendSegmentCommand({ pal: Number(palSelect.value) }));
      palRow.appendChild(palSelect);
      wrap.appendChild(palRow);
    }

    const segmentPicker = renderSegmentPicker();
    if (segmentPicker) wrap.appendChild(segmentPicker);

    return wrap;
  }

  function renderAdvancedSection() {
    const panel = el("div", "d-flex flex-column gap-2 mt-1");
    const textarea = document.createElement("textarea");
    textarea.className = "form-control form-control-sm font-monospace";
    textarea.rows = 4;
    textarea.placeholder = '{"seg":[{"id":0,"fx":8}]}';
    textarea.value = advancedDraft;
    textarea.addEventListener("input", () => {
      advancedDraft = textarea.value;
    });
    panel.appendChild(textarea);

    const buttonRow = el("div", "d-flex gap-2");
    const sendButton = el("button", "btn btn-sm btn-primary", "Send");
    sendButton.type = "button";
    sendButton.addEventListener("click", () => {
      let body;
      try {
        body = JSON.parse(textarea.value);
      } catch (error) {
        status?.show?.("That's not valid JSON.", { type: "error", timeout: 2400 });
        return;
      }
      void sendRaw(body);
    });
    buttonRow.appendChild(sendButton);

    const loadStateButton = el("button", "btn btn-sm btn-outline-secondary", "Load current state");
    loadStateButton.type = "button";
    loadStateButton.addEventListener("click", () => {
      advancedDraft = JSON.stringify(deviceState?.state || {}, null, 2);
      textarea.value = advancedDraft;
    });
    buttonRow.appendChild(loadStateButton);

    panel.appendChild(buttonRow);
    return panel;
  }

  // Only ever rendered while config.followEnabled is already true — the
  // top-level toggle button (see render()) IS the enable control now, so
  // there's no separate checkbox here anymore, just this section's own
  // mode/segment settings.
  function renderFollowSection() {
    const panel = el("div", "d-flex flex-column gap-2");

    if (!dataManager || !groupContext?.groupId) {
      panel.appendChild(
        el("div", "small text-body-secondary", "No active campaign — pick one from the Campaign menu to enable this.")
      );
      return panel;
    }

    const modeRow = el("div", "d-flex flex-column gap-1");
    modeRow.appendChild(el("label", "small text-body-secondary mb-0", "Mode"));
    const modeSelect = document.createElement("select");
    modeSelect.className = "form-select form-select-sm";
    [
      ["brightness", "Brightness (proportional to fill)"],
      ["segments", "Segments (dot-clock style)"],
    ].forEach(([value, label]) => {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = label;
      option.selected = config.followMode === value;
      modeSelect.appendChild(option);
    });
    modeSelect.addEventListener("change", () => {
      persistInstanceConfig({ followMode: modeSelect.value });
      // Forces the next poll to actually re-apply even though the clock's
      // own fill hasn't changed — otherwise switching modes would just sit
      // there showing the old mode's state until the clock itself ticks.
      lastAppliedFollowKey = "";
      void refreshFollow();
    });
    modeRow.appendChild(modeSelect);
    panel.appendChild(modeRow);

    if (config.followMode === "segments") {
      const segs = Array.isArray(deviceState?.state?.seg) ? deviceState.state.seg : [];
      if (!segs.length) {
        panel.appendChild(
          el("div", "small text-body-secondary", "Connect to this device above to choose which segments to use.")
        );
      } else {
        const segWrap = el("div", "d-flex flex-column gap-1");
        segWrap.appendChild(
          el("label", "small text-body-secondary mb-0", "Segments (filled left to right as the clock fills)")
        );
        const select = document.createElement("select");
        select.className = "form-select form-select-sm";
        select.multiple = true;
        select.size = Math.min(6, segs.length);
        segs.forEach((seg, index) => {
          const option = document.createElement("option");
          option.value = String(seg.id);
          option.textContent = seg.n || `Segment ${index}`;
          option.selected = config.followSegmentIds.includes(seg.id);
          select.appendChild(option);
        });
        select.addEventListener("change", () => {
          const ids = Array.from(select.selectedOptions).map((option) => Number(option.value));
          persistInstanceConfig({ followSegmentIds: ids });
          lastAppliedFollowKey = "";
          void refreshFollow();
        });
        segWrap.appendChild(select);
        panel.appendChild(segWrap);
      }
    }

    return panel;
  }

  // The HA-light equivalent of renderWledBasicControls above — deliberately
  // small: on/off, a brightness slider (0-255, same scale WLED's own slider
  // uses so nothing about the slider markup itself needed to change), and a
  // color picker only when haLightSupportsColor says this entity actually
  // reports a color-capable mode. No effects/palettes/presets/segments —
  // those are WLED-specific concepts with no HA equivalent; anything beyond
  // this common surface (a specific media_player command, a script/scene
  // trigger) belongs in the Macro system's own "Call a service" action
  // (home-assistant.js), not a live control here.
  // Every command below updates haLightState LOCALLY right after a
  // successful call, instead of re-fetching from HA — confirmed real bug
  // otherwise: HA's REST API accepts and returns from a service call before
  // the entity's own state has actually caught up (especially with a real
  // physical bulb reporting back), so an immediate re-fetch reads the STALE
  // value and the control shown is always one interaction behind what you
  // just did. Same "trust what we just told the device" reasoning WLED's
  // own sendRaw already uses, just genuinely necessary here rather than a
  // nice-to-have — WLED's own device applies+reports state synchronously
  // with no such lag. This can drift from the true state if something else
  // changes the light (an HA automation, another user) — the device row's
  // own Refresh button is the way back to a real read, same reconciliation
  // model WLED already relies on (it has no live-push either).
  function renderHaLightBasicControls() {
    const wrap = el("div", "d-flex flex-column gap-2");
    const entityId = config.selectedEntityId;
    const isOn = haLightState?.state === "on";
    const brightness = Number.isFinite(haLightState?.brightness) ? haLightState.brightness : 128;

    const powerBriRow = el("div", "d-flex align-items-center gap-2");
    const powerButton = el("button", `btn btn-sm ${isOn ? "btn-primary" : "btn-outline-secondary"}`, isOn ? "On" : "Off");
    powerButton.type = "button";
    powerButton.addEventListener("click", async () => {
      const nextOn = !isOn;
      try {
        await setHaLightPower(dataManager, entityId, nextOn);
        haLightState = { ...(haLightState || {}), state: nextOn ? "on" : "off" };
        render();
      } catch (error) {
        status?.show?.(error?.message || "Unable to send command to this light.", { type: "error", timeout: 3000 });
      }
    });
    powerBriRow.appendChild(powerButton);

    // Gated on the entity's own reported capability now, matching the color
    // picker's own gate just below — previously always shown regardless,
    // which meant a plain on/off entity (a switch-like group, no brightness
    // channel at all) got a slider that silently no-op'd on every move.
    if (haLightSupportsBrightness(haLightState)) {
      const briInput = document.createElement("input");
      briInput.type = "range";
      // 3, not HA's own raw-scale minimum of 1 — matches
      // setHaLightBrightness's own MIN_SAFE_BRIGHTNESS floor (ha-light.js);
      // the slider shouldn't offer a value that gets silently translated
      // into "off" downstream. See that constant's own comment for why.
      briInput.min = "3";
      briInput.max = "255";
      briInput.value = String(brightness);
      briInput.className = "form-range flex-grow-1";
      briInput.setAttribute("aria-label", "Brightness");

      // A plain inline label to the slider's own right, not a tooltip/
      // popup — a floating value bubble was tried first and confirmed a
      // real overflow bug (positioned by percentage, it could render
      // partway outside the widget/viewport at the high end and force a
      // scrollbar). A label in normal document flow has no positioning
      // math to get wrong. Percentage computed the same way HA's own
      // percent-based UI would (round(value/255*100)), so it matches what
      // HA's own dashboard would call the same level. Fixed width so the
      // slider itself doesn't visibly resize as the label's own text
      // width changes between "3%" and "100%".
      const brightnessPercent = (value) => Math.round((Number(value) / 255) * 100);
      const briLabel = el("span", "small text-body-secondary text-end", `${brightnessPercent(briInput.value)}%`);
      briLabel.style.minWidth = "2.5rem";
      briInput.addEventListener("input", () => {
        briLabel.textContent = `${brightnessPercent(briInput.value)}%`;
      });
      briInput.addEventListener("change", async () => {
        const nextBrightness = Number(briInput.value);
        try {
          await setHaLightBrightness(dataManager, entityId, nextBrightness);
          haLightState = { ...(haLightState || {}), state: "on", brightness: nextBrightness };
          render();
        } catch (error) {
          status?.show?.(error?.message || "Unable to send command to this light.", { type: "error", timeout: 3000 });
        }
      });
      powerBriRow.append(briInput, briLabel);
    }
    wrap.appendChild(powerBriRow);

    if (haLightSupportsColor(haLightState)) {
      const colorRow = el("div", "d-flex align-items-center gap-2");
      colorRow.appendChild(el("label", "small text-body-secondary mb-0", "Color"));
      const colorInput = document.createElement("input");
      colorInput.type = "color";
      colorInput.className = "form-control form-control-color";
      colorInput.value = Array.isArray(haLightState?.rgbColor) ? rgbToHex(haLightState.rgbColor) : "#ffffff";
      colorInput.addEventListener("change", async () => {
        const rgb = hexToRgb(colorInput.value);
        try {
          await setHaLightColor(dataManager, entityId, rgb);
          haLightState = { ...(haLightState || {}), state: "on", rgbColor: rgb };
          render();
        } catch (error) {
          status?.show?.(error?.message || "Unable to send command to this light.", { type: "error", timeout: 3000 });
        }
      });
      colorRow.appendChild(colorInput);
      wrap.appendChild(colorRow);
    }

    return wrap;
  }

  function render() {
    if (destroyed) return;
    container.innerHTML = "";
    const wrap = el("div", "d-flex flex-column gap-2 overflow-auto");
    wrap.style.minHeight = "0";

    wrap.appendChild(renderDeviceRow());
    if (showAddDevice) wrap.appendChild(renderAddDeviceForm());

    // The Follow/Advanced Mode toggle buttons themselves live on the
    // device row now (renderDeviceRow) — this just shows/hides each
    // section's own content in place, right where its toggle button is,
    // rather than a separate always-visible header row for a section that
    // might not even be in use. Both stay WLED-only (see this file's own
    // header comment).
    const isWledSelected = currentDeviceType() === "wled" && Boolean(config.selectedIp);
    if (isWledSelected && config.followEnabled) {
      wrap.appendChild(renderFollowSection());
    }

    if (loading) {
      wrap.appendChild(el("div", "small text-body-secondary", "Connecting…"));
    } else if (loadError) {
      wrap.appendChild(el("div", "small text-danger", loadError));
    } else if (!hasSelection() && currentDeviceType() === "wled") {
      wrap.appendChild(el("div", "small text-body-secondary", "Add a WLED device's IP address or hostname to get started."));
    } else if (currentDeviceType() === "haLight" && haLightState) {
      wrap.appendChild(renderHaLightBasicControls());
    } else if (currentDeviceType() === "wled" && deviceState) {
      wrap.appendChild(renderWledBasicControls());
    }

    if (isWledSelected && advancedExpanded) {
      wrap.appendChild(renderAdvancedSection());
    }

    container.appendChild(wrap);
  }

  // --- Macro action support (common/js/lib/widgets/macro-runner.js) ---
  // Reuses this instance's own sendRaw — the exact same call path the Basic
  // controls use — so a macro-triggered command both hits the device AND
  // refreshes deviceState/render() afterward, same as a manual click.
  // Confirmed real bug otherwise: running "Haunted Forest" turned the
  // physical lights on (the standalone fallback below still worked, since it
  // posts straight to the device), but this card kept showing "Off" — WLED
  // has no push/poll of its own to notice an EXTERNAL state change the way
  // Combat Tracker's periodic poll or Clock's spotlight-follow do, so
  // nothing here ever re-fetched until this existed. On/off/preset/
  // brightness send bare (never wrapped in `seg`, never scoped to whatever
  // segments this card's own UI happens to have selected right now —
  // targetSegmentIds is transient GM browsing state, not part of what the
  // macro author meant), matching runWledMacroAction's own standalone
  // payload shape exactly so both paths behave identically, mount-a-widget
  // or not.
  async function runMacroAction(action) {
    const params = action?.params || {};
    switch (action?.action) {
      case "on":
        await sendRaw({ on: true });
        return;
      case "off":
        await sendRaw({ on: false });
        return;
      case "preset":
        await sendRaw({ ps: Number(params.presetId) });
        return;
      case "brightness":
        await sendRaw({ bri: Number(params.value) });
        return;
      case "effect": {
        const segmentId = Number.isFinite(Number(params.segmentId)) ? Number(params.segmentId) : 0;
        await sendRaw({ seg: [{ id: segmentId, fx: Number(params.fx) }] });
        return;
      }
      default:
        throw new Error(`Unknown WLED macro action "${action?.action}".`);
    }
  }

  render();
  if (hasSelection()) void refreshState();
  syncFollowWatch();

  return {
    runMacroAction,
    destroy() {
      destroyed = true;
      if (followTimer) followTimer.stop();
      followLiveStream?.close();
      container.innerHTML = "";
    },
  };
}

// --- Macro action support (common/js/lib/widgets/macro-runner.js) ---
// Standalone — does not need a mounted widget instance at all, unlike the
// live widget above. Reuses the same wledPostState/normalizeWledBase this
// file's own instance already calls, so a macro-triggered command hits the
// device exactly the same way the live widget's own controls do.

export const WLED_MACRO_ACTIONS = {
  on: { label: "Turn on" },
  off: { label: "Turn off" },
  preset: { label: "Apply preset", params: ["presetId"] },
  brightness: { label: "Set brightness", params: ["value"] },
  effect: { label: "Set effect", params: ["fx", "segmentId"] },
};

// `alias` is deliberately separate from `label` — see this widget's own
// header comment. Exported so every reader of the account-wide device list
// (dashboard.js's own settings load, fetchWledDevices below) normalizes it
// exactly the same way, rather than each keeping its own copy of this
// filter/trim logic to drift out of sync. Handles both device types now —
// a WLED entry needs a real `ip`, an HA-light entry needs a real
// `entityId`; a bare/legacy entry (no `type` at all, from before the
// Lighting generalization) is treated as "wled", matching DEFAULT_CONFIG's
// own selectedType fallback.
export function normalizeWledDeviceList(list) {
  return Array.isArray(list)
    ? list
        .filter((entry) => {
          if (!entry) return false;
          if (entry.type === "haLight") return typeof entry.entityId === "string" && entry.entityId.trim();
          return typeof entry.ip === "string" && entry.ip.trim();
        })
        .map((entry) =>
          entry.type === "haLight"
            ? {
                type: "haLight",
                entityId: entry.entityId.trim(),
                label: typeof entry.label === "string" ? entry.label.trim() : "",
                alias: typeof entry.alias === "string" ? entry.alias.trim() : "",
              }
            : {
                type: "wled",
                ip: entry.ip.trim(),
                label: typeof entry.label === "string" ? entry.label.trim() : "",
                alias: typeof entry.alias === "string" ? entry.alias.trim() : "",
              }
        )
    : [];
}

// The account-wide WLED device list, fetched fresh — for callers with no
// already-loaded dashboard settings blob in hand to read it from (unlike
// dashboard.js's own loadWledDevices(serverSettings), which reads it out of
// the ONE settings fetch the whole Dashboard already does at boot).
// Confirmed real bug this exists to fix: a macro's WLED action run from a
// Journal page (journal-macro.js, via Repository directly or the Handout
// widget inside a Dashboard) had no wledDevices list to resolve its alias
// against at all — runMacro()'s own `wledDevices = []` default silently
// meant every alias looked unconfigured, even though the exact same macro
// ran fine from the Dashboard's own Macro board widget, which DOES pass
// its live list through. Same local+server merge-patch pattern every
// Dashboard setting uses (see dashboard.js's own persistSetting/
// loadWledDevices) — local storage is the only source once a device list
// is saved anonymously (never signed in), so this still works for that
// case, just without the "prefer the one already-fetched blob" shortcut
// dashboard.js itself gets to take.
const WLED_DEVICES_LOCAL_KEY = "undercroft.dashboard.wledDevices";
const WLED_DEVICES_SERVER_KEY = "dashboardWledDevices";

export async function fetchWledDevices(dataManager) {
  if (dataManager?.isAuthenticated?.()) {
    try {
      const settings = await dataManager.getUserSettings();
      if (Array.isArray(settings?.[WLED_DEVICES_SERVER_KEY])) {
        return normalizeWledDeviceList(settings[WLED_DEVICES_SERVER_KEY]);
      }
    } catch (error) {
      // Falls through to local storage below — better a possibly-stale
      // local copy than no device list at all.
    }
  }
  try {
    const raw = localStorage.getItem(WLED_DEVICES_LOCAL_KEY);
    return normalizeWledDeviceList(raw ? JSON.parse(raw) : null);
  } catch (error) {
    return [];
  }
}

// Exported so a macro-authoring/resolution UI (promptForWledAlias below,
// and macro-runner.js's own per-action check) can check ahead of time, not
// just react to a thrown error after the fact.
export function resolveWledDeviceByAlias(devices, alias) {
  const normalized = (alias || "").trim().toLowerCase();
  if (!normalized) return null;
  return (Array.isArray(devices) ? devices : []).find(
    (device) => (device.alias || "").trim().toLowerCase() === normalized
  ) || null;
}

// The write half of fetchWledDevices above — same two keys, same local-
// always/server-when-signed-in shape, so a device list saved from ANY
// caller (dashboard.js's own device manager, or promptForWledAlias below,
// invoked from a macro running anywhere: a Board widget card, a Journal
// page's inline `` `macro:...` `` chip viewed directly in Repository, a
// Handout) is readable by every other caller regardless of which one wrote
// it. dashboard.js's own persistWledDevices calls this too, rather than
// keeping a second, independently-typed copy of the same two key strings
// that could quietly drift out of sync with these.
export async function saveWledDevices(dataManager, devices) {
  const normalized = normalizeWledDeviceList(devices);
  try {
    localStorage.setItem(WLED_DEVICES_LOCAL_KEY, JSON.stringify(normalized));
  } catch (error) {
    // Local storage may be unavailable (private browsing, quota) — the
    // server sync below (when signed in) still gives this a home.
  }
  if (dataManager?.isAuthenticated?.()) {
    await dataManager.saveUserSettings({ [WLED_DEVICES_SERVER_KEY]: normalized });
  }
  return normalized;
}

const ALIAS_PROMPT_MODAL_ID = "undercroft-wled-alias-modal";

function ensureAliasPromptModal() {
  let modal = document.getElementById(ALIAS_PROMPT_MODAL_ID);
  if (modal) return modal;
  const wrapper = document.createElement("div");
  wrapper.innerHTML = `
    <div class="modal fade" id="${ALIAS_PROMPT_MODAL_ID}" tabindex="-1" aria-hidden="true">
      <div class="modal-dialog modal-dialog-centered">
        <div class="modal-content">
          <div class="modal-header">
            <h1 class="modal-title fs-5">Alias a WLED device</h1>
            <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Close"></button>
          </div>
          <div class="modal-body d-flex flex-column gap-2">
            <p class="small text-body-secondary mb-0" data-wled-alias-message></p>
            <select class="form-select" data-wled-alias-select></select>
          </div>
          <div class="modal-footer">
            <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Cancel</button>
            <button type="button" class="btn btn-primary" data-wled-alias-confirm>Save &amp; continue</button>
          </div>
        </div>
      </div>
    </div>
  `;
  const element = wrapper.firstElementChild;
  document.body.appendChild(element);
  return element;
}

// Prompts to map ONE unresolved alias to a known device, persists the
// updated device list (saveWledDevices above — durable regardless of which
// page/widget triggered this), and resolves to the updated list — or null
// if the GM cancelled, or there's nothing saved to pick from at all. Shared
// by every macro-running surface (macro-runner.js's own runMacro is the one
// caller today, checked once per distinct alias per run — see its own
// comment) so a macro referencing an unconfigured device alias never just
// fails with no way to fix it in the moment: the GM aliases it right here
// and the macro keeps going.
export async function promptForWledAlias({ dataManager, status, alias, devices }) {
  // WLED-only — an HA-light entry has no `.ip` at all, and this whole flow
  // (alias resolution for a `wled`-type macro action's own `target`) only
  // ever runs for that action type in the first place (see macro-runner.js's
  // own `if (action?.type === "wled")` gate), so an HA-light entry showing
  // up here would just be a broken, irrelevant option.
  const deviceList = normalizeWledDeviceList(devices).filter((device) => device.type !== "haLight");
  if (!deviceList.length) {
    status?.show?.(
      `No WLED device aliased "${alias}", and none saved to pick from yet — add one in the WLED widget first.`,
      { type: "warning", timeout: 4000 }
    );
    return null;
  }
  const modalElement = ensureAliasPromptModal();
  const modal =
    window.bootstrap && typeof window.bootstrap.Modal === "function"
      ? window.bootstrap.Modal.getOrCreateInstance(modalElement)
      : null;
  const messageEl = modalElement.querySelector("[data-wled-alias-message]");
  const select = modalElement.querySelector("[data-wled-alias-select]");
  const confirmButton = modalElement.querySelector("[data-wled-alias-confirm]");
  if (messageEl) {
    messageEl.textContent = `This macro references a WLED device aliased "${alias}", which isn't set up yet. Pick which saved device it should mean:`;
  }
  if (select) {
    select.innerHTML = "";
    deviceList.forEach((device) => {
      const option = document.createElement("option");
      option.value = device.ip;
      option.textContent = device.label || device.ip;
      select.appendChild(option);
    });
  }
  return new Promise((resolve) => {
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      confirmButton?.removeEventListener("click", onConfirm);
      modalElement.removeEventListener("hidden.bs.modal", onHidden);
      resolve(result);
    };
    const onConfirm = () => {
      const device = deviceList.find((entry) => entry.ip === select?.value);
      if (!device) {
        finish(null);
        return;
      }
      const updated = deviceList.map((entry) => (entry.ip === device.ip ? { ...entry, alias } : entry));
      modal?.hide();
      void saveWledDevices(dataManager, updated)
        .then(() => finish(updated))
        .catch((error) => {
          // Still resolved for THIS run even if the persist failed —
          // better to let the macro keep going than block it on a save
          // error the GM can't do anything about mid-scene.
          status?.show?.(error?.message || "Unable to save that alias.", { type: "error" });
          finish(updated);
        });
    };
    const onHidden = () => finish(null);
    confirmButton?.addEventListener("click", onConfirm);
    modalElement.addEventListener("hidden.bs.modal", onHidden);
    if (modal) {
      modal.show();
    } else {
      // No Bootstrap JS on the page (shouldn't happen anywhere in this
      // suite, but stay defensive rather than silently doing nothing) —
      // same fallback shape content-picker.js's own openContentPicker uses.
      finish(null);
    }
  });
}

export async function runWledMacroAction(action, { wledDevices = [], widgetInstance } = {}) {
  // Prefer routing through a live, mounted WLED card already pointed at the
  // resolved device (dashboard.js's ensureWidgetForMacroAction) — see that
  // card's own runMacroAction for why (state refresh). Falls back to the
  // standalone path below when there's no widget grid to route through at
  // all (a Journal-triggered macro, journal-macro.js) or ensureWidget wasn't
  // able to find/add a matching card — the physical device still gets the
  // command either way, just without a card on screen reflecting it.
  if (widgetInstance && typeof widgetInstance.runMacroAction === "function") {
    return widgetInstance.runMacroAction(action);
  }
  const device = resolveWledDeviceByAlias(wledDevices, action?.target);
  if (!device) {
    throw new Error(`No WLED device aliased "${action?.target || ""}".`);
  }
  const base = normalizeWledBase(device.ip);
  if (!base) {
    throw new Error(`The device aliased "${action.target}" has no valid IP/hostname.`);
  }
  const params = action?.params || {};
  switch (action?.action) {
    case "on":
      await wledPostState(base, { on: true });
      return;
    case "off":
      await wledPostState(base, { on: false });
      return;
    case "preset":
      await wledPostState(base, { ps: Number(params.presetId) });
      return;
    case "brightness":
      await wledPostState(base, { bri: Number(params.value) });
      return;
    case "effect": {
      const segmentId = Number.isFinite(Number(params.segmentId)) ? Number(params.segmentId) : 0;
      await wledPostState(base, { seg: [{ id: segmentId, fx: Number(params.fx) }] });
      return;
    }
    default:
      throw new Error(`Unknown WLED macro action "${action?.action}".`);
  }
}
