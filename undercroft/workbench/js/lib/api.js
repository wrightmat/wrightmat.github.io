export function resolveApiBase() {
  if (typeof window === "undefined") {
    return "";
  }
  if (window.__WORKBENCH_API_BASE__ && typeof window.__WORKBENCH_API_BASE__ === "string") {
    return window.__WORKBENCH_API_BASE__;
  }
  const { origin, protocol, host } = window.location || {};
  if (origin && origin !== "null") {
    return origin;
  }
  if (protocol && protocol.startsWith("http") && host) {
    return `${protocol}//${host}`;
  }
  return "";
}
