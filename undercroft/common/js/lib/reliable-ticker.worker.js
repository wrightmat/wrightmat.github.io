// The Worker script behind reliable-interval.js's createReliableInterval —
// see that file for why. Just runs setInterval and posts {tick: true} back;
// never touches the DOM. Classic (non-module) worker for broadest support.
// No "stop" handling — the wrapper's stop() calls worker.terminate()
// directly, which tears the whole worker down.
self.onmessage = (event) => {
  const data = event.data || {};
  if (data.action === "start") {
    self.setInterval(() => self.postMessage({ tick: true }), data.ms);
  }
};
