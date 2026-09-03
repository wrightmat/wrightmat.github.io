// HA light/group entity control — the second device type the Lighting
// widget (wled.js) can point a card at, alongside a real WLED device. A
// much smaller surface than WLED's own JSON API: on/off, brightness (0-255,
// matching WLED's scale so wled.js's brightness-slider markup works against
// either device type unmodified), and RGB color when the entity reports a
// color-capable mode. A control simply doesn't render for a capability the
// entity doesn't advertise, same restraint as wled.js's own basic controls.
//
// Not strictly `light.*` despite the filename — a Light Group helper's
// entity can land under either the `light` or `group` domain depending on
// how it was created in HA, so this widget's picker offers both. Power goes
// through `light.turn_on`/`turn_off` specifically, not the domain-agnostic
// `homeassistant.turn_on`/`turn_off` — confirmed against a real
// Hubitat-backed "Group Dimmer" entity that the domain-agnostic call doesn't
// reliably toggle it.
import { fetchHaEntityState, callHaService } from "./home-assistant.js";

export async function fetchHaLightState(dataManager, entityId) {
  return fetchHaEntityState(dataManager, entityId);
}

export async function setHaLightPower(dataManager, entityId, on) {
  await callHaService(dataManager, { domain: "light", service: on ? "turn_on" : "turn_off", entityId });
}

// Floored at a raw brightness of 3, matching HA's own effective floor for
// "1%" — not the scale's literal minimum of 1. A Hubitat device underneath
// speaks a 1-100 level scale, and the integration's 255->100 conversion
// rounds a raw brightness of 1 or 2 down to level 0, which Hubitat treats as
// off (dragging the slider to its lowest setting turned the light off
// instead of dimming it). HA's own percent-based UI never sends 1 or 2 —
// its "1%" is round(0.01*255)=3 — so 3 is the lowest value that survives the
// 255->100 conversion under floor or round-to-nearest.
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

// HA's supported_color_modes vocabulary: onoff, brightness, rgb, rgbw,
// rgbww, hs, xy, color_temp, white. Anything past plain "onoff" implies
// brightness is meaningful; only rgb/rgbw/rgbww/hs/xy are real color. Gating
// on this rather than whether the last-read state happened to include a
// brightness number matters for a device that's currently off — HA still
// reports supported_color_modes then, just no live brightness value.
const BRIGHTNESS_CAPABLE_MODES = new Set(["brightness", "rgb", "rgbw", "rgbww", "hs", "xy", "color_temp", "white"]);
const COLOR_CAPABLE_MODES = new Set(["rgb", "rgbw", "rgbww", "hs", "xy"]);

export function haLightSupportsBrightness(state) {
  return Array.isArray(state?.supportedColorModes) && state.supportedColorModes.some((mode) => BRIGHTNESS_CAPABLE_MODES.has(mode));
}

export function haLightSupportsColor(state) {
  return Array.isArray(state?.supportedColorModes) && state.supportedColorModes.some((mode) => COLOR_CAPABLE_MODES.has(mode));
}
