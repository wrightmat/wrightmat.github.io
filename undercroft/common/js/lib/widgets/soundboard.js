// GM-defined audio clips — links only, no file hosting by this app (the GM
// supplies their own URLs, same "no Library record, no server storage"
// philosophy as browser.js's own URL widget). Clip DEFINITIONS themselves
// live in a shared, server-persisted library (audio-clip-library.js,
// common/data/audio-clips.json) — same pattern Press's own custom fonts
// use: anyone gm+ can add a clip, and it's immediately usable by everyone
// else's Soundboard widget, building up one shared TTRPG sound catalog
// rather than each widget instance/GM maintaining their own separate list.
//
// Two clip types with genuinely different behavior, chosen explicitly per
// clip rather than inferred from a flag: "music" (loops by default) and
// "sfx" (one-shot by default) — loop is still a real per-clip toggle
// afterward (see loopOverrides below — a LOCAL, per-viewer playback
// preference, not a shared-library edit; toggling it doesn't call the
// server at all). Only one clip of each type can ever be active at once;
// starting a new one in a type replaces whatever was already playing there
// (a new Music track stops the old one; an SFX can still fire on top of
// Music, since they're independent slots).
//
// Routing reuses the widget's own existing "show to table" eye icon —
// confirmed with the user, same meaning as every other widget's visibility
// toggle, no separate control: hidden means Play only plays locally, in
// whichever browser clicked it; shown means Play also broadcasts to every
// accepted follower and the second-screen mirror, through the same
// spotlightToGroup/updateSpotlightData/resolveSpotlightData machinery
// Clock/Browser/Calendar already use (see server/groups.py's own
// _INLINE_SPOTLIGHT_KINDS — "soundboard" has no Library record at all). The
// broadcast payload carries a clip's name/url/loop inline, so a follower
// never needs its own copy of the shared library to play back what's sent.
import { el } from "../dom.js";
import { connectLiveStream } from "../live.js";
import { resolveIsSpotlighted, resolveSpotlightData } from "../spotlight.js";
import { createReliableInterval } from "../reliable-interval.js";
import { getAllClips, getClipById, registerClip, removeClipLocally, loadClipLibrary, saveClip, deleteClip } from "../audio-clip-library.js";

// 5s — same cadence every other inline-kind follower in this suite polls at.
const POLL_INTERVAL_MS = 5000;
const CLIP_TYPES = ["music", "sfx"];
const TYPE_ICON = { music: "tabler:music", sfx: "tabler:bolt" };
const TYPE_LABEL = { music: "Music", sfx: "Sound Effect" };
// Matches server/app.py's own gate on POST /soundboard/clips.
const ADD_CLIP_TIERS = new Set(["gm", "creator", "admin"]);

function randomId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `${Math.random().toString(16).slice(2)}-${Date.now()}`;
}

function icon(name) {
  const span = el("span", "iconify");
  span.dataset.icon = name;
  span.setAttribute("aria-hidden", "true");
  return span;
}

function iconButton(name, { active = false, disabled = false, title } = {}) {
  const button = el("button", `btn btn-sm p-1 ${active ? "btn-primary" : "btn-outline-secondary"}`);
  button.type = "button";
  button.appendChild(icon(name));
  if (title) {
    button.title = title;
    button.setAttribute("aria-label", title);
  }
  button.disabled = disabled;
  return button;
}

// HTMLMediaElement.error.code values — MEDIA_ERR_SRC_NOT_SUPPORTED (4) is
// the one that actually fires for a URL like
// "https://www.tabletoprpgmusic.com/#track=..." — a real webpage, not a
// direct audio file — since the browser fetches it, gets back HTML (or a
// player app's own JS-rendered page) instead of anything it can decode as
// audio, and reports "unsupported source" rather than a network failure.
// Named here specifically so that exact case reads as an actionable message
// instead of a bare error code.
const MEDIA_ERROR_MESSAGES = {
  1: "Playback was aborted.",
  2: "A network error prevented loading this clip.",
  3: "This file couldn't be decoded as audio.",
  4: "This URL doesn't point to a playable audio file — it may be a webpage (like a player site's own track page) rather than a direct link to an audio file.",
};

function describeMediaError(mediaError) {
  if (!mediaError) return "Unknown playback error.";
  return MEDIA_ERROR_MESSAGES[mediaError.code] || "Unknown playback error.";
}

// One real <audio> element per type, reused across plays (created fresh
// each time a NEW clip starts in that slot, previous one stopped first) —
// this is what actually enforces "only one Music and one SFX at once,"
// locally, independent of whether anything's currently broadcasting.
// setPaused/setLoop are idempotent — safe to call every poll/render without
// worrying whether the state already matches. Used by both the GM's own
// authoring instance (immediate local feedback on every click, shown or
// hidden) and every follower/second-screen instance (playing back whatever
// the broadcast state says).
//
// `onStateChange(type, state, detail)` — state is "loading"|"playing"|
// "paused"|"error"|"idle"|"ended"|"progress". Previously play() just
// fired-and-forgot with a blanket `.catch(() => {})` — real playback
// failures (a bad URL, a blocked network request) were indistinguishable
// from a harmless autoplay-policy rejection, and both failed completely
// silently. This is what actually lets a caller show real per-clip
// diagnostics instead of "nothing happened, no idea why." "progress" fires
// on every native `timeupdate` tick (several times a second) with
// `detail = {currentTime, duration}` — callers that render a position bar
// should update it directly rather than routing through a full list
// re-render, or every tick would rebuild every row in the section.
function createLocalPlayer({ onStateChange } = {}) {
  const audioByType = { music: null, sfx: null };

  function setState(type, state, detail) {
    onStateChange?.(type, state, detail);
  }

  function stop(type) {
    const existing = audioByType[type];
    if (existing) {
      existing.pause();
      existing.src = "";
    }
    audioByType[type] = null;
    setState(type, "idle");
  }

  function play(type, clip) {
    stop(type);
    const audioEl = new Audio(clip.url);
    audioEl.loop = Boolean(clip.loop);
    setState(type, "loading");
    audioEl.addEventListener("playing", () => {
      if (audioByType[type] === audioEl) setState(type, "playing");
    });
    audioEl.addEventListener("pause", () => {
      // `pause` also fires on natural end-of-track (a non-looping clip) and
      // immediately before a real `error` — only report a genuine
      // user-facing "paused" for neither of those cases.
      if (audioByType[type] === audioEl && !audioEl.error && !audioEl.ended) setState(type, "paused");
    });
    audioEl.addEventListener("error", () => {
      if (audioByType[type] !== audioEl) return;
      setState(type, "error", describeMediaError(audioEl.error));
    });
    // Only fires for a non-looping clip (SFX by default, or Music with
    // looping switched off) — without this, nothing ever tells a caller
    // playback actually stopped once it reaches the end on its own, so a
    // finished clip's row/state stays stuck looking "active" (Play button
    // shown as Pause) until the user clicks something.
    audioEl.addEventListener("ended", () => {
      if (audioByType[type] !== audioEl) return;
      audioByType[type] = null;
      setState(type, "ended");
    });
    audioEl.addEventListener("timeupdate", () => {
      if (audioByType[type] !== audioEl) return;
      setState(type, "progress", { currentTime: audioEl.currentTime, duration: audioEl.duration });
    });
    audioEl.play().catch((error) => {
      if (audioByType[type] !== audioEl) return;
      // Distinct code path from the `error` event above (this is a promise
      // rejection from play() itself — most commonly the browser's own
      // autoplay policy withholding playback with no prior user gesture in
      // THIS tab/frame, which a follower's very first play can hit) but
      // surfaced the same way either way, since both mean "nothing is
      // actually audible right now" and the caller shouldn't have to care
      // which kind of failure it was.
      setState(type, "error", error?.message || "Playback was blocked or failed to start.");
    });
    audioByType[type] = audioEl;
  }
  function setPaused(type, paused) {
    const existing = audioByType[type];
    if (!existing) return;
    if (paused && !existing.paused) existing.pause();
    else if (!paused && existing.paused) existing.play().catch(() => {});
  }
  function setLoop(type, loop) {
    const existing = audioByType[type];
    if (existing) existing.loop = Boolean(loop);
  }
  function destroyAll() {
    CLIP_TYPES.forEach(stop);
  }
  return { play, stop, setPaused, setLoop, destroyAll };
}

function renderFollowerLine(container, activeInfo, playerError = {}) {
  container.innerHTML = "";
  const wrap = el("div", "d-flex flex-column gap-1");
  const music = activeInfo.music;
  if (playerError.music) {
    wrap.appendChild(el("div", "small text-danger", `Music error: ${playerError.music}`));
  } else {
    wrap.appendChild(
      el("div", "small", music ? `${music.paused ? "Paused" : "Playing"}: ${music.name} 🔊` : "No music playing.")
    );
  }
  if (playerError.sfx) {
    wrap.appendChild(el("div", "small text-danger", `SFX error: ${playerError.sfx}`));
  } else if (activeInfo.sfx) {
    wrap.appendChild(el("div", "small text-body-secondary", `SFX: ${activeInfo.sfx.name}`));
  }
  container.appendChild(wrap);
}

// contentRef.followKind === "soundboard" marks a follower instance — created
// by acceptSpotlight (dashboard.js) when a player accepts a GM's soundboard
// spotlight, or by the forcePlayerView self-follow branch below for the
// second-screen mirror. Diffs each slot's own `seq` against the last one
// actually applied: unseen seq → stop whatever was playing in that slot and
// start the new one; null → stop; unchanged seq → leave playback alone
// (so an in-progress clip isn't restarted by re-polling the same state) —
// `loop`/`paused` are re-applied every poll regardless of `seq`, since
// those can change without the clip itself changing. Needs no access to the
// shared clip library at all — the broadcast payload already carries
// everything (name/url/loop) inline.
function initFollowerSoundboard(container, { dataManager, groupId = "", shareToken = "", followId, setTitle }) {
  let destroyed = false;
  let pollTimer = 0;
  const lastSeq = { music: null, sfx: null };
  const activeInfo = { music: null, sfx: null };
  const playerError = { music: null, sfx: null };

  function render() {
    if (!destroyed) renderFollowerLine(container, activeInfo, playerError);
  }

  // A real playback failure (bad URL, blocked request) can resolve/reject
  // well after refresh()'s own poll already returned — this is what
  // actually surfaces it the moment it happens, not just on the next poll.
  const player = createLocalPlayer({
    onStateChange: (type, state, detail) => {
      playerError[type] = state === "error" ? detail : null;
      if (state === "ended") {
        // Same "it actually stopped" gap as the GM widget's own
        // onStateChange — without this, activeInfo (and the "Playing: X"
        // line) would keep showing the finished clip until the next poll
        // happens to catch up with the GM's now-cleared broadcast slot.
        activeInfo[type] = null;
      }
      render();
    },
  });

  function resetSlot(type) {
    player.stop(type);
    lastSeq[type] = null;
    activeInfo[type] = null;
  }

  async function refresh() {
    try {
      const data = await resolveSpotlightData(dataManager, { groupId, shareToken, kind: "soundboard", id: followId });
      if (destroyed) return;
      setTitle?.("Soundboard");
      CLIP_TYPES.forEach((type) => {
        const slot = data?.[type] || null;
        if (!slot) {
          if (lastSeq[type] !== null) resetSlot(type);
          return;
        }
        if (slot.seq !== lastSeq[type]) {
          player.play(type, slot);
          lastSeq[type] = slot.seq;
        }
        player.setLoop(type, slot.loop);
        player.setPaused(type, Boolean(slot.paused));
        activeInfo[type] = { name: slot.name, paused: Boolean(slot.paused) };
      });
      render();
    } catch (error) {
      if (!destroyed) {
        CLIP_TYPES.forEach(resetSlot);
        render();
      }
    }
  }

  void refresh();
  pollTimer = createReliableInterval(() => void refresh(), POLL_INTERVAL_MS);
  const liveStream = connectLiveStream({ dataManager, groupId, kinds: ["group_log"], shareToken });
  liveStream.subscribe("group_log", () => void refresh());

  return {
    destroy() {
      destroyed = true;
      if (pollTimer) pollTimer.stop();
      liveStream.close();
      player.destroyAll();
      container.innerHTML = "";
    },
  };
}

export function initSoundboardWidget(
  container,
  {
    contentRef,
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
  if (!container || !dataManager) {
    return { destroy() {} };
  }

  if (contentRef?.followKind === "soundboard") {
    return initFollowerSoundboard(container, { dataManager, groupId, shareToken, followId: contentRef.followId, setTitle });
  }

  // Second-screen mirror — a fully separate JS context, same reasoning
  // Clock/Browser/Calendar's own forcePlayerView branch gives: treating it
  // as a follower OF ITSELF is what makes it a live, correctly-updating
  // view instead of one static snapshot.
  if (forcePlayerView && instanceId) {
    return initFollowerSoundboard(container, { dataManager, groupId, shareToken, followId: instanceId, setTitle });
  }

  let destroyed = false;
  let visible = false;
  let addType = "music";
  let searchQuery = "";
  // Which clip (if any) is currently showing its inline edit form instead
  // of its normal play/stop/loop row — at most one at a time.
  let editingClipId = null;
  const userTier = dataManager.getUserTier?.() || "free";
  const canAddClips = ADD_CLIP_TIERS.has(userTier);
  // Edit and Delete are both admin-only — editing a shared clip's name/URL
  // is exactly as consequential as removing it (it changes what everyone
  // else's Soundboard plays), so it gets the same gate.
  const canManageClips = userTier === "admin";
  // `{state:"error", detail}` per type when the currently-active clip in
  // that slot failed to play, else null — surfaced both as a toast (once,
  // right when it happens) and as a persistent icon/tooltip on the clip's
  // own row (renderClipRow), so a failure like a webpage URL fed to
  // <audio> (see createLocalPlayer's own MEDIA_ERROR_MESSAGES comment)
  // doesn't just read as "nothing happened, no idea why."
  const playerState = { music: null, sfx: null };
  // {currentTime, duration} per type while that slot is actively playing,
  // else null — driven by createLocalPlayer's own "progress" state (native
  // `timeupdate`, several times a second). Kept separate from playerState/
  // renderLists() on purpose: routing every tick through a full row rebuild
  // would rebuild every clip row in the section several times a second for
  // no reason — applyProgressToBar below updates just the one fill element
  // directly instead.
  const progressState = { music: null, sfx: null };
  // DOM ref to the currently-mounted progress fill element per type, if the
  // active clip's row is currently rendered — reassigned by buildProgressBar
  // on every renderLists() (renderSection tears down and rebuilds each
  // section's rows wholesale), so a stale ref here just means the last
  // render didn't include that type's active row (e.g. filtered out by a
  // search query) and progress updates are harmlessly skipped until it is.
  const progressBarEls = { music: null, sfx: null };
  const player = createLocalPlayer({
    onStateChange: (type, state, detail) => {
      if (state === "progress") {
        progressState[type] = detail;
        applyProgressToBar(type);
        return;
      }
      playerState[type] = state === "error" ? { state, detail } : null;
      if (state === "error") {
        status?.show(`Soundboard — ${TYPE_LABEL[type]}: ${detail}`, { type: "error", timeout: 4500 });
      }
      if (state !== "playing" && state !== "paused") {
        progressState[type] = null;
      }
      if (state === "ended") {
        // Finished on its own (a non-looping clip reached the end) — clear
        // the active state so the row goes back to a plain Play icon
        // instead of staying highlighted as "playing" forever, and push
        // that to followers too so their own "Playing: X" line clears
        // instead of waiting on the next 5s poll to notice.
        activeClipId[type] = null;
        pausedState[type] = false;
        if (visible) void pushBroadcastState();
      }
      if (!destroyed) renderLists();
    },
  });
  const activeClipId = { music: null, sfx: null };
  const pausedState = { music: false, sfx: false };
  const seqCounter = { music: 0, sfx: 0 };
  // A LOCAL playback preference, not a shared-library edit — flipping a
  // clip's Loop button never calls the server (see this file's own header
  // comment). Falls back to the clip's own catalog default (clip.loop) for
  // anything not explicitly overridden this session.
  const loopOverrides = new Map();

  function effectiveLoop(clip) {
    return loopOverrides.has(clip.id) ? loopOverrides.get(clip.id) : Boolean(clip.loop);
  }

  // The active clip (playing OR paused — it stays pinned across a pause
  // rather than jumping back into list order and then back to the top
  // again on resume, which read as more confusing than helpful) floats to
  // the very top of its own type's list, ahead of the query filter's own
  // alphabetical/library order — the exact "which one's playing right now"
  // question that prompted this, no scrolling required to answer it.
  function clipsByType(type) {
    const query = searchQuery.trim().toLowerCase();
    const clips = getAllClips().filter(
      (clip) => clip.type === type && (!query || clip.name.toLowerCase().includes(query))
    );
    const activeId = activeClipId[type];
    if (!activeId) return clips;
    const activeIndex = clips.findIndex((clip) => clip.id === activeId);
    if (activeIndex <= 0) return clips;
    const [activeClip] = clips.splice(activeIndex, 1);
    return [activeClip, ...clips];
  }

  function buildBroadcastData() {
    const data = {};
    CLIP_TYPES.forEach((type) => {
      const clip = activeClipId[type] ? getClipById(activeClipId[type]) : null;
      data[type] = clip
        ? {
            clipId: clip.id,
            name: clip.name,
            url: clip.url,
            loop: effectiveLoop(clip),
            seq: seqCounter[type],
            paused: Boolean(pausedState[type]),
          }
        : null;
    });
    return data;
  }

  async function pushBroadcastState() {
    if (!visible || !groupId || !instanceId) return;
    try {
      await dataManager.updateSpotlightData({ groupId, kind: "soundboard", id: instanceId, data: buildBroadcastData() });
    } catch (error) {
      // Best-effort — a follower just won't see this particular change yet.
    }
  }

  function updateVisibilityAction() {
    if (!canToggleVisibility) return;
    setRightAction?.({
      icon: visible ? "tabler:eye" : "tabler:eye-off",
      tooltip: visible ? "Broadcasting to table — click to stop" : "Hidden — click to broadcast to table",
      active: visible,
      onClick: () => void toggleVisibility(),
    });
  }

  async function refreshVisibility() {
    if (!canToggleVisibility || !groupId || !instanceId) {
      visible = false;
      return;
    }
    visible = await resolveIsSpotlighted(dataManager, { groupId, shareToken, kind: "soundboard", id: instanceId });
    updateVisibilityAction();
  }

  async function toggleVisibility() {
    if (!groupId || !instanceId) {
      status?.show("No active campaign to show this to.", { type: "warning", timeout: 2500 });
      return;
    }
    try {
      if (visible) {
        await dataManager.clearSpotlight({ groupId, kind: "soundboard", id: instanceId });
        status?.show("Stopped broadcasting.", { type: "success", timeout: 2000 });
      } else {
        // skipShare — no Library record for this widget instance at all
        // (see this file's own header comment); the server enforces the
        // same allowance independently for kind "soundboard". Carries
        // whatever's ALREADY playing locally, if anything, so toggling
        // broadcast on syncs immediately rather than waiting for the next
        // Play click.
        await dataManager.spotlightToGroup({
          groupId,
          contentType: "soundboard",
          contentId: instanceId,
          skipShare: true,
          data: buildBroadcastData(),
        });
        status?.show("Broadcasting to the table.", { type: "success", timeout: 2000 });
      }
    } catch (error) {
      status?.show(error.message || "Unable to update visibility.", { type: "error" });
    }
    await refreshVisibility();
  }

  // Exposed on this instance's own returned object (see the bottom of this
  // function) — what macro-runner.js's runSoundboardMacroAction (soundboard.js's
  // own module-level exports below) calls INSTEAD of its standalone
  // fallback whenever a real, mounted Soundboard widget exists for it to
  // route through (dashboard.js's own ensureWidgetForMacroAction — see that
  // function's own comment). Routing through THIS widget's own player/
  // activeClipId/broadcast state, rather than a disconnected module-level
  // player, is what makes a macro-started clip show up as "now playing" —
  // and stay controllable (Stop, volume, loop) — in whichever real
  // Soundboard widget the GM has on screen, auto-added or not.
  async function runMacroAction(action) {
    const params = action?.params || {};
    if (action?.action === "play") {
      // getClipById alone isn't enough here: this widget's own mount kicks
      // off loadClipLibrary() but doesn't await it (see this file's own
      // init below), so a macro that auto-adds this widget and fires
      // immediately (dashboard.js's ensureWidgetForMacroAction) can still
      // race ahead of that fetch. resolveClip (below) covers that by
      // lazily awaiting loadClipLibrary() itself on a cache miss — the
      // exact "Unknown clip" bug this widget's standalone macro path
      // already fixed once, just reachable again through this instance
      // path since it used to call getClipById directly.
      const clip = await resolveClip(params.clipId);
      if (!clip) throw new Error(`Unknown clip "${params.clipId || ""}".`);
      const loop = params.loop !== undefined ? Boolean(params.loop) : effectiveLoop(clip);
      player.play(clip.type, { ...clip, loop });
      activeClipId[clip.type] = clip.id;
      pausedState[clip.type] = false;
      seqCounter[clip.type] += 1;
      renderLists();
      if (params.broadcast && groupId && instanceId) {
        if (!visible) {
          // A macro asking to broadcast implies "start showing this to the
          // table" — same as clicking the eye icon — so later natural
          // state changes (pause, stop, the clip ending on its own) keep
          // reaching followers too, not just this one snapshot.
          visible = true;
          updateVisibilityAction();
          void dataManager
            .spotlightToGroup({ groupId, contentType: "soundboard", contentId: instanceId, skipShare: true, data: buildBroadcastData() })
            .catch(() => {});
        } else {
          void pushBroadcastState();
        }
      }
      return Promise.resolve();
    }
    if (action?.action === "stop") {
      const type = params.clipType === "music" || params.clipType === "sfx" ? params.clipType : "sfx";
      handleStopClick(type);
      return Promise.resolve();
    }
    return Promise.reject(new Error(`Unknown Soundboard macro action "${action?.action}".`));
  }

  // Clicking the same active clip again toggles pause/resume in place (no
  // restart, no new seq); clicking a DIFFERENT clip (or the same one after
  // it was stopped) starts it fresh. Always acts locally immediately,
  // regardless of visibility — broadcast is an ADDITION on top of local
  // playback, never a replacement for it. An active clip that's currently
  // in an error state is treated as NOT really active for this purpose —
  // clicking it retries a fresh play() rather than toggling pause on a
  // dead <audio> element that was never actually playing anything.
  function handlePlayPauseClick(type, clip) {
    const isRetryable = activeClipId[type] === clip.id && !playerState[type];
    if (isRetryable) {
      pausedState[type] = !pausedState[type];
      player.setPaused(type, pausedState[type]);
    } else {
      player.play(type, { ...clip, loop: effectiveLoop(clip) });
      activeClipId[type] = clip.id;
      pausedState[type] = false;
      seqCounter[type] += 1;
    }
    renderLists();
    if (visible) void pushBroadcastState();
  }

  function handleStopClick(type) {
    player.stop(type);
    activeClipId[type] = null;
    pausedState[type] = false;
    playerState[type] = null;
    renderLists();
    if (visible) void pushBroadcastState();
  }

  function handleLoopToggle(type, clip) {
    const nextLoop = !effectiveLoop(clip);
    loopOverrides.set(clip.id, nextLoop);
    if (activeClipId[type] === clip.id) player.setLoop(type, nextLoop);
    renderLists();
    if (visible) void pushBroadcastState();
  }

  async function handleDeleteClip(clip) {
    if (!canManageClips) return;
    if (activeClipId[clip.type] === clip.id) handleStopClick(clip.type);
    try {
      await deleteClip(clip.id, dataManager.session?.token);
      removeClipLocally(clip.id);
      renderLists();
    } catch (error) {
      status?.show(error.message || "Unable to delete clip.", { type: "error" });
    }
  }

  // Optimistic, same "update immediately, persist async" flow every other
  // shared-library write in this file uses — saveClip upserts by id
  // server-side, so saving with the SAME id as an existing clip replaces it
  // in place rather than creating a duplicate. Reverts the in-memory copy
  // if the server round-trip fails, since the optimistic update already
  // overwrote it.
  async function handleSaveEdit(clip, nextName, nextUrl) {
    if (!canManageClips) return;
    const name = nextName.trim();
    const url = nextUrl.trim();
    if (!name || !url) {
      status?.show("Enter a name and a URL first.", { type: "warning", timeout: 2000 });
      return;
    }
    const previousClip = { ...clip };
    const updatedClip = { ...clip, name, url };
    registerClip(updatedClip);
    editingClipId = null;
    renderLists();
    try {
      await saveClip(updatedClip, dataManager.session?.token);
    } catch (error) {
      registerClip(previousClip);
      renderLists();
      status?.show(error.message || "Unable to save clip.", { type: "error" });
    }
  }

  function renderClipEditRow(clip) {
    const row = el("div", "d-flex align-items-center gap-1");
    const nameInput = document.createElement("input");
    nameInput.type = "text";
    nameInput.className = "form-control form-control-sm";
    nameInput.value = clip.name;
    nameInput.setAttribute("aria-label", "Clip name");
    const urlInput = document.createElement("input");
    urlInput.type = "text";
    urlInput.className = "form-control form-control-sm";
    urlInput.value = clip.url;
    urlInput.setAttribute("aria-label", "Clip URL");

    const saveButton = iconButton("tabler:check", { title: "Save changes" });
    saveButton.classList.remove("btn-outline-secondary");
    saveButton.classList.add("btn-outline-success");
    saveButton.addEventListener("click", () => void handleSaveEdit(clip, nameInput.value, urlInput.value));

    const cancelButton = iconButton("tabler:x", { title: "Cancel" });
    cancelButton.addEventListener("click", () => {
      editingClipId = null;
      renderLists();
    });

    row.append(nameInput, urlInput, saveButton, cancelButton);
    return row;
  }

  // Sets just the fill element's width from the latest known
  // {currentTime, duration} — called on every "progress" tick AND once
  // right when a row is (re)built, so a bar that's rebuilt mid-playback
  // (e.g. from an unrelated loop-toggle click elsewhere in the same
  // section) starts at the correct position instead of resetting to 0 and
  // waiting for the next tick. No duration yet (still loading, or a stream
  // that never reports one) just shows an empty bar rather than guessing.
  function applyProgressToBar(type) {
    const fill = progressBarEls[type];
    if (!fill) return;
    const info = progressState[type];
    if (!info || !Number.isFinite(info.duration) || info.duration <= 0) {
      fill.style.width = "0%";
      return;
    }
    const pct = Math.min(100, Math.max(0, (info.currentTime / info.duration) * 100));
    fill.style.width = `${pct}%`;
  }

  function buildProgressBar(type) {
    const track = el("div", "");
    track.style.height = "3px";
    track.style.borderRadius = "2px";
    track.style.background = "var(--bs-tertiary-bg, #e9ecef)";
    track.style.overflow = "hidden";
    const fill = el("div", "");
    fill.style.height = "100%";
    fill.style.width = "0%";
    fill.style.background = "var(--bs-primary, #0d6efd)";
    track.appendChild(fill);
    progressBarEls[type] = fill;
    applyProgressToBar(type);
    return track;
  }

  function renderClipRow(type, clip) {
    if (editingClipId === clip.id) return renderClipEditRow(clip);
    const wrapper = el("div", "d-flex flex-column gap-1");
    const row = el("div", "d-flex align-items-center gap-1");
    const isActive = activeClipId[type] === clip.id;
    const isPaused = isActive && pausedState[type];
    const isError = isActive && Boolean(playerState[type]);
    row.appendChild(el("span", "flex-grow-1 small text-truncate", clip.name || "Untitled clip"));

    let playIcon = "tabler:player-play";
    let playTitle = "Play";
    if (isError) {
      playIcon = "tabler:alert-triangle";
      playTitle = `${playerState[type].detail} (click to retry)`;
    } else if (isActive) {
      playIcon = isPaused ? "tabler:player-play" : "tabler:player-pause";
      playTitle = isPaused ? "Resume" : "Pause";
    }
    const playPauseButton = iconButton(playIcon, { active: isActive && !isPaused && !isError, title: playTitle });
    if (isError) {
      playPauseButton.classList.remove("btn-outline-secondary");
      playPauseButton.classList.add("btn-outline-danger");
    }
    playPauseButton.addEventListener("click", () => handlePlayPauseClick(type, clip));

    const stopButton = iconButton("tabler:player-stop", { disabled: !isActive, title: "Stop" });
    stopButton.addEventListener("click", () => handleStopClick(type));

    const loopButton = iconButton("tabler:repeat", {
      active: effectiveLoop(clip),
      title: effectiveLoop(clip) ? "Looping — click to stop looping" : "Not looping — click to loop",
    });
    loopButton.addEventListener("click", () => handleLoopToggle(type, clip));

    row.append(playPauseButton, stopButton, loopButton);

    if (canManageClips) {
      const editButton = iconButton("tabler:pencil", { title: "Edit name/URL" });
      editButton.addEventListener("click", () => {
        editingClipId = clip.id;
        renderLists();
      });
      const removeButton = iconButton("tabler:trash", { title: "Delete clip (removes it for everyone)" });
      removeButton.classList.remove("btn-outline-secondary");
      removeButton.classList.add("btn-outline-danger");
      removeButton.addEventListener("click", () => void handleDeleteClip(clip));
      row.append(editButton, removeButton);
    }
    wrapper.appendChild(row);
    // Only the active, non-error slot gets a bar — a stopped/idle clip has
    // no "how far along" to show, and an errored one never actually started.
    if (isActive && !isError) {
      wrapper.appendChild(buildProgressBar(type));
    }
    return wrapper;
  }

  // One compact row: a type toggle (icon + tooltip, click to switch between
  // Music/SFX — the loop default the type implies only matters at the
  // moment of adding; each clip's own Loop button can flip it anytime
  // after, locally), name, URL, Add. Built once and never torn down by
  // renderLists (see that function's own comment) — its inputs hold real,
  // ephemeral in-progress typing. Omitted entirely below this tier
  // (ADD_CLIP_TIERS) — browsing and playing the shared library needs no
  // special tier, only adding to it does.
  function renderAddClipForm() {
    const form = el("div", "d-flex align-items-center gap-1 border-top pt-2");

    const typeButton = iconButton(TYPE_ICON[addType], { title: `${TYPE_LABEL[addType]} — click to switch type` });
    typeButton.addEventListener("click", () => {
      addType = addType === "music" ? "sfx" : "music";
      typeButton.innerHTML = "";
      typeButton.appendChild(icon(TYPE_ICON[addType]));
      typeButton.title = `${TYPE_LABEL[addType]} — click to switch type`;
      typeButton.setAttribute("aria-label", typeButton.title);
    });

    const nameInput = document.createElement("input");
    nameInput.type = "text";
    nameInput.className = "form-control form-control-sm";
    nameInput.placeholder = "Name";

    const urlInput = document.createElement("input");
    urlInput.type = "text";
    urlInput.className = "form-control form-control-sm";
    urlInput.placeholder = "Audio URL…";

    const addButton = iconButton("tabler:plus", { title: "Add clip to the shared library" });
    addButton.classList.remove("btn-outline-secondary");
    addButton.classList.add("btn-outline-primary");
    addButton.addEventListener("click", () => {
      const name = nameInput.value.trim();
      const url = urlInput.value.trim();
      if (!name || !url) {
        status?.show("Enter a name and a URL first.", { type: "warning", timeout: 2000 });
        return;
      }
      const clip = { id: randomId(), name, url, type: addType, loop: addType === "music" };
      // Optimistic — registered locally immediately so it shows up in the
      // list right away, same "update immediately, persist async" flow
      // font-library.js's own registerCustomFont/saveCustomFont pair uses.
      registerClip(clip);
      renderLists();
      nameInput.value = "";
      urlInput.value = "";
      void saveClip(clip, dataManager.session?.token).catch((error) => {
        removeClipLocally(clip.id);
        renderLists();
        status?.show(error.message || "Unable to save clip.", { type: "error" });
      });
    });

    form.append(typeButton, nameInput, urlInput, addButton);
    return form;
  }

  // Only `musicHost`/`sfxHost` get rebuilt on every play/stop/loop/delete/
  // search click — the search input and add-clip form (both built once in
  // render()'s first call) are left alone, so in-progress typing in either
  // never gets silently wiped by an unrelated click elsewhere in the widget.
  let musicHost = null;
  let sfxHost = null;

  function renderSection(hostEl, type) {
    hostEl.innerHTML = "";
    const clips = clipsByType(type);
    if (!clips.length) {
      hostEl.appendChild(el("p", "text-body-secondary small mb-0", "No clips."));
    } else {
      clips.forEach((clip) => hostEl.appendChild(renderClipRow(type, clip)));
    }
  }

  function renderLists() {
    renderSection(musicHost, "music");
    renderSection(sfxHost, "sfx");
  }

  // Each type gets its OWN independently bounded, independently scrollable
  // section — otherwise a growing shared library (the whole point of this
  // refactor) would make the widget itself grow without bound. Returns
  // `{section, host}`: `section` (the labeled wrapper) gets appended to the
  // widget; `host` (the scrollable inner div) is what renderSection fills.
  function buildScrollableSection(type) {
    const section = el("div", "d-flex flex-column gap-1");
    section.appendChild(el("div", "small fw-semibold text-body-secondary", `${TYPE_LABEL[type]}${type === "music" ? "" : "s"}`));
    const host = el("div", "d-flex flex-column gap-1");
    host.style.maxHeight = "8rem";
    host.style.overflowY = "auto";
    section.appendChild(host);
    return { section, host };
  }

  function render() {
    if (destroyed) return;
    if (!musicHost) {
      container.innerHTML = "";
      const wrap = el("div", "d-flex flex-column gap-2 flex-grow-1");
      wrap.style.minHeight = "0";

      const searchInput = document.createElement("input");
      searchInput.type = "search";
      searchInput.className = "form-control form-control-sm";
      searchInput.placeholder = "Search clips…";
      searchInput.addEventListener("input", () => {
        searchQuery = searchInput.value;
        renderLists();
      });
      wrap.appendChild(searchInput);

      const musicSection = buildScrollableSection("music");
      wrap.appendChild(musicSection.section);
      musicHost = musicSection.host;

      const sfxSection = buildScrollableSection("sfx");
      wrap.appendChild(sfxSection.section);
      sfxHost = sfxSection.host;

      if (canAddClips) {
        wrap.appendChild(renderAddClipForm());
      }

      container.appendChild(wrap);
    }
    renderLists();
  }

  render();
  setTitle?.("Soundboard");
  void (async () => {
    // The shared library may not have been fetched by anything in THIS
    // session yet — render once immediately with whatever's already in
    // memory (possibly empty), then refresh once the real list lands.
    await loadClipLibrary();
    if (!destroyed) renderLists();
  })();
  void refreshVisibility();

  return {
    runMacroAction,
    // `removed` is only ever true from dashboard.js's removeWidget — the
    // one moment this instance's own still-active spotlight (if any) needs
    // clearing, same orphan-prevention reasoning Clock/Browser/Calendar's
    // own destroy(removed) gives.
    async destroy(removed) {
      destroyed = true;
      player.destroyAll();
      container.innerHTML = "";
      if (removed && visible && groupId && instanceId) {
        try {
          await dataManager.clearSpotlight({ groupId, kind: "soundboard", id: instanceId });
        } catch (error) {
          // Best-effort cleanup — nothing meaningful to do if this fails.
        }
      }
    },
  };
}

// --- Macro action support (common/js/lib/widgets/macro-runner.js) ---
// Prefers routing through a real, mounted Soundboard widget's own
// runMacroAction (see initSoundboardWidget above) when one is available —
// dashboard.js's own ensureWidgetForMacroAction auto-adds one if none
// exists yet, specifically so a macro-started clip shows up as "now
// playing" (and stays controllable — Stop, volume, loop) in a real widget
// the GM can see, rather than an invisible standalone player nothing on
// screen reflects. The standalone path below (module-level createLocalPlayer
// + a macro-owned spotlight id) is the fallback for contexts with no
// widget grid to add to at all — a macro fired from a Journal note
// (journal-macro.js) or a Dashboard with `ensureWidget` unavailable for
// any other reason. resolveSpotlightData has no dependency on any widget
// being mounted (see spotlight.js), so the fallback's own broadcast still
// reaches followers/the second-screen mirror either way.

export const SOUNDBOARD_MACRO_ACTIONS = {
  play: { label: "Play a clip", params: ["clipId", "broadcast", "loop"] },
  stop: { label: "Stop a clip", params: ["clipType", "broadcast"] },
};

// A macro-owned spotlight id, distinct from any real widget instanceId
// (those are always `w_xxxxx` — see dashboard.js's generateInstanceId) —
// so a macro-triggered broadcast can never collide with a live Soundboard
// widget's own broadcast slot.
const MACRO_SPOTLIGHT_ID = "macro";

let macroPlayer = null;
function getMacroPlayer() {
  if (!macroPlayer) macroPlayer = createLocalPlayer({});
  return macroPlayer;
}

// getClipById reads audio-clip-library.js's own in-memory `customClips`,
// which starts empty and is only ever populated by loadClipLibrary() — the
// live Soundboard widget calls that on its own mount, but a macro can run
// with no Soundboard widget mounted anywhere on the dashboard at all (the
// whole point of this being standalone). Confirmed real bug: running a
// clip-playing macro before any Soundboard widget had ever mounted this
// session failed with "Unknown clip" even for a perfectly valid id, since
// nothing had loaded the library yet. Lazily loads once, on first miss —
// loadClipLibrary has no internal caching guard of its own (see its own
// comment), so this only pays the fetch cost when the cache actually
// turns out to be empty, not on every macro run once it's warm.
async function resolveClip(clipId) {
  const existing = getClipById(clipId);
  if (existing) return existing;
  await loadClipLibrary();
  return getClipById(clipId);
}

export async function runSoundboardMacroAction(action, { dataManager, groupContext, widgetInstance } = {}) {
  if (widgetInstance && typeof widgetInstance.runMacroAction === "function") {
    return widgetInstance.runMacroAction(action);
  }

  const params = action?.params || {};
  const actionName = action?.action;

  if (actionName === "play") {
    const clip = await resolveClip(params.clipId);
    if (!clip) {
      throw new Error(`Unknown clip "${params.clipId || ""}".`);
    }
    const loop = params.loop !== undefined ? Boolean(params.loop) : Boolean(clip.loop);
    // Confirmed real bug: `broadcast` used to REPLACE local playback
    // instead of adding to it — a macro run with no live Soundboard
    // widget for ensureWidget to route through (a Journal-triggered macro
    // with no widget grid at all, or one where ensureWidget didn't find/
    // add a match) posted the "show to the table" spotlight entry and
    // nothing else, so the GM who actually fired the macro heard nothing
    // — only a follower who'd separately accepted that spotlight would.
    // The live widget's own runMacroAction never had this bug (it always
    // plays locally via player.play, broadcasting is a true addition on
    // top) — matched here now instead of a second, inconsistent shape.
    getMacroPlayer().play(clip.type, { ...clip, loop });
    // Best-effort, same as the live widget's own runMacroAction (which
    // silently skips/swallows a missing groupContext or a failed post
    // rather than throwing) — a broadcast that can't go out doesn't mean
    // the local play the GM can already hear should read as a failed step.
    const groupId = groupContext?.groupId;
    if (params.broadcast && dataManager && groupId) {
      try {
        // Merge onto whatever's already in the macro's own broadcast slot
        // rather than overwriting it outright, so playing a Music clip
        // doesn't silently stop an unrelated SFX another macro action
        // already started broadcasting under the same id.
        const existing = (await resolveSpotlightData(dataManager, {
          groupId,
          kind: "soundboard",
          id: MACRO_SPOTLIGHT_ID,
        })) || {};
        const entry = { clipId: clip.id, name: clip.name, url: clip.url, loop, seq: Date.now(), paused: false };
        await dataManager.spotlightToGroup({
          groupId,
          contentType: "soundboard",
          contentId: MACRO_SPOTLIGHT_ID,
          skipShare: true,
          data: { ...existing, [clip.type]: entry },
        });
      } catch (error) {
        // Best-effort — the local play above already succeeded either way.
      }
    }
    return;
  }

  if (actionName === "stop") {
    const type = params.clipType === "music" || params.clipType === "sfx" ? params.clipType : "sfx";
    // Same additive fix as "play" above — always stop the local player;
    // clearing the broadcast slot is a best-effort addition, not a
    // replacement (a broadcast-started clip that never played locally,
    // under the old bug, also could never be silenced locally either).
    getMacroPlayer().stop(type);
    const groupId = groupContext?.groupId;
    if (params.broadcast && dataManager && groupId) {
      try {
        const existing = (await resolveSpotlightData(dataManager, {
          groupId,
          kind: "soundboard",
          id: MACRO_SPOTLIGHT_ID,
        })) || {};
        await dataManager.updateSpotlightData({
          groupId,
          kind: "soundboard",
          id: MACRO_SPOTLIGHT_ID,
          data: { ...existing, [type]: null },
        });
      } catch (error) {
        // Best-effort — the local stop above already succeeded either way.
      }
    }
    return;
  }

  throw new Error(`Unknown Soundboard macro action "${actionName}".`);
}
