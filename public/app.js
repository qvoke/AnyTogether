const elements = {
  activeRole: document.getElementById("activeRole"),
  activeRoom: document.getElementById("activeRoom"),
  bridgeDetails: document.getElementById("bridgeDetails"),
  bridgeState: document.getElementById("bridgeState"),
  connectButton: document.getElementById("connectButton"),
  connectionState: document.getElementById("connectionState"),
  currentMediaLabel: document.getElementById("currentMediaLabel"),
  displayName: document.getElementById("displayName"),
  eventLog: document.getElementById("eventLog"),
  loadMediaButton: document.getElementById("loadMediaButton"),
  memberList: document.getElementById("memberList"),
  mediaUrl: document.getElementById("mediaUrl"),
  playbackState: document.getElementById("playbackState"),
  player: document.getElementById("player") || document.getElementById("video"),
  revisionLabel: document.getElementById("revisionLabel"),
  roleSelect: document.getElementById("roleSelect"),
  roomInput: document.getElementById("roomInput"),
  searchButton: document.getElementById("legacySearchButton") || document.getElementById("searchButton"),
  searchQuery: document.getElementById("searchQuery"),
  seekButton: document.getElementById("seekButton"),
  seekInput: document.getElementById("seekInput"),
  syncButton: document.getElementById("syncButton")
};

const pluginRequestPrefix = "anytogether-plugin";
const webRequestPattern = /\.(?:m3u8|mp4)(?:\?|$)/i;
const gestureCommitDelayMs = 200;
const gestureCommitRetryMs = 60;
const gestureCommitMaxDelayMs = 650;
const gestureCommitQuietWindowMs = 90;
const remoteSeekSettlementGraceMs = 250;
const seekCorrectionThresholdMs = 100;
const playbackCorrectionThresholdMs = 300;
const playbackCorrectionCooldownMs = 1200;
const playbackStatusIntervalMs = 200;
const bufferingConfirmationMs = 500;
const bufferingCorrectionMinimumMs = 700;
const programmaticSeekLifetimeMs = 10000;
const programmaticSeekToleranceSeconds = 0.75;

function getTabClientId() {
  if (typeof window.__anyTogetherClientId === "string" && window.__anyTogetherClientId) {
    return window.__anyTogetherClientId;
  }
  window.__anyTogetherClientId = crypto.randomUUID();
  return window.__anyTogetherClientId;
}

const state = {
  clientId: getTabClientId(),
  connection: null,
  currentControl: null,
  currentMediaUrl: "",
  currentRevision: 0,
  playbackSyncOffsets: new Map(),
  lastPlaybackCorrectionAt: 0,
  lastAppliedLoadActionId: null,
  lastGuaranteedSeekActionId: null,
  isApplyingRemoteState: false,
  isBuffering: false,
  bufferingDetectionTimer: null,
  bufferingSignalActive: false,
  bufferingProbeTime: 0,
  bufferingStartedAt: 0,
  lastBufferingDurationMs: 0,
  isConnected: false,
  pendingIntents: [],
  pendingPlaybackState: null,
  pendingRemoteApply: null,
  pendingSeek: null,
  pendingSeekIsRemote: false,
  pendingSeekPaused: null,
  pendingSeekCommitStartedAt: 0,
  pendingSeekLastUpdatedAt: 0,
  pendingSeekTarget: null,
  pendingSeekTimer: null,
  pendingSeekObservedSeeked: false,
  pendingSeekRemoteStartedAt: 0,
  autoplayPending: false,
  remoteSeekPending: false,
  remoteSeekSettlementTimer: null,
  remoteApplyTimer: null,
  remoteSeekActivityAt: 0,
  programmaticSeekExpiresAt: 0,
  programmaticSeekTarget: null,
  programmaticPlayEvents: 0,
  programmaticPauseEvents: 0,
  seekGestureActive: false,
  stallRecoveryTimer: null,
  suppressOutgoingUntil: 0,
  hls: null,
  shakaPlayer: null,
  shakaUi: null,
  hlsRecoveryAttempts: 0,
  hlsMediaErrorAttempts: 0,
  hlsLastRecoveryAt: 0,
  room: elements.roomInput.value.trim() || "lobby",
  role: elements.roleSelect.value
};

function formatDetail(detail) {
  if (detail === null || detail === undefined || detail === "") {
    return "";
  }

  if (typeof detail === "string") {
    return detail;
  }

  if (detail instanceof Error) {
    return detail.message;
  }

  if (typeof detail !== "object") {
    return String(detail);
  }

  return Object.entries(detail)
    .filter(([, value]) => value !== null && value !== undefined && value !== "")
    .map(([key, value]) => {
      if (typeof value === "object") {
        return `${key}=${JSON.stringify(value)}`;
      }

      return `${key}=${String(value)}`;
    })
    .join(" | ");
}

function logEvent(title, detail = "") {
  const entry = document.createElement("article");
  entry.className = "event";

  const heading = document.createElement("strong");
  heading.textContent = title;

  const time = document.createElement("time");
  const timestamp = new Date();
  time.textContent = timestamp.toLocaleTimeString();

  entry.append(heading);

  const detailText = formatDetail(detail);
  if (detailText) {
    const body = document.createElement("div");
    body.textContent = detailText;
    entry.append(body);
  }

  entry.append(time);
  elements.eventLog.prepend(entry);
  window.dispatchEvent(new CustomEvent("anytogether:sync-log", {
    detail: {
      title,
      detail: detailText,
      timestamp: timestamp.toISOString()
    }
  }));
}

function setConnectionLabel(label) {
  elements.connectionState.textContent = label;
}

function setBridgeState(label, detail = "") {
  elements.bridgeState.textContent = label;
  elements.bridgeDetails.textContent = detail;
}

function setPlaybackState() {
  const mediaLabel = state.currentMediaUrl ? state.currentMediaUrl : "No media loaded";
  elements.currentMediaLabel.textContent = mediaLabel;
  elements.playbackState.textContent = elements.player.paused ? "Paused" : "Playing";
  elements.revisionLabel.textContent = String(state.currentRevision);
}

function updateControlState(control, source = "room") {
  const nextControl = control ? { ...control } : null;
  const previousId = state.currentControl ? state.currentControl.clientId : null;
  const nextId = nextControl ? nextControl.clientId : null;

  state.currentControl = nextControl;

  if (previousId !== nextId) {
    if (nextControl) {
      logEvent("Control lease updated", {
        source,
        owner: nextControl.name || nextControl.clientId,
        role: nextControl.role,
        leaseUntil: new Date(nextControl.leaseUntil).toLocaleTimeString()
      });
    } else {
      logEvent("Control lease released", { source });
    }
  }
}

function clearStallRecoveryTimer() {
  if (state.stallRecoveryTimer) {
    clearTimeout(state.stallRecoveryTimer);
    state.stallRecoveryTimer = null;
  }
}

function clearPendingSeekCommitTimer() {
  if (state.pendingSeekTimer) {
    clearTimeout(state.pendingSeekTimer);
    state.pendingSeekTimer = null;
  }

  state.pendingSeekTarget = null;
  state.pendingSeekPaused = null;
  state.pendingSeekCommitStartedAt = 0;
  state.pendingSeekLastUpdatedAt = 0;
}

function clearRemoteSeekSettlement() {
  if (state.remoteSeekSettlementTimer) {
    clearTimeout(state.remoteSeekSettlementTimer);
    state.remoteSeekSettlementTimer = null;
  }
  state.pendingSeekIsRemote = false;
  state.pendingSeekObservedSeeked = false;
  state.pendingSeekRemoteStartedAt = 0;
  state.remoteSeekPending = false;
}

function scheduleRemoteSeekSettlementAttempt(delayMs = remoteSeekSettlementGraceMs) {
  if (state.remoteSeekSettlementTimer) clearTimeout(state.remoteSeekSettlementTimer);
  state.remoteSeekSettlementTimer = setTimeout(() => {
    state.remoteSeekSettlementTimer = null;
    void attemptRemoteSeekSettlement("grace-timeout");
  }, delayMs);
}

function beginRemoteSeekSettlement() {
  if (!state.pendingSeekIsRemote) {
    state.pendingSeekRemoteStartedAt = performance.now();
    scheduleRemoteSeekSettlementAttempt();
  }

  state.pendingSeekIsRemote = true;
  state.pendingSeekObservedSeeked = false;
  state.remoteSeekActivityAt = Date.now();
}

function attemptRemoteSeekSettlement(trigger = "seeked") {
  if (!state.pendingSeekIsRemote) {
    return false;
  }

  const now = performance.now();
  const startedAt = state.pendingSeekRemoteStartedAt || now;
  const ageMs = now - startedAt;

  if (state.pendingSeek !== null) {
    if (elements.player.readyState >= 1) {
      const targetTime = state.pendingSeek;
      state.pendingSeek = null;
      state.pendingSeekObservedSeeked = false;
      state.pendingSeekRemoteStartedAt = now;
      markProgrammaticSeek(targetTime);
      elements.player.currentTime = targetTime;
      scheduleRemoteSeekSettlementAttempt();
      return false;
    }

    if (ageMs < 2000) scheduleRemoteSeekSettlementAttempt(100);
    return false;
  }

  if (!state.pendingSeekObservedSeeked && ageMs < remoteSeekSettlementGraceMs) {
    return false;
  }

  if (elements.player.seeking && ageMs < remoteSeekSettlementGraceMs) {
    return false;
  }

  const currentTime = Number.isFinite(elements.player.currentTime) ? elements.player.currentTime : 0;
  const nextPlaybackState = state.pendingPlaybackState;

  clearRemoteSeekSettlement();
  state.remoteSeekActivityAt = Date.now();
  state.pendingSeek = null;
  state.pendingPlaybackState = null;
  clearProgrammaticSeek();

  logEvent("Remote buffering resumed", {
    trigger,
    currentTime: currentTime.toFixed(2),
    paused: typeof nextPlaybackState === "boolean" ? String(nextPlaybackState) : "unchanged"
  });

  resumeStreamBuffering(currentTime);

  logEvent("Remote seek settled", {
    trigger,
    currentTime: currentTime.toFixed(2),
    paused: typeof nextPlaybackState === "boolean" ? String(nextPlaybackState) : "unchanged",
    heldMs: Math.round(ageMs).toString()
  });

  if (typeof nextPlaybackState === "boolean") {
    applyPlaybackState(nextPlaybackState);
  }

  return true;
}

function schedulePendingSeekCommit(delayMs = gestureCommitDelayMs) {
  if (state.pendingSeekTimer) {
    clearTimeout(state.pendingSeekTimer);
  }

  state.pendingSeekTimer = setTimeout(() => {
    state.pendingSeekTimer = null;
    void attemptPendingSeekCommit("timer");
  }, Math.max(0, delayMs));
}

function attemptPendingSeekCommit(trigger = "timer") {
  if (state.pendingSeekTarget === null) {
    return false;
  }

  if (!state.connection || state.connection.readyState !== WebSocket.OPEN) {
    schedulePendingSeekCommit(gestureCommitRetryMs);
    return false;
  }

  // Don't commit local seek while remote seek settlement is active
  if (state.remoteSeekPending) {
    schedulePendingSeekCommit(gestureCommitRetryMs);
    return false;
  }

  const now = performance.now();

  // Don't send paused state with seek if we just received remote activity (< 500ms)
  // This prevents a local pause coalesced into seek from overriding a fresh remote play
  if (state.remoteSeekActivityAt > 0 && now - state.remoteSeekActivityAt < 500) {
    state.pendingSeekPaused = undefined;
  }

  const startedAt = state.pendingSeekCommitStartedAt || now;
  const lastUpdatedAt = state.pendingSeekLastUpdatedAt || startedAt;
  const ageMs = now - startedAt;
  const quietMs = now - lastUpdatedAt;
  const needsStability = state.seekGestureActive || state.isBuffering || elements.player.seeking;
  // Keep the final seek pending while the media element is still settling so a rapid pause/play can fold into the same room state.
  const shouldHold = ageMs < gestureCommitDelayMs || quietMs < gestureCommitQuietWindowMs || needsStability;

  if (shouldHold && ageMs < gestureCommitMaxDelayMs) {
    schedulePendingSeekCommit(gestureCommitRetryMs);
    return false;
  }

  const finalTarget = state.pendingSeekTarget;
  const finalPaused = state.pendingSeekPaused;
  const payload = {
    currentTime: finalTarget
  };

  if (typeof finalPaused === "boolean") {
    payload.paused = finalPaused;
  }

  const sent = sendPlayerIntent("seek", payload, {
    force: true
  });

  if (!sent) {
    schedulePendingSeekCommit(gestureCommitRetryMs);
    return false;
  }

  logEvent("Seek commit sent", {
    source: trigger,
    currentTime: finalTarget.toFixed(2),
    paused: typeof finalPaused === "boolean" ? String(finalPaused) : "unchanged",
    heldMs: Math.round(ageMs).toString(),
    quietMs: Math.round(quietMs).toString()
  });

  clearPendingSeekCommitTimer();
  resumeStreamBuffering(finalTarget);
  return true;
}

function resetHlsRecoveryState() {
  clearStallRecoveryTimer();
  state.hlsRecoveryAttempts = 0;
  state.hlsMediaErrorAttempts = 0;
  state.hlsLastRecoveryAt = 0;
}

function suppressOutgoingEvents(durationMs = 500) {
  state.suppressOutgoingUntil = Math.max(state.suppressOutgoingUntil, performance.now() + durationMs);
}

function clearProgrammaticSeek() {
  state.programmaticSeekTarget = null;
  state.programmaticSeekExpiresAt = 0;
}

function markProgrammaticSeek(targetTime) {
  state.programmaticSeekTarget = Math.max(0, Number.isFinite(targetTime) ? targetTime : 0);
  state.programmaticSeekExpiresAt = performance.now() + programmaticSeekLifetimeMs;
}

function consumeProgrammaticSeekEvent(eventType) {
  if (state.programmaticSeekTarget === null) {
    return false;
  }

  const currentTime = Number.isFinite(elements.player.currentTime) ? elements.player.currentTime : 0;
  const markerExpired = performance.now() > state.programmaticSeekExpiresAt;
  const matchesTarget = Math.abs(currentTime - state.programmaticSeekTarget) <= programmaticSeekToleranceSeconds;

  if (markerExpired || !matchesTarget) {
    clearProgrammaticSeek();
    return false;
  }

  if (eventType === "seeked") {
    clearProgrammaticSeek();
  }

  return true;
}

function markProgrammaticPlaybackChange(paused) {
  if (paused) {
    state.programmaticPauseEvents += 1;
    return;
  }

  state.programmaticPlayEvents += 1;
}

function consumeProgrammaticPlaybackEvent(paused) {
  if (paused) {
    if (state.programmaticPauseEvents <= 0) {
      return false;
    }

    state.programmaticPauseEvents -= 1;
    return true;
  }

  if (state.programmaticPlayEvents <= 0) {
    return false;
  }

  state.programmaticPlayEvents -= 1;
  return true;
}

function canBroadcastLocalChange() {
  return !state.isApplyingRemoteState && performance.now() >= state.suppressOutgoingUntil;
}

function getWsUrl(room, role, name) {
  const protocol = location.protocol === "https:" ? "wss:" : "ws:";
  const params = new URLSearchParams({
    room,
    role,
    name,
    clientId: state.clientId
  });

  return `${protocol}//${location.host}/ws?${params.toString()}`;
}

function isHlsSource(url) {
  return /\.m3u8(?:\?|$)/i.test(url);
}


function getSourceType(url) {
  if (isHlsSource(url)) {
    return "application/x-mpegURL";
  }

  if (/\.mp4(?:\?|$)/i.test(url)) {
    return "video/mp4";
  }

  return undefined;
}

function getShakaContainer() {
  return elements.player.closest(".player-shell") || elements.player.parentElement;
}

function configureShakaUi(ui) {
  ui.configure({
    addSeekBar: true,
    addBigPlayButton: true,
    controlPanelElements: [
      "play_pause",
      "mute",
      "volume",
      "time_and_duration",
      "spacer",
      "overflow_menu",
      "picture_in_picture",
      "fullscreen"
    ],
    overflowMenuButtons: [
      "quality",
      "playback_rate",
      "picture_in_picture",
      "captions"
    ]
  });
}

async function initializeShakaPlayer() {
  if (state.shakaPlayer) {
    return state.shakaPlayer;
  }

  if (!window.shaka?.Player || !window.shaka?.ui?.Overlay) {
    return null;
  }

  if (typeof window.shaka.polyfill?.installAll === "function") {
    window.shaka.polyfill.installAll();
  }

  const player = new window.shaka.Player();
  await player.attach(elements.player);

  player.configure({
    streaming: {
      lowLatencyMode: true,
      rebufferingGoal: 2,
      bufferingGoal: 20
    }
  });

  player.addEventListener("error", (event) => {
    const error = event.detail;
    logEvent("Shaka player error", {
      code: error?.code || "unknown",
      category: error?.category || "unknown",
      severity: error?.severity || "unknown",
      message: error?.message || "unknown"
    });
  });

  const ui = new window.shaka.ui.Overlay(player, getShakaContainer(), elements.player);
  configureShakaUi(ui);

  state.shakaPlayer = player;
  state.shakaUi = ui;

  return player;
}

async function loadPlayerSource(url, forceReload = false) {
  const player = await initializeShakaPlayer();

  if (player) {
    try {
      await player.load(url);
      return;
    } catch (error) {
      logEvent("Shaka load failed", {
        sourceUrl: url,
        code: error?.code || "unknown",
        message: error?.message || "unknown"
      });
    }
  }

  const type = getSourceType(url);
  if (type) {
    elements.player.setAttribute("type", type);
  }

  elements.player.src = url;
  if (forceReload || isHlsSource(url)) {
    elements.player.load();
  }
}

function destroyHls() {
  clearStallRecoveryTimer();
  clearBufferingDetectionTimer();
  state.bufferingSignalActive = false;

  if (state.hls) {
    state.hls.destroy();
    state.hls = null;
  }
}

function pauseStreamBuffering() {
  if (state.hls && typeof state.hls.pauseBuffering === "function") {
    try {
      state.hls.pauseBuffering();
    } catch (error) {
      logEvent("HLS buffering pause failed", error);
    }
  }
}

function resumeStreamBuffering(startPosition = elements.player.currentTime) {
  if (!state.hls) {
    return;
  }

  try {
    if (typeof state.hls.resumeBuffering === "function") {
      state.hls.resumeBuffering();
    }

    if (typeof state.hls.startLoad === "function") {
      state.hls.startLoad(Number.isFinite(startPosition) ? startPosition : 0);
    }
  } catch (error) {
    logEvent("HLS buffering resume failed", error);
  }
}

function handleHlsStallResolved() {
  resetHlsRecoveryState();
  logEvent("HLS stall resolved", {
    currentTime: Number.isFinite(elements.player.currentTime)
      ? elements.player.currentTime.toFixed(2)
      : "0.00"
  });
}

function rebuildPlaybackPipeline(reason, startPosition = elements.player.currentTime) {
  const sourceUrl = state.currentMediaUrl;
  if (!sourceUrl) {
    return false;
  }

  clearPendingSeekCommitTimer();
  destroyHls();
  suppressOutgoingEvents(2000);
  resetHlsRecoveryState();
  state.isBuffering = false;
  clearProgrammaticSeek();
  state.programmaticPlayEvents = 0;
  state.programmaticPauseEvents = 0;
  clearRemoteSeekSettlement();
  state.remoteSeekActivityAt = 0;
  clearPendingSeekCommitTimer();

  void loadPlayerSource(sourceUrl, true);

  state.pendingSeek = Number.isFinite(startPosition) ? Math.max(0, startPosition) : 0;
  state.pendingPlaybackState = elements.player.paused;

  logEvent("Playback pipeline rebuilt", {
    reason,
    sourceUrl,
    startPosition: Number.isFinite(startPosition) ? startPosition.toFixed(2) : "0.00"
  });

  return true;
}

function attemptStallRecovery(trigger) {
  if (!state.currentMediaUrl || elements.player.paused) {
    return false;
  }

  const currentTime = Number.isFinite(elements.player.currentTime) ? elements.player.currentTime : 0;
  state.hlsRecoveryAttempts += 1;
  state.hlsLastRecoveryAt = Date.now();
  const isRemotePath = state.pendingSeekIsRemote || (state.remoteSeekActivityAt > 0 && Date.now() - state.remoteSeekActivityAt < 10000);

  logEvent(isRemotePath ? "Remote stall recovery triggered" : "HLS stall recovery", {
    trigger,
    attempt: state.hlsRecoveryAttempts,
    currentTime: currentTime.toFixed(2)
  });

  resumeStreamBuffering(currentTime);

  if (state.hlsRecoveryAttempts >= 3) {
    return rebuildPlaybackPipeline(trigger, currentTime);
  }

  return true;
}

function scheduleStallRecovery(trigger) {
  if (state.stallRecoveryTimer) {
    return;
  }

  state.stallRecoveryTimer = setTimeout(() => {
    state.stallRecoveryTimer = null;
    attemptStallRecovery(trigger);
  }, 2500);
}

function handleHlsError(event, data) {
  const details = data?.details || "unknown";
  const errorMessage = data?.error?.message || data?.err?.message || "";

  logEvent("HLS error", {
    fatal: Boolean(data?.fatal),
    type: data?.type || "unknown",
    details,
    message: errorMessage
  });

  if (!state.hls) {
    return;
  }

  const errorTypes = window.Hls?.ErrorTypes || {};
  const errorDetails = window.Hls?.ErrorDetails || {};
  const currentTime = Number.isFinite(elements.player.currentTime) ? elements.player.currentTime : 0;

  if (data?.fatal && data.type === errorTypes.MEDIA_ERROR) {
    if (state.hlsMediaErrorAttempts === 0) {
      state.hlsMediaErrorAttempts += 1;
      try {
        state.hls.recoverMediaError();
        resumeStreamBuffering(currentTime);
        state.hlsLastRecoveryAt = Date.now();
        logEvent("HLS media recovery", {
          currentTime: currentTime.toFixed(2),
          strategy: "recoverMediaError"
        });
        return;
      } catch (error) {
        logEvent("HLS media recovery failed", error);
      }
    }

    rebuildPlaybackPipeline("media-error", currentTime);
    return;
  }

  if (data?.fatal && data.type === errorTypes.NETWORK_ERROR) {
    rebuildPlaybackPipeline("network-error", currentTime);
    return;
  }

  if (
    details === errorDetails.BUFFER_STALLED_ERROR ||
    details === errorDetails.BUFFER_NUDGE_ON_STALL ||
    details === errorDetails.BUFFER_SEEK_OVER_HOLE
  ) {
    scheduleStallRecovery(String(details));
  }
}

function attachHlsListeners(hls) {
  if (!window.Hls || !window.Hls.Events) {
    return;
  }

  hls.on(window.Hls.Events.ERROR, handleHlsError);
  hls.on(window.Hls.Events.STALL_RESOLVED, handleHlsStallResolved);
}

function loadSource(url, options = {}) {
  const nextUrl = url.trim();
  if (!nextUrl) {
    return false;
  }

  const forceReload = Boolean(options.forceReload);
  const sameUrl = state.currentMediaUrl === nextUrl;

  if (sameUrl && !forceReload) {
    return false;
  }

  clearPendingSeekCommitTimer();
  destroyHls();
  resetHlsRecoveryState();
  suppressOutgoingEvents(options.suppressMs ?? 1500);

  state.currentMediaUrl = nextUrl;
  state.pendingSeek = null;
  state.pendingPlaybackState = null;
  state.pendingSeekTarget = null;
  state.seekGestureActive = false;
  state.isBuffering = false;
  clearRemoteSeekSettlement();
  state.remoteSeekActivityAt = 0;
  state.pendingSeekCommitStartedAt = 0;
  state.pendingSeekLastUpdatedAt = 0;
  clearProgrammaticSeek();
  state.programmaticPlayEvents = 0;
  state.programmaticPauseEvents = 0;
  clearPendingSeekCommitTimer();

  elements.player.style.display = "block";
  document.querySelector(".player-idle-state")?.classList.add("hidden");

  void loadPlayerSource(nextUrl, forceReload);

  logEvent("Media source loaded", {
    reason: options.reason || "manual",
    sourceUrl: nextUrl
  });
  setPlaybackState();
  // Force update the play/pause button icon in custom UI
  if (window.__updatePlayButton) {
    window.__updatePlayButton();
  }
  return true;
}

function applyPlaybackState(paused) {
  state.pendingPlaybackState = null;

  if (paused === elements.player.paused) {
    return;
  }

  markProgrammaticPlaybackChange(paused);

  if (paused) {
    elements.player.pause();
    return;
  }

  void elements.player.play().catch(() => {
    if (state.programmaticPlayEvents > 0) {
      state.programmaticPlayEvents -= 1;
    }
  });
}

function requestProgrammaticAutoplay() {
  state.autoplayPending = true;
  if (elements.player && elements.player.readyState >= 1) {
    void startProgrammaticPlayback();
  }
}

async function startProgrammaticPlayback() {
  if (!elements.player) {
    return;
  }

  state.autoplayPending = false;
  markProgrammaticPlaybackChange(false);

  try {
    await elements.player.play();
  } catch {
    if (state.programmaticPlayEvents > 0) {
      state.programmaticPlayEvents -= 1;
    }
  }
}

// --- Quality & Translation request handling ---
function handleQualityOrTranslationRequest(message) {
  // Ignore our own echo
  if (message.clientId === state.clientId) {
    return;
  }

  if (message.requestedQualityLabel || message.requestedTranslatorId || message.requestedSeasonId || message.requestedEpisodeId) {
    logEvent("Processing media request", {
      quality: message.requestedQualityLabel || "unchanged",
      translatorId: message.requestedTranslatorId || "unchanged",
      seasonId: message.requestedSeasonId || "unchanged",
      episodeId: message.requestedEpisodeId || "unchanged",
      requestToken: message.requestToken || "none"
    });

    // Dispatch custom event for interface-ui.js to pick up
    window.dispatchEvent(new CustomEvent("anytogether:media-request", {
      detail: {
        requestedSeasonId: message.requestedSeasonId ? Number(message.requestedSeasonId) : null,
        requestedEpisodeId: message.requestedEpisodeId ? Number(message.requestedEpisodeId) : null,
        requestedQualityLabel: message.requestedQualityLabel || null,
        requestedTranslatorId: message.requestedTranslatorId ? Number(message.requestedTranslatorId) : null,
        requestedBy: message.clientId,
        requestToken: message.requestToken || null
      }
    }));
  }
}

function applyRemoteState(snapshot) {
  if (!snapshot) {
    return;
  }

  const isSelfEchoSnapshot =
    snapshot.control?.clientId === state.clientId &&
    typeof snapshot.lastAction === "string";
  const hasLocalSeekInFlight =
    state.seekGestureActive ||
    state.pendingSeekTimer !== null ||
    state.pendingSeekTarget !== null;

  if (typeof snapshot.revision === "number") {
    state.currentRevision = snapshot.revision;
  }

  if (snapshot.control) {
    updateControlState(snapshot.control, "snapshot");
  }

  // Ignore our own room echo while a local seek is still pending so an older snapshot cannot cancel a newer target.
  if (isSelfEchoSnapshot && hasLocalSeekInFlight) {
    logEvent("Self snapshot deferred", {
      action: snapshot.lastAction || "unknown",
      actionId: snapshot.lastActionId || "none",
      revision: typeof snapshot.revision === "number" ? String(snapshot.revision) : "unknown"
    });
    return;
  }

  clearPendingSeekCommitTimer();
  state.seekGestureActive = false;

  state.isApplyingRemoteState = true;
  suppressOutgoingEvents(250);

  try {
    const mediaUrl = typeof snapshot.mediaUrl === "string" ? snapshot.mediaUrl.trim() : "";
    const mediaChanged = Boolean(mediaUrl && mediaUrl !== state.currentMediaUrl);
    const snapshotTime = typeof snapshot.currentTime === "number" && Number.isFinite(snapshot.currentTime)
      ? Math.max(0, snapshot.currentTime)
      : null;
    const snapshotAgeSeconds = snapshotTime !== null && snapshot.paused === false && Number.isFinite(snapshot.updatedAt)
      ? Math.min(1, Math.max(0, Date.now() - snapshot.updatedAt) / 1000)
      : 0;
    const currentTime = snapshotTime === null ? null : snapshotTime + snapshotAgeSeconds;

    if (mediaUrl) {
      const isNewLoadAction = snapshot.lastAction === "load" &&
        snapshot.lastActionId &&
        snapshot.lastActionId !== state.lastAppliedLoadActionId;
      const shouldReload = mediaUrl !== state.currentMediaUrl || isNewLoadAction;
      loadSource(mediaUrl, {
        forceReload: shouldReload,
        reason: "remote",
        suppressMs: 1500
      });
      if (isNewLoadAction) state.lastAppliedLoadActionId = snapshot.lastActionId;
    }

    if (typeof snapshot.playbackRate === "number") {
      elements.player.playbackRate = snapshot.playbackRate;
    }

    const timelineAction = ["load", "play", "pause", "seek"].includes(snapshot.lastAction);
    const guaranteedSeekHandled = snapshot.lastAction === "seek" &&
      snapshot.lastActionId === state.lastGuaranteedSeekActionId;
    if (currentTime !== null && (timelineAction || mediaChanged) && !guaranteedSeekHandled) {
      const playerTime = Number.isFinite(elements.player.currentTime) ? elements.player.currentTime : 0;
      const timeDiff = Math.abs(playerTime - currentTime);

      if (timeDiff > 0.2 || state.pendingSeekIsRemote) {
        beginRemoteSeekSettlement();
        state.remoteSeekPending = true;
        if (typeof snapshot.paused === "boolean") {
          state.pendingPlaybackState = snapshot.paused;
        }

        if (elements.player.readyState >= 1) {
          markProgrammaticSeek(currentTime);
          elements.player.currentTime = currentTime;
          state.pendingSeek = null;
        } else {
          state.pendingSeek = currentTime;
        }
      } else {
        state.pendingSeek = null;
      }
    }

    if (typeof snapshot.paused === "boolean") {
      if (state.pendingSeekIsRemote || state.pendingSeek !== null || elements.player.seeking || elements.player.readyState < 1) {
        state.pendingPlaybackState = snapshot.paused;
      } else {
        applyPlaybackState(snapshot.paused);
      }
    }
  } finally {
    state.isApplyingRemoteState = false;
    setPlaybackState();
  }
}

function scheduleRemoteSnapshot(snapshot) {
  // Cancel any pending timer to ensure only the freshest snapshot is applied
  if (state.remoteApplyTimer) {
    clearTimeout(state.remoteApplyTimer);
    state.remoteApplyTimer = null;
  }

  state.pendingRemoteApply = snapshot;
  logEvent("Remote snapshot queued", {
    revision: typeof snapshot?.revision === "number" ? String(snapshot.revision) : "unknown",
    action: snapshot?.lastAction || "unknown",
    currentTime: typeof snapshot?.currentTime === "number" && Number.isFinite(snapshot.currentTime)
      ? snapshot.currentTime.toFixed(2)
      : "unchanged",
    paused: typeof snapshot?.paused === "boolean" ? String(snapshot.paused) : "unchanged"
  });

  state.remoteApplyTimer = setTimeout(() => {
    state.remoteApplyTimer = null;
    const nextSnapshot = state.pendingRemoteApply;
    state.pendingRemoteApply = null;
    applyRemoteState(nextSnapshot);
  }, 40);
}

function applyGuaranteedRemoteSeek(message) {
  if (!message || message.originClientId === state.clientId) return;
  const targetTime = Number(message.currentTime);
  if (!Number.isFinite(targetTime)) return;
  const requestedPaused = typeof message.paused === "boolean" ? message.paused : null;

  if (state.lastGuaranteedSeekActionId === message.actionId) {
    if (state.pendingSeek !== null) state.pendingSeek = Math.max(0, targetTime);
    if (requestedPaused !== null) {
      if (state.pendingSeekIsRemote) {
        state.pendingPlaybackState = requestedPaused;
      } else {
        applyPlaybackState(requestedPaused);
      }
    }
    return;
  }

  const playerTime = Number.isFinite(elements.player.currentTime) ? elements.player.currentTime : 0;
  if (Math.abs(playerTime - targetTime) <= 0.25) {
    state.lastGuaranteedSeekActionId = message.actionId || null;
    suppressOutgoingEvents(500);
    if (requestedPaused !== null) applyPlaybackState(requestedPaused);
    return;
  }

  state.lastGuaranteedSeekActionId = message.actionId || null;
  clearPendingSeekCommitTimer();
  state.seekGestureActive = false;
  suppressOutgoingEvents(500);
  beginRemoteSeekSettlement();
  state.remoteSeekPending = true;
  state.pendingPlaybackState = requestedPaused;

  if (elements.player.readyState >= 1) {
    const seekTarget = Math.max(0, targetTime);
    markProgrammaticSeek(seekTarget);
    elements.player.currentTime = seekTarget;
    state.pendingSeek = null;
  } else {
    state.pendingSeek = Math.max(0, targetTime);
  }

  logEvent("Guaranteed seek applied", {
    actionId: message.actionId || "none",
    currentTime: targetTime.toFixed(2)
  });
}

function sendMessage(payload) {
  if (!state.connection || state.connection.readyState !== WebSocket.OPEN) {
    // Queue the message to be sent once WebSocket connects
    state.pendingIntents.push(payload);
    logEvent("Message queued", {
      action: payload.action || payload.type || "unknown"
    });
    return false;
  }

  state.connection.send(JSON.stringify(payload));
  return true;
}

function flushPendingIntents() {
  if (!state.connection || state.connection.readyState !== WebSocket.OPEN) return;

  while (state.pendingIntents.length > 0) {
    const payload = state.pendingIntents.shift();
    state.connection.send(JSON.stringify(payload));
    logEvent("Queued message sent", {
      action: payload.action || payload.type || "unknown"
    });
  }
}

function clearBufferingDetectionTimer() {
  if (!state.bufferingDetectionTimer) return;
  clearTimeout(state.bufferingDetectionTimer);
  state.bufferingDetectionTimer = null;
}

function reportPlaybackStatus() {
  if (!state.connection || state.connection.readyState !== WebSocket.OPEN || !elements.player) return;

  state.connection.send(JSON.stringify({
    type: "playback-status",
    roomId: state.room,
    clientId: state.clientId,
    currentTime: Number.isFinite(elements.player.currentTime) ? elements.player.currentTime : 0,
    paused: elements.player.paused,
    buffering: state.isBuffering,
    applyingSeek: state.remoteSeekPending || elements.player.seeking
  }));
}

function correctPlaybackDrift(syncEntry, recoveredFromBuffering = false) {
  const correctionThresholdMs = syncEntry?.reason === "seek"
    ? seekCorrectionThresholdMs
    : playbackCorrectionThresholdMs;
  if (
    !syncEntry ||
    (!syncEntry.active && !recoveredFromBuffering) ||
    !Number.isFinite(syncEntry.offsetMs) ||
    syncEntry.offsetMs <= correctionThresholdMs ||
    syncEntry.buffering ||
    (elements.player.paused && syncEntry.reason !== "seek") ||
    elements.player.seeking ||
    state.seekGestureActive ||
    state.pendingSeekTimer !== null ||
    state.pendingSeekTarget !== null ||
    state.remoteSeekPending
  ) {
    return;
  }

  const timestamp = performance.now();
  if (timestamp - state.lastPlaybackCorrectionAt < playbackCorrectionCooldownMs) return;

  state.lastPlaybackCorrectionAt = timestamp;
  const adjustmentMs = Number.isFinite(syncEntry.adjustmentMs)
    ? syncEntry.adjustmentMs
    : syncEntry.offsetMs;
  const correctionTarget = Math.max(0, elements.player.currentTime + adjustmentMs / 1000);
  markProgrammaticSeek(correctionTarget);
  elements.player.currentTime = correctionTarget;
  logEvent("Playback drift corrected", { offsetMs: syncEntry.offsetMs, adjustmentMs });
}

function intentPayloadSummary(action, payload) {
  if (action === "load") {
    return {
      mediaUrl: payload.mediaUrl,
      paused: payload.paused,
      currentTime: payload.currentTime
    };
  }

  if (action === "seek") {
    return {
      currentTime: payload.currentTime,
      paused: payload.paused
    };
  }

  if (action === "play" || action === "pause") {
    return {
      currentTime: payload.currentTime
    };
  }

  return payload;
}

function sendPlayerIntent(action, payload = {}, options = {}) {
  // Play and pause always go through, bypassing suppression and remoteSeekPending
  if (action === "play" || action === "pause") {
    // skip canBroadcastLocalChange check
  } else if (!options.force && !canBroadcastLocalChange()) {
    return false;
  }

  // Don't send seek while remote seek settlement is active
  if (action === "seek" && state.remoteSeekPending && !options.force) {
    return false;
  }

  const actionId = crypto.randomUUID();
  if (action === "load") state.lastAppliedLoadActionId = actionId;
  const message = {
    type: "player-intent",
    action,
    actionId,
    roomId: state.room,
    clientId: state.clientId,
    ...payload
  };

  const sent = sendMessage(message);
  if (!sent) {
    return false;
  }

  const suppressionByAction = {
    load: 2000,
    pause: 0,
    play: 0,
    ratechange: 0,
    seek: 0,
    volumechange: 0
  };

  suppressOutgoingEvents(options.suppressMs ?? suppressionByAction[action] ?? 800);
  logEvent("Intent sent", {
    action,
    actionId,
    ...intentPayloadSummary(action, payload)
  });

  return true;
}

function commitSeek(targetTime, paused = undefined, source = "seek") {
  const numericTarget = Math.max(0, Number.isFinite(targetTime) ? targetTime : 0);
  const now = performance.now();
  const hasSameTarget = state.pendingSeekTarget !== null && Math.abs(state.pendingSeekTarget - numericTarget) < 0.05;
  const hasSamePaused = typeof paused !== "boolean" || state.pendingSeekPaused === paused;

  if (hasSameTarget && hasSamePaused) {
    state.pendingSeekLastUpdatedAt = now;
    return;
  }

  if (state.pendingSeekTarget === null && state.pendingSeekTimer === null) {
    state.pendingSeekCommitStartedAt = now;
  }

  state.pendingSeekTarget = numericTarget;
  state.pendingSeekLastUpdatedAt = now;
  if (typeof paused === "boolean") {
    state.pendingSeekPaused = paused;
  }

  schedulePendingSeekCommit(gestureCommitDelayMs);

  const queueTitle =
    source === "pause" ? "Pause coalesced into seek" :
    source === "play" ? "Play coalesced into seek" :
    "Seek queued";

  logEvent(queueTitle, {
    source,
    currentTime: numericTarget.toFixed(2),
    paused: typeof state.pendingSeekPaused === "boolean" ? String(state.pendingSeekPaused) : "unchanged"
  });
}

function acknowledgeLocalSeek() {
  state.seekGestureActive = true;
  pauseStreamBuffering();
  commitSeek(elements.player.currentTime, elements.player.paused, "seeking");
}

function finalizeLocalSeek() {
  if (!state.seekGestureActive) {
    setPlaybackState();
    return;
  }

  commitSeek(elements.player.currentTime, elements.player.paused, "seeked");
  if (!elements.player.seeking) {
    state.seekGestureActive = false;
  }

  if (state.pendingSeek !== null && Math.abs(elements.player.currentTime - state.pendingSeek) < 0.25) {
    state.pendingSeek = null;
  }

  if (state.pendingPlaybackState !== null && state.pendingSeek === null) {
    applyPlaybackState(state.pendingPlaybackState);
  }

  resumeStreamBuffering(elements.player.currentTime);
  void attemptPendingSeekCommit("seeked");
  setPlaybackState();
}

function cancelPendingSeekForPlaybackToggle() {
  clearPendingSeekCommitTimer();
  state.pendingSeekTarget = null;
  state.pendingSeekPaused = null;
  state.pendingSeekCommitStartedAt = 0;
  state.pendingSeekLastUpdatedAt = 0;
  state.seekGestureActive = false;
}

let _wsReconnectCount = 0;
const WS_MAX_RECONNECT = 3;

function connectRoom() {

  if (state.connection) {
    state.connection.close();
  }

  // Limit reconnect attempts to prevent infinite loop in console
  _wsReconnectCount++;
  if (_wsReconnectCount > WS_MAX_RECONNECT) {
    setConnectionLabel("Server offline");
    logEvent("Connection limited", "Max reconnect attempts reached. Refresh to retry.");
    return;
  }

  state.room = elements.roomInput.value.trim() || "lobby";
  state.role = elements.roleSelect.value;
  const name = elements.displayName.value.trim() || "Guest";

  elements.activeRole.textContent = state.role.charAt(0).toUpperCase() + state.role.slice(1);
  elements.activeRoom.textContent = state.room;
  setConnectionLabel("Connecting");

  const socket = new WebSocket(getWsUrl(state.room, state.role, name));
  state.connection = socket;

  socket.addEventListener("open", () => {
    if (state.connection !== socket) {
      return;
    }

    state.isConnected = true;
    _wsReconnectCount = 0;
    setConnectionLabel("Connected");
    logEvent("Connected", {
      room: state.room,
      role: state.role
    });

    sendMessage({
      type: "join",
      roomId: state.room,
      name,
      role: state.role
    });

    flushPendingIntents();

    if (state.role === "guest") {
      sendMessage({ type: "request-sync" });
    }
  });

  socket.addEventListener("error", () => {
    if (state.connection !== socket) {
      return;
    }

    logEvent("Connection error", "The WebSocket connection reported an error.");
  });

  socket.addEventListener("close", (event) => {
    if (state.connection !== socket) {
      return;
    }

    state.isConnected = false;
    setConnectionLabel("Disconnected");
    logEvent("Disconnected", {
      code: event.code,
      reason: event.reason || "none"
    });
  });

  socket.addEventListener("message", (event) => {
    if (state.connection !== socket) {
      return;
    }

    let message;

    try {
      message = JSON.parse(event.data);
    } catch {
      return;
    }

    if (message.type === "connected") {
      if (typeof message.revision === "number") {
        state.currentRevision = message.revision;
      }

      if (message.control) {
        updateControlState(message.control, "connected");
      }

      if (message.snapshot) {
        scheduleRemoteSnapshot(message.snapshot);
      }

      return;
    }

    if (message.type === "seek-command") {
      applyGuaranteedRemoteSeek(message);
      return;
    }

    if (message.type === "room-snapshot") {
      if (typeof message.revision === "number" && message.revision > state.currentRevision) {
        state.currentRevision = message.revision;
        scheduleRemoteSnapshot(message.snapshot);
        logEvent("Room snapshot applied", {
          revision: message.revision,
          action: message.snapshot?.lastAction || "unknown",
          actionId: message.snapshot?.lastActionId || "none"
        });
      }

      return;
    }

    if (message.type === "player-ack") {
      if (typeof message.revision === "number") {
        state.currentRevision = Math.max(state.currentRevision, message.revision);
      }

      if (message.control) {
        updateControlState(message.control, "ack");
      }

      logEvent("Intent acknowledged", {
        actionId: message.actionId,
        revision: message.revision
      });
      return;
    }

    if (message.type === "player-intent-rejected") {
      if (typeof message.revision === "number") {
        state.currentRevision = Math.max(state.currentRevision, message.revision);
      }

      clearPendingSeekCommitTimer();

      if (message.control) {
        updateControlState(message.control, "rejected");
      }

      logEvent("Intent rejected", {
        actionId: message.actionId,
        reason: message.reason
      });

      if (message.snapshot) {
        scheduleRemoteSnapshot(message.snapshot);
      }

      return;
    }

    if (message.type === "playback-sync") {
      const previousOwnSync = state.playbackSyncOffsets.get(state.clientId);
      state.playbackSyncOffsets = new Map(
        (Array.isArray(message.offsets) ? message.offsets : [])
          .filter((entry) => entry?.clientId)
          .map((entry) => [entry.clientId, entry])
      );
      const ownSync = state.playbackSyncOffsets.get(state.clientId);
      const recoveredFromBuffering = Boolean(previousOwnSync?.buffering && !ownSync?.buffering);
      const confirmedBufferingRecovery = recoveredFromBuffering &&
        state.lastBufferingDurationMs >= bufferingCorrectionMinimumMs;
      correctPlaybackDrift(ownSync, confirmedBufferingRecovery);
      if (recoveredFromBuffering) state.lastBufferingDurationMs = 0;
      return;
    }

    if (message.type === "presence") {
      if (message.control) {
        updateControlState(message.control, "presence");
      }

      renderMembers(message.members || []);
      return;
    }

    if (message.type === "chat") {
      logEvent(`${message.name} said`, message.text);
    }

    // Handle quality/translation requests forwarded by server
    if (message.type === "media-request") {
      handleQualityOrTranslationRequest(message);
      return;
    }
  });
}

function sendQualityRequest(qualityLabel) {
  const requestToken = crypto.randomUUID();
  sendMessage({
    type: "media-request",
    roomId: state.room,
    clientId: state.clientId,
    requestedQualityLabel: qualityLabel,
    requestToken
  });
  logEvent("Quality request sent", { qualityLabel, requestToken });
}

function sendTranslationRequest(translatorId) {
  const requestToken = crypto.randomUUID();
  sendMessage({
    type: "media-request",
    roomId: state.room,
    clientId: state.clientId,
    requestedTranslatorId: Number(translatorId),
    requestToken
  });
  logEvent("Translation request sent", { translatorId: Number(translatorId), requestToken });
}

function sendMediaRequest(params) {
  const requestToken = params.requestToken || crypto.randomUUID();
  sendMessage({
    type: "media-request",
    roomId: state.room,
    clientId: state.clientId,
    requestedSeasonId: params.requestedSeasonId || null,
    requestedEpisodeId: params.requestedEpisodeId || null,
    requestedTranslatorId: params.requestedTranslatorId || null,
    requestedQualityLabel: params.requestedQualityLabel || null,
    requestToken
  });
  logEvent("Media request sent", {
    seasonId: params.requestedSeasonId,
    episodeId: params.requestedEpisodeId,
    translatorId: params.requestedTranslatorId,
    qualityLabel: params.requestedQualityLabel,
    requestToken
  });
}

// Expose functions for interface-ui.js
window.__sendQualityRequest = sendQualityRequest;
window.__sendTranslationRequest = sendTranslationRequest;
window.__sendMediaRequest = sendMediaRequest;
window.__anyTogetherRequestAutoplay = requestProgrammaticAutoplay;
window.anyTogetherSyncBridge = {
  connectRoom(room, role, name) {
    const nextRoom = String(room || "").trim() || "lobby";
    const nextRole = String(role || "guest");
    const nextName = String(name || "Guest").trim() || "Guest";
    const connectionIsActive = state.connection &&
      (state.connection.readyState === WebSocket.OPEN || state.connection.readyState === WebSocket.CONNECTING);
    const connectionMatches = state.room === nextRoom &&
      elements.roleSelect.value === nextRole &&
      elements.displayName.value === nextName;

    elements.roomInput.value = nextRoom;
    elements.roleSelect.value = nextRole;
    elements.displayName.value = nextName;

    if (connectionIsActive && connectionMatches) return true;
    connectRoom();
    return true;
  },
  loadMedia(url) {
    const mediaUrl = String(url || "").trim();
    if (!mediaUrl) return false;
    if (state.currentMediaUrl === mediaUrl) return true;
    elements.mediaUrl.value = mediaUrl;
    loadManualMedia();
    return true;
  }
};
window.__getPlaybackSyncInfo = (participantClientId = state.clientId) => {
  const reportedSync = state.playbackSyncOffsets.get(participantClientId);
  if (reportedSync && Number.isFinite(reportedSync.offsetMs)) {
    return {
      offsetMs: reportedSync.active ? Math.max(0, Math.round(reportedSync.offsetMs)) : 0,
      buffering: Boolean(reportedSync.buffering),
      active: Boolean(reportedSync.active)
    };
  }
  if (participantClientId !== state.clientId) return null;
  return {
    offsetMs: 0,
    buffering: false
  };
};

setInterval(reportPlaybackStatus, playbackStatusIntervalMs);

function renderMembers(members) {
  elements.memberList.innerHTML = "";

  if (!members.length) {
    const empty = document.createElement("div");
    empty.className = "member";
    empty.textContent = "No members connected yet.";
    elements.memberList.append(empty);
    return;
  }

  for (const member of members) {
    const item = document.createElement("div");
    item.className = "member";

    const name = document.createElement("strong");
    name.textContent = member.name;

    const role = document.createElement("span");
    role.textContent = member.role;

    item.append(name, role);
    elements.memberList.append(item);
  }
}

function requestPluginSearch() {
  const query = elements.searchQuery.value.trim();
  if (!query) {
    setBridgeState("Query required", "Enter a target platform and title before sending the request.");
    return;
  }

  const requestId = crypto.randomUUID();
  window.postMessage(
    {
      source: "anytogether-web",
      type: `${pluginRequestPrefix}:search-request`,
      requestId,
      room: state.room,
      role: state.role,
      query
    },
    "*"
  );

  setBridgeState("Search request sent", `Request ${requestId} was posted to the extension bridge.`);
  logEvent("Plugin search dispatched", query);
}

function loadManualMedia() {
  const url = elements.mediaUrl.value.trim();
  if (!url) {
    return;
  }

  if (state.currentMediaUrl === url) {
    logEvent("Manual media ignored", {
      reason: "same source already loaded",
      sourceUrl: url
    });
    return;
  }

  const wasPaused = elements.player.paused;
  const currentTime = Number.isFinite(elements.player.currentTime) ? elements.player.currentTime : 0;

  sendPlayerIntent("load", {
    mediaUrl: url,
    currentTime: 0,
    paused: wasPaused,
    playbackRate: elements.player.playbackRate,
    volume: elements.player.volume,
    muted: elements.player.muted
  }, {
    force: true,
    suppressMs: 2200
  });

  loadSource(url, {
    forceReload: true,
    reason: "manual",
    suppressMs: 2000
  });

  state.pendingSeek = 0;
  state.pendingPlaybackState = wasPaused;

  logEvent("Manual media queued", {
    sourceUrl: url,
    currentTime: currentTime.toFixed(2)
  });
}

function handlePluginMessage(event) {
  if (event.source !== window || !event.data || event.data.source !== "anytogether-plugin") {
    return;
  }

  const { type, mediaUrl, title, originUrl, error } = event.data;

  if (type === `${pluginRequestPrefix}:search-result` && mediaUrl) {
    if (state.currentMediaUrl === mediaUrl) {
      logEvent("Plugin result ignored", {
        reason: "same source already loaded",
        sourceUrl: mediaUrl
      });
      return;
    }

    setBridgeState("Plugin response received", title || mediaUrl);

    const wasPaused = elements.player.paused;
    sendPlayerIntent("load", {
      mediaUrl,
      currentTime: 0,
      paused: wasPaused,
      playbackRate: elements.player.playbackRate,
      volume: elements.player.volume,
      muted: elements.player.muted
    }, {
      force: true,
      suppressMs: 2200
    });

    loadSource(mediaUrl, {
      forceReload: true,
      reason: "plugin",
      suppressMs: 2000
    });

    state.pendingSeek = 0;
    state.pendingPlaybackState = wasPaused;

    logEvent("Plugin media result", {
      originUrl: originUrl || mediaUrl,
      title: title || "unknown"
    });
    return;
  }

  if (type === `${pluginRequestPrefix}:search-error`) {
    setBridgeState("Plugin error", error || "The extension reported a failure.");
    logEvent("Plugin error", error || "Unknown plugin failure.");
  }
}

function handleHlsPlayingActivity() {
  state.bufferingSignalActive = false;
  clearBufferingDetectionTimer();
  if (state.isBuffering && state.bufferingStartedAt > 0) {
    state.lastBufferingDurationMs = performance.now() - state.bufferingStartedAt;
  }
  state.isBuffering = false;
  state.bufferingStartedAt = 0;
  resetHlsRecoveryState();
  void attemptRemoteSeekSettlement("playback-activity");
  void attemptPendingSeekCommit("playback-activity");
}

function handleWaitingLikeEvent() {
  state.bufferingSignalActive = true;
  if (state.bufferingDetectionTimer || state.isBuffering) return;

  state.bufferingProbeTime = Number.isFinite(elements.player.currentTime) ? elements.player.currentTime : 0;
  state.bufferingDetectionTimer = setTimeout(() => {
    state.bufferingDetectionTimer = null;
    if (!state.bufferingSignalActive || elements.player.paused) return;
    const currentTime = Number.isFinite(elements.player.currentTime) ? elements.player.currentTime : 0;
    if (currentTime - state.bufferingProbeTime > 0.05) return;
    state.isBuffering = true;
    state.bufferingStartedAt = performance.now();
    scheduleStallRecovery("waiting");
  }, bufferingConfirmationMs);
}

void initializeShakaPlayer();


elements.connectButton.addEventListener("click", connectRoom);
if (elements.searchButton) {
  elements.searchButton.addEventListener("click", requestPluginSearch);
}
elements.loadMediaButton.addEventListener("click", loadManualMedia);
elements.seekButton.addEventListener("click", () => {
  elements.player.currentTime = Math.max(0, Number(elements.seekInput.value) || 0);
});
elements.syncButton.addEventListener("click", () => sendMessage({ type: "request-sync" }));

elements.player.addEventListener("play", () => {
  const isProgrammaticPlay = consumeProgrammaticPlaybackEvent(false);

  if (state.seekGestureActive || state.isBuffering || state.pendingSeekTimer || state.pendingSeekTarget !== null) {
    if (!isProgrammaticPlay) {
      cancelPendingSeekForPlaybackToggle();
      sendPlayerIntent("play", {
        currentTime: elements.player.currentTime
      }, { force: true });
    }

    setPlaybackState();
    return;
  }

  handleHlsPlayingActivity();
  setPlaybackState();

  if (isProgrammaticPlay) {
    return;
  }

  // Play intent always sent (sendPlayerIntent bypasses suppression for play/pause)
  sendPlayerIntent("play", {
    currentTime: elements.player.currentTime
  });
});

elements.player.addEventListener("pause", () => {
  const isProgrammaticPause = consumeProgrammaticPlaybackEvent(true);

  if (state.seekGestureActive || state.isBuffering || state.pendingSeekTimer || state.pendingSeekTarget !== null) {
    if (isProgrammaticPause) {
      handleHlsPlayingActivity();
    } else {
      cancelPendingSeekForPlaybackToggle();
      sendPlayerIntent("pause", {
        currentTime: elements.player.currentTime
      }, { force: true });
    }

    setPlaybackState();
    return;
  }

  handleHlsPlayingActivity();
  setPlaybackState();

  if (isProgrammaticPause) {
    return;
  }

  // Pause intent always sent (sendPlayerIntent bypasses suppression for play/pause)
  sendPlayerIntent("pause", {
    currentTime: elements.player.currentTime
  });
});

elements.player.addEventListener("seeking", () => {
  if (consumeProgrammaticSeekEvent("seeking")) {
    return;
  }

  acknowledgeLocalSeek();
});

elements.player.addEventListener("seeked", () => {
  if (consumeProgrammaticSeekEvent("seeked")) {
    if (state.pendingSeekIsRemote) {
      state.pendingSeekObservedSeeked = true;
      void attemptRemoteSeekSettlement("seeked");
    }

    return;
  }

  finalizeLocalSeek();
});

elements.player.addEventListener("loadedmetadata", () => {
  if (state.pendingSeek !== null) {
    const seekTarget = Math.max(0, state.pendingSeek);
    markProgrammaticSeek(seekTarget);
    elements.player.currentTime = seekTarget;
    state.pendingSeek = null;
  }

  if (state.pendingPlaybackState !== null && !state.pendingSeekIsRemote) {
    applyPlaybackState(state.pendingPlaybackState);
  }

  if (state.autoplayPending) {
    void startProgrammaticPlayback();
  }

  handleHlsPlayingActivity();
  setPlaybackState();
});

elements.player.addEventListener("loadeddata", handleHlsPlayingActivity);
elements.player.addEventListener("canplay", handleHlsPlayingActivity);
elements.player.addEventListener("playing", handleHlsPlayingActivity);
elements.player.addEventListener("waiting", handleWaitingLikeEvent);
elements.player.addEventListener("stalled", handleWaitingLikeEvent);

elements.player.addEventListener("ratechange", () => {
  if (canBroadcastLocalChange()) {
    sendPlayerIntent("ratechange", {
      playbackRate: elements.player.playbackRate
    });
  }

  setPlaybackState();
});

elements.player.addEventListener("volumechange", () => {
  setPlaybackState();
});

window.addEventListener("message", handlePluginMessage);

window.addEventListener("beforeunload", () => {
  if (state.connection) {
    state.connection.close();
  }
});

setConnectionLabel("Disconnected");
setBridgeState(
  "Waiting for plugin response",
  "Plugin search results should arrive through a window message with a mediaUrl field."
);
renderMembers([]);
setPlaybackState();
logEvent("Network pattern ready", `Example request matcher: ${webRequestPattern}`);

const settingsPanel = document.getElementById("playerSettingsPanel");
const settingsQualityRow = document.getElementById("settingsQualityRow");
const settingsSpeedRow = document.getElementById("settingsSpeedRow");
const settingsPipBtn = document.getElementById("settingsPipBtn");
const settingsSpeeds = [0.5, 0.75, 1, 1.25, 1.5, 2];

let settingsOpen = false;
let settingsView = null;
let originalQualitySection = null;
let originalSpeedSection = null;
let originalPipSection = null;
let originalDividerOne = null;
let originalDividerTwo = null;
let settingsPanelBound = false;

function getOriginalSections() {
  if (!settingsPanel) {
    return {
      quality: null,
      speed: null,
      pip: null,
      dividerOne: null,
      dividerTwo: null
    };
  }

  if (!originalQualitySection) {
    const sections = settingsPanel.querySelectorAll(".settings-section");
    const dividers = settingsPanel.querySelectorAll(".settings-divider");
    originalQualitySection = sections[0] || null;
    originalSpeedSection = sections[1] || null;
    originalPipSection = sections[2] || null;
    originalDividerOne = dividers[0] || null;
    originalDividerTwo = dividers[1] || null;
  }

  return {
    quality: originalQualitySection,
    speed: originalSpeedSection,
    pip: originalPipSection,
    dividerOne: originalDividerOne,
    dividerTwo: originalDividerTwo
  };
}

function hideOriginalSections() {
  const sections = getOriginalSections();
  if (sections.quality) sections.quality.style.display = "none";
  if (sections.speed) sections.speed.style.display = "none";
  if (sections.pip) sections.pip.style.display = "none";
  if (sections.dividerOne) sections.dividerOne.style.display = "none";
  if (sections.dividerTwo) sections.dividerTwo.style.display = "none";
}

function showOriginalSections() {
  const sections = getOriginalSections();
  if (sections.quality) sections.quality.style.display = "";
  if (sections.speed) sections.speed.style.display = "";
  if (sections.pip) sections.pip.style.display = "";
  if (sections.dividerOne) sections.dividerOne.style.display = "";
  if (sections.dividerTwo) sections.dividerTwo.style.display = "";
}

function removeDynamicMenus() {
  if (!settingsPanel) return;
  settingsPanel.querySelectorAll(".settings-dynamic-menu").forEach((menu) => menu.remove());
}

function getCurrentSpeedLabel() {
  const speed = elements.player ? elements.player.playbackRate : 1;
  return speed === 1 ? "Normal" : `${speed}x`;
}

function getCurrentQualityLabel() {
  const getActive = window.__settingsGetActiveQualityLabel;
  const activeLabel = typeof getActive === "function" ? getActive() : null;
  if (activeLabel) {
    return activeLabel;
  }

  const getQualities = window.__settingsGetAvailableQualities;
  const qualities = typeof getQualities === "function" ? getQualities() : [];
  return qualities.length > 0 ? qualities[0].label : null;
}

function getCurrentPipLabel() {
  return document.pictureInPictureElement ? "On" : "Off";
}

function updateSettingsPipBtn() {
  if (!settingsPipBtn) return;

  if (document.pictureInPictureElement) {
    settingsPipBtn.textContent = "Exit PiP";
    settingsPipBtn.classList.add("is-active");
  } else {
    settingsPipBtn.textContent = "Enable PiP";
    settingsPipBtn.classList.remove("is-active");
  }
}

function showMainMenu() {
  if (!settingsPanel) return;

  settingsView = null;
  removeDynamicMenus();
  hideOriginalSections();

  const menu = document.createElement("div");
  menu.className = "settings-dynamic-menu";
  menu.style.cssText = "display:flex;flex-direction:column;";

  const items = [
    { id: "speed", label: "Speed", icon: "⏱" },
    { id: "quality", label: "Quality", icon: "🎬" },
    { id: "pip", label: "Picture-in-Picture", icon: "🗖" }
  ];

  items.forEach((item) => {
    const row = document.createElement("div");
    row.className = "settings-nav-row";

    let valueText = "";
    if (item.id === "speed") {
      valueText = getCurrentSpeedLabel();
    } else if (item.id === "quality") {
      valueText = getCurrentQualityLabel();
    } else if (item.id === "pip") {
      valueText = getCurrentPipLabel();
    }

    row.innerHTML = `<span class="settings-nav-icon">${item.icon}</span><span class="settings-nav-label">${item.label}</span><span class="settings-nav-value">${valueText || ""}</span>`;
    row.addEventListener("click", (event) => {
      event.stopPropagation();

      if (item.id === "pip") {
        if (document.pictureInPictureElement) {
          document.exitPictureInPicture().catch(() => {});
        } else if (elements.player && typeof elements.player.requestPictureInPicture === "function") {
          elements.player.requestPictureInPicture().catch(() => {});
        }
        setTimeout(showMainMenu, 300);
        return;
      }

      showSubMenu(item.id);
    });

    menu.appendChild(row);
  });

  settingsPanel.appendChild(menu);
}

function showSubMenu(type) {
  if (!settingsPanel) return;

  settingsView = type;
  removeDynamicMenus();
  hideOriginalSections();

  const menu = document.createElement("div");
  menu.className = "settings-dynamic-menu";
  menu.style.cssText = "display:flex;flex-direction:column;";

  const back = document.createElement("div");
  back.className = "settings-nav-row";
  back.innerHTML = '<span class="settings-nav-back-icon">❮</span><span class="settings-nav-label">Back</span>';
  back.addEventListener("click", (event) => {
    event.stopPropagation();
    showMainMenu();
  });
  menu.appendChild(back);

  const label = document.createElement("div");
  label.className = "settings-sub-header";
  label.textContent = type === "speed" ? "Speed" : "Quality";
  menu.appendChild(label);

  if (type === "speed") {
    const currentSpeed = elements.player ? elements.player.playbackRate : 1;
    settingsSpeeds.forEach((speed) => {
      const button = document.createElement("div");
      button.className = "settings-nav-row settings-sub-option" + (Math.abs(speed - currentSpeed) < 0.01 ? " is-active" : "");
      const speedLabel = speed === 1 ? "Normal" : `${speed}x`;
      button.innerHTML = `<span class="settings-nav-label">${speedLabel}</span>`;
      button.addEventListener("click", (event) => {
        event.stopPropagation();
        if (elements.player) {
          elements.player.playbackRate = speed;
        }
        settingsOpen = false;
        settingsPanel.classList.remove("is-open");
        removeDynamicMenus();
        showOriginalSections();
      });
      menu.appendChild(button);
    });
  } else {
    const getQualities = window.__settingsGetAvailableQualities;
    const getActive = window.__settingsGetActiveQualityLabel;
    const setQuality = window.__settingsSetQualityLabel;
    const activeLabel = typeof getActive === "function" ? getActive() : null;
    const qualities = typeof getQualities === "function" ? getQualities() : [];

    if (!qualities || qualities.length === 0) {
      const empty = document.createElement("div");
      empty.className = "settings-sub-empty";
      empty.textContent = "No qualities available";
      menu.appendChild(empty);
    } else {
      qualities.forEach((quality) => {
        const button = document.createElement("div");
        button.className = "settings-nav-row settings-sub-option" + (quality.label === activeLabel ? " is-active" : "");
        button.innerHTML = `<span class="settings-nav-label">${quality.label}</span>`;
        button.addEventListener("click", (event) => {
          event.stopPropagation();
          if (typeof setQuality === "function") {
            setQuality(quality.label);
          }
          settingsOpen = false;
          settingsPanel.classList.remove("is-open");
          removeDynamicMenus();
          showOriginalSections();
        });
        menu.appendChild(button);
      });
    }
  }

  settingsPanel.appendChild(menu);
}

function populateSettingsQuality() {
  if (!settingsQualityRow) return;

  const getQualities = window.__settingsGetAvailableQualities;
  const getActive = window.__settingsGetActiveQualityLabel;
  const setQuality = window.__settingsSetQualityLabel;

  if (typeof getQualities !== "function") {
    settingsQualityRow.textContent = "No qualities available";
    return;
  }

  const qualities = getQualities();
  const activeLabel = typeof getActive === "function" ? getActive() : null;
  settingsQualityRow.textContent = "";

  if (!qualities || qualities.length === 0) {
    settingsQualityRow.textContent = "No qualities";
    return;
  }

  qualities.forEach((quality) => {
    const button = document.createElement("button");
    button.className = "settings-btn";
    button.textContent = quality.label;
    if (quality.label === activeLabel) {
      button.classList.add("is-active");
    }
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      if (typeof setQuality === "function") {
        setQuality(quality.label);
      }
      populateSettingsQuality();
    });
    settingsQualityRow.appendChild(button);
  });
}

function populateSettingsSpeed() {
  if (!settingsSpeedRow) return;

  settingsSpeedRow.textContent = "";
  const currentSpeed = elements.player ? elements.player.playbackRate : 1;

  settingsSpeeds.forEach((speed) => {
    const button = document.createElement("button");
    button.className = "settings-btn";
    button.textContent = speed === 1 ? "Normal" : `${speed}x`;
    if (Math.abs(speed - currentSpeed) < 0.01) {
      button.classList.add("is-active");
    }
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      if (elements.player) {
        elements.player.playbackRate = speed;
      }
      populateSettingsSpeed();
    });
    settingsSpeedRow.appendChild(button);
  });
}

function setupSettingsPanel() {
  if (!settingsPanel || settingsPanelBound) return;

  settingsPanelBound = true;
  updateSettingsPipBtn();

  if (settingsPipBtn) {
    settingsPipBtn.addEventListener("click", async (event) => {
      event.stopPropagation();
      try {
        if (document.pictureInPictureElement) {
          await document.exitPictureInPicture();
        } else if (elements.player && typeof elements.player.requestPictureInPicture === "function") {
          await elements.player.requestPictureInPicture();
        }
      } catch (error) {
        logEvent("PiP error", error.message);
      }
      updateSettingsPipBtn();
    });
  }

  document.addEventListener("click", (event) => {
    if (settingsOpen &&
      !event.target.closest(".settings-btn") &&
      !event.target.closest(".player-settings-panel")) {
      settingsOpen = false;
      settingsPanel.classList.remove("is-open");
      removeDynamicMenus();
      showOriginalSections();
    }
  });

  document.addEventListener("enterpictureinpicture", updateSettingsPipBtn);
  document.addEventListener("leavepictureinpicture", updateSettingsPipBtn);
}

function toggleSettingsPanel() {
  if (!settingsPanel) return;

  settingsOpen = !settingsOpen;
  if (settingsOpen) {
    settingsPanel.classList.add("is-open");
    settingsView = null;
    populateSettingsQuality();
    populateSettingsSpeed();
    updateSettingsPipBtn();
    removeDynamicMenus();
    showMainMenu();
  } else {
    settingsPanel.classList.remove("is-open");
    removeDynamicMenus();
    showOriginalSections();
  }
}

window.toggleSettingsPanel = toggleSettingsPanel;

setupSettingsPanel();
