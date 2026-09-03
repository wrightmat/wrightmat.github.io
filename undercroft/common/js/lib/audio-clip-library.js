// A shared, server-persisted library of GM-added audio clips (links only,
// no file hosting — see soundboard.js) for the Dashboard's Soundboard
// widget, same pattern as press/js/font-library.js: a flat JSON file, not
// a Library kind, since there's no per-clip ownership to model. Framework-
// free (no DataManager import) — callers pass whatever auth token they have.
export const BUILTIN_CLIPS = [];

// Clips added at runtime or loaded from the server on mount — starts
// empty, grows optimistically on add, repopulated via loadClipLibrary.
let customClips = [];

export function getAllClips() {
  return [...customClips].sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
}

export function getClipById(id) {
  return customClips.find((clip) => clip.id === id) ?? null;
}

// Upserts by id — a re-registered id (this client's own optimistic add
// landing again after the server round-trip) replaces in place.
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

// In-memory only — callers pair this with deleteClip for the server-
// persisted removal, same optimistic-update shape as adding one.
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

// Mirrors font-library.js's loadCustomFonts. No internal caching guard —
// a widget mounted twice in one session just re-fetches, harmless.
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
