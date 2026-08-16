// HA light/group entity control — the second device type the Lighting
// widget (wled.js) can point a card at, alongside a real WLED device. A
// much smaller surface than WLED's own JSON API: on/off, brightness (0-255,
// matching WLED's own scale so wled.js's shared brightness-slider markup
// works against either device type unmodified), and RGB color when the
// entity actually reports a color-capable mode. A control simply doesn't
// render for an entity that doesn't advertise the capability — same
// restraint wled.js's own renderWledBasicControls already applies (no
// Effect dropdown when a device reports no effects, etc.).
//
// Not strictly `light.*` despite the filename — a Light Group helper's own
// entity can land under either the `light` or `group` domain depending on
// how it was created in HA (see home-assistant.js's own listHaEntities
// comment), so this widget's own picker offers both. Power was briefly
// routed through HA's domain-agnostic `homeassistant.turn_on`/`turn_off`
// (in principle safer for a non-`light` entity) — reverted after confirming
// against a real Hubitat-backed "Group Dimmer" light entity that it doesn't
// reliably toggle power the way calling `light.turn_on`/`turn_off` directly
// does; every entity this widget's own picker actually offers is `light`/
// `group` domain (see the picker's own domainFilter), so there's no real
// entity here `light.turn_on`/`turn_off` wouldn't already cover.
import { fetchHaEntityState, callHaService } from "./home-assistant.js";

export async function fetchHaLightState(dataManager, entityId) {
  return fetchHaEntityState(dataManager, entityId);
}

export async function setHaLightPower(dataManager, entityId, on) {
  await callHaService(dataManager, { domain: "light", service: on ? "turn_on" : "turn_off", entityId });
}

// Floored at a raw brightness of 3, matching HA's own effective floor for
// "1%" — not the raw 0-255 scale's literal minimum of 1. HA's brightness
// scale is 0-255, but a Hubitat device underneath (see this file's own
// header comment) speaks a 1-100 level scale, and the integration's own
// 255->100 conversion rounds a raw brightness of 1 or 2 down to level 0,
// which Hubitat treats as off — confirmed real bug: dragging this slider to
// its lowest raw setting turned the light off entirely instead of dimming
// it. HA's OWN percent-based UI never actually sends a raw 1 or 2 — its
// "1%" is round(0.01*255)=3 — so 3 is the lowest value this slider can
// offer that HA's own dashboard would also consider "1%," and it survives
// the 255->100 conversion under floor OR round-to-nearest (3/255*100=1.18,
// vs. 1/255*100=0.39 and 2/255*100=0.78, both of which floor/round to 0).
const MIN_SAFE_BRIGHTNESS = 3;

export async function setHaLightBrightness(dataManager, entityId, brightness) {
  await callHaService(dataManager, {
    domain: "light",
    service: "turn_on",
    entityId,
    data: { brightness: Math.max(MIN_SAFE_BRIGHTNESS, Math.min(255, Math.round(brightness))) },
  });
}

export async function setHaLightColor(dataManager, entityId, [r, g, b]) {
  await callHaService(dataManager, { domain: "light", service: "turn_on", entityId, data: { rgb_color: [r, g, b] } });
}

// HA's own supported_color_modes vocabulary: onoff, brightness, rgb, rgbw,
// rgbww, hs, xy, color_temp, white. Anything past plain "onoff" implies
// brightness is meaningful (even color-only-looking modes carry a
// brightness channel in HA's model); only rgb/rgbw/rgbww/hs/xy are real
// color. Gating on this (not just whether the last-read state happened to
// include a brightness NUMBER) matters for a device that's currently off —
// HA still reports supported_color_modes then, just no live brightness
// value, and the control should still show.
const BRIGHTNESS_CAPABLE_MODES = new Set(["brightness", "rgb", "rgbw", "rgbww", "hs", "xy", "color_temp", "white"]);
const COLOR_CAPABLE_MODES = new Set(["rgb", "rgbw", "rgbww", "hs", "xy"]);

export function haLightSupportsBrightness(state) {
  return Array.isArray(state?.supportedColorModes) && state.supportedColorModes.some((mode) => BRIGHTNESS_CAPABLE_MODES.has(mode));
}

export function haLightSupportsColor(state) {
  return Array.isArray(state?.supportedColorModes) && state.supportedColorModes.some((mode) => COLOR_CAPABLE_MODES.has(mode));
}
