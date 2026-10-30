// Every server route lives under this prefix (see API_PREFIX in server/app.py), so the app works
// the same behind a reverse proxy that routes /undercroft/ as it does when served directly.
const API_PATH = "/undercroft/api";

export function resolveApiBase() {
  if (typeof window === "undefined") {
    return "";
  }
  if (window.__WORKBENCH_API_BASE__ && typeof window.__WORKBENCH_API_BASE__ === "string") {
    return window.__WORKBENCH_API_BASE__;
  }
  const { origin, protocol, host } = window.location || {};
  if (origin && origin !== "null") {
    return `${origin}${API_PATH}`;
  }
  if (protocol && protocol.startsWith("http") && host) {
    return `${protocol}//${host}${API_PATH}`;
  }
  return "";
}

export function apiUrl(path) {
  return `${resolveApiBase()}${path}`;
}
