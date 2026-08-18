// Records a whole GM session's audio locally in the browser — GM-only,
// local-only by design (see the plan this was built from): the recording
// itself is never shared, spotlighted, or persisted server-side. Not shown
// on the second-screen table mirror, same reasoning board.js's own header
// comment gives for itself (a private GM tool, not table-facing content) —
// this widget type stays out of dashboard.js's own TABLE_WIDGET_TYPES. One
// exception to "local-only": the combined session-record export (see
// downloadCombinedSessionRecord) READS the active campaign's own Game Log
// (server-side, shared) to interleave with the transcript — nothing is ever
// written back to it from here.
//
// Recording is chunked (default 5 min/chunk, configurable) rather than one
// continuous multi-hour capture, for two reasons: optional live
// transcription needs bounded-size pieces (every OpenAI-compatible Whisper
// endpoint caps request size well under an hour), and each chunk is its own
// fresh MediaRecorder instance — a genuinely independent, standalone-
// decodable audio file with its own container header, not a fragment of one
// ongoing stream. That second point is also why this widget does NOT offer
// one seamlessly-merged final download: naively concatenating several
// independent WebM files' bytes does not produce one valid multi-hour file
// (only slices from the SAME MediaRecorder instance concatenate cleanly —
// real audio remuxing needs a media library this suite has no reason to
// carry). Each chunk downloads as its own file instead — stitching them
// into one file afterward, if wanted, is an ordinary audio-tool job outside
// this widget's scope.
//
// Each finished chunk is also written to IndexedDB immediately (idb-store.js)
// as a durability backstop against a crashed/closed tab mid-session — not a
// polished "resume an interrupted recording" flow (out of scope for now),
// just insurance that a chunk already captured isn't only ever held in this
// one tab's JS heap.
import { el } from "../dom.js";
import { createIdbStore } from "../idb-store.js";
import { promptConnectionModal } from "../connection-modal.js";
import { createIconButton, createCollapsibleSection } from "../ui-components.js";
import { disposeTooltips, refreshTooltips } from "../tooltips.js";
import { formatTimestamp, parseTimestamp, summarizeLogEntry } from "./game-log.js";

const DEFAULT_CONFIG = {
  chunkMinutes: 5,
  // Which of the deployment's own saved transcription servers (see
  // manageTranscriptionServer below) this recording uses — "" means no
  // transcription, same "select = the feature is active for whatever's
  // selected" shape the Lighting widget's own device picker uses. Per-
  // instance (this widget's own contentRef), like WLED's selectedIp — the
  // LIST of known servers is deployment-wide, but which one a given
  // recording card uses is a local choice.
  transcriptionServerId: "",
};

const IDB_DB_NAME = "undercroft-audio-recorder";
const IDB_STORE_NAME = "chunks";

function randomId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function pickMimeType() {
  if (typeof MediaRecorder === "undefined" || typeof MediaRecorder.isTypeSupported !== "function") return "";
  const candidates = ["audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus", "audio/ogg"];
  return candidates.find((type) => MediaRecorder.isTypeSupported(type)) || "";
}

function formatElapsed(ms) {
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const pad = (n) => String(n).padStart(2, "0");
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${minutes}:${pad(seconds)}`;
}

function extensionForMimeType(mimeType) {
  if (mimeType.includes("ogg")) return "ogg";
  return "webm";
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  // Deferred, not immediate — an immediate revoke can race the download
  // actually starting in some browsers.
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

// --- Transcription servers ---------------------------------------------
//
// Deployment-wide (server/app.py's own /admin/transcription-servers
// routes), not per-account — a GM-managed LIST (add/edit/delete/select),
// same shape as WLED's own known-devices list (wled.js), not a single
// deployment-wide singleton — a real need if you run more than one
// transcription server (a homelab box AND a laptop, say) or just want to
// keep an old one around without losing it. `existing`, when given, opens
// the shared modal pre-filled for editing (with its own Disconnect/delete
// action built in); omitted opens it blank for adding a new one. Admin-only
// server-side (server/app.py's own require_admin) — a non-admin never sees
// this UI at all (see renderSettings below), so there's no need to guard
// against a rejected save here the way ensureHaConnection's own "ask an
// admin" toast has to for HA (any gm+ account can at least attempt that
// one, since it's their own personal connection).
//
// Resolves null if cancelled, else {id, deleted} — `id` is the entry that
// was saved (existing.id on an edit, a freshly generated one on an add) or
// the one that was just deleted; `deleted` tells the caller which. Callers
// need both: adding should select the new entry, editing should keep the
// current selection UNLESS this was actually a delete, in which case the
// selection needs clearing instead.
async function manageTranscriptionServer({ dataManager, status, existing }) {
  const id = existing?.id || randomId();
  let deleted = false;
  const saved = await promptConnectionModal({
    existing: existing
      ? { configured: true, label: existing.label, baseUrl: existing.baseUrl, model: existing.model }
      : { configured: false, label: "", baseUrl: "", model: "" },
    title: existing ? "Edit Transcription Server" : "Add a Transcription Server",
    description:
      "Shared by the whole deployment, not just your own account. Enter the FULL transcription endpoint URL, " +
      "not just the host — self-hosted OpenAI-API-compatible servers don't all route it the same way OpenAI " +
      "itself does, so this isn't assumed. Check your server's own API docs (a FastAPI-based one usually has " +
      "them at /docs) if you're not sure of the exact path.",
    showLabel: true,
    labelLabel: "Label",
    labelPlaceholder: "e.g. Homelab (Speaches)",
    urlLabel: "Endpoint URL",
    urlPlaceholder: "https://api.openai.com/v1/audio/transcriptions",
    // Genuinely per-server — confirmed real bug leaving this out entirely
    // and hardcoding OpenAI's own "whisper-1": a self-hosted server 404'd
    // because it had no model by that name loaded. Check the server's own
    // /v1/models (also on its /docs page) for the exact identifier it
    // actually has available. Blank keeps "whisper-1" as the fallback —
    // correct for OpenAI's own real API, which is why it's not a hard
    // requirement here.
    showModel: true,
    modelLabel: "Model (optional — check /v1/models on this server)",
    modelPlaceholder: "Leave blank for OpenAI's own \"whisper-1\"",
    keyLabel: "API key (optional)",
    keyPlaceholder: existing?.hasKey ? "Leave blank to clear the saved key" : "Leave blank if your server doesn't need one",
    keyRequired: false,
    onSave: (baseUrl, token, label, model) =>
      dataManager.saveTranscriptionServer({ id, label: label || baseUrl, baseUrl, model, token }),
    onDisconnect: existing
      ? async () => {
          await dataManager.deleteTranscriptionServer(existing.id);
          deleted = true;
        }
      : undefined,
    status,
  });
  return saved ? { id, deleted } : null;
}

export function initAudioRecorderWidget(
  container,
  { contentRef, setContentRef, status, dataManager, groupId = "", shareToken = "" } = {}
) {
  if (!container) {
    return { destroy() {} };
  }

  let config = { ...DEFAULT_CONFIG, ...(contentRef || {}) };
  let destroyed = false;

  let recordingState = "idle"; // "idle" | "recording" | "paused" | "stopped"
  let mediaStream = null;
  let recorder = null;
  let currentParts = [];
  let mimeType = "";
  let sessionId = "";
  let chunkIndex = 0;
  let chunkStartMs = 0;
  // Real wall-clock time, alongside the relative elapsedMs/chunkStartMs
  // this widget already tracked — captured directly at the moments that
  // matter (session start, each chunk's own start) rather than derived as
  // sessionStartedAt + offset, since elapsedMs stops advancing during a
  // pause and a derived value would drift off the real clock by however
  // long the pauses added up to. This is what makes the combined session-
  // record export (downloadCombinedSessionRecord below) able to interleave
  // transcript lines with Game Log entries by actual time-of-day.
  let sessionStartedAt = ""; // ISO string
  let chunkStartedAtReal = ""; // ISO string, current in-progress chunk
  let elapsedMs = 0;
  let elapsedTimer = null;
  let permissionError = "";
  // Expanded by default (nothing recorded yet, this is the first thing a
  // GM needs); startRecording() forces this true the moment a recording
  // actually begins. Tracked here rather than re-derived from
  // recordingState on every render() so a manual expand/collapse the user
  // makes mid-recording survives a re-render triggered by something else
  // (a chunk finishing, a transcript line arriving) instead of snapping
  // back to a state-derived default.
  let settingsCollapsed = false;

  // Kept in memory for the per-chunk download list (the widget's own
  // primary read path — see this file's own header comment on why IDB is a
  // backstop, not the read path finalize() uses).
  let chunksInMemory = [];
  let transcriptLines = []; // {startOffsetMs, text}
  let transcriptFilterText = "";
  // The actual IndexedDB store keys handleChunkFinished's own put() resolved
  // to for THIS session's chunks — not sessionId, since the store is
  // auto-incrementing (its "key" field is just data, not the real primary
  // key). stopRecording() deletes exactly these, never the whole store, so
  // a prior crashed session's own still-unrecovered chunks (and any future
  // session's) are never touched by this session's own cleanup.
  let sessionDbKeys = [];

  // The deployment's own known transcription servers — fetched once at
  // mount and re-fetched after any add/edit/delete (manageTranscriptionServer
  // below), same "shared list, per-instance selection" split WLED's own
  // known-devices list uses, just fetched directly here rather than passed
  // in from dashboard.js (this widget has no other consumer that also needs
  // this list to justify centralizing it the way WLED's device list is).
  let transcriptionServers = [];

  const idbStore = createIdbStore(IDB_DB_NAME, IDB_STORE_NAME);

  async function refreshTranscriptionServers() {
    try {
      const result = await dataManager.listTranscriptionServers();
      transcriptionServers = Array.isArray(result?.servers) ? result.servers : [];
    } catch (error) {
      transcriptionServers = [];
    }
    if (!destroyed) render();
  }

  function persistConfig(patch) {
    config = { ...config, ...patch };
    if (typeof setContentRef === "function") setContentRef({ ...config });
  }

  function startElapsedTimer() {
    stopElapsedTimer();
    elapsedTimer = setInterval(() => {
      elapsedMs += 1000;
      renderTimerOnly();
    }, 1000);
  }

  function stopElapsedTimer() {
    if (elapsedTimer) {
      clearInterval(elapsedTimer);
      elapsedTimer = null;
    }
  }

  // Only updates the elapsed-time text node in place rather than a full
  // render() every second — this widget's own controls/transcript list have
  // no reason to rebuild every tick, and a full innerHTML wipe once a
  // second would also drop keyboard focus from the transcript search box.
  let timerNode = null;
  function renderTimerOnly() {
    if (timerNode) timerNode.textContent = formatElapsed(elapsedMs);
  }

  async function beginChunk() {
    currentParts = [];
    chunkStartMs = elapsedMs;
    chunkStartedAtReal = new Date().toISOString();
    const options = mimeType ? { mimeType } : {};
    try {
      recorder = new MediaRecorder(mediaStream, options);
    } catch (error) {
      status?.show?.("Unable to start recording with this browser's audio codec support.", { type: "error" });
      return;
    }
    recorder.ondataavailable = (event) => {
      if (event.data && event.data.size > 0) currentParts.push(event.data);
    };
    recorder.onstop = () => {
      const finishedMimeType = recorder?.mimeType || mimeType || "audio/webm";
      const blob = new Blob(currentParts, { type: finishedMimeType });
      const shouldContinue = recordingState === "recording";
      void handleChunkFinished(blob, chunkStartMs, chunkStartedAtReal);
      if (shouldContinue) void beginChunk();
    };
    // 1s timeslice — keeps the browser's own internal buffer bounded across
    // a multi-minute chunk rather than holding it all until stop(); every
    // slice from this ONE instance still concatenates cleanly into one
    // valid file at onstop (they're pieces of the same stream, not
    // independent files — see this file's own header comment on why that
    // distinction matters).
    recorder.start(1000);
    scheduleChunkCycle();
  }

  let chunkCycleTimer = null;
  function scheduleChunkCycle() {
    if (chunkCycleTimer) clearTimeout(chunkCycleTimer);
    const chunkMs = Math.max(1, Number(config.chunkMinutes) || DEFAULT_CONFIG.chunkMinutes) * 60 * 1000;
    chunkCycleTimer = setTimeout(() => {
      if (recordingState !== "recording" || !recorder || recorder.state === "inactive") return;
      recorder.stop(); // onstop (above) sees recordingState still "recording" and starts the next chunk
    }, chunkMs);
  }

  async function handleChunkFinished(blob, startOffsetMs, startedAtReal) {
    if (destroyed) return;
    const index = chunkIndex++;
    const record = { index, blob, startOffsetMs, startedAtReal, mimeType: blob.type };
    chunksInMemory.push(record);
    try {
      const dbKey = await idbStore.put({ key: `${sessionId}::${index}`, sessionId, ...record });
      sessionDbKeys.push(dbKey);
    } catch (error) {
      // Best-effort durability backstop — a failed IDB write doesn't lose
      // the chunk itself, it's still in chunksInMemory for this session.
    }
    render();
    if (config.transcriptionServerId) {
      try {
        const result = await dataManager.transcribeAudioChunk(blob, config.transcriptionServerId);
        if (destroyed) return;
        transcriptLines.push({ startOffsetMs, startedAtReal, text: (result?.text || "").trim() });
        transcriptLines.sort((a, b) => a.startOffsetMs - b.startOffsetMs);
      } catch (error) {
        status?.show?.(error?.message || "Transcription failed for this chunk — recording continues.", {
          type: "warning",
          timeout: 3000,
        });
      }
      if (!destroyed) render();
    }
  }

  async function startRecording() {
    permissionError = "";
    try {
      mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (error) {
      permissionError =
        error?.name === "NotAllowedError"
          ? "Microphone access was denied — allow it for this site and try again."
          : "Unable to access a microphone.";
      render();
      return;
    }
    mimeType = pickMimeType();
    sessionId = randomId();
    sessionStartedAt = new Date().toISOString();
    chunkIndex = 0;
    elapsedMs = 0;
    chunksInMemory = [];
    transcriptLines = [];
    recordingState = "recording";
    settingsCollapsed = true;
    sessionDbKeys = [];
    await beginChunk();
    startElapsedTimer();
    render();
  }

  function pauseRecording() {
    if (recordingState !== "recording") return;
    recordingState = "paused";
    stopElapsedTimer();
    if (chunkCycleTimer) clearTimeout(chunkCycleTimer);
    // onstop still fires and finalizes this chunk, but sees recordingState
    // already "paused" and does not start a new one.
    if (recorder && recorder.state !== "inactive") recorder.stop();
    render();
  }

  async function resumeRecording() {
    if (recordingState !== "paused") return;
    recordingState = "recording";
    startElapsedTimer();
    await beginChunk();
    render();
  }

  async function stopRecording() {
    if (recordingState !== "recording" && recordingState !== "paused") return;
    const wasRecording = recordingState === "recording";
    recordingState = "stopped";
    stopElapsedTimer();
    if (chunkCycleTimer) clearTimeout(chunkCycleTimer);
    if (wasRecording && recorder && recorder.state !== "inactive") {
      // Let the final onstop (which appends the last chunk) run before
      // tearing the stream down — a fixed short wait is simpler and safe
      // here (onstop fires promptly on a real stop() call), rather than
      // threading a promise through the recorder's own event.
      await new Promise((resolve) => {
        const originalOnStop = recorder.onstop;
        recorder.onstop = (event) => {
          originalOnStop?.(event);
          resolve();
        };
        recorder.stop();
      });
    }
    mediaStream?.getTracks().forEach((track) => track.stop());
    mediaStream = null;
    // Only THIS session's own IDB backup copies — never idbStore.clear(),
    // which would also wipe any other session's chunks sharing this same
    // store (see sessionDbKeys' own comment above; confirmed real bug when
    // this used clear() instead).
    try {
      await Promise.all(sessionDbKeys.map((dbKey) => idbStore.delete(dbKey)));
    } catch (error) {
      // Not fatal — the chunks already downloaded/are downloadable from
      // chunksInMemory regardless.
    }
    render();
  }

  function chunkFilename(entry) {
    const ext = extensionForMimeType(entry.mimeType || mimeType || "audio/webm");
    return `session-${sessionId}-chunk${String(entry.index + 1).padStart(2, "0")}.${ext}`;
  }

  function downloadChunk(entry) {
    downloadBlob(entry.blob, chunkFilename(entry));
  }

  function downloadAllChunks() {
    // Sequential with a small stagger — firing every download click
    // synchronously in a tight loop gets several silently blocked by the
    // browser's own multiple-download prompt/popup-style throttling in
    // some browsers; a short gap between each avoids that.
    chunksInMemory.forEach((entry, i) => {
      setTimeout(() => downloadChunk(entry), i * 300);
    });
  }

  function stitchFilelistName() {
    return `session-${sessionId}-filelist.txt`;
  }

  function combinedFilename() {
    const ext = extensionForMimeType(mimeType || "audio/webm");
    return `session-${sessionId}-combined.${ext}`;
  }

  // An ffmpeg "concat demuxer" file list — the standard, lossless way to
  // join same-codec media files without re-encoding. Real byte-
  // concatenation of the chunks themselves doesn't produce a valid file
  // (see this widget's own header comment on why each chunk is an
  // independent MediaRecorder instance); ffmpeg's concat demuxer re-muxes
  // the container properly while copying the audio stream untouched, which
  // works here specifically because every chunk shares the same codec
  // (this session's own `mimeType`, fixed for its whole duration).
  // Filenames match chunkFilename exactly — this and the scripts below all
  // assume every downloaded chunk plus this list sits together, unmodified,
  // in one folder.
  function stitchFilelistContent() {
    const lines = chunksInMemory.map((entry) => `file '${chunkFilename(entry)}'`).join("\n");
    return `${lines}\n`;
  }

  // Downloads the file list PLUS a ready-to-run script for each of the two
  // realistic platforms, rather than just the ffmpeg command as text for
  // someone to retype by hand — the actual ask here. Both scripts are
  // trivial (one ffmpeg call each) and cost nothing extra to include, and
  // there's no reliable way from a browser tab to know what OS the person
  // will actually run this on later (could easily differ from the one
  // recording), so this hands over both rather than guessing. Staggered
  // like downloadAllChunks — three near-simultaneous downloads can hit the
  // same browser throttling.
  function downloadStitchBundle() {
    const files = [
      [stitchFilelistName(), stitchFilelistContent(), "text/plain;charset=utf-8"],
      [
        `session-${sessionId}-combine.bat`,
        `@echo off\r\nffmpeg -f concat -safe 0 -i "${stitchFilelistName()}" -c copy "${combinedFilename()}"\r\npause\r\n`,
        "text/plain;charset=utf-8",
      ],
      [
        `session-${sessionId}-combine.sh`,
        `#!/bin/sh\nffmpeg -f concat -safe 0 -i "${stitchFilelistName()}" -c copy "${combinedFilename()}"\n`,
        "text/plain;charset=utf-8",
      ],
    ];
    files.forEach(([filename, content, type], i) => {
      setTimeout(() => downloadBlob(new Blob([content], { type }), filename), i * 300);
    });
  }

  function downloadTranscript() {
    const text = transcriptLines
      .map((line) => `[${formatElapsed(line.startOffsetMs)} · ${formatTimestamp(line.startedAtReal) || "?"}] ${line.text}`)
      .join("\n");
    downloadBlob(new Blob([text], { type: "text/plain;charset=utf-8" }), `session-${sessionId}-transcript.txt`);
  }

  // Interleaves this session's own transcript with the campaign's Game Log
  // (chat/rolls/spotlights) into one chronological plain-text record —
  // possible now that both sides carry a real (not just relative) timestamp:
  // the transcript's own startedAtReal (see this file's own header comment
  // on why it's captured directly rather than derived from elapsedMs), and
  // the Game Log's own server-stamped created_at. limit: 200 is the
  // server's own hard cap on one /groups/{id}/log fetch (groups.py's
  // _sanitize_log_limit) — a session chattier than that only gets its most
  // recent 200 entries here, same ceiling the Game Log widget itself is
  // bound by.
  async function downloadCombinedSessionRecord() {
    if (!groupId && !shareToken) return;
    let log;
    try {
      log = await dataManager.getGroupLog({ groupId, shareToken, limit: 200 });
    } catch (error) {
      status?.show?.(error?.message || "Unable to load the Game Log for the combined record.", { type: "error" });
      return;
    }
    const logEntries = Array.isArray(log?.entries)
      ? log.entries.filter((entry) => entry?.type !== "spotlight-update")
      : [];
    const combined = [
      ...transcriptLines
        .filter((line) => line.startedAtReal)
        .map((line) => ({
          atMs: parseTimestamp(line.startedAtReal),
          text: `Transcript: "${line.text || "(no speech detected)"}"`,
        })),
      ...logEntries.map((entry) => ({
        atMs: parseTimestamp(entry.created_at),
        text: `${entry.author?.name || "System"}: ${summarizeLogEntry(entry)}`,
      })),
    ].sort((a, b) => a.atMs - b.atMs);
    const lines = combined.map(({ atMs, text }) => `[${atMs ? new Date(atMs).toLocaleString() : "?"}] ${text}`);
    downloadBlob(
      new Blob([lines.join("\n")], { type: "text/plain;charset=utf-8" }),
      `session-${sessionId}-combined-record.txt`
    );
  }

  function renderSettings() {
    const wrap = el("div", "d-flex flex-column gap-2");

    const chunkRow = el("div", "d-flex align-items-center gap-2");
    chunkRow.appendChild(el("label", "small text-body-secondary mb-0", "Chunk length (minutes)"));
    const chunkInput = document.createElement("input");
    chunkInput.type = "number";
    chunkInput.min = "1";
    chunkInput.max = "30";
    chunkInput.className = "form-control form-control-sm";
    chunkInput.style.maxWidth = "5rem";
    chunkInput.value = String(config.chunkMinutes);
    chunkInput.addEventListener("change", () => {
      const value = Math.max(1, Math.min(30, Number(chunkInput.value) || DEFAULT_CONFIG.chunkMinutes));
      chunkInput.value = String(value);
      persistConfig({ chunkMinutes: value });
    });
    chunkRow.appendChild(chunkInput);
    wrap.appendChild(chunkRow);

    // A select over the deployment's own known transcription servers, not a
    // plain on/off checkbox — a GM might have more than one (a homelab box,
    // a laptop) and want to pick between them per recording; "(none)" is
    // the off state. Add/Edit only render for an admin at all (rather than
    // rendering and rejecting on click) — only an admin can actually change
    // this deployment-wide list (server/app.py's own require_admin), so
    // there's nothing a non-admin could do with them anyway.
    const transcribeRow = el("div", "d-flex flex-wrap align-items-center gap-1");
    transcribeRow.appendChild(el("label", "small text-body-secondary mb-0", "Transcription server"));
    const serverSelect = document.createElement("select");
    serverSelect.className = "form-select form-select-sm";
    serverSelect.style.maxWidth = "12rem";
    const blankOption = document.createElement("option");
    blankOption.value = "";
    blankOption.textContent = "(none — no transcription)";
    serverSelect.appendChild(blankOption);
    transcriptionServers.forEach((serverEntry) => {
      const option = document.createElement("option");
      option.value = serverEntry.id;
      option.textContent = serverEntry.label;
      option.selected = serverEntry.id === config.transcriptionServerId;
      serverSelect.appendChild(option);
    });
    serverSelect.value = config.transcriptionServerId || "";
    // Re-renders, not just persistConfig — confirmed real bug otherwise:
    // the Edit button's own disabled state (below) is only ever computed
    // at render time, so without this it stayed stuck on whatever it was
    // when the settings panel was first drawn, even after picking a real
    // entry from this select.
    serverSelect.addEventListener("change", () => {
      persistConfig({ transcriptionServerId: serverSelect.value });
      render();
    });
    transcribeRow.appendChild(serverSelect);

    if (dataManager.meetsTier("admin")) {
      // Icon buttons with tooltips, matching every other "add/edit a saved
      // item" row in this suite (the Lighting widget's own device row,
      // e.g.) rather than these ones' own previous plain text buttons.
      const addServerButton = createIconButton({
        icon: "tabler:plus",
        label: "Add a transcription server",
        variant: "primary",
        onClick: async () => {
          const result = await manageTranscriptionServer({ dataManager, status });
          if (!result) return;
          await refreshTranscriptionServers();
          persistConfig({ transcriptionServerId: result.id });
          render();
        },
      });
      transcribeRow.appendChild(addServerButton);

      const editServerButton = createIconButton({
        icon: "tabler:pencil",
        label: "Edit the selected transcription server",
        attrs: { disabled: !config.transcriptionServerId },
        onClick: async () => {
          const existingEntry = transcriptionServers.find((entry) => entry.id === config.transcriptionServerId);
          if (!existingEntry) return;
          const result = await manageTranscriptionServer({ dataManager, status, existing: existingEntry });
          if (!result) return;
          await refreshTranscriptionServers();
          if (result.deleted) persistConfig({ transcriptionServerId: "" });
          render();
        },
      });
      transcribeRow.appendChild(editServerButton);
    }
    wrap.appendChild(transcribeRow);

    return wrap;
  }

  // Collapsed automatically the moment a recording starts (startRecording
  // sets settingsCollapsed = true) — these two rows matter most before
  // anything's recording and rarely afterward, but stay reachable rather
  // than disappearing outright, in case the chunk length or transcription
  // server needs changing mid-session. `autoBindToggle: false` because the
  // toggle needs to write back to `settingsCollapsed` itself (see that
  // variable's own comment) rather than only holding local DOM state that a
  // later unrelated render() would blow away.
  function renderSettingsSection() {
    const { section, toggle, setCollapsed } = createCollapsibleSection({
      label: "Recording Settings",
      collapsed: settingsCollapsed,
      autoBindToggle: false,
      className: "d-flex flex-column gap-2",
      panelClassName: "d-flex flex-column gap-2",
      // Toned down from the shared default (uppercase, fs-6) to match this
      // widget's own compact row labels — that heavier treatment reads as
      // too aggressive on a small dashboard-card section header.
      headingClassName: "small fw-semibold text-body-secondary mb-0",
      content: renderSettings(),
    });
    toggle.addEventListener("click", () => {
      settingsCollapsed = !settingsCollapsed;
      setCollapsed(settingsCollapsed);
    });
    return section;
  }

  // One condensed row: the timer, every action as a small icon button (New
  // / Play-Pause-toggle / Stop / Download all / Download stitch script /
  // Download transcript), then the running chunk count — replaces what
  // used to be a separate controls row plus each download list's own
  // header row of full-text buttons. Play/Pause is a single toggle (icon
  // and behavior swap by state) rather than separate Pause/Resume buttons,
  // matching an ordinary media-player control instead of exposing every
  // recordingState transition as its own always-visible button.
  function renderToolbar() {
    const row = el("div", "d-flex align-items-center gap-2 flex-wrap");

    timerNode = el("div", "font-monospace", formatElapsed(elapsedMs));
    row.appendChild(timerNode);

    if (sessionStartedAt) {
      row.appendChild(el("span", "small text-body-secondary", `started ${formatTimestamp(sessionStartedAt)}`));
    }

    const canStartFresh = recordingState === "idle" || recordingState === "stopped";
    const isPaused = recordingState === "paused";
    const isRecording = recordingState === "recording";

    const buttonGroup = el("div", "d-flex gap-1");
    buttonGroup.appendChild(
      createIconButton({
        icon: "tabler:file-plus",
        label: "New Recording",
        variant: canStartFresh ? "primary" : "outline-secondary",
        attrs: { disabled: !canStartFresh },
        onClick: () => void startRecording(),
      })
    );
    buttonGroup.appendChild(
      createIconButton({
        icon: isRecording ? "tabler:player-pause" : "tabler:player-play",
        label: isRecording ? "Pause" : "Resume",
        attrs: { disabled: !isRecording && !isPaused },
        onClick: () => (isRecording ? pauseRecording() : void resumeRecording()),
      })
    );
    buttonGroup.appendChild(
      createIconButton({
        icon: "tabler:player-stop",
        label: "Stop",
        variant: "outline-danger",
        attrs: { disabled: !isRecording && !isPaused },
        onClick: () => void stopRecording(),
      })
    );
    buttonGroup.appendChild(
      createIconButton({
        icon: "tabler:download",
        label: "Download all chunks",
        attrs: { disabled: !chunksInMemory.length },
        onClick: downloadAllChunks,
      })
    );
    buttonGroup.appendChild(
      createIconButton({
        icon: "tabler:terminal-2",
        // Each chunk is its own independent file (see this widget's own
        // header comment) — no single "one big file" download exists. This
        // downloads everything needed to join them back into one
        // afterward: the ffmpeg concat file list plus a ready-to-run
        // script for either platform (see downloadStitchBundle) — nothing
        // left to retype by hand.
        label: "Download stitch script (Windows + Mac/Linux)",
        attrs: { disabled: !chunksInMemory.length },
        onClick: downloadStitchBundle,
      })
    );
    if (transcriptLines.length) {
      buttonGroup.appendChild(
        createIconButton({
          icon: "tabler:file-text",
          label: "Download transcript",
          onClick: downloadTranscript,
        })
      );
      // Only when there's an active campaign to pull a Game Log from at
      // all — same gate the Game Log widget itself uses to decide whether
      // it has anything to show (see game-log.js's own render()).
      if (groupId || shareToken) {
        buttonGroup.appendChild(
          createIconButton({
            icon: "tabler:notebook",
            label: "Download combined session record (transcript + Game Log)",
            onClick: () => void downloadCombinedSessionRecord(),
          })
        );
      }
    }
    row.appendChild(buttonGroup);

    row.appendChild(el("span", "small text-body-secondary ms-auto", `${chunksInMemory.length} chunk(s) recorded`));

    return row;
  }

  function renderChunkList() {
    if (!chunksInMemory.length) return null;
    // One pill per chunk rather than a row-per-chunk list with its own
    // separate "Download" link — clicking the pill itself downloads that
    // chunk. Wrapped + height-constrained + scrollable so a long session
    // (dozens of chunks at the default 5min length) stays a fixed-size
    // strip instead of pushing the rest of the widget down.
    const list = el("div", "d-flex flex-wrap gap-1");
    list.style.maxHeight = "6rem";
    list.style.overflowY = "auto";
    chunksInMemory.forEach((entry) => {
      const pill = el(
        "button",
        "btn btn-sm btn-outline-secondary rounded-pill",
        `${entry.index + 1} · ${formatElapsed(entry.startOffsetMs)}`
      );
      pill.type = "button";
      pill.title = entry.startedAtReal
        ? `Download ${chunkFilename(entry)} (started ${formatTimestamp(entry.startedAtReal)})`
        : `Download ${chunkFilename(entry)}`;
      pill.addEventListener("click", () => downloadChunk(entry));
      list.appendChild(pill);
    });
    return list;
  }

  function renderTranscript() {
    if (!config.transcriptionServerId && !transcriptLines.length) return null;
    const wrap = el("div", "d-flex flex-column gap-1");
    wrap.appendChild(el("span", "small fw-bold text-body-secondary", "Transcript"));

    const filterInput = document.createElement("input");
    filterInput.type = "search";
    filterInput.className = "form-control form-control-sm";
    filterInput.placeholder = "Search transcript…";
    filterInput.value = transcriptFilterText;
    filterInput.addEventListener("input", () => {
      transcriptFilterText = filterInput.value;
      render();
    });
    wrap.appendChild(filterInput);

    const needle = transcriptFilterText.trim().toLowerCase();
    const visibleLines = needle ? transcriptLines.filter((line) => line.text.toLowerCase().includes(needle)) : transcriptLines;

    const list = el("div", "d-flex flex-column gap-1 small");
    list.style.maxHeight = "10rem";
    list.style.overflowY = "auto";
    if (!visibleLines.length) {
      list.appendChild(el("div", "text-body-secondary", needle ? "No matches." : "Transcript will appear here as chunks are recorded."));
    } else {
      visibleLines.forEach((line) => {
        const row = el("div", "");
        const realTime = formatTimestamp(line.startedAtReal);
        const stamp = realTime ? `[${formatElapsed(line.startOffsetMs)} · ${realTime}]` : `[${formatElapsed(line.startOffsetMs)}]`;
        row.appendChild(el("span", "text-body-secondary font-monospace me-1", stamp));
        row.appendChild(document.createTextNode(line.text || "(no speech detected)"));
        list.appendChild(row);
      });
    }
    wrap.appendChild(list);
    return wrap;
  }

  function render() {
    if (destroyed) return;
    // Disposed before the wipe, not just left to be garbage-collected —
    // same "orphaned tooltip popup stuck on <body> forever" failure mode
    // dashboard.js's own toolbar rebuild already documents; this widget
    // didn't have any data-bs-toggle="tooltip" elements before the
    // transcription server row's own icon buttons.
    disposeTooltips(container);
    container.innerHTML = "";
    const wrap = el("div", "d-flex flex-column gap-2 overflow-auto");
    wrap.style.minHeight = "0";

    wrap.appendChild(renderSettingsSection());

    if (permissionError) {
      wrap.appendChild(el("div", "small text-danger", permissionError));
    }

    wrap.appendChild(renderToolbar());

    const chunkList = renderChunkList();
    if (chunkList) wrap.appendChild(chunkList);

    const transcript = renderTranscript();
    if (transcript) wrap.appendChild(transcript);

    container.appendChild(wrap);
    refreshTooltips(container);
  }

  // A closed/crashed tab mid-chunk loses that chunk outright — it only
  // reaches IndexedDB at chunk completion (handleChunkFinished above), so
  // whatever's in currentParts right now is pure JS-heap state. This can't
  // save it (there's no reliable synchronous flush of an in-progress
  // MediaRecorder on unload), only warn loudly enough that a GM mid-session
  // doesn't close the tab by accident. Standard "set returnValue" shape —
  // the browser supplies its own generic confirmation text, no custom
  // message is actually shown by any modern browser.
  function handleBeforeUnload(event) {
    if (recordingState !== "recording" && recordingState !== "paused") return;
    event.preventDefault();
    event.returnValue = "";
  }
  window.addEventListener("beforeunload", handleBeforeUnload);

  render();
  void refreshTranscriptionServers();

  return {
    destroy() {
      destroyed = true;
      window.removeEventListener("beforeunload", handleBeforeUnload);
      stopElapsedTimer();
      if (chunkCycleTimer) clearTimeout(chunkCycleTimer);
      // Recording is left running across a widget re-mount only in the
      // trivial sense that nothing here forcibly stops it on destroy — in
      // practice destroy() only ever fires from removing the card or
      // leaving the page, at which point the mic stream needs releasing
      // regardless of in-progress state.
      if (recorder && recorder.state !== "inactive") {
        recorder.onstop = null;
        recorder.stop();
      }
      mediaStream?.getTracks().forEach((track) => track.stop());
      disposeTooltips(container);
      container.innerHTML = "";
    },
  };
}
