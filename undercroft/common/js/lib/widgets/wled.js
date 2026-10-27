// A control panel for WLED (https://kno.wled.ge) instances — table/room
// lighting rigs a GM points at the WLED JSON API directly from the browser
// (no server involvement; WLED's HTTP API is served by the device itself on
// the LAN and already allows cross-origin requests). Reads segments/
// effects/palettes/presets live from whichever device is selected, so it
// works with any WLED instance's configuration, not one hardcoded rig.
//
// Two persistence scopes, matching Clock's own instance-vs-shared split:
//  - The list of known devices ({type,ip,entityId,label}) is account-wide
//    (GM-tied, not per-widget-card) — dashboard.js owns it via
//    persistSetting, the same local+server merge-patch sync layout/
//    background use, passed in here as `devices`/`onDevicesChange`.
//  - Which device THIS card is showing/controlling is per-instance state —
//    small enough to live directly in this widget's own contentRef (the
//    same generic per-instance slot Clock/Calendar/Browser repurpose), not
//    a Library kind of its own. `multiple: true` in the dashboard catalog —
//    a GM with two lighting zones adds the widget twice, each pointed at
//    its own device.
//
// This widget generalized from "WLED control panel" to "Lighting" — a known
// device is now either a real WLED instance (type: "wled", its own rich
// segment/effect/palette JSON API) or an HA `light.*` entity (type:
// "haLight", a much smaller on/off + brightness + color surface — see
// ha-light.js). Kept as two separate driver modules since they share no
// JSON shape; this file is the composer that picks which driver to call
// based on the selected device's type. Follow-a-Clock and the Advanced
// section stay WLED-only for now. Live Poll (below) is the reverse case — HA-only,
// since only an HA light's state can change from outside this widget
// entirely (a physical switch, another HA automation); a WLED device only
// changes because this widget told it to, so there's nothing external for
// a WLED card to poll for.
import { el } from "../dom.js";
import { MIN_BRIGHTNESS } from "./wled-look-fields.js";
import { parseEffectMeta } from "./wled-effects.js";
import { createWledControl } from "./wled-control.js";
import { createCollapseToggleButton, setElementCollapsed } from "../collapsible.js";
import { disposeTooltips, refreshTooltips, setDisabledTooltip, updateTooltipContent } from "../tooltips.js";
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

// "Follow a Clock" — reuses the same spotlight/group-log transport every
// other follower in this suite already polls (Clock's own follower-of-
// itself, Combat Tracker's player-mode poll) rather than a new same-page
// mechanism. `followTarget` is always "active" for now (whichever Clock is
// currently spotlighted to the group) — resolved fresh via
// resolveActiveSpotlightId every poll, never a baked-in instance id.
const FOLLOW_POLL_INTERVAL_MS = 5000;

// HA light state can change from OUTSIDE this widget entirely (a physical
// switch, Google Home, an HA automation) — unlike Follow-a-Clock above,
// this periodically checks whether HA's state drifted from what this card
// last showed. Off by default and a much coarser 30s, not
// FOLLOW_POLL_INTERVAL_MS's 5s — noticing "someone flipped the physical
// switch" doesn't need to react fast, and this polls even while nobody's
// looking at the dashboard tab, so the interval errs slow rather than
// hammering the GM's HA instance for every idle card left open.
const HA_POLL_INTERVAL_MS = 30000;

const DEFAULT_CONFIG = {
  // Absent/"wled" on any card saved before the Lighting generalization —
  // selectedIp being set is exactly what "wled" already implies.
  selectedType: "wled",
  selectedIp: "",
  selectedEntityId: "",
  followEnabled: false,
  // "brightness" maps the clock's fill percentage onto master brightness;
  // "segments" lights up a prefix of followSegmentIds proportional to fill
  // — a real dot-clock look, not just a dimmer.
  followMode: "brightness",
  followSegmentIds: [],
  // Parallel to followSegmentIds ("" for an unnamed segment) — lets Follow
  // find a segment by name after a layout restore renumbers the device's ids.
  followSegmentNames: [],
  // Opt-in per card — absent on any card saved before this existed, which
  // correctly defaults to false (no behavior change until a GM turns it on).
  haLivePollEnabled: false,
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

// Every command any part of the suite sends funnels through wledPostState, so
// announcing it here is what keeps a mounted Lighting card showing the real
// state no matter who changed the lights — a macro, the combat tracker, a
// Journal chip in another tab. Same-page listeners get a window event;
// other tabs get a BroadcastChannel message (tagged so a page ignores the
// copy of its own message the channel hands back).
const WLED_CHANGED_EVENT = "undercroft:wled-changed";
const WLED_SYNC_CHANNEL = "undercroft-wled";
const WLED_PAGE_ID = Math.random().toString(16).slice(2);
let wledSendChannel = null;

function notifyWledChanged(base) {
  window.dispatchEvent(new CustomEvent(WLED_CHANGED_EVENT, { detail: { base } }));
  if (typeof BroadcastChannel === "undefined") return;
  try {
    wledSendChannel = wledSendChannel || new BroadcastChannel(WLED_SYNC_CHANNEL);
    wledSendChannel.postMessage({ base, origin: WLED_PAGE_ID });
  } catch (error) {
    // Best-effort — a page that can't broadcast just doesn't sync other tabs.
  }
}

// `handler(base)` runs for a change made anywhere in the suite; returns the
// unsubscribe function.
export function subscribeWledChanges(handler) {
  const onEvent = (event) => handler(event.detail?.base || "");
  window.addEventListener(WLED_CHANGED_EVENT, onEvent);
  let channel = null;
  if (typeof BroadcastChannel !== "undefined") {
    channel = new BroadcastChannel(WLED_SYNC_CHANNEL);
    channel.addEventListener("message", (event) => {
      if (event.data?.origin !== WLED_PAGE_ID) handler(event.data?.base || "");
    });
  }
  return () => {
    window.removeEventListener(WLED_CHANGED_EVENT, onEvent);
    channel?.close();
  };
}

// POST to /json (not /json/state) — supported by every WLED version this
// widget might meet, unlike the newer /json/state-only shorthand. Also
// exactly what the Advanced/raw-JSON textarea sends, so "basic" controls
// and "advanced" commands are the same request shape underneath.
async function wledPostState(base, body) {
  const response = await fetch(`${base}/json`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
  if (!response.ok) {
    throw new Error(`WLED returned ${response.status}`);
  }
  notifyWledChanged(base);
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

// What a segment COVERS and how overlapping segments composite (bm, v16+;
// segment id order is the layer order) — never on/bri/col/fx/sx/ix/pal,
// which are the "look" a preset owns. Only the raw bm number is kept: its
// mode names/values aren't ours to hardcode.
const SEGMENT_NUMBER_KEYS = ["grp", "spc", "of", "bm"];
const SEGMENT_FLAG_KEYS = ["rev", "mi"];

function segmentName(seg) {
  return String(seg?.n ?? "").trim();
}

function segmentGeometry(seg, name = segmentName(seg)) {
  const out = { n: name, start: seg.start, stop: seg.stop };
  SEGMENT_NUMBER_KEYS.forEach((key) => {
    if (Number.isFinite(seg[key])) out[key] = seg[key];
  });
  SEGMENT_FLAG_KEYS.forEach((key) => {
    if (typeof seg[key] === "boolean") out[key] = seg[key];
  });
  return out;
}

function normalizeSegmentLayout(list) {
  return (Array.isArray(list) ? list : [])
    .filter((seg) => seg && segmentName(seg) && Number.isInteger(seg.start) && Number.isInteger(seg.stop) && seg.stop > seg.start)
    .map((seg) => segmentGeometry(seg));
}

// Only keys present on BOTH sides are compared — a layout remembered from a
// pre-v16 device (no bm) shouldn't read as drifted on a v16 one.
function layoutsMatch(remembered, live) {
  if (remembered.length !== live.length) return false;
  return remembered.every((entry, index) => {
    const seg = segmentGeometry(live[index]);
    return Object.keys(entry).every((key) => seg[key] === undefined || seg[key] === entry[key]);
  });
}

// Names are the stable key (ids shift on restore), so lookup is by name
// first and only falls back to the numeric id when no name is given.
export function resolveSegmentId(segs, { segmentName: name, segmentId } = {}) {
  const wanted = String(name ?? "").trim().toLowerCase();
  if (wanted) {
    const match = (Array.isArray(segs) ? segs : []).find((seg) => segmentName(seg).toLowerCase() === wanted);
    if (!match) throw new Error(`No segment named "${name}" on this device.`);
    return match.id;
  }
  return Number.isFinite(Number(segmentId)) ? Number(segmentId) : 0;
}

function optionalNumber(value) {
  if (value === undefined || value === null || value === "") return undefined;
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}

// One segment's "look" as a WLED `seg` entry — effect, palette, up to three
// colors, and brightness. Only the fields that are set are sent, and WLED
// leaves everything else as it is. Shared by the macro action and the combat
// tracker's table lighting, so both speak the same look vocabulary.
function buildLookEntry(segmentId, look = {}, { full = false } = {}) {
  const entry = { id: segmentId };
  const fx = optionalNumber(look.fx);
  if (fx !== undefined) entry.fx = fx;
  const pal = optionalNumber(look.pal);
  if (pal !== undefined) entry.pal = pal;
  // The effect's own controls: speed/intensity and the first two custom
  // sliders run 0–255, the third custom slider 0–31, and the three options
  // are on/off.
  ["sx", "ix", "c1", "c2", "c3"].forEach((key) => {
    const number = optionalNumber(look[key]);
    if (number !== undefined) entry[key] = Math.max(0, Math.min(key === "c3" ? 31 : 255, Math.round(number)));
  });
  ["o1", "o2", "o3"].forEach((key) => {
    if (typeof look[key] === "boolean") entry[key] = look[key];
  });
  // Black is not a color here — a LED can't show it, and it's how WLED holds
  // "no color" — so a cleared slot is sent as black. A saved look (`full`)
  // always applies all three slots, exactly as its swatches show; a single
  // change from the Lighting card (not `full`) sends colors only when one of
  // them was what changed.
  if (full || Array.isArray(look.col)) {
    const slots = Array.isArray(look.col) ? look.col : [];
    entry.col = [0, 1, 2].map((index) => (/^#?[0-9a-f]{6}$/i.test(slots[index] || "") ? hexToRgb(slots[index]) : [0, 0, 0]));
  }
  const bri = optionalNumber(look.bri);
  if (bri !== undefined) entry.bri = Math.max(MIN_BRIGHTNESS, Math.min(255, Math.round(bri)));
  return entry;
}

// Lights the named segments (each with its own look) and switches the
// `off` ones off, all in ONE request with `tt: 0` — so the swap is an
// instant cut and the Lighting card sees a single change. Segments are
// found by name, and ones not on the device are skipped when switching OFF
// (a stale list shouldn't block anything) but are an error when asked to
// LIGHT. Nothing lit means the master power is left alone.
export async function applyWledSegmentScene(device, { lit = [], off = [] } = {}) {
  const base = normalizeWledBase(device?.ip);
  if (!base) throw new Error("This device has no IP/hostname.");
  const state = await wledFetchJson(base, "/json/state");
  const segs = Array.isArray(state?.seg) ? state.seg : [];
  const idFor = (name) => {
    const wanted = String(name ?? "").trim().toLowerCase();
    return segs.find((seg) => segmentName(seg).toLowerCase() === wanted)?.id;
  };
  const litIds = new Set();
  const litEntries = lit.map(({ name, look }) => {
    const id = idFor(name);
    if (id === undefined) throw new Error(`No segment named "${name}" on this device.`);
    litIds.add(id);
    return { ...buildLookEntry(id, look, { full: true }), on: true };
  });
  const offIds = new Set(off.map(idFor).filter((id) => id !== undefined && !litIds.has(id)));
  const seg = [...Array.from(offIds, (id) => ({ id, on: false })), ...litEntries];
  if (!seg.length) return;
  await wledPostState(base, { tt: 0, ...(litEntries.length ? { on: true } : {}), seg });
}

// One short-lived lookup per device, shared by every editor that lists its
// presets/effects/palettes/segments — an editor re-renders on every edit, and
// each render would otherwise re-hit the device.
const WLED_CHOICES_TTL_MS = 30000;
const wledChoicesCache = new Map(); // ip -> { at, promise }
export function loadWledChoices(device) {
  const cached = wledChoicesCache.get(device.ip);
  if (cached && Date.now() - cached.at < WLED_CHOICES_TTL_MS) return cached.promise;
  const promise = fetchWledChoices(device);
  wledChoicesCache.set(device.ip, { at: Date.now(), promise });
  // A failed fetch isn't worth remembering — the next render should retry.
  promise.catch(() => wledChoicesCache.delete(device.ip));
  return promise;
}

// The "effect" macro action's command — only the fields the author set, so a
// palette-only or color-only macro leaves the segment's effect alone. WLED
// applies fx/pal only when the key is present and skips an empty `col` slot,
// which is how a macro can set just the Secondary color. A look on a device
// (or segment) that's switched off shows nothing, so the command also turns
// both on unless the author opted out with `turnOn: false` — a macro that
// stages a look to reveal later with its own "Turn on" step. `otherSegmentIds`
// (passed unless the author opted out with `exclusive: false`) are switched
// off in the same request, so a look replaces whatever another segment was
// showing instead of stacking on it. That swap is sent with `tt: 0` (a
// one-call transition override; the device's own setting is untouched):
// WLED crossfades a segment switching on/off, and with the default fade the
// outgoing segment is still visibly lit while the new one fades in.
function buildWledLookCommand(segmentId, params = {}, otherSegmentIds = []) {
  const entry = buildLookEntry(segmentId, params, { full: true });
  // Colors are always applied, so "nothing chosen" means no effect field, no
  // brightness, AND no color set.
  const hasColor = Array.isArray(params.col) && params.col.some((hex) => /^#?[0-9a-f]{6}$/i.test(hex || "") && !/^#?0{6}$/i.test(hex));
  if (Object.keys(entry).length === 2 && !hasColor) {
    throw new Error("Choose an effect, palette, brightness, or color for this action.");
  }
  const others = otherSegmentIds.map((id) => ({ id, on: false }));
  const command =
    params.turnOn === false ? { seg: [...others, entry] } : { on: true, seg: [...others, { ...entry, on: true }] };
  if (others.length) command.tt = 0;
  return command;
}

// Reads the device's state only when the action needs it — a segment NAME to
// resolve, or the other segments to switch off (the default; see
// buildWledLookCommand) — so an action that opts out of both stays a single
// request.
async function resolveMacroSegment(base, params) {
  const exclusive = params?.exclusive !== false;
  const needsState = String(params?.segmentName ?? "").trim() || exclusive;
  const state = needsState ? await wledFetchJson(base, "/json/state") : null;
  const segmentId = resolveSegmentId(state?.seg, params);
  const otherSegmentIds = exclusive
    ? (Array.isArray(state?.seg) ? state.seg : []).map((seg) => seg.id).filter((id) => id !== segmentId)
    : [];
  return { segmentId, otherSegmentIds };
}

function icon(name) {
  const span = el("span", "iconify");
  span.dataset.icon = name;
  span.setAttribute("aria-hidden", "true");
  return span;
}

// `active` (e.g. a section toggle like Follow — see
// renderDeviceRow) swaps to the "pressed" (primary) variant and sets
// aria-pressed, so a toggle icon button reads its own current state the
// same way a plain action icon button (Refresh, Forget) always looks the
// same regardless of anything — one helper for both, not two near-
// duplicates.
function iconButton(name, label, { variant = "outline-secondary", size = "sm", active = false } = {}) {
  const button = el(
    "button",
    `btn btn-${size} btn-${active ? "primary" : variant} d-inline-flex align-items-center justify-content-center flex-shrink-0`
  );
  button.type = "button";
  button.setAttribute("aria-label", label);
  button.setAttribute("data-bs-toggle", "tooltip");
  button.setAttribute("data-bs-title", label);
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
  // Per-effect control metadata (/json/fxdata), or null when unavailable — WLED only.
  let effectMeta = null;
  let haLightState = null; // last {state, brightness, rgbColor, supportedColorModes, friendlyName} — HA light only
  // The Add-device form's type toggle — local UI state, not persisted;
  // defaults to whichever type the selected device already is, so adding a
  // SECOND device of the same kind doesn't require re-picking the type.
  let addDeviceType = "wled";
  let haEntityOptions = []; // populated lazily when the Add-device form switches to HA Light
  let haEntityLoadFailed = false; // distinguishes "still loading" from "the fetch actually failed"
  // Which segment id(s) the Basic controls apply to — empty means "the
  // device's own main segment" (WLED's top-level bri/on/col/fx/pal shorthand).
  const targetSegmentIds = new Set();
  let loading = false;
  let loadError = "";
  let showAddDevice = false;
  let destroyed = false;
  // The Advanced section's draft/expanded state, kept outside render() —
  // every render() call fully rebuilds the DOM, which would otherwise wipe
  // out an in-progress custom JSON command the moment an unrelated Basic
  // control triggered a refresh mid-edit. A plain show/hide toggle, not
  // tied to any persisted setting — unlike Follow, there's no "enabled"
  // state to remember, just whether the section is open.
  let advancedExpanded = false;
  let advancedDraft = "";
  // Follow-a-Clock's poll/live-stream handles — only running while
  // config.followEnabled and a device is selected (see syncFollowWatch).
  let followTimer = null;
  let followLiveStream = null;
  // HA light live-poll's handle — only running while
  // config.haLivePollEnabled, an HA light is selected, and the widget
  // hasn't been destroyed (see syncHaPollWatch).
  let haPollTimer = null;
  // Cross-suite change sync (see scheduleExternalRefresh) — `lastWledRefreshAt`
  // lets a refresh this card just did itself absorb the echo of its own command.
  let externalRefreshTimer = 0;
  let lastWledRefreshAt = 0;
  // Dedupes identical clock states between polls so an unchanged clock
  // doesn't repeatedly re-POST the same state every 5s for no reason.
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

  // Dispatches to whichever driver the selected device type needs — WLED's
  // /json+presets fetch, or a single HA entity-state read. Both set
  // loading/loadError/render the same way, so every caller stays
  // type-agnostic.
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
      const [state, presetMap, fxdata] = await Promise.all([
        wledFetchJson(base, "/json"),
        wledFetchPresets(base),
        // Best-effort — without it the control just leaves every field enabled.
        wledFetchJson(base, "/json/fxdata").catch(() => null),
      ]);
      if (destroyed) return;
      deviceState = state;
      presets = presetMap;
      effectMeta = Array.isArray(fxdata) ? fxdata.map(parseEffectMeta) : null;
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
      lastWledRefreshAt = Date.now();
      if (!destroyed) {
        loading = false;
        render();
      }
    }
  }

  // A change announced anywhere in the suite (see notifyWledChanged) — a
  // macro, the combat tracker, another tab — leaves this card showing stale
  // state unless it re-reads. Debounced so a burst is one read, and skipped
  // when this card's own command already refreshed it a moment ago.
  function scheduleExternalRefresh(base) {
    if (destroyed || currentDeviceType() !== "wled" || !base || base !== currentBase()) return;
    window.clearTimeout(externalRefreshTimer);
    externalRefreshTimer = window.setTimeout(() => {
      if (destroyed || Date.now() - lastWledRefreshAt < 400) return;
      void refreshState({ silent: true });
    }, 200);
  }

  // Shared by every failable device request — one place to surface a
  // network/HTTP error as a toast and refresh afterward.
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

  // Effect/palette/color have NO top-level/master equivalent in WLED —
  // they're exclusively per-segment properties. Sending them bare
  // silently no-ops on real hardware (the Effect dropdown changing nothing
  // and reverting on refresh was exactly this bug). Defaults to the
  // device's current main segment when nothing is explicitly targeted,
  // rather than doing nothing.
  async function sendSegmentCommand(fields) {
    const ids = targetSegmentIds.size ? Array.from(targetSegmentIds) : [mainSegment()?.id ?? 0];
    await sendRaw({ seg: ids.map((id) => ({ id, ...fields })) });
  }

  function currentDevice() {
    return deviceList.find((device) => device.type !== "haLight" && normalizeWledBase(device.ip) === currentBase()) || null;
  }

  function rememberedLayout() {
    return currentDevice()?.segments || [];
  }

  // Id order is layer order (lower id = bottom), so sort rather than trust
  // the response's own ordering.
  function liveSegments() {
    const segs = Array.isArray(deviceState?.state?.seg) ? deviceState.state.seg : [];
    return segs.slice().sort((a, b) => a.id - b.id);
  }

  function setRememberedLayout(segments) {
    const device = currentDevice();
    if (!device) return;
    persistDevices(
      deviceList.map((entry) => {
        if (entry !== device) return entry;
        const { segments: _previous, ...rest } = entry;
        return segments.length ? { ...rest, segments } : rest;
      })
    );
  }

  async function rememberLayout() {
    const live = liveSegments();
    if (!live.length) return;
    const names = live.map((seg) => segmentName(seg) || `Segment ${seg.id}`);
    if (new Set(names.map((name) => name.toLowerCase())).size !== names.length) {
      status?.show?.("Two segments share a name — rename one in WLED first, names identify segments.", {
        type: "warning",
        timeout: 4000,
      });
      return;
    }
    // Pushed back so the device and the remembered layout agree on the name
    // a restore will re-send.
    const unnamed = live.filter((seg) => !segmentName(seg)).map((seg) => ({ id: seg.id, n: `Segment ${seg.id}` }));
    try {
      if (unnamed.length) await wledPostState(currentBase(), { seg: unnamed });
    } catch (error) {
      status?.show?.(error?.message || "Unable to name those segments on the device.", { type: "error", timeout: 3000 });
      return;
    }
    setRememberedLayout(live.map((seg, index) => segmentGeometry(seg, names[index])));
    status?.show?.(`Remembered ${live.length} segment${live.length === 1 ? "" : "s"}.`, { type: "success", timeout: 2000 });
    await refreshState({ silent: true });
  }

  // A full ordered array (ids 0..n-1, surplus live slots stop:0) because
  // WLED appends a new segment rather than honoring a requested id — this is
  // the only way device ids come out matching the remembered layer order.
  async function restoreLayout() {
    const remembered = rememberedLayout();
    if (!remembered.length) return;
    const live = liveSegments();
    const maxSegments = deviceState?.info?.leds?.maxseg;
    if (Number.isFinite(maxSegments) && remembered.length > maxSegments) {
      status?.show?.(`This device supports at most ${maxSegments} segments.`, { type: "warning", timeout: 4000 });
      return;
    }
    const ledCount = deviceState?.info?.leds?.count;
    if (Number.isFinite(ledCount) && remembered.some((seg) => seg.stop > ledCount)) {
      status?.show?.(`The remembered layout needs more than this device's ${ledCount} LEDs.`, { type: "warning", timeout: 4000 });
      return;
    }
    // Pre-v16 firmware never reports bm, so it's only sent where it exists.
    const supportsBlend = live.some((seg) => "bm" in seg);
    const seg = remembered.map(({ bm, ...geometry }, id) => ({
      id,
      ...geometry,
      ...(supportsBlend && bm !== undefined ? { bm } : {}),
    }));
    live.filter((entry) => entry.id >= remembered.length).forEach((entry) => seg.push({ id: entry.id, stop: 0 }));
    await sendRaw({ seg });
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

  // Translates a Clock's own posted config ({filled, segments, ...}) into a
  // WLED command. "segments" mode lights a prefix of
  // config.followSegmentIds proportional to fill — real dot-clock
  // behavior, not just a dimmer; falls back to "brightness" if no segments
  // are assigned yet, so turning the feature on always does something
  // visible.
  async function applyClockState(clockConfig) {
    const segments = Number(clockConfig?.segments) || 0;
    const filled = Math.max(0, Math.min(segments, Number(clockConfig?.filled) || 0));
    if (!segments) return;
    const live = liveSegments();
    const ids = config.followSegmentIds.map((id, index) => {
      const name = String(config.followSegmentNames[index] || "").toLowerCase();
      return live.find((seg) => name && segmentName(seg).toLowerCase() === name)?.id ?? id;
    });
    const key = `${filled}/${segments}/${config.followMode}/${ids.join(",")}`;
    if (key === lastAppliedFollowKey) return;
    lastAppliedFollowKey = key;
    if (config.followMode === "segments" && ids.length) {
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
      // Best-effort — a missed poll just means the next one catches up.
    }
  }

  // Started/stopped whenever followEnabled or the selected device changes
  // — never runs with nothing to follow or nowhere to send it, rather than
  // polling pointlessly in the background.
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
    // clocks.js's follower uses: a Dashboard tab can sit unfocused for a
    // whole session and plain setInterval stalls there.
    followTimer = createReliableInterval(() => void refreshFollow(), FOLLOW_POLL_INTERVAL_MS);
    // The group log itself is the one live channel every inline-kind
    // follower watches (Clock has no dedicated live-stream kind of its
    // own) — matches clocks.js's initFollowerClock exactly.
    followLiveStream = connectLiveStream({
      dataManager,
      groupId: groupContext.groupId,
      kinds: ["group_log"],
      shareToken: groupContext.shareToken,
    });
    followLiveStream.subscribe("group_log", () => void refreshFollow());
  }

  // Started/stopped whenever haLivePollEnabled or the selected device
  // changes — mirrors syncFollowWatch's shape, just polling HA's
  // entity-state endpoint silently (no loading spinner for a background
  // poll) instead of pushing a clock's fill outward. Never runs for a WLED
  // device or while the toggle is off.
  function syncHaPollWatch() {
    if (haPollTimer) {
      haPollTimer.stop();
      haPollTimer = null;
    }
    if (currentDeviceType() !== "haLight" || !config.haLivePollEnabled || !config.selectedEntityId || !dataManager) return;
    haPollTimer = createReliableInterval(() => void refreshHaLightState({ silent: true }), HA_POLL_INTERVAL_MS);
  }

  // A composite key so ONE <select> can list both device types without
  // colliding (a WLED IP and an HA entity id live in different namespaces)
  // — encode/decode kept together so population and parsing can't drift.
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
    syncHaPollWatch();
  }

  function renderDeviceRow() {
    // Never wraps: the buttons keep their size (flex-shrink-0, see
    // iconButton) and the device select gives up width instead.
    const row = el("div", "d-flex flex-nowrap align-items-center gap-1");

    const select = document.createElement("select");
    select.className = "form-select form-select-sm";
    select.style.maxWidth = "10rem";
    select.style.minWidth = "0";
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
      syncHaPollWatch();
      render();
    });
    row.appendChild(removeButton);

    // Section toggles live here too, on the same icon-button row, rather
    // than a separate row of their own — fewer rows competing for space on
    // a small widget card (see render() for what each shows/hides). Both
    // stay WLED-only for now.
    const isWledSelected = currentDeviceType() === "wled" && Boolean(config.selectedIp);
    const followButton = iconButton("tabler:clock", "Follow a Clock", { active: config.followEnabled });
    followButton.addEventListener("click", () => {
      const next = !config.followEnabled;
      persistInstanceConfig({ followEnabled: next });
      syncFollowWatch();
      render();
    });
    row.appendChild(followButton);
    // setDisabledTooltip owns `disabled` itself — a real `disabled` on the
    // same element as the tooltip blocks the hover that would show it (see
    // tooltips.js's own BUG CLASS 1). Called after row.appendChild —
    // setDisabledTooltip's wrapper needs a real DOM parent to insert next to.
    if (isWledSelected) {
      setDisabledTooltip(followButton, "");
      updateTooltipContent(followButton, "Follow a Clock");
    } else {
      setDisabledTooltip(followButton, "Follow a Clock (WLED devices only)");
    }

    // Pressed = a layout is remembered and the device still matches it, so a
    // click then forgets it; otherwise a click (re)remembers the device's
    // current segments.
    const remembered = rememberedLayout();
    const layoutInSync = remembered.length > 0 && deviceState && layoutsMatch(remembered, liveSegments());
    const layoutLabel = layoutInSync ? "Forget remembered layout" : remembered.length ? "Update remembered layout" : "Remember layout";
    const layoutButton = iconButton("tabler:bookmark", layoutLabel, { active: layoutInSync });
    layoutButton.addEventListener("click", () => {
      if (layoutInSync) setRememberedLayout([]);
      else void rememberLayout();
      render();
    });
    row.appendChild(layoutButton);
    if (isWledSelected && deviceState) {
      setDisabledTooltip(layoutButton, "");
      updateTooltipContent(layoutButton, layoutLabel);
    } else {
      setDisabledTooltip(layoutButton, "Remember layout (connect to a WLED device first)");
    }

    // HA-light-only, mirroring Follow/Advanced's WLED-only gating — opt-in
    // per card, so this stays off until a GM deliberately wants this card
    // to notice state changes made outside Undercroft.
    const isHaSelected = currentDeviceType() === "haLight" && Boolean(config.selectedEntityId);
    const livePollButton = iconButton("tabler:activity", "Live Poll (every 30s)", { active: config.haLivePollEnabled });
    livePollButton.addEventListener("click", () => {
      const next = !config.haLivePollEnabled;
      persistInstanceConfig({ haLivePollEnabled: next });
      syncHaPollWatch();
      render();
    });
    row.appendChild(livePollButton);
    if (isHaSelected) {
      setDisabledTooltip(livePollButton, "");
      updateTooltipContent(livePollButton, "Live Poll — check for state changes made outside Undercroft every 30s");
    } else {
      setDisabledTooltip(livePollButton, "Live Poll (HA light/group devices only)");
    }

    return row;
  }

  // Two device types, two rows — a type toggle on its own line (WLED vs HA
  // light/group), then a second line holding the device select/input,
  // Label, and +/x buttons together — a free-text IP (WLED, unauthenticated
  // LAN device, no directory to pick from) or a populated select of live HA
  // entities (via listHaEntities). Two separate rows since
  // type+device+label+buttons doesn't fit on one physical line at this
  // widget's normal card width.
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

    // Only when HA is the selected type — the entry point for fixing a
    // wrong Home Assistant base URL or disconnecting entirely.
    // ensureHaConnection (invoked below when the entity picker loads) only
    // ever prompts once, the first time there's no connection at all — once
    // configured, however wrong, there's no way back into that modal
    // without this.
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
    // references this device by, not what shows up in this dropdown.
    // Keeping it separate from Label means renaming how a device displays
    // never breaks a macro that already references it. HA's own macro
    // actions target an entityId directly — no alias-resolution step, so
    // an HA-light entry has nothing to put here.
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
      // Prompts to connect only if this account hasn't already — a no-op
      // resolve(true) otherwise, same "connect once, remembered" flow every
      // entry point into HA shares.
      void ensureHaConnection({ dataManager, status }).then((connected) => {
        if (!connected || destroyed) return;
        // "light" covers both a real HA Light Group helper AND a Hubitat
        // "Group Dimmer" virtual device (synced into HA as an ordinary
        // light.* entity by the Hubitat integration). "group" stays in the
        // list defensively for HA's own classic Group platform.
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
        // this picker) rather than the raw entityId — leaving Label blank
        // would otherwise show "light.living_room_lamp" forever instead of
        // what the picker itself displayed.
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

  // Shown only on drift (e.g. after a reboot) and never auto-applied — a
  // deliberate edit made in WLED's own UI shouldn't be silently undone.
  function renderLayoutBanner() {
    const remembered = rememberedLayout();
    if (!remembered.length || layoutsMatch(remembered, liveSegments())) return null;
    const banner = el("div", "alert alert-warning py-1 px-2 mb-0 small d-flex flex-wrap align-items-center gap-2");
    banner.appendChild(
      el("span", "me-auto", `Segments differ from the remembered layout (${remembered.length}).`)
    );
    const restoreButton = el("button", "btn btn-sm btn-primary", "Restore");
    restoreButton.type = "button";
    restoreButton.addEventListener("click", () => void restoreLayout());
    const forgetButton = el("button", "btn btn-sm btn-outline-secondary", "Forget");
    forgetButton.type = "button";
    forgetButton.addEventListener("click", () => {
      setRememberedLayout([]);
      render();
    });
    banner.append(restoreButton, forgetButton);
    return banner;
  }

  // The card's controls are the shared WLED control in "live" mode: it shows
  // the device's current values, and each change comes back as a patch that
  // is sent on its own (see wled-control.js). The brightness slider is the
  // device's master brightness unless segments are targeted.
  function renderWledBasicControls() {
    const seg = mainSegment();
    const isOn = targetSegmentIds.size ? Boolean(seg?.on) : Boolean(deviceState?.state?.on);
    const bri = targetSegmentIds.size ? seg?.bri ?? 128 : deviceState?.state?.bri ?? 128;
    const segs = Array.isArray(deviceState?.state?.seg) ? deviceState.state.seg : [];
    // id "0" is WLED's own "no preset" placeholder slot — never a real,
    // nameable preset, so it's excluded rather than shown as a blank entry.
    const presetList = Object.entries(presets)
      .filter(([id, entry]) => id !== "0" && entry?.n)
      .map(([id, entry]) => ({ id: Number(id), name: entry.n }));
    const activePreset = Number(deviceState?.state?.ps);
    const choices = {
      effects: Array.isArray(deviceState?.effects) ? deviceState.effects : [],
      palettes: Array.isArray(deviceState?.palettes) ? deviceState.palettes : [],
      presets: presetList,
      effectMeta,
      segments: segs.map((entry, index) => ({ value: String(entry.id), label: entry.n || `Segment ${index}` })),
    };
    // One target segment. An id that isn't in the device's list (entered by
    // number) is passed as `segmentId` rather than a listed choice.
    const targetId = targetSegmentIds.size ? Array.from(targetSegmentIds)[0] : undefined;
    const targetListed = targetId !== undefined && segs.some((entry) => entry.id === targetId);
    const value = {
      segments: targetListed ? [String(targetId)] : [],
      segmentId: targetId !== undefined && !targetListed ? targetId : undefined,
      power: isOn,
      preset: activePreset > 0 ? activePreset : undefined,
      col: (Array.isArray(seg?.col) ? seg.col : []).slice(0, 3).map((slot) => (slot ? rgbToHex(slot) : "")),
      bri,
      ...Object.fromEntries(["fx", "pal", "sx", "ix", "c1", "c2", "c3", "o1", "o2", "o3"].map((key) => [key, seg?.[key]])),
    };
    return createWledControl({
      value,
      mode: "live",
      loadChoices: () => Promise.resolve(choices),
      sections: {
        // Presets apply device-wide (they can carry their own segment config),
        // so they're never re-targeted through the segment picker.
        target: segs.length > 1 ? { label: "Segment", noneLabel: "Main segment" } : false,
        power: { style: "button" },
        preset: presetList.length > 0,
        look: true,
      },
      stateKey: "lighting-card",
      onChange: (next, patch) => {
        if ("segments" in patch || "segmentId" in patch) {
          targetSegmentIds.clear();
          if (next.segments?.[0] !== undefined) targetSegmentIds.add(Number(next.segments[0]));
          else if (next.segmentId !== undefined) targetSegmentIds.add(next.segmentId);
          render();
          return;
        }
        if ("power" in patch) void sendCommand({ on: Boolean(next.power) });
        if ("preset" in patch && next.preset !== undefined) void sendRaw({ ps: next.preset });
        if ("bri" in patch) void sendCommand({ bri: next.bri });
        const lookPatch = Object.fromEntries(
          Object.entries(patch).filter(([key]) => !["segments", "power", "preset", "bri"].includes(key))
        );
        if (Object.keys(lookPatch).length) {
          const { id, ...fields } = buildLookEntry(0, lookPatch);
          if (Object.keys(fields).length) void sendSegmentCommand(fields);
        }
      },
    });
  }

  // "Advanced" — a collapsible section (closed until opened) in place of the
  // old toolbar toggle. Whether it's open lives in advancedExpanded, since the
  // card re-renders on every change.
  function renderAdvancedCollapsible() {
    const body = renderAdvancedSection();
    const { button } = createCollapseToggleButton({
      label: "advanced",
      collapsed: !advancedExpanded,
      onToggle: (collapsed) => {
        advancedExpanded = !collapsed;
        setElementCollapsed(body, collapsed);
      },
    });
    setElementCollapsed(body, !advancedExpanded);
    const header = el("div", "d-flex align-items-center gap-1");
    header.append(button, el("span", "small fw-semibold text-body-secondary", "Advanced"));
    const section = el("div", "d-flex flex-column gap-1");
    section.append(header, body);
    return section;
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
          persistInstanceConfig({
            followSegmentIds: ids,
            followSegmentNames: ids.map((id) => segmentName(segs.find((seg) => seg.id === id))),
          });
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
  // small: on/off, a brightness slider (0-255, same scale WLED's slider
  // uses), and a color picker only when haLightSupportsColor says this
  // entity reports a color-capable mode. No effects/palettes/presets/
  // segments — WLED-specific concepts with no HA equivalent; anything
  // beyond this common surface belongs in the Macro system's "Call a
  // service" action instead.
  // Every command below updates haLightState LOCALLY right after a
  // successful call, instead of re-fetching from HA — HA's REST API
  // accepts and returns from a service call before the entity's own state
  // has actually caught up, so an immediate re-fetch would read the stale
  // value and the control shown would always be one interaction behind.
  // This can drift from the true state if something else changes the light
  // (an HA automation, another user) — the device row's Refresh button is
  // the way back to a real read.
  function renderHaLightBasicControls() {
    const entityId = config.selectedEntityId;
    const isOn = haLightState?.state === "on";
    const brightness = Number.isFinite(haLightState?.brightness) ? haLightState.brightness : 128;
    // Every command updates haLightState locally and re-renders — see the
    // note above on why this never re-fetches. One failure path for all three.
    const send = async (command, nextState) => {
      try {
        await command();
        haLightState = { ...(haLightState || {}), ...nextState };
        render();
      } catch (error) {
        status?.show?.(error?.message || "Unable to send command to this light.", { type: "error", timeout: 3000 });
      }
    };
    // The same control the Lighting card uses, with only what an HA light
    // offers: power, and (when the entity reports the capability) brightness
    // and a single color — otherwise a plain on/off entity would get a slider
    // that silently no-ops on every move.
    return createWledControl({
      value: {
        power: isOn,
        bri: brightness,
        col: [Array.isArray(haLightState?.rgbColor) ? rgbToHex(haLightState.rgbColor) : "#ffffff"],
      },
      mode: "live",
      sections: {
        power: { style: "button" },
        look: {
          effect: false,
          palette: false,
          effectOptions: false,
          brightness: haLightSupportsBrightness(haLightState),
          colors: haLightSupportsColor(haLightState) ? 1 : 0,
        },
      },
      onChange: (next, patch) => {
        if ("power" in patch) {
          const nextOn = Boolean(next.power);
          void send(() => setHaLightPower(dataManager, entityId, nextOn), { state: nextOn ? "on" : "off" });
        }
        if ("bri" in patch) {
          void send(() => setHaLightBrightness(dataManager, entityId, next.bri), { state: "on", brightness: next.bri });
        }
        if ("col" in patch) {
          // A cleared color is black, same as everywhere else.
          const rgb = hexToRgb(next.col?.[0] || "#000000");
          void send(() => setHaLightColor(dataManager, entityId, rgb), { state: "on", rgbColor: rgb });
        }
      },
    });
  }

  function render() {
    if (destroyed) return;
    disposeTooltips(container);
    container.innerHTML = "";
    const wrap = el("div", "d-flex flex-column gap-2 overflow-auto");
    wrap.style.minHeight = "0";

    wrap.appendChild(renderDeviceRow());
    if (showAddDevice) wrap.appendChild(renderAddDeviceForm());

    // The Follow toggle button lives on the device row (renderDeviceRow) —
    // this just shows/hides its section's content in place, rather than a
    // separate always-visible header row for a section that might not even be
    // in use. Follow and the Advanced section (below) stay WLED-only.
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
      const layoutBanner = renderLayoutBanner();
      if (layoutBanner) wrap.appendChild(layoutBanner);
      wrap.appendChild(renderWledBasicControls());
    }

    if (isWledSelected) wrap.appendChild(renderAdvancedCollapsible());

    container.appendChild(wrap);
    refreshTooltips(container);
  }

  // --- Macro action support (common/js/lib/widgets/macro-runner.js) ---
  // Reuses this instance's own sendRaw — the same call path the Basic
  // controls use — so a macro-triggered command both hits the device AND
  // refreshes deviceState/render() afterward, same as a manual click. WLED
  // has no push/poll of its own to notice an EXTERNAL state change the way
  // Combat Tracker's poll or Clock's spotlight-follow do, so without this a
  // macro-triggered command left the card showing stale state. On/off/
  // preset/brightness send bare (never scoped to whatever segments this
  // card's UI happens to have selected — targetSegmentIds is transient GM
  // browsing state, not part of what the macro author meant), matching
  // runWledMacroAction's own standalone payload shape so both paths behave
  // identically, mount-a-widget or not.
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
        const { segmentId, otherSegmentIds } = await resolveMacroSegment(currentBase(), params);
        await sendRaw(buildWledLookCommand(segmentId, params, otherSegmentIds));
        return;
      }
      default:
        throw new Error(`Unknown WLED macro action "${action?.action}".`);
    }
  }

  render();
  if (hasSelection()) void refreshState();
  syncFollowWatch();
  syncHaPollWatch();
  const unsubscribeWledSync = subscribeWledChanges(scheduleExternalRefresh);

  return {
    runMacroAction,
    destroy() {
      destroyed = true;
      unsubscribeWledSync();
      window.clearTimeout(externalRefreshTimer);
      if (followTimer) followTimer.stop();
      followLiveStream?.close();
      if (haPollTimer) haPollTimer.stop();
      disposeTooltips(container);
      container.innerHTML = "";
    },
  };
}

// --- Macro action support (common/js/lib/widgets/macro-runner.js) ---
// Standalone — does not need a mounted widget instance, unlike the live
// widget above. Reuses the same wledPostState/normalizeWledBase this file's
// own instance calls, so a macro-triggered command hits the device exactly
// the same way the live widget's controls do.

export const WLED_MACRO_ACTIONS = {
  on: { label: "Turn on" },
  off: { label: "Turn off" },
  preset: { label: "Apply preset", params: ["presetId"] },
  brightness: { label: "Set brightness", params: ["value"] },
  effect: { label: "Set effect / palette / color", params: ["look"] },
};

// `alias` is deliberately separate from `label` — see this widget's own
// header comment. Exported so every reader of the account-wide device list
// normalizes it the same way, rather than each keeping its own copy of
// this filter/trim logic. Handles both device types — a WLED entry needs a
// real `ip`, an HA-light entry needs a real `entityId`; a bare/legacy entry
// (no `type` at all) is treated as "wled", matching DEFAULT_CONFIG's own
// selectedType fallback.
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
                ...(normalizeSegmentLayout(entry.segments).length ? { segments: normalizeSegmentLayout(entry.segments) } : {}),
              }
        )
    : [];
}

// The account-wide WLED device list, fetched fresh — for callers with no
// already-loaded dashboard settings blob in hand (unlike dashboard.js's own
// loadWledDevices(serverSettings), which reads it out of the one settings
// fetch the Dashboard already does at boot). Exists because a macro's WLED
// action run from a Journal page has no wledDevices list to resolve its
// alias against otherwise — runMacro()'s `wledDevices = []` default would
// make every alias look unconfigured, even though the same macro runs fine
// from the Dashboard's Macro board widget, which does pass its live list.
// Same local+server merge-patch pattern every Dashboard setting uses —
// local storage is the only source once a device list is saved
// anonymously, so this still works for that case too.
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

// What a device offers a macro action to pick from, read live from the
// device (the same sources the Lighting widget's own selects use) — a macro
// editor on any machine that can reach the device sees its real presets,
// effects, and segment names. Rejects only when the device is unreachable.
export async function fetchWledChoices(device) {
  const base = normalizeWledBase(device?.ip);
  if (!base) throw new Error("This device has no IP/hostname.");
  const [presets, effects, state, palettes, fxdata] = await Promise.allSettled([
    wledFetchPresets(base),
    wledFetchJson(base, "/json/eff"),
    wledFetchJson(base, "/json/state"),
    wledFetchJson(base, "/json/pal"),
    wledFetchJson(base, "/json/fxdata"),
  ]);
  if (effects.status === "rejected" && state.status === "rejected") {
    throw new Error(`Can't reach ${device.label || base} from this browser.`);
  }
  const liveSegments = state.status === "fulfilled" && Array.isArray(state.value?.seg) ? state.value.seg : [];
  const segmentNames = Array.from(new Set([...(device.segments || []), ...liveSegments].map(segmentName).filter(Boolean)));
  return {
    presets: Object.entries(presets.value || {})
      .filter(([id, entry]) => id !== "0" && entry?.n)
      .map(([id, entry]) => ({ id: Number(id), name: entry.n })),
    effects: effects.status === "fulfilled" && Array.isArray(effects.value) ? effects.value : [],
    palettes: palettes.status === "fulfilled" && Array.isArray(palettes.value) ? palettes.value : [],
    // Per-effect control metadata, or null when the device doesn't offer it
    // (older firmware) — the editor then just leaves everything enabled.
    effectMeta: fxdata.status === "fulfilled" && Array.isArray(fxdata.value) ? fxdata.value.map(parseEffectMeta) : null,
    segmentNames,
    // The shape the control's segment picker reads: macros and table lighting
    // identify a segment by NAME, so value and label are the same.
    segments: segmentNames.map((name) => ({ value: name, label: name })),
  };
}

// A device can only be referenced by a macro through its alias, and the
// Lighting widget only asks for one when the device is first added — so
// picking an alias-less device in the macro editor gives it one, derived from
// its label (or host) and made unique, rather than leaving it unselectable.
export async function ensureWledDeviceAlias(dataManager, devices, ip) {
  const list = normalizeWledDeviceList(devices);
  const device = list.find((entry) => entry.type !== "haLight" && entry.ip === ip);
  if (!device) return null;
  if (device.alias) return { alias: device.alias, devices: list };
  const stem =
    String(device.label || device.ip)
      .replace(/^https?:\/\//i, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "wled";
  const taken = new Set(list.map((entry) => entry.alias.toLowerCase()));
  let alias = stem;
  for (let suffix = 2; taken.has(alias); suffix += 1) alias = `${stem}-${suffix}`;
  const saved = await saveWledDevices(
    dataManager,
    list.map((entry) => (entry === device ? { ...entry, alias } : entry))
  );
  return { alias, devices: saved };
}

// The write half of fetchWledDevices above — same two keys, same local-
// always/server-when-signed-in shape, so a device list saved from ANY
// caller is readable by every other caller regardless of which one wrote
// it. dashboard.js's own persistWledDevices calls this too, rather than
// keeping a second, independently-typed copy of the same key strings.
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
// updated device list, and resolves to the updated list — or null if the
// GM cancelled, or there's nothing saved to pick from. Shared by every
// macro-running surface so a macro referencing an unconfigured device
// alias never just fails with no way to fix it in the moment: the GM
// aliases it right here and the macro keeps going.
export async function promptForWledAlias({ dataManager, status, alias, devices }) {
  // WLED-only — an HA-light entry has no `.ip` at all, and this whole flow
  // only ever runs for a `wled`-type macro action, so an HA-light entry
  // showing up here would just be a broken, irrelevant option.
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
          // better to let the macro keep going than block on a save error.
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
      // No Bootstrap JS on the page — stay defensive rather than silently
      // doing nothing, same fallback shape content-picker.js's
      // openContentPicker uses.
      finish(null);
    }
  });
}

export async function runWledMacroAction(action, { wledDevices = [], widgetInstance } = {}) {
  // Prefer routing through a live, mounted WLED card already pointed at the
  // resolved device — see that card's own runMacroAction for why (state
  // refresh). Falls back to the standalone path below when there's no
  // widget grid to route through at all, or ensureWidget couldn't find/add
  // a matching card — the physical device still gets the command either
  // way, just without a card on screen reflecting it.
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
      const { segmentId, otherSegmentIds } = await resolveMacroSegment(base, params);
      await wledPostState(base, buildWledLookCommand(segmentId, params, otherSegmentIds));
      return;
    }
    default:
      throw new Error(`Unknown WLED macro action "${action?.action}".`);
  }
}
