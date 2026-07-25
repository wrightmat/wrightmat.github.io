// Thin wrapper around the /live/{groupId} SSE stream (server/app.py) — a
// "wake up sooner" layer over whatever polling a widget already does, not a
// replacement for it. Every consumer (combat-tracker.js, game-log.js,
// now-showing.js) keeps its existing setInterval poll running unchanged;
// this just calls the same refresh function sooner when something relevant
// changes, and quietly does nothing if EventSource isn't available or the
// stream can't connect — polling alone is a completely normal, supported
// state, not a fallback path that needs special handling by callers.
//
// EventSource can't set a custom Authorization header, so the session token
// travels as a query param instead (same token, different place it has to
// come from) — see server/app.py's _handle_live_stream for the other side.

const RECONNECT_BASE_MS = 1000;
const RECONNECT_MAX_MS = 15000;

export function connectLiveStream({ dataManager, groupId, kinds = [], shareToken = "" } = {}) {
  const noop = { subscribe: () => () => {}, close() {} };
  if (typeof EventSource === "undefined" || !dataManager || !groupId || !kinds.length) {
    return noop;
  }

  const listeners = new Map();
  let source = null;
  let reconnectTimer = 0;
  let reconnectDelay = RECONNECT_BASE_MS;
  let closed = false;

  function buildUrl() {
    const base = dataManager.baseUrl || "";
    const params = new URLSearchParams();
    params.set("kinds", kinds.join(","));
    const token = dataManager.session?.token || "";
    if (token) params.set("token", token);
    if (shareToken) params.set("share", shareToken);
    return `${base}/live/${encodeURIComponent(groupId)}?${params.toString()}`;
  }

  function scheduleReconnect() {
    if (closed) return;
    window.clearTimeout(reconnectTimer);
    reconnectTimer = window.setTimeout(connect, reconnectDelay);
    reconnectDelay = Math.min(reconnectDelay * 2, RECONNECT_MAX_MS);
  }

  function connect() {
    if (closed) return;
    let next;
    try {
      next = new EventSource(buildUrl());
    } catch (error) {
      scheduleReconnect();
      return;
    }
    next.onopen = () => {
      reconnectDelay = RECONNECT_BASE_MS;
    };
    next.onmessage = (event) => {
      if (!event.data) return;
      let payload;
      try {
        payload = JSON.parse(event.data);
      } catch (error) {
        return;
      }
      const kind = payload?.kind;
      if (!kind) return;
      const fns = listeners.get(kind);
      if (fns) fns.forEach((fn) => fn(payload));
    };
    next.onerror = () => {
      next.close();
      // A stream is deliberately capped server-side (see LIVE_STREAM_SECONDS
      // in server/app.py) and closes on its own once that's up — that also
      // fires onerror (readyState transitions through CLOSED either way),
      // so a normal cap-driven close and a real connection failure both end
      // up here and both just reconnect the same way.
      scheduleReconnect();
    };
    source = next;
  }

  connect();

  return {
    subscribe(kind, onChanged) {
      if (typeof onChanged !== "function") return () => {};
      if (!listeners.has(kind)) listeners.set(kind, new Set());
      listeners.get(kind).add(onChanged);
      return () => {
        listeners.get(kind)?.delete(onChanged);
      };
    },
    close() {
      closed = true;
      window.clearTimeout(reconnectTimer);
      source?.close();
      listeners.clear();
    },
  };
}
