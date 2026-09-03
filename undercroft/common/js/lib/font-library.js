// Shared font library — used by both Press and Workbench, so both tools'
// Font pickers read/write the exact same server-persisted list.

// The only real "built-in" — every other font lives in the same server-
// persisted, admin-deletable list as anything added through the "Add a
// font…" modal (see custom-fonts.json, registerCustomFont/loadCustomFonts
// below). Selecting "Default" deletes node.style.fontFamily rather than
// setting one, and it's the one entry that can't be deleted, since there
// needs to always be a way to clear an override — a component's Font left
// unset inherits the active Template's own base font (DEFAULT_FONT_FAMILY).
export const FONT_OPTIONS = [{ id: "default", label: "Default (template font)", family: null }];

// The Template-level "base font" field's runtime fallback when unset —
// Bootstrap 5.3's own --bs-font-sans-serif stack, the literal font every
// template already rendered with before this field existed, so an existing
// template's font doesn't visibly change until someone picks something else.
export const DEFAULT_FONT_FAMILY =
  'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", "Noto Sans", "Liberation Sans", Arial, sans-serif, "Apple Color Emoji", "Segoe UI Emoji", "Segoe UI Symbol", "Noto Color Emoji"';

// Fonts added at runtime via the "Add a font…" modal — starts empty, grows
// in-memory immediately on add, repopulated from the server via loadCustomFonts.
let customFontOptions = [];

export function getAllFontOptions() {
  // FONT_OPTIONS ("Default") stays pinned first; everything else alphabetized
  // by label so the list stays scannable as it grows.
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

// Matches a stored node.style.fontFamily back to a known option, or null —
// callers fall back to showing the raw value in that case.
export function findFontOptionByFamily(family) {
  if (!family) return null;
  return getAllFontOptions().find((option) => option.family === family) ?? null;
}

// No-ops if this id is already registered — adding the same Google Font
// twice (same user or two different people) resolves to one shared entry.
export function registerCustomFont(font) {
  if (!font?.id || !font.family) return null;
  const existing = getAllFontOptions().find((option) => option.id === font.id);
  if (existing) return existing;
  customFontOptions.push(font);
  return font;
}

// In-memory only — callers pair this with saveCustomFontDeletion for the
// server-persisted removal.
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

// Mirrors templates.js's loadCustomPageSizes/saveCustomPageSize — same
// server-persisted, shared-across-everyone, register-then-persist-async flow.
export async function loadCustomFonts() {
  try {
    const url = new URL("../../data/custom-fonts.json", import.meta.url);
    const payload = await loadJson(url);
    const fonts = Array.isArray(payload?.fonts) ? payload.fonts : [];
    fonts.forEach((font) => registerCustomFont(font));
    return fonts;
  } catch (error) {
    // Logged (not silent) — non-fatal, but the font list otherwise stays
    // empty-but-for-Default with no visible sign anything is wrong.
    console.warn("Unable to load the shared font library:", error);
    return [];
  }
}

// Both server routes require a session (creator+ to add, admin to delete).
// This module stays decoupled from DataManager, so callers pass
// dataManager.session?.token directly rather than the whole class.
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

// No true HTTP DELETE anywhere in this server — every deletion is
// POST .../delete instead.
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
// serves, rather than trusting format alone: an unknown/typo'd name still
// gets a 200 with an empty stylesheet, so the signal is document.fonts.load()
// resolving to an empty array, not HTTP status. Uses <link>/document.fonts
// (native, unauthenticated) rather than fetch()-reading the cross-origin CSS.
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

// Google's font-picker metadata is key-free but not CORS-enabled for
// third-party origins, so it's routed through this server's own
// /google-fonts-metadata proxy. Lists each family's category ("serif",
// "sans-serif", ...), used to label newly-added fonts automatically. Best-
// effort, fetched once and cached — any failure just means no category
// suffix, never a hard error, since the font is verified separately via
// verifyGoogleFontExists.
const GOOGLE_FONTS_METADATA_URL = "/google-fonts-metadata";
let googleFontsMetadataPromise = null;

function loadGoogleFontsMetadata() {
  if (!googleFontsMetadataPromise) {
    const xssiPrefix = ")]}'";
    googleFontsMetadataPromise = fetch(GOOGLE_FONTS_METADATA_URL)
      .then((response) => (response.ok ? response.text() : Promise.reject(new Error("metadata unavailable"))))
      // Response body is prefixed with a fixed XSSI-protection string ahead
      // of the actual JSON — stripped by plain prefix check, not regex.
      .then((text) => JSON.parse(text.startsWith(xssiPrefix) ? text.slice(xssiPrefix.length) : text))
      .catch((error) => {
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
