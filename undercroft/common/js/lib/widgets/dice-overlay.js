// Fancy 3D dice — a full-viewport overlay canvas that physically rolls dice
// on screen using @3d-dice/dice-box (https://fantasticdice.games), loaded
// lazily from a CDN with no build step, exactly the way the old /dnd/
// prototype (dice.htm/dice_3d.js) proved out: an importmap-free dynamic
// `import()` of the package's own pre-bundled ES file, plus a copy of its
// static assets (ammo/wasm physics, themes, models) served from this
// project instead of node_modules — see common/assets/dice-box/.
//
// This module knows how to roll a flat list of plain `NdM` groups and
// report back the real per-die values dice-box's physics produced. It does
// NOT know how to parse dice notation, apply modifiers, or format results —
// that's still entirely formula-engine.js's job. dice-roll.js is the only
// caller for actual gameplay rolls, and it feeds these real values back
// into formula-engine.js's own `random` injection point so every existing
// bit of parsing/formatting keeps working unchanged (see dice-roll.js's own
// buildScriptedRandom). account.js is the other caller, for the "Preview
// roll" button on its Dice appearance preference.
const ASSET_PATH = "/undercroft/common/assets/dice-box/";
const MODULE_URL = "https://unpkg.com/@3d-dice/dice-box@1.0.14/dist/dice-box.es.js";
const DEFAULT_THEME = "default";

// Every theme dice-box can use, self-hosted under common/assets/dice-box/
// themes/ (mirrored once from @3d-dice/dice-themes@0.2.1's own release) —
// NOT referenced via dice-box's own `externalThemes` config option. That
// option is documented but isn't actually wired up in the published 1.0.14
// dist build: it 404s against the LOCAL assetPath instead of ever reaching
// the CDN URL (confirmed against the real shipped source), so self-hosting
// is the only reliable way to offer more than the one bundled look.
//
// Curated down from the full theme-pack list — leaves out "default-extras"
// (a pip/extras add-on, not a standalone look), "diceOfRolling-fate"
// (Fudge/Fate faces; nothing in this suite rolls dF dice through the 3D
// path, see dice-roll.js's own SIMPLE_TERM), and "genesys"/"genesys2" and
// "smooth-pip" — those three's own theme.config.json declares
// `diceAvailable` as their system's own special dice (Genesys's
// boost/setback/ability/... or a single generic "pip"), never the standard
// d4-d100 set, so a normal roll would have no matching die mesh at all.
//
// `colorable` mirrors each remaining theme's own theme.config.json
// `material.type` ("color" = a single tintable diffuse-light/diffuse-dark
// texture pair, themeColor actually recolors it; "standard" = a fixed,
// pre-baked texture where themeColor does nothing) — hardcoded from those
// already-downloaded configs rather than re-fetched at runtime, since nothing
// here changes without a deliberate asset update on our side.
//
// `defaultColor` (colorable themes only) is that same theme.config.json's
// own declared `themeColor` where it has one (Rock's "#b7aca1", Rust's
// "#aa4f4a"), or dice-box's own documented global default ("#2e8555",
// fantasticdice.games's config table) for the ones that don't declare their
// own (Default, Gemstone, Smooth). This is a REAL, visible starting value —
// account.js's color swatch is always populated with it up front rather
// than left blank, and dice-box is always handed a real hex string rather
// than `undefined`, on purpose: an earlier version left the color out of
// the config object whenever nothing was chosen yet, which dice-box's own
// `{...defaultOptions, ...boxOptions}` config merge treats as "explicitly
// overwrite the default with `undefined`," not "use the default" — every
// colorable theme (Default, Gemstone, Rock, Rust, Smooth) then crashed the
// moment it tried to blend a hex string that didn't exist. A real,
// user-editable default closes that hole AND gives the user something
// concrete to look at and change, instead of a value invented silently
// behind the scenes at roll time.
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

// Whether `themeName` supports the `themeColor` hex tint at all — see
// DICE_THEMES' own header above for what this is derived from. An unknown
// theme name (e.g. a stale saved preference from a theme we've since
// dropped) is treated as non-colorable, same as "standard".
export function getThemeColorSupport(themeName) {
  return DICE_THEMES.some((theme) => theme.name === themeName && theme.colorable);
}

// The real, visible starting color for a colorable theme — "" for a
// non-colorable one (there's nothing to show/pick). account.js uses this to
// seed the swatch and its own "Reset to default" button; resolveDiceSettings
// below uses the exact same function so a never-customized preference
// resolves to the identical value the user would see if they opened the
// picker, not a second, independently-guessed fallback.
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
// (account.html's own "Dice appearance" control, saved via the exact same
// dataManager.saveUserSettings({diceSettings}) precedent "Favorite color"
// already established — see account.js) and falls back to the plain
// default look for anonymous sessions or a settings-fetch failure. Cached
// for this page's lifetime — matches how favoriteColor itself is treated
// as "fetch when needed, fine if it's a beat stale," not something that
// needs to react to being changed in another tab.
//
// A colorable theme with no saved color resolves to that theme's own
// getThemeDefaultColor(...) here — the SAME value account.js's swatch
// itself starts at — not an independently-guessed fallback invented only
// on the roll path. That's what keeps a real hex string flowing into
// buildBox below without ever needing a second, roll-side-only default.
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

function ensureOverlayElement() {
  if (overlayEl && document.body.contains(overlayEl)) {
    return overlayEl;
  }
  overlayEl = document.createElement("div");
  overlayEl.id = `dice-overlay-${Math.random().toString(36).slice(2, 8)}`;
  overlayEl.className = "dice-overlay";
  document.body.appendChild(overlayEl);
  return overlayEl;
}

// Constructed exactly ONCE per page (see loadBox below) — dice-box ships no
// dispose()/destroy() method and isn't built to have a second instance
// created against the same container. Confirmed the hard way: an earlier
// version of this module built a fresh DiceBox per "Preview roll" click,
// and a single failed theme load (a bad CDN theme name that 404'd) left the
// shared WASM physics singleton in a state that then broke EVERY later
// roll, even with the plain default theme, in a completely unrelated
// uncaught internal error. Every theme switch after the first now goes
// through `box.updateConfig(...)` on this same instance (see
// previewDiceTheme below) instead of ever constructing a second one.
//
// `themeColor` is trusted to already be a real, non-empty string for a
// colorable theme by the time it gets here (resolveDiceSettings and
// account.js both resolve through the same getThemeDefaultColor rather than
// ever leaving it blank) — passed through as-is, never patched up with a
// hidden fallback at this layer. dice-box merges config with a flat
// `{...defaultOptions, ...boxOptions}` spread, so an explicit `themeColor:
// undefined` key would overwrite dice-box's own default with `undefined`
// rather than falling back to it — the root cause behind an earlier
// "Cannot read properties of undefined (reading 'slice')" crash on every
// "color"-material theme (Default, Gemstone, Rock, Rust, Smooth); passing
// nothing at all when there's genuinely no color to give (a non-colorable
// theme) avoids the same trap the other way around.
async function buildBox(theme, themeColor) {
  const container = ensureOverlayElement();
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

// Cached across every call on this page — dice-box's own init (loading the
// module, the wasm physics engine, and the user's chosen theme's assets)
// only needs to happen once, already resolved to the RIGHT theme up front.
// A failed load is NOT cached: `boxPromise` is cleared on rejection so a
// later roll (e.g. after a transient network hiccup) gets to try again
// instead of being permanently stuck in the plain-toast fallback for the
// rest of the page's life.
async function loadBox(dataManager) {
  if (boxPromise) {
    return boxPromise;
  }
  boxPromise = (async () => {
    const settings = await resolveDiceSettings(dataManager);
    return buildBox(settings.theme, settings.themeColor);
  })();
  boxPromise.catch(() => {
    boxPromise = null;
  });
  return boxPromise;
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

// account.html's own "Preview roll" button — switches the SAME persistent
// box's live theme via `updateConfig()` (a real, working instance method —
// confirmed against the actual source — that re-runs the same theme-load
// flow the constructor's own `theme` option does) rather than ever building
// a second DiceBox instance. The very first call on a page still pays for
// a full `loadBox()` (module + wasm + this box's OWN initial theme, plain
// "default" if nothing's been rolled here yet); every click after that is
// just a fast in-place theme swap on the box that's already running.
// Returns `true`/`false` rather than any roll result — the number rolled
// here is just for show, nothing reads it. `themeColor` is passed through
// exactly as account.js's own swatch shows it (never patched up with a
// hidden fallback here — see buildBox's own comment on why an explicit
// `undefined` value is worse than omitting the key entirely).
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
// fetching the dice-box module + wasm physics engine + theme textures
// happens quietly in idle time instead of stalling the FIRST roll a user
// ever makes on a page (which is what made that first roll feel broken
// rather than just fancy). Safe to call as often as you like — `loadBox()`
// itself is what dedupes to a single in-flight/cached load. `dataManager`
// is what lets this resolve the user's actual chosen theme up front rather
// than warming up "default" and then having to reload a different theme's
// assets on the real roll — pass it whenever the caller has one (every
// mount point that can roll dice already does).
export function preloadDiceOverlay(dataManager) {
  if (typeof window === "undefined") {
    return;
  }
  // requestIdleCallback (with a setTimeout fallback for Safari, which still
  // doesn't implement it) — deliberately not fired synchronously, so it
  // never competes with whatever the page is doing to render first.
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
    // Give the fade-out transition (see shell.css) a moment before actually
    // removing the meshes, so the numbers don't just vanish mid-fade.
    setTimeout(() => box.clear(), 200);
  }, LINGER_MS);
}

// `terms`: [{ count, sides }, ...] — plain positive dice groups only, no
// modifiers/keep-drop/reroll/explode (dice-roll.js only calls this once it
// has already confirmed the expression is that simple). `dataManager` is
// optional and only used to resolve the user's chosen theme/color (see
// resolveDiceSettings) — omitting it just means the plain default look.
// Resolves to an array of `{ sides, values: [...] }` in the SAME order as
// `terms`, one entry per requested group, or `null` if the overlay couldn't
// be loaded or the result couldn't be confidently matched back up —
// callers must treat `null` as "fall back to the ordinary non-visual
// roll", never as an error.
export async function rollDiceOverlay(terms, dataManager) {
  if (typeof window === "undefined" || !Array.isArray(terms) || !terms.length) {
    return null;
  }
  if (typeof WebGLRenderingContext === "undefined") {
    return null;
  }
  try {
    const box = await loadBox(dataManager);
    const notations = terms.map((term) => `${term.count}d${term.sides}`);
    const rolled = await showAndRoll(box, notations);
    const dice = Array.isArray(rolled) ? rolled : Array.isArray(rolled?.dice) ? rolled.dice : [];
    // dice-box tags each die with which requested group it belongs to via
    // `groupId` (0-based, matching the `notations` array order) — bucket by
    // that when present. Older/unexpected shapes without a numeric groupId
    // fall back to "resolved in request order", which is exactly right for
    // a single `roll()` call.
    const hasGroupId = dice.length > 0 && dice.every((die) => typeof die.groupId === "number");
    const buckets = terms.map(() => []);
    if (hasGroupId) {
      dice.forEach((die) => {
        buckets[die.groupId]?.push(Number(die.value));
      });
    } else {
      let cursor = 0;
      terms.forEach((term, index) => {
        buckets[index] = dice.slice(cursor, cursor + term.count).map((die) => Number(die.value));
        cursor += term.count;
      });
    }
    const expectedTotal = terms.reduce((sum, term) => sum + term.count, 0);
    const actualTotal = buckets.reduce((sum, bucket) => sum + bucket.length, 0);
    if (actualTotal !== expectedTotal || buckets.some((bucket) => bucket.some((value) => !Number.isFinite(value)))) {
      return null;
    }
    return terms.map((term, index) => ({ sides: term.sides, values: buckets[index] }));
  } catch (error) {
    overlayEl?.classList.remove("is-visible");
    return null;
  }
}
