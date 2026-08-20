// A remote viewer's own replay of a Broadcast-mode roll (Cards/Decks plan,
// Part 2) — deliberately NOT dice-box (dice-overlay.js). Confirmed directly
// against dice-box's own docs and its actual vendored source: it has no
// supported way to force a physics roll to land on a predetermined result,
// only to read back whatever it randomly settles on. An independent physics
// roll on a remote screen can therefore only ever show a DIFFERENT outcome
// than the poster's own — a text caption papering over that mismatch isn't
// the same as an actual synced roll, and doesn't honor the real ask.
//
// This sidesteps the problem entirely by not simulating anything: a plain
// DOM/CSS tile per die that visibly cycles through values for a moment (a
// "spin," reading clearly as "still determining a result") before landing
// on the REAL settled value from `dieResults` (dice-roll.js's own
// tryOverlayRoll, which already computes these physically on the poster's
// own screen — previously discarded, now captured and broadcast). Because
// nothing here is actually random or physically simulated, it can always
// display the true result — the one thing a second independent dice-box
// roll could never guarantee.
import { el } from "../dom.js";

const LINGER_MS = 2200;
const SPIN_DURATION_MS = 650;
// Each tile starts its own spin this much later than the previous one —
// reads as a real roll landing tile-by-tile rather than everything
// snapping into place in perfect unison.
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

// A plausible-looking placeholder face while a tile is still "spinning" —
// never the real answer, just something that reads as "still rolling."
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

// `dieResults`: [{sides, value}, ...] — the REAL settled values from the
// poster's own physical roll. `label`/`total` build the caption underneath
// the tiles (the same information the group-log entry already carries).
// No-ops quietly if there's nothing to show — a roll broadcast with no
// captured dieResults (the plain Math.random fallback path never has any,
// see tryOverlayRoll's own comment) has nothing physical to display here.
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
  // Visible immediately — no need to wait a frame, the tiles' own pop-in
  // animation (shell.css) already reads as "just appeared."
  container.classList.add("is-visible");
  const totalDuration = dieResults.length * TILE_STAGGER_MS + SPIN_DURATION_MS + LINGER_MS;
  hideTimer = setTimeout(() => {
    hideTimer = null;
    container.classList.remove("is-visible");
  }, totalDuration);
}
