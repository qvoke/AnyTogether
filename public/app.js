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

const state = {
  clientId: crypto.randomUUID(),
  connection: null,
  currentControl: null,
  currentMediaUrl: "",
  currentRevision: 0,
  isApplyingRemoteState: false,
  isBuffering: false,
  isConnected: false,
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
  remoteApplyTimer: null,
  remoteSeekActivityAt: 0,
  programmaticSeekEvents: 0,
  programmaticPlayEvents: 0,
  programmaticPauseEvents: 0,
  seekGestureActive: false,
  stallRecoveryTimer: null,
  suppressOutgoingUntil: 0,
  hls: null,
  videoPlayer: null,
  videoQualityMenu: null,
  videoQualitySelection: "auto",
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
  state.pendingSeekIsRemote = false;
  state.pendingSeekObservedSeeked = false;
  state.pendingSeekRemoteStartedAt = 0;
}

function beginRemoteSeekSettlement() {
  if (!state.pendingSeekIsRemote) {
    state.pendingSeekRemoteStartedAt = performance.now();
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

  if (!state.pendingSeekObservedSeeked && ageMs < gestureCommitMaxDelayMs) {
    return false;
  }

  if (state.pendingSeek !== null) {
    const playerTime = Number.isFinite(elements.player.currentTime) ? elements.player.currentTime : 0;
    if (Math.abs(playerTime - state.pendingSeek) > 0.35 && ageMs < gestureCommitMaxDelayMs) {
      return false;
    }
  }

  if (elements.player.seeking && ageMs < gestureCommitMaxDelayMs) {
    return false;
  }

  const currentTime = Number.isFinite(elements.player.currentTime) ? elements.player.currentTime : 0;
  const nextPlaybackState = state.pendingPlaybackState;

  clearRemoteSeekSettlement();
  state.remoteSeekActivityAt = Date.now();
  state.pendingSeek = null;
  state.pendingPlaybackState = null;
  state.programmaticSeekEvents = 0;

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

  const now = performance.now();
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

function markProgrammaticSeek(eventCount = 2) {
  state.programmaticSeekEvents += Math.max(1, eventCount);
}

function consumeProgrammaticSeekEvent() {
  if (state.programmaticSeekEvents <= 0) {
    return false;
  }

  state.programmaticSeekEvents -= 1;
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


function getVideoJsQualityLevels(player = state.videoPlayer) {
  if (!player || typeof player.qualityLevels !== "function") {
    return null;
  }

  return player.qualityLevels();
}

function getVideoJsQualityOptions(player = state.videoPlayer) {
  const levels = getVideoJsQualityLevels(player);
  if (!levels || !Number.isFinite(levels.length)) {
    return [];
  }

  const options = [];
  const seen = new Set();

  for (let index = 0; index < levels.length; index += 1) {
    const level = levels[index];
    const height = Number(level?.height);
    if (!Number.isFinite(height) || height <= 0 || seen.has(height)) {
      continue;
    }

    seen.add(height);
    options.push({
      value: String(height),
      label: `${height}p`,
      height,
      bitrate: Number(level?.bitrate) || 0
    });
  }

  return options.sort((a, b) => b.height - a.height);
}

function applyVideoJsQualitySelection(selection = state.videoQualitySelection) {
  const player = state.videoPlayer;
  const levels = getVideoJsQualityLevels(player);
  if (!levels) {
    return;
  }

  const selectedHeight = selection === "auto" ? null : Number(selection);
  const hasManualSelection = Number.isFinite(selectedHeight);

  for (let index = 0; index < levels.length; index += 1) {
    const level = levels[index];
    level.enabled = !hasManualSelection || Number(level?.height) === selectedHeight;
  }

  state.videoQualitySelection = hasManualSelection ? String(selectedHeight) : "auto";
}

function updateVideoJsQualityButton() {
  const button = state.videoQualityMenu;
  if (!button) {
    return;
  }

  if (typeof button.update === "function") {
    button.update();
  }

  const options = getVideoJsQualityOptions();
  if (typeof button.show === "function" && typeof button.hide === "function") {
    if (options.length > 1) {
      button.show();
    } else {
      button.hide();
    }
  }
}

function installVideoJsQualityMenu(player) {
  if (!window.videojs || !player || !player.controlBar || state.videoQualityMenu) {
    return;
  }

  const videojs = window.videojs;
  const MenuButton = videojs.getComponent("MenuButton");
  const MenuItem = videojs.getComponent("MenuItem");

  if (!MenuButton || !MenuItem) {
    return;
  }

  if (!videojs.getComponent("AnyTogetherQualityMenuItem")) {
    class AnyTogetherQualityMenuItem extends MenuItem {
      constructor(menuPlayer, options = {}) {
        super(menuPlayer, {
          ...options,
          selectable: true,
          selected: options.qualityValue === state.videoQualitySelection
        });
        this.qualityValue = options.qualityValue || "auto";
      }

      handleClick(event) {
        super.handleClick(event);
        state.videoQualitySelection = this.qualityValue;
        applyVideoJsQualitySelection(this.qualityValue);
        updateVideoJsQualityButton();
        logEvent("Video quality selected", {
          quality: this.qualityValue === "auto" ? "Auto" : `${this.qualityValue}p`
        });
      }
    }

    videojs.registerComponent("AnyTogetherQualityMenuItem", AnyTogetherQualityMenuItem);
  }

  if (!videojs.getComponent("AnyTogetherQualityMenuButton")) {
    class AnyTogetherQualityMenuButton extends MenuButton {
      constructor(menuPlayer, options = {}) {
        super(menuPlayer, options);
        this.controlText("Quality");
      }

      buildCSSClass() {
        return `${super.buildCSSClass()} vjs-quality-menu-button`;
      }

      createEl() {
        const el = super.createEl();
        const label = document.createElement("span");
        label.className = "vjs-quality-menu-label";
        label.textContent = "Auto";
        el.append(label);
        this.qualityLabel = label;
        return el;
      }

      createItems() {
        const Item = videojs.getComponent("AnyTogetherQualityMenuItem");
        const options = getVideoJsQualityOptions(this.player());
        const items = [
          new Item(this.player(), {
            label: "Auto",
            qualityValue: "auto",
            selected: state.videoQualitySelection === "auto"
          })
        ];

        options.forEach((option) => {
          items.push(new Item(this.player(), {
            label: option.label,
            qualityValue: option.value,
            selected: state.videoQualitySelection === option.value
          }));
        });

        return items;
      }

      update() {
        const result = super.update();
        const selection = state.videoQualitySelection;
        if (this.qualityLabel) {
          this.qualityLabel.textContent = selection === "auto" ? "Auto" : `${selection}p`;
        }
        return result;
      }
    }

    videojs.registerComponent("AnyTogetherQualityMenuButton", AnyTogetherQualityMenuButton);
  }

  state.videoQualityMenu = player.controlBar.addChild("AnyTogetherQualityMenuButton", {}, player.controlBar.children().length - 1);

  const refreshQualityMenu = () => {
    applyVideoJsQualitySelection();
    updateVideoJsQualityButton();
  };

  player.on("loadedmetadata", refreshQualityMenu);
  player.on("loadeddata", refreshQualityMenu);
  player.on("loadstart", () => {
    state.videoQualitySelection = "auto";
    updateVideoJsQualityButton();
  });

  const levels = getVideoJsQualityLevels(player);
  if (levels) {
    if (typeof levels.on === "function") {
      levels.on("addqualitylevel", refreshQualityMenu);
      levels.on("change", updateVideoJsQualityButton);
    } else if (typeof levels.addEventListener === "function") {
      levels.addEventListener("addqualitylevel", refreshQualityMenu);
      levels.addEventListener("change", updateVideoJsQualityButton);
    }
  }

  updateVideoJsQualityButton();
}

function initializeVideoPlayer() {
  if (!window.videojs || state.videoPlayer) {
    return state.videoPlayer;
  }

  state.videoPlayer = window.videojs(elements.player, {
    controls: true,
    fluid: true,
    responsive: true,
    preload: "auto",
    liveui: true,
    inactivityTimeout: 1200,
    playbackRates: [0.5, 0.75, 1, 1.25, 1.5, 2],
    html5: {
      vhs: {
        overrideNative: true,
        enableLowInitialPlaylist: false
      },
      nativeAudioTracks: false,
      nativeVideoTracks: false
    }
  });

  installVideoJsQualityMenu(state.videoPlayer);

  state.videoPlayer.on("error", () => {
    const error = state.videoPlayer?.error?.();
    logEvent("Video.js error", {
      code: error?.code || "unknown",
      message: error?.message || "unknown"
    });
  });

  return state.videoPlayer;
}

function loadPlayerSource(url, forceReload = false) {
  const player = initializeVideoPlayer();
  const source = { src: url };
  const type = getSourceType(url);

  if (type) {
    source.type = type;
  }

  if (player) {
    player.src(source);
    if (forceReload || isHlsSource(url)) {
      player.load();
    }
    return;
  }

  elements.player.src = url;
  if (forceReload) {
    elements.player.load();
  }
}

function destroyHls() {
  clearStallRecoveryTimer();

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
  state.programmaticSeekEvents = 0;
  state.programmaticPlayEvents = 0;
  state.programmaticPauseEvents = 0;
  clearRemoteSeekSettlement();
  state.remoteSeekActivityAt = 0;
  clearPendingSeekCommitTimer();

  loadPlayerSource(sourceUrl, true);

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
  state.programmaticSeekEvents = 0;
  state.programmaticPlayEvents = 0;
  state.programmaticPauseEvents = 0;
  clearPendingSeekCommitTimer();

  loadPlayerSource(nextUrl, forceReload);

  logEvent("Media source loaded", {
    reason: options.reason || "manual",
    sourceUrl: nextUrl
  });
  setPlaybackState();
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
  suppressOutgoingEvents(1200);

  try {
    const mediaUrl = typeof snapshot.mediaUrl === "string" ? snapshot.mediaUrl.trim() : "";
    const currentTime = typeof snapshot.currentTime === "number" && Number.isFinite(snapshot.currentTime)
      ? Math.max(0, snapshot.currentTime)
      : null;

    if (mediaUrl) {
      const shouldReload = snapshot.lastAction === "load" || mediaUrl !== state.currentMediaUrl;
      loadSource(mediaUrl, {
        forceReload: shouldReload,
        reason: "remote",
        suppressMs: 1500
      });
    }

    if (typeof snapshot.volume === "number") {
      elements.player.volume = Math.min(1, Math.max(0, snapshot.volume));
    }

    if (typeof snapshot.muted === "boolean") {
      elements.player.muted = snapshot.muted;
    }

    if (typeof snapshot.playbackRate === "number") {
      elements.player.playbackRate = snapshot.playbackRate;
    }

    if (currentTime !== null) {
      const playerTime = Number.isFinite(elements.player.currentTime) ? elements.player.currentTime : 0;
      if (Math.abs(playerTime - currentTime) > 0.35) {
        beginRemoteSeekSettlement();
        if (typeof snapshot.paused === "boolean") {
          state.pendingPlaybackState = snapshot.paused;
        }

        if (elements.player.readyState >= 1 && !elements.player.seeking) {
          markProgrammaticSeek();
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
  state.pendingRemoteApply = snapshot;
  logEvent("Remote snapshot queued", {
    revision: typeof snapshot?.revision === "number" ? String(snapshot.revision) : "unknown",
    action: snapshot?.lastAction || "unknown",
    currentTime: typeof snapshot?.currentTime === "number" && Number.isFinite(snapshot.currentTime)
      ? snapshot.currentTime.toFixed(2)
      : "unchanged",
    paused: typeof snapshot?.paused === "boolean" ? String(snapshot.paused) : "unchanged"
  });

  if (state.remoteApplyTimer) {
    return;
  }

  state.remoteApplyTimer = setTimeout(() => {
    state.remoteApplyTimer = null;
    const nextSnapshot = state.pendingRemoteApply;
    state.pendingRemoteApply = null;
    applyRemoteState(nextSnapshot);
  }, 80);
}

function sendMessage(payload) {
  if (!state.connection || state.connection.readyState !== WebSocket.OPEN) {
    return false;
  }

  state.connection.send(JSON.stringify(payload));
  return true;
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
  if (!options.force && !canBroadcastLocalChange()) {
    return false;
  }

  const actionId = crypto.randomUUID();
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

function connectRoom() {
  if (state.connection) {
    state.connection.close();
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
  });
}

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
  state.isBuffering = false;
  resetHlsRecoveryState();
  void attemptRemoteSeekSettlement("playback-activity");
  void attemptPendingSeekCommit("playback-activity");
}

function handleWaitingLikeEvent() {
  state.isBuffering = true;
  scheduleStallRecovery("waiting");
}

initializeVideoPlayer();

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
      commitSeek(elements.player.currentTime, false, "play");
    }

    setPlaybackState();
    return;
  }

  handleHlsPlayingActivity();
  setPlaybackState();

  if (isProgrammaticPlay) {
    return;
  }

  if (canBroadcastLocalChange()) {
    sendPlayerIntent("play", {
      currentTime: elements.player.currentTime
    });
  }
});

elements.player.addEventListener("pause", () => {
  const isProgrammaticPause = consumeProgrammaticPlaybackEvent(true);

  if (state.seekGestureActive || state.isBuffering || state.pendingSeekTimer || state.pendingSeekTarget !== null) {
    if (isProgrammaticPause) {
      handleHlsPlayingActivity();
    } else {
      commitSeek(elements.player.currentTime, true, "pause");
    }

    setPlaybackState();
    return;
  }

  handleHlsPlayingActivity();
  setPlaybackState();

  if (isProgrammaticPause) {
    return;
  }

  if (canBroadcastLocalChange()) {
    sendPlayerIntent("pause", {
      currentTime: elements.player.currentTime
    });
  }
});

elements.player.addEventListener("seeking", () => {
  if (consumeProgrammaticSeekEvent()) {
    return;
  }

  acknowledgeLocalSeek();
});

elements.player.addEventListener("seeked", () => {
  if (consumeProgrammaticSeekEvent()) {
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
    markProgrammaticSeek();
    elements.player.currentTime = Math.max(0, state.pendingSeek);
    state.pendingSeek = null;
  }

  if (state.pendingPlaybackState !== null && !state.pendingSeekIsRemote) {
    applyPlaybackState(state.pendingPlaybackState);
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
  if (canBroadcastLocalChange()) {
    sendPlayerIntent("volumechange", {
      volume: elements.player.volume,
      muted: elements.player.muted
    });
  }

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
