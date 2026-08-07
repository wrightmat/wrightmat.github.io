// A shared, server-persisted library of GM-added token image links (links
// only — no file hosting by this app) for map tokens/portraits (Orrery
// marker images, Forge NPC / Crucible Monster portraits) — same pattern
// audio-clip-library.js/font-library.js already established: a flat JSON
// file (common/data/token-library.json), not a Library kind, since there's
// no per-token ownership/sharing to model, just one shared catalog everyone
// reads from and gm+ can add to. Framework-free (no DataManager import) on
// purpose, same reasoning those two give — callers pass whatever auth token
// they already have.
export const BUILTIN_TOKENS = [];

// Tokens added at runtime (via the picker's own "Save to library" form) or
// loaded from the server on mount — starts empty, grows in-memory
// immediately on add (optimistic) and is repopulated from the server via
// loadTokenLibrary.
let customTokens = [];

export function getAllTokens() {
  return [...customTokens].sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
}

export function getTokenById(id) {
  return customTokens.find((token) => token.id === id) ?? null;
}

// Upserts by id — re-registering an id that already exists (this GM's own
// optimistic add landing again after the server round-trip, or two people
// adding the same token independently) replaces it in place rather than
// duplicating the list.
export function registerToken(token) {
  if (!token?.id || !token.url) return null;
  const index = customTokens.findIndex((entry) => entry.id === token.id);
  if (index >= 0) {
    customTokens[index] = token;
  } else {
    customTokens.push(token);
  }
  return token;
}

// Removes it from the in-memory list only — callers pair this with
// deleteToken for the server-persisted removal, same "update immediately,
// persist async" shape as adding one.
export function removeTokenLocally(id) {
  customTokens = customTokens.filter((token) => token.id !== id);
}

async function loadJson(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Unable to load ${url}: ${response.status}`);
  }
  return response.json();
}

// Mirrors audio-clip-library.js's own loadClipLibrary exactly — same
// server-persisted, shared-across-everyone pattern, same "register
// immediately in-memory, persist async" flow. No internal caching guard — a
// picker mounted more than once in one session just re-fetches and
// re-registers, harmless.
export async function loadTokenLibrary() {
  try {
    const url = new URL("../../data/token-library.json", import.meta.url);
    const payload = await loadJson(url);
    const tokens = Array.isArray(payload?.tokens) ? payload.tokens : [];
    tokens.forEach((token) => registerToken(token));
    return tokens;
  } catch (error) {
    return [];
  }
}

function authHeaders(authToken) {
  const headers = { "Content-Type": "application/json" };
  if (authToken) headers.Authorization = `Bearer ${authToken}`;
  return headers;
}

export async function saveToken(token, authToken) {
  const response = await fetch("/token-library", {
    method: "POST",
    headers: authHeaders(authToken),
    body: JSON.stringify({ token }),
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload.error || "Unable to save token.");
  }
  return response.json();
}

// This server has no true HTTP DELETE wired up anywhere — every deletion in
// this codebase is POST .../delete instead.
export async function deleteToken(id, authToken) {
  const response = await fetch("/token-library/delete", {
    method: "POST",
    headers: authHeaders(authToken),
    body: JSON.stringify({ id }),
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload.error || "Unable to delete token.");
  }
  return response.json();
}
