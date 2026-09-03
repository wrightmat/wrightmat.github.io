// A drop-in setInterval/clearInterval replacement that keeps firing at its
// intended cadence when this window/tab is unfocused/backgrounded — plain
// setInterval gets throttled by the browser in that state, which broke the
// Dashboard's second-screen mirror window. A Web Worker's own timers aren't
// subject to that page-visibility throttling (a worker isn't a "page"), so
// the real setInterval runs inside one (reliable-ticker.worker.js) and
// postMessage taps this module on the shoulder each tick to run the actual
// callback back on the main thread.
//
// Same {stop()} shape as clearInterval, and falls back silently to plain
// setInterval if a Worker can't be created (old browser, blocked CSP) — no
// caller has to branch on which path is active.
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
