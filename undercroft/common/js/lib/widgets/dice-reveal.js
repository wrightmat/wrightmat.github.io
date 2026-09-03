// A remote viewer's own replay of a Broadcast-mode roll — deliberately not
// dice-box (dice-overlay.js): dice-box has no way to force a physics roll to
// land on a predetermined result, only to read back whatever it randomly
// settles on, so a second independent roll on a remote screen could only ever
// show a different outcome than the poster's own.
//
// Sidesteps that by not simulating anything: a plain DOM/CSS tile per die
// cycles through values for a moment (reads as "still determining a result")
// before landing on the REAL settled value from `dieResults` (dice-roll.js's
// own tryOverlayRoll, which already computes these on the poster's screen).
import { el } from "../dom.js";

const LINGER_MS = 2200;
const SPIN_DURATION_MS = 650;
// Each tile starts spinning slightly later than the previous one — reads as
// a roll landing tile-by-tile rather than snapping into place at once.
const TILE_STAGGER_MS = 90;

let overlayEl = null;
let hideTimer = null;

function ensureOverlay() {
  if (overlayEl && document.body.contains(overlayEl)) {
    return overlayEl;
  }
  overlayEl = document.createElement("div");
  overlayEl.className = "dice-reveal-overlay";
  document.body.appendChild(overlayEl);
  return overlayEl;
}

// A plausible placeholder face while a tile is still "spinning" — never the
// real answer.
function randomFace(sides) {
  const n = Number(sides);
  if (!Number.isFinite(n) || n <= 0) return "?";
  return String(1 + Math.floor(Math.random() * n));
}

function animateTile(faceEl, sides, finalValue, delayMs) {
  let start = null;
  function tick(now) {
    if (start === null) start = now + delayMs;
    if (now < start) {
      requestAnimationFrame(tick);
      return;
    }
    const elapsed = now - start;
    if (elapsed >= SPIN_DURATION_MS) {
      faceEl.textContent = finalValue;
      faceEl.classList.add("is-settled");
      return;
    }
    faceEl.textContent = randomFace(sides);
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
}

// `dieResults`: [{sides, value}, ...], the real settled values from the
// poster's physical roll. No-ops quietly when empty — a roll that fell
// through to the plain Math.random fallback path never has any (see
// tryOverlayRoll), so there's nothing physical to display here.
export function playDiceReveal({ label = "", total = "", dieResults = [] } = {}) {
  if (typeof window === "undefined" || !Array.isArray(dieResults) || !dieResults.length) {
    return;
  }
  const container = ensureOverlay();
  container.innerHTML = "";
  if (hideTimer) {
    clearTimeout(hideTimer);
    hideTimer = null;
  }
  const tray = el("div", "dice-reveal-tray");
  dieResults.forEach((die, index) => {
    const tile = el("div", "dice-reveal-tile");
    const face = el("div", "dice-reveal-face", "?");
    const dieLabel = el("div", "dice-reveal-die-label", `d${die.sides}`);
    tile.append(face, dieLabel);
    tray.appendChild(tile);
    animateTile(face, die.sides, String(die.value), index * TILE_STAGGER_MS);
  });
  const captionText = label ? `${label} → ${total}` : `→ ${total}`;
  const caption = el("div", "dice-reveal-caption", captionText);
  container.append(tray, caption);
  container.classList.add("is-visible");
  const totalDuration = dieResults.length * TILE_STAGGER_MS + SPIN_DURATION_MS + LINGER_MS;
  hideTimer = setTimeout(() => {
    hideTimer = null;
    container.classList.remove("is-visible");
  }, totalDuration);
}
