// A shared, server-persisted library of GM-added token image links (links
// only — no file hosting) for map tokens/portraits — same pattern as
// audio-clip-library.js/font-library.js: a flat JSON file, not a Library
// kind, since there's no per-token ownership/sharing, just one shared
// catalog gm+ can add to. Framework-free (no DataManager import) — callers
// pass whatever auth token they already have.
export const BUILTIN_TOKENS = [];

// Starts empty, grows in-memory immediately on add (optimistic), and is
// repopulated from the server via loadTokenLibrary.
let customTokens = [];

export function getAllTokens() {
  return [...customTokens].sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
}

export function getTokenById(id) {
  return customTokens.find((token) => token.id === id) ?? null;
}

// Upserts by id — re-registering an existing id (an optimistic add landing
// again after the server round-trip) replaces it in place, not duplicated.
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

// In-memory only — callers pair this with deleteToken for the persisted removal.
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

// Mirrors audio-clip-library.js's loadClipLibrary. No internal caching guard
// — a picker mounted more than once just re-fetches/re-registers, harmless.
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
