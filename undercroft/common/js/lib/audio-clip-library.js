// A shared, server-persisted library of GM-added audio clips (links only —
// still no file hosting by this app, see soundboard.js's own header
// comment) for the Dashboard's Soundboard widget — same pattern
// press/js/font-library.js already established for Press's own custom
// fonts: a flat JSON file (common/data/audio-clips.json), not a Library
// kind, since there's no per-clip ownership/sharing to model, just one
// shared catalog everyone reads from and gm+ can add to. Framework-free
// (no DataManager import) on purpose, same reasoning font-library.js gives
// — callers pass whatever auth token they already have.
export const BUILTIN_CLIPS = [];

// Clips added at runtime (via the widget's own "Add a clip" form) or loaded
// from the server on mount — starts empty, grows in-memory immediately on
// add (optimistic) and is repopulated from the server via loadClipLibrary.
let customClips = [];

export function getAllClips() {
  return [...customClips].sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
}

export function getClipById(id) {
  return customClips.find((clip) => clip.id === id) ?? null;
}

// Upserts by id — re-registering an id that already exists (this GM's own
// optimistic add landing again after the server round-trip, or two people
// adding the same clip independently) replaces it in place rather than
// duplicating the list.
export function registerClip(clip) {
  if (!clip?.id || !clip.url) return null;
  const index = customClips.findIndex((entry) => entry.id === clip.id);
  if (index >= 0) {
    customClips[index] = clip;
  } else {
    customClips.push(clip);
  }
  return clip;
}

// Removes it from the in-memory list only — callers pair this with
// deleteClip for the server-persisted removal, same "update immediately,
// persist async" shape as adding one.
export function removeClipLocally(id) {
  customClips = customClips.filter((clip) => clip.id !== id);
}

async function loadJson(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Unable to load ${url}: ${response.status}`);
  }
  return response.json();
}

// Mirrors font-library.js's own loadCustomFonts exactly — same
// server-persisted, shared-across-everyone pattern, same "register
// immediately in-memory, persist async" flow. No internal caching guard
// (matches loadCustomFonts, not the separately-cached
// loadGoogleFontsMetadata) — a widget mounted more than once in one session
// just re-fetches and re-registers, harmless.
export async function loadClipLibrary() {
  try {
    const url = new URL("../../data/audio-clips.json", import.meta.url);
    const payload = await loadJson(url);
    const clips = Array.isArray(payload?.clips) ? payload.clips : [];
    clips.forEach((clip) => registerClip(clip));
    return clips;
  } catch (error) {
    return [];
  }
}

function authHeaders(authToken) {
  const headers = { "Content-Type": "application/json" };
  if (authToken) headers.Authorization = `Bearer ${authToken}`;
  return headers;
}

export async function saveClip(clip, authToken) {
  const response = await fetch("/soundboard/clips", {
    method: "POST",
    headers: authHeaders(authToken),
    body: JSON.stringify({ clip }),
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload.error || "Unable to save clip.");
  }
  return response.json();
}

// This server has no true HTTP DELETE wired up anywhere — every deletion in
// this codebase is POST .../delete instead.
export async function deleteClip(id, authToken) {
  const response = await fetch("/soundboard/clips/delete", {
    method: "POST",
    headers: authHeaders(authToken),
    body: JSON.stringify({ id }),
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload.error || "Unable to delete clip.");
  }
  return response.json();
}
