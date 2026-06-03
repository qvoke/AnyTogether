const EXTENSION_SEARCH_REQUEST = "WT_SEARCH_REQUEST";
const EXTENSION_RESOLVE_REQUEST = "WT_RESOLVE_PAGE_URL";
const PAGE_EVENT_MEDIA_FOUND = "WT_MEDIA_FOUND";
const PAGE_EVENT_EXTENSION_STATUS = "WT_EXTENSION_STATUS";
const PAGE_EVENT_EXTENSION_ERROR = "WT_EXTENSION_ERROR";

const STORAGE_KEYS = {
  joinedRooms: "watchTogether.joinedRooms",
  activeRoomId: "watchTogether.activeRoomId",
  nickname: "watchTogether.nickname",
  role: "watchTogether.role",
  authToken: "watchTogether.authToken",
  backendBaseUrl: "watchTogether.backendBaseUrl"
};

const DEFAULT_BACKEND_BASE_URL = "https://anytogether-backend.onrender.com/";

const requestedRole = new URLSearchParams(window.location.search).get("role");
const queryRoom = normalizeRoomCode(new URLSearchParams(window.location.search).get("room"));
const requestedPage = new URLSearchParams(window.location.search).get("page");
const requestedAuthMode = new URLSearchParams(window.location.search).get("auth");
const pageMode =
  requestedPage === "rooms" || window.location.pathname.replace(/\/+$/, "").endsWith("/rooms")
    ? "rooms"
    : "home";
document.body.dataset.view = pageMode === "rooms" ? "rooms" : queryRoom ? "room" : "home";
const clientId = crypto.randomUUID();
let currentRole = "guest";
const backendBaseUrl = resolveBackendBaseUrl(
  new URLSearchParams(window.location.search).get("api") ||
    loadStoredValue(STORAGE_KEYS.backendBaseUrl) ||
    window.WATCH_TOGETHER_API_BASE_URL ||
    DEFAULT_BACKEND_BASE_URL
);

const joinView = document.getElementById("joinView");
const dashboardView = document.getElementById("dashboardView");
const roomsView = document.getElementById("roomsView");
const roomsHeader = document.getElementById("roomsHeader");
const roomsAuthGate = document.getElementById("roomsAuthGate");
const authPrompt = document.getElementById("authPrompt");
const authTitle = document.getElementById("authTitle");

const homeLink = document.getElementById("homeLink");
const roomsLink = document.getElementById("roomsLink");
const topbarRoomCodeButton = document.getElementById("topbarRoomCodeButton");
const topbarRoomCodeValue = document.getElementById("topbarRoomCodeValue");

const nicknameInput = document.getElementById("nicknameInput");
const roomCodeInput = document.getElementById("roomCodeInput");
const createRoomButton = document.getElementById("createRoomButton");
const createdRoomCodeButton = document.getElementById("createdRoomCodeButton");
const createdRoomCodeValue = document.getElementById("createdRoomCodeValue");
const homeSignInButton = document.getElementById("homeSignInButton");
const homeSignUpButton = document.getElementById("homeSignUpButton");
const joinRoomButton = document.getElementById("joinRoomButton");
const createHint = document.getElementById("createHint");
const joinHint = document.getElementById("joinHint");

const roomsSignedInBar = document.getElementById("roomsSignedInBar");
const signedInName = document.getElementById("signedInName");
const signOutButton = document.getElementById("signOutButton");
const authForm = document.getElementById("authForm");
const authStatus = document.getElementById("authStatus");
const authSubmitButton = document.getElementById("authSubmitButton");
const authToggleButton = document.getElementById("authToggleButton");
const authNameField = document.getElementById("authNameField");
const authEmailField = document.getElementById("authEmailField");
const authNameInput = document.getElementById("authNameInput");
const authIdentifierInput = document.getElementById("authIdentifierInput");
const authEmailInput = document.getElementById("authEmailInput");
const authPasswordInput = document.getElementById("authPasswordInput");
const authIdentifierField = authIdentifierInput?.closest(".field");
const googleSignInButton = document.getElementById("googleSignInButton");
const appleSignInButton = document.getElementById("appleSignInButton");
const forgotPasswordButton = document.getElementById("forgotPasswordButton");

const activeRoomTitle = document.getElementById("activeRoomTitle");
const activeRoomCodeButton = document.getElementById("activeRoomCodeButton");
const activeRoomCodeValue = document.getElementById("activeRoomCodeValue");
const activeRoomCodeToggleButton = document.getElementById("activeRoomCodeToggleButton");
const deleteActiveRoomButton = document.getElementById("deleteActiveRoomButton");
const leaveRoomButton = document.getElementById("leaveRoomButton");
const sessionDuration = document.getElementById("sessionDuration");
const roomStatus = document.getElementById("roomStatus");
const currentMediaBadge = document.getElementById("currentMediaBadge");

const reconnectButton = document.getElementById("reconnectButton");
const searchInput = document.getElementById("searchInput");
const searchButton = document.getElementById("searchButton");
const searchHelpButton = document.getElementById("searchHelpButton");
const searchHint = document.getElementById("searchHint");

const seriesPanel = document.getElementById("seriesPanel");
const seriesTitleEl = document.getElementById("seriesTitle");
const seriesMetaEl = document.getElementById("seriesMeta");
const seasonPicker = document.getElementById("seasonPicker");
const seasonPickerValue = document.getElementById("seasonPickerValue");
const episodePicker = document.getElementById("episodePicker");
const episodePickerValue = document.getElementById("episodePickerValue");
const translatorPicker = document.getElementById("translatorPicker");
const translatorPickerValue = document.getElementById("translatorPickerValue");
const seasonButtonsEl = document.getElementById("seasonButtons");
const translatorButtonsEl = document.getElementById("translatorButtons");
const seriesEpisodesEl = document.getElementById("seriesEpisodes");

const participantsList = document.getElementById("participantsList");
const chatMessages = document.getElementById("chatMessages");
const chatForm = document.getElementById("chatForm");
const chatInput = document.getElementById("chatInput");
const chatSendButton = document.getElementById("chatSendButton");
const addToPlaylistButton = document.getElementById("addToPlaylistButton");
const suggestButton = document.getElementById("suggestButton");
const playlistList = document.getElementById("playlistList");

const roomsGrid = document.getElementById("roomsGrid");
const refreshRoomsButton = document.getElementById("refreshRoomsButton");
const roomsCreateButton = document.getElementById("roomsCreateButton");
const roomsJoinInput = document.getElementById("roomsJoinInput");
const roomsJoinButton = document.getElementById("roomsJoinButton");

const video = document.getElementById("video");

const topbarUser = document.getElementById("topbarUser");
const topbarNickDisplay = document.getElementById("topbarNickDisplay");
const topbarAvatar = document.getElementById("topbarAvatar");
const lastRoomButton = document.getElementById("lastRoomButton");
const guestIdentityCard = document.getElementById("guestIdentityCard");

const state = {
  ws: null,
  hls: null,
  connected: false,
  player: null,
  videoQualityMenu: null,
  videoQualitySelection: "auto",
  authToken: loadStoredValue(STORAGE_KEYS.authToken) || null,
  currentUser: null,
  authMode: requestedAuthMode === "signup" ? "signup" : "signin",
  joinedRooms: loadJoinedRooms(),
  activeRoomId: queryRoom || loadStoredValue(STORAGE_KEYS.activeRoomId) || null,
  roomsDirectory: [],
  roomStates: new Map(),
  loadingRooms: false,
  authLoading: false
};

let applyingRemoteState = false;
let suppressLocalStateUntil = 0;
let loadedMediaKey = null;
let pendingSearchStatusTimer = null;
let roomCodeHidden = false;
const pendingRoomJoins = new Set();

nicknameInput.value = loadStoredValue(STORAGE_KEYS.nickname) || "Guest";
authIdentifierInput.value = "";
authPasswordInput.value = "";
authNameInput.value = "";
authEmailInput.value = "";

if (queryRoom && !state.joinedRooms.includes(queryRoom)) {
  state.joinedRooms.unshift(queryRoom);
}

state.joinedRooms = uniqueRoomCodes(state.joinedRooms);
if (state.activeRoomId && !state.joinedRooms.includes(state.activeRoomId)) {
  state.activeRoomId = state.joinedRooms[0] || null;
}

function loadStoredValue(key) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function resolveBackendBaseUrl(value) {
  const raw = String(value || "").trim();
  if (!raw) return `${window.location.origin}/`;

  try {
    const url = new URL(raw, window.location.href);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return `${window.location.origin}/`;
    }

    url.hash = "";
    url.search = "";
    if (!url.pathname.endsWith("/")) {
      url.pathname = `${url.pathname}/`;
    }
    return url.href;
  } catch {
    return `${window.location.origin}/`;
  }
}

function resolveBackendUrl(path) {
  return new URL(String(path || "").replace(/^\/+/, ""), backendBaseUrl).href;
}

function resolveBackendWsUrl(path = "/ws") {
  const url = new URL(String(path || "").replace(/^\/+/, ""), backendBaseUrl);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  return url.href;
}

function resolvePageUrl(path) {
  return new URL(String(path || ""), getSiteBaseUrl()).href;
}

function getSiteBaseUrl() {
  const pathname = window.location.pathname || "/";
  const basePath = pathname.endsWith("/") ? pathname : pathname.replace(/[^/]*$/, "");
  return `${window.location.origin}${basePath || "/"}`;
}

function storeValue(key, value) {
  try {
    if (value == null) {
      localStorage.removeItem(key);
    } else {
      localStorage.setItem(key, value);
    }
  } catch {}
}

function getAuthToken() {
  return state.authToken || loadStoredValue(STORAGE_KEYS.authToken) || null;
}

function storeAuthToken(token) {
  state.authToken = token || null;
  storeValue(STORAGE_KEYS.authToken, state.authToken);
}

function getAuthHeaders(contentType = false) {
  const headers = {};
  const token = getAuthToken();

  if (contentType) {
    headers["Content-Type"] = "application/json";
  }

  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  return headers;
}

async function apiRequest(path, options = {}) {
  const headers = {
    ...(options.headers || {})
  };

  if (options.json) {
    headers["Content-Type"] = "application/json";
  }

  const token = getAuthToken();
  if (token && !headers.Authorization) {
    headers.Authorization = `Bearer ${token}`;
  }

  const response = await fetch(resolveBackendUrl(path), {
    ...options,
    headers,
    body: options.json ? JSON.stringify(options.json) : options.body
  });

  return response;
}

function loadJoinedRooms() {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.joinedRooms);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.map(normalizeRoomCode).filter(Boolean) : [];
  } catch {
    return [];
  }
}

function saveJoinedRooms() {
  storeValue(STORAGE_KEYS.joinedRooms, JSON.stringify(state.joinedRooms));
  storeValue(STORAGE_KEYS.activeRoomId, state.activeRoomId || null);
  storeValue(STORAGE_KEYS.role, currentRole);
}

function applyLocalRoomJoin(roomId, roomSnapshot = null, setActive = true) {
  const normalized = normalizeRoomCode(roomId);
  if (!normalized) return null;

  if (roomSnapshot) {
    upsertRoomStateFromSnapshot(normalized, roomSnapshot);
  } else {
    ensureRoomState(normalized);
  }

  if (!state.joinedRooms.includes(normalized)) {
    state.joinedRooms.push(normalized);
    state.joinedRooms = uniqueRoomCodes(state.joinedRooms);
  }

  if (setActive) {
    state.activeRoomId = normalized;
  }

  saveJoinedRooms();
  renderAll();
  return state.roomStates.get(normalized) || null;
}

function uniqueRoomCodes(list) {
  return [...new Set(list.map(normalizeRoomCode).filter(Boolean))];
}

function normalizeRoomCode(value) {
  const normalized = String(value || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9-]/g, "");

  return normalized || null;
}

function normalizeNickname(value) {
  const nickname = String(value || "").trim().slice(0, 40);
  return nickname || "Guest";
}

function normalizeEmail(value) {
  return String(value || "").trim().toLowerCase();
}

function normalizeRole(value) {
  return String(value || "").trim().toLowerCase() === "host" ? "host" : "guest";
}

function promoteToHost() {
  currentRole = "host";
  storeValue(STORAGE_KEYS.role, currentRole);
}

function applyRoleChange(role) {
  const nextRole = normalizeRole(role);
  if (nextRole === currentRole) return;

  currentRole = nextRole;
  storeValue(STORAGE_KEYS.role, currentRole);
  updateSearchControls();
  renderRoomsDirectory();
}

function setHint(element, message, isError = false) {
  element.textContent = message;
  element.style.color = isError ? "#f87171" : "#90a4c2";
}

function setJoinHint(message, isError = false) {
  setHint(joinHint, message, isError);
}

function setCreateHint(message, isError = false) {
  setHint(createHint, message, isError);
}

function setRoomStatus(message, isError = false) {
  setHint(roomStatus, message, isError);
}

function setSearchHint(message, isError = false) {
  setHint(searchHint, message, isError);
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
    pendingSearchStatusTimer = null;
    setSearchHint(`Waiting for the extension to process "${query}"...`, true);
  }, 2500);
}

function sendWs(payload) {
  if (!state.ws || state.ws.readyState !== WebSocket.OPEN) {
    setRoomStatus("WebSocket is not connected", true);
    return false;
  }

  state.ws.send(JSON.stringify(payload));
  return true;
}

function getJoinedRoomIds() {
  return state.joinedRooms.slice();
}

function getRoomState(roomId) {
  return state.roomStates.get(roomId) || null;
}

function ensureRoomState(roomId) {
  const existing = state.roomStates.get(roomId);
  if (existing) return existing;

  const fallback = {
    code: roomId,
    title: `Room ${roomId}`,
    createdAt: Date.now(),
    sessionStartedAt: Date.now(),
    memberCount: 0,
    participants: [],
    chat: [],
    playlist: [],
    currentMedia: null,
    currentPlayback: { state: "paused", time: 0, updatedAt: Date.now() },
    ui: {
      seasonId: null,
      translatorId: null,
      qualityLabel: null
    }
  };

  state.roomStates.set(roomId, fallback);
  return fallback;
}

function upsertRoomStateFromSnapshot(roomId, snapshot) {
  const existing = state.roomStates.get(roomId) || ensureRoomState(roomId);
  const previousMediaUrl = existing.currentMedia?.mediaUrl || null;
  const previousPlayback = existing.currentPlayback || { state: "paused", time: 0 };

  existing.code = snapshot.code || roomId;
  existing.title = snapshot.title || existing.title || `Room ${roomId}`;
  existing.createdAt = Number.isFinite(snapshot.createdAt) ? snapshot.createdAt : existing.createdAt;
  existing.sessionStartedAt = Number.isFinite(snapshot.sessionStartedAt)
    ? snapshot.sessionStartedAt
    : existing.sessionStartedAt;
  existing.memberCount = Number.isFinite(snapshot.memberCount) ? snapshot.memberCount : existing.memberCount;
  existing.participants = Array.isArray(snapshot.participants) ? snapshot.participants : existing.participants;
  existing.chat = Array.isArray(snapshot.chat) ? snapshot.chat : existing.chat;
  existing.playlist = Array.isArray(snapshot.playlist) ? snapshot.playlist : existing.playlist;
  existing.currentMedia = snapshot.currentMedia || null;
  existing.currentPlayback = snapshot.currentPlayback || existing.currentPlayback || { state: "paused", time: 0 };
  existing.lastUpdatedAt = Number.isFinite(snapshot.lastUpdatedAt) ? snapshot.lastUpdatedAt : Date.now();
  sanitizeRoomUi(existing);
  state.roomStates.set(roomId, existing);

  return {
    roomState: existing,
    previousMediaUrl,
    previousPlayback
  };
}

function createDefaultUi(seriesContext) {
  const seasons = Array.isArray(seriesContext?.seasons) ? seriesContext.seasons : [];
  const translators = Array.isArray(seriesContext?.translators) ? seriesContext.translators : [];
  const qualities = Array.isArray(seriesContext?.availableQualities) ? seriesContext.availableQualities : [];

  return {
    seasonId:
      seriesContext?.currentSeasonId ??
      seasons[0]?.seasonId ??
      null,
    episodeId:
      seriesContext?.currentEpisodeId ??
      null,
    translatorId:
      seriesContext?.selectedTranslatorId ??
      translators[0]?.translatorId ??
      null,
    qualityLabel:
      seriesContext?.selectedQualityLabel ??
      qualities[0]?.label ??
      null
  };
}

function sanitizeRoomUi(roomState) {
  const seriesContext = roomState?.currentMedia?.seriesContext || null;
  const seasons = Array.isArray(seriesContext?.seasons) ? seriesContext.seasons : [];
  const translators = Array.isArray(seriesContext?.translators) ? seriesContext.translators : [];
  const qualities = Array.isArray(seriesContext?.availableQualities) ? seriesContext.availableQualities : [];

  if (!roomState.ui) {
    roomState.ui = createDefaultUi(seriesContext);
    return;
  }

  if (!seasons.some((season) => season.seasonId === Number(roomState.ui.seasonId))) {
    roomState.ui.seasonId = createDefaultUi(seriesContext).seasonId;
  }

  const activeSeasonId = Number(roomState.ui.seasonId);
  const activeSeason = seasons.find((season) => season.seasonId === activeSeasonId) || seasons[0] || null;
  const activeSeasonEpisodes = Array.isArray(activeSeason?.episodes) ? activeSeason.episodes : [];

  if (
    !activeSeasonEpisodes.some((episode) => episode.episodeId === Number(roomState.ui.episodeId))
  ) {
    roomState.ui.episodeId = activeSeasonEpisodes[0]?.episodeId ?? createDefaultUi(seriesContext).episodeId;
  }

  if (!translators.some((translator) => translator.translatorId === Number(roomState.ui.translatorId))) {
    roomState.ui.translatorId = createDefaultUi(seriesContext).translatorId;
  }

  if (!qualities.some((quality) => quality.label === roomState.ui.qualityLabel)) {
    roomState.ui.qualityLabel = createDefaultUi(seriesContext).qualityLabel;
  }
}

function getActiveRoomState() {
  if (!state.activeRoomId) return null;
  return ensureRoomState(state.activeRoomId);
}

function getActiveSeriesContext() {
  return getActiveRoomState()?.currentMedia?.seriesContext || null;
}

function getActiveUiState() {
  return getActiveRoomState()?.ui || createDefaultUi(getActiveSeriesContext());
}

function formatDuration(durationMs) {
  const totalSeconds = Math.max(0, Math.floor(durationMs / 1000));
  const hours = String(Math.floor(totalSeconds / 3600)).padStart(2, "0");
  const minutes = String(Math.floor((totalSeconds % 3600) / 60)).padStart(2, "0");
  const seconds = String(totalSeconds % 60).padStart(2, "0");
  return `${hours}:${minutes}:${seconds}`;
}

function formatClock(timestamp) {
  if (!Number.isFinite(timestamp)) return "";
  return new Date(timestamp).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit"
  });
}

function formatRelativeTime(timestamp) {
  if (!Number.isFinite(timestamp)) return "Unknown";

  const delta = Date.now() - timestamp;
  if (delta < 0) return "Just now";
  if (delta < 60 * 1000) return `${Math.max(1, Math.floor(delta / 1000))}s ago`;
  if (delta < 60 * 60 * 1000) return `${Math.floor(delta / (60 * 1000))}m ago`;
  if (delta < 24 * 60 * 60 * 1000) return `${Math.floor(delta / (60 * 60 * 1000))}h ago`;
  return `${Math.floor(delta / (24 * 60 * 60 * 1000))}d ago`;
}

function updateTopbarRoomBadges() {
  topbarRoomCodeButton.classList.add("hidden");
}

function updateSessionCounter() {
  const roomState = getActiveRoomState();
  if (!roomState) {
    sessionDuration.textContent = "00:00:00";
    return;
  }

  sessionDuration.textContent = formatDuration(Date.now() - roomState.sessionStartedAt);
}

function updateCurrentMediaBadge() {
  if (!currentMediaBadge) return;
  currentMediaBadge.classList.add("hidden");
  currentMediaBadge.textContent = "";
}

function updateActiveRoomCodeControls() {
  const roomState = getActiveRoomState();
  const roomCode = roomState?.code || "";

  if (!activeRoomCodeButton || !activeRoomCodeValue || !activeRoomCodeToggleButton) return;

  if (!roomState) {
    activeRoomCodeButton.classList.add("hidden");
    activeRoomCodeToggleButton.classList.add("hidden");
    activeRoomCodeValue.textContent = "--";
    activeRoomCodeButton.classList.remove("is-blurred");
    roomCodeHidden = false;
    return;
  }

  activeRoomCodeButton.classList.remove("hidden");
  activeRoomCodeToggleButton.classList.remove("hidden");
  activeRoomCodeValue.textContent = roomCode;
  activeRoomCodeButton.classList.toggle("is-blurred", roomCodeHidden);
  activeRoomCodeToggleButton.textContent = roomCodeHidden ? "Show" : "Hide";
}

function updateActiveRoomHeader() {
  const roomState = getActiveRoomState();

  if (!roomState) {
    activeRoomTitle.textContent = "No room selected";
    roomStatus.textContent = "Join a room to unlock the dashboard.";
    roomStatus.classList.remove("hidden");
    updateActiveRoomCodeControls();
    return;
  }

  activeRoomTitle.textContent = roomState.title || `Room ${roomState.code}`;
  roomStatus.textContent = "";
  roomStatus.classList.add("hidden");
  updateActiveRoomCodeControls();
}

function renderTopbarUser() {
  const signedIn = isAuthenticated();
  const nick = state.currentUser?.displayName || normalizeNickname(nicknameInput.value);
  if (topbarUser) topbarUser.classList.toggle("hidden", !signedIn);
  if (topbarNickDisplay) topbarNickDisplay.textContent = nick;
  if (topbarAvatar) topbarAvatar.textContent = nick.charAt(0).toUpperCase();
  const signOutBtn = document.getElementById("signOutButton");
  if (signOutBtn) signOutBtn.classList.toggle("hidden", !signedIn);
}

function updateLastRoomButton() {
  if (!lastRoomButton) return;
  const lastRoom = state.activeRoomId || state.joinedRooms[0] || loadStoredValue(STORAGE_KEYS.activeRoomId);
  const hasRoom = Boolean(lastRoom);
  lastRoomButton.classList.toggle("hidden", !hasRoom);
  if (lastRoom) lastRoomButton.setAttribute("data-room", lastRoom);
}

function updateGuestIdentityCard() {
  if (!guestIdentityCard) return;
  guestIdentityCard.classList.toggle("hidden", isAuthenticated());
}

function ensureVisibility() {
  if (pageMode === "rooms") {
    joinView.classList.add("hidden");
    dashboardView.classList.add("hidden");
    roomsView.classList.remove("hidden");
    roomsView.classList.add("is-visible");
    renderRoomsAuthGate();
    return;
  }

  roomsView.classList.add("hidden");

  if (queryRoom) {
    joinView.classList.add("hidden");
    dashboardView.classList.remove("hidden");
  } else {
    joinView.classList.remove("hidden");
    dashboardView.classList.add("hidden");
  }
}

function isAuthenticated() {
  return Boolean(state.currentUser && getAuthToken());
}

function setAuthMode(mode) {
  state.authMode = mode === "signup" ? "signup" : "signin";
  authStatus.classList.add("hidden");
  renderRoomsAuthGate();
}

function setAuthStatus(message, isError = false) {
  authStatus.classList.remove("hidden");
  authStatus.textContent = message;
  authStatus.style.color = isError ? "#f87171" : "#90a4c2";
}

function renderAuthMode() {
  const isSignup = state.authMode === "signup";

  authTitle.textContent = isSignup ? "Sign up" : "Sign in to AnyTogether";
  authPrompt.textContent = isSignup ? "Or sign up with email" : "Or sign in with email";
  authIdentifierField?.classList.toggle("hidden", isSignup);
  authNameField.classList.toggle("hidden", !isSignup);
  authEmailField.classList.toggle("hidden", !isSignup);
  authSubmitButton.textContent = isSignup ? "Sign up" : "Sign in";
  authToggleButton.textContent = isSignup ? "Back to sign in" : "No account? Sign up";
  authIdentifierInput.placeholder = isSignup ? "Enter your email" : "Enter your email or name";
  authPasswordInput.autocomplete = isSignup ? "new-password" : "current-password";
  if (!isSignup) {
    authNameInput.value = "";
    authEmailInput.value = "";
  } else {
    authIdentifierInput.value = "";
  }
}

function renderRoomsAuthGate() {
  if (pageMode !== "rooms") return;

  const signedIn = isAuthenticated();
  roomsAuthGate.classList.toggle("hidden", signedIn);
  roomsHeader.classList.toggle("hidden", !signedIn);
  roomsSignedInBar.classList.toggle("hidden", !signedIn);
  if (signedIn) {
    signedInName.textContent = state.currentUser?.displayName ? `Signed in as ${state.currentUser.displayName}` : "Signed in";
    roomsGrid.classList.remove("hidden");
  } else {
    signedInName.textContent = "Not signed in";
    roomsGrid.classList.add("hidden");
  }

  renderAuthMode();
}

function getCurrentMediaPayload() {
  const roomState = getActiveRoomState();
  if (!roomState?.currentMedia?.mediaUrl) return null;

  return {
    mediaUrl: roomState.currentMedia.mediaUrl,
    pageUrl: roomState.currentMedia.pageUrl || null,
    title: roomState.currentMedia.title || roomState.currentMedia.seriesContext?.title || null,
    seriesContext: roomState.currentMedia.seriesContext || null
  };
}

function getSeasons() {
  return Array.isArray(getActiveSeriesContext()?.seasons) ? getActiveSeriesContext().seasons : [];
}

function getTranslators() {
  return Array.isArray(getActiveSeriesContext()?.translators) ? getActiveSeriesContext().translators : [];
}

function getAvailableQualities() {
  return Array.isArray(getActiveSeriesContext()?.availableQualities)
    ? getActiveSeriesContext().availableQualities
    : [];
}

function getSelectedTranslatorTitle() {
  const translatorId = Number(getActiveUiState()?.translatorId);
  const translator = getTranslators().find((item) => item.translatorId === translatorId);
  return translator?.title || getActiveSeriesContext()?.selectedTranslatorTitle || null;
}

function getActiveSeasonId() {
  const seasons = getSeasons();
  const preferredSeasonId = Number(getActiveUiState()?.seasonId);
  if (Number.isFinite(preferredSeasonId) && seasons.some((season) => season.seasonId === preferredSeasonId)) {
    return preferredSeasonId;
  }

  const currentSeasonId = Number(getActiveSeriesContext()?.currentSeasonId);
  if (Number.isFinite(currentSeasonId) && seasons.some((season) => season.seasonId === currentSeasonId)) {
    return currentSeasonId;
  }

  return seasons[0]?.seasonId ?? null;
}

function getActiveSeason() {
  const seasons = getSeasons();
  const activeSeasonId = getActiveSeasonId();
  return seasons.find((season) => season.seasonId === activeSeasonId) || seasons[0] || null;
}

function getSelectedEpisodeForActions() {
  const activeSeason = getActiveSeason();
  if (!activeSeason?.episodes?.length) return null;

  const preferredEpisodeId = Number(getActiveUiState()?.episodeId);
  if (Number.isFinite(preferredEpisodeId)) {
    const preferredEpisode = activeSeason.episodes.find((episode) => episode.episodeId === preferredEpisodeId);
    if (preferredEpisode) return preferredEpisode;
  }

  const currentSeasonId = Number(getActiveSeriesContext()?.currentSeasonId);
  const currentEpisodeId = Number(getActiveSeriesContext()?.currentEpisodeId);

  if (
    Number.isFinite(currentSeasonId) &&
    Number.isFinite(currentEpisodeId) &&
    activeSeason.seasonId === currentSeasonId
  ) {
    const currentEpisode = activeSeason.episodes.find((episode) => episode.episodeId === currentEpisodeId);
    if (currentEpisode) return currentEpisode;
  }

  return activeSeason.episodes[0];
}

function extractMediaTitleAndYearSafe(text) {
  const raw = String(text || "").trim();
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
    seriesPanel.classList.add("hidden");
    seriesTitleEl.textContent = "";
    seriesMetaEl.textContent = "";
    if (seasonPickerValue) seasonPickerValue.textContent = "";
    if (episodePickerValue) episodePickerValue.textContent = "";
    if (translatorPickerValue) translatorPickerValue.textContent = "";
    seasonButtonsEl.textContent = "";
    translatorButtonsEl.textContent = "";
    seriesEpisodesEl.textContent = "";
    seasonPicker?.removeAttribute("open");
    episodePicker?.removeAttribute("open");
    translatorPicker?.removeAttribute("open");
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

  seriesPanel.classList.remove("hidden");
  seriesTitleEl.textContent = title;
  seriesMetaEl.textContent = displayYear ? `(${displayYear})` : "";
  if (seasonPickerValue) seasonPickerValue.textContent = selectedSeasonTitle;
  if (episodePickerValue) episodePickerValue.textContent = selectedEpisodeTitle;
  if (translatorPickerValue) translatorPickerValue.textContent = selectedTranslatorTitle;

  if (!seriesContext || seasons.length < 1) {
    seasonButtonsEl.textContent = "";
    translatorButtonsEl.textContent = "";
    seriesEpisodesEl.textContent = "";
    seasonButtonsEl.closest(".series-group")?.classList.add("is-hidden");
    translatorButtonsEl.closest(".series-group")?.classList.add("is-hidden");
    seriesEpisodesEl.closest(".series-group")?.classList.add("is-hidden");
    seasonPicker?.removeAttribute("open");
    episodePicker?.removeAttribute("open");
    translatorPicker?.removeAttribute("open");
    return;
  }

  renderButtonGroup(
    seasonButtonsEl,
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
    translatorButtonsEl,
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

  seriesEpisodesEl.textContent = "";
  if (activeSeasonEpisodes.length < 1) {
    seriesEpisodesEl.classList.remove("is-visible");
    return;
  }

  seriesEpisodesEl.classList.add("is-visible");

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

    seriesEpisodesEl.appendChild(button);
  });
}

function applyRoomSnapshot(roomId, snapshot) {
  const { roomState: existing, previousMediaUrl, previousPlayback } = upsertRoomStateFromSnapshot(roomId, snapshot);

  const activeRoomChanged = state.activeRoomId === roomId;
  if (activeRoomChanged) {
    refreshActiveRoom();
  }

  const mediaChanged = previousMediaUrl !== existing.currentMedia?.mediaUrl;
  const playbackChanged =
    previousPlayback.state !== existing.currentPlayback?.state ||
    previousPlayback.time !== existing.currentPlayback?.time;

  renderAll();

  if (activeRoomChanged) {
    if (mediaChanged) {
      syncActiveRoomMedia(true);
    } else if (playbackChanged) {
      applyPlaybackState(existing.currentPlayback);
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
  participantsList.textContent = "";

  if (!roomState?.participants?.length) {
    const placeholder = document.createElement("div");
    placeholder.className = "status";
    placeholder.textContent = "No participants yet.";
    participantsList.appendChild(placeholder);
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
    participantsList.appendChild(item);
  });
}

function renderChat() {
  const roomState = getActiveRoomState();
  chatMessages.textContent = "";

  if (!roomState?.chat?.length) {
    const placeholder = document.createElement("div");
    placeholder.className = "status";
    placeholder.textContent = "No chat messages yet.";
    chatMessages.appendChild(placeholder);
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
    chatMessages.appendChild(item);
  });

  chatMessages.scrollTop = chatMessages.scrollHeight;
}

function renderPlaylist() {
  const roomState = getActiveRoomState();
  playlistList.textContent = "";

  if (!roomState?.playlist?.length) {
    const placeholder = document.createElement("div");
    placeholder.className = "status";
    placeholder.textContent = "Playlist is empty.";
    playlistList.appendChild(placeholder);
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
    playlistList.appendChild(card);
  });
}

function renderRoomsDirectory() {
  if (pageMode === "rooms" && !isAuthenticated()) {
    roomsGrid.textContent = "";
    return;
  }

  roomsGrid.textContent = "";

  if (state.loadingRooms) {
    const loading = document.createElement("div");
    loading.className = "status";
    loading.textContent = "Loading rooms...";
    roomsGrid.appendChild(loading);
    return;
  }

  if (!state.roomsDirectory.length) {
    const empty = document.createElement("div");
    empty.className = "status";
    empty.textContent = "No rooms are linked to your account yet.";
    roomsGrid.appendChild(empty);
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
    roomsGrid.appendChild(card);
  });
}

function updateRoomsDirectoryClock() {
  if (pageMode !== "rooms" || !roomsGrid || roomsGrid.classList.contains("hidden")) return;

  roomsGrid.querySelectorAll(".status[data-session-started-at]").forEach((status) => {
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

function getParticipantInitials(participant) {
  const source = String(participant?.nickname || participant?.displayName || "Guest").trim();
  if (!source) return "G";

  const pieces = source.split(/\s+/).filter(Boolean);
  if (!pieces.length) return "G";

  return pieces
    .slice(0, 2)
    .map((piece) => piece.charAt(0))
    .join("")
    .toUpperCase();
}

function isHlsSource(url) {
  return /\.m3u8(?:\?|$)/i.test(String(url || ""));
}

function getSourceType(url) {
  if (isHlsSource(url)) {
    return "application/x-mpegURL";
  }

  if (/\.mp4(?:\?|$)/i.test(String(url || ""))) {
    return "video/mp4";
  }

  return undefined;
}

function destroyPlayer() {
  if (!state.player) return;

  state.videoQualitySelection = "auto";
  try {
    state.player.pause();
    state.player.reset();
  } catch (error) {
    console.warn("Video.js reset failed", error);
  }
}

function destroyMediaEngine() {
  if (state.hls) {
    state.hls.destroy();
    state.hls = null;
  }
}

function getVideoJsQualityLevels(player = state.player) {
  if (!player || typeof player.qualityLevels !== "function") {
    return null;
  }

  return player.qualityLevels();
}

function getVideoJsQualityOptions(player = state.player) {
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
      height
    });
  }

  return options.sort((a, b) => b.height - a.height);
}

function applyVideoJsQualitySelection(selection = state.videoQualitySelection) {
  const levels = getVideoJsQualityLevels();
  if (!levels) return;

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
  if (!button) return;

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

  if (!MenuButton || !MenuItem) return;

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
        const items = [
          new Item(this.player(), {
            label: "Auto",
            qualityValue: "auto",
            selected: state.videoQualitySelection === "auto"
          })
        ];

        getVideoJsQualityOptions(this.player()).forEach((option) => {
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
        if (this.qualityLabel) {
          this.qualityLabel.textContent = state.videoQualitySelection === "auto"
            ? "Auto"
            : `${state.videoQualitySelection}p`;
        }
        return result;
      }
    }

    videojs.registerComponent("AnyTogetherQualityMenuButton", AnyTogetherQualityMenuButton);
  }

  state.videoQualityMenu = player.controlBar.addChild(
    "AnyTogetherQualityMenuButton",
    {},
    player.controlBar.children().length - 1
  );

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

function initializePlayer() {
  if (!window.videojs) return null;
  if (state.player) return state.player;

  state.player = window.videojs(video, {
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

  installVideoJsQualityMenu(state.player);
  return state.player;
}

function updateSearchControls() {
  const roomState = getActiveRoomState();
  const canSearch = currentRole === "host" && Boolean(roomState);
  searchButton.disabled = !canSearch;
  addToPlaylistButton.disabled = !roomState?.currentMedia?.mediaUrl;
  suggestButton.disabled = !roomState?.currentMedia?.mediaUrl;
  chatSendButton.disabled = !roomState;
  leaveRoomButton.disabled = !roomState;
  deleteActiveRoomButton.classList.toggle("hidden", !(roomState && currentRole === "host"));

  if (!roomState) {
    setSearchHint("Join or create a room to use playback controls.");
    searchHint.classList.remove("hidden");
    return;
  }

  if (currentRole !== "host") {
    setSearchHint("Only the host can trigger search.");
    searchHint.classList.remove("hidden");
    return;
  }

  setSearchHint("");
  searchHint.classList.add("hidden");
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
    syncActiveRoomMedia(true);
  } else {
    clearMedia();
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
      syncActiveRoomMedia(true);
    } else {
      clearMedia();
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
  const nickname = normalizeNickname(nicknameInput.value);
  nicknameInput.value = nickname;
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
      roomsGrid.textContent = "";
      const errorBox = document.createElement("div");
      errorBox.className = "status";
      errorBox.textContent = `Failed to load rooms: ${error.message}`;
      roomsGrid.appendChild(errorBox);
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
    return null;
  }

  try {
    const response = await apiRequest("/api/auth/me", { cache: "no-store" });
    if (!response.ok) {
      storeAuthToken(null);
      state.currentUser = null;
      renderRoomsAuthGate();
      return null;
    }

    const data = await response.json();
    state.currentUser = data.user || null;
    if (state.currentUser?.displayName) {
      nicknameInput.value = state.currentUser.displayName;
      storeValue(STORAGE_KEYS.nickname, state.currentUser.displayName);
    }
    renderRoomsAuthGate();
    return state.currentUser;
  } catch {
    storeAuthToken(null);
    state.currentUser = null;
    renderRoomsAuthGate();
    return null;
  }
}

async function signInAccount(mode = state.authMode) {
  const isSignup = mode === "signup";
  const identifier = String(authIdentifierInput.value || "").trim();
  const displayName = String(authNameInput.value || "").trim();
  const email = normalizeEmail(authEmailInput.value);
  const password = String(authPasswordInput.value || "").trim();

  if (isSignup) {
    if (!displayName || !email || password.length < 8) {
      setAuthStatus("Display name, email, and a password with at least 8 characters are required.", true);
      return false;
    }
  } else if (!identifier || !password) {
    setAuthStatus("Email or name and password are required.", true);
    return false;
  }

  const endpoint = isSignup ? "/api/auth/register" : "/api/auth/login";
  const payload = isSignup
    ? { displayName, email, password }
    : { identifier, password };

  setAuthStatus(isSignup ? "Signing up..." : "Signing in...");

  try {
    const response = await apiRequest(endpoint, {
      method: "POST",
      json: payload
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(data.error || "Authentication failed");
    }

    storeAuthToken(data.token || null);
    state.currentUser = data.user || null;
    if (state.currentUser?.displayName) {
      nicknameInput.value = state.currentUser.displayName;
      storeValue(STORAGE_KEYS.nickname, state.currentUser.displayName);
    }
    authStatus.classList.add("hidden");
    renderRoomsAuthGate();
    renderTopbarUser();
    updateGuestIdentityCard();
    await fetchRoomsDirectory();
    if (state.ws && state.ws.readyState === WebSocket.OPEN) {
      sendWs({
        type: "auth:identify",
        token: data.token || null
      });
      syncProfile();
    } else {
      connectWs();
    }
    return true;
  } catch (error) {
    setAuthStatus(error.message || "Authentication failed", true);
    return false;
  }
}

async function signOutAccount() {
  const token = getAuthToken();
  try {
    if (token) {
      await apiRequest("/api/auth/logout", { method: "POST" });
    }
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
        title: `${normalizeNickname(nicknameInput.value)}'s room`
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
    createdRoomCodeValue.textContent = roomCode;
    createdRoomCodeButton.classList.remove("hidden");
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
      nickname: normalizeNickname(nicknameInput.value),
      role: currentRole,
      clientId
    })
  );
  pendingRoomJoins.delete(normalized);
  return true;
}

function loadMedia(url) {
  destroyMediaEngine();

  const mediaUrl = String(url || "").trim();
  if (!mediaUrl) return;

  const roomState = getActiveRoomState();
  const player = initializePlayer();
  const source = { src: mediaUrl };
  const type = getSourceType(mediaUrl);

  if (type) {
    source.type = type;
  }

  if (player) {
    player.src(source);
    player.load();
  } else {
    video.src = mediaUrl;
    video.load();
  }

  const playback = roomState?.currentPlayback || { state: "paused", time: 0 };
  if (video.readyState >= 1) {
    applyPlaybackState(playback);
  } else {
    video.addEventListener("loadedmetadata", () => applyPlaybackState(playback), { once: true });
  }
}

function clearMedia() {
  destroyPlayer();
  destroyMediaEngine();

  loadedMediaKey = null;
  video.removeAttribute("src");
  video.load();
  if (currentMediaBadge) {
    currentMediaBadge.textContent = "";
    currentMediaBadge.classList.add("hidden");
  }
}

function applyPlaybackState(playback) {
  const desiredTime = Number.isFinite(playback?.time) ? playback.time : 0;
  const desiredState = playback?.state === "playing" ? "playing" : "paused";

  applyingRemoteState = true;
  suppressLocalStateUntil = performance.now() + 1500;

  const applyToVideo = () => {
    try {
      if (Number.isFinite(desiredTime)) {
        video.currentTime = desiredTime;
      }
    } catch {}

    if (desiredState === "playing") {
      if (state.player?.play) {
        state.player.play().catch(() => {});
      } else {
        video.play().catch(() => {});
      }
    } else {
      if (state.player?.pause) {
        state.player.pause();
      } else {
        video.pause();
      }
    }
  };

  if (video.readyState >= 1) {
    applyToVideo();
  } else {
    video.addEventListener("loadedmetadata", applyToVideo, { once: true });
  }

  setTimeout(() => {
    applyingRemoteState = false;
  }, 0);
}

function syncActiveRoomMedia(forceReload = false) {
  const roomState = getActiveRoomState();
  if (!roomState?.currentMedia?.mediaUrl) {
    clearMedia();
    return;
  }

  const mediaKey = `${roomState.code}:${roomState.currentMedia.mediaUrl}`;
  const shouldReload = forceReload || loadedMediaKey !== mediaKey;

  if (shouldReload) {
    loadMedia(roomState.currentMedia.mediaUrl);
    loadedMediaKey = mediaKey;
  }

  if (currentMediaBadge) {
    currentMediaBadge.textContent = "";
    currentMediaBadge.classList.add("hidden");
  }
  applyPlaybackState(roomState.currentPlayback);
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
  roomState.currentPlayback = {
    state: "paused",
    time: 0,
    updatedAt: Date.now()
  };
  sanitizeRoomUi(roomState);
  state.roomStates.set(normalized, roomState);

  if (state.activeRoomId === normalized) {
    refreshActiveRoom();
    syncActiveRoomMedia(true);
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

function applyMediaPayload(payload, shouldBroadcast) {
  const roomId = state.activeRoomId;
  if (!roomId || !payload?.mediaUrl) return;
  updateRoomFromMediaPayload(roomId, payload, shouldBroadcast);
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
    nickname: normalizeNickname(nicknameInput.value),
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
    nickname: normalizeNickname(nicknameInput.value),
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
    setRoomStatus(`Connected as ${normalizeNickname(nicknameInput.value)}.`, false);
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
        nicknameInput.value = state.currentUser.displayName;
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
        syncActiveRoomMedia(true);
      } else {
        clearMedia();
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

    if (msg.roomId !== state.activeRoomId || msg.originId === clientId) {
      return;
    }

    applyingRemoteState = true;
    suppressLocalStateUntil = performance.now() + 1500;

    if (msg.type === "player:play") {
      applyPlaybackState({
        state: "playing",
        time: Number.isFinite(msg.time) ? msg.time : video.currentTime || 0
      });
    }

    if (msg.type === "player:pause") {
      applyPlaybackState({
        state: "paused",
        time: Number.isFinite(msg.time) ? msg.time : video.currentTime || 0
      });
    }

    if (msg.type === "player:seek") {
      applyPlaybackState({
        state: state.roomStates.get(state.activeRoomId)?.currentPlayback?.state || "paused",
        time: Number.isFinite(msg.time) ? msg.time : video.currentTime || 0
      });
    }

    setTimeout(() => {
      applyingRemoteState = false;
    }, 0);
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
  const roomCode = normalizeRoomCode(roomsJoinInput.value);
  if (!roomCode) {
    setJoinHint("Enter a room code", true);
    return;
  }

  roomsJoinInput.value = roomCode;
  handleRoomJoin(roomCode, { navigateHome: true, setActive: true });
}

function autoJoinStoredRooms() {
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

function updateRoomCodeInputs() {
  if (state.activeRoomId) {
    return;
  }
}

function bindUi() {
  homeLink.href = resolvePageUrl("./");
  roomsLink.href = resolvePageUrl("./?page=rooms");
  createRoomButton.addEventListener("click", createRoom);
  createdRoomCodeButton.addEventListener("click", () => copyToClipboard(createdRoomCodeValue.textContent));
  homeSignInButton.addEventListener("click", () => {
    window.location.href = resolvePageUrl("./?page=rooms&auth=signin");
  });
  homeSignUpButton.addEventListener("click", () => {
    window.location.href = resolvePageUrl("./?page=rooms&auth=signup");
  });
  joinRoomButton.addEventListener("click", () => handleRoomJoinInput(roomCodeInput));
  roomsCreateButton.addEventListener("click", createRoom);
  roomsJoinButton.addEventListener("click", handleRoomsJoinInput);
  refreshRoomsButton.addEventListener("click", fetchRoomsDirectory);
  reconnectButton.addEventListener("click", connectWs);
  signOutButton.addEventListener("click", signOutAccount);
  lastRoomButton?.addEventListener("click", () => {
    const roomCode = lastRoomButton.getAttribute("data-room") || state.activeRoomId || state.joinedRooms[0];
    if (roomCode) window.location.href = resolvePageUrl(`./?room=${encodeURIComponent(roomCode)}`);
  });
  deleteActiveRoomButton.addEventListener("click", () => {
    if (state.activeRoomId) {
      deleteRoom(state.activeRoomId);
    }
  });
  leaveRoomButton.addEventListener("click", leaveActiveRoom);
  activeRoomCodeButton?.addEventListener("click", () => {
    if (state.activeRoomId) {
      copyToClipboard(state.activeRoomId);
    }
  });
  activeRoomCodeToggleButton?.addEventListener("click", () => {
    roomCodeHidden = !roomCodeHidden;
    updateActiveRoomCodeControls();
  });
  topbarRoomCodeButton.addEventListener("click", () => {
    if (!state.activeRoomId) return;
    window.location.href = resolvePageUrl(`./?room=${encodeURIComponent(state.activeRoomId)}`);
  });
  addToPlaylistButton.addEventListener("click", addCurrentMediaToPlaylist);
  suggestButton.addEventListener("click", suggestCurrentMedia);
  authToggleButton.addEventListener("click", () => setAuthMode(state.authMode === "signup" ? "signin" : "signup"));
  googleSignInButton.addEventListener("click", () => setAuthStatus("Google sign-in is not configured yet.", true));
  appleSignInButton.addEventListener("click", () => setAuthStatus("Apple sign-in is not configured yet.", true));
  forgotPasswordButton.addEventListener("click", () => setAuthStatus("Password reset is not configured yet.", true));

  authForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    await signInAccount(state.authMode);
  });

  searchButton.addEventListener("click", () => {
    const query = searchInput.value.trim();
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

  nicknameInput.addEventListener("change", syncProfile);
  nicknameInput.addEventListener("blur", syncProfile);

  roomCodeInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      handleRoomJoinInput(roomCodeInput);
    }
  });

  roomsJoinInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      handleRoomsJoinInput();
    }
  });

  authIdentifierInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && state.authMode === "signin") {
      event.preventDefault();
      authForm.requestSubmit();
    }
  });

  authPasswordInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      authForm.requestSubmit();
    }
  });

  chatForm.addEventListener("submit", (event) => {
    event.preventDefault();

    const text = chatInput.value.trim();
    if (!text) return;

    if (!state.activeRoomId) {
      setRoomStatus("Join a room before sending chat messages.", true);
      return;
    }

    sendWs({
      type: "chat:message",
      roomId: state.activeRoomId,
      text,
      nickname: normalizeNickname(nicknameInput.value),
      role: currentRole,
      originId: clientId
    });

    chatInput.value = "";
  });
}

function startUiClock() {
  setInterval(() => {
    updateSessionCounter();
    updateRoomsDirectoryClock();
  }, 1000);
}

async function start() {
  currentRole = normalizeRole(requestedRole || loadStoredValue(STORAGE_KEYS.role) || "guest");
  storeValue(STORAGE_KEYS.role, currentRole);
  if (new URLSearchParams(window.location.search).get("api")) {
    storeValue(STORAGE_KEYS.backendBaseUrl, backendBaseUrl);
  }
  await hydrateAuthSession();
  autoJoinStoredRooms();
  updateRoomCodeInputs();
  ensureVisibility();
  updateSearchControls();
  bindUi();
  initializePlayer();
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

video.addEventListener("play", () => {
  if (applyingRemoteState) return;
  if (performance.now() < suppressLocalStateUntil) return;
  if (!state.activeRoomId) return;

  sendWs({
    type: "player:play",
    roomId: state.activeRoomId,
    originId: clientId,
    time: video.currentTime
  });
});

video.addEventListener("pause", () => {
  if (applyingRemoteState) return;
  if (performance.now() < suppressLocalStateUntil) return;
  if (!state.activeRoomId) return;

  sendWs({
    type: "player:pause",
    roomId: state.activeRoomId,
    originId: clientId,
    time: video.currentTime
  });
});

video.addEventListener("seeked", () => {
  if (applyingRemoteState) return;
  if (performance.now() < suppressLocalStateUntil) return;
  if (!state.activeRoomId) return;

  sendWs({
    type: "player:seek",
    roomId: state.activeRoomId,
    originId: clientId,
    time: video.currentTime
  });
});

window.addEventListener("beforeunload", () => {
  try {
    storeValue(STORAGE_KEYS.nickname, normalizeNickname(nicknameInput.value));
    saveJoinedRooms();
  } catch {}
});

void start();
