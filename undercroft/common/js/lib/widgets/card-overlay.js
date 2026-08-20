// A card draw's own reveal — the cards-side counterpart to dice-reveal.js,
// but genuinely simpler: a card's outcome is already fully determined the
// instant it's drawn (deck.js's drawCard), so unlike a Broadcast dice roll
// there's no cross-client physics-sync problem to design around at all.
// Every viewer just plays the identical deal-and-flip sequence off the same
// spotlight `data` payload it already received (see dashboard.js's own
// spotlight-watcher hook) — no forced-result spike, no new transport, no new
// SSE kind, just a page-level singleton overlay div (same shape as
// dice-overlay.js/dice-reveal.js) built from real CSS 3D transforms.
import { el } from "../dom.js";

const LINGER_MS = 2600;
const DEAL_DURATION_MS = 500;
const FLIP_DURATION_MS = 450;
// Each card starts dealing this much later than the previous one — a
// multi-card spread (e.g. a 3-card tarot draw) reads as cards being laid
// down one at a time, not all landing in unison.
const CARD_STAGGER_MS = 150;
// Gap between a card finishing its deal-in motion and starting its flip —
// reads as "it lands, THEN turns over," not both happening at once.
const FLIP_PAUSE_MS = 150;

let overlayEl = null;
let hideTimer = null;

function ensureOverlay() {
  if (overlayEl && document.body.contains(overlayEl)) {
    return overlayEl;
  }
  overlayEl = document.createElement("div");
  overlayEl.className = "card-reveal-overlay";
  document.body.appendChild(overlayEl);
  return overlayEl;
}

function buildCardEl(card, backImage, delayMs) {
  const wrap = el("div", "card-reveal-card");
  wrap.style.animationDelay = `${delayMs}ms`;
  const inner = el("div", "card-reveal-inner");
  const back = el("div", "card-reveal-face card-reveal-face-back");
  if (backImage) {
    back.style.backgroundImage = `url("${backImage}")`;
  } else {
    back.appendChild(el("div", "card-reveal-face-placeholder", "🂠"));
  }
  const front = el("div", "card-reveal-face card-reveal-face-front");
  if (card.image) {
    front.style.backgroundImage = `url("${card.image}")`;
  } else {
    front.appendChild(el("div", "card-reveal-face-placeholder", card.label || ""));
  }
  inner.append(back, front);
  wrap.appendChild(inner);
  const flipDelay = delayMs + DEAL_DURATION_MS + FLIP_PAUSE_MS;
  window.setTimeout(() => {
    inner.classList.add("is-flipped");
  }, flipDelay);
  return { wrap, flipDelay };
}

// `cards`: [{label, image}, ...] — one entry for a single draw, several for
// a spread (Part 6's Deck widget, or any System/macro that wants more than
// one card at once — same per-card sequence, just staggered, no separate
// animation to build for that case). `backImage` is the deck's own back
// face (deck.js's extractSystemDecks) — falls back to a plain card-back
// glyph when a deck doesn't set one, same "never a broken/guessed image URL"
// reasoning the starter decks themselves follow (blank `image`/`backImage`
// rather than an unverified external link).
export function playCardReveal({ cards = [], backImage = "" } = {}) {
  if (typeof window === "undefined") return;
  const list = Array.isArray(cards) ? cards.filter((card) => card && (card.label || card.image)) : [];
  if (!list.length) return;
  const container = ensureOverlay();
  container.innerHTML = "";
  if (hideTimer) {
    clearTimeout(hideTimer);
    hideTimer = null;
  }
  const tray = el("div", "card-reveal-tray");
  let maxFlipDelay = 0;
  list.forEach((card, index) => {
    const { wrap, flipDelay } = buildCardEl(card, backImage, index * CARD_STAGGER_MS);
    maxFlipDelay = Math.max(maxFlipDelay, flipDelay);
    tray.appendChild(wrap);
  });
  const captionText = list.map((card) => card.label).filter(Boolean).join(", ");
  const caption = el("div", "card-reveal-caption", captionText);
  container.append(tray, caption);
  // Visible immediately — no need to wait a frame, each card's own deal-in
  // animation (shell.css) already reads as "just appeared."
  container.classList.add("is-visible");
  const totalDuration = maxFlipDelay + FLIP_DURATION_MS + LINGER_MS;
  hideTimer = setTimeout(() => {
    hideTimer = null;
    container.classList.remove("is-visible");
  }, totalDuration);
}
