// Fancy 3D dice — a full-viewport overlay canvas that physically rolls dice
// on screen using @3d-dice/dice-box (https://fantasticdice.games), loaded
// lazily from a CDN with no build step: an importmap-free dynamic
// `import()` of the package's pre-bundled ES file, plus a copy of its
// static assets (ammo/wasm physics, themes, models) served from this
// project instead of node_modules — see common/assets/dice-box/.
//
// This module knows how to roll a flat list of plain `NdM` groups and
// report back the real per-die values dice-box's physics produced. It does
// NOT parse dice notation, apply modifiers, or format results — that's
// formula-engine.js's job. dice-roll.js is the only caller for actual
// gameplay rolls, feeding these values back into formula-engine.js's own
// `random` injection point (see dice-roll.js's buildScriptedRandom).
// account.js is the other caller, for the "Preview roll" button.
const ASSET_PATH = "/undercroft/common/assets/dice-box/";
const MODULE_URL = "https://unpkg.com/@3d-dice/dice-box@1.0.14/dist/dice-box.es.js";
const DEFAULT_THEME = "default";

// Every theme dice-box can use, self-hosted under common/assets/dice-box/
// themes/ (mirrored once from @3d-dice/dice-themes@0.2.1) — NOT referenced
// via dice-box's own `externalThemes` option, which is documented but not
// actually wired up in the published 1.0.14 dist build (404s against the
// local assetPath instead of reaching the CDN).
//
// Curated down from the full theme pack: leaves out "default-extras" (an
// add-on, not a standalone look), "diceOfRolling-fate" (nothing in this
// suite rolls dF through the 3D path), and "genesys"/"genesys2"/
// "smooth-pip" (their own `diceAvailable` is special dice, not the standard d4-d100 set).
//
// `colorable` mirrors each theme's own theme.config.json `material.type`
// ("color" = tintable, themeColor recolors it; "standard" = fixed texture,
// themeColor does nothing) — hardcoded from the downloaded configs since nothing changes without a deliberate asset update.
//
// `defaultColor` is that config's own declared `themeColor` where it has
// one, or dice-box's documented global default ("#2e8555") otherwise. This
// is a REAL, visible starting value, never left blank/`undefined` — dice-box's
// `{...defaultOptions, ...boxOptions}` merge treats an explicit `undefined`
// as "overwrite the default with undefined," not "use the default," which
// crashed every colorable theme the moment it tried to blend a hex string that didn't exist.
export const DICE_THEMES = [
  { name: "default", label: "Default", colorable: true, defaultColor: "#2e8555" },
  { name: "blueGreenMetal", label: "Blue-Green Metal", colorable: false },
  { name: "diceOfRolling", label: "Dice of Rolling", colorable: false },
  { name: "gemstone", label: "Gemstone", colorable: true, defaultColor: "#2e8555" },
  { name: "gemstoneMarble", label: "Gemstone Marble", colorable: false },
  { name: "rock", label: "Rock", colorable: true, defaultColor: "#b7aca1" },
  { name: "rust", label: "Rust", colorable: true, defaultColor: "#aa4f4a" },
  { name: "smooth", label: "Smooth", colorable: true, defaultColor: "#2e8555" },
  { name: "wooden", label: "Wooden", colorable: false },
];
export const DICE_THEME_NAMES = DICE_THEMES.map((theme) => theme.name);

// Whether `themeName` supports the `themeColor` hex tint. An unknown theme
// name (a stale saved preference from a theme since dropped) is treated as non-colorable.
export function getThemeColorSupport(themeName) {
  return DICE_THEMES.some((theme) => theme.name === themeName && theme.colorable);
}

// The real, visible starting color for a colorable theme — "" for a
// non-colorable one. account.js uses this to seed the swatch and "Reset to
// default"; resolveDiceSettings below uses the same function so a
// never-customized preference resolves to the identical value.
export function getThemeDefaultColor(themeName) {
  return DICE_THEMES.find((theme) => theme.name === themeName)?.defaultColor || "";
}

// How long the settled dice stay on screen before fading out and clearing —
// long enough to actually read them, short enough not to block the next
// roll for long.
const LINGER_MS = 2200;

let boxPromise = null;
let overlayEl = null;
let hideTimer = null;
let diceSettingsPromise = null;

// Reads the user's chosen theme/color from their account preferences
// (account.html's "Dice appearance" control) and falls back to the plain
// default look for anonymous sessions or a settings-fetch failure. Cached
// for this page's lifetime, same as favoriteColor's own "fetch when needed, fine if a beat stale" treatment.
//
// A colorable theme with no saved color resolves to getThemeDefaultColor —
// the SAME value account.js's swatch starts at, not an independently-guessed roll-side-only fallback.
async function resolveDiceSettings(dataManager) {
  if (diceSettingsPromise) {
    return diceSettingsPromise;
  }
  diceSettingsPromise = (async () => {
    let theme = DEFAULT_THEME;
    let savedColor = "";
    if (dataManager?.isAuthenticated?.()) {
      try {
        const settings = await dataManager.getUserSettings();
        const dice = settings?.diceSettings;
        theme = DICE_THEME_NAMES.includes(dice?.theme) ? dice.theme : DEFAULT_THEME;
        savedColor = typeof dice?.themeColor === "string" ? dice.themeColor : "";
      } catch (error) {
        // Falls through to the plain default theme/color below either way.
      }
    }
    const themeColor = savedColor || getThemeDefaultColor(theme);
    return { theme, themeColor };
  })();
  return diceSettingsPromise;
}

function createOverlayContainer(id) {
  const container = document.createElement("div");
  container.id = id;
  container.className = "dice-overlay";
  document.body.appendChild(container);
  return container;
}

function ensureOverlayElement() {
  if (overlayEl && document.body.contains(overlayEl)) {
    return overlayEl;
  }
  overlayEl = createOverlayContainer(`dice-overlay-${Math.random().toString(36).slice(2, 8)}`);
  return overlayEl;
}

// Constructed exactly ONCE per page (see loadBox below) — dice-box ships no
// dispose()/destroy() and isn't built for a second instance against the
// same container. An earlier version built a fresh DiceBox per "Preview
// roll" click, and one failed theme load left the shared WASM physics
// singleton broken for EVERY later roll. Every theme switch after the
// first goes through `box.updateConfig(...)` instead (see previewDiceTheme).
//
// `themeColor` is trusted to already be a real, non-empty string for a
// colorable theme (resolveDiceSettings/account.js both resolve through
// getThemeDefaultColor) — passed through as-is. dice-box's `{...defaultOptions,
// ...boxOptions}` merge treats an explicit `themeColor: undefined` as
// "overwrite the default with undefined," so nothing is passed when there's genuinely no color to give.
async function buildBox(container, theme, themeColor) {
  const { default: DiceBox } = await import(/* @vite-ignore */ MODULE_URL);
  const box = new DiceBox(`#${container.id}`, {
    assetPath: ASSET_PATH,
    theme,
    ...(themeColor ? { themeColor } : {}),
    scale: 6,
    gravity: 2,
    throwForce: 6,
    settleTimeout: 4000,
  });
  await box.init();
  return box;
}

// Cached across every call on this page — dice-box's init only needs to
// happen once, already resolved to the RIGHT theme. A failed load is NOT
// cached: `boxPromise` clears on rejection so a later roll can retry instead of being stuck forever.
async function loadBox(dataManager) {
  if (boxPromise) {
    return boxPromise;
  }
  boxPromise = (async () => {
    const settings = await resolveDiceSettings(dataManager);
    return buildBox(ensureOverlayElement(), settings.theme, settings.themeColor);
  })();
  boxPromise.catch(() => {
    boxPromise = null;
  });
  return boxPromise;
}

// A small pool of SECONDARY DiceBox instances, one per distinct (theme,
// themeColor) combination needed for a multi-color roll (see
// rollDiceOverlay below) — built once per key and reused forever, on its
// own dedicated overlay container so it can roll alongside the main box
// without touching its live config mid-flight. Same "build once, cache,
// never rebuild" discipline loadBox follows, for the same reason: dice-box
// has no dispose(). UNVERIFIED: whether dice-box's physics engine tolerates
// more than one simultaneous instance — if a second instance destabilizes
// the FIRST (main) box too, this pool needs to go away entirely.
const colorBoxEntries = new Map();
let colorBoxSequence = 0;

async function loadColorBoxEntry(theme, themeColor) {
  const key = `${theme}|${themeColor || ""}`;
  if (colorBoxEntries.has(key)) {
    return colorBoxEntries.get(key);
  }
  const promise = (async () => {
    colorBoxSequence += 1;
    const container = createOverlayContainer(
      `dice-overlay-color-${colorBoxSequence}-${Math.random().toString(36).slice(2, 8)}`
    );
    const box = await buildBox(container, theme, themeColor);
    return { box, container, hideTimer: null };
  })();
  colorBoxEntries.set(key, promise);
  promise.catch(() => {
    colorBoxEntries.delete(key);
  });
  return promise;
}

async function showAndRoll(box, notations) {
  const container = ensureOverlayElement();
  if (hideTimer) {
    clearTimeout(hideTimer);
    hideTimer = null;
  }
  container.classList.add("is-visible");
  const result = await box.roll(notations);
  scheduleHide(box);
  return result;
}

// Same job as showAndRoll above, but for one of the pooled secondary
// entries (its own container/box/hideTimer), so several can be visible and lingering independently at once.
async function showAndRollOnEntry(entry, notations) {
  if (entry.hideTimer) {
    clearTimeout(entry.hideTimer);
    entry.hideTimer = null;
  }
  entry.container.classList.add("is-visible");
  const result = await entry.box.roll(notations);
  entry.hideTimer = setTimeout(() => {
    entry.hideTimer = null;
    entry.container.classList.remove("is-visible");
    setTimeout(() => entry.box.clear(), 200);
  }, LINGER_MS);
  return result;
}

// account.html's "Preview roll" button — switches the SAME persistent box's
// live theme via `updateConfig()` rather than ever building a second
// DiceBox instance. The first call on a page still pays for a full
// `loadBox()`; every click after that is a fast in-place theme swap.
// Returns `true`/`false`, not a roll result — the number rolled is just for
// show. `themeColor` is passed through exactly as account.js's swatch shows it.
export async function previewDiceTheme(theme, themeColor) {
  if (typeof window === "undefined" || typeof WebGLRenderingContext === "undefined") {
    return false;
  }
  try {
    const box = await loadBox();
    await box.updateConfig({ theme, ...(themeColor ? { themeColor } : {}) });
    await showAndRoll(box, ["1d20"]);
    return true;
  } catch (error) {
    return false;
  }
}

// Kicks off `loadBox()` ahead of the first actual roll, so the ~1-2s of
// fetching the module + wasm physics + theme textures happens quietly in
// idle time instead of stalling the first roll a user makes. Safe to call
// repeatedly — `loadBox()` dedupes to a single in-flight/cached load.
// `dataManager` lets this resolve the user's chosen theme up front rather than warming "default" and reloading later.
export function preloadDiceOverlay(dataManager) {
  if (typeof window === "undefined") {
    return;
  }
  // requestIdleCallback, with a setTimeout fallback for Safari — never fired synchronously, so it doesn't compete with first paint.
  const schedule = window.requestIdleCallback || ((fn) => setTimeout(fn, 1200));
  schedule(() => void loadBox(dataManager));
}

function scheduleHide(box) {
  if (hideTimer) {
    clearTimeout(hideTimer);
  }
  hideTimer = setTimeout(() => {
    hideTimer = null;
    overlayEl?.classList.remove("is-visible");
    setTimeout(() => box.clear(), 200); // gives the fade-out transition a moment before removing the meshes
  }, LINGER_MS);
}

// Rolls one physical box.roll() call for `terms` via `rollNotations`
// (either showAndRoll on the main box, or showAndRollOnEntry on a pooled
// color-box entry) and buckets the settled values back per requested group,
// in `terms` order. Returns `null` (never throws) if the result can't be
// confidently matched back up. `shape.buildNotation(term)` builds this
// term's notation string, `shape.extractValue(die)` pulls its raw value,
// `shape.isValidValue(value)` decides whether that counts as a real
// settled result (a symbolic die's "" blank face is valid; NaN is not).
async function rollTermBatch(rollNotations, terms, shape) {
  const notations = terms.map(shape.buildNotation);
  const rolled = await rollNotations(notations);
  const dice = Array.isArray(rolled) ? rolled : Array.isArray(rolled?.dice) ? rolled.dice : [];
  // dice-box tags each die with `groupId` (0-based, matching `notations`
  // order) — bucket by that when present. Shapes without a numeric groupId
  // fall back to "resolved in request order," correct for a single `roll()` call.
  const hasGroupId = dice.length > 0 && dice.every((die) => typeof die.groupId === "number");
  const buckets = terms.map(() => []);
  if (hasGroupId) {
    dice.forEach((die) => {
      buckets[die.groupId]?.push(shape.extractValue(die));
    });
  } else {
    let cursor = 0;
    terms.forEach((term, index) => {
      buckets[index] = dice.slice(cursor, cursor + term.count).map(shape.extractValue);
      cursor += term.count;
    });
  }
  const expectedTotal = terms.reduce((sum, term) => sum + term.count, 0);
  const actualTotal = buckets.reduce((sum, bucket) => sum + bucket.length, 0);
  if (actualTotal !== expectedTotal || buckets.some((bucket) => bucket.some((value) => !shape.isValidValue(value)))) {
    return null;
  }
  return buckets;
}

// Shared by rollDiceOverlay (plain numeric dice) and rollSymbolDiceOverlay
// (Genesys-style symbolic dice) below — both need the identical "pick a
// look, then pick a box for it" logic; only how a term becomes a notation
// string and how a settled die's value is read/validated differs (rollTermBatch's `shape` param).
//
// `terms`: [{ count, color?, themeOverride?, ... }, ...] — plain positive
// dice groups only, no modifiers/keep-drop/reroll/explode. `color`/
// `themeOverride` come from a System's own named die (Daggerheart's
// hopeDie/fearDie, a Tier-3 symbol die's `themeOverride: "genesys"`).
// Resolves to an array of `shape.shapeResult(term, values)` entries in the
// SAME order as `terms`, or `null` if the overlay couldn't be loaded or the
// result couldn't be confidently matched — callers must treat `null` as
// "fall back to the ordinary non-visual roll", never as an error.
//
// A single box.roll() call CANNOT mix a plain "NdM" string with a per-die
// color/theme override in the same array (confirmed broken — throws inside
// dice-box's WorldFacade with no usable error). Firing a second `roll()`
// on the SAME box before the first settles is ALSO broken — it cancels/overwrites the in-flight roll.
//
// A roll with just ONE distinct look always uses the one persistent main
// box. A roll spanning MULTIPLE distinct colors/themes gives each group its
// own pooled secondary box and rolls all at once via Promise.all, so e.g.
// Daggerheart's Hope/Fear duality roll lands together instead of a visible
// stagger. UNVERIFIED: whether dice-box's physics engine tolerates more than one simultaneous instance.
async function rollGroupedOverlay(terms, dataManager, shape) {
  if (typeof window === "undefined" || !Array.isArray(terms) || !terms.length) {
    return null;
  }
  if (typeof WebGLRenderingContext === "undefined") {
    return null;
  }
  try {
    const baseSettings = await resolveDiceSettings(dataManager);
    const groupKeyOf = (term) => (term.color || term.themeOverride ? `${term.themeOverride || ""} ${term.color || ""}` : "");
    const orderedKeys = [];
    const groups = new Map();
    terms.forEach((term, index) => {
      const key = groupKeyOf(term);
      if (!groups.has(key)) {
        groups.set(key, []);
        orderedKeys.push(key);
      }
      groups.get(key).push(index);
    });

    if (orderedKeys.length === 1) {
      // One look for the whole roll (colored or not) — the persistent main
      // box, switching its config only if this one look isn't the base.
      const key = orderedKeys[0];
      const box = await loadBox(dataManager);
      const [themeOverride, color] = key ? key.split(" ") : ["", ""];
      if (key) {
        await box.updateConfig({
          theme: themeOverride || baseSettings.theme,
          themeColor: color || baseSettings.themeColor || undefined,
        });
      }
      const buckets = await rollTermBatch((notations) => showAndRoll(box, notations), terms, shape);
      if (key) {
        await box.updateConfig({
          theme: baseSettings.theme,
          themeColor: baseSettings.themeColor || undefined,
        });
      }
      if (!buckets) {
        return null;
      }
      return terms.map((term, index) => shape.shapeResult(term, buckets[index]));
    }

    // Multiple distinct looks — one dedicated pooled box per group, all
    // rolled at once.
    const resultsByIndex = new Array(terms.length);
    const rollPromises = orderedKeys.map(async (key) => {
      const indexes = groups.get(key);
      const groupTerms = indexes.map((index) => terms[index]);
      const [themeOverride, color] = key ? key.split(" ") : [baseSettings.theme, baseSettings.themeColor];
      const entry = await loadColorBoxEntry(themeOverride || baseSettings.theme, color || baseSettings.themeColor);
      const buckets = await rollTermBatch((notations) => showAndRollOnEntry(entry, notations), groupTerms, shape);
      if (!buckets) {
        return false;
      }
      indexes.forEach((termIndex, i) => {
        resultsByIndex[termIndex] = buckets[i];
      });
      return true;
    });
    const outcomes = await Promise.all(rollPromises);
    if (outcomes.some((ok) => !ok) || resultsByIndex.some((bucket) => bucket === undefined)) {
      return null;
    }
    return terms.map((term, index) => shape.shapeResult(term, resultsByIndex[index]));
  } catch (error) {
    overlayEl?.classList.remove("is-visible");
    return null;
  }
}

// `terms`: [{ count, sides, color?, themeOverride? }, ...]. Resolves to an
// array of `{ sides, values: [...] }` — see rollGroupedOverlay's own header
// for everything about how the roll actually happens.
export async function rollDiceOverlay(terms, dataManager) {
  return rollGroupedOverlay(terms, dataManager, {
    buildNotation: (term) => `${term.count}d${term.sides}`,
    extractValue: (die) => Number(die.value),
    isValidValue: Number.isFinite,
    shapeResult: (term, values) => ({ sides: term.sides, values }),
  });
}

// `terms`: [{ count, dieId, dieBoxType, color?, themeOverride? }, ...] — a
// Tier-3 symbol die's own vendored-theme name (`diceBoxType: "boost"`/etc.)
// in place of a numeric `sides`. Resolves to `{ dieId, values: [...] }`
// entries — `values` are each die's RAW dice-box `.value`: a string, an
// array of two strings (a face carrying two symbols), or "" (blank face).
// Confirmed against dice-box's own source — the resolved symbol content
// already, not a face index. symbol-dice.js's buildSymbolPoolFromDiceBoxValues
// turns these into the same `{rolls, counts, net}` shape the Math.random path produces.
export async function rollSymbolDiceOverlay(terms, dataManager) {
  return rollGroupedOverlay(terms, dataManager, {
    buildNotation: (term) => `${term.count}d${term.dieBoxType}`,
    extractValue: (die) => die.value,
    // A blank face's "" is a real, valid result for a symbol die — unlike a numeric roll's NaN, not a failed/unmatched die.
    isValidValue: (value) => typeof value === "string" || Array.isArray(value),
    shapeResult: (term, values) => ({ dieId: term.dieId, values }),
  });
}

// A Broadcast-mode roll's remote-viewer replay used to live here, rolling
// this SAME overlay independently on each remote screen — replaced by
// dice-reveal.js's physics-free "spin and reveal" tiles: dice-box can't be
// told to land on a predetermined result, so an independent physics roll
// here could only show a DIFFERENT outcome than the poster's screen. A
// non-physics animation can always display the real settled values instead.
