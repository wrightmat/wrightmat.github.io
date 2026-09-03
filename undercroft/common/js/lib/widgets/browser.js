// A widget that shows an arbitrary external URL — deliberately NOT a
// Library kind (same reasoning as clocks.js): the URL is small enough to
// live in this widget instance's own persisted contentRef. Showing this to
// the table doesn't touch any Library record — the spotlight entry carries
// the URL inline as its own `data` payload (server/groups.py's
// _INLINE_SPOTLIGHT_KINDS; data-manager.js's spotlightToGroup/
// updateSpotlightData), read by a follower via initFollowerBrowser below
// (same pattern as clocks.js's follower).
//
// Renders as an <img> when the URL looks like a direct image file, or an
// <iframe> otherwise. This is a best-effort heuristic, not a live probe —
// there's no reliable cross-origin way to detect a target site's own
// X-Frame-Options/CSP blocking the embed; "Open in new tab" is the escape hatch.
//
// A file: URL (or a raw Windows path normalizeUrl converts to one) is
// embedded through this server's own /local-file route instead of used
// directly — browsers refuse file: as a subresource outright, but a normal
// http(s) response from THIS server doesn't have that restriction. That
// route is loopback-only, so it only actually works from the same physical
// machine the server runs on (the GM's dashboard tab, the second-screen
// mirror) — a remote follower just gets a failed embed. See renderLocalFile.
import { el } from "../dom.js";
import { connectLiveStream } from "../live.js";
import { resolveIsSpotlighted, resolveSpotlightData } from "../spotlight.js";
import { createReliableInterval } from "../reliable-interval.js";
import { resolveApiBase } from "../api.js";

const IMAGE_EXTENSION_PATTERN = /\.(avif|bmp|gif|jpe?g|png|svg|webp)(\?.*)?(#.*)?$/i;
const POLL_INTERVAL_MS = 5000; // same cadence as clocks.js's own follower/GM poll
// A Windows drive-letter path (`C:\...`) or UNC path (`\\server\share\...`)
// pasted raw, e.g. straight from Explorer's address bar — deliberately
// narrow to these two unambiguous shapes rather than also guessing at a
// bare leading "/some/path", which is indistinguishable from a relative URL.
const WINDOWS_DRIVE_PATH_PATTERN = /^[a-zA-Z]:[\\/]/;
const WINDOWS_UNC_PATH_PATTERN = /^\\\\/;

function looksLikeImageUrl(url) {
  return IMAGE_EXTENSION_PATTERN.test(String(url || "").trim());
}

function isFileUrl(url) {
  return /^file:\/\//i.test(String(url || "").trim());
}

// null when `raw` doesn't look like a Windows path — lets normalizeUrl fall through to its other cases.
function windowsPathToFileUrl(raw) {
  const trimmed = raw.trim();
  if (WINDOWS_UNC_PATH_PATTERN.test(trimmed)) {
    return `file:${encodeURI(trimmed.replace(/\\/g, "/"))}`;
  }
  if (WINDOWS_DRIVE_PATH_PATTERN.test(trimmed)) {
    return `file:///${encodeURI(trimmed.replace(/\\/g, "/"))}`;
  }
  return null;
}

// Forgiving about what's pasted — a bare "example.com/thing.png" without a
// scheme would otherwise resolve as a relative link on this site and 404.
function normalizeUrl(raw) {
  const trimmed = String(raw || "").trim();
  if (!trimmed) return "";
  if (isFileUrl(trimmed) || /^https?:\/\//i.test(trimmed) || trimmed.startsWith("data:")) return trimmed;
  const asFileUrl = windowsPathToFileUrl(trimmed);
  if (asFileUrl) return asFileUrl;
  return `https://${trimmed}`;
}

function titleFor(url) {
  if (!url) return "Browser";
  if (isFileUrl(url)) {
    // A file:// URL's "hostname" is empty for a local drive path, so the filename is more useful than the hostname title below.
    try {
      const name = decodeURI(url).split(/[\\/]/).filter(Boolean).pop();
      return name || "Local file";
    } catch (error) {
      return "Local file";
    }
  }
  try {
    return new URL(url).hostname || "Browser";
  } catch (error) {
    return "Browser";
  }
}

// Reverses a file: URL back into a plain filesystem path — /local-file
// needs a real path. Goes through the URL parser since a UNC path
// (file://server/share/...) and a drive-letter path (file:///C:/...) put
// the info in different parts of the URL (hostname vs pathname).
function fileUrlToPath(fileUrl) {
  try {
    const parsed = new URL(fileUrl);
    const pathname = decodeURIComponent(parsed.pathname);
    if (parsed.hostname) {
      return `\\\\${parsed.hostname}${pathname.replace(/\//g, "\\")}`;
    }
    return pathname.replace(/^\//, "");
  } catch (error) {
    return fileUrl;
  }
}

function buildLocalFileEmbedSrc(fileUrl, token) {
  const params = new URLSearchParams({ path: fileUrlToPath(fileUrl), token });
  return `${resolveApiBase()}/local-file?${params.toString()}`;
}

// `embedSrc` (what's actually fetched) may differ from `url` (the original
// address, which still decides image-vs-iframe via looksLikeImageUrl and backs the "open" links).
function buildEmbedElement(url, embedSrc, { allowSameOrigin = true } = {}) {
  if (looksLikeImageUrl(url)) {
    const wrap = el("div", "d-flex align-items-center justify-content-center flex-grow-1");
    wrap.style.minHeight = "0";
    wrap.style.minWidth = "0";
    wrap.style.overflow = "hidden";
    const img = document.createElement("img");
    img.src = embedSrc;
    img.alt = titleFor(url);
    img.style.maxWidth = "100%";
    img.style.maxHeight = "100%";
    img.style.objectFit = "contain";
    // A flex item's min-width/min-height default to `auto`, which for a
    // replaced element like <img> resolves to its intrinsic size — that
    // floor can win over max-width/max-height:100% and pin the image at
    // natural size regardless of the wrap's actual size (confirmed under
    // ancestor CSS zoom: text scaled, the image didn't). Explicit 0 removes it.
    img.style.minWidth = "0";
    img.style.minHeight = "0";
    img.addEventListener("error", () => {
      wrap.innerHTML = "";
      wrap.appendChild(el("p", "text-danger small mb-0", "Unable to load this image."));
    });
    wrap.appendChild(img);
    return wrap;
  }
  const frame = document.createElement("iframe");
  frame.src = embedSrc;
  frame.title = titleFor(url);
  frame.style.flex = "1 1 0";
  frame.style.minHeight = "0";
  frame.style.width = "100%";
  frame.style.border = "1px solid var(--bs-border-color)";
  frame.style.borderRadius = "0.5rem";
  // Permissive enough for most embedded pages (scripts, same-origin, forms,
  // popups) but withholds top-level navigation, so an embedded page can't hijack this tab.
  // allow-same-origin is safe for a genuinely cross-origin remote URL — it
  // just lets the page run as ITS OWN origin, still unable to reach this
  // parent. renderLocalFile passes allowSameOrigin: false because
  // /local-file's response IS same-origin as this dashboard, so
  // allow-same-origin there would hand a local HTML file's script full
  // access to this page's own localStorage (the session token) and DOM.
  const sandboxTokens = ["allow-scripts", "allow-forms", "allow-popups"];
  if (allowSameOrigin) sandboxTokens.push("allow-same-origin");
  frame.setAttribute("sandbox", sandboxTokens.join(" "));
  return frame;
}

// Browsers flatly refuse to load a file: URL as a subresource from an
// http(s) page (a hardcoded scheme restriction, not a CORS check — no
// sandbox attribute fixes it). Routing through this server's own
// /local-file endpoint sidesteps that: from the browser's view it's an
// ordinary same-origin http(s) resource. That endpoint refuses anything but
// a loopback request, so this only renders inline on the GM's own dashboard
// tab and the second-screen mirror — a remote follower gets a failed embed,
// the honest outcome for a file that only exists on someone else's machine.
function renderLocalFile(target, url, dataManager) {
  const token = dataManager?.session?.token || "";
  if (!token) {
    // No session token to send /local-file (GM-tier auth required) — falls
    // back to a direct top-level navigation link, the one thing that works with no server round-trip.
    const wrap = el(
      "div",
      "d-flex flex-column align-items-center justify-content-center gap-2 flex-grow-1 text-center p-3"
    );
    wrap.style.minHeight = "0";
    const icon = el("span", "iconify fs-1 text-body-secondary");
    icon.dataset.icon = "tabler:file-symlink";
    icon.setAttribute("aria-hidden", "true");
    const link = document.createElement("a");
    link.href = url;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.className = "btn btn-outline-primary btn-sm";
    link.textContent = `Open "${titleFor(url)}" ↗`;
    const note = el("p", "text-body-secondary small mb-0", "Sign in to preview local files inline.");
    wrap.append(icon, link, note);
    target.appendChild(wrap);
    return;
  }
  const wrap = el("div", "d-flex flex-column gap-1 flex-grow-1");
  wrap.style.minHeight = "0";
  wrap.appendChild(
    buildEmbedElement(url, buildLocalFileEmbedSrc(url, token), { allowSameOrigin: false })
  );
  const openLink = document.createElement("a");
  openLink.href = url;
  openLink.target = "_blank";
  openLink.rel = "noopener noreferrer";
  openLink.className = "small align-self-end";
  openLink.textContent = "Open natively ↗";
  wrap.appendChild(openLink);
  target.appendChild(wrap);
}

// Fills whatever height/width its parent gives it — same convention map.js/handout.js's journal view use.
function renderContent(target, url, { dataManager } = {}) {
  target.innerHTML = "";
  if (!url) {
    target.appendChild(el("p", "text-body-secondary small mb-0", "No URL set yet."));
    return;
  }
  if (isFileUrl(url)) {
    renderLocalFile(target, url, dataManager);
    return;
  }
  if (looksLikeImageUrl(url)) {
    target.appendChild(buildEmbedElement(url, url));
    return;
  }
  const wrap = el("div", "d-flex flex-column gap-1 flex-grow-1");
  wrap.style.minHeight = "0";
  const openLink = document.createElement("a");
  openLink.href = url;
  openLink.target = "_blank";
  openLink.rel = "noopener noreferrer";
  openLink.className = "small align-self-end";
  openLink.textContent = "Open in new tab ↗";
  wrap.append(buildEmbedElement(url, url), openLink);
  target.appendChild(wrap);
}

function renderFollowerEmpty(container) {
  container.innerHTML = "";
  container.appendChild(el("p", "text-body-secondary small mb-0", "The GM isn't showing this link right now."));
}

// contentRef.followKind === "browser" marks a "follower" instance, created
// by acceptSpotlight (dashboard.js) when a player accepts a GM's Browser
// spotlight, never by manually adding this widget. Read-only mirror: no
// input, nothing persisted locally — reads via resolveSpotlightData since
// there's no Library record to fetch (same shape as clocks.js's follower).
function initFollowerBrowser(container, { dataManager, groupId = "", shareToken = "", followId, setTitle }) {
  let destroyed = false;
  let pollTimer = 0;

  async function refresh() {
    try {
      const data = await resolveSpotlightData(dataManager, { groupId, shareToken, kind: "browser", id: followId });
      if (destroyed) return;
      if (!data || !data.url) {
        renderFollowerEmpty(container);
        setTitle?.("Browser");
        return;
      }
      setTitle?.(titleFor(data.url));
      renderContent(container, data.url, { dataManager });
    } catch (error) {
      if (!destroyed) renderFollowerEmpty(container);
    }
  }

  void refresh();
  // createReliableInterval, not plain setInterval — a followed widget on a
  // popped-out second screen or unfocused background tab needs this to not stall (see reliable-interval.js).
  pollTimer = createReliableInterval(() => void refresh(), POLL_INTERVAL_MS);
  // The group log is the one live channel an inline-kind follower watches — matches clocks.js's own follower.
  const liveStream = connectLiveStream({ dataManager, groupId, kinds: ["group_log"], shareToken });
  liveStream.subscribe("group_log", () => void refresh());

  return {
    destroy() {
      destroyed = true;
      if (pollTimer) pollTimer.stop();
      liveStream.close();
      container.innerHTML = "";
    },
  };
}

export function initBrowserWidget(
  container,
  {
    contentRef,
    setContentRef,
    setTitle,
    dataManager,
    status,
    groupId = "",
    shareToken = "",
    canToggleVisibility = false,
    setRightAction,
    instanceId = "",
    forcePlayerView = false,
    plainMountContainer = null,
  } = {}
) {
  if (!container) {
    return { destroy() {} };
  }

  if (contentRef?.followKind === "browser") {
    return initFollowerBrowser(container, { dataManager, groupId, shareToken, followId: contentRef.followId, setTitle });
  }

  let config = { url: "", ...(contentRef || {}) };
  let destroyed = false;
  let visible = false;

  function updateVisibilityAction() {
    if (!canToggleVisibility) return;
    setRightAction?.({
      icon: visible ? "tabler:eye" : "tabler:eye-off",
      tooltip: visible ? "Showing to table — click to hide" : "Hidden from table — click to show",
      active: visible,
      onClick: () => void toggleVisibility(),
    });
  }

  async function refreshVisibility() {
    if (!canToggleVisibility || !groupId || !instanceId) {
      visible = false;
      return;
    }
    visible = await resolveIsSpotlighted(dataManager, { groupId, shareToken, kind: "browser", id: instanceId });
    updateVisibilityAction();
  }

  async function toggleVisibility() {
    if (!groupId || !instanceId) {
      status?.show("No active campaign to show this to.", { type: "warning", timeout: 2500 });
      return;
    }
    try {
      if (visible) {
        await dataManager.clearSpotlight({ groupId, kind: "browser", id: instanceId });
        status?.show("Stopped showing to the table.", { type: "success", timeout: 2000 });
      } else {
        // skipShare — no Library record to grant view permission on (see header comment); the
        // server enforces the same allowance for kind "browser" independently. `data` carries the URL inline.
        await dataManager.spotlightToGroup({
          groupId,
          contentType: "browser",
          contentId: instanceId,
          skipShare: true,
          data: { url: config.url },
        });
        status?.show("Showing to the table.", { type: "success", timeout: 2000 });
      }
    } catch (error) {
      status?.show(error.message || "Unable to update visibility.", { type: "error" });
    }
    await refreshVisibility();
  }

  // A plain spotlight-update, not a fresh entry — editing the URL while
  // shown shouldn't re-trigger every viewer's accept-prompt or add a Game Log row.
  async function pushVisibleUpdate() {
    if (!visible || !dataManager || !instanceId || !groupId) return;
    try {
      await dataManager.updateSpotlightData({ groupId, kind: "browser", id: instanceId, data: { url: config.url } });
    } catch (error) {
      // Best-effort — a follower just won't see this particular edit yet.
    }
  }

  function persist(next) {
    config = next;
    setContentRef?.(config);
    setTitle?.(titleFor(config.url));
    render();
    void pushVisibleUpdate();
  }

  function render() {
    if (destroyed) return;
    container.innerHTML = "";
    if (forcePlayerView) {
      // Read-only, same convention every widget's forced-player-view uses —
      // also the second-screen mirror's own render path.
      renderContent(container, config.url, { dataManager });
      return;
    }
    const urlInput = document.createElement("input");
    urlInput.type = "text";
    urlInput.className = "form-control form-control-sm";
    urlInput.placeholder = "Paste a URL, or a local file path (e.g. C:\\Users\\...)…";
    urlInput.value = config.url;
    urlInput.addEventListener("change", () => {
      persist({ ...config, url: normalizeUrl(urlInput.value) });
    });
    // plainMountContainer — dashboard.js's own never-zoomed sibling mount
    // for this widget type — keeps zooming in to read small embedded
    // content from also blowing up the address bar; only `container`
    // itself gets zoomed. Falls back to building both together in
    // `container` for a caller that doesn't supply one.
    if (plainMountContainer) {
      urlInput.classList.add("mb-2"); // margin on the input, not the otherwise-empty wrapper
      plainMountContainer.innerHTML = "";
      plainMountContainer.appendChild(urlInput);
      const contentHost = el("div", "d-flex flex-column flex-grow-1");
      contentHost.style.minHeight = "0";
      renderContent(contentHost, config.url, { dataManager });
      container.appendChild(contentHost);
      return;
    }
    const wrap = el("div", "d-flex flex-column gap-2 flex-grow-1");
    wrap.style.minHeight = "0";
    wrap.appendChild(urlInput);
    const contentHost = el("div", "d-flex flex-column flex-grow-1");
    contentHost.style.minHeight = "0";
    renderContent(contentHost, config.url, { dataManager });
    wrap.appendChild(contentHost);
    container.appendChild(wrap);
  }

  render();
  setTitle?.(titleFor(config.url));
  if (!contentRef) setContentRef?.(config); // persist the default immediately so a reload doesn't lose it
  void refreshVisibility();

  return {
    // `removed` is only true from dashboard.js's removeWidget — the one
    // moment this instance's own still-active spotlight needs clearing;
    // there's no Library record to make this automatic (see header comment).
    async destroy(removed) {
      destroyed = true;
      container.innerHTML = "";
      if (removed && visible && groupId && instanceId) {
        try {
          await dataManager.clearSpotlight({ groupId, kind: "browser", id: instanceId });
        } catch (error) {
          // Best-effort cleanup — nothing meaningful to do if this fails.
        }
      }
    },
  };
}
