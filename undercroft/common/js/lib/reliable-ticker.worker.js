// The actual Web Worker script behind reliable-interval.js's own
// createReliableInterval — see that file's header comment for why this
// exists at all. This file's whole job is running one setInterval and
// posting a `{tick: true}` message back to the main thread on every tick;
// it never touches the DOM, fetches anything, or knows what its ticks are
// even for. A classic (non-module) worker on purpose — nothing here needs
// ES module features, and classic workers have the broadest browser support.
//
// No "stop" handling here — the wrapper's own stop() just calls
// worker.terminate() directly, which tears this whole worker (and its
// setInterval) down unconditionally; there's nothing left for this script
// to clean up on its own.
self.onmessage = (event) => {
  const data = event.data || {};
  if (data.action === "start") {
    self.setInterval(() => self.postMessage({ tick: true }), data.ms);
  }
};
