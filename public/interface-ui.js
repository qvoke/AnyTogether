const STORAGE_KEYS = {
  users: "anyTogether.ui.users",
  sessions: "anyTogether.ui.sessions",
  currentToken: "anyTogether.ui.currentToken",
  rooms: "anyTogether.ui.rooms",
  joinedRooms: "anyTogether.ui.joinedRooms",
  activeRoomId: "anyTogether.ui.activeRoomId",
  nickname: "anyTogether.ui.nickname",
  role: "anyTogether.ui.role",
  backendBaseUrl: "anyTogether.backendUrl"
};

const params = new URLSearchParams(window.location.search);
const requestedPage = params.get("page");
const requestedRoom = params.get("room");
const requestedRole = params.get("role");

const backendBaseUrl = window.location.origin;
const clientId = crypto.randomUUID();

const body = document.body;
const pageMode =
  requestedPage === "rooms" || window.location.pathname.replace(/\/+$/, "").endsWith("/rooms")
    ? "rooms"
    : requestedRoom
      ? "room"
      : "home";

const elements = {
  homeLink: document.getElementById("homeLink"),
  roomsLink: document.getElementById("roomsLink"),
  lastRoomButton: document.getElementById("lastRoomButton"),
  topbarRoomCodeButton: document.getElementById("topbarRoomCodeButton"),
  topbarRoomCodeValue: document.getElementById("topbarRoomCodeValue"),
  topbarUser: document.getElementById("topbarUser"),
  topbarNickDisplay: document.getElementById("topbarNickDisplay"),
  topbarAvatar: document.getElementById("topbarAvatar"),
  signOutButton: document.getElementById("signOutButton"),
  reconnectButton: document.getElementById("reconnectButton"),

  joinView: document.getElementById("joinView"),
  dashboardView: document.getElementById("dashboardView"),
  roomsView: document.getElementById("roomsView"),
  guestIdentityCard: document.getElementById("guestIdentityCard"),

  nicknameInput: document.getElementById("nicknameInput"),
  homeSignInButton: document.getElementById("homeSignInButton"),
  homeSignUpButton: document.getElementById("homeSignUpButton"),
  createRoomButton: document.getElementById("createRoomButton"),
  createdRoomCodeButton: document.getElementById("createdRoomCodeButton"),
  createdRoomCodeValue: document.getElementById("createdRoomCodeValue"),
  createHint: document.getElementById("createHint"),
  roomCodeInput: document.getElementById("roomCodeInput"),
  joinRoomButton: document.getElementById("joinRoomButton"),
  joinHint: document.getElementById("joinHint"),

  activeRoomTitle: document.getElementById("activeRoomTitle"),
  activeRoomCodeButton: document.getElementById("activeRoomCodeButton"),
  activeRoomCodeValue: document.getElementById("activeRoomCodeValue"),
  activeRoomCodeToggleButton: document.getElementById("activeRoomCodeToggleButton"),
  roomStatus: document.getElementById("roomStatus"),
  sessionDuration: document.getElementById("sessionDuration"),
  leaveRoomButton: document.getElementById("leaveRoomButton"),
  deleteActiveRoomButton: document.getElementById("deleteActiveRoomButton"),
  searchInput: document.getElementById("searchInput"),
  searchButton: document.getElementById("searchButton"),
  searchHelpButton: document.getElementById("searchHelpButton"),
  searchHint: document.getElementById("searchHint"),
  participantsList: document.getElementById("participantsList"),
  chatMessages: document.getElementById("chatMessages"),
  chatForm: document.getElementById("chatForm"),
  chatInput: document.getElementById("chatInput"),
  chatSendButton: document.getElementById("chatSendButton"),
  addToPlaylistButton: document.getElementById("addToPlaylistButton"),
  suggestButton: document.getElementById("suggestButton"),
  playlistList: document.getElementById("playlistList"),

  seriesPanel: document.getElementById("seriesPanel"),
  seriesTitleEl: document.getElementById("seriesTitle"),
  seriesMetaEl: document.getElementById("seriesMeta"),
  seasonPicker: document.getElementById("seasonPicker"),
  seasonPickerValue: document.getElementById("seasonPickerValue"),
  seasonButtonsEl: document.getElementById("seasonButtons"),
  episodePicker: document.getElementById("episodePicker"),
  episodePickerValue: document.getElementById("episodePickerValue"),
  seriesEpisodesEl: document.getElementById("seriesEpisodes"),
  translatorPicker: document.getElementById("translatorPicker"),
  translatorPickerValue: document.getElementById("translatorPickerValue"),
  translatorButtonsEl: document.getElementById("translatorButtons"),

  roomsAuthGate: document.getElementById("roomsAuthGate"),
  authTitle: document.getElementById("authTitle"),
  authPrompt: document.getElementById("authPrompt"),
  authForm: document.getElementById("authForm"),
  authNameField: document.getElementById("authNameField"),
  authEmailField: document.getElementById("authEmailField"),
  authNameInput: document.getElementById("authNameInput"),
  authIdentifierInput: document.getElementById("authIdentifierInput"),
  authEmailInput: document.getElementById("authEmailInput"),
  authPasswordInput: document.getElementById("authPasswordInput"),
  forgotPasswordButton: document.getElementById("forgotPasswordButton"),
  authToggleButton: document.getElementById("authToggleButton"),
  authSubmitButton: document.getElementById("authSubmitButton"),
  authStatus: document.getElementById("authStatus"),
  googleSignInButton: document.getElementById("googleSignInButton"),
  appleSignInButton: document.getElementById("appleSignInButton"),
  roomsHeader: document.getElementById("roomsHeader"),
  roomsSignedInBar: document.getElementById("roomsSignedInBar"),
  signedInName: document.getElementById("signedInName"),
  roomsJoinInput: document.getElementById("roomsJoinInput"),
  roomsJoinButton: document.getElementById("roomsJoinButton"),
  refreshRoomsButton: document.getElementById("refreshRoomsButton"),
  roomsCreateButton: document.getElementById("roomsCreateButton"),
  roomsGrid: document.getElementById("roomsGrid")
};

const EXTENSION_SEARCH_REQUEST = "WT_SEARCH_REQUEST";
const EXTENSION_RESOLVE_REQUEST = "WT_RESOLVE_REQUEST";
const PAGE_EVENT_MEDIA_FOUND = "WT_MEDIA_FOUND";
const PAGE_EVENT_EXTENSION_STATUS = "WT_EXTENSION_STATUS";
const PAGE_EVENT_EXTENSION_ERROR = "WT_EXTENSION_ERROR";

const state = {
  authMode: new URLSearchParams(window.location.search).get("auth") === "signup" ? "signup" : "signin",
  currentToken: loadStoredValue(STORAGE_KEYS.currentToken),
  currentUser: null,
  joinedRooms: loadJson(STORAGE_KEYS.joinedRooms, []),
  activeRoomId: normalizeRoomCode(requestedRoom || loadStoredValue(STORAGE_KEYS.activeRoomId)),
  roomStates: new Map(),
  roomsDirectory: [],
  loadingRooms: false,
  connected: false,
  ws: null
};

let currentRole = "guest";
let roomCodeHidden = false;
let pendingSearchStatusTimer = null;
const pendingRoomJoins = new Set();

function loadJson(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function loadStoredValue(key) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function saveJson(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {}
}

function storeValue(key, value) {
  try {
    if (value == null) {
      localStorage.removeItem(key);
      return;
    }
    localStorage.setItem(key, String(value));
  } catch {}
}

function normalizeRoomCode(roomCode) {
  const normalized = String(roomCode || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9-]/g, "");
  return normalized || null;
}

function normalizeNickname(value) {
  const nickname = String(value || "").trim().slice(0, 40);
  return nickname || "Guest";
}

function normalizeRole(value) {
  return String(value || "").trim().toLowerCase() === "host" ? "host" : "guest";
}

function normalizeEmail(value) {
  return String(value || "").trim().toLowerCase();
}

function getRoomsArray() {
  return Array.from(state.roomStates.values());
}

function getRoomState(roomId) {
  const normalized = normalizeRoomCode(roomId);
  return normalized ? state.roomStates.get(normalized) || null : null;
}

function getActiveRoomState() {
  return getRoomState(state.activeRoomId);
}

function getActiveUiState() {
  const roomState = getActiveRoomState();
  return roomState?.ui || { seasonId: null, episodeId: null, translatorId: null, qualityLabel: "Auto" };
}

function ensureRoomState(roomId) {
  const normalized = normalizeRoomCode(roomId);
  if (!normalized) return null;

  const existing = state.roomStates.get(normalized);
  if (existing) return existing;

  const createdAt = Date.now();
  const room = {
    code: normalized,
    title: `Room ${normalized}`,
    createdAt,
    sessionStartedAt: createdAt,
    lastUpdatedAt: createdAt,
    participants: [],
    chat: [],
    playlist: [],
    currentMedia: null,
    currentPlayback: { state: "paused", time: 0 },
    ui: {
      seasonId: null,
      episodeId: null,
      translatorId: null,
      qualityLabel: "Auto"
    }
  };

  state.roomStates.set(normalized, room);
  return room;
}

function saveJoinedRooms() {
  saveJson(STORAGE_KEYS.joinedRooms, uniqueRoomCodes(state.joinedRooms));
}

function uniqueRoomCodes(roomCodes) {
  return [...new Set((Array.isArray(roomCodes) ? roomCodes : []).map(normalizeRoomCode).filter(Boolean))];
}

function getAuthToken() {
  return state.currentToken;
}

function storeAuthToken(token) {
  state.currentToken = token;
  storeValue(STORAGE_KEYS.currentToken, token);
}

function getAuthHeaders() {
  const token = getAuthToken();
  return token ? { "Authorization": `Bearer ${token}` } : {};
}

function resolveBackendBaseUrl(endpointPath = "") {
  const stored = localStorage.getItem(STORAGE_KEYS.backendBaseUrl);
  const base = stored ? stored.trim() : backendBaseUrl;
  return base.replace(/\/+$/, "") + "/" + endpointPath.replace(/^\/+/, "");
}

function resolveBackendWsUrl(wsPath = "") {
  const base = resolveBackendBaseUrl(wsPath);
  return base.replace(/^http:/i, "ws:").replace(/^https:/i, "wss:");
}

async function apiRequest(endpointPath, options = {}) {
  const url = resolveBackendBaseUrl(endpointPath);
  const headers = {
    ...getAuthHeaders(),
    ...options.headers
  };

  if (options.json != null) {
    headers["Content-Type"] = "application/json";
    options.body = JSON.stringify(options.json);
  }

  return fetch(url, {
    ...options,
    headers
  });
}

function getActiveSeason() {
  const roomState = getActiveRoomState();
  const seriesContext = roomState?.currentMedia?.seriesContext;
  if (!roomState || !seriesContext) return null;

  const ui = getActiveUiState();
  const seasons = Array.isArray(seriesContext.seasons) ? seriesContext.seasons : [];
  if (seasons.length < 1) return null;

  const activeSeason = seasons.find((season) => season.seasonId === ui.seasonId) || seasons[0];
  if (activeSeason && ui.seasonId !== activeSeason.seasonId) {
    roomState.ui.seasonId = activeSeason.seasonId;
  }
  return activeSeason;
}

function getTranslators() {
  const activeSeason = getActiveSeason();
  return Array.isArray(activeSeason?.translators) ? activeSeason.translators : [];
}

function getSelectedEpisodeForActions() {
  const activeSeason = getActiveSeason();
  const activeSeasonEpisodes = activeSeason?.episodes || [];
  if (activeSeasonEpisodes.length < 1) return null;

  const ui = getActiveUiState();
  const selected = activeSeasonEpisodes.find((episode) => episode.episodeId === ui.episodeId) || activeSeasonEpisodes[0];
  const roomState = getActiveRoomState();
  if (selected && roomState && ui.episodeId !== selected.episodeId) {
    roomState.ui.episodeId = selected.episodeId;
  }
  return selected;
}

function getSelectedTranslatorTitle() {
  const ui = getActiveUiState();
  const translators = getTranslators();
  const selected = translators.find((translator) => translator.translatorId === ui.translatorId) || translators[0];
  return selected?.title || "";
}

function formatRelativeTime(timestamp) {
  const diff = Date.now() - Number(timestamp);
  if (Number.isNaN(diff) || diff < 0) return "just now";
  const seconds = Math.floor(diff / 1000);
  if (seconds < 45) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 45) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 22) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function formatDuration(ms) {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const hrs = Math.floor(totalSeconds / 3600);
  const mins = Math.floor((totalSeconds % 3600) / 60);
  const secs = totalSeconds % 60;
  return [
    String(hrs).padStart(2, "0"),
    String(mins).padStart(2, "0"),
    String(secs).padStart(2, "0")
  ].join(":");
}

function formatClock(timestamp) {
  const date = timestamp ? new Date(Number(timestamp)) : new Date();
  if (Number.isNaN(date.getTime())) return "00:00";
  return [
    String(date.getHours()).padStart(2, "0"),
    String(date.getMinutes()).padStart(2, "0")
  ].join(":");
}

function promoteToHost() {
  currentRole = "host";
  storeValue(STORAGE_KEYS.role, currentRole);
  const roleSelect = document.getElementById("roleSelect");
  if (roleSelect) {
    roleSelect.value = "host";
  }
}

function applyRoleChange(role) {
  const normalized = normalizeRole(role);
  currentRole = normalized;
  storeValue(STORAGE_KEYS.role, normalized);
  const roleSelect = document.getElementById("roleSelect");
  if (roleSelect) {
    roleSelect.value = normalized;
  }
  updateSearchControls();
  renderParticipants();
}

function setJoinHint(message, isError = false) {
  if (!elements.joinHint) return;
  elements.joinHint.textContent = message;
  elements.joinHint.className = isError ? "hint error" : "hint";
}

function setCreateHint(message, isError = false) {
  if (!elements.createHint) return;
  elements.createHint.textContent = message;
  elements.createHint.className = isError ? "hint error" : "hint";
}

function setSearchHint(message, isError = false) {
  if (!elements.searchHint) return;
  elements.searchHint.textContent = message;
  elements.searchHint.className = isError ? "hint error" : "hint";
}

function setRoomStatus(message, isError = false) {
  if (!elements.roomStatus) return;
  elements.roomStatus.textContent = message;
  elements.roomStatus.className = isError ? "hint error" : "hint";
}

function setAuthStatus(message, isError = false) {
  if (!elements.authStatus) return;
  elements.authStatus.textContent = message;
  elements.authStatus.className = isError ? "hint error" : "hint";
  elements.authStatus.classList.remove("hidden");
}

function clearPendingSearchStatusTimer() {
  if (pendingSearchStatusTimer) {
    clearTimeout(pendingSearchStatusTimer);
    pendingSearchStatusTimer = null;
  }
}

function armPendingSearchStatusTimer(query) {
  clearPendingSearchStatusTimer();
  pendingSearchStatusTimer = setTimeout(() => {
    setSearchHint(`Extension did not reply for search: "${query}". Ensure extension is installed and running.`, true);
  }, 10000);
}

function resolvePageUrl(relativePath) {
  const url = new URL(relativePath, window.location.href);
  return url.pathname + url.search;
}

function updateActiveRoomCodeControls() {
  if (!state.activeRoomId || !elements.activeRoomCodeValue) return;
  elements.activeRoomCodeValue.textContent = state.activeRoomId;
  elements.activeRoomCodeButton.classList.toggle("is-blurred", roomCodeHidden);
  if (elements.activeRoomCodeToggleButton) {
    elements.activeRoomCodeToggleButton.textContent = roomCodeHidden ? "Show" : "Hide";
  }
}

function updateTopbarRoomBadges() {
  if (!state.activeRoomId) {
    elements.topbarRoomCodeButton.classList.add("hidden");
    return;
  }

  elements.topbarRoomCodeValue.textContent = state.activeRoomId;
  elements.topbarRoomCodeButton.classList.remove("hidden");
}

function updateActiveRoomHeader() {
  if (!elements.activeRoomTitle) return;
  const roomState = getActiveRoomState();
  elements.activeRoomTitle.textContent = roomState ? roomState.title : "";
}

function updateCurrentMediaBadge() {
  const roomState = getActiveRoomState();
  const currentMediaLabel = document.getElementById("currentMediaLabel");
  if (currentMediaLabel && roomState?.currentMedia?.mediaUrl) {
    currentMediaLabel.textContent = roomState.currentMedia.title || roomState.currentMedia.mediaUrl;
  }
}

function renderTopbarUser() {
  const nickname = normalizeNickname(elements.nicknameInput.value);
  if (elements.topbarNickDisplay) {
    elements.topbarNickDisplay.textContent = nickname;
  }

  if (elements.topbarAvatar) {
    const pieces = nickname.split(/\s+/).filter(Boolean);
    const initials = pieces.length > 0 ? pieces.slice(0, 2).map(p => p.charAt(0)).join("").toUpperCase() : "G";
    elements.topbarAvatar.textContent = initials;
  }

  if (elements.signOutButton) {
    elements.signOutButton.classList.toggle("hidden", !isAuthenticated());
  }
}

function updateLastRoomButton() {
  if (!elements.lastRoomButton) return;
  const storedLast = loadStoredValue(STORAGE_KEYS.activeRoomId) || state.joinedRooms[0];
  if (storedLast && pageMode === "home") {
    elements.lastRoomButton.setAttribute("data-room", storedLast);
    elements.lastRoomButton.classList.remove("hidden");
  } else {
    elements.lastRoomButton.classList.add("hidden");
  }
}

function updateGuestIdentityCard() {
  if (!elements.guestIdentityCard) return;
  elements.guestIdentityCard.classList.toggle("hidden", isAuthenticated());
}

function sanitizeRoomUi(roomState) {
  if (!roomState.ui) {
    roomState.ui = { seasonId: null, episodeId: null, translatorId: null, qualityLabel: "Auto" };
  }

  const seriesContext = roomState.currentMedia?.seriesContext;
  if (!seriesContext) {
    roomState.ui.seasonId = null;
    roomState.ui.episodeId = null;
    roomState.ui.translatorId = null;
    return;
  }

  const seasons = Array.isArray(seriesContext.seasons) ? seriesContext.seasons : [];
  if (seasons.length < 1) return;

  const currentSeason = seasons.find((season) => season.seasonId === roomState.ui.seasonId) || seasons[0];
  roomState.ui.seasonId = currentSeason.seasonId;

  const episodes = Array.isArray(currentSeason.episodes) ? currentSeason.episodes : [];
  if (episodes.length > 0) {
    const currentEpisode = episodes.find((episode) => episode.episodeId === roomState.ui.episodeId) || episodes[0];
    roomState.ui.episodeId = currentEpisode.episodeId;
  }

  const translators = Array.isArray(currentSeason.translators) ? currentSeason.translators : [];
  if (translators.length > 0) {
    const currentTranslator = translators.find((translator) => translator.translatorId === roomState.ui.translatorId) || translators[0];
    roomState.ui.translatorId = currentTranslator.translatorId;
  }
}

function upsertRoomStateFromSnapshot(roomId, snapshot) {
  const normalized = normalizeRoomCode(roomId);
  const existing = ensureRoomState(normalized);
  const previousMediaUrl = existing.currentMedia?.mediaUrl || "";

  existing.title = snapshot.title || existing.title || `Room ${normalized}`;
  existing.createdAt = snapshot.createdAt || existing.createdAt;
  existing.sessionStartedAt = snapshot.sessionStartedAt || existing.sessionStartedAt;
  existing.lastUpdatedAt = snapshot.lastUpdatedAt || existing.lastUpdatedAt;
  existing.participants = Array.isArray(snapshot.participants) ? snapshot.participants : existing.participants;
  existing.chat = Array.isArray(snapshot.chat) ? snapshot.chat : existing.chat;
  existing.playlist = Array.isArray(snapshot.playlist) ? snapshot.playlist : existing.playlist;

  if (snapshot.currentMedia && typeof snapshot.currentMedia === "object") {
    existing.currentMedia = {
      mediaUrl: snapshot.currentMedia.mediaUrl || "",
      pageUrl: snapshot.currentMedia.pageUrl || null,
      title: snapshot.currentMedia.title || snapshot.currentMedia.seriesContext?.title || null,
      seriesContext: snapshot.currentMedia.seriesContext || null
    };
  } else {
    existing.currentMedia = null;
  }

  if (snapshot.currentPlayback && typeof snapshot.currentPlayback === "object") {
    existing.currentPlayback = {
      state: snapshot.currentPlayback.state === "playing" ? "playing" : "paused",
      time: Number.isFinite(snapshot.currentPlayback.time) ? snapshot.currentPlayback.time : 0,
      updatedAt: snapshot.currentPlayback.updatedAt || Date.now()
    };
  }

  sanitizeRoomUi(existing);
  state.roomStates.set(normalized, existing);

  return {
    roomState: existing,
    previousMediaUrl
  };
}

function applyLocalRoomJoin(roomId, roomSnapshot = null, setActive = true) {
  const normalized = normalizeRoomCode(roomId);
  if (!normalized) return;

  if (!state.joinedRooms.includes(normalized)) {
    state.joinedRooms.unshift(normalized);
  }
  state.joinedRooms = uniqueRoomCodes(state.joinedRooms);
  saveJoinedRooms();

  if (roomSnapshot) {
    upsertRoomStateFromSnapshot(normalized, roomSnapshot);
  } else {
    ensureRoomState(normalized);
  }

  if (setActive) {
    state.activeRoomId = normalized;
    storeValue(STORAGE_KEYS.activeRoomId, normalized);
  }

  refreshActiveRoom();
}

function sendWs(payload) {
  if (!state.ws || state.ws.readyState !== WebSocket.OPEN) {
    return false;
  }

  state.ws.send(JSON.stringify(payload));
  return true;
}

function ensureVisibility() {
  if (pageMode === "home") {
    elements.joinView.classList.remove("hidden");
    elements.dashboardView.classList.add("hidden");
    elements.roomsView.classList.add("hidden");
    body.dataset.view = "home";
  } else if (pageMode === "room") {
    elements.joinView.classList.add("hidden");
    elements.dashboardView.classList.remove("hidden");
    elements.roomsView.classList.add("hidden");
    body.dataset.view = "room";
  } else if (pageMode === "rooms") {
    elements.joinView.classList.add("hidden");
    elements.dashboardView.classList.add("hidden");
    elements.roomsView.classList.remove("hidden");
    body.dataset.view = "rooms";
  }
}

function updateSessionCounter() {
  const roomState = getActiveRoomState();
  if (pageMode !== "room" || !roomState || !elements.sessionDuration) return;
  const sessionStarted = roomState.sessionStartedAt || Date.now();
  elements.sessionDuration.textContent = formatDuration(Date.now() - sessionStarted);
}

function renderRoomsAuthGate() {
  if (!elements.roomsAuthGate) return;
  const isAuth = isAuthenticated();
  elements.roomsAuthGate.classList.toggle("hidden", isAuth);
  elements.roomsHeader.classList.toggle("hidden", !isAuth);
  elements.roomsSignedInBar.classList.toggle("hidden", !isAuth);
  elements.roomsGrid.classList.toggle("hidden", !isAuth);

  if (isAuth && state.currentUser) {
    elements.signedInName.textContent = state.currentUser.displayName || state.currentUser.email || "Signed in";
  }
}

function setAuthMode(mode) {
  state.authMode = mode === "signup" ? "signup" : "signin";
  elements.authTitle.textContent = state.authMode === "signup" ? "Create an account" : "Sign in to AnyTogether";
  elements.authPrompt.textContent = state.authMode === "signup" ? "Or sign up with" : "Or sign in with";
  elements.authSubmitButton.textContent = state.authMode === "signup" ? "Sign up" : "Sign in";
  elements.authToggleButton.textContent = state.authMode === "signup" ? "Already have an account? Sign in" : "No account? Sign up";

  elements.authNameField.classList.toggle("hidden", state.authMode === "signin");
  elements.authEmailField.classList.toggle("hidden", state.authMode === "signin");
}

async function signUpUser({ displayName, email, password }) {
  setAuthStatus("Signing up...");
  try {
    const response = await apiRequest("/api/auth/register", {
      method: "POST",
      json: { displayName, email, password }
    });

    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error(data.error || `Signup failed with status ${response.status}`);
    }

    const data = await response.json();
    storeAuthToken(data.token);
    setCurrentUser(data.user, data.token);

    if (state.ws && state.ws.readyState === WebSocket.OPEN) {
      sendWs({
        type: "auth:identify",
        token: data.token
      });
    }

    setAuthStatus("");
    setAuthMode("signin");
  } catch (error) {
    setAuthStatus(error.message, true);
  }
}

async function signInAccount(mode) {
  const emailVal = elements.authEmailInput.value.trim();
  const nameVal = elements.authNameInput.value.trim();
  const identVal = elements.authIdentifierInput.value.trim();
  const passVal = elements.authPasswordInput.value.trim();

  if (mode === "signup") {
    if (!nameVal || !emailVal || !passVal) {
      setAuthStatus("Fill in all fields", true);
      return;
    }
    await signUpUser({ displayName: nameVal, email: emailVal, password: passVal });
  } else {
    if (!identVal || !passVal) {
      setAuthStatus("Enter your credentials", true);
      return;
    }
    setAuthStatus("Signing in...");
    try {
      const response = await apiRequest("/api/auth/login", {
        method: "POST",
        json: { identifier: identVal, password: passVal }
      });

      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error || "Invalid username or password");
      }

      const data = await response.json();
      storeAuthToken(data.token);
      setCurrentUser(data.user, data.token);

      if (state.ws && state.ws.readyState === WebSocket.OPEN) {
        sendWs({
          type: "auth:identify",
          token: data.token
        });
      }

      setAuthStatus("");
      elements.authPasswordInput.value = "";
      elements.authIdentifierInput.value = "";
    } catch (error) {
      setAuthStatus(error.message, true);
    }
  }
}

async function signOutAccount() {
  try {
    await apiRequest("/api/auth/logout", { method: "POST" });
  } catch {}
  storeAuthToken(null);
  state.currentUser = null;
  state.roomsDirectory = [];
  if (state.ws && state.ws.readyState === WebSocket.OPEN) {
    sendWs({
      type: "auth:identify",
      token: ""
    });
  }
  authStatus.classList.add("hidden");
  setAuthMode("signin");
  renderRoomsAuthGate();
  renderRoomsDirectory();
  renderTopbarUser();
  updateGuestIdentityCard();
}

async function createRoom() {
  promoteToHost();
  syncProfile();
  setCreateHint("Creating a room...");

  try {
    const response = await apiRequest("/api/rooms", {
      method: "POST",
      json: {
        title: `${normalizeNickname(elements.nicknameInput.value)}'s room`
      }
    });

    if (!response.ok) {
      throw new Error(`Create room failed with ${response.status}`);
    }

    const data = await response.json();
    const roomCode = normalizeRoomCode(data.room?.code);
    if (!roomCode) {
      throw new Error("Server returned an invalid room code");
    }

    applyLocalRoomJoin(roomCode, data.room || null, true);
    elements.createdRoomCodeValue.textContent = roomCode;
    elements.createdRoomCodeButton.classList.remove("hidden");
    sendJoinMessage(roomCode);
    setCreateHint(`Room created: ${roomCode}`);
    window.location.href = resolvePageUrl(`./?room=${encodeURIComponent(roomCode)}`);
    if (isAuthenticated()) {
      await fetchRoomsDirectory();
    }
  } catch (error) {
    setCreateHint(error.message, true);
  }
}

async function handleRoomJoin(roomCode, options = {}) {
  const normalized = normalizeRoomCode(roomCode);
  if (!normalized) {
    setJoinHint("Enter a room code", true);
    return false;
  }

  syncProfile();
  applyLocalRoomJoin(normalized, null, options.setActive !== false);
  sendJoinMessage(normalized);
  if (isAuthenticated()) {
    fetchRoomsDirectory();
  }

  if (options.navigateHome) {
    window.location.href = resolvePageUrl(`./?room=${encodeURIComponent(normalized)}`);
  }

  return true;
}

function sendJoinMessage(roomId) {
  const normalized = normalizeRoomCode(roomId);
  if (!normalized) return false;

  if (!state.ws || state.ws.readyState !== WebSocket.OPEN) {
    pendingRoomJoins.add(normalized);
    return false;
  }

  state.ws.send(
    JSON.stringify({
      type: "room:join",
      roomId: normalized,
      nickname: normalizeNickname(elements.nicknameInput.value),
      role: currentRole,
      clientId
    })
  );
  pendingRoomJoins.delete(normalized);
  return true;
}

function bridgeToSyncEngine() {
  const roomInput = document.getElementById("roomInput");
  const displayNameInput = document.getElementById("displayName");
  const roleSelect = document.getElementById("roleSelect");
  const connectButton = document.getElementById("connectButton");

  if (roomInput && displayNameInput && roleSelect && connectButton) {
    let changed = false;
    const nextRoom = state.activeRoomId || "";
    const nextName = normalizeNickname(elements.nicknameInput.value);
    const nextRole = currentRole || "guest";

    if (roomInput.value !== nextRoom) {
      roomInput.value = nextRoom;
      changed = true;
    }
    if (displayNameInput.value !== nextName) {
      displayNameInput.value = nextName;
      changed = true;
    }
    if (roleSelect.value !== nextRole) {
      roleSelect.value = nextRole;
      changed = true;
    }

    if (changed && nextRoom) {
      connectButton.click();
    }
  }
}

function applyRoomSnapshot(roomId, snapshot) {
  const { roomState: existing, previousMediaUrl } = upsertRoomStateFromSnapshot(roomId, snapshot);

  const activeRoomChanged = state.activeRoomId === roomId;
  if (activeRoomChanged) {
    refreshActiveRoom();
  }

  renderAll();

  if (activeRoomChanged) {
    bridgeToSyncEngine();

    const mediaChanged = previousMediaUrl !== existing.currentMedia?.mediaUrl;
    if (mediaChanged && existing.currentMedia?.mediaUrl) {
      const mediaUrlInput = document.getElementById("mediaUrl");
      const loadMediaButton = document.getElementById("loadMediaButton");
      if (mediaUrlInput && loadMediaButton && mediaUrlInput.value !== existing.currentMedia.mediaUrl) {
        mediaUrlInput.value = existing.currentMedia.mediaUrl;
        loadMediaButton.click();
      }
    }
  }
}

function refreshActiveRoom() {
  const roomState = getActiveRoomState();
  if (!roomState) {
    updateTopbarRoomBadges();
    updateActiveRoomHeader();
    updateCurrentMediaBadge();
    return;
  }

  sanitizeRoomUi(roomState);
  updateTopbarRoomBadges();
  updateActiveRoomHeader();
  updateCurrentMediaBadge();
  renderSeriesPanel();
  renderParticipants();
  renderChat();
  renderPlaylist();
  updateSessionCounter();
  updateSearchControls();
}

function renderParticipants() {
  const roomState = getActiveRoomState();
  elements.participantsList.textContent = "";

  if (!roomState?.participants?.length) {
    const placeholder = document.createElement("div");
    placeholder.className = "status";
    placeholder.textContent = "No participants yet.";
    elements.participantsList.appendChild(placeholder);
    return;
  }

  roomState.participants.forEach((participant) => {
    const item = document.createElement("div");
    item.className = "participant-item";

    const avatarWrap = document.createElement("div");
    avatarWrap.className = "participant-avatar-wrap";

    const avatar = document.createElement("div");
    avatar.className = "user-avatar participant-avatar";
    avatar.textContent = getParticipantInitials(participant);

    avatarWrap.appendChild(avatar);

    const nameRow = document.createElement("div");
    nameRow.className = "participant-name-row";

    const name = document.createElement("div");
    name.className = "participant-name";
    name.textContent = participant.nickname || "Guest";

    nameRow.appendChild(name);

    if (String(participant.role || "guest") === "host") {
      const hostBadge = document.createElement("span");
      hostBadge.className = "host-badge";
      hostBadge.textContent = "H";
      hostBadge.title = "Host";
      nameRow.appendChild(hostBadge);
    }

    item.appendChild(avatarWrap);
    item.appendChild(nameRow);
    elements.participantsList.appendChild(item);
  });
}

function getParticipantInitials(participant) {
  const source = String(participant?.nickname || participant?.displayName || "Guest").trim();
  if (!source) return "G";
  const pieces = source.split(/\s+/).filter(Boolean);
  if (!pieces.length) return "G";
  return pieces.slice(0, 2).map((piece) => piece.charAt(0)).join("").toUpperCase();
}

function renderChat() {
  const roomState = getActiveRoomState();
  elements.chatMessages.textContent = "";

  if (!roomState?.chat?.length) {
    const placeholder = document.createElement("div");
    placeholder.className = "status";
    placeholder.textContent = "No chat messages yet.";
    elements.chatMessages.appendChild(placeholder);
    return;
  }

  roomState.chat.forEach((message) => {
    const item = document.createElement("div");
    item.className = "chat-item";

    const top = document.createElement("div");
    top.className = "chat-top";

    const author = document.createElement("div");
    author.className = "chat-author";
    author.textContent = message.author?.nickname || "System";

    const meta = document.createElement("div");
    meta.className = "chat-meta";
    meta.textContent = formatClock(message.sentAt);

    top.appendChild(author);
    top.appendChild(meta);

    const body = document.createElement("div");
    body.className = "chat-body";
    body.textContent = message.text || "";

    item.appendChild(top);
    item.appendChild(body);
    elements.chatMessages.appendChild(item);
  });

  elements.chatMessages.scrollTop = elements.chatMessages.scrollHeight;
}

function renderPlaylist() {
  const roomState = getActiveRoomState();
  elements.playlistList.textContent = "";

  if (!roomState?.playlist?.length) {
    const placeholder = document.createElement("div");
    placeholder.className = "status";
    placeholder.textContent = "Playlist is empty.";
    elements.playlistList.appendChild(placeholder);
    return;
  }

  roomState.playlist.forEach((item) => {
    const card = document.createElement("div");
    card.className = "playlist-item";

    const top = document.createElement("div");
    top.className = "playlist-top";

    const title = document.createElement("div");
    title.className = "playlist-name";
    title.textContent = item.title || item.mediaUrl || "Playlist item";

    const action = document.createElement("button");
    action.type = "button";
    action.textContent = "Play";
    action.addEventListener("click", () => {
      sendWs({
        type: "playlist:activate",
        roomId: roomState.code,
        playlistItemId: item.id,
        originId: clientId
      });
    });

    top.appendChild(title);
    top.appendChild(action);

    const meta = document.createElement("div");
    meta.className = "playlist-meta";
    const addedBy = item.addedBy?.nickname || "Unknown";
    meta.textContent = `${addedBy} - ${formatRelativeTime(item.addedAt)}`;

    card.appendChild(top);
    card.appendChild(meta);
    elements.playlistList.appendChild(card);
  });
}

function renderRoomsDirectory() {
  if (pageMode === "rooms" && !isAuthenticated()) {
    elements.roomsGrid.textContent = "";
    return;
  }

  elements.roomsGrid.textContent = "";

  if (state.loadingRooms) {
    const loading = document.createElement("div");
    loading.className = "status";
    loading.textContent = "Loading rooms...";
    elements.roomsGrid.appendChild(loading);
    return;
  }

  if (!state.roomsDirectory.length) {
    const empty = document.createElement("div");
    empty.className = "status";
    empty.textContent = "No rooms are linked to your account yet.";
    elements.roomsGrid.appendChild(empty);
    return;
  }

  state.roomsDirectory.forEach((room) => {
    const card = document.createElement("div");
    card.className = "room-card";

    const top = document.createElement("div");
    top.className = "room-card-top";

    const titleBlock = document.createElement("div");
    titleBlock.className = "card-title";

    const title = document.createElement("div");
    title.className = "room-card-title";
    title.textContent = room.title || `Room ${room.code}`;

    const meta = document.createElement("div");
    meta.className = "room-card-meta";
    const currentMedia = room.currentMediaTitle || "No media";
    const memberCount = room.memberCount || 0;
    const playlistCount = room.playlistCount || 0;
    meta.textContent = `${memberCount} ${memberCount === 1 ? "user" : "users"} - ${playlistCount} playlist items - ${currentMedia}`;

    titleBlock.appendChild(title);
    titleBlock.appendChild(meta);
    top.appendChild(titleBlock);

    const actions = document.createElement("div");
    actions.className = "room-card-actions";

    const primaryButton = document.createElement("button");
    primaryButton.type = "button";
    primaryButton.textContent = "Open";
    primaryButton.addEventListener("click", () => {
      window.location.href = resolvePageUrl(`./?room=${encodeURIComponent(room.code)}`);
    });

    const copyButton = document.createElement("button");
    copyButton.type = "button";
    copyButton.textContent = "Copy code";
    copyButton.addEventListener("click", () => copyToClipboard(room.code));

    actions.appendChild(primaryButton);
    actions.appendChild(copyButton);

    const leaveButton = document.createElement("button");
    leaveButton.type = "button";
    leaveButton.textContent = "Leave";
    leaveButton.addEventListener("click", () => leaveRoom(room.code));
    actions.appendChild(leaveButton);

    const status = document.createElement("div");
    status.className = "status";
    status.dataset.sessionStartedAt = String(room.sessionStartedAt || Date.now());
    status.dataset.lastUpdatedAt = String(room.lastUpdatedAt || Date.now());
    const sessionSpan = document.createElement("span");
    sessionSpan.className = "room-card-session";
    sessionSpan.textContent = `Session ${formatDuration(Date.now() - room.sessionStartedAt)}`;
    const updatedSpan = document.createElement("span");
    updatedSpan.className = "room-card-updated";
    updatedSpan.textContent = `Updated ${formatRelativeTime(room.lastUpdatedAt)}`;
    status.appendChild(sessionSpan);
    status.appendChild(document.createTextNode(" - "));
    status.appendChild(updatedSpan);

    card.appendChild(top);
    card.appendChild(actions);
    card.appendChild(status);
    elements.roomsGrid.appendChild(card);
  });
}

function updateRoomsDirectoryClock() {
  if (pageMode !== "rooms" || !elements.roomsGrid || elements.roomsGrid.classList.contains("hidden")) return;

  elements.roomsGrid.querySelectorAll(".status[data-session-started-at]").forEach((status) => {
    const startedAt = Number(status.dataset.sessionStartedAt);
    const updatedAt = Number(status.dataset.lastUpdatedAt);
    const sessionSpan = status.querySelector(".room-card-session");
    const updatedSpan = status.querySelector(".room-card-updated");

    if (sessionSpan && Number.isFinite(startedAt)) {
      sessionSpan.textContent = `Session ${formatDuration(Date.now() - startedAt)}`;
    }
    if (updatedSpan && Number.isFinite(updatedAt)) {
      updatedSpan.textContent = `Updated ${formatRelativeTime(updatedAt)}`;
    }
  });
}

function renderAll() {
  ensureVisibility();
  updateTopbarRoomBadges();
  updateActiveRoomHeader();
  updateCurrentMediaBadge();
  updateSearchControls();
  renderTopbarUser();
  updateLastRoomButton();
  updateGuestIdentityCard();

  if (pageMode !== "rooms") {
    renderSeriesPanel();
    renderParticipants();
    renderChat();
    renderPlaylist();
    updateSessionCounter();
  }
}

function extractMediaTitleAndYearSafe(raw) {
  if (!raw) {
    return { title: "", year: "" };
  }

  const yearMatch = raw.match(/\b(19|20)\d{2}\b/);
  if (!yearMatch) {
    return { title: raw, year: "" };
  }

  const title = raw.replace(yearMatch[0], "").replace(/[()\[\]:\-]+/g, " ").replace(/\s+/g, " ").trim();
  return {
    title: title || raw,
    year: yearMatch[0]
  };
}

function renderButtonGroup(container, items, selectedValue, getValue, getLabel, onClick) {
  container.textContent = "";

  if (!items.length) {
    container.classList.remove("is-visible");
    container.closest(".series-group")?.classList.add("is-hidden");
    return;
  }

  container.classList.add("is-visible");
  container.closest(".series-group")?.classList.remove("is-hidden");

  items.forEach((item) => {
    const value = getValue(item);
    const button = document.createElement("button");
    button.type = "button";
    button.className = "chip-button";
    button.textContent = getLabel(item);

    if (String(value) === String(selectedValue)) {
      button.classList.add("is-selected");
      button.setAttribute("aria-pressed", "true");
    } else {
      button.setAttribute("aria-pressed", "false");
    }

    button.addEventListener("click", () => onClick(item));
    button.addEventListener("click", () => {
      container.closest("details")?.removeAttribute("open");
    });
    container.appendChild(button);
  });
}

function renderSeriesPanel() {
  const roomState = getActiveRoomState();
  const currentMedia = roomState?.currentMedia || null;
  const seriesContext = currentMedia?.seriesContext || null;
  const seasons = Array.isArray(seriesContext?.seasons) ? seriesContext.seasons : [];

  if (!roomState || !currentMedia) {
    elements.seriesPanel.classList.add("hidden");
    elements.seriesTitleEl.textContent = "";
    elements.seriesMetaEl.textContent = "";
    if (elements.seasonPickerValue) elements.seasonPickerValue.textContent = "";
    if (elements.episodePickerValue) elements.episodePickerValue.textContent = "";
    if (elements.translatorPickerValue) elements.translatorPickerValue.textContent = "";
    elements.seasonButtonsEl.textContent = "";
    elements.translatorButtonsEl.textContent = "";
    elements.seriesEpisodesEl.textContent = "";
    elements.seasonPicker?.removeAttribute("open");
    elements.episodePicker?.removeAttribute("open");
    elements.translatorPicker?.removeAttribute("open");
    return;
  }

  sanitizeRoomUi(roomState);

  const ui = getActiveUiState();
  const activeSeason = getActiveSeason();
  const activeSeasonEpisodes = activeSeason?.episodes || [];
  const currentSeasonId = Number(seriesContext?.currentSeasonId);
  const currentEpisodeId = Number(seriesContext?.currentEpisodeId);
  const mediaTitle = currentMedia.title || seriesContext?.title || "";
  const { title, year } = extractMediaTitleAndYearSafe(mediaTitle);
  const displayYear = Number.isFinite(Number(seriesContext?.year))
    ? String(Number(seriesContext.year))
    : year;
  const selectedSeasonTitle = activeSeason?.title || `Season ${activeSeason?.seasonId || ""}`;
  const selectedEpisode = getSelectedEpisodeForActions();
  const selectedEpisodeIndex = selectedEpisode ? activeSeasonEpisodes.indexOf(selectedEpisode) + 1 : 0;
  const selectedEpisodeTitle = selectedEpisode?.title || `Episode ${selectedEpisodeIndex > 0 ? selectedEpisodeIndex : 1}`;
  const selectedTranslatorTitle = getSelectedTranslatorTitle() || "Auto";

  elements.seriesPanel.classList.remove("hidden");
  elements.seriesTitleEl.textContent = title;
  elements.seriesMetaEl.textContent = displayYear ? `(${displayYear})` : "";
  if (elements.seasonPickerValue) elements.seasonPickerValue.textContent = selectedSeasonTitle;
  if (elements.episodePickerValue) elements.episodePickerValue.textContent = selectedEpisodeTitle;
  if (elements.translatorPickerValue) elements.translatorPickerValue.textContent = selectedTranslatorTitle;

  if (!seriesContext || seasons.length < 1) {
    elements.seasonButtonsEl.textContent = "";
    elements.translatorButtonsEl.textContent = "";
    elements.seriesEpisodesEl.textContent = "";
    elements.seasonButtonsEl.closest(".series-group")?.classList.add("is-hidden");
    elements.translatorButtonsEl.closest(".series-group")?.classList.add("is-hidden");
    elements.seriesEpisodesEl.closest(".series-group")?.classList.add("is-hidden");
    elements.seasonPicker?.removeAttribute("open");
    elements.episodePicker?.removeAttribute("open");
    elements.translatorPicker?.removeAttribute("open");
    return;
  }

  renderButtonGroup(
    elements.seasonButtonsEl,
    seasons,
    ui.seasonId,
    (season) => season.seasonId,
    (season) => season.title || `Season ${season.seasonId}`,
    (season) => {
      roomState.ui.seasonId = season.seasonId;
      const nextEpisode = Array.isArray(season.episodes) ? season.episodes[0] : null;
      roomState.ui.episodeId = nextEpisode?.episodeId ?? null;
      renderSeriesPanel();
      if (nextEpisode) {
        requestEpisodeResolution(nextEpisode, {
          translatorId: roomState.ui.translatorId,
          qualityLabel: roomState.ui.qualityLabel
        });
      }
    }
  );

  renderButtonGroup(
    elements.translatorButtonsEl,
    getTranslators(),
    ui.translatorId,
    (translator) => translator.translatorId,
    (translator) => translator.title,
    (translator) => {
      roomState.ui.translatorId = translator.translatorId;
      renderSeriesPanel();
      const selectedEpisode = getSelectedEpisodeForActions();
      if (selectedEpisode) {
        requestEpisodeResolution(selectedEpisode, {
          translatorId: roomState.ui.translatorId,
          qualityLabel: roomState.ui.qualityLabel
        });
      }
    }
  );

  elements.seriesEpisodesEl.textContent = "";
  if (activeSeasonEpisodes.length < 1) {
    elements.seriesEpisodesEl.classList.remove("is-visible");
    return;
  }

  elements.seriesEpisodesEl.classList.add("is-visible");

  activeSeasonEpisodes.forEach((episode, index) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "series-episode-button";
    button.setAttribute("role", "listitem");
    button.textContent = `Episode ${index + 1}`;

    if (activeSeason.seasonId === currentSeasonId && episode.episodeId === currentEpisodeId) {
      button.classList.add("is-selected");
      button.setAttribute("aria-pressed", "true");
    } else {
      button.setAttribute("aria-pressed", "false");
    }

    button.addEventListener("click", () => {
      roomState.ui.seasonId = episode.seasonId;
      roomState.ui.episodeId = episode.episodeId;
      requestEpisodeResolution(episode, {
        translatorId: roomState.ui.translatorId,
        qualityLabel: roomState.ui.qualityLabel
      });
    });

    elements.seriesEpisodesEl.appendChild(button);
  });
}

function updateSearchControls() {
  const roomState = getActiveRoomState();
  const canSearch = currentRole === "host" && Boolean(roomState);
  elements.searchButton.disabled = !canSearch;
  elements.addToPlaylistButton.disabled = !roomState?.currentMedia?.mediaUrl;
  elements.suggestButton.disabled = !roomState?.currentMedia?.mediaUrl;
  elements.chatSendButton.disabled = !roomState;
  elements.leaveRoomButton.disabled = !roomState;
  elements.deleteActiveRoomButton.classList.toggle("hidden", !(roomState && currentRole === "host"));

  if (!roomState) {
    setSearchHint("Join or create a room to use playback controls.");
    elements.searchHint.classList.remove("hidden");
    return;
  }

  if (currentRole !== "host") {
    setSearchHint("Only the host can trigger search.");
    elements.searchHint.classList.remove("hidden");
    return;
  }

  setSearchHint("");
  elements.searchHint.classList.add("hidden");
}

function copyToClipboard(value) {
  if (!value) return;

  navigator.clipboard.writeText(value).then(() => {
    setRoomStatus(`Copied room code ${value}`);
    setJoinHint(`Copied room code ${value}`);
  }).catch(() => {
    setRoomStatus("Clipboard access failed", true);
  });
}

function getRoomExitUrl() {
  return resolvePageUrl(isAuthenticated() ? "./?page=rooms" : "./");
}

function leaveRoom(roomId) {
  const normalized = normalizeRoomCode(roomId);
  if (!normalized) return;

  if (state.joinedRooms.includes(normalized)) {
    state.joinedRooms = state.joinedRooms.filter((item) => item !== normalized);
  }

  sendWs({
    type: "room:leave",
    roomId: normalized,
    originId: clientId
  });

  if (state.activeRoomId === normalized) {
    state.activeRoomId = state.joinedRooms[0] || null;
  }

  saveJoinedRooms();
  if (state.activeRoomId) {
    refreshActiveRoom();
  }

  renderAll();
  window.location.href = getRoomExitUrl();
  if (isAuthenticated()) {
    fetchRoomsDirectory();
  }
}

async function deleteRoom(roomId) {
  const normalized = normalizeRoomCode(roomId);
  if (!normalized) return;

  if (currentRole !== "host") {
    setRoomStatus("Only the host can delete a room.", true);
    return;
  }

  const confirmed = window.confirm(`Delete room ${normalized}?`);
  if (!confirmed) return;

  try {
    const response = await apiRequest(`/api/rooms/${encodeURIComponent(normalized)}`, {
      method: "DELETE"
    });

    if (!response.ok) {
      throw new Error(`Delete room failed with ${response.status}`);
    }

    if (state.joinedRooms.includes(normalized)) {
      state.joinedRooms = state.joinedRooms.filter((item) => item !== normalized);
    }

    if (state.activeRoomId === normalized) {
      state.activeRoomId = state.joinedRooms[0] || null;
    }

    state.roomStates.delete(normalized);
    saveJoinedRooms();

    if (state.activeRoomId) {
      refreshActiveRoom();
    }

    await fetchRoomsDirectory();
    renderAll();
    setRoomStatus(`Deleted room ${normalized}`);
    window.location.href = getRoomExitUrl();
  } catch (error) {
    setRoomStatus(error.message, true);
  }
}

function syncProfile() {
  const nickname = normalizeNickname(elements.nicknameInput.value);
  elements.nicknameInput.value = nickname;
  storeValue(STORAGE_KEYS.nickname, nickname);
  storeValue(STORAGE_KEYS.role, currentRole);
  renderTopbarUser();

  if (state.ws && state.ws.readyState === WebSocket.OPEN) {
    state.joinedRooms.forEach((roomId) => {
      sendWs({
        type: "room:profile",
        roomId,
        nickname,
        role: currentRole,
        clientId
      });
    });
  }

  bridgeToSyncEngine();
}

async function fetchRoomsDirectory() {
  state.loadingRooms = true;
  renderRoomsAuthGate();

  if (pageMode === "rooms" && !isAuthenticated()) {
    state.roomsDirectory = [];
    state.loadingRooms = false;
    renderRoomsDirectory();
    renderRoomsAuthGate();
    return;
  }

  try {
    const endpoint = isAuthenticated() ? "/api/me/rooms" : "/api/rooms";
    const response = await apiRequest(endpoint, { cache: "no-store" });
    if (!response.ok) {
      if (response.status === 401 && isAuthenticated()) {
        storeAuthToken(null);
        state.currentUser = null;
        renderRoomsAuthGate();
        return;
      }
      throw new Error(`Room directory request failed with ${response.status}`);
    }

    const data = await response.json();
    state.roomsDirectory = Array.isArray(data.rooms) ? data.rooms : [];
    if (data.user) {
      state.currentUser = data.user;
    }
  } catch (error) {
    state.roomsDirectory = [];
    if (pageMode === "rooms" && isAuthenticated()) {
      elements.roomsGrid.textContent = "";
      const errorBox = document.createElement("div");
      errorBox.className = "status";
      errorBox.textContent = `Failed to load rooms: ${error.message}`;
      elements.roomsGrid.appendChild(errorBox);
    }
  } finally {
    state.loadingRooms = false;
    renderRoomsAuthGate();
    renderRoomsDirectory();
  }
}

async function hydrateAuthSession() {
  const token = getAuthToken();
  if (!token) {
    state.currentUser = null;
    renderRoomsAuthGate();
    return;
  }

  try {
    const response = await apiRequest("/api/auth/me");
    if (!response.ok) {
      throw new Error("Invalid session token");
    }

    const data = await response.json();
    setCurrentUser(data.user, token);
  } catch {
    storeAuthToken(null);
    state.currentUser = null;
    renderRoomsAuthGate();
  }
}

function setCurrentUser(user, token = null) {
  state.currentUser = user || null;
  state.currentToken = token;
  storeAuthToken(token);
  renderTopbarUser();
  renderRoomsAuthGate();
}

function updateRoomFromMediaPayload(roomId, payload, shouldBroadcast) {
  const normalized = normalizeRoomCode(roomId);
  if (!normalized) return;

  const roomState = ensureRoomState(normalized);
  roomState.currentMedia = {
    mediaUrl: payload.mediaUrl,
    pageUrl: payload.pageUrl || null,
    title: payload.title || payload.seriesContext?.title || null,
    seriesContext: payload.seriesContext || null,
    updatedAt: Date.now(),
    addedToPlaylistId: payload.addedToPlaylistId || null
  };
  sanitizeRoomUi(roomState);
  state.roomStates.set(normalized, roomState);

  if (state.activeRoomId === normalized) {
    refreshActiveRoom();

    const mediaUrlInput = document.getElementById("mediaUrl");
    const loadMediaButton = document.getElementById("loadMediaButton");
    if (mediaUrlInput && loadMediaButton && mediaUrlInput.value !== payload.mediaUrl) {
      mediaUrlInput.value = payload.mediaUrl;
      loadMediaButton.click();
    }
  }

  if (shouldBroadcast) {
    sendWs({
      type: "media:set",
      roomId: normalized,
      mediaUrl: payload.mediaUrl,
      pageUrl: payload.pageUrl || null,
      title: payload.title || payload.seriesContext?.title || null,
      seriesContext: payload.seriesContext || null,
      originId: clientId
    });
  }
}

function getEpisodeTargetForRequest(targetEpisode) {
  if (!targetEpisode) return null;
  return {
    seasonId: targetEpisode.seasonId,
    episodeId: targetEpisode.episodeId
  };
}

function requestEpisodeResolution(targetEpisode, overrides = {}) {
  const roomId = state.activeRoomId;
  const roomState = roomId ? getRoomState(roomId) : null;
  const seriesContext = roomState?.currentMedia?.seriesContext || null;
  const pageUrl = roomState?.currentMedia?.pageUrl || roomState?.currentMedia?.mediaUrl || null;

  if (!roomId || !seriesContext) {
    setSearchHint("Load a series before switching episodes.", true);
    return;
  }

  const payload = {
    pageUrl,
    roomId,
    seriesContext,
    targetEpisode: getEpisodeTargetForRequest(targetEpisode)
  };

  if (overrides.translatorId != null) {
    payload.selectedTranslatorId = overrides.translatorId;
  }

  if (overrides.qualityLabel) {
    payload.selectedQualityLabel = overrides.qualityLabel;
  }

  window.postMessage(
    {
      type: EXTENSION_RESOLVE_REQUEST,
      payload
    },
    "*"
  );

  setSearchHint(`Loading episode: S${targetEpisode.seasonId} E${targetEpisode.episodeId}`);
}

function sendSearchToExtension(query) {
  const roomId = state.activeRoomId;
  if (!roomId) {
    setSearchHint("Join or create a room first.", true);
    return;
  }

  setSearchHint(`Searching for "${query}"...`);
  armPendingSearchStatusTimer(query);

  window.postMessage(
    {
      type: EXTENSION_SEARCH_REQUEST,
      payload: { query, roomId }
    },
    "*"
  );

  setSearchHint(`Search request sent: ${query}`);
}

function addCurrentMediaToPlaylist() {
  const roomId = state.activeRoomId;
  const roomState = getActiveRoomState();
  const currentMedia = roomState?.currentMedia;

  if (!roomId || !currentMedia?.mediaUrl) {
    setRoomStatus("Load media before adding it to the playlist.", true);
    return;
  }

  sendWs({
    type: "playlist:add",
    roomId,
    nickname: normalizeNickname(elements.nicknameInput.value),
    role: currentRole,
    item: {
      title: currentMedia.title || currentMedia.seriesContext?.title || currentMedia.mediaUrl,
      mediaUrl: currentMedia.mediaUrl,
      pageUrl: currentMedia.pageUrl || null,
      seriesContext: currentMedia.seriesContext || null
    },
    originId: clientId
  });

  setRoomStatus("Added the current item to the playlist.");
}

function suggestCurrentMedia() {
  const roomId = state.activeRoomId;
  const roomState = getActiveRoomState();
  const currentMedia = roomState?.currentMedia;

  if (!roomId || !currentMedia?.mediaUrl) {
    setRoomStatus("Load media before suggesting it.", true);
    return;
  }

  sendWs({
    type: "playlist:suggest",
    roomId,
    nickname: normalizeNickname(elements.nicknameInput.value),
    role: currentRole,
    item: {
      title: currentMedia.title || currentMedia.seriesContext?.title || currentMedia.mediaUrl,
      mediaUrl: currentMedia.mediaUrl,
      pageUrl: currentMedia.pageUrl || null
    },
    originId: clientId
  });

  setRoomStatus("Suggested the current item to the room.");
}

function leaveActiveRoom() {
  if (!state.activeRoomId) return;
  leaveRoom(state.activeRoomId);
}

function renderRoomsPageNow() {
  if (pageMode !== "rooms") return;
  renderRoomsDirectory();
}

function connectWs() {
  if (state.ws && state.ws.readyState === WebSocket.OPEN) {
    state.ws.close();
  }
  state.ws = new WebSocket(resolveBackendWsUrl("/ws"));

  state.ws.addEventListener("open", () => {
    state.connected = true;
    setRoomStatus(`Connected as ${normalizeNickname(elements.nicknameInput.value)}.`, false);
    const token = getAuthToken();
    if (token) {
      sendWs({
        type: "auth:identify",
        token
      });
    }
    syncProfile();

    pendingRoomJoins.forEach((roomId) => {
      sendJoinMessage(roomId);
    });

    state.joinedRooms.forEach((roomId) => {
      sendJoinMessage(roomId);
    });

    if (pageMode === "rooms") {
      fetchRoomsDirectory();
    }
  });

  state.ws.addEventListener("message", (event) => {
    let msg;

    try {
      msg = JSON.parse(event.data);
    } catch {
      return;
    }

    if (msg.type === "rooms:update") {
      if (pageMode === "rooms" && isAuthenticated()) {
        fetchRoomsDirectory();
        return;
      }
      state.roomsDirectory = Array.isArray(msg.rooms) ? msg.rooms : [];
      renderRoomsPageNow();
      return;
    }

    if (msg.type === "auth:accepted") {
      state.currentUser = msg.user || null;
      if (state.currentUser?.displayName) {
        elements.nicknameInput.value = state.currentUser.displayName;
        storeValue(STORAGE_KEYS.nickname, state.currentUser.displayName);
      }
      renderRoomsAuthGate();
      if (pageMode === "rooms") {
        fetchRoomsDirectory();
      }
      return;
    }

    if (msg.type === "auth:rejected") {
      storeAuthToken(null);
      state.currentUser = null;
      renderRoomsAuthGate();
      return;
    }

    if (msg.type === "room:error") {
      if (msg.roomId && normalizeRoomCode(msg.roomId) === state.activeRoomId) {
        setRoomStatus(msg.message || "Room error", true);
      } else {
        setJoinHint(msg.message || "Room error", true);
      }

      const failedRoomId = normalizeRoomCode(msg.roomId);
      if (failedRoomId && msg.message === "Room not found" && state.joinedRooms.includes(failedRoomId)) {
        state.joinedRooms = state.joinedRooms.filter((item) => item !== failedRoomId);
        if (state.activeRoomId === failedRoomId) {
          state.activeRoomId = state.joinedRooms[0] || null;
        }
        saveJoinedRooms();
        renderAll();
      }

      return;
    }

    if (msg.type === "room:deleted") {
      const roomId = normalizeRoomCode(msg.roomId);
      if (!roomId) return;

      state.roomStates.delete(roomId);
      state.joinedRooms = state.joinedRooms.filter((item) => item !== roomId);

      if (state.activeRoomId === roomId) {
        state.activeRoomId = state.joinedRooms[0] || null;
      }

      saveJoinedRooms();

      if (state.activeRoomId) {
        refreshActiveRoom();
      }

      renderAll();
      fetchRoomsDirectory();
      setRoomStatus(`Room ${roomId} was deleted`);
      return;
    }

    if (msg.type === "room:role") {
      applyRoleChange(msg.role);
      if (msg.role === "host") {
        setRoomStatus("You are now the host.");
      }
      return;
    }

    if (msg.type === "room:snapshot") {
      const roomId = normalizeRoomCode(msg.roomId);
      if (!roomId) return;
      applyRoomSnapshot(roomId, msg.room || {});
      return;
    }

    if (msg.type === "media:set") {
      const roomId = normalizeRoomCode(msg.roomId);
      if (!roomId || msg.originId === clientId) return;

      updateRoomFromMediaPayload(roomId, msg, false);
      return;
    }
  });

  state.ws.addEventListener("close", () => {
    state.connected = false;
    setRoomStatus("WebSocket disconnected", true);
  });

  state.ws.addEventListener("error", () => {
    setRoomStatus("WebSocket error", true);
  });
}

function handleRoomJoinInput(input) {
  const roomCode = normalizeRoomCode(input.value);
  if (!roomCode) {
    setJoinHint("Enter a room code", true);
    return;
  }

  input.value = roomCode;
  handleRoomJoin(roomCode, { navigateHome: true, setActive: true });
}

function handleRoomsJoinInput() {
  const roomCode = normalizeRoomCode(elements.roomsJoinInput.value);
  if (!roomCode) {
    setJoinHint("Enter a room code", true);
    return;
  }

  elements.roomsJoinInput.value = roomCode;
  handleRoomJoin(roomCode, { navigateHome: true, setActive: true });
}

function autoJoinStoredRooms() {
  const queryRoom = normalizeRoomCode(requestedRoom);
  if (queryRoom) {
    if (!state.joinedRooms.includes(queryRoom)) {
      state.joinedRooms.unshift(queryRoom);
    }

    state.joinedRooms = uniqueRoomCodes(state.joinedRooms);
    state.activeRoomId = queryRoom;
    ensureRoomState(queryRoom);
    saveJoinedRooms();
    return;
  }

  if (state.joinedRooms.length < 1) {
    saveJoinedRooms();
    return;
  }

  if (!state.activeRoomId) {
    state.activeRoomId = state.joinedRooms[0];
    saveJoinedRooms();
  }
}

function bindUi() {
  elements.homeLink.href = resolvePageUrl("./");
  elements.roomsLink.href = resolvePageUrl("./?page=rooms");
  elements.createRoomButton.addEventListener("click", createRoom);
  elements.createdRoomCodeButton.addEventListener("click", () => copyToClipboard(elements.createdRoomCodeValue.textContent));
  elements.homeSignInButton.addEventListener("click", () => {
    window.location.href = resolvePageUrl("./?page=rooms&auth=signin");
  });
  elements.homeSignUpButton.addEventListener("click", () => {
    window.location.href = resolvePageUrl("./?page=rooms&auth=signup");
  });
  elements.joinRoomButton.addEventListener("click", () => handleRoomJoinInput(elements.roomCodeInput));
  elements.roomsCreateButton.addEventListener("click", createRoom);
  elements.roomsJoinButton.addEventListener("click", handleRoomsJoinInput);
  elements.refreshRoomsButton.addEventListener("click", fetchRoomsDirectory);
  elements.reconnectButton.addEventListener("click", connectWs);
  elements.signOutButton.addEventListener("click", signOutAccount);
  elements.lastRoomButton?.addEventListener("click", () => {
    const roomCode = elements.lastRoomButton.getAttribute("data-room") || state.activeRoomId || state.joinedRooms[0];
    if (roomCode) window.location.href = resolvePageUrl(`./?room=${encodeURIComponent(roomCode)}`);
  });
  elements.deleteActiveRoomButton.addEventListener("click", () => {
    if (state.activeRoomId) {
      deleteRoom(state.activeRoomId);
    }
  });
  elements.leaveRoomButton.addEventListener("click", leaveActiveRoom);
  elements.activeRoomCodeButton?.addEventListener("click", () => {
    if (state.activeRoomId) {
      copyToClipboard(state.activeRoomId);
    }
  });
  elements.activeRoomCodeToggleButton?.addEventListener("click", () => {
    roomCodeHidden = !roomCodeHidden;
    updateActiveRoomCodeControls();
  });
  elements.topbarRoomCodeButton.addEventListener("click", () => {
    if (!state.activeRoomId) return;
    window.location.href = resolvePageUrl(`./?room=${encodeURIComponent(state.activeRoomId)}`);
  });
  elements.addToPlaylistButton.addEventListener("click", addCurrentMediaToPlaylist);
  elements.suggestButton.addEventListener("click", suggestCurrentMedia);
  elements.authToggleButton.addEventListener("click", () => setAuthMode(state.authMode === "signup" ? "signin" : "signup"));
  elements.googleSignInButton.addEventListener("click", () => setAuthStatus("Google sign-in is not configured yet.", true));
  elements.appleSignInButton.addEventListener("click", () => setAuthStatus("Apple sign-in is not configured yet.", true));
  elements.forgotPasswordButton.addEventListener("click", () => setAuthStatus("Password reset is not configured yet.", true));

  elements.authForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    await signInAccount(state.authMode);
  });

  elements.searchButton.addEventListener("click", () => {
    const query = elements.searchInput.value.trim();
    if (!query) {
      setSearchHint("Enter a search query", true);
      return;
    }

    if (currentRole !== "host") {
      setSearchHint("Only the host can trigger search.", true);
      return;
    }

    sendSearchToExtension(query);
  });

  elements.nicknameInput.addEventListener("change", syncProfile);
  elements.nicknameInput.addEventListener("blur", syncProfile);

  elements.roomCodeInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      handleRoomJoinInput(elements.roomCodeInput);
    }
  });

  elements.roomsJoinInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      handleRoomsJoinInput();
    }
  });

  elements.authIdentifierInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && state.authMode === "signin") {
      event.preventDefault();
      elements.authForm.requestSubmit();
    }
  });

  elements.authPasswordInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      elements.authForm.requestSubmit();
    }
  });

  elements.chatForm.addEventListener("submit", (event) => {
    event.preventDefault();

    const text = elements.chatInput.value.trim();
    if (!text) return;

    if (!state.activeRoomId) {
      setRoomStatus("Join a room before sending chat messages.", true);
      return;
    }

    sendWs({
      type: "chat:message",
      roomId: state.activeRoomId,
      text,
      nickname: normalizeNickname(elements.nicknameInput.value),
      role: currentRole,
      originId: clientId
    });

    elements.chatInput.value = "";
  });
}

function startUiClock() {
  setInterval(() => {
    updateSessionCounter();
    updateRoomsDirectoryClock();
  }, 1000);
}

async function start() {
  const savedNick = loadStoredValue(STORAGE_KEYS.nickname);
  if (savedNick) {
    elements.nicknameInput.value = savedNick;
  } else {
    elements.nicknameInput.value = "Guest";
  }

  currentRole = normalizeRole(requestedRole || loadStoredValue(STORAGE_KEYS.role) || "guest");
  storeValue(STORAGE_KEYS.role, currentRole);
  const roleSelect = document.getElementById("roleSelect");
  if (roleSelect) {
    roleSelect.value = currentRole;
  }

  await hydrateAuthSession();
  autoJoinStoredRooms();
  ensureVisibility();
  updateSearchControls();
  bindUi();
  renderAll();
  connectWs();
  await fetchRoomsDirectory();
  startUiClock();

  if (state.activeRoomId) {
    refreshActiveRoom();
  }

  window.addEventListener("message", (event) => {
    if (event.source !== window) return;

    if (event.data?.type === PAGE_EVENT_MEDIA_FOUND) {
      clearPendingSearchStatusTimer();
      const payload = event.data?.payload || {};
      const incomingRoomId = normalizeRoomCode(payload.roomId);

      if (!incomingRoomId || incomingRoomId !== state.activeRoomId || !payload.mediaUrl) return;
      updateRoomFromMediaPayload(incomingRoomId, payload, true);
      return;
    }

    if (event.data?.type === PAGE_EVENT_EXTENSION_STATUS) {
      clearPendingSearchStatusTimer();
      setSearchHint(event.data?.payload?.message || "Extension status update");
      return;
    }

    if (event.data?.type === PAGE_EVENT_EXTENSION_ERROR) {
      clearPendingSearchStatusTimer();
      setSearchHint(event.data?.payload?.message || "Extension error", true);
    }
  });
}

window.addEventListener("beforeunload", () => {
  try {
    storeValue(STORAGE_KEYS.nickname, normalizeNickname(elements.nicknameInput.value));
    saveJoinedRooms();
  } catch {}
});

void start();
