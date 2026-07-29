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
import { el } from "../dom.js";
import { connectLiveStream } from "../live.js";
import { resolveIsSpotlighted, resolveSpotlightData } from "../spotlight.js";
import { createReliableInterval } from "../reliable-interval.js";

const IMAGE_EXTENSION_PATTERN = /\.(avif|bmp|gif|jpe?g|png|svg|webp)(\?.*)?(#.*)?$/i;
// 5s — same cadence clocks.js's own follower/GM poll uses; a second-screen
// display or an accepted follower's dashboard both want this to feel live.
const POLL_INTERVAL_MS = 5000;

function looksLikeImageUrl(url) {
  return IMAGE_EXTENSION_PATTERN.test(String(url || "").trim());
}

// A bare "example.com/thing.png" pasted without a scheme would otherwise
// resolve as a relative link on THIS site and 404 — be forgiving about what
// the GM pastes, same as most URL-accepting fields are.
function normalizeUrl(raw) {
  const trimmed = String(raw || "").trim();
  if (!trimmed) return "";
  if (/^https?:\/\//i.test(trimmed) || trimmed.startsWith("data:")) return trimmed;
  return `https://${trimmed}`;
}

function titleFor(url) {
  if (!url) return "Browser";
  try {
    return new URL(url).hostname || "Browser";
  } catch (error) {
    return "Browser";
  }
}

// Fills whatever height/width its own parent gives it — same "the grid
// already decided this widget's real size, content should just fill it"
// convention map.js/handout.js's own journal view use.
function renderContent(target, url) {
  target.innerHTML = "";
  if (!url) {
    target.appendChild(el("p", "text-body-secondary small mb-0", "No URL set yet."));
    return;
  }
  if (looksLikeImageUrl(url)) {
    const wrap = el("div", "d-flex align-items-center justify-content-center flex-grow-1");
    wrap.style.minHeight = "0";
    wrap.style.overflow = "hidden";
    const img = document.createElement("img");
    img.src = url;
    img.alt = titleFor(url);
    img.style.maxWidth = "100%";
    img.style.maxHeight = "100%";
    img.style.objectFit = "contain";
    img.addEventListener("error", () => {
      wrap.innerHTML = "";
      wrap.appendChild(el("p", "text-danger small mb-0", "Unable to load this image."));
    });
    wrap.appendChild(img);
    target.appendChild(wrap);
    return;
  }
  const wrap = el("div", "d-flex flex-column gap-1 flex-grow-1");
  wrap.style.minHeight = "0";
  const frame = document.createElement("iframe");
  frame.src = url;
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
  frame.setAttribute("sandbox", "allow-scripts allow-same-origin allow-forms allow-popups");
  const openLink = document.createElement("a");
  openLink.href = url;
  openLink.target = "_blank";
  openLink.rel = "noopener noreferrer";
  openLink.className = "small align-self-end";
  openLink.textContent = "Open in new tab ↗";
  wrap.append(frame, openLink);
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
      renderContent(container, data.url);
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
      // widget's forced-player-view uses.
      renderContent(container, config.url);
      return;
    }
    const wrap = el("div", "d-flex flex-column gap-2 flex-grow-1");
    wrap.style.minHeight = "0";
    const urlInput = document.createElement("input");
    urlInput.type = "text";
    urlInput.className = "form-control form-control-sm";
    urlInput.placeholder = "Paste a URL…";
    urlInput.value = config.url;
    urlInput.addEventListener("change", () => {
      persist({ ...config, url: normalizeUrl(urlInput.value) });
    });
    wrap.appendChild(urlInput);
    const contentHost = el("div", "d-flex flex-column flex-grow-1");
    contentHost.style.minHeight = "0";
    renderContent(contentHost, config.url);
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
