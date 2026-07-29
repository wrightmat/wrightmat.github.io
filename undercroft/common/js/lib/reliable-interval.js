// A drop-in window.setInterval/clearInterval replacement that keeps firing
// at its intended cadence even when this window/tab loses focus or is
// backgrounded — plain setInterval gets aggressively throttled by the
// browser in that state, which is exactly the problem for the Dashboard's
// second-screen mirror window (dashboard.js's own renderScreenView) meant to
// sit unfocused on a physical second screen — confirmed directly as the
// cause of "content doesn't update unless the window is given focus."
//
// A dedicated Web Worker's own timers are NOT subject to that same
// page-visibility-based throttling (a worker isn't a "page" with a
// visibility state at all), so the actual setInterval runs inside one
// (reliable-ticker.worker.js) and this just gets tapped on the shoulder
// (postMessage) each tick to run the real callback back on the main thread,
// where it can touch the DOM/fetch/etc. One worker per createReliableInterval
// call — simple, and confirmed reliable for a single window (the mirror,
// plus whichever widgets it mounts, all share this one window/JS realm)
// sitting unfocused (but visible) on a second monitor.
//
// Known limitation, investigated and NOT resolved: back when the Dashboard
// popped out one separate window per widget, two or more of those unfocused
// at once stalled updates in all of them regardless of this file's own
// approach — tried both this (one dedicated Worker per window) and
// consolidating onto one SharedWorker shared by every window, plus an
// audio-priority-boost trick and a meta-refresh fallback; none of it
// survived multiple simultaneously-unfocused windows. Most likely Chrome
// budgets CPU/scheduling priority across a whole origin's background
// renderer processes collectively, not just per-timer-mechanism — a
// constraint this file can't route around from pure client-side JS. Now
// moot for the Dashboard itself (the mirror is a single window), but worth
// knowing before building any other multi-window feature on this module.
//
// Deliberately a swap-in-place replacement (same callback, same interval,
// same {stop()} shape as clearInterval) rather than a new opt-in API each
// caller has to branch on — every existing caller keeps working exactly as
// before if a Worker can't be created for any reason (very old browsers,
// a blocked worker-scripts CSP, ...): it just quietly falls back to plain
// setInterval, the same behavior it had before this module existed.
const WORKER_URL = new URL("./reliable-ticker.worker.js", import.meta.url);

export function createReliableInterval(callback, ms) {
  let stopped = false;
  let worker = null;
  let fallbackId = 0;

  function useFallback() {
    if (stopped || fallbackId) return;
    fallbackId = window.setInterval(() => {
      if (!stopped) callback();
    }, ms);
  }

  try {
    worker = new Worker(WORKER_URL);
    worker.onmessage = (event) => {
      if (!stopped && event.data?.tick) callback();
    };
    worker.onerror = () => {
      worker?.terminate();
      worker = null;
      useFallback();
    };
    worker.postMessage({ action: "start", ms });
  } catch (error) {
    useFallback();
  }

  return {
    stop() {
      if (stopped) return;
      stopped = true;
      if (worker) {
        // terminate() alone fully tears the worker down regardless of
        // pending messages — no need to also post an explicit "stop" first.
        worker.terminate();
        worker = null;
      }
      if (fallbackId) {
        window.clearInterval(fallbackId);
        fallbackId = 0;
      }
    },
  };
}
