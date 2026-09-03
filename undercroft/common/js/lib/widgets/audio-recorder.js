// Records a whole GM session's audio locally in the browser — GM-only,
// local-only by design: the recording itself is never shared, spotlighted,
// or persisted server-side, and stays out of dashboard.js's own
// TABLE_WIDGET_TYPES (not table-facing, like board.js). One exception:
// downloadCombinedSessionRecord READS the active campaign's Game Log to
// interleave with the transcript, but never writes back to it.
//
// Recording is chunked (default 5 min) for two reasons: optional live
// transcription needs bounded-size pieces (Whisper-compatible endpoints cap
// request size), and each chunk is its own fresh MediaRecorder instance —
// a standalone-decodable file, not a fragment of one stream. That's also
// why there's no single merged download: naive byte-concatenation of
// separate WebM files doesn't produce a valid file (only slices from the
// SAME MediaRecorder instance do). Each chunk downloads separately;
// stitching them via ffmpeg afterward (see downloadStitchBundle) is opt-in.
//
// Each finished chunk is also written to IndexedDB immediately as a
// durability backstop against a crashed/closed tab — not a "resume an
// interrupted recording" flow, just insurance against losing a chunk that
// only ever lived in this tab's JS heap.
import { el } from "../dom.js";
import { createIdbStore } from "../idb-store.js";
import { promptConnectionModal } from "../connection-modal.js";
import { createIconButton, createCollapsibleSection } from "../ui-components.js";
import { disposeTooltips, refreshTooltips } from "../tooltips.js";
import { formatTimestamp, parseTimestamp, summarizeLogEntry } from "./game-log.js";

const DEFAULT_CONFIG = {
  chunkMinutes: 5,
  // Which saved transcription server (see manageTranscriptionServer) this
  // recording uses — "" means no transcription. Per-instance selection over
  // a deployment-wide list, same split WLED's device picker uses.
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
  setTimeout(() => URL.revokeObjectURL(url), 4000); // deferred to avoid racing the download start
}

// --- Transcription servers ---------------------------------------------
//
// Deployment-wide (server/app.py's /admin/transcription-servers routes),
// managed as a list (add/edit/delete/select) rather than one singleton —
// same shape as WLED's known-devices list, useful if more than one server
// exists (homelab box + laptop). Admin-only server-side, so no non-admin
// guard is needed here (see renderSettings). `existing` given opens the
// modal pre-filled for editing; omitted opens it blank for adding.
//
// Resolves null if cancelled, else {id, deleted}: `id` is the entry saved
// or deleted; callers need `deleted` to distinguish "select the new entry"
// from "clear the selection because it was just removed".
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
    // Per-server, not hardcoded to OpenAI's "whisper-1" — a self-hosted
    // server can 404 on that name. Blank keeps "whisper-1" as the fallback,
    // correct for OpenAI's real API.
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
  // Real wall-clock timestamps, captured directly at session/chunk start
  // rather than derived from elapsedMs + offset — elapsedMs pauses during a
  // pause, so a derived value would drift. This is what lets
  // downloadCombinedSessionRecord interleave by actual time-of-day.
  let sessionStartedAt = ""; // ISO string
  let chunkStartedAtReal = ""; // ISO string, current in-progress chunk
  let elapsedMs = 0;
  let elapsedTimer = null;
  let permissionError = "";
  // Tracked separately from recordingState (rather than re-derived every
  // render) so a manual expand/collapse survives an unrelated re-render.
  // startRecording() forces this true once a recording actually begins.
  let settingsCollapsed = false;

  let chunksInMemory = [];
  let transcriptLines = []; // {startOffsetMs, text}
  let transcriptFilterText = "";
  // The IndexedDB keys handleChunkFinished's own put() resolved to for THIS
  // session (the store auto-increments, so its "key" field isn't the real
  // primary key) — stopRecording deletes exactly these, never the whole
  // store, so other sessions' chunks are untouched.
  let sessionDbKeys = [];

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

  // Updates only the timer text node — a full render() every second would
  // also drop keyboard focus from the transcript search box.
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
    // 1s timeslice bounds the browser's internal buffer across a long
    // chunk; slices from this one instance still concatenate cleanly at
    // onstop since they're pieces of the same stream.
    recorder.start(1000);
    scheduleChunkCycle();
  }

  let chunkCycleTimer = null;
  function scheduleChunkCycle() {
    if (chunkCycleTimer) clearTimeout(chunkCycleTimer);
    const chunkMs = Math.max(1, Number(config.chunkMinutes) || DEFAULT_CONFIG.chunkMinutes) * 60 * 1000;
    chunkCycleTimer = setTimeout(() => {
      if (recordingState !== "recording" || !recorder || recorder.state === "inactive") return;
      recorder.stop(); // onstop sees recordingState still "recording" and starts the next chunk
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
      // Best-effort — a failed IDB write doesn't lose the chunk, it's still in chunksInMemory.
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
    // onstop still fires and finalizes this chunk, but sees "paused" and does not start a new one.
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
      // Wait for the final onstop (appends the last chunk) before tearing down the stream.
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
    // Only this session's own IDB copies — never idbStore.clear(), which would wipe other sessions' chunks too.
    try {
      await Promise.all(sessionDbKeys.map((dbKey) => idbStore.delete(dbKey)));
    } catch (error) {
      // Not fatal — chunks are still downloadable from chunksInMemory.
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
    // Staggered — firing every download synchronously gets several silently blocked by browser throttling.
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

  // An ffmpeg "concat demuxer" file list — the standard lossless way to
  // join same-codec files without re-encoding, since raw byte-concatenation
  // of separate chunk files doesn't produce a valid one (see header
  // comment). Works here because every chunk shares this session's one
  // fixed mimeType. Filenames must match chunkFilename exactly.
  function stitchFilelistContent() {
    const lines = chunksInMemory.map((entry) => `file '${chunkFilename(entry)}'`).join("\n");
    return `${lines}\n`;
  }

  // Downloads the file list plus a ready-to-run script for both realistic
  // platforms (rather than just the ffmpeg command as text) since there's
  // no way to know from this tab what OS will run it later. Staggered like
  // downloadAllChunks to avoid browser download throttling.
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

  // Interleaves this session's transcript with the campaign's Game Log into
  // one chronological plain-text record, keyed on each side's own real
  // timestamp (transcript's startedAtReal, Game Log's created_at).
  // limit: 200 matches groups.py's own hard cap on one log fetch.
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

    // A select over known transcription servers, not a checkbox — a GM may
    // have more than one. Add/Edit only render for an admin, since only an
    // admin can change this deployment-wide list.
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
    // Re-render (not just persistConfig) — the Edit button's disabled state below is only computed at render time.
    serverSelect.addEventListener("change", () => {
      persistConfig({ transcriptionServerId: serverSelect.value });
      render();
    });
    transcribeRow.appendChild(serverSelect);

    if (dataManager.meetsTier("admin")) {
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

  // Auto-collapses once a recording starts (startRecording sets
  // settingsCollapsed = true) but stays reachable in case settings need
  // changing mid-session. autoBindToggle: false because the toggle must
  // write back to settingsCollapsed itself, not just local DOM state a
  // later render() would blow away.
  function renderSettingsSection() {
    const { section, toggle, setCollapsed } = createCollapsibleSection({
      label: "Recording Settings",
      collapsed: settingsCollapsed,
      autoBindToggle: false,
      className: "d-flex flex-column gap-2",
      panelClassName: "d-flex flex-column gap-2",
      headingClassName: "small fw-semibold text-body-secondary mb-0",
      content: renderSettings(),
    });
    toggle.addEventListener("click", () => {
      settingsCollapsed = !settingsCollapsed;
      setCollapsed(settingsCollapsed);
    });
    return section;
  }

  // One condensed row: timer, icon-button actions, running chunk count.
  // Play/Pause is a single toggle (icon+behavior swap by state) rather than
  // separate always-visible Pause/Resume buttons.
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
    // One pill per chunk; clicking downloads that chunk. Height-constrained/scrollable for long sessions.
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
      const pillTitle = entry.startedAtReal
        ? `Download ${chunkFilename(entry)} (started ${formatTimestamp(entry.startedAtReal)})`
        : `Download ${chunkFilename(entry)}`;
      pill.setAttribute("data-bs-toggle", "tooltip");
      pill.setAttribute("data-bs-title", pillTitle);
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
    disposeTooltips(container); // dispose before wipe — an orphaned tooltip popup would otherwise stick to <body>
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

  // A closed/crashed tab mid-chunk loses that chunk — it only reaches
  // IndexedDB at chunk completion, and there's no reliable synchronous
  // flush of an in-progress MediaRecorder on unload. This only warns
  // loudly; the browser supplies its own generic confirmation text.
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
