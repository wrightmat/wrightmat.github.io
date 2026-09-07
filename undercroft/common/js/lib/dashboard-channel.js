// A lightweight, best-effort "is a Dashboard tab already open" handshake for
// the Start Encounter modal's "My open Dashboard tab" destination.
// BroadcastChannel is the only way a page can ask "is anyone else out
// there" without a server round-trip — there is no way for page script to
// enumerate the browser's own open tabs. It's same-browser-profile scoped
// (a BroadcastChannel never crosses browser/profile boundaries), which
// matches the ask exactly: "a tab I already have open," not any tab
// anywhere. `window.open(url, name)` was considered instead, but modern
// browsers only reuse a named target within the same "unit of related
// browsing contexts" (tabs traceable back through an opener chain) — a
// Dashboard tab opened by typing the URL or from a bookmark has no such
// relation and would never be found that way.
const CHANNEL_NAME = "undercroft-dashboard";

function randomRequestId() {
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

// Called once by dashboard.js's own bootstrap, for every Dashboard tab
// regardless of auth/mode — replies to a presence ping, and on a real
// hand-off request reloads it onto the requested encounter with `&flash=1`
// (see flashTabTitle below — a plain script CANNOT bring an unrelated
// background tab to the foreground, so this settles for making the tab easy
// to spot instead of pretending to switch to it). A real navigation (not an
// in-place widget retarget) also reuses the exact same `?encounter=` boot
// path a fresh link already goes through (dashboard.js reads it once at
// load time), rather than a second, parallel "retarget the live page" code
// path that could drift from it.
export function listenForDashboardRequests() {
  if (typeof BroadcastChannel === "undefined") return () => {};
  const channel = new BroadcastChannel(CHANNEL_NAME);
  channel.addEventListener("message", (event) => {
    const { type, requestId, encounterId } = event.data || {};
    if (type === "ping") {
      channel.postMessage({ type: "pong", requestId });
    } else if (type === "focus-encounter" && encounterId) {
      channel.postMessage({ type: "ack", requestId });
      window.location.href = `index.html?encounter=${encodeURIComponent(encounterId)}&flash=1`;
    }
  });
  return () => channel.close();
}

// Chrome (and every other modern browser) deliberately blocks a script from
// forcing an unrelated background tab into the foreground — window.focus()
// on this tab from a BroadcastChannel message handler is silently ignored,
// since there's no live user gesture at that moment (this is intentional
// anti "focus-stealing" behavior, not a bug to work around). The next best
// thing: flash the tab's own title until the GM actually clicks over to it
// (or a bounded time passes), so it's obvious which tab just changed rather
// than looking untouched. Called once by dashboard.js's own bootstrap when
// it detects it was loaded via the hand-off above (`?flash=1`).
export function flashTabTitle(message, { intervalMs = 800, maxDurationMs = 8000 } = {}) {
  if (typeof document === "undefined") return;
  const original = document.title;
  let showingFlash = false;
  const timer = window.setInterval(() => {
    showingFlash = !showingFlash;
    document.title = showingFlash ? message : original;
  }, intervalMs);
  function stop() {
    window.clearInterval(timer);
    window.clearTimeout(timeout);
    document.title = original;
    document.removeEventListener("visibilitychange", onVisible);
  }
  function onVisible() {
    if (document.visibilityState === "visible") stop();
  }
  document.addEventListener("visibilitychange", onVisible);
  const timeout = window.setTimeout(stop, maxDurationMs);
}

// Resolves true once at least one Dashboard tab answers within `timeoutMs`
// — used only to decide whether to SHOW the "existing tab" option at all
// when the Start Encounter modal opens. requestDashboardFocus below does
// its own fresh handshake at submit time regardless, since a tab detected
// here could close (or navigate away) in the meantime.
export function pingForDashboardTab(timeoutMs = 400) {
  if (typeof BroadcastChannel === "undefined") return Promise.resolve(false);
  return new Promise((resolve) => {
    const channel = new BroadcastChannel(CHANNEL_NAME);
    const requestId = randomRequestId();
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      channel.close();
      resolve(result);
    };
    channel.addEventListener("message", (event) => {
      if (event.data?.type === "pong" && event.data?.requestId === requestId) finish(true);
    });
    channel.postMessage({ type: "ping", requestId });
    window.setTimeout(() => finish(false), timeoutMs);
  });
}

// The actual hand-off — resolves true only once some tab acknowledges and
// took it, so the caller knows whether it still needs to open/navigate a
// tab itself as a fallback (nobody answered after all).
export function requestDashboardFocus(encounterId, timeoutMs = 400) {
  if (typeof BroadcastChannel === "undefined") return Promise.resolve(false);
  return new Promise((resolve) => {
    const channel = new BroadcastChannel(CHANNEL_NAME);
    const requestId = randomRequestId();
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      channel.close();
      resolve(result);
    };
    channel.addEventListener("message", (event) => {
      if (event.data?.type === "ack" && event.data?.requestId === requestId) finish(true);
    });
    channel.postMessage({ type: "focus-encounter", requestId, encounterId });
    window.setTimeout(() => finish(false), timeoutMs);
  });
}
