// Unified shape/effect preset registry — mirrors pattern-library.js's own
// shape exactly (flat array, {id, category, label, colorSlots[], params[]}),
// just swapping that file's `buildSvg(values) => svgString` for a
// per-preset render function, since these render into a live SVG/Canvas
// element instead of producing a static image. Two kinds of preset:
//
// - `kind: "geometry"` ("shapes" category — circle/cone/line/square,
//   migrated in from the old standalone AOE_SHAPE_TYPES array/dispatch-
//   on-type-string renderer, orrery/js/lib/map-viewer.js). `draw(cx, cy,
//   sizePx, element)` returns the SVG element describing just the shape's
//   OWN geometry (no fill/stroke/opacity applied — that stays common code
//   in renderShapeElement, identical for every geometry preset). Renders
//   once; re-drawn only when a property changes.
// - `kind: "particles"` ("effects" AND "weather" categories — burst/beam/
//   cone-blast/pulse/campfire/fountain, and rain/snow/dust/embers/petals/
//   bubbles — same `kind`, same rendering pipeline, same Loop/Label/Play
//   capability throughout; "weather" is a separate CATEGORY purely for
//   picker organization, not a different render path). Every preset also
//   declares a fixed `duration` (ms) and a `seed(sizePx)` — called ONCE
//   when a cycle starts, returning whatever per-particle random state that
//   preset needs (an array of angle/speed/size, for the scatter-based
//   presets) or `null` for presets with no persistent random state. The
//   caller holds onto whatever `seed()` returned and passes it back into
//   every `run()` call for that cycle as `particles`, so a burst's
//   individual particles don't re-randomize every single frame.
//   `run(ctx, cx, cy, sizePx, elapsedMs, values, particles, element)` draws
//   one animation frame into a 2D canvas context and returns `true` while
//   the cycle should keep animating, `false` once `elapsedMs` has passed
//   its own `duration` — driven by requestAnimationFrame in the caller
//   (orrery/js/lib/map-viewer.js and common/js/lib/widgets/map.js). The
//   canvas itself is always a square of `cx * 2` (== `cy * 2`) pixels on a
//   side (map-viewer.js's own `Math.max(120, sizePx * 3)`) — a "weather"
//   preset covering the WHOLE canvas (rain/snow/etc, particles spawned
//   across the full area and wrapping at the edges) rather than radiating
//   from the center is just a different `run()` shape reading `cx * 2`/
//   `cy * 2` as its own width/height, not a structurally different kind of
//   thing: it's still placed, sized, dragged, and triggered exactly like a
//   Burst — a GM drags it out LARGE to cover a whole battle map, or small
//   for a localized patch of dust in one corner.
//   Looping is entirely the CALLER's job, not any individual preset's:
//   when a `loop: true` element's `run()` returns false, the caller calls
//   `seed()` again and resets elapsedMs to 0 to start the next cycle; a
//   `loop: false` element just stops. `cone-blast`, not `cone`, to avoid
//   colliding with the shapes category's own "cone" id in the same picker.
//
// Geometry (position/size/angle/spread/width) lives on the ELEMENT itself
// (orrery/js/lib/map-model.js's createVectorShapeElement) for every preset,
// shape or effect alike — placed via the exact same drag-to-place gesture
// either way. colorSlots/params are the only PER-PRESET customization.
//
// `run()` reads `this.duration` — always call it as `preset.run(...)`
// (method-call form), never destructured into a bare function reference,
// or `this` won't be bound to the preset and `this.duration` breaks.

function polygonAttr(el, points) {
  el.setAttribute("points", points.map((point) => `${point.x},${point.y}`).join(" "));
  return el;
}

// Scales a preset's own particle count so DENSITY stays roughly constant
// as sizePx grows, instead of a fixed count spreading thinner and thinner
// across a bigger area — confirmed real complaint: a large effect looked
// far sparser than a small one dragged from the same preset. Most presets
// scatter particles across a 2D area (radiating outward from center, or —
// for weather — the whole canvas), so count scales with AREA (sizePx²,
// `exponent`'s default) — Beam is the one exception, scattering along a
// LINE instead, so it passes `exponent: 1` (length, not area). `base` is
// the count this preset already looks right at `referenceSizePx` (100px —
// roughly a 2-cell/10ft placement at the default 50px/cell, which is what
// every existing preset's own original hardcoded count was actually tuned
// against). min/max keep a degenerate sizePx (0, or a map-spanning drag)
// from collapsing to nothing or exploding into thousands of draw calls per
// frame.
function scaledParticleCount(sizePx, { base, referenceSizePx = 100, exponent = 2, min = 4, max = 500 } = {}) {
  const scale = Math.pow(Math.max(1, sizePx) / referenceSizePx, exponent);
  return Math.max(min, Math.min(max, Math.round(base * scale)));
}

export const SHAPE_EFFECT_CATEGORIES = [
  { id: "shapes", label: "Shapes" },
  { id: "effects", label: "Effects" },
  { id: "weather", label: "Weather" },
];

export const SHAPE_EFFECT_PRESETS = [
  // --- Shapes (kind: "geometry") ---
  {
    id: "circle",
    category: "shapes",
    label: "Circle",
    kind: "geometry",
    colorSlots: [
      { key: "fill", label: "Fill", default: "#93c5fd" },
      { key: "stroke", label: "Outline", default: "#0f172a" },
    ],
    params: [],
    draw(cx, cy, sizePx) {
      const el = document.createElementNS("http://www.w3.org/2000/svg", "circle");
      el.setAttribute("cx", String(cx));
      el.setAttribute("cy", String(cy));
      el.setAttribute("r", String(sizePx));
      return el;
    },
  },
  {
    id: "square",
    category: "shapes",
    label: "Square",
    kind: "geometry",
    colorSlots: [
      { key: "fill", label: "Fill", default: "#93c5fd" },
      { key: "stroke", label: "Outline", default: "#0f172a" },
    ],
    params: [],
    draw(cx, cy, sizePx) {
      const el = document.createElementNS("http://www.w3.org/2000/svg", "rect");
      el.setAttribute("x", String(cx - sizePx / 2));
      el.setAttribute("y", String(cy - sizePx / 2));
      el.setAttribute("width", String(sizePx));
      el.setAttribute("height", String(sizePx));
      return el;
    },
  },
  {
    id: "cone",
    category: "shapes",
    label: "Cone",
    kind: "geometry",
    colorSlots: [
      { key: "fill", label: "Fill", default: "#93c5fd" },
      { key: "stroke", label: "Outline", default: "#0f172a" },
    ],
    params: [],
    draw(cx, cy, sizePx, element) {
      const angleRad = ((element.angleDeg || 0) * Math.PI) / 180;
      const spreadRad = ((element.spreadDeg ?? 53) * Math.PI) / 180;
      const leftRad = angleRad - spreadRad / 2;
      const rightRad = angleRad + spreadRad / 2;
      const el = document.createElementNS("http://www.w3.org/2000/svg", "polygon");
      return polygonAttr(el, [
        { x: cx, y: cy },
        { x: cx + sizePx * Math.cos(leftRad), y: cy + sizePx * Math.sin(leftRad) },
        { x: cx + sizePx * Math.cos(rightRad), y: cy + sizePx * Math.sin(rightRad) },
      ]);
    },
  },
  {
    id: "line",
    category: "shapes",
    label: "Line",
    kind: "geometry",
    colorSlots: [
      { key: "fill", label: "Fill", default: "#93c5fd" },
      { key: "stroke", label: "Outline", default: "#0f172a" },
    ],
    params: [],
    draw(cx, cy, sizePx, element, pixelsPerCell) {
      const angleRad = ((element.angleDeg || 0) * Math.PI) / 180;
      const dirX = Math.cos(angleRad);
      const dirY = Math.sin(angleRad);
      const perpX = -dirY;
      const perpY = dirX;
      const halfWidthPx = ((element.widthCells || 1) * pixelsPerCell) / 2;
      const farX = cx + dirX * sizePx;
      const farY = cy + dirY * sizePx;
      const el = document.createElementNS("http://www.w3.org/2000/svg", "polygon");
      return polygonAttr(el, [
        { x: cx + perpX * halfWidthPx, y: cy + perpY * halfWidthPx },
        { x: farX + perpX * halfWidthPx, y: farY + perpY * halfWidthPx },
        { x: farX - perpX * halfWidthPx, y: farY - perpY * halfWidthPx },
        { x: cx - perpX * halfWidthPx, y: cy - perpY * halfWidthPx },
      ]);
    },
  },

  // --- Effects (kind: "particles") ---
  {
    id: "burst",
    category: "effects",
    label: "Burst",
    kind: "particles",
    colorSlots: [{ key: "color", label: "Color", default: "#ff6600" }],
    params: [],
    duration: 900,
    seed(sizePx) {
      const count = scaledParticleCount(sizePx, { base: 28 });
      return Array.from({ length: count }, (_, i) => {
        const angle = (Math.PI * 2 * i) / count + Math.random() * 0.3;
        const speed = sizePx * (0.6 + Math.random() * 0.5);
        return { angle, speed, size: 2 + Math.random() * 3 };
      });
    },
    run(ctx, cx, cy, sizePx, elapsedMs, values, particles) {
      const t = Math.min(1, elapsedMs / this.duration);
      const eased = 1 - Math.pow(1 - t, 2);
      ctx.save();
      particles.forEach((p) => {
        const dist = p.speed * eased;
        const x = cx + Math.cos(p.angle) * dist;
        const y = cy + Math.sin(p.angle) * dist;
        ctx.globalAlpha = Math.max(0, 1 - t);
        ctx.fillStyle = values.color;
        ctx.beginPath();
        ctx.arc(x, y, Math.max(0.5, p.size * (1 - t * 0.6)), 0, Math.PI * 2);
        ctx.fill();
      });
      // A brief bright flash at the core reads as the "detonation" moment.
      ctx.globalAlpha = Math.max(0, 1 - t * 3);
      ctx.fillStyle = "#ffffff";
      ctx.beginPath();
      ctx.arc(cx, cy, sizePx * 0.25 * (1 - t), 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
      return t < 1;
    },
  },
  {
    id: "beam",
    category: "effects",
    label: "Beam",
    kind: "particles",
    colorSlots: [{ key: "color", label: "Color", default: "#38bdf8" }],
    params: [],
    duration: 700,
    // Was a single gradient-stroke line — replaced with an actual stream of
    // particles flying from origin toward angleDeg, per the user's own
    // "is it possible to use actual particles instead" ask. Same id/
    // colorSlots/duration as before (an already-placed Beam element's own
    // data needs no migration), just a different `run()`.
    seed(sizePx) {
      // Length-based, not area — a beam's width barely grows with sizePx
      // (halfWidth below stays capped near a small fraction of it), so its
      // own density concern is particles-per-unit-LENGTH along the bolt.
      const count = scaledParticleCount(sizePx, { base: 26, exponent: 1 });
      return Array.from({ length: count }, () => ({
        // Staggered emission within the first half of the cycle, not all at
        // once — reads as a continuous bolt made of individual particles
        // rather than one big blob launching together.
        startT: Math.random() * 0.5,
        jitter: (Math.random() - 0.5) * 2,
        jitterSeed: Math.random() * Math.PI * 2,
        size: 1.5 + Math.random() * 2.5,
      }));
    },
    run(ctx, cx, cy, sizePx, elapsedMs, values, particles, element) {
      const t = Math.min(1, elapsedMs / this.duration);
      const angleRad = ((element.angleDeg || 0) * Math.PI) / 180;
      const dirX = Math.cos(angleRad);
      const dirY = Math.sin(angleRad);
      const perpX = -dirY;
      const perpY = dirX;
      const halfWidth = Math.max(2, sizePx * 0.05);
      ctx.save();
      particles.forEach((p) => {
        if (t < p.startT) return;
        const localT = Math.min(1, (t - p.startT) / (1 - p.startT || 1));
        const dist = sizePx * localT;
        const wobble = Math.sin(localT * Math.PI * 4 + p.jitterSeed) * halfWidth * p.jitter;
        const x = cx + dirX * dist + perpX * wobble;
        const y = cy + dirY * dist + perpY * wobble;
        ctx.globalAlpha = Math.max(0, 1 - localT * 0.8) * Math.max(0, 1 - t * 0.3);
        ctx.fillStyle = localT < 0.25 ? "#ffffff" : values.color;
        ctx.beginPath();
        ctx.arc(x, y, Math.max(0.5, p.size * (1 - localT * 0.4)), 0, Math.PI * 2);
        ctx.fill();
      });
      ctx.restore();
      return t < 1;
    },
  },
  {
    id: "cone-blast",
    category: "effects",
    label: "Cone Blast",
    kind: "particles",
    colorSlots: [{ key: "color", label: "Color", default: "#a855f7" }],
    params: [],
    duration: 850,
    seed(sizePx) {
      const count = scaledParticleCount(sizePx, { base: 24 });
      return Array.from({ length: count }, () => ({
        spreadOffset: (Math.random() - 0.5),
        speedScale: 0.7 + Math.random() * 0.4,
        size: 2 + Math.random() * 3,
      }));
    },
    run(ctx, cx, cy, sizePx, elapsedMs, values, particles, element) {
      const t = Math.min(1, elapsedMs / this.duration);
      const eased = 1 - Math.pow(1 - t, 2);
      const angleRad = ((element.angleDeg || 0) * Math.PI) / 180;
      const spreadRad = ((element.spreadDeg ?? 53) * Math.PI) / 180;
      ctx.save();
      particles.forEach((p) => {
        const a = angleRad + p.spreadOffset * spreadRad;
        const dist = sizePx * p.speedScale * eased;
        const x = cx + Math.cos(a) * dist;
        const y = cy + Math.sin(a) * dist;
        ctx.globalAlpha = Math.max(0, 1 - t);
        ctx.fillStyle = values.color;
        ctx.beginPath();
        ctx.arc(x, y, Math.max(0.5, p.size * (1 - t * 0.5)), 0, Math.PI * 2);
        ctx.fill();
      });
      ctx.restore();
      return t < 1;
    },
  },
  {
    id: "pulse",
    category: "effects",
    label: "Pulse",
    kind: "particles",
    colorSlots: [{ key: "color", label: "Color", default: "#facc15" }],
    params: [],
    duration: 1200,
    seed() {
      return null;
    },
    run(ctx, cx, cy, sizePx, elapsedMs, values) {
      // Same uniform contract every preset follows: one expanding ring per
      // `duration`, done (returns false) once elapsedMs reaches it. Looping
      // is entirely the CALLER's concern (Part 4) — when a loop:true
      // element's run() returns false, the caller resets elapsedMs to 0
      // and keeps animating; a loop:false element just stops. Keeping that
      // logic out of every individual preset (rather than each one having
      // to special-case "am I looping") is what lets every preset — this
      // one included — use the exact same "duration-based, false when
      // done" shape.
      const t = Math.min(1, elapsedMs / this.duration);
      const radius = sizePx * t;
      ctx.save();
      ctx.globalAlpha = Math.max(0, 1 - t);
      ctx.strokeStyle = values.color;
      ctx.lineWidth = Math.max(1, sizePx * 0.05 * (1 - t * 0.5));
      ctx.beginPath();
      ctx.arc(cx, cy, radius, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
      return t < 1;
    },
  },
  {
    id: "campfire",
    category: "effects",
    label: "Fire with Rising Smoke",
    kind: "particles",
    colorSlots: [
      { key: "flameColor", label: "Flame", default: "#ff7b25" },
      { key: "smokeColor", label: "Smoke", default: "#94a3b8" },
    ],
    params: [],
    // Long duration, loop:true by default — the canonical "burning
    // campfire" ambient case (see this registry's own header, and Part 4's
    // "a particle effect could definitely loop and be persistent at a
    // location" origin story). Every particle's own motion is computed from
    // `((elapsedMs / duration) + phase) % 1`, staggering each one to a
    // different point in its own single life-cycle — every particle
    // completes exactly one cycle across one `duration` window, so however
    // this preset happens to get re-seeded on loop (Part 4, caller-driven),
    // there's no visible "reset" moment, just continuous flicker.
    duration: 2200,
    // Redesigned from an original side-view take (flames/smoke rising
    // straight up) to match Orrery's actual top-down camera, the same
    // radiate-from-center language Fountain already establishes: flame
    // licks flicker and jitter close around the center point (no single
    // "up" direction to rise toward when you're looking straight down at
    // the fire), while smoke drifts and expands OUTWARD in every direction
    // as it thins with distance, the same way Fountain's own ripples
    // expand outward from its spray.
    seed(sizePx) {
      // Doubled again to 1000 (from 500). Separately: the reason 500 barely
      // looked different from 180 wasn't the count itself — it was that
      // `particles` never actually got re-randomized between loop cycles
      // (map-viewer.js's own renderParticleEffectElement, now fixed), so
      // every cycle replayed the EXACT same frozen pattern, making it read
      // as static "wallpaper" the eye tunes out rather than a busier,
      // denser flicker. max raised to match, so a large placement keeps
      // scaling density up instead of getting capped right at 1000.
      const flameCount = scaledParticleCount(sizePx, { base: 1000, max: 3000 });
      const smokeCount = scaledParticleCount(sizePx, { base: 24 });
      return {
        flame: Array.from({ length: flameCount }, () => ({
          phase: Math.random(),
          angle: Math.random() * Math.PI * 2,
          wobbleSeed: Math.random() * Math.PI * 2,
          reach: sizePx * (0.1 + Math.random() * 0.3),
          // Shrunk a third time (halved again) — small embers/licks read
          // as fire, big dots don't.
          size: sizePx * (0.011 + Math.random() * 0.01),
        })),
        smoke: Array.from({ length: smokeCount }, () => ({
          phase: Math.random(),
          angle: Math.random() * Math.PI * 2,
          wobbleSeed: Math.random() * Math.PI * 2,
          reach: sizePx * (0.6 + Math.random() * 0.8),
          size: sizePx * (0.16 + Math.random() * 0.16),
        })),
      };
    },
    run(ctx, cx, cy, sizePx, elapsedMs, values, particles, element) {
      ctx.save();
      // Soft ember glow at the very center, flickering independently of the
      // particles' own longer stagger cycle.
      const glowT = (elapsedMs % 400) / 400;
      const glow = ctx.createRadialGradient(cx, cy, 0, cx, cy, Math.max(1, sizePx * 0.4));
      glow.addColorStop(0, values.flameColor);
      glow.addColorStop(1, "transparent");
      ctx.globalAlpha = 0.35 + Math.sin(glowT * Math.PI * 2) * 0.1;
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(cx, cy, Math.max(1, sizePx * 0.4), 0, Math.PI * 2);
      ctx.fill();

      // Flame — drawn BEFORE smoke now (was after). Confirmed real bug:
      // smoke spawns at dist=0, the exact same point flame occupies, and
      // flame's own alpha (0.55-1.0) is high enough that drawing it SECOND
      // painted straight over smoke's own most-opaque moment, making it
      // effectively invisible — smoke only ever got a chance to show once
      // it had drifted far enough out to clear flame's own radius, by
      // which point its old fade curve (peak alpha right at spawn, only
      // fading down from there) had already faded it to nothing.
      particles.flame.forEach((p) => {
        const localT = (elapsedMs / this.duration + p.phase) % 1;
        // 0.03 (~4.8Hz) read as a strobe, not a flame — slowed to roughly
        // one flicker per second per particle; each one's own wobbleSeed
        // already keeps them out of phase with each other, so the SLOWER
        // per-particle rate still reads as a chaotic, organic flicker in
        // aggregate rather than everything pulsing in lockstep.
        const flicker = 0.5 + Math.sin(elapsedMs * 0.005 + p.wobbleSeed) * 0.5;
        const dist = p.reach * (0.4 + flicker * 0.6);
        const angle = p.angle + localT * Math.PI * 0.6;
        const x = cx + Math.cos(angle) * dist;
        const y = cy + Math.sin(angle) * dist;
        ctx.globalAlpha = 0.55 + flicker * 0.45;
        ctx.fillStyle = flicker > 0.7 ? "#fff3c4" : values.flameColor;
        ctx.beginPath();
        ctx.arc(x, y, Math.max(0.5, p.size * (0.6 + flicker * 0.6)), 0, Math.PI * 2);
        ctx.fill();
      });

      // Smoke — drawn on top of flame now, and its own alpha curve fades
      // IN over the first stretch of its journey (instead of starting at
      // peak opacity right where flame would cover it) before fading back
      // out as it thins with distance — so it actually becomes visible
      // only once it's cleared flame's own radius, not while buried under
      // it.
      particles.smoke.forEach((p) => {
        const localT = (elapsedMs / this.duration + p.phase) % 1;
        const wobble = Math.sin(localT * Math.PI * 3 + p.wobbleSeed) * sizePx * 0.1;
        const dist = p.reach * localT;
        const x = cx + Math.cos(p.angle) * dist + Math.cos(p.angle + Math.PI / 2) * wobble;
        const y = cy + Math.sin(p.angle) * dist + Math.sin(p.angle + Math.PI / 2) * wobble;
        const size = p.size * (0.5 + localT * 1.2);
        const fadeIn = Math.min(1, localT / 0.2);
        const fadeOut = Math.max(0, 1 - Math.max(0, localT - 0.2) / 0.8);
        ctx.globalAlpha = Math.max(0, 0.45 * fadeIn * fadeOut);
        ctx.fillStyle = values.smokeColor;
        ctx.beginPath();
        ctx.arc(x, y, size, 0, Math.PI * 2);
        ctx.fill();
      });
      ctx.restore();
      // Continuous simulation, not a discrete replayed cycle — while
      // looping (the common, ambient case), this NEVER signals "done," so
      // the caller (map-viewer.js) never resets elapsedMs back to 0.
      // Confirmed real bug this fixes: even with the particles themselves
      // re-seeded on loop restart, forcibly resetting elapsedMs made every
      // particle's own `(elapsedMs / duration + phase) % 1` term jump back
      // toward 0 in lockstep — a hard, visible "everything snaps back"
      // seam every `duration`. That modulo math already produces a
      // perfectly smooth, seamless sawtooth on its own as long as
      // elapsedMs is simply allowed to keep growing — the discontinuity
      // was never the math itself, only the caller's own periodic reset of
      // it. A one-shot (loop: false) placement still uses the normal
      // bounded/duration contract every other preset follows.
      if (element?.loop) return true;
      const t = Math.min(1, elapsedMs / this.duration);
      return t < 1;
    },
  },
  {
    id: "fountain",
    category: "effects",
    label: "Fountain",
    kind: "particles",
    colorSlots: [{ key: "color", label: "Water", default: "#38bdf8" }],
    params: [],
    // As seen from above (Orrery's own top-down view): a bubbling central
    // spray, droplets arcing out and landing, and expanding surface ripples
    // — same staggered-phase continuous-loop technique as Fire/Smoke above.
    duration: 1600,
    seed(sizePx) {
      // Ripples stay fixed at 3 — that's staggered TIMING (three rings
      // offset in their own expansion cycle), not spatial density, so
      // scaling it with area wouldn't mean anything. Droplets genuinely
      // scatter across the spray's own area, so those scale.
      const dropletCount = scaledParticleCount(sizePx, { base: 14 });
      const rippleCount = 3;
      return {
        droplets: Array.from({ length: dropletCount }, () => ({
          phase: Math.random(),
          angle: Math.random() * Math.PI * 2,
          reach: sizePx * (0.5 + Math.random() * 0.45),
          size: 1.5 + Math.random() * 2,
        })),
        ripples: Array.from({ length: rippleCount }, (_, i) => ({ phase: i / rippleCount })),
      };
    },
    run(ctx, cx, cy, sizePx, elapsedMs, values, particles) {
      ctx.save();
      particles.ripples.forEach((p) => {
        const localT = (elapsedMs / this.duration + p.phase) % 1;
        const radius = sizePx * localT;
        ctx.globalAlpha = Math.max(0, 0.4 * (1 - localT));
        ctx.strokeStyle = values.color;
        ctx.lineWidth = Math.max(1, sizePx * 0.03 * (1 - localT * 0.5));
        ctx.beginPath();
        ctx.arc(cx, cy, radius, 0, Math.PI * 2);
        ctx.stroke();
      });
      particles.droplets.forEach((p) => {
        const localT = (elapsedMs / this.duration + p.phase) % 1;
        const dist = p.reach * Math.sin((localT * Math.PI) / 2);
        const x = cx + Math.cos(p.angle) * dist;
        const y = cy + Math.sin(p.angle) * dist;
        // A brief "hop" partway through reads as an arc even in a flat
        // top-down view — the droplet shrinks near the peak (furthest from
        // the water's surface) and grows again as it lands.
        const arcLift = Math.sin(localT * Math.PI);
        ctx.globalAlpha = Math.max(0, 1 - localT);
        ctx.fillStyle = "#ffffff";
        ctx.beginPath();
        ctx.arc(x, y, Math.max(0.5, p.size * (1 - arcLift * 0.3)), 0, Math.PI * 2);
        ctx.fill();
      });
      const jitterT = (elapsedMs % 220) / 220;
      ctx.globalAlpha = 0.7;
      ctx.fillStyle = values.color;
      ctx.beginPath();
      ctx.arc(cx, cy, Math.max(1, sizePx * (0.16 + Math.sin(jitterT * Math.PI * 2) * 0.03)), 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
      const t = Math.min(1, elapsedMs / this.duration);
      return t < 1;
    },
  },

  // --- Weather (kind: "particles", category: "weather") ---
  // Same `kind`/rendering pipeline/Loop-Label-Play capability as any other
  // particle preset above — the only real difference is these fill the
  // WHOLE canvas (spawned across the full `cx*2` x `cy*2` area, wrapping at
  // the edges) instead of radiating from the center, so a GM drags one out
  // LARGE to cover a whole battle map, or small for a localized patch. See
  // this file's own header for the full reasoning.
  {
    id: "rain",
    category: "weather",
    label: "Rain",
    kind: "particles",
    colorSlots: [{ key: "color", label: "Color", default: "#93c5fd" }],
    params: [],
    duration: 1400,
    // Weather fills the whole CANVAS (cx*2 x cy*2, i.e. canvasSize — see
    // this category's own header), not a sizePx-radius disc, so density
    // scales off that same canvasSize map-viewer.js's own renderer computes
    // — recomputed here identically (a pure function of sizePx) since
    // seed() only receives sizePx itself. referenceSizePx=400 (rather than
    // the default 100) reflects that a weather patch is typically dragged
    // out much larger than a point effect — scaling against the smaller
    // default would hit the count cap almost immediately.
    seed(sizePx) {
      const canvasSize = Math.max(120, sizePx * 3);
      const count = scaledParticleCount(canvasSize, { base: 90, referenceSizePx: 400, max: 600 });
      return Array.from({ length: count }, () => ({
        x: Math.random(),
        phase: Math.random(),
        speed: 0.85 + Math.random() * 0.5,
        length: 10 + Math.random() * 14,
        drift: (Math.random() - 0.5) * 0.1,
      }));
    },
    run(ctx, cx, cy, sizePx, elapsedMs, values, particles) {
      const t = elapsedMs / this.duration;
      const width = cx * 2;
      const height = cy * 2;
      ctx.save();
      ctx.strokeStyle = values.color;
      ctx.globalAlpha = 0.55;
      ctx.lineWidth = 1.5;
      ctx.lineCap = "round";
      particles.forEach((p) => {
        const localT = (t * p.speed + p.phase) % 1;
        const y = localT * (height + p.length) - p.length;
        const x = (((p.x + p.drift * localT) % 1) + 1) % 1 * width;
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x - p.drift * width * 0.3, y - p.length);
        ctx.stroke();
      });
      ctx.restore();
      return t < 1;
    },
  },
  {
    id: "snow",
    category: "weather",
    label: "Snow",
    kind: "particles",
    colorSlots: [{ key: "color", label: "Color", default: "#f8fafc" }],
    params: [],
    duration: 3200,
    // Density scaling — see Rain's own comment just above.
    seed(sizePx) {
      const canvasSize = Math.max(120, sizePx * 3);
      const count = scaledParticleCount(canvasSize, { base: 70, referenceSizePx: 400, max: 600 });
      return Array.from({ length: count }, () => ({
        x: Math.random(),
        phase: Math.random(),
        speed: 0.5 + Math.random() * 0.6,
        size: 1.5 + Math.random() * 2.5,
        swaySeed: Math.random() * Math.PI * 2,
        swayAmount: 0.03 + Math.random() * 0.05,
      }));
    },
    run(ctx, cx, cy, sizePx, elapsedMs, values, particles) {
      const t = elapsedMs / this.duration;
      const width = cx * 2;
      const height = cy * 2;
      ctx.save();
      ctx.fillStyle = values.color;
      particles.forEach((p) => {
        const localT = (t * p.speed + p.phase) % 1;
        const sway = Math.sin(localT * Math.PI * 4 + p.swaySeed) * p.swayAmount;
        const x = (((p.x + sway) % 1) + 1) % 1 * width;
        const y = localT * height;
        ctx.globalAlpha = 0.75;
        ctx.beginPath();
        ctx.arc(x, y, p.size, 0, Math.PI * 2);
        ctx.fill();
      });
      ctx.restore();
      return t < 1;
    },
  },
  {
    id: "dust",
    category: "weather",
    label: "Dust / Sand",
    kind: "particles",
    colorSlots: [{ key: "color", label: "Color", default: "#d6b370" }],
    params: [],
    duration: 4200,
    // Density scaling — see Rain's own comment.
    seed(sizePx) {
      const canvasSize = Math.max(120, sizePx * 3);
      const count = scaledParticleCount(canvasSize, { base: 80, referenceSizePx: 400, max: 600 });
      return Array.from({ length: count }, () => ({
        x: Math.random(),
        y: Math.random(),
        phase: Math.random(),
        speed: 0.4 + Math.random() * 0.7,
        driftAngle: Math.random() * Math.PI * 2,
        size: 0.8 + Math.random() * 1.6,
      }));
    },
    run(ctx, cx, cy, sizePx, elapsedMs, values, particles) {
      const t = elapsedMs / this.duration;
      const width = cx * 2;
      const height = cy * 2;
      ctx.save();
      ctx.fillStyle = values.color;
      particles.forEach((p) => {
        const localT = (t * p.speed + p.phase) % 1;
        const travel = localT * 1.4;
        const x = (((p.x + Math.cos(p.driftAngle) * travel) % 1) + 1) % 1 * width;
        const y = (((p.y + Math.sin(p.driftAngle) * travel * 0.3) % 1) + 1) % 1 * height;
        ctx.globalAlpha = 0.4 * (0.6 + Math.sin(localT * Math.PI * 2) * 0.4);
        ctx.beginPath();
        ctx.arc(x, y, p.size, 0, Math.PI * 2);
        ctx.fill();
      });
      ctx.restore();
      return t < 1;
    },
  },
  {
    id: "embers",
    category: "weather",
    label: "Embers / Fireflies",
    kind: "particles",
    colorSlots: [{ key: "color", label: "Color", default: "#fbbf24" }],
    params: [],
    duration: 3600,
    // Density scaling — see Rain's own comment.
    seed(sizePx) {
      const canvasSize = Math.max(120, sizePx * 3);
      const count = scaledParticleCount(canvasSize, { base: 40, referenceSizePx: 400, max: 600 });
      return Array.from({ length: count }, () => ({
        x: Math.random(),
        y: Math.random(),
        phase: Math.random(),
        speed: 0.3 + Math.random() * 0.5,
        wanderSeed: Math.random() * Math.PI * 2,
        wanderAmount: 0.05 + Math.random() * 0.08,
        flickerSeed: Math.random() * Math.PI * 2,
        size: 1 + Math.random() * 1.8,
      }));
    },
    run(ctx, cx, cy, sizePx, elapsedMs, values, particles) {
      const t = elapsedMs / this.duration;
      const width = cx * 2;
      const height = cy * 2;
      ctx.save();
      ctx.fillStyle = values.color;
      particles.forEach((p) => {
        const localT = (t * p.speed + p.phase) % 1;
        const rise = localT * height * 0.9;
        const wanderX = Math.sin(localT * Math.PI * 6 + p.wanderSeed) * width * p.wanderAmount;
        const x = (((p.x + wanderX / width) % 1) + 1) % 1 * width;
        const y = (((p.y * height - rise) % height) + height) % height;
        const flicker = 0.5 + Math.sin(elapsedMs * 0.02 + p.flickerSeed) * 0.5;
        ctx.globalAlpha = 0.4 + flicker * 0.5;
        ctx.beginPath();
        ctx.arc(x, y, p.size * (0.7 + flicker * 0.5), 0, Math.PI * 2);
        ctx.fill();
      });
      ctx.restore();
      return t < 1;
    },
  },
  {
    id: "petals",
    category: "weather",
    label: "Falling Petals / Leaves",
    kind: "particles",
    colorSlots: [{ key: "color", label: "Color", default: "#f472b6" }],
    params: [],
    duration: 4600,
    // Density scaling — see Rain's own comment.
    seed(sizePx) {
      const canvasSize = Math.max(120, sizePx * 3);
      const count = scaledParticleCount(canvasSize, { base: 34, referenceSizePx: 400, max: 600 });
      return Array.from({ length: count }, () => ({
        x: Math.random(),
        phase: Math.random(),
        speed: 0.35 + Math.random() * 0.4,
        swaySeed: Math.random() * Math.PI * 2,
        swayAmount: 0.08 + Math.random() * 0.1,
        size: 3 + Math.random() * 3,
        spinSeed: Math.random() * Math.PI * 2,
      }));
    },
    run(ctx, cx, cy, sizePx, elapsedMs, values, particles) {
      const t = elapsedMs / this.duration;
      const width = cx * 2;
      const height = cy * 2;
      ctx.save();
      ctx.fillStyle = values.color;
      particles.forEach((p) => {
        const localT = (t * p.speed + p.phase) % 1;
        const sway = Math.sin(localT * Math.PI * 3 + p.swaySeed) * p.swayAmount;
        const x = (((p.x + sway) % 1) + 1) % 1 * width;
        const y = localT * height;
        // A tumbling leaf/petal reads as an ellipse whose width pulses with
        // a spin cycle, rather than a plain circle.
        const spin = Math.sin(elapsedMs * 0.006 + p.spinSeed);
        ctx.globalAlpha = 0.7;
        ctx.beginPath();
        ctx.ellipse(x, y, p.size * (0.4 + Math.abs(spin) * 0.6), p.size, spin, 0, Math.PI * 2);
        ctx.fill();
      });
      ctx.restore();
      return t < 1;
    },
  },
  {
    id: "bubbles",
    category: "weather",
    label: "Bubbles",
    kind: "particles",
    colorSlots: [{ key: "color", label: "Color", default: "#7dd3fc" }],
    params: [],
    duration: 3000,
    // Density scaling — see Rain's own comment.
    seed(sizePx) {
      const canvasSize = Math.max(120, sizePx * 3);
      const count = scaledParticleCount(canvasSize, { base: 26, referenceSizePx: 400, max: 600 });
      return Array.from({ length: count }, () => ({
        x: Math.random(),
        phase: Math.random(),
        speed: 0.5 + Math.random() * 0.6,
        wobbleSeed: Math.random() * Math.PI * 2,
        wobbleAmount: 0.02 + Math.random() * 0.04,
        size: 2 + Math.random() * 4,
      }));
    },
    run(ctx, cx, cy, sizePx, elapsedMs, values, particles) {
      const t = elapsedMs / this.duration;
      const width = cx * 2;
      const height = cy * 2;
      ctx.save();
      particles.forEach((p) => {
        const localT = (t * p.speed + p.phase) % 1;
        const wobble = Math.sin(localT * Math.PI * 5 + p.wobbleSeed) * p.wobbleAmount;
        const x = (((p.x + wobble) % 1) + 1) % 1 * width;
        const y = height - localT * height;
        ctx.globalAlpha = 0.5;
        ctx.strokeStyle = values.color;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(x, y, p.size, 0, Math.PI * 2);
        ctx.stroke();
        ctx.globalAlpha = 0.25;
        ctx.fillStyle = values.color;
        ctx.beginPath();
        ctx.arc(x, y, p.size, 0, Math.PI * 2);
        ctx.fill();
      });
      ctx.restore();
      return t < 1;
    },
  },
];

export function getPresetById(id) {
  return SHAPE_EFFECT_PRESETS.find((preset) => preset.id === id) ?? null;
}

export function getPresetsByCategory(categoryId) {
  return SHAPE_EFFECT_PRESETS.filter((preset) => preset.category === categoryId);
}

export function getPresetDefaultValues(preset) {
  const values = {};
  (preset?.colorSlots ?? []).forEach((slot) => {
    values[slot.key] = slot.default;
  });
  (preset?.params ?? []).forEach((param) => {
    values[param.key] = param.default;
  });
  return values;
}
