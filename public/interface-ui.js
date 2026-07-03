const EXTENSION_SEARCH_REQUEST = "WT_SEARCH_REQUEST";
const EXTENSION_RESOLVE_REQUEST = "WT_RESOLVE_PAGE_URL";
const PAGE_EVENT_EXTENSION_PING = "WT_EXTENSION_PING";
const PAGE_EVENT_MEDIA_FOUND = "WT_MEDIA_FOUND";
const PAGE_EVENT_SERIES_CONTEXT_FOUND = "WT_SERIES_CONTEXT_FOUND";
const PAGE_EVENT_EXTENSION_STATUS = "WT_EXTENSION_STATUS";
const PAGE_EVENT_EXTENSION_ERROR = "WT_EXTENSION_ERROR";
const PAGE_EVENT_SEARCH_RESULT_CLICKED = "WT_SEARCH_RESULT_CLICKED";

const STORAGE_KEYS = {
  joinedRooms: "watchTogether.joinedRooms",
  activeRoomId: "watchTogether.activeRoomId",
  nickname: "watchTogether.nickname",
  role: "watchTogether.role",
  authToken: "watchTogether.authToken",
  backendBaseUrl: "watchTogether.backendBaseUrl",
  clientId: "watchTogether.clientId"
};
const GUEST_NICKNAME_KEY = "watchTogether.guestNickname";
const ROOM_UI_STORAGE_PREFIX = "watchTogether.roomUi.";

const DEFAULT_BACKEND_BASE_URL = window.location.origin;

const requestedRole = new URLSearchParams(window.location.search).get("role");
const queryRoom = normalizeRoomCode(new URLSearchParams(window.location.search).get("room"));
const requestedPage = new URLSearchParams(window.location.search).get("page");
const requestedAuthMode = new URLSearchParams(window.location.search).get("auth");
const pageMode =
  requestedPage === "rooms" || window.location.pathname.replace(/\/+$/, "").endsWith("/rooms")
    ? "rooms"
    : "home";
document.body.dataset.view = pageMode === "rooms" ? "rooms" : queryRoom ? "room" : "home";
const clientId = loadStoredValue(STORAGE_KEYS.clientId) || crypto.randomUUID();
storeValue(STORAGE_KEYS.clientId, clientId);
let currentRole = "guest";
const backendBaseUrl = resolveBackendBaseUrl(
  new URLSearchParams(window.location.search).get("api") ||
    loadStoredValue(STORAGE_KEYS.backendBaseUrl) ||
    window.WATCH_TOGETHER_API_BASE_URL ||
    DEFAULT_BACKEND_BASE_URL
);

const EXTENSION_PROBE_TIMEOUT_MS = 500;
let pendingExtensionProbe = null;

function isLocalUiUrl(value) {
  return String(value || "").includes("localhost:3000");
}

function pickResolverPageUrl(...candidates) {
  for (const candidate of candidates) {
    if (typeof candidate !== "string" || !candidate) continue;
    if (isLocalUiUrl(candidate)) continue;
    return candidate;
  }
  return null;
}

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
const renameRoomButton = document.getElementById("renameRoomButton");
const deleteActiveRoomButton = document.getElementById("deleteActiveRoomButton");
const leaveRoomButton = document.getElementById("leaveRoomButton");
const sessionDuration = document.getElementById("sessionDuration");
const roomStatus = document.getElementById("roomStatus");
const currentMediaBadge = document.getElementById("currentMediaBadge");

const reconnectButton = document.getElementById("reconnectButton");
const searchInput = document.getElementById("searchInput");
const searchButton = document.getElementById("searchButton");
const searchHelpButton = document.getElementById("searchHelpButton");
const snifferToggle = document.getElementById("snifferToggle");
const searchHint = document.getElementById("searchHint");
const searchResultsWidget = document.getElementById("searchResultsWidget");
const searchResultsFrame = document.getElementById("searchResultsFrame");
const closeSearchWidget = document.getElementById("closeSearchWidget");
const playbackDebugLog = document.getElementById("playbackDebugLog");
const clearPlaybackDebugButton = document.getElementById("clearPlaybackDebugButton");

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
// qualityPicker, qualityPickerValue, and qualityButtonsEl were removed from the HTML because quality now lives in settings.
const qualityPicker = null;
const qualityPickerValue = null;
const qualityButtonsEl = null;

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

const topbarUser = document.getElementById("topbarUser");
const topbarNickDisplay = document.getElementById("topbarNickDisplay");
const topbarAvatarButton = document.getElementById("topbarAvatarButton");
const topbarAvatar = document.getElementById("topbarAvatar");
const topbarUserMenu = document.getElementById("topbarUserMenu");
const lastRoomButton = document.getElementById("lastRoomButton");
const guestIdentityCard = document.getElementById("guestIdentityCard");

const state = {
  ws: null,
  connected: false,
  authToken: loadStoredValue(STORAGE_KEYS.authToken) || null,
  currentUser: null,
  authMode: requestedAuthMode === "signup" ? "signup" : "signin",
  joinedRooms: loadJoinedRooms(),
  activeRoomId: queryRoom || loadStoredValue(STORAGE_KEYS.activeRoomId) || null,
  accountRoomCodes: [],
  pendingGuestRoomDetach: null,
  roomCreationInProgress: false,
  pendingNicknameBeforeSync: null,
  pendingRoomRenamePreviousTitle: null,
  pendingAutoplayRoomId: null,
  openParticipantMenuKey: null,
  topbarMenuOpen: false,
  extensionDetected: Boolean(window.anyTogetherSyncBridge),
  roomsDirectory: [],
  roomStates: new Map(),
  loadingRooms: false,
  authLoading: false
};

let _snifferEnabled = false;
let loadedMediaKey = null;
let pendingSearchStatusTimer = null;
let roomCodeHidden = false;
const pendingRoomJoins = new Set();
// Store the hash parameters (#t:56-s:2-e:1) so they can be applied after the series loads.
let _pendingRezkaHash = null;
let _lastLoadedMediaKey = "";
let _lastLoadBlockedUntil = 0;
let _lastLoadHadContext = false;

function resetLastLoadedMediaGuard() {
  _lastLoadedMediaKey = "";
  _lastLoadBlockedUntil = 0;
  _lastLoadHadContext = false;
}
let _lastSyncActiveRoomAt = 0;
let _searchPopupWindow = null;
const LOAD_BLOCK_DURATION_MS = 5000;
const SYNC_BLOCK_DURATION_MS = 2000;

{
  const storedNickname = loadStoredValue(STORAGE_KEYS.nickname);
  nicknameInput.value = storedNickname && storedNickname !== "Guest"
    ? storedNickname
    : getPersistentGuestNickname();
}
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

function loadCookieValue(name) {
  const prefix = `${encodeURIComponent(name)}=`;
  const parts = String(document.cookie || "").split(/;\s*/);
  for (const part of parts) {
    if (part.startsWith(prefix)) {
      return decodeURIComponent(part.slice(prefix.length));
    }
  }
  return null;
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

function loadRoomUiState(roomId) {
  const normalized = normalizeRoomCode(roomId);
  if (!normalized) return null;

  try {
    const raw = localStorage.getItem(`${ROOM_UI_STORAGE_PREFIX}${normalized}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    return {
      seasonId: Number.isFinite(Number(parsed.seasonId)) ? Number(parsed.seasonId) : null,
      episodeId: Number.isFinite(Number(parsed.episodeId)) ? Number(parsed.episodeId) : null,
      translatorId: Number.isFinite(Number(parsed.translatorId)) ? Number(parsed.translatorId) : null,
      qualityLabel: typeof parsed.qualityLabel === "string" && parsed.qualityLabel ? parsed.qualityLabel : null
    };
  } catch {
    return null;
  }
}

function saveRoomUiState(roomId, ui) {
  const normalized = normalizeRoomCode(roomId);
  if (!normalized) return;

  const payload = {
    seasonId: Number.isFinite(Number(ui?.seasonId)) ? Number(ui.seasonId) : null,
    episodeId: Number.isFinite(Number(ui?.episodeId)) ? Number(ui.episodeId) : null,
    translatorId: Number.isFinite(Number(ui?.translatorId)) ? Number(ui.translatorId) : null,
    qualityLabel: typeof ui?.qualityLabel === "string" && ui.qualityLabel ? ui.qualityLabel : null
  };

  try {
    localStorage.setItem(`${ROOM_UI_STORAGE_PREFIX}${normalized}`, JSON.stringify(payload));
  } catch {}
}

function storeCookieValue(name, value) {
  try {
    const cookieValue = value == null ? "" : encodeURIComponent(String(value));
    document.cookie = `${encodeURIComponent(name)}=${cookieValue}; path=/; max-age=31536000; samesite=lax`;
  } catch {}
}

function generateGuestNickname() {
  const suffix = Math.floor(10000 + Math.random() * 90000);
  return `Guest${suffix}`;
}

function getPersistentGuestNickname() {
  const storedNickname = loadStoredValue(GUEST_NICKNAME_KEY) || loadCookieValue(GUEST_NICKNAME_KEY);
  if (storedNickname && /^Guest\d{5}$/.test(storedNickname)) {
    storeValue(GUEST_NICKNAME_KEY, storedNickname);
    storeCookieValue(GUEST_NICKNAME_KEY, storedNickname);
    return storedNickname;
  }

  const nextNickname = generateGuestNickname();
  storeValue(GUEST_NICKNAME_KEY, nextNickname);
  storeCookieValue(GUEST_NICKNAME_KEY, nextNickname);
  return nextNickname;
}

function clearRoomUiState(roomId) {
  const normalized = normalizeRoomCode(roomId);
  if (!normalized) return;

  try {
    localStorage.removeItem(`${ROOM_UI_STORAGE_PREFIX}${normalized}`);
  } catch {}
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

function hasLocalExtension() {
  return state.extensionDetected || Boolean(window.anyTogetherSyncBridge);
}

function resolvePendingExtensionProbe(isDetected) {
  if (!pendingExtensionProbe) return;
  clearTimeout(pendingExtensionProbe.timerId);
  pendingExtensionProbe.resolve(Boolean(isDetected));
  pendingExtensionProbe = null;
}

function probeExtensionAvailability(timeoutMs = EXTENSION_PROBE_TIMEOUT_MS) {
  if (hasLocalExtension()) {
    return Promise.resolve(true);
  }

  if (pendingExtensionProbe) {
    return pendingExtensionProbe.promise;
  }

  let resolveProbe;
  const promise = new Promise((resolve) => {
    resolveProbe = resolve;
  });

  const timerId = window.setTimeout(() => {
    resolvePendingExtensionProbe(false);
  }, timeoutMs);

  pendingExtensionProbe = {
    promise,
    resolve: resolveProbe,
    timerId
  };

  try {
    window.postMessage(
      {
        type: PAGE_EVENT_EXTENSION_PING,
        payload: { pageUrl: window.location.href }
      },
      "*"
    );
  } catch {}

  return promise;
}

function getExtensionInstallUrl() {
  return String(window.WATCH_TOGETHER_EXTENSION_INSTALL_URL || window.WATCH_TOGETHER_EXTENSION_URL || "").trim();
}

function getSelfParticipant(roomState = getActiveRoomState()) {
  if (!roomState?.participants?.length) return null;
  return roomState.participants.find((participant) => isSelfParticipant(participant)) || null;
}

function isCurrentUserCreator(roomState = getActiveRoomState()) {
  const selfParticipant = getSelfParticipant(roomState);
  if (!selfParticipant) {
    return currentRole === "host";
  }

  return String(selfParticipant.role || "guest") === "host";
}

function canCurrentUserManageContent(roomState = getActiveRoomState()) {
  return hasLocalExtension();
}

function canCurrentUserManageParticipants(roomState = getActiveRoomState()) {
  return isCurrentUserCreator(roomState);
}

function getParticipantKey(participant) {
  return String(participant?.socketId || participant?.clientId || participant?.userId || participant?.nickname || "participant");
}

function createInlineIcon(kind) {
  if (kind === "eye-off") {
    return `
      <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <path d="M4.5 4.5 19.5 19.5" />
        <path d="M10.6 10.6a2.2 2.2 0 0 0 2.8 2.8" />
        <path d="M9.9 5.2A10.5 10.5 0 0 1 12 5c5.5 0 9.5 4.5 10.5 7-0.4 1-1.2 2.2-2.3 3.4" />
        <path d="M6.3 6.3C3.8 8 2.1 10.9 1.5 12c1 2.5 5 7 10.5 7 1.5 0 2.8-0.2 4-0.6" />
      </svg>
    `;
  }

  if (kind === "eye") {
    return `
      <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <path d="M2 12s3.8-7 10-7 10 7 10 7-3.8 7-10 7-10-7-10-7Z" />
        <circle cx="12" cy="12" r="3" />
      </svg>
    `;
  }

  if (kind === "gear") {
    return `
      <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <path d="M12 8.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7Z" />
        <path d="M19.4 13.5a7.7 7.7 0 0 0 .1-1.5 7.7 7.7 0 0 0-.1-1.5l2-1.5-2-3.5-2.4 1a8.5 8.5 0 0 0-2.6-1.5L14 2h-4l-.4 2.5A8.5 8.5 0 0 0 7 6L4.6 5 2.6 8.5l2 1.5a7.7 7.7 0 0 0-.1 1.5 7.7 7.7 0 0 0 .1 1.5l-2 1.5 2 3.5 2.4-1a8.5 8.5 0 0 0 2.6 1.5L10 22h4l.4-2.5a8.5 8.5 0 0 0 2.6-1.5l2.4 1 2-3.5-2-1.5Z" />
      </svg>
    `;
  }

  if (kind === "crown") {
    return `
      <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <path d="m4 7 4.5 4 3.5-6 3.5 6L20 7l-1.5 10h-13L4 7Z" />
        <path d="M6 17h12" />
      </svg>
    `;
  }

  if (kind === "access") {
    return `
      <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <circle cx="8.5" cy="11.5" r="3.2" />
        <path d="M11.2 12.2 20 12.2" />
        <path d="M16.3 12.2v2.8" />
        <path d="M18.2 12.2v1.9" />
      </svg>
    `;
  }

  return "";
}

function createIconButton(kind, className, title, ariaLabel, isOff = false) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = className;
  button.title = title;
  button.setAttribute("aria-label", ariaLabel);
  if (isOff) {
    button.classList.add("is-off");
  }
  button.innerHTML = createInlineIcon(kind);
  return button;
}

function getParticipantMenuKey(roomState, participant) {
  return `${roomState?.code || "room"}:${getParticipantKey(participant)}`;
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
  if (!element) return;
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

function formatDebugDetail(detail) {
  if (detail === null || detail === undefined || detail === "") return "";
  if (typeof detail === "string") return detail;

  if (typeof detail !== "object") {
    return String(detail);
  }

  return Object.entries(detail)
    .filter(([, value]) => value !== null && value !== undefined && value !== "")
    .map(([key, value]) => `${key}: ${typeof value === "object" ? JSON.stringify(value) : String(value)}`)
    .join(" | ");
}

function appendPlaybackDebugEntry(title, detail = "", isError = false) {
  if (!playbackDebugLog) return;

  const entry = document.createElement("article");
  entry.className = isError ? "playback-debug-entry is-error" : "playback-debug-entry";

  const heading = document.createElement("strong");
  heading.textContent = title;
  entry.appendChild(heading);

  const detailText = formatDebugDetail(detail);
  if (detailText) {
    const body = document.createElement("div");
    body.textContent = detailText;
    entry.appendChild(body);
  }

  const time = document.createElement("time");
  time.textContent = new Date().toLocaleTimeString();
  entry.appendChild(time);

  playbackDebugLog.prepend(entry);

  while (playbackDebugLog.children.length > 40) {
    playbackDebugLog.lastElementChild?.remove();
  }
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
      episodeId: null,
      translatorId: null,
      qualityLabel: null,
      ...loadRoomUiState(roomId)
    }
  };

  state.roomStates.set(roomId, fallback);
  return fallback;
}

function upsertRoomStateFromSnapshot(roomId, snapshot) {
  const existing = state.roomStates.get(roomId) || ensureRoomState(roomId);
  const previousMediaUrl = existing.currentMedia?.mediaUrl || null;
  const previousPlayback = existing.currentPlayback || { state: "paused", time: 0 };
  const previousSeriesContext = existing.currentMedia?.seriesContext || null;

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

  // Rebuild picker state when media changes, but keep the current selection when it still belongs to the same series.
  const mediaChanged = snapshot.currentMedia?.mediaUrl !== existing.currentMedia?.mediaUrl ||
    JSON.stringify(snapshot.currentMedia?.seriesContext) !== JSON.stringify(existing.currentMedia?.seriesContext);
  existing.currentMedia = snapshot.currentMedia || null;
  if (mediaChanged) {
    existing.ui = mergeUiFromSeriesContext(existing, existing.currentMedia?.seriesContext || null, previousSeriesContext);
  }

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

function buildSeriesContextSignature(seriesContext) {
  if (!seriesContext) return "";

  return JSON.stringify({
    title: seriesContext.title || null,
    currentSeasonId: seriesContext.currentSeasonId ?? null,
    currentEpisodeId: seriesContext.currentEpisodeId ?? null,
    selectedTranslatorId: seriesContext.selectedTranslatorId ?? null,
    selectedQualityLabel: seriesContext.selectedQualityLabel || null,
    seasons: Array.isArray(seriesContext.seasons) ? seriesContext.seasons.length : 0,
    episodes: Array.isArray(seriesContext.episodes) ? seriesContext.episodes.length : 0,
    translators: Array.isArray(seriesContext.translators) ? seriesContext.translators.length : 0,
    availableQualities: Array.isArray(seriesContext.availableQualities) ? seriesContext.availableQualities.length : 0
  });
}

function buildMediaLoadSignature(mediaUrl, masterPlaylistUrl, seriesContext) {
  return [
    String(mediaUrl || ""),
    String(masterPlaylistUrl || ""),
    buildSeriesContextSignature(seriesContext)
  ].join("::");
}

function getPendingEpisodeSelection(roomState) {
  const pending = roomState?.ui?._pendingEpisodeTarget || null;
  if (!pending) return null;
  const lockedUntil = Number(roomState?.ui?._pendingEpisodeLockedUntil);
  if (Number.isFinite(lockedUntil) && lockedUntil > 0 && Date.now() > lockedUntil) {
    clearPendingEpisodeSelection(roomState);
    return null;
  }
  const seasonId = Number(pending.seasonId);
  const episodeId = Number(pending.episodeId);
  if (!Number.isFinite(seasonId) || !Number.isFinite(episodeId)) return null;
  return {
    seasonId,
    episodeId
  };
}

function setPendingEpisodeSelection(roomState, targetEpisode, lockMs = 12000) {
  if (!roomState) return;
  const seasonId = Number(targetEpisode?.seasonId);
  const episodeId = Number(targetEpisode?.episodeId);
  if (!Number.isFinite(seasonId) || !Number.isFinite(episodeId)) return;
  roomState.ui = roomState.ui || createDefaultUi(roomState.currentMedia?.seriesContext || null);
  const existingPending = getPendingEpisodeSelection(roomState);
  const existingLockedUntil = Number(roomState.ui._pendingEpisodeLockedUntil || 0);
  if (
    existingPending &&
    Number.isFinite(existingLockedUntil) &&
    existingLockedUntil > Date.now() &&
    (existingPending.seasonId !== seasonId || existingPending.episodeId !== episodeId)
  ) {
    return;
  }
  roomState.ui._pendingEpisodeTarget = {
    seasonId,
    episodeId,
    requestedAt: Date.now()
  };
  roomState.ui._pendingEpisodeLockedUntil = Date.now() + Math.max(1000, lockMs);
}

function clearPendingEpisodeSelection(roomState) {
  if (roomState?.ui?._pendingEpisodeTarget) {
    delete roomState.ui._pendingEpisodeTarget;
  }
  if (roomState?.ui?._pendingEpisodeLockedUntil) {
    delete roomState.ui._pendingEpisodeLockedUntil;
  }
}

function getSeriesContextIdentity(seriesContext) {
  if (!seriesContext) return "";

  const resolverItemId = Number(seriesContext?.resolver?.itemId);
  if (Number.isFinite(resolverItemId)) {
    return `resolver:${resolverItemId}`;
  }

  const title = String(seriesContext?.title || "").trim().toLowerCase();
  if (title) {
    return `title:${title}`;
  }

  return "";
}

function isSameSeriesContext(left, right) {
  if (!left || !right) return false;

  const leftIdentity = getSeriesContextIdentity(left);
  const rightIdentity = getSeriesContextIdentity(right);
  if (!leftIdentity || !rightIdentity) return false;

  return leftIdentity === rightIdentity;
}

function mergeUiFromSeriesContext(roomState, seriesContext, previousSeriesContext = null) {
  const currentUi = roomState?.ui || {};
  const defaultUi = createDefaultUi(seriesContext);
  const seasons = Array.isArray(seriesContext?.seasons) ? seriesContext.seasons : [];
  const translators = Array.isArray(seriesContext?.translators) ? seriesContext.translators : [];
  const qualities = Array.isArray(seriesContext?.availableQualities) ? seriesContext.availableQualities : [];
  const pendingEpisode = getPendingEpisodeSelection(roomState);
  const preserveCurrentUi = isSameSeriesContext(previousSeriesContext, seriesContext);

  if (pendingEpisode) {
    return {
      seasonId: pendingEpisode.seasonId,
      episodeId: pendingEpisode.episodeId,
      translatorId:
        Number.isFinite(Number(seriesContext?.selectedTranslatorId)) &&
        translators.some((translator) => translator.translatorId === Number(seriesContext.selectedTranslatorId))
          ? Number(seriesContext.selectedTranslatorId)
          : (Number.isFinite(Number(currentUi.translatorId)) &&
            translators.some((translator) => translator.translatorId === Number(currentUi.translatorId))
              ? Number(currentUi.translatorId)
              : defaultUi.translatorId),
      qualityLabel:
        seriesContext?.selectedQualityLabel && qualities.some((quality) => quality.label === seriesContext.selectedQualityLabel)
          ? seriesContext.selectedQualityLabel
          : (currentUi.qualityLabel && qualities.some((quality) => quality.label === currentUi.qualityLabel)
            ? currentUi.qualityLabel
            : defaultUi.qualityLabel)
    };
  }

  const contextSeasonId = Number(seriesContext?.currentSeasonId);
  const currentSeasonId = Number(currentUi.seasonId);
  const hasContextSeason = Number.isFinite(contextSeasonId) && seasons.some((season) => season.seasonId === contextSeasonId);
  const hasCurrentSeason = Number.isFinite(currentSeasonId) && seasons.some((season) => season.seasonId === currentSeasonId);
  const seasonId = preserveCurrentUi && hasCurrentSeason
    ? currentSeasonId
    : (hasContextSeason && contextSeasonId != null
      ? contextSeasonId
      : (hasCurrentSeason ? currentSeasonId : defaultUi.seasonId));

  const activeSeasonId = Number(seasonId);
  const activeSeason = seasons.find((season) => season.seasonId === activeSeasonId) || seasons[0] || null;
  const activeSeasonEpisodes = Array.isArray(activeSeason?.episodes) ? activeSeason.episodes : [];

  const contextEpisodeId = Number(seriesContext?.currentEpisodeId);
  const currentEpisodeId = Number(currentUi.episodeId);
  const hasContextEpisode = Number.isFinite(contextEpisodeId) && activeSeasonEpisodes.some((episode) => episode.episodeId === contextEpisodeId);
  const hasCurrentEpisode = Number.isFinite(currentEpisodeId) && activeSeasonEpisodes.some((episode) => episode.episodeId === currentEpisodeId);
  const episodeId = preserveCurrentUi && hasCurrentEpisode
    ? currentEpisodeId
    : (hasContextEpisode
      ? contextEpisodeId
      : (hasCurrentEpisode ? currentEpisodeId : (activeSeasonEpisodes[0]?.episodeId ?? defaultUi.episodeId)));

  const contextTranslatorId = Number(seriesContext?.selectedTranslatorId);
  const translatorId = Number.isFinite(contextTranslatorId) && translators.some((translator) => translator.translatorId === contextTranslatorId)
    ? contextTranslatorId
    : (translators.some((translator) => translator.translatorId === Number(currentUi.translatorId))
      ? Number(currentUi.translatorId)
      : defaultUi.translatorId);

  const qualityLabel = seriesContext?.selectedQualityLabel && qualities.some((quality) => quality.label === seriesContext.selectedQualityLabel)
    ? seriesContext.selectedQualityLabel
    : (currentUi.qualityLabel && qualities.some((quality) => quality.label === currentUi.qualityLabel)
      ? currentUi.qualityLabel
      : defaultUi.qualityLabel);

  return {
    seasonId,
    episodeId,
    translatorId,
    qualityLabel
  };
}

function sanitizeRoomUi(roomState) {
  const seriesContext = roomState?.currentMedia?.seriesContext || null;
  const seasons = Array.isArray(seriesContext?.seasons) ? seriesContext.seasons : [];
  const translators = Array.isArray(seriesContext?.translators) ? seriesContext.translators : [];
  const qualities = Array.isArray(seriesContext?.availableQualities) ? seriesContext.availableQualities : [];
  const pendingEpisode = getPendingEpisodeSelection(roomState);

  if (!roomState.ui) {
    roomState.ui = createDefaultUi(seriesContext);
    return;
  }

  if (pendingEpisode) {
    roomState.ui.seasonId = pendingEpisode.seasonId;
    roomState.ui.episodeId = pendingEpisode.episodeId;
  } else {
    if (!seasons.some((season) => season.seasonId === Number(roomState.ui.seasonId))) {
      roomState.ui.seasonId = createDefaultUi(seriesContext).seasonId;
    }

    const activeSeasonId = Number(roomState.ui.seasonId);
    const activeSeason = seasons.find((season) => season.seasonId === activeSeasonId) || seasons[0] || null;
    const activeSeasonEpisodes = Array.isArray(activeSeason?.episodes) ? activeSeason.episodes : [];

    if (!activeSeasonEpisodes.some((episode) => episode.episodeId === Number(roomState.ui.episodeId))) {
      roomState.ui.episodeId = activeSeasonEpisodes[0]?.episodeId ?? createDefaultUi(seriesContext).episodeId;
    }
  }

  if (!translators.some((translator) => translator.translatorId === Number(roomState.ui.translatorId))) {
    roomState.ui.translatorId = createDefaultUi(seriesContext).translatorId;
  }

  if (!qualities.some((quality) => quality.label === roomState.ui.qualityLabel)) {
    roomState.ui.qualityLabel = createDefaultUi(seriesContext).qualityLabel;
  }

  saveRoomUiState(roomState.code, roomState.ui);
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
  activeRoomCodeToggleButton.innerHTML = createInlineIcon(roomCodeHidden ? "eye-off" : "eye");
  activeRoomCodeToggleButton.setAttribute(
    "aria-label",
    roomCodeHidden ? "Show room code" : "Hide room code"
  );
  activeRoomCodeToggleButton.title = roomCodeHidden ? "Show room code" : "Hide room code";
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
  if (topbarAvatarButton) topbarAvatarButton.setAttribute("aria-expanded", String(signedIn && state.topbarMenuOpen));
  if (topbarUserMenu) topbarUserMenu.classList.toggle("hidden", !(signedIn && state.topbarMenuOpen));
  if (!signedIn) {
    state.topbarMenuOpen = false;
  }
}

function closeTopbarMenu() {
  state.topbarMenuOpen = false;
  renderTopbarUser();
}

function updateLastRoomButton() {
  if (!lastRoomButton) return;
  const lastRoom = isAuthenticated()
    ? state.accountRoomCodes[0] || state.activeRoomId || state.joinedRooms[0] || loadStoredValue(STORAGE_KEYS.activeRoomId)
    : state.activeRoomId || state.joinedRooms[0] || loadStoredValue(STORAGE_KEYS.activeRoomId);
  const hasRoom = Boolean(lastRoom);
  lastRoomButton.classList.toggle("hidden", !hasRoom);
  if (lastRoom) lastRoomButton.setAttribute("data-room", lastRoom);
}

function setAccountRoomCodes(rooms) {
  const nextRooms = uniqueRoomCodes(
    (Array.isArray(rooms) ? rooms : [])
      .map((room) => normalizeRoomCode(room?.code || room?.roomId || room))
      .filter(Boolean)
  );

  state.accountRoomCodes = nextRooms;

  if (state.pendingGuestRoomDetach) {
    if (state.roomCreationInProgress) {
      updateLastRoomButton();
      return;
    }

    const guestRoomId = normalizeRoomCode(state.pendingGuestRoomDetach);
    if (guestRoomId && !nextRooms.includes(guestRoomId) && state.joinedRooms.includes(guestRoomId)) {
      state.joinedRooms = state.joinedRooms.filter((roomId) => roomId !== guestRoomId);
      saveJoinedRooms();
    }
    state.pendingGuestRoomDetach = null;
  }

  updateLastRoomButton();
}

function queueGuestRoomDetachAfterLogin(roomId) {
  const normalized = normalizeRoomCode(roomId);
  if (!normalized) return;

  state.pendingGuestRoomDetach = normalized;
  if (state.roomCreationInProgress) {
    return;
  }

  detachRoomAfterLogin(normalized);
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
  const qualities = Array.isArray(getActiveSeriesContext()?.availableQualities)
    ? getActiveSeriesContext().availableQualities
    : [];

  return qualities.filter((quality) => {
    const label = String(quality?.label || "").toLowerCase();
    return label && !label.includes("ultra");
  });
}

// Bridge for video.js settings panel to access quality data
window.__settingsGetAvailableQualities = function() {
  return getAvailableQualities();
};

window.__settingsGetActiveQualityLabel = function() {
  return getActiveUiState()?.qualityLabel || null;
};

window.__settingsSetQualityLabel = function(label) {
  const roomState = getActiveRoomState();
  if (!roomState) return;
  const qualities = getAvailableQualities();
  if (qualities.length > 0 && !qualities.some((quality) => quality.label === label)) {
    return;
  }
  
  // Save the playback position before the video is reloaded.
  const video = document.getElementById('player');
  if (video && Number.isFinite(video.currentTime) && video.currentTime > 0) {
    window._qualityChangePendingTime = video.currentTime;
    appendPlaybackDebugEntry("Quality save position", { time: video.currentTime.toFixed(2) });
  }
  
  roomState.ui.qualityLabel = label;
  // Update the picker display
  if (qualityPickerValue) {
    qualityPickerValue.textContent = label;
  }
  // Update quality indicator + lock in app.js
  if (window.updateQualityIndicator) {
    window.updateQualityIndicator(label, null);
  }
  // Tell app.js the user-requested quality so forceQualityLevel/applyPendingQuality can use it
  if (window._setSelectedQualityLabel) {
    window._setSelectedQualityLabel(label);
  }
  // Trigger resolution
  const selectedEpisode = getSelectedEpisodeForActions();
  if (selectedEpisode) {
    requestEpisodeResolution(selectedEpisode, {
      translatorId: roomState.ui.translatorId,
      qualityLabel: label
    });
  }
};

function getSelectedTranslatorTitle() {
  const translatorId = Number(getActiveUiState()?.translatorId);
  const translator = getTranslators().find((item) => item.translatorId === translatorId);
  return translator?.title || getActiveSeriesContext()?.selectedTranslatorTitle || null;
}

function getActiveSeasonId() {
  const pendingEpisode = getPendingEpisodeSelection(getActiveRoomState());
  if (pendingEpisode) {
    return pendingEpisode.seasonId;
  }

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
  const pendingEpisode = getPendingEpisodeSelection(getActiveRoomState());
  if (pendingEpisode) {
    const seasons = getSeasons();
    const lockedSeason = seasons.find((season) => season.seasonId === pendingEpisode.seasonId) || seasons[0] || null;
    const lockedEpisode = lockedSeason?.episodes?.find((episode) => episode.episodeId === pendingEpisode.episodeId) || null;
    if (lockedEpisode) {
      return lockedEpisode;
    }
  }

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
    return;
  }

  container.classList.add("is-visible");

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

    button.addEventListener("click", () => {
      onClick(item);
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
    if (qualityPickerValue) qualityPickerValue.textContent = "";
    seasonButtonsEl.textContent = "";
    translatorButtonsEl.textContent = "";
    seriesEpisodesEl.textContent = "";
    if (qualityButtonsEl) qualityButtonsEl.textContent = "";
    seasonPicker?.removeAttribute("open");
    episodePicker?.removeAttribute("open");
    translatorPicker?.removeAttribute("open");
    if (qualityPicker) qualityPicker?.removeAttribute("open");
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

  const qualities = getAvailableQualities();
  if (qualityPickerValue) {
    qualityPickerValue.textContent = ui.qualityLabel || (qualities.length > 0 ? qualities[0].label : "");
  }

  if (!seriesContext || seasons.length < 1) {
    seasonButtonsEl.textContent = "";
    translatorButtonsEl.textContent = "";
    seriesEpisodesEl.textContent = "";
    if (qualityButtonsEl) qualityButtonsEl.textContent = "";
    if (seasonPickerValue) seasonPickerValue.textContent = selectedSeasonTitle || "-";
    if (episodePickerValue) episodePickerValue.textContent = selectedEpisodeTitle || "-";
    if (translatorPickerValue) translatorPickerValue.textContent = selectedTranslatorTitle || "-";
    if (qualityPickerValue) qualityPickerValue.textContent = "";
    seasonButtonsEl.closest(".series-group")?.classList.remove("is-hidden");
    translatorButtonsEl.closest(".series-group")?.classList.remove("is-hidden");
    seriesEpisodesEl.closest(".series-group")?.classList.remove("is-hidden");
    if (qualityButtonsEl) qualityButtonsEl.closest(".series-group")?.classList.remove("is-hidden");
    seasonPicker?.removeAttribute("open");
    episodePicker?.removeAttribute("open");
    translatorPicker?.removeAttribute("open");
    if (qualityPicker) qualityPicker?.removeAttribute("open");
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
      if (!nextEpisode) return;
      // Guest sends request via sync engine; host resolves via extension
      if (!canCurrentUserManageContent(roomState) && window.__sendMediaRequest) {
        window.__sendMediaRequest({
          requestedSeasonId: nextEpisode.seasonId,
          requestedEpisodeId: nextEpisode.episodeId,
          requestedTranslatorId: roomState.ui.translatorId,
          requestedQualityLabel: roomState.ui.qualityLabel
        });
        appendPlaybackDebugEntry("Episode request sent to host", { seasonId: nextEpisode.seasonId, episodeId: nextEpisode.episodeId });
        return;
      }
      requestEpisodeResolution(nextEpisode, {
        translatorId: roomState.ui.translatorId,
        qualityLabel: roomState.ui.qualityLabel
      });
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
      if (!selectedEpisode) return;
      // Guest sends request via sync engine; host resolves via extension
      if (!canCurrentUserManageContent(roomState) && window.__sendMediaRequest) {
        window.__sendMediaRequest({
          requestedSeasonId: selectedEpisode.seasonId,
          requestedEpisodeId: selectedEpisode.episodeId,
          requestedTranslatorId: translator.translatorId,
          requestedQualityLabel: roomState.ui.qualityLabel
        });
        appendPlaybackDebugEntry("Translation request sent to host", { translatorId: translator.translatorId });
        return;
      }
      requestEpisodeResolution(selectedEpisode, {
        translatorId: roomState.ui.translatorId,
        qualityLabel: roomState.ui.qualityLabel
      });
    }
  );

  // Quality picker
  if (qualityButtonsEl && qualityPickerValue) {
    if (qualities.length > 0) {
      renderButtonGroup(
        qualityButtonsEl,
        qualities,
        ui.qualityLabel,
        (q) => q.label,
        (q) => q.label,
    (q) => {
      roomState.ui.qualityLabel = q.label;
      renderSeriesPanel();
      // Update quality indicator: show requested quality
      if (window.updateQualityIndicator) {
        window.updateQualityIndicator(q.label, null);
      }
      const selectedEpisode = getSelectedEpisodeForActions();
      if (!selectedEpisode) return;
      // Guest sends request via sync engine; host resolves via extension
      if (!canCurrentUserManageContent(roomState) && window.__sendMediaRequest) {
        window.__sendMediaRequest({
          requestedSeasonId: selectedEpisode.seasonId,
          requestedEpisodeId: selectedEpisode.episodeId,
          requestedTranslatorId: roomState.ui.translatorId,
          requestedQualityLabel: q.label
        });
        appendPlaybackDebugEntry("Quality request sent to host", { qualityLabel: q.label });
        return;
      }
      requestEpisodeResolution(selectedEpisode, {
        translatorId: roomState.ui.translatorId,
        qualityLabel: roomState.ui.qualityLabel
      });
    }
      );
    } else {
      qualityButtonsEl.textContent = "";
      qualityButtonsEl.classList.remove("is-visible");
      qualityButtonsEl.closest(".series-group")?.classList.add("is-hidden");
      if (qualityPicker) qualityPicker.removeAttribute("open");
    }
  }

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

    const isSelected = String(episode.episodeId) === String(roomState.ui.episodeId);

    if (isSelected) {
      button.classList.add("is-selected");
      button.setAttribute("aria-pressed", "true");
    } else {
      button.setAttribute("aria-pressed", "false");
    }

    button.addEventListener("click", () => {
      roomState.ui.seasonId = episode.seasonId || roomState.ui.seasonId;
      roomState.ui.episodeId = episode.episodeId;
      // Guest sends request via sync engine
      if (!canCurrentUserManageContent(roomState) && window.__sendMediaRequest) {
        window.__sendMediaRequest({
          requestedSeasonId: episode.seasonId,
          requestedEpisodeId: episode.episodeId,
          requestedTranslatorId: roomState.ui.translatorId,
          requestedQualityLabel: roomState.ui.qualityLabel
        });
        appendPlaybackDebugEntry("Episode request sent to host", { seasonId: episode.seasonId, episodeId: episode.episodeId });
        renderSeriesPanel();
        episodePicker?.removeAttribute("open");
        return;
      }
      requestEpisodeResolution(episode, {
        translatorId: roomState.ui.translatorId,
        qualityLabel: roomState.ui.qualityLabel
      });
      renderSeriesPanel();
      episodePicker?.removeAttribute("open");
    });

    seriesEpisodesEl.appendChild(button);
  });
}

function applyRoomSnapshot(roomId, snapshot) {
  const { roomState: existing, previousMediaUrl, previousPlayback } = upsertRoomStateFromSnapshot(roomId, snapshot);

  const activeRoomChanged = state.activeRoomId === roomId;
  if (activeRoomChanged) {
    resetLastLoadedMediaGuard();
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
    const participantMenuKey = getParticipantMenuKey(roomState, participant);
    item.dataset.participantKey = participantMenuKey;
    const isSelf = isSelfParticipant(participant);

    const actions = document.createElement("div");
    actions.className = "participant-actions";

    if (String(participant.role || "guest") === "host") {
      const hostBadge = document.createElement("span");
      hostBadge.className = "participant-status-icon participant-creator-icon";
      hostBadge.title = "Creator";
      hostBadge.innerHTML = createInlineIcon("crown");
      actions.appendChild(hostBadge);
    }

    if (String(participant.role || "guest") === "host" || participant.canManageContent !== false) {
      const accessBadge = document.createElement("span");
      accessBadge.className = "participant-status-icon participant-access-icon";
      accessBadge.title = "Content control access";
      accessBadge.innerHTML = createInlineIcon("access");
      actions.appendChild(accessBadge);
    }

    if (canCurrentUserManageParticipants(roomState) && !isSelf) {
      const settingsButton = createIconButton(
        "gear",
        "participant-icon-btn settings-btn",
        "Participant actions",
        "Participant actions"
      );
      settingsButton.addEventListener("click", (event) => {
        event.stopPropagation();
        const nextKey = participantMenuKey;
        state.openParticipantMenuKey = state.openParticipantMenuKey === nextKey ? null : nextKey;
        renderParticipants();
      });
      actions.appendChild(settingsButton);
    }

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
    if (isSelf) {
      name.classList.add("participant-name-editable");
      name.title = "Click to rename";
      name.setAttribute("aria-label", "Rename your nickname");
      name.addEventListener("click", () => promptParticipantNicknameChange(participant));
    }

    nameRow.appendChild(name);

    item.appendChild(actions);
    item.appendChild(avatarWrap);
    item.appendChild(nameRow);

    if (state.openParticipantMenuKey === participantMenuKey && canCurrentUserManageParticipants(roomState) && !isSelf) {
      const menu = document.createElement("div");
      menu.className = "participant-menu";

      const makeCreatorButton = document.createElement("button");
      makeCreatorButton.type = "button";
      makeCreatorButton.textContent = "Assign creator";
      makeCreatorButton.disabled = String(participant.role || "guest") === "host";
      makeCreatorButton.addEventListener("click", (event) => {
        event.stopPropagation();
        sendParticipantAction(participant, "make-creator");
      });

      const kickButton = document.createElement("button");
      kickButton.type = "button";
      kickButton.textContent = "Kick";
      kickButton.addEventListener("click", (event) => {
        event.stopPropagation();
        sendParticipantAction(participant, "kick");
      });

      menu.appendChild(makeCreatorButton);
      menu.appendChild(kickButton);

      const toggleContentButton = document.createElement("button");
      toggleContentButton.type = "button";
      toggleContentButton.textContent = participant.canManageContent === false ? "Grant content access" : "Revoke content access";
      toggleContentButton.disabled = participant.hasExtension === false;
      toggleContentButton.title = participant.hasExtension === false
        ? "Extension required to change media access"
        : toggleContentButton.textContent;
      toggleContentButton.addEventListener("click", (event) => {
        event.stopPropagation();
        if (participant.hasExtension === false) return;
        sendParticipantAction(participant, "toggle-content");
      });
      menu.appendChild(toggleContentButton);
      item.appendChild(menu);
    }

    participantsList.appendChild(item);
  });
}

function isSelfParticipant(participant) {
  if (!participant) return false;
  if (participant.clientId && participant.clientId === clientId) return true;
  if (state.currentUser?.id && participant.userId && participant.userId === state.currentUser.id) return true;
  return false;
}

function sendParticipantAction(participant, action) {
  const roomState = getActiveRoomState();
  if (!roomState || !participant?.clientId || !action) return;

  sendWs({
    type: "room:participant-action",
    roomId: roomState.code,
    targetClientId: participant.clientId,
    action
  });
  state.openParticipantMenuKey = null;
  renderParticipants();
}

async function promptParticipantNicknameChange(participant) {
  if (!isSelfParticipant(participant)) return;

  const currentName = normalizeNickname(nicknameInput.value);
  const rawName = window.prompt("Enter a new nickname", currentName);
  if (rawName === null) return;
  const nextName = normalizeNickname(rawName);
  if (!nextName || nextName === currentName) return;

  state.pendingNicknameBeforeSync = currentName;
  nicknameInput.value = nextName;
  storeValue(STORAGE_KEYS.nickname, nextName);
  if (state.currentUser) {
    state.currentUser.displayName = nextName;
  }
  for (const roomState of state.roomStates.values()) {
    if (!Array.isArray(roomState.participants)) continue;
    roomState.participants = roomState.participants.map((item) => {
      const isLocalParticipant =
        (item.clientId && item.clientId === clientId) ||
        (state.currentUser?.id && item.userId && item.userId === state.currentUser.id);
      return isLocalParticipant ? { ...item, nickname: nextName } : item;
    });
  }
  renderTopbarUser();
  updateGuestIdentityCard();
  renderParticipants();
  syncProfile();
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

function parseQualityValue(label) {
  const value = Number.parseInt(String(label || "").replace(/[^0-9]/g, ""), 10);
  return Number.isFinite(value) ? value : null;
}

function getPlayerQualityOptionsFromLevels(levels) {
  return Array.from(
    new Set(
      (Array.isArray(levels) ? levels : [])
        .map((level) => Number(level?.height))
        .filter((height) => Number.isFinite(height) && height > 0)
    )
  ).sort((a, b) => a - b);
}

function bridgeToSyncEngine() {
  const nextRoom = state.activeRoomId || "";
  const nextName = normalizeNickname(nicknameInput.value);
  const nextRole = currentRole || "guest";

  if (window.anyTogetherSyncBridge?.connectRoom) {
    window.anyTogetherSyncBridge.connectRoom(nextRoom, nextRole, nextName);
    return;
  }

  const roomInput = document.getElementById("roomInput");
  const displayNameInput = document.getElementById("displayName");
  const roleSelect = document.getElementById("roleSelect");
  const connectButton = document.getElementById("connectButton");

  if (!roomInput || !displayNameInput || !roleSelect || !connectButton) return;

  let changed = false;

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

  if (changed || connectButton.textContent === "Connect") {
    connectButton.click();
  }
}

function loadMedia(url) {
  const mediaUrl = String(url || "").trim();
  if (!mediaUrl) return false;

  const mediaUrlInput = document.getElementById("mediaUrl");
  if (mediaUrlInput && String(mediaUrlInput.value || "").trim() === mediaUrl) {
    appendPlaybackDebugEntry("Skipping media load", {
      reason: "same source already loaded",
      sourceUrl: mediaUrl
    });
    return true;
  }

  appendPlaybackDebugEntry("Forwarding media to player", mediaUrl);

  if (window.anyTogetherSyncBridge?.loadMedia) {
    try {
      const loaded = window.anyTogetherSyncBridge.loadMedia(mediaUrl);
      appendPlaybackDebugEntry(loaded ? "Player bridge accepted media" : "Player bridge rejected media", mediaUrl, !loaded);
      if (loaded) {
        return true;
      }
    } catch (error) {
      appendPlaybackDebugEntry("Player bridge failed", error?.message || String(error), true);
    }
  }

  const loadMediaButton = document.getElementById("loadMediaButton");

  if (!mediaUrlInput || !loadMediaButton) return false;

  if (mediaUrlInput.value !== mediaUrl) {
    mediaUrlInput.value = mediaUrl;
  }

  loadMediaButton.click();
  appendPlaybackDebugEntry("Legacy media control clicked", mediaUrl);
  return true;
}

function parseRezkaHash(hash) {
  // Format: #t:56-s:2-e:1
  if (!hash || !hash.startsWith('#')) return null;
  const result = {};
  // t:56
  const tMatch = hash.match(/t:(\d+)/);
  if (tMatch) result.translatorId = parseInt(tMatch[1], 10);
  // s:2
  const sMatch = hash.match(/s:(\d+)/);
  if (sMatch) result.seasonId = parseInt(sMatch[1], 10);
  // e:1
  const eMatch = hash.match(/e:(\d+)/);
  if (eMatch) result.episodeId = parseInt(eMatch[1], 10);
  return Object.keys(result).length > 0 ? result : null;
}

function isDirectMediaUrl(value) {
  try {
    const url = new URL(String(value || "").trim());
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return false;
    }

    return /\.(?:m3u8|mp4)(?:\?|$)/i.test(url.pathname + url.search);
  } catch {
    return false;
  }
}

function loadDirectMediaUrl(mediaUrl) {
  const roomId = state.activeRoomId;
  if (!roomId) {
    setSearchHint("Join or create a room first.", true);
    return false;
  }

  appendPlaybackDebugEntry("Direct media URL submitted", mediaUrl);
  updateRoomFromMediaPayload(roomId, {
    mediaUrl,
    pageUrl: mediaUrl,
    title: mediaUrl
  }, true);
  setSearchHint("Direct media URL loaded.");
  return true;
}

function clearMedia() {
  resetLastLoadedMediaGuard();
  const mediaUrlInput = document.getElementById("mediaUrl");
  if (mediaUrlInput) {
    mediaUrlInput.value = "";
  }
  if (currentMediaBadge) {
    currentMediaBadge.textContent = "";
    currentMediaBadge.classList.add("hidden");
  }
}

function applyPlaybackState() {}

function requestActiveRoomAutoplay(roomId) {
  const normalized = normalizeRoomCode(roomId);
  if (!normalized) return;

  state.pendingAutoplayRoomId = normalized;
}

function triggerPendingAutoplay(roomId) {
  const normalized = normalizeRoomCode(roomId);
  if (!normalized || state.pendingAutoplayRoomId !== normalized) {
    return;
  }

  state.pendingAutoplayRoomId = null;
  if (typeof window.__anyTogetherRequestAutoplay === "function") {
    window.__anyTogetherRequestAutoplay();
  }
}

function syncActiveRoomMedia(forceReload = false) {
  // Throttle: prevent repeated syncs within SYNC_BLOCK_DURATION_MS
  const now = Date.now();
  if (now < _lastSyncActiveRoomAt) {
    appendPlaybackDebugEntry("syncActiveRoomMedia throttled", { remainingMs: _lastSyncActiveRoomAt - now });
    return;
  }

  const roomState = getActiveRoomState();
  bridgeToSyncEngine();

  if (!roomState?.currentMedia?.mediaUrl) {
    if (state.pendingAutoplayRoomId === roomState?.code) {
      state.pendingAutoplayRoomId = null;
    }
    clearMedia();
    return;
  }

  const effectiveUrl = roomState.currentMedia.masterPlaylistUrl || roomState.currentMedia.mediaUrl;
  const mediaKey = `${roomState.code}:${effectiveUrl}`;
  const mediaUrlInput = document.getElementById("mediaUrl");
  const currentLoadedUrl = String(mediaUrlInput?.value || "").trim();
  const shouldAutoplay = state.pendingAutoplayRoomId === roomState.code;

  if (currentLoadedUrl && currentLoadedUrl === effectiveUrl) {
    loadedMediaKey = mediaKey;
    if (shouldAutoplay) {
      triggerPendingAutoplay(roomState.code);
    }
    return;
  }
  const shouldReload = forceReload || loadedMediaKey !== mediaKey;

  if (shouldReload) {
    _lastSyncActiveRoomAt = now + SYNC_BLOCK_DURATION_MS;
    // Save master playlist URL so loadManualMedia / loadSource can use it
    if (roomState.currentMedia.masterPlaylistUrl) {
      const masterUrl = roomState.currentMedia.masterPlaylistUrl;
      // Store in a data attribute on the mediaUrl input for loadManualMedia
      const mediaUrlInput = document.getElementById("mediaUrl");
      if (mediaUrlInput) {
        mediaUrlInput.dataset.masterPlaylistUrl = masterUrl;
      }
    }
    loadMedia(effectiveUrl);
    loadedMediaKey = mediaKey;
  }

  if (shouldAutoplay) {
    triggerPendingAutoplay(roomState.code);
  }

  if (currentMediaBadge) {
    currentMediaBadge.textContent = "";
    currentMediaBadge.classList.add("hidden");
  }
}

function updateSearchControls() {
  const roomState = getActiveRoomState();
  searchButton.disabled = !roomState;
  addToPlaylistButton.disabled = !roomState?.currentMedia?.mediaUrl;
  suggestButton.disabled = !roomState?.currentMedia?.mediaUrl;
  chatSendButton.disabled = !roomState;
  leaveRoomButton.disabled = !roomState;
  if (renameRoomButton) {
    renameRoomButton.classList.toggle("hidden", !(roomState && canCurrentUserManageParticipants(roomState)));
  }
  deleteActiveRoomButton.classList.toggle("hidden", !(roomState && canCurrentUserManageParticipants(roomState)));

  if (!roomState) {
    setSearchHint("Join or create a room to use playback controls.");
    searchHint.classList.remove("hidden");
    return;
  }

  if (!canCurrentUserManageContent(roomState)) {
    setSearchHint("Paste a direct media URL, or ask the creator to search.");
    searchHint.classList.remove("hidden");
    return;
  }

  setSearchHint("");
  searchHint.classList.add("hidden");
}

async function promptRoomRename() {
  const roomState = getActiveRoomState();
  if (!roomState || !canCurrentUserManageParticipants(roomState)) return;

  const rawTitle = window.prompt("Enter a new room name", roomState.title || "");
  if (rawTitle === null) return;
  const nextTitle = String(rawTitle).trim().replace(/\s+/g, " ");
  if (!nextTitle || nextTitle === roomState.title) return;

  state.pendingRoomRenamePreviousTitle = roomState.title || null;
  roomState.title = nextTitle.slice(0, 60);
  renderAll();
  sendWs({
    type: "room:rename",
    roomId: roomState.code,
    title: roomState.title,
    originId: clientId
  });
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

  if (state.pendingAutoplayRoomId === normalized) {
    state.pendingAutoplayRoomId = null;
  }

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

function detachRoomAfterLogin(roomId) {
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

  if (state.pendingAutoplayRoomId === normalized) {
    state.pendingAutoplayRoomId = null;
  }

  state.roomStates.delete(normalized);

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

  state.pendingGuestRoomDetach = null;
  renderAll();
}

function flushPendingGuestRoomDetach(nextRoomId = null) {
  const pendingRoomId = normalizeRoomCode(state.pendingGuestRoomDetach);
  if (!pendingRoomId) return;
  if (state.roomCreationInProgress) return;
  if (nextRoomId && pendingRoomId === normalizeRoomCode(nextRoomId)) {
    state.pendingGuestRoomDetach = null;
    return;
  }

  detachRoomAfterLogin(pendingRoomId);
}

async function deleteRoom(roomId) {
  const normalized = normalizeRoomCode(roomId);
  if (!normalized) return;

  if (!canCurrentUserManageParticipants(getActiveRoomState())) {
    setRoomStatus("Only the creator can delete a room.", true);
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

    if (state.pendingAutoplayRoomId === normalized) {
      state.pendingAutoplayRoomId = null;
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

    clearRoomUiState(normalized);
    await fetchRoomsDirectory();
    renderAll();
    setRoomStatus(`Deleted room ${normalized}`);
    window.location.href = getRoomExitUrl();
  } catch (error) {
    setRoomStatus(error.message, true);
  }
}

function syncProfile() {
  let nickname = normalizeNickname(nicknameInput.value);
  if (nickname === "Guest") {
    nickname = getPersistentGuestNickname();
  }
  nicknameInput.value = nickname;
  storeValue(STORAGE_KEYS.nickname, nickname);
  storeValue(STORAGE_KEYS.role, currentRole);
  renderTopbarUser();
  const canManageContent = canCurrentUserManageContent();

  if (state.ws && state.ws.readyState === WebSocket.OPEN) {
    state.joinedRooms.forEach((roomId) => {
      sendWs({
      type: "room:profile",
      roomId,
      nickname,
      canManageContent,
      hasExtension: hasLocalExtension(),
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
    if (isAuthenticated()) {
      setAccountRoomCodes(state.roomsDirectory);
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
    queueGuestRoomDetachAfterLogin(state.activeRoomId || null);
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
  nicknameInput.value = getPersistentGuestNickname();
  storeValue(STORAGE_KEYS.nickname, nicknameInput.value);
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
  state.roomCreationInProgress = true;
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

    requestActiveRoomAutoplay(roomCode);
    applyLocalRoomJoin(roomCode, data.room || null, true);
    createdRoomCodeValue.textContent = roomCode;
    createdRoomCodeButton.classList.remove("hidden");
    sendJoinMessage(roomCode);
    flushPendingGuestRoomDetach(roomCode);
    setCreateHint(`Room created: ${roomCode}`);
    window.location.href = resolvePageUrl(`./?room=${encodeURIComponent(roomCode)}`);
    if (isAuthenticated()) {
      await fetchRoomsDirectory();
    }
  } catch (error) {
    setCreateHint(error.message, true);
  } finally {
    state.roomCreationInProgress = false;
  }
}

async function handleRoomJoin(roomCode, options = {}) {
  const normalized = normalizeRoomCode(roomCode);
  if (!normalized) {
    setJoinHint("Enter a room code", true);
    return false;
  }

  syncProfile();
  requestActiveRoomAutoplay(normalized);
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
      canManageContent: canCurrentUserManageContent(),
      hasExtension: hasLocalExtension(),
      clientId
    })
  );
  pendingRoomJoins.delete(normalized);
  return true;
}

function updateRoomFromMediaPayload(roomId, payload, shouldBroadcast) {
  const normalized = normalizeRoomCode(roomId);
  if (!normalized) return;

  const roomState = ensureRoomState(normalized);
  const previousMedia = roomState.currentMedia || null;
  const previousSeriesContext = previousMedia?.seriesContext || null;
  const nextSeriesContext = payload.seriesContext ?? previousMedia?.seriesContext ?? null;
  const nextPageUrl = pickResolverPageUrl(
    payload.pageUrl,
    nextSeriesContext?.resolver?.pageUrl,
    previousMedia?.pageUrl,
    previousMedia?.sourcePageUrl
  );
  const nextSourcePageUrl = pickResolverPageUrl(
    payload.sourcePageUrl,
    nextSeriesContext?.resolver?.pageUrl,
    previousMedia?.sourcePageUrl,
    previousMedia?.pageUrl
  );
  roomState.currentMedia = {
    mediaUrl: payload.mediaUrl,
    masterPlaylistUrl: payload.masterPlaylistUrl || previousMedia?.masterPlaylistUrl || null,
    pageUrl: nextPageUrl,
    sourcePageUrl: nextSourcePageUrl,
    title: payload.title || nextSeriesContext?.title || previousMedia?.title || null,
    seriesContext: nextSeriesContext,
    updatedAt: Date.now(),
    addedToPlaylistId: payload.addedToPlaylistId || null
  };
  if (payload.seriesContext) {
    roomState.ui = mergeUiFromSeriesContext(roomState, nextSeriesContext, previousSeriesContext);
  } else if (!roomState.ui) {
    roomState.ui = createDefaultUi(nextSeriesContext);
  }
  roomState.currentPlayback = {
    state: "paused",
    time: 0,
    updatedAt: Date.now()
  };
  sanitizeRoomUi(roomState);

  const pendingEpisode = getPendingEpisodeSelection(roomState);
  const payloadSeasonId = Number(nextSeriesContext?.currentSeasonId);
  const payloadEpisodeId = Number(nextSeriesContext?.currentEpisodeId);
  if (
    pendingEpisode &&
    Number.isFinite(payloadSeasonId) &&
    Number.isFinite(payloadEpisodeId) &&
    pendingEpisode.seasonId === payloadSeasonId &&
    pendingEpisode.episodeId === payloadEpisodeId
  ) {
    clearPendingEpisodeSelection(roomState);
  }

  state.roomStates.set(normalized, roomState);
  appendPlaybackDebugEntry("Room media updated", {
    roomId: normalized,
    mediaUrl: payload.mediaUrl,
    title: payload.title || nextSeriesContext?.title || "unknown",
    hasSeriesContext: payload.seriesContext ? "yes" : "no",
    preservedSeriesContext: !payload.seriesContext && previousMedia?.seriesContext ? "yes" : "no"
  });

  const previousLoadSignature = previousMedia
    ? buildMediaLoadSignature(previousMedia.mediaUrl, previousMedia.masterPlaylistUrl, previousSeriesContext)
    : null;
  const nextLoadSignature = buildMediaLoadSignature(payload.mediaUrl, payload.masterPlaylistUrl, nextSeriesContext);
  const shouldReloadPlayer = !previousMedia || previousLoadSignature !== nextLoadSignature;

  if (state.activeRoomId === normalized && shouldReloadPlayer) {
    refreshActiveRoom();
    syncActiveRoomMedia(true);
  }

  if (shouldBroadcast) {
    sendWs({
      type: "media:set",
      roomId: normalized,
      mediaUrl: payload.mediaUrl,
      pageUrl: payload.pageUrl || previousMedia?.pageUrl || null,
      title: payload.title || nextSeriesContext?.title || null,
      seriesContext: nextSeriesContext,
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
  const pageUrl = pickResolverPageUrl(
    roomState?.currentMedia?.pageUrl,
    roomState?.currentMedia?.sourcePageUrl,
    seriesContext?.resolver?.pageUrl,
    roomState?.currentMedia?.mediaUrl
  );

  if (!roomId || !seriesContext) {
    setSearchHint("Load a series before switching episodes.", true);
    return;
  }

  // Clear the load guards so the newly requested URL is not ignored.
  setPendingEpisodeSelection(roomState, targetEpisode);
  _lastLoadedMediaKey = "";
  _lastLoadBlockedUntil = 0;

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

  // The extension returns the response with the request roomId.
  // Keep the current room active if the stored room id has not updated yet.
  // Otherwise the result is ignored by the WT_MEDIA_FOUND handler.
  // Mark the current room as active immediately before sending the request.
  state.activeRoomId = roomId;
  storeValue(STORAGE_KEYS.activeRoomId, roomId);

  // Check if the query is a URL (from a clicked search result)
  const isUrl = query.startsWith("http://") || query.startsWith("https://");

  if (isUrl) {
    console.log("[Interface UI] sendSearchToExtension: Query is a URL, sending RESOLVE_REQUEST for:", query);
    setSearchHint(`Resolving media from URL: "${query}"...`);
    armPendingSearchStatusTimer(query);

    window.postMessage(
      {
        type: EXTENSION_RESOLVE_REQUEST,
        payload: { pageUrl: query, roomId }
      },
      "*"
    );

    setSearchHint(`Resolution request sent for: ${query}`);
  } else {
    console.log("[Interface UI] sendSearchToExtension: Query is not a URL, sending SEARCH_REQUEST for:", query);
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
}

function sendUrlToExtensionForResolution(url) {
  const roomId = state.activeRoomId;
  if (!roomId) {
    setSearchHint("Join or create a room first.", true);
    return;
  }

  // Ensure the current room is active
  state.activeRoomId = roomId;
  storeValue(STORAGE_KEYS.activeRoomId, roomId);

  console.log("[Interface UI] sendUrlToExtensionForResolution: Sending RESOLVE_REQUEST for:", url);
  setSearchHint(`Resolving media from clicked result: "${url}"...`);
  armPendingSearchStatusTimer(url);

  window.postMessage(
    {
      type: EXTENSION_RESOLVE_REQUEST,
      payload: { pageUrl: url, roomId }
    },
    "*"
  );

  appendPlaybackDebugEntry("URL resolution request sent", { url: url.substring(0, 80) });
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
      if (isAuthenticated()) {
        setAccountRoomCodes(state.roomsDirectory);
      }
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

    if (msg.type === "room:profile-rejected") {
      if (state.pendingNicknameBeforeSync) {
        nicknameInput.value = state.pendingNicknameBeforeSync;
        storeValue(STORAGE_KEYS.nickname, state.pendingNicknameBeforeSync);
        if (state.currentUser) {
          state.currentUser.displayName = state.pendingNicknameBeforeSync;
        }
        state.pendingNicknameBeforeSync = null;
        renderTopbarUser();
        updateGuestIdentityCard();
      }
      setRoomStatus(msg.reason || "Unable to update nickname", true);
      return;
    }

    if (msg.type === "room:rename-rejected") {
      const roomId = normalizeRoomCode(msg.roomId);
      if (roomId && state.pendingRoomRenamePreviousTitle && state.activeRoomId === roomId) {
        const roomState = getRoomState(roomId);
        if (roomState) {
          roomState.title = state.pendingRoomRenamePreviousTitle;
        }
        state.pendingRoomRenamePreviousTitle = null;
        renderAll();
      }
      setRoomStatus(msg.reason || "Unable to rename room", true);
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

      const prevRoomState = getRoomState(roomId);
      const prevSeriesContext = prevRoomState?.currentMedia?.seriesContext
        ? JSON.parse(JSON.stringify(prevRoomState.currentMedia.seriesContext))
        : null;
      const prevUi = prevRoomState ? { ...prevRoomState.ui } : null;
      
      updateRoomFromMediaPayload(roomId, msg, false);
      
      const newRoomState = getRoomState(roomId);
      const newSeriesContext = newRoomState?.currentMedia?.seriesContext || null;
      const seriesChanged = JSON.stringify(newSeriesContext) !== JSON.stringify(prevSeriesContext);

      if (prevUi && newRoomState && seriesChanged) {
        newRoomState.ui = createDefaultUi(newRoomState.currentMedia?.seriesContext || null);
        sanitizeRoomUi(newRoomState);
      }
      return;
    }

    if (msg.roomId !== state.activeRoomId || msg.originId === clientId) {
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
    requestActiveRoomAutoplay(queryRoom);
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
  clearPlaybackDebugButton?.addEventListener("click", () => {
    if (playbackDebugLog) {
      playbackDebugLog.textContent = "";
    }
  });
  signOutButton.addEventListener("click", signOutAccount);
  topbarAvatarButton?.addEventListener("click", (event) => {
    event.stopPropagation();
    if (!isAuthenticated()) return;
    state.topbarMenuOpen = !state.topbarMenuOpen;
    renderTopbarUser();
  });
  lastRoomButton?.addEventListener("click", () => {
    const roomCode = lastRoomButton.getAttribute("data-room") || state.activeRoomId || state.joinedRooms[0];
    if (roomCode) window.location.href = resolvePageUrl(`./?room=${encodeURIComponent(roomCode)}`);
  });
  deleteActiveRoomButton.addEventListener("click", () => {
    if (state.activeRoomId) {
      deleteRoom(state.activeRoomId);
    }
  });
  renameRoomButton?.addEventListener("click", promptRoomRename);
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
  document.addEventListener("click", (event) => {
    if (state.topbarMenuOpen && !event.target.closest(".topbar-user")) {
      closeTopbarMenu();
    }
  });
  document.addEventListener("click", (event) => {
    if (!state.openParticipantMenuKey) return;
    if (event.target.closest(".participant-actions")) return;
    if (event.target.closest(".participant-menu")) return;
    state.openParticipantMenuKey = null;
    renderParticipants();
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

  // Sniffer toggle button
  if (snifferToggle) {
    // Restore persisted state
    try {
      const saved = localStorage.getItem('watchTogether.snifferEnabled');
      _snifferEnabled = saved === 'true';
    } catch {}
    snifferToggle.classList.toggle('is-active', _snifferEnabled);

    snifferToggle.addEventListener("click", () => {
      _snifferEnabled = !_snifferEnabled;
      snifferToggle.classList.toggle('is-active', _snifferEnabled);
      try {
        localStorage.setItem('watchTogether.snifferEnabled', String(_snifferEnabled));
      } catch {}
      appendPlaybackDebugEntry(_snifferEnabled ? "Sniffer enabled" : "Sniffer disabled", {});
      setSearchHint(_snifferEnabled ? "Media sniffing enabled — open other tabs with video" : "Media sniffing disabled");
      
      // Notify background.js about the state change via content-script bridge
      try {
        window.postMessage({
          type: "WT_SNIFFER_STATE",
          payload: { active: _snifferEnabled }
        }, "*");
      } catch(e) {}
    });
  }

  // Close search widget
  if (closeSearchWidget) {
    closeSearchWidget.addEventListener("click", () => {
      if (searchResultsWidget) {
        searchResultsWidget.classList.add("hidden");
      }
      if (searchResultsFrame) {
        searchResultsFrame.src = "about:blank";
      }
    });
  }

  searchButton.addEventListener("click", async () => {
    const query = searchInput.value.trim();
    if (!query) {
      setSearchHint("Enter a search query", true);
      return;
    }

    if (isDirectMediaUrl(query)) {
      loadDirectMediaUrl(query);
      return;
    }

      // Detect a Rezka hash such as #t:56-s:2-e:1.
    let hashParams = null;
    try {
      const url = new URL(query);
      hashParams = parseRezkaHash(url.hash);
    } catch {}
    
    // Keep the hash so it can be applied after the series media finishes loading.
    _pendingRezkaHash = hashParams;
    if (hashParams) {
      appendPlaybackDebugEntry("Rezka hash saved for later", hashParams);
    }

    if (!canCurrentUserManageContent()) {
      await probeExtensionAvailability();
      if (!hasLocalExtension()) {
        const extensionInstallUrl = getExtensionInstallUrl();
        setSearchHint(
          extensionInstallUrl
            ? `Extension required to search media. Install it here: ${extensionInstallUrl}`
            : "Extension required to search media. Install the extension and try again.",
          true
        );
      } else {
        setSearchHint("Only users with media access can search media.", true);
      }
      return;
    }

    _lastLoadedMediaKey = "";

    // Option D: Open DuckDuckGo search directly in popup window (not iframe)
    const searchUrl = 'https://html.duckduckgo.com/html/?q=' + encodeURIComponent(query);
    
    const features = [
      'width=' + Math.round(window.screen.width/1.5),
      'height=' + Math.round(window.screen.height/1.5),
      'left=' + Math.round(window.screen.width/4),
      'top=' + Math.round(window.screen.height/4),
      'popup=yes',
      'noopener=yes'
    ];
    if (_searchPopupWindow && !_searchPopupWindow.closed) {
      try { _searchPopupWindow.close(); } catch {}
    }
    _searchPopupWindow = window.open(searchUrl, 'AnyTogetherSearch', features.join(','));
    appendPlaybackDebugEntry("Search opened in popup", { query, url: searchUrl });

    // Hide iframe widget since we're using popup instead
    if (searchResultsWidget) {
      searchResultsWidget.classList.add("hidden");
    }
    if (searchResultsFrame) {
      searchResultsFrame.src = "about:blank";
    }

    // Don't send automatic SEARCH_REQUEST — that triggers hidden tab parsing.
    // User clicks on a result naturally in the popup, then we parse only that site.
  });

  searchInput.addEventListener("keydown", (event) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    searchButton.click();
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
  renderAll();
  connectWs();
  await fetchRoomsDirectory();
  startUiClock();

  if (state.activeRoomId) {
    refreshActiveRoom();
  }

  appendPlaybackDebugEntry("Debug log ready", "Playback events will appear here.");
  window.addEventListener("anytogether:sync-log", (event) => {
    appendPlaybackDebugEntry(event.detail?.title || "Playback event", event.detail?.detail || "");
  });

  window.addEventListener("message", (event) => {
    // Allow messages from:
    // - same window (window.postMessage from us)
    // - our search iframe (iframe.contentWindow)
    // - top/parent window (content-script in iframe posts to window.top)
    // - any cross-origin message with known WT_ type
    if (event.source !== window && event.source !== searchResultsFrame?.contentWindow && event.source !== window.top && event.source !== window.parent) {
      // Accept any cross-origin message as long as it has a known WT_ type
      if (!event.data?.type || !event.data?.type.startsWith("WT_")) return;
    }

    console.log("[Interface UI] Message received:", event.data?.type);
    if (event.data?.type === PAGE_EVENT_SERIES_CONTEXT_FOUND) {
      const payload = event.data?.payload || {};
      const roomId = normalizeRoomCode(payload.roomId) || state.activeRoomId;
      const seriesContext = payload.seriesContext || null;

      appendPlaybackDebugEntry("Series context found", {
        roomId: roomId || "unknown",
        pageUrl: (payload.pageUrl || "").substring(0, 80) || "null",
        seasonCount: Array.isArray(seriesContext?.seasons) ? seriesContext.seasons.length : 0,
        episodeCount: Array.isArray(seriesContext?.episodes) ? seriesContext.episodes.length : 0,
        translatorCount: Array.isArray(seriesContext?.translators) ? seriesContext.translators.length : 0
      });

      if (!roomId || !seriesContext) {
        return;
      }

      const roomState = ensureRoomState(roomId);
      const previousMedia = roomState.currentMedia || null;
      const previousSeriesContext = previousMedia?.seriesContext || null;
      const nextSeriesContext = seriesContext;
      const nextSeasonId = Number(seriesContext?.currentSeasonId);
      const nextEpisodeId = Number(seriesContext?.currentEpisodeId);
      if (Number.isFinite(nextSeasonId) && Number.isFinite(nextEpisodeId)) {
        setPendingEpisodeSelection(roomState, { seasonId: nextSeasonId, episodeId: nextEpisodeId }, 12000);
      }
      roomState.currentMedia = {
        mediaUrl: previousMedia?.mediaUrl || null,
        masterPlaylistUrl: previousMedia?.masterPlaylistUrl || null,
        pageUrl: payload.pageUrl || previousMedia?.pageUrl || null,
        sourcePageUrl: payload.sourcePageUrl || previousMedia?.sourcePageUrl || null,
        title: nextSeriesContext?.title || previousMedia?.title || null,
        seriesContext: nextSeriesContext,
        updatedAt: Date.now(),
        addedToPlaylistId: previousMedia?.addedToPlaylistId || null
      };
      roomState.ui = mergeUiFromSeriesContext(roomState, seriesContext, previousSeriesContext);
      sanitizeRoomUi(roomState);

      const pendingEpisode = getPendingEpisodeSelection(roomState);
      const contextSeasonId = Number(seriesContext?.currentSeasonId);
      const contextEpisodeId = Number(seriesContext?.currentEpisodeId);
      if (
        pendingEpisode &&
        Number.isFinite(contextSeasonId) &&
        Number.isFinite(contextEpisodeId) &&
        pendingEpisode.seasonId === contextSeasonId &&
        pendingEpisode.episodeId === contextEpisodeId
      ) {
        clearPendingEpisodeSelection(roomState);
      }

      state.roomStates.set(roomId, roomState);

      if (state.activeRoomId === roomId) {
        refreshActiveRoom();
      }
      return;
    }

    if (event.data?.type === PAGE_EVENT_MEDIA_FOUND) {
      console.log("[Interface UI] PAGE_EVENT_MEDIA_FOUND payload:", event.data?.payload?.mediaUrl?.substring(0, 80));
      clearPendingSearchStatusTimer();
      const payload = event.data?.payload || {};
      const incomingRoomId = normalizeRoomCode(payload.roomId);

      appendPlaybackDebugEntry("Extension media found", {
        roomId: incomingRoomId || "unknown",
        activeRoomId: state.activeRoomId || "none",
        mediaUrl: payload.mediaUrl || null,
        masterPlaylistUrl: payload.masterPlaylistUrl || null,
        pageUrl: payload.pageUrl || null,
        sourcePageUrl: payload.sourcePageUrl || null,
        title: payload.title || payload.seriesContext?.title || null
      }, !payload.mediaUrl);

      let effectiveRoomId = incomingRoomId;
      if (!effectiveRoomId) {
        if (!payload.mediaUrl) return;
        effectiveRoomId = state.activeRoomId;
        if (!effectiveRoomId) return;
        appendPlaybackDebugEntry("Iframe auto-resolve accepted", { mediaUrl: payload.mediaUrl.substring(0, 80) });
      } else if (effectiveRoomId !== state.activeRoomId) {
        return;
      }

      const roomState = ensureRoomState(effectiveRoomId);

      const mediaUrl = payload.mediaUrl || "";
      // Only skip if same URL is already playing
      const video = document.getElementById('player');
      if (video && Number.isFinite(video.currentTime) && video.currentTime > 1 && !video.paused && mediaUrl === _lastLoadedMediaKey) {
        appendPlaybackDebugEntry("Ignoring same URL already playing", { url: mediaUrl.substring(0, 80) });
        return;
      }

      const now = Date.now();
      
      // Treat the payload as contextual only when it exposes seasons or episodes.
      const hasSeriesContext = payload.seriesContext && 
        (Array.isArray(payload.seriesContext.seasons) || Array.isArray(payload.seriesContext.episodes));
      
      // Allow a contextual payload to replace a previous context-free load.
      // If the same contextual URL arrives again, ignore it.
      if (mediaUrl === _lastLoadedMediaKey) {
        if (_lastLoadHadContext) {
          appendPlaybackDebugEntry("Ignoring duplicate media URL (already loaded with context)", { url: mediaUrl.substring(0, 80) });
          return;
        }
        // The same URL first arrived without context and now carries context, so allow the refresh.
        if (hasSeriesContext) {
          appendPlaybackDebugEntry("Replacing URL with series context", { url: mediaUrl.substring(0, 80) });
          _lastLoadBlockedUntil = 0;
        }
      }
      
      // Throttle repeated loads within a 5 second window unless the guard was cleared above.
      if (now < _lastLoadBlockedUntil) {
        appendPlaybackDebugEntry("Load throttled (5s window)", { url: mediaUrl.substring(0, 80), remainingMs: _lastLoadBlockedUntil - now });
        return;
      }
      
      _lastLoadedMediaKey = mediaUrl;
      _lastLoadBlockedUntil = now + LOAD_BLOCK_DURATION_MS;
      _lastLoadHadContext = hasSeriesContext;

      
      // Show selected quality from extension in indicator
      const selectedLabel = payload.seriesContext?.selectedQualityLabel || null;
      
      appendPlaybackDebugEntry("Extension payload received", {
        masterPlaylistUrl: payload.masterPlaylistUrl || "null",
        mediaUrl: (payload.mediaUrl || "").substring(0, 80),
        pageUrl: (payload.pageUrl || "").substring(0, 80) || "null",
        availQualities: payload.seriesContext?.availableQualities?.length || "none",
        hasSeriesContext: payload.seriesContext ? "yes" : "no",
        selectedQuality: selectedLabel || "not specified"
      });
      
      updateRoomFromMediaPayload(effectiveRoomId, payload, true);

      // Apply any deferred translator, season, or episode hash.
      if (_pendingRezkaHash) {
        const hash = _pendingRezkaHash;
        const rs = getRoomState(effectiveRoomId);
        if (rs) {
          if (hash.translatorId) rs.ui.translatorId = hash.translatorId;
          if (hash.seasonId) rs.ui.seasonId = hash.seasonId;
          if (hash.episodeId) rs.ui.episodeId = hash.episodeId;
          appendPlaybackDebugEntry("Rezka hash applied after media load", hash);
          renderSeriesPanel();
          const episode = getSelectedEpisodeForActions();
          if (episode) {
            requestEpisodeResolution(episode, {
              translatorId: rs.ui.translatorId,
              qualityLabel: rs.ui.qualityLabel
            });
          }
        }
        _pendingRezkaHash = null;
      }
      
      // After updateRoomFromMediaPayload, roomState.ui.qualityLabel is now set via sanitizeRoomUi
      // Force sync it to app.js BEFORE syncActiveRoomMedia triggers hls.js
      const roomStateAfterLoad = getRoomState(effectiveRoomId);
      const qualityToUse = selectedLabel || roomStateAfterLoad?.ui?.qualityLabel || null;
      if (qualityToUse && window._setSelectedQualityLabel) {
        window._setSelectedQualityLabel(qualityToUse);
        if (window.updateQualityIndicator) {
          window.updateQualityIndicator(qualityToUse, null);
        }
        appendPlaybackDebugEntry("Quality label synced to app.js", {
          source: selectedLabel ? 'extension' : 'ui',
          label: qualityToUse
        });
      }

      const resolveSourcePageUrl = payload.sourcePageUrl || payload.pageUrl || null;
      const looksLikeStreamUrl = /(?:stream|crimson|red|indigo)\.voidboost\.cc|\.m3u8(?:\?|$)|\.mp4(?:\?|$)/i.test(resolveSourcePageUrl || "");

      if (payload.seriesContext == null && resolveSourcePageUrl && /rezka/i.test(resolveSourcePageUrl) && !looksLikeStreamUrl) {
          const currentRs = getRoomState(effectiveRoomId);
        if (
          currentRs?.ui &&
          !currentRs.currentMedia?.seriesContext &&
          currentRs.ui._seriesContextRefreshRequestedFor !== resolveSourcePageUrl
        ) {
          currentRs.ui._seriesContextRefreshRequestedFor = resolveSourcePageUrl;
          appendPlaybackDebugEntry("Series context refresh requested", {
            pageUrl: resolveSourcePageUrl.substring(0, 80)
          });
          sendUrlToExtensionForResolution(resolveSourcePageUrl);
        }
      }

      // Only retry quality selection for context-free Rezka loads.
      // When the popup already provided a full series context, the media is already resolved.
      if (!selectedLabel && !payload.seriesContext) {
        try {
          const roomState = getRoomState(effectiveRoomId);
          const resolverProvider = roomState?.currentMedia?.seriesContext?.resolver?.provider || null;
          if (currentRole === "host" && resolverProvider === "rezka") {
            roomState.ui = roomState.ui || {};
            const pageUrl = roomState.currentMedia?.pageUrl || roomState.currentMedia?.mediaUrl || "";
            if (pageUrl && roomState.ui._autoQualityRequestedFor !== pageUrl) {
              roomState.ui._autoQualityRequestedFor = pageUrl;
              roomState.ui.qualityLabel = "1080p";
              const episode = getSelectedEpisodeForActions();
              if (episode) {
                requestEpisodeResolution(episode, {
                  translatorId: roomState.ui.translatorId,
                  qualityLabel: roomState.ui.qualityLabel
                });
              }
            }
          }
        } catch {}
      }
      return;
    }

    if (event.data?.type === PAGE_EVENT_EXTENSION_STATUS) {
      clearPendingSearchStatusTimer();
      state.extensionDetected = true;
      resolvePendingExtensionProbe(true);
      if (event.data?.payload?.probe) {
        syncProfile();
        return;
      }
      appendPlaybackDebugEntry("Extension status", event.data?.payload?.message || "Extension status update");
      setSearchHint(event.data?.payload?.message || "Extension status update");
      syncProfile();
      return;
    }

    if (event.data?.type === PAGE_EVENT_EXTENSION_ERROR) {
      clearPendingSearchStatusTimer();
      appendPlaybackDebugEntry("Extension error", event.data?.payload?.message || "Extension error", true);
      setSearchHint(event.data?.payload?.message || "Extension error", true);
    }

    if (event.data?.type === PAGE_EVENT_SEARCH_RESULT_CLICKED) {
      const url = event.data?.payload?.url;
      if (url) {
        appendPlaybackDebugEntry("Search result clicked", { url });
        console.log("[Interface UI] Search result clicked:", url);
        sendUrlToExtensionForResolution(url);
      }
    }
  });

  void probeExtensionAvailability();

  // Reset duplicate guard when iframe navigates to a new page (only if throttle expired)
  if (searchResultsFrame) {
    searchResultsFrame.addEventListener('load', function onIframeNav() {
      if (Date.now() >= _lastLoadBlockedUntil) {
        _lastLoadedMediaKey = '';
      } else {
        appendPlaybackDebugEntry("Iframe navigated but throttle active, guard kept", { remainingMs: _lastLoadBlockedUntil - Date.now() });
      }
    });
  }

  // Handle media requests from other users (host only)
  window.addEventListener("anytogether:media-request", (event) => {
    const detail = event.detail || {};
    const roomState = getActiveRoomState();
    if (!roomState) return;

    appendPlaybackDebugEntry("Host received media request", {
      seasonId: detail.requestedSeasonId,
      episodeId: detail.requestedEpisodeId,
      translatorId: detail.requestedTranslatorId,
      qualityLabel: detail.requestedQualityLabel,
      from: detail.requestedBy
    });

    // Update room UI state based on request
    if (detail.requestedSeasonId != null) {
      roomState.ui.seasonId = Number(detail.requestedSeasonId);
    }
    if (detail.requestedEpisodeId != null) {
      roomState.ui.episodeId = Number(detail.requestedEpisodeId);
    }
    if (detail.requestedTranslatorId != null) {
      roomState.ui.translatorId = Number(detail.requestedTranslatorId);
    }
    if (detail.requestedQualityLabel) {
      roomState.ui.qualityLabel = detail.requestedQualityLabel;
    }

    renderSeriesPanel();

    // Resolve via extension
    const selectedEpisode = getSelectedEpisodeForActions();
    if (selectedEpisode) {
      requestEpisodeResolution(selectedEpisode, {
        translatorId: roomState.ui.translatorId,
        qualityLabel: roomState.ui.qualityLabel
      });
    }
  });
}

window.addEventListener("beforeunload", () => {
  try {
    storeValue(STORAGE_KEYS.nickname, normalizeNickname(nicknameInput.value));
    saveJoinedRooms();
  } catch {}
});

void start();
