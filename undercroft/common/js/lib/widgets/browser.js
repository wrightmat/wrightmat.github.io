// A widget that shows an arbitrary external URL — deliberately NOT a
// Library kind of its own (same reasoning clocks.js gives for its own
// config): the URL is small enough to live entirely in this widget
// instance's own persisted contentRef (dashboard.js's layout.widgets), not
// a server-backed kind. Showing this to the table does NOT touch any
// Library record at all — the spotlight entry itself carries the URL
// inline, as its own `data` payload (see server/groups.py's own
// _INLINE_SPOTLIGHT_KINDS, and data-manager.js's spotlightToGroup/
// updateSpotlightData) — every viewer that needs it either already has it
// from their own copy of the same dashboard layout (the GM's own dashboard,
// the second-screen mirror — see dashboard.js's own refreshScreen, which
// re-mounts a widget whenever its contentRef changes), or, for another
// player who accepted this spotlight onto their own separate dashboard,
// reads it straight from the spotlight entry's own data via
// initFollowerBrowser below (same pattern clocks.js uses for its own
// follower — the two widgets share this design, not two parallel ones).
//
// Renders as an <img> when the URL looks like a direct image file (common
// extensions), or an <iframe> otherwise (an arbitrary webpage). This is a
// best-effort heuristic, not a live probe: browsers give no reliable way to
// detect from the parent page whether a cross-origin iframe's content was
// blocked by the target site's own X-Frame-Options/CSP — a genuinely
// successful cross-origin embed and a silently-refused one both look
// identical to this page's own JS (same cross-origin isolation that makes
// embedding safe in the first place). An "Open in new tab" link sits next
// to the iframe as the escape hatch for exactly that case.
//
// A file: URL (or a raw Windows path normalizeUrl converts to one) is
// embedded through this server's own /local-file route (server/app.py)
// instead of used directly as an iframe/img src — browsers refuse file:
// as a subresource outright, but a normal http(s) response from THIS
// server has no such restriction. That server route is loopback-only, so
// it only ever actually works from the same physical machine the server
// runs on — which the GM's own dashboard tab satisfies, and so does the
// second-screen mirror (it reads this same widget instance's own
// contentRef directly, same-origin, same machine — see dashboard.js's own
// renderScreenView). A genuinely remote follower on a different machine
// just gets a failed embed for a local file — see renderLocalFile's own
// comment for the full reasoning.
import { el } from "../dom.js";
import { connectLiveStream } from "../live.js";
import { resolveIsSpotlighted, resolveSpotlightData } from "../spotlight.js";
import { createReliableInterval } from "../reliable-interval.js";
import { resolveApiBase } from "../api.js";

const IMAGE_EXTENSION_PATTERN = /\.(avif|bmp|gif|jpe?g|png|svg|webp)(\?.*)?(#.*)?$/i;
// 5s — same cadence clocks.js's own follower/GM poll uses; a second-screen
// display or an accepted follower's dashboard both want this to feel live.
const POLL_INTERVAL_MS = 5000;
// A Windows drive-letter path (`C:\...` or `C:/...`) or a UNC path
// (`\\server\share\...`), pasted raw — e.g. straight out of Explorer's own
// address bar, which is exactly how a GM would actually have this on hand,
// not as a hand-typed `file:///` URI. Deliberately narrow (only these two
// unambiguous Windows shapes) rather than also guessing at a bare leading
// "/some/path" — that's indistinguishable from a site-relative URL
// fragment someone might paste for an entirely different reason.
const WINDOWS_DRIVE_PATH_PATTERN = /^[a-zA-Z]:[\\/]/;
const WINDOWS_UNC_PATH_PATTERN = /^\\\\/;

function looksLikeImageUrl(url) {
  return IMAGE_EXTENSION_PATTERN.test(String(url || "").trim());
}

function isFileUrl(url) {
  return /^file:\/\//i.test(String(url || "").trim());
}

// null when `raw` doesn't look like a Windows path at all — lets
// normalizeUrl fall through to its other cases instead of assuming every
// non-URL string was meant to be a local path.
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

// A bare "example.com/thing.png" pasted without a scheme would otherwise
// resolve as a relative link on THIS site and 404 — be forgiving about what
// the GM pastes, same as most URL-accepting fields are. Same reasoning
// extends to a local file: a raw Windows path is far more likely to be
// what's actually on the GM's clipboard (from Explorer, or their Nextcloud
// folder) than a properly escaped file:// URI — see windowsPathToFileUrl.
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
    // A file:// URL's own "hostname" is empty for a local drive path, so
    // the hostname-based title below would just fall back to "Browser" —
    // the filename itself is far more useful here.
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

// Reverses windowsPathToFileUrl (or any other file: URL) back into a plain
// filesystem path string — /local-file needs a real path to open, not a
// URI. Goes through the URL parser itself rather than hand-rolled scheme-
// stripping, since a UNC path (file://server/share/...) and a drive-letter
// path (file:///C:/...) put the same information in different parts of the
// URL (hostname vs pathname).
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

// Builds the actual <img>/<iframe> element for content confirmed reachable
// at `embedSrc` — which may differ from `url` itself (renderLocalFile
// passes the /local-file proxy URL here, while `url` — the original
// file:/http(s) address — still decides image-vs-iframe via
// looksLikeImageUrl, since that's about the CONTENT's type, not where it's
// being fetched from, and still backs the "open natively"/"open in new
// tab" link everywhere it's shown).
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
    // replaced element like <img> resolves to its own INTRINSIC (natural
    // pixel) size — that floor can win out over max-width/max-height:100%
    // in the flex sizing algorithm, pinning the image at its natural size
    // regardless of how big or small this wrap actually is. Confirmed real:
    // under an ancestor's CSS zoom (mountWidget's own widget-zoom feature),
    // this showed up as text scaling normally while the image itself never
    // changed size at all. Explicit 0 here removes that floor, letting
    // max-width/max-height (and so the zoom scaling everything else in this
    // subtree already responds to) actually govern the image's size.
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
  // Permissive enough that most embedded pages still render (scripts,
  // same-origin, forms, popups a page opens itself), but withholds
  // top-level navigation — an embedded page hijacking this whole dashboard
  // tab isn't something a "show this URL" widget should allow.
  //
  // allow-same-origin is safe for a genuinely cross-origin remote URL (the
  // default case) — combined with allow-scripts, it just lets the embedded
  // page run normally as ITS OWN origin, which still can't reach this
  // parent page at all (an ordinary cross-origin iframe boundary, sandbox
  // or not). renderLocalFile passes allowSameOrigin: false for exactly the
  // one case where that's NOT true: /local-file's response is SAME-origin
  // as this dashboard itself, so allow-same-origin there would hand a
  // local HTML file's own script the full same-origin access allow-scripts
  // alone doesn't grant — including this page's own localStorage (the
  // signed-in session token) and DOM. Dropping it forces the frame into an
  // opaque origin instead, same as any other sandboxed-without-
  // allow-same-origin embed — scripts still run, they just can't reach out.
  const sandboxTokens = ["allow-scripts", "allow-forms", "allow-popups"];
  if (allowSameOrigin) sandboxTokens.push("allow-same-origin");
  frame.setAttribute("sandbox", sandboxTokens.join(" "));
  return frame;
}

// Browsers flatly refuse to load a file: URL as a subresource (iframe/img)
// from an http(s) page — confirmed Chromium behavior: "Not allowed to load
// local resource" in the console, a hardcoded scheme restriction rather
// than a CORS check, so no sandbox attribute fixes it. Routing the embed
// itself through this server's own /local-file endpoint (server/app.py)
// sidesteps that entirely — from the browser's point of view it's just an
// ordinary same-origin http(s) resource, exactly as embeddable as anything
// else this widget already shows. That endpoint refuses anything but a
// loopback (same-machine) request, so this only actually renders inline
// for the GM's own dashboard tab and the second-screen mirror (also the
// same machine) — a genuinely remote follower gets a failed embed instead,
// which is the honest outcome for a file that only ever existed on someone
// else's computer.
function renderLocalFile(target, url, dataManager) {
  const token = dataManager?.session?.token || "";
  if (!token) {
    // Not signed in (or no dataManager at all) — /local-file requires
    // GM-tier auth and there's no token to send it. Falls back to the one
    // thing that still works with no server round-trip at all: a direct
    // top-level navigation via a real link click, same as "Open in new
    // tab" already relies on for a blocked cross-origin iframe below.
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

// Fills whatever height/width its own parent gives it — same "the grid
// already decided this widget's real size, content should just fill it"
// convention map.js/handout.js's own journal view use.
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

// contentRef.followKind === "browser" marks a "follower" instance — created
// by acceptSpotlight (dashboard.js) when a player accepts a GM's Browser
// spotlight, never by manually adding the Browser widget from the toolbar.
// Purely a read-only mirror: no URL input, nothing persisted locally, just
// whatever the GM's own instance last showed — read via resolveSpotlightData
// (the spotlight entry's own inline `data`), since there's no Library record
// to fetch the way a Handout/Map follower would. Same shape as clocks.js's
// own initFollowerClock.
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
  // createReliableInterval (not plain window.setInterval) — a followed
  // widget popped out onto a physical second screen, or just left unfocused
  // in a background tab, sits unfocused for the whole session; plain
  // setInterval was confirmed to stall there. See reliable-interval.js's own
  // header.
  pollTimer = createReliableInterval(() => void refresh(), POLL_INTERVAL_MS);
  // The group log itself is the one live channel every inline-kind follower
  // watches (no dedicated "browser" kind live-stream, since there's no
  // Library record to key one off of) — matches clocks.js's own follower.
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
        // skipShare — there's no Library record to grant view permission on
        // at all (see this file's own header comment); the server enforces
        // the same allowance independently for kind "browser". `data` is
        // the URL itself — the only "content" a follower or the second
        // screen needs, carried inline rather than fetched.
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

  // Keeps a follower's next poll (or live-stream nudge) current with the URL
  // — a plain spotlight-update, not a fresh `spotlight` entry, so editing the
  // URL while shown doesn't re-trigger every other viewer's accept-prompt or
  // add a new Game Log row (see data-manager.js's own updateSpotlightData).
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
      // Read-only — same "no editing controls" convention every other
      // widget's forced-player-view uses. Also the second-screen mirror's
      // own render path (dashboard.js mounts screenMode widgets with this
      // set) — see this file's own header for why passing dataManager here
      // is what actually lets a local file show up there.
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
    // for this widget type (see mountWidget's own isBrowser comment) — is
    // what keeps zooming in to read small embedded content from also
    // blowing the address bar up into something absurd; only the content
    // (rendered into `container` itself, which DOES get zoomed) is what
    // the zoom controls are actually for. Falls back to building both in
    // `container` together, same as before this split existed, for any
    // caller that doesn't supply one.
    if (plainMountContainer) {
      // mb-2 lives on the input itself, not the (otherwise-empty, in
      // forcePlayerView/the second screen) plainMountContainer wrapper —
      // a static margin on that wrapper would leave a small, pointless gap
      // above the content even when nothing renders into it at all.
      urlInput.classList.add("mb-2");
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
  // First mount with nothing saved yet — persist the default immediately so
  // a reload doesn't silently regenerate/lose it (same convention clocks.js
  // uses for its own default config).
  if (!contentRef) setContentRef?.(config);
  void refreshVisibility();

  return {
    // `removed` is only ever true from dashboard.js's removeWidget — the one
    // moment this instance's own still-active spotlight (if any) needs
    // clearing. There's no Library record here to make this automatic (see
    // this file's own header comment) — without this, removing a currently-
    // shown Browser widget would orphan any follower/second-screen view on
    // frozen, never-clearable stale data, since nothing could ever toggle
    // this instance's own id off again.
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
