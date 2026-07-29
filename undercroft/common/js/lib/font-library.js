// Shared font library — used by both Press and Workbench. Moved here from
// press/js/font-library.js (was Press-only originally, no Press-specific
// dependency in any of this) so both tools' Font pickers read/write the
// exact same server-persisted list instead of keeping separate copies.

// The only real "built-in" — every other font (including what used to be
// a hardcoded curated list) now lives in the same server-persisted,
// admin-deletable list as anything added through the "Add a font…" modal
// (see custom-fonts.json and registerCustomFont/loadCustomFonts below).
// Selecting "Default" deletes node.style.fontFamily rather than setting
// one — matches the "unset means implicit default" convention already
// used for Image fit / Layer origin — and it's the one entry that can't
// be deleted, since there needs to always be a way to clear an override.
// "Default (template font)", not "(theme font)" — a component's own Font
// left unset now inherits the active Template's own base font (see
// DEFAULT_FONT_FAMILY below and the Template Properties Font field in each
// tool), not a hardcoded browser/theme default the way it used to.
export const FONT_OPTIONS = [{ id: "default", label: "Default (template font)", family: null }];

// The Template-level "base font" field's own runtime fallback when a
// template hasn't set one (empty/unset, never written into a template's
// saved JSON just for that — same "empty means fall back" convention every
// other field this session added uses) — Bootstrap 5.3's own
// --bs-font-sans-serif stack, the literal font every template already
// rendered with before this field existed (verified: neither tool's own
// CSS sets font-family anywhere), so an existing template's font doesn't
// visibly change until someone deliberately picks something else.
export const DEFAULT_FONT_FAMILY =
  'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", "Noto Sans", "Liberation Sans", Arial, sans-serif, "Apple Color Emoji", "Segoe UI Emoji", "Segoe UI Symbol", "Noto Color Emoji"';

// Fonts added at runtime via the "Add a font…" modal (see
// registerCustomFont) — starts empty, grows in-memory immediately on add
// and is repopulated from the server on every load via loadCustomFonts.
// This is also where the previously-hardcoded curated fonts now live,
// migrated into custom-fonts.json so they're deletable like anything else.
let customFontOptions = [];

export function getAllFontOptions() {
  // FONT_OPTIONS (just "Default") stays pinned first; everything else is
  // alphabetized by label so the list stays scannable as it grows instead
  // of ordering by whenever each font happened to be added.
  const sortedCustom = [...customFontOptions].sort((a, b) =>
    a.label.localeCompare(b.label, undefined, { sensitivity: "base" })
  );
  return [...FONT_OPTIONS, ...sortedCustom];
}

export function getFontOptionById(id) {
  return getAllFontOptions().find((option) => option.id === id) ?? null;
}

// Built-in (FONT_OPTIONS) fonts are code-defined and never deletable —
// only entries added at runtime can be removed.
export function isCustomFontId(id) {
  return customFontOptions.some((option) => option.id === id);
}

// Matches a stored node.style.fontFamily value back to a known option (for
// populating the inspector field), or null if it doesn't match any —
// callers fall back to showing the raw value in that case (see
// updateInspector's font block in app.js).
export function findFontOptionByFamily(family) {
  if (!family) return null;
  return getAllFontOptions().find((option) => option.family === family) ?? null;
}

// No-ops (returns the existing entry) if this id is already registered
// anywhere — adding the same Google Font twice, whether by the same user
// re-adding it or two different people adding it independently, resolves
// to the one shared entry instead of duplicating the dropdown.
export function registerCustomFont(font) {
  if (!font?.id || !font.family) return null;
  const existing = getAllFontOptions().find((option) => option.id === font.id);
  if (existing) return existing;
  customFontOptions.push(font);
  return font;
}

// Removes it from the in-memory list only — callers pair this with
// saveCustomFontDeletion for the server-persisted removal, same
// "update immediately, persist async" shape as adding one.
export function deleteCustomFont(id) {
  customFontOptions = customFontOptions.filter((option) => option.id !== id);
}

export function ensureFontLoaded(option) {
  if (!option?.googleFont) return;
  const linkId = `press-font-${option.id}`;
  if (document.head.querySelector(`link[data-font-id="${linkId}"]`)) return;
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = `https://fonts.googleapis.com/css2?family=${option.googleFont}&display=swap`;
  link.dataset.fontId = linkId;
  document.head.appendChild(link);
}

async function loadJson(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Unable to load ${url}: ${response.status}`);
  }
  return response.json();
}

// Mirrors templates.js's loadCustomPageSizes/saveCustomPageSize exactly —
// same server-persisted, shared-across-everyone pattern, same "register
// immediately in-memory, persist async" flow.
export async function loadCustomFonts() {
  try {
    const url = new URL("../../data/custom-fonts.json", import.meta.url);
    const payload = await loadJson(url);
    const fonts = Array.isArray(payload?.fonts) ? payload.fonts : [];
    fonts.forEach((font) => registerCustomFont(font));
    return fonts;
  } catch (error) {
    // Was silent — a fetch/path/JSON failure here means the font list
    // silently stays empty-but-for-Default with no visible sign anything
    // is wrong, which is exactly the kind of failure worth logging even
    // though this stays non-fatal (a missing font library shouldn't block
    // the rest of the page).
    console.warn("Unable to load the shared font library:", error);
    return [];
  }
}

// Both server routes require a session now (creator+ to add, admin to
// delete) — authToken is the bearer token to send, since this module
// stays decoupled from DataManager itself (framework-free, per the file
// header) rather than importing the whole class just for this. Callers
// pass dataManager.session?.token (a public getter — no need to reach
// into DataManager's private state for it).
function authHeaders(authToken) {
  const headers = { "Content-Type": "application/json" };
  if (authToken) headers.Authorization = `Bearer ${authToken}`;
  return headers;
}

export async function saveCustomFont(font, authToken) {
  const response = await fetch("/custom-fonts", {
    method: "POST",
    headers: authHeaders(authToken),
    body: JSON.stringify({ font }),
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload.error || "Unable to save custom font.");
  }
  return response.json();
}

// This server has no true HTTP DELETE wired up anywhere — every deletion
// in this codebase is POST .../delete instead (see /auth/users/delete and
// /content/{bucket}/{id}/delete server-side).
export async function saveCustomFontDeletion(id, authToken) {
  const response = await fetch("/custom-fonts/delete", {
    method: "POST",
    headers: authHeaders(authToken),
    body: JSON.stringify({ id }),
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload.error || "Unable to delete custom font.");
  }
  return response.json();
}

// Confirms a bare name actually corresponds to something Google Fonts
// serves, rather than trusting format alone — injects the stylesheet and
// asks the browser's CSS Font Loading API to resolve the family. An
// unknown/typo'd name still gets a 200 response from Google (an empty or
// near-empty stylesheet with no matching @font-face), so the HTTP status
// isn't the signal; document.fonts.load() resolving to an empty array is.
// No API key needed, and avoids relying on being able to fetch()-read the
// cross-origin CSS response (uncertain CORS support for that read) — both
// <link> loading and document.fonts are native, unauthenticated browser
// APIs that don't have that limitation.
export function verifyGoogleFontExists(name, googleFontParam) {
  return new Promise((resolve, reject) => {
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = `https://fonts.googleapis.com/css2?family=${googleFontParam}&display=swap`;
    const cleanupAndReject = (message) => {
      link.remove();
      reject(new Error(message));
    };
    link.onerror = () => cleanupAndReject("Unable to reach Google Fonts to verify this font.");
    link.onload = async () => {
      try {
        const loaded = await document.fonts.load(`1em '${name}'`);
        if (!loaded.length) {
          cleanupAndReject(`Couldn't find "${name}" on Google Fonts — check the spelling.`);
          return;
        }
        resolve(link);
      } catch (error) {
        cleanupAndReject("Couldn't verify this font.");
      }
    };
    document.head.appendChild(link);
  });
}

// Google's own font-picker metadata — key-free but not CORS-enabled for
// third-party origins (unlike the CSS2 stylesheet endpoint), so it's routed
// through this server's own /google-fonts-metadata proxy (server/app.py)
// rather than a public CORS proxy — corsproxy.io was tried first (same one
// used for D&D Beyond fetches) but its free tier now rejects non-localhost
// callers entirely. Listing every family with its category ("serif",
// "sans-serif", "display", "handwriting", "monospace"), used to label
// newly-added fonts the same way the old curated list was labeled by hand
// (e.g. "Georgia (serif)"), automatically, "if known" — this is a
// best-effort lookup: fetched once and cached, and any failure (network,
// proxy, or unexpected shape) just means no category suffix, never a hard
// error, since the font itself is already verified separately via
// verifyGoogleFontExists.
const GOOGLE_FONTS_METADATA_URL = "/google-fonts-metadata";
let googleFontsMetadataPromise = null;

function loadGoogleFontsMetadata() {
  if (!googleFontsMetadataPromise) {
    const xssiPrefix = ")]}'";
    googleFontsMetadataPromise = fetch(GOOGLE_FONTS_METADATA_URL)
      .then((response) => (response.ok ? response.text() : Promise.reject(new Error("metadata unavailable"))))
      // The response body is prefixed with a fixed XSSI-protection string
      // ahead of the actual JSON — stripped by plain prefix check rather
      // than a regex, so there's no ambiguity from escaping the brackets
      // that prefix happens to contain.
      .then((text) => JSON.parse(text.startsWith(xssiPrefix) ? text.slice(xssiPrefix.length) : text))
      .catch((error) => {
        // Surfaced so this is diagnosable instead of just silently never
        // showing a category — best-effort lookup either way, so a failure
        // here still just means no category suffix, never a hard error.
        console.warn("Google Fonts metadata lookup failed:", error);
        return null;
      });
  }
  return googleFontsMetadataPromise;
}

// Returns { available, category } — available:false means the metadata
// lookup itself didn't work (caller should fall back to unlabeled/other
// verification), available:true + category:null means the lookup worked
// but this specific family wasn't found in it.
export async function lookupGoogleFontCategory(name) {
  const metadata = await loadGoogleFontsMetadata();
  if (!metadata || !Array.isArray(metadata.familyMetadataList)) {
    return { available: false, category: null };
  }
  const normalized = name.trim().toLowerCase();
  const match = metadata.familyMetadataList.find(
    (entry) => typeof entry.family === "string" && entry.family.toLowerCase() === normalized
  );
  return { available: true, category: match?.category ?? null };
}
