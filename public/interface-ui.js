const EXTENSION_SEARCH_REQUEST = "WT_SEARCH_REQUEST";
const EXTENSION_RESOLVE_REQUEST = "WT_RESOLVE_PAGE_URL";
const PAGE_EVENT_EXTENSION_PING = "WT_EXTENSION_PING";
const PAGE_EVENT_MEDIA_FOUND = "WT_MEDIA_FOUND";
const PAGE_EVENT_SERIES_CONTEXT_FOUND = "WT_SERIES_CONTEXT_FOUND";
const PAGE_EVENT_EXTRACTION_DIAGNOSTIC = "WT_EXTRACTION_DIAGNOSTIC";
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
  language: "watchTogether.language"
};
const GUEST_NICKNAME_KEY = "watchTogether.guestNickname";
const ROOM_UI_STORAGE_PREFIX = "watchTogether.roomUi.";

const DEFAULT_BACKEND_BASE_URL = window.AnyTogetherBackend.getDefaultBaseUrl();

const requestedRole = new URLSearchParams(window.location.search).get("role");
const queryRoom = normalizeRoomCode(new URLSearchParams(window.location.search).get("room"));
const requestedPage = new URLSearchParams(window.location.search).get("page");
const requestedAuthMode = new URLSearchParams(window.location.search).get("auth");
const pageMode =
  requestedPage === "rooms" || window.location.pathname.replace(/\/+$/, "").endsWith("/rooms")
    ? "rooms"
    : "home";
document.body.dataset.view = pageMode === "rooms" ? "rooms" : queryRoom ? "room" : "home";
const clientId = getTabClientId();
let currentRole = "guest";
const backendBaseUrl = resolveBackendBaseUrl(
  new URLSearchParams(window.location.search).get("api") ||
    loadStoredValue(STORAGE_KEYS.backendBaseUrl) ||
    window.WATCH_TOGETHER_API_BASE_URL ||
    DEFAULT_BACKEND_BASE_URL
);

const EXTENSION_PROBE_TIMEOUT_MS = 1000;
let pendingExtensionProbe = null;

function getTabClientId() {
  if (typeof window.__anyTogetherClientId === "string" && window.__anyTogetherClientId) {
    return window.__anyTogetherClientId;
  }
  window.__anyTogetherClientId = crypto.randomUUID();
  return window.__anyTogetherClientId;
}

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
const roomsLinks = Array.from(document.querySelectorAll("[data-topbar-rooms-link]"));
const topbarRoomCodeButton = document.getElementById("topbarRoomCodeButton");
const topbarRoomCodeValue = document.getElementById("topbarRoomCodeValue");

const nicknameInput = document.getElementById("nicknameInput");
const roomNameInput = document.getElementById("roomNameInput");
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
const playerMediaTitle = document.getElementById("playerMediaTitle");
const playerMediaTime = document.getElementById("playerMediaTime");

const reconnectButton = document.getElementById("reconnectButton");
const searchInput = document.querySelector("[data-topbar-search-input]") || document.getElementById("searchInput");
const searchButton = document.getElementById("searchButton");
const searchClearButton = document.querySelector("[data-topbar-search-clear]");
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
const roomsHeaderTitle = document.getElementById("roomsHeaderTitle");
const languageMenuButton = document.getElementById("languageMenuButton");
const languageMenuLabel = document.getElementById("languageMenuLabel");
const languageMenuDropdown = document.getElementById("languageMenuDropdown");
const languageEnglishButton = document.getElementById("languageEnglishButton");
const languageRussianButton = document.getElementById("languageRussianButton");
const signOutButtons = Array.from(document.querySelectorAll("[data-topbar-signout]"));
const changeNicknameButtons = Array.from(document.querySelectorAll("[data-topbar-change-nickname]"));
const signInButtons = Array.from(document.querySelectorAll("[data-topbar-signin]"));
const signUpButtons = Array.from(document.querySelectorAll("[data-topbar-signup]"));
const languageMenuButtons = Array.from(document.querySelectorAll("[data-topbar-language-button]"));
const languageEnglishButtons = Array.from(document.querySelectorAll("[data-topbar-language-en]"));
const languageRussianButtons = Array.from(document.querySelectorAll("[data-topbar-language-ru]"));
const topbarAvatarButtons = Array.from(document.querySelectorAll("[data-topbar-avatar-button]"));
const languageMenuLabels = Array.from(document.querySelectorAll("[data-topbar-language-label]"));
const languageDropdowns = Array.from(document.querySelectorAll("[data-topbar-language-dropdown]"));

const topbarUser = document.getElementById("topbarUser");
const topbarNickDisplay = document.getElementById("topbarNickDisplay");
const topbarAvatarButton = document.getElementById("topbarAvatarButton");
const topbarAvatar = document.getElementById("topbarAvatar");
const topbarUserMenu = document.getElementById("topbarUserMenu");
const lastRoomButtons = Array.from(document.querySelectorAll("[data-last-room]"));
const guestIdentityCard = document.getElementById("guestIdentityCard");

const state = {
  ws: null,
  connected: false,
  authToken: loadStoredValue(STORAGE_KEYS.authToken) || null,
  currentUser: null,
  authMode: requestedAuthMode === "signup" ? "signup" : "signin",
  language: normalizeLanguage(loadStoredValue(STORAGE_KEYS.language) || navigator.language),
  languageMenuOpen: false,
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
  extensionDetected: false,
  roomsDirectory: [],
  roomStates: new Map(),
  tmdbEpisodeCache: new Map(),
  tmdbSeasonCache: new Map(),
  loadingRooms: false,
  authLoading: false
};

let _snifferEnabled = false;
let loadedMediaKey = null;
let pendingSearchStatusTimer = null;
const pendingRoomJoins = new Set();
const participantPlaybackStates = new Map();
const lastBroadcastSeriesContextSignatures = new Map();
let pendingMediaSelection = null;
let _lastLoadedMediaKey = "";
let _lastLoadBlockedUntil = 0;
let _lastLoadHadContext = false;
let syncMediaBlockUntil = 0;
let lastSyncMediaKey = null;
let _searchPopupWindow = null;
const LOAD_BLOCK_DURATION_MS = 5000;
const SYNC_BLOCK_DURATION_MS = 2000;

const I18N = {
  en: {
    title: "AnyTogether - Watch in sync",
    description: "Create a room, drop a stream and watch it together - synchronised playback, live chat and a shared playlist.",
    rooms: "Rooms",
    lastRoom: "Last room",
    returnLastRoom: "Return to last room",
    signOut: "Sign out",
    changeName: "Change name",
    selectLanguage: "Select site language",
    room: "Room",
    language: "Language",
    english: "English",
    russian: "Russian",
    openRoom: "Open active room",
    homeEyebrow: "Watch in perfect sync",
    homeTitle: "Press play together,\nwherever you are.",
    homeDescription: "Spin up a room, share the code, and AnyTogether keeps everyone's video, chat and playlist locked in step.",
    nicknameLabel: "Your nickname",
    nicknamePlaceholder: "e.g. Alex",
    signIn: "Sign in",
    signUp: "Sign up",
    startRoomTitle: "Start a new room",
    startRoomDescription: "You'll become the host and can search, queue media and control playback for everyone.",
    createRoom: "Create a room",
    copyRoomCode: "Copy room code",
    joinCodeTitle: "Join with a code",
    roomCodeLabel: "Room code",
    roomCodePlaceholder: "e.g. AB12CD",
    joinRoom: "Join room",
    joinedRoomsTitle: "Rooms",
    refresh: "Refresh",
    loadingRooms: "Loading rooms...",
    noRoomsLinked: "No rooms are linked to your account yet.",
    roomsSubtitle: "Keep your rooms in one place and pick up right where you left off.",
    open: "Open",
    leave: "Leave",
    renameRoom: "Rename room",
    deleteRoom: "Delete room",
    showRoomCode: "Show room code",
    hideRoomCode: "Hide room code",
    noRoomSelected: "No room selected",
    joinRoomDashboard: "Join a room to unlock the dashboard.",
    enterRoomCode: "Enter a room code",
    joinOrCreateRoomFirst: "Join or create a room first.",
    session: "Session",
    unknown: "Unknown",
    guest: "Guest",
    signedInAs: "Signed in as {name}",
    signedIn: "Signed in",
    notSignedIn: "Not signed in",
    authTitle: "Sign in to AnyTogether",
    authPrompt: "Or sign in with",
    displayName: "Display name",
    emailOrName: "Email or name",
    emailLabel: "Email",
    passwordLabel: "Password",
    forgotPassword: "Forgot password?",
    noAccountSignUp: "No account? Sign up",
    signInWithEmail: "Or sign in with email",
    signUpWithEmail: "Or sign up with email",
    backToSignIn: "Back to sign in",
    enterYourEmail: "Enter your email",
    enterYourEmailOrName: "Enter your email or name",
    yourName: "Your name",
    yourPassword: "Your password",
    google: "Google",
    apple: "Apple",
    searchTitle: "Find something to watch",
    searchHelp: "Searches the public web, opens likely result pages, and asks the extension to extract a playable media URL.",
    searchPlaceholder: "Enter the site name and movie title...",
    search: "Search",
    searchResults: "Search results",
    close: "Close",
    participants: "Participants",
    playlist: "Playlist",
    addCurrent: "Add current",
    suggest: "Suggest",
    chat: "Chat",
    playbackDebug: "Playback debug",
    clear: "Clear",
    writeMessage: "Write a message...",
    send: "Send",
    quality: "Quality",
    speed: "Speed",
    pip: "Picture-in-Picture",
    enablePip: "Enable PiP",
    play: "Play",
    system: "System",
    playlistEmpty: "Playlist is empty.",
    playlistItem: "Playlist item",
    featurePlaybackTitle: "Synced playback",
    featurePlaybackDescription: "Play, pause and seek are mirrored instantly across every participant in the room.",
    featureChatTitle: "Live chat & people",
    featureChatDescription: "See who's watching and react together in real time without leaving the player.",
    featurePlaylistTitle: "Series & playlist",
    featurePlaylistDescription: "Pick seasons, translators and quality, then queue up what to watch next.",
    memberOne: "user",
    memberOther: "users",
    playlistOne: "playlist item",
    playlistOther: "playlist items",
    noMedia: "No media"
  },
  ru: {
    title: "AnyTogether - просмотр вместе",
    description: "Создайте комнату, откройте поток и смотрите вместе - синхронное воспроизведение, чат и общий плейлист.",
    rooms: "Комнаты",
    lastRoom: "Последняя комната",
    returnLastRoom: "Вернуться в последнюю комнату",
    signOut: "Выйти",
    changeName: "Изменить имя",
    selectLanguage: "Выберите язык сайта",
    room: "Комната",
    language: "Язык",
    english: "Английский",
    russian: "Русский",
    openRoom: "Открыть активную комнату",
    homeEyebrow: "Смотрите в полной синхронизации",
    homeTitle: "Нажимайте play вместе,\nгде бы вы ни были.",
    homeDescription: "Создайте комнату, поделитесь кодом, и AnyTogether синхронизирует видео, чат и плейлист для всех.",
    nicknameLabel: "Ваш никнейм",
    nicknamePlaceholder: "например, Alex",
    signIn: "Войти",
    signUp: "Регистрация",
    startRoomTitle: "Создать новую комнату",
    startRoomDescription: "Вы станете хозяином комнаты и сможете искать, добавлять медиа и управлять воспроизведением для всех.",
    createRoom: "Создать комнату",
    copyRoomCode: "Скопировать код комнаты",
    joinCodeTitle: "Присоединиться по коду",
    roomCodeLabel: "Код комнаты",
    roomCodePlaceholder: "например, AB12CD",
    joinRoom: "Присоединиться",
    joinedRoomsTitle: "Комнаты",
    refresh: "Обновить",
    loadingRooms: "Загрузка комнат...",
    noRoomsLinked: "К вашей учетной записи пока не привязано ни одной комнаты.",
    roomsSubtitle: "Храните комнаты в одном месте и возвращайтесь туда, где остановились.",
    open: "Открыть",
    leave: "Покинуть",
    renameRoom: "Переименовать комнату",
    deleteRoom: "Удалить комнату",
    showRoomCode: "Показать код комнаты",
    hideRoomCode: "Скрыть код комнаты",
    noRoomSelected: "Комната не выбрана",
    joinRoomDashboard: "Присоединитесь к комнате, чтобы открыть панель.",
    enterRoomCode: "Введите код комнаты",
    joinOrCreateRoomFirst: "Сначала присоединитесь к комнате или создайте её.",
    session: "Сессия",
    unknown: "Неизвестно",
    guest: "Гость",
    signedInAs: "Вход выполнен как {name}",
    signedIn: "Вход выполнен",
    notSignedIn: "Не выполнен вход",
    authTitle: "Войдите в AnyTogether",
    authPrompt: "Или войдите через",
    displayName: "Отображаемое имя",
    emailOrName: "Email или имя",
    emailLabel: "Email",
    passwordLabel: "Пароль",
    forgotPassword: "Забыли пароль?",
    noAccountSignUp: "Нет аккаунта? Зарегистрируйтесь",
    signInWithEmail: "Или войдите по email",
    signUpWithEmail: "Или зарегистрируйтесь по email",
    backToSignIn: "Назад к входу",
    enterYourEmail: "Введите email",
    enterYourEmailOrName: "Введите email или имя",
    yourName: "Ваше имя",
    yourPassword: "Ваш пароль",
    google: "Google",
    apple: "Apple",
    searchTitle: "Найти, что посмотреть",
    searchHelp: "Ищет в открытом вебе, открывает подходящие страницы и просит расширение извлечь воспроизводимый медиа-URL.",
    searchPlaceholder: "Введите название сайта и фильма...",
    search: "Поиск",
    searchResults: "Результаты поиска",
    close: "Закрыть",
    participants: "Участники",
    playlist: "Плейлист",
    addCurrent: "Добавить текущее",
    suggest: "Предложить",
    chat: "Чат",
    playbackDebug: "Отладка воспроизведения",
    clear: "Очистить",
    writeMessage: "Напишите сообщение...",
    send: "Отправить",
    quality: "Качество",
    speed: "Скорость",
    pip: "Картинка в картинке",
    enablePip: "Включить PiP",
    play: "Воспроизвести",
    system: "Система",
    playlistEmpty: "Плейлист пуст.",
    playlistItem: "Элемент плейлиста",
    featurePlaybackTitle: "Синхронное воспроизведение",
    featurePlaybackDescription: "Play, pause и seek мгновенно повторяются у всех участников комнаты.",
    featureChatTitle: "Живой чат и люди",
    featureChatDescription: "Смотрите, кто смотрит, и реагируйте вместе в реальном времени, не уходя из плеера.",
    featurePlaylistTitle: "Сериалы и плейлист",
    featurePlaylistDescription: "Выбирайте сезоны, переводчиков и качество, затем добавляйте, что смотреть дальше.",
    memberOne: "участник",
    memberFew: "участника",
    memberMany: "участников",
    playlistOne: "элемент плейлиста",
    playlistFew: "элемента плейлиста",
    playlistMany: "элементов плейлиста",
    noMedia: "Нет медиа"
  }
};

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

function normalizeLanguage(value) {
  const language = String(value || "").toLowerCase();
  return language.startsWith("ru") ? "ru" : "en";
}

function translate(key, params = {}) {
  const language = state.language || "en";
  const dictionary = I18N[language] || I18N.en;
  const fallback = I18N.en[key] || key;
  const template = dictionary[key] || fallback;

  return String(template).replace(/\{(\w+)\}/g, (_, name) => {
    const value = params[name];
    return value == null ? "" : String(value);
  });
}

function pluralize(count, forms) {
  if ((state.language || "en") !== "ru") {
    return count === 1 ? forms.one : forms.other;
  }

  const mod10 = count % 10;
  const mod100 = count % 100;

  if (mod10 === 1 && mod100 !== 11) return forms.one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return forms.few;
  return forms.many;
}

function getTranslatedCountLabel(count, key) {
  if ((state.language || "en") === "ru") {
    return `${count} ${pluralize(count, {
      one: I18N.ru[`${key}One`],
      few: I18N.ru[`${key}Few`],
      many: I18N.ru[`${key}Many`]
    })}`;
  }

  return `${count} ${pluralize(count, {
    one: I18N.en[`${key}One`],
    other: I18N.en[`${key}Other`]
  })}`;
}

function setLanguage(language) {
  const nextLanguage = normalizeLanguage(language);
  if (state.language === nextLanguage) {
    updateLanguageDependentText();
    return;
  }

  state.language = nextLanguage;
  storeValue(STORAGE_KEYS.language, nextLanguage);
  updateLanguageDependentText();
  renderAll();
  if (pageMode === "rooms") {
    renderRoomsAuthGate();
    renderRoomsDirectory();
  }
}

function setLanguageMenuOpen(nextOpen) {
  state.languageMenuOpen = Boolean(nextOpen);
  state.topbarMenuOpen = state.languageMenuOpen;
  renderTopbarUser();
}

function resolveBackendBaseUrl(value) {
  return window.AnyTogetherBackend.normalizeBaseUrl(value);
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
      qualityLabel: typeof parsed.qualityLabel === "string" && parsed.qualityLabel ? parsed.qualityLabel : null,
      codeHidden: Boolean(parsed.codeHidden)
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
    qualityLabel: typeof ui?.qualityLabel === "string" && ui.qualityLabel ? ui.qualityLabel : null,
    codeHidden: Boolean(ui?.codeHidden)
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
  return state.extensionDetected;
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
  if (kind === "play") {
    return `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="m8 5 11 7-11 7V5Z" /></svg>`;
  }

  if (kind === "pause") {
    return `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M7 5h3v14H7V5Zm7 0h3v14h-3V5Z" /></svg>`;
  }

  if (kind === "loading") {
    return `<svg viewBox="0 0 24 24" fill="none" aria-hidden="true" focusable="false"><circle cx="12" cy="12" r="8" /></svg>`;
  }

  if (kind === "eye-off") {
    return `
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">
        <path d="M4.5 4.5 19.5 19.5" />
        <path d="M10.6 10.6a2.2 2.2 0 0 0 2.8 2.8" />
        <path d="M9.9 5.2A10.5 10.5 0 0 1 12 5c5.5 0 9.5 4.5 10.5 7-0.4 1-1.2 2.2-2.3 3.4" />
        <path d="M6.3 6.3C3.8 8 2.1 10.9 1.5 12c1 2.5 5 7 10.5 7 1.5 0 2.8-0.2 4-0.6" />
      </svg>
    `;
  }

  if (kind === "eye") {
    return `
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">
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
    title: "Room",
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
  const incomingMedia = snapshot.currentMedia || null;
  const incomingMediaUpdatedAt = Number(incomingMedia?.updatedAt ?? snapshot.lastUpdatedAt);
  const existingMediaUpdatedAt = Number(existing.currentMedia?.updatedAt);
  const snapshotMediaIsStale = Boolean(
    existing.currentMedia &&
    Number.isFinite(existingMediaUpdatedAt) &&
    Number.isFinite(incomingMediaUpdatedAt) &&
    incomingMediaUpdatedAt < existingMediaUpdatedAt
  );
  const mediaForMerge = snapshotMediaIsStale ? existing.currentMedia : incomingMedia;
  const nextCurrentMedia = mediaForMerge
    ? {
        ...mediaForMerge,
        poster: mediaForMerge.poster || existing.currentMedia?.poster || null,
        banner: mediaForMerge.banner || mediaForMerge.backdrop || existing.currentMedia?.banner || existing.currentMedia?.backdrop || null,
        backdrop: mediaForMerge.backdrop || mediaForMerge.banner || existing.currentMedia?.backdrop || existing.currentMedia?.banner || null,
        masterPlaylistUrl: mediaForMerge.masterPlaylistUrl || existing.currentMedia?.masterPlaylistUrl || null,
        sourcePageUrl: mediaForMerge.sourcePageUrl || existing.currentMedia?.sourcePageUrl || null,
        seriesContext: mergePartialSeriesContext(mediaForMerge.seriesContext, previousSeriesContext)
      }
    : null;

  existing.code = snapshot.code || roomId;
  existing.title = snapshot.title || existing.title || "Room";
  existing.createdAt = Number.isFinite(snapshot.createdAt) ? snapshot.createdAt : existing.createdAt;
  existing.sessionStartedAt = Number.isFinite(snapshot.sessionStartedAt)
    ? snapshot.sessionStartedAt
    : existing.sessionStartedAt;
  existing.memberCount = Number.isFinite(snapshot.memberCount) ? snapshot.memberCount : existing.memberCount;
  existing.participants = Array.isArray(snapshot.participants) ? snapshot.participants : existing.participants;
  if (state.activeRoomId === roomId) {
    const localParticipant = {
      clientId,
      userId: state.currentUser?.id || null,
      nickname: normalizeNickname(nicknameInput.value),
      role: currentRole,
      canManageContent: canCurrentUserManageContent(existing),
      hasExtension: hasLocalExtension(),
      connected: true,
      joinedAt: Date.now(),
      lastSeenAt: Date.now()
    };
    const localParticipantIndex = existing.participants.findIndex((participant) =>
      isSelfParticipant(participant) ||
      (!state.currentUser?.id && !participant.userId && participant.nickname === localParticipant.nickname)
    );
    if (localParticipantIndex >= 0) {
      existing.participants[localParticipantIndex] = {
        ...existing.participants[localParticipantIndex],
        ...localParticipant,
        connected: true
      };
    } else {
      existing.participants = [...existing.participants, localParticipant];
    }
  }
  existing.chat = Array.isArray(snapshot.chat) ? snapshot.chat : existing.chat;
  existing.playlist = Array.isArray(snapshot.playlist) ? snapshot.playlist : existing.playlist;

  // Rebuild picker state when media changes, but keep the current selection when it still belongs to the same series.
  const mediaChanged = nextCurrentMedia?.mediaUrl !== existing.currentMedia?.mediaUrl ||
    JSON.stringify(nextCurrentMedia?.seriesContext) !== JSON.stringify(existing.currentMedia?.seriesContext);
  existing.currentMedia = nextCurrentMedia;
  if (mediaChanged) {
    existing.ui = mergeUiFromSeriesContext(existing, existing.currentMedia?.seriesContext || null, previousSeriesContext, {
      preferContextSelection: true
    });
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
  const highestQuality = getHighestQuality(qualities);

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
      highestQuality?.label ??
      null
  };
}

function hasNavigableSeriesContext(seriesContext) {
  const seasons = Array.isArray(seriesContext?.seasons) ? seriesContext.seasons : [];
  const episodes = Array.isArray(seriesContext?.episodes) ? seriesContext.episodes : [];
  return seasons.length > 0 || episodes.length > 0;
}

function mergePartialSeriesContext(incomingContext, previousContext) {
  if (!incomingContext) return previousContext || null;
  if (!previousContext) return incomingContext;

  if (hasNavigableSeriesContext(incomingContext) && isSameSeriesContext(previousContext, incomingContext)) {
    const mergeEpisodeArt = (incomingItems, previousItems) => {
      const previousByKey = new Map(previousItems.map((episode) => [
        `${episode?.seasonId ?? ""}:${episode?.episodeId ?? episode?.number ?? ""}`,
        episode
      ]));
      return incomingItems.map((episode) => {
        const previous = previousByKey.get(`${episode?.seasonId ?? ""}:${episode?.episodeId ?? episode?.number ?? ""}`);
        if (!previous) return episode;
        const incomingTitle = String(episode?.title || "").trim();
        const isPlaceholder = /^(?:episode|сер(?:и|і)я)\s*\d+$/i.test(incomingTitle);
        return {
          ...episode,
          title: !isPlaceholder && incomingTitle ? episode.title : previous.title || episode.title,
          thumbnail: episode.thumbnail || episode.thumbnailUrl || previous.thumbnail || previous.thumbnailUrl || null
        };
      });
    };

    const preferRicherList = (key) => {
      const incomingItems = Array.isArray(incomingContext[key]) ? incomingContext[key] : [];
      const previousItems = Array.isArray(previousContext[key]) ? previousContext[key] : [];
      if (key === "episodes" && previousItems.length > 0 && incomingItems.length >= previousItems.length) {
        return mergeEpisodeArt(incomingItems, previousItems);
      }
      return incomingItems.length >= previousItems.length ? incomingItems : previousItems;
    };

    return {
      ...previousContext,
      ...incomingContext,
      seasons: preferRicherList("seasons"),
      episodes: preferRicherList("episodes"),
      translators: preferRicherList("translators"),
      availableQualities: preferRicherList("availableQualities"),
      resolver: incomingContext.resolver || previousContext.resolver
    };
  }

  if (hasNavigableSeriesContext(incomingContext)) return incomingContext;

  return {
    ...previousContext,
    ...incomingContext,
    seasons: previousContext.seasons,
    episodes: previousContext.episodes,
    translators: Array.isArray(incomingContext.translators) && incomingContext.translators.length > 0
      ? incomingContext.translators
      : previousContext.translators,
    resolver: incomingContext.resolver || previousContext.resolver
  };
}

function hasSeriesContextUpgrade(incomingContext, currentContext) {
  if (!incomingContext) return false;
  if (!currentContext) return true;

  for (const key of ["seasons", "episodes", "translators", "availableQualities"]) {
    const incomingCount = Array.isArray(incomingContext[key]) ? incomingContext[key].length : 0;
    const currentCount = Array.isArray(currentContext[key]) ? currentContext[key].length : 0;
    if (incomingCount > currentCount) return true;
  }

  for (const key of ["currentSeasonId", "currentEpisodeId", "selectedTranslatorId"]) {
    if (incomingContext[key] != null && Number(incomingContext[key]) !== Number(currentContext[key])) return true;
  }

  const incomingResolverItemId = Number(incomingContext.resolver?.itemId);
  const currentResolverItemId = Number(currentContext.resolver?.itemId);
  if (Number.isFinite(incomingResolverItemId) && incomingResolverItemId !== currentResolverItemId) return true;

  if (incomingContext.title && incomingContext.title !== currentContext.title) return true;

  return Boolean(incomingContext.resolver && !currentContext.resolver);
}

function isSameMediaSelection(incomingContext, currentContext) {
  if (!hasNavigableSeriesContext(incomingContext) || !hasNavigableSeriesContext(currentContext)) return false;

  const incomingItemId = Number(incomingContext.resolver?.itemId);
  const currentItemId = Number(currentContext.resolver?.itemId);
  const sameResolverItem = Number.isFinite(incomingItemId) && Number.isFinite(currentItemId)
    ? incomingItemId === currentItemId
    : String(incomingContext.title || "").trim() === String(currentContext.title || "").trim();
  if (!sameResolverItem) return false;

  for (const key of ["currentSeasonId", "currentEpisodeId", "selectedTranslatorId"]) {
    if (
      incomingContext[key] != null &&
      currentContext[key] != null &&
      Number(incomingContext[key]) !== Number(currentContext[key])
    ) {
      return false;
    }
  }

  return true;
}

function getHighestQuality(qualities) {
  if (!Array.isArray(qualities) || qualities.length === 0) return null;
  return qualities
    .map((quality) => ({
      quality,
      value: Number.parseInt(String(quality?.label || "").replace(/[^0-9]/g, ""), 10) || 0
    }))
    .sort((left, right) => right.value - left.value)[0]?.quality || qualities[0];
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

function mergeUiFromSeriesContext(roomState, seriesContext, previousSeriesContext = null, options = {}) {
  const currentUi = roomState?.ui || {};
  const defaultUi = createDefaultUi(seriesContext);
  const seasons = Array.isArray(seriesContext?.seasons) ? seriesContext.seasons : [];
  const translators = Array.isArray(seriesContext?.translators) ? seriesContext.translators : [];
  const qualities = Array.isArray(seriesContext?.availableQualities) ? seriesContext.availableQualities : [];
  const pendingEpisode = getPendingEpisodeSelection(roomState);
  const preserveCurrentUi = !options.preferContextSelection && isSameSeriesContext(previousSeriesContext, seriesContext);

  if (pendingEpisode) {
    return {
      seasonId: pendingEpisode.seasonId,
      episodeId: pendingEpisode.episodeId,
      translatorId:
        Number.isFinite(Number(currentUi.translatorId)) &&
        translators.some((translator) => translator.translatorId === Number(currentUi.translatorId))
          ? Number(currentUi.translatorId)
          : (Number.isFinite(Number(seriesContext?.selectedTranslatorId)) &&
            translators.some((translator) => translator.translatorId === Number(seriesContext.selectedTranslatorId))
              ? Number(seriesContext.selectedTranslatorId)
              : defaultUi.translatorId),
      qualityLabel:
        currentUi.qualityLabel && qualities.some((quality) => quality.label === currentUi.qualityLabel)
          ? currentUi.qualityLabel
          : (seriesContext?.selectedQualityLabel && qualities.some((quality) => quality.label === seriesContext.selectedQualityLabel)
            ? seriesContext.selectedQualityLabel
            : defaultUi.qualityLabel),
      codeHidden: Boolean(currentUi.codeHidden)
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
  const activeSeasonEpisodes = getEpisodesForSeason(activeSeason, seriesContext);

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
    qualityLabel,
    codeHidden: Boolean(currentUi.codeHidden)
  };
}

function getEpisodesForSeason(season, seriesContext = getActiveSeriesContext()) {
  const seasonId = Number(season?.seasonId);
  const flatEpisodes = Array.isArray(seriesContext?.episodes) ? seriesContext.episodes : [];
  if (Number.isFinite(seasonId) && flatEpisodes.length) {
    const matchingEpisodes = flatEpisodes.filter((episode) => Number(episode?.seasonId) === seasonId);
    if (matchingEpisodes.length) return matchingEpisodes;
  }

  const seasonEpisodes = Array.isArray(season?.episodes) ? season.episodes : [];
  return Number.isFinite(seasonId)
    ? seasonEpisodes.filter((episode) => Number(episode?.seasonId) === seasonId)
    : seasonEpisodes;
}

function getEpisodeNumber(episode, index = 0) {
  const explicitNumber = Number(episode?.episodeNumber ?? episode?.number);
  return Number.isFinite(explicitNumber) && explicitNumber > 0
    ? explicitNumber
    : index + 1;
}

function sanitizeRoomUi(roomState) {
  const seriesContext = roomState?.currentMedia?.seriesContext || null;
  const seasons = Array.isArray(seriesContext?.seasons) ? seriesContext.seasons : [];
  const translators = Array.isArray(seriesContext?.translators) ? seriesContext.translators : [];
  const qualities = Array.isArray(seriesContext?.availableQualities) ? seriesContext.availableQualities : [];
  const pendingEpisode = getPendingEpisodeSelection(roomState);

  if (!roomState.ui) {
    roomState.ui = {
      ...createDefaultUi(seriesContext),
      codeHidden: Boolean(loadRoomUiState(roomState.code)?.codeHidden)
    };
    return;
  }

  if (typeof roomState.ui.codeHidden !== "boolean") {
    roomState.ui.codeHidden = Boolean(loadRoomUiState(roomState.code)?.codeHidden);
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
    const activeSeasonEpisodes = getEpisodesForSeason(activeSeason, seriesContext);

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

function ensureLocalParticipant(roomId) {
  const roomState = ensureRoomState(roomId);
  const localParticipant = {
    clientId,
    userId: state.currentUser?.id || null,
    nickname: normalizeNickname(nicknameInput.value),
    role: currentRole,
    canManageContent: canCurrentUserManageContent(roomState),
    hasExtension: hasLocalExtension(),
    connected: true,
    joinedAt: Date.now(),
    lastSeenAt: Date.now()
  };
  const existingIndex = roomState.participants.findIndex((participant) => isSelfParticipant(participant));
  if (existingIndex >= 0) {
    roomState.participants[existingIndex] = { ...roomState.participants[existingIndex], ...localParticipant };
  } else {
    roomState.participants.push(localParticipant);
  }
  roomState.memberCount = roomState.participants.length;
  return roomState;
}

function getActiveSeriesContext() {
  return getActiveRoomState()?.currentMedia?.seriesContext || null;
}

function getActiveUiState() {
  return getActiveRoomState()?.ui || createDefaultUi(getActiveSeriesContext());
}

function getRoomCodeHidden(roomId) {
  const normalized = normalizeRoomCode(roomId);
  if (!normalized) return false;

  const roomState = state.roomStates.get(normalized);
  if (typeof roomState?.ui?.codeHidden === "boolean") {
    return roomState.ui.codeHidden;
  }

  return Boolean(loadRoomUiState(normalized)?.codeHidden);
}

function setRoomCodeHidden(roomId, nextHidden) {
  const normalized = normalizeRoomCode(roomId);
  if (!normalized) return;

  const hidden = Boolean(nextHidden);
  const roomState = state.roomStates.get(normalized);
  if (roomState) {
    roomState.ui = roomState.ui || createDefaultUi(roomState.currentMedia?.seriesContext || null);
    roomState.ui.codeHidden = hidden;
    saveRoomUiState(normalized, roomState.ui);
    return;
  }

  const existing = loadRoomUiState(normalized) || {};
  saveRoomUiState(normalized, { ...existing, codeHidden: hidden });
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
  if (!Number.isFinite(timestamp)) return translate("unknown");

  const delta = Date.now() - timestamp;
  const relativeTimeFormat = new Intl.RelativeTimeFormat(state.language || "en", {
    numeric: "auto"
  });

  if (delta <= 10 * 1000) return relativeTimeFormat.format(0, "second");
  if (delta < 60 * 1000) return relativeTimeFormat.format(-Math.floor(delta / 1000), "second");
  if (delta < 60 * 60 * 1000) return relativeTimeFormat.format(-Math.floor(delta / (60 * 1000)), "minute");
  if (delta < 24 * 60 * 60 * 1000) return relativeTimeFormat.format(-Math.floor(delta / (60 * 60 * 1000)), "hour");
  return relativeTimeFormat.format(-Math.floor(delta / (24 * 60 * 60 * 1000)), "day");
}

function updateLanguageDependentText() {
  document.documentElement.lang = state.language || "en";

  document.title = translate("title");
  const description = document.querySelector('meta[name="description"]');
  if (description) {
    description.setAttribute("content", translate("description"));
  }

  document.querySelectorAll(".brand-text").forEach((brandText) => {
    brandText.innerHTML = "Any<b>Together</b>";
  });

  roomsLinks.forEach((link) => {
    link.textContent = translate("rooms");
  });
  lastRoomButtons.forEach((button) => {
    button.title = translate("returnLastRoom");
    button.innerHTML = `${translate("lastRoom")} &gt;`;
  });
  topbarRoomCodeButton.title = translate("openRoom");
  topbarRoomCodeButton.querySelector("small").textContent = translate("room");
  signOutButtons.forEach((button) => {
    button.title = translate("signOut");
    const label = button.querySelector("span:last-child");
    if (label) {
      label.textContent = translate("signOut");
    } else {
      button.textContent = translate("signOut");
    }
  });
  changeNicknameButtons.forEach((button) => {
    const label = button.querySelector("span:last-child");
    if (label) label.textContent = translate("changeName");
  });
  signInButtons.forEach((button) => {
    const label = button.querySelector("span:last-child");
    if (label) label.textContent = translate("signIn");
    else button.textContent = translate("signIn");
  });
  signUpButtons.forEach((button) => {
    const label = button.querySelector("span:last-child");
    if (label) label.textContent = translate("signUp");
    else button.textContent = translate("signUp");
  });

  authTitle.textContent = translate("authTitle");
  authPrompt.textContent = translate("authPrompt");
  authNameField.querySelector("label").textContent = translate("displayName");
  authNameInput.placeholder = translate("yourName");
  const authIdentifierLabel = authIdentifierField?.querySelector("label");
  if (authIdentifierLabel) authIdentifierLabel.textContent = translate("emailOrName");
  authIdentifierInput.placeholder = translate("enterYourEmailOrName");
  authEmailField.querySelector("label").textContent = translate("emailLabel");
  authEmailInput.placeholder = "you@example.com";
  authPasswordInput.placeholder = translate("yourPassword");
  forgotPasswordButton.textContent = translate("forgotPassword");
  authToggleButton.textContent = state.authMode === "signup" ? translate("backToSignIn") : translate("noAccountSignUp");
  authSubmitButton.textContent = state.authMode === "signup" ? translate("signUp") : translate("signIn");
  googleSignInButton.textContent = translate("google");
  appleSignInButton.textContent = translate("apple");
  languageMenuButtons.forEach((button) => {
    button.title = translate("selectLanguage");
    button.setAttribute("aria-label", translate("selectLanguage"));
  });
  languageMenuLabels.forEach((label) => {
    label.textContent = translate("language");
  });
  languageEnglishButtons.forEach((button) => {
    button.textContent = translate("english");
    button.classList.toggle("is-active", state.language === "en");
  });
  languageRussianButtons.forEach((button) => {
    button.textContent = translate("russian");
    button.classList.toggle("is-active", state.language === "ru");
  });

  roomsHeaderTitle.textContent = translate("joinedRoomsTitle");
  roomsJoinInput.placeholder = translate("roomCodePlaceholder");
  roomsJoinButton.textContent = translate("joinRoom");
  roomsCreateButton.textContent = translate("createRoom");
  refreshRoomsButton.textContent = translate("refresh");
  refreshRoomsButton.title = translate("refresh");

  roomsAuthGate.querySelector("h2").textContent = translate("authTitle");
  roomsAuthGate.querySelector(".auth-sub").textContent = translate("roomsSubtitle");

  const heroEyebrow = joinView.querySelector(".hero-eyebrow");
  const heroTitle = joinView.querySelector(".hero-title-centered");
  const heroDescription = joinView.querySelector(".hero-sub-centered");
  if (heroEyebrow) heroEyebrow.textContent = translate("homeEyebrow");
  if (heroTitle) heroTitle.innerHTML = translate("homeTitle").replace(/\n/g, "<br />");
  if (heroDescription) heroDescription.textContent = translate("homeDescription");

  guestIdentityCard.querySelector("label").textContent = translate("nicknameLabel");
  nicknameInput.placeholder = translate("nicknamePlaceholder");
  homeSignInButton.textContent = translate("signIn");
  homeSignUpButton.textContent = translate("signUp");

  const homeCards = joinView.querySelectorAll(".home-grid .card.stack");
  if (homeCards[0]) {
    homeCards[0].querySelector(".section-title").textContent = translate("startRoomTitle");
    homeCards[0].querySelector(".status").textContent = translate("startRoomDescription");
    homeCards[0].querySelector("#createRoomButton").textContent = translate("createRoom");
  }
  createdRoomCodeButton.title = translate("copyRoomCode");
  const createdRoomCodeLabel = createdRoomCodeButton.querySelector("small");
  if (createdRoomCodeLabel) createdRoomCodeLabel.textContent = translate("room");
  if (homeCards[1]) {
    homeCards[1].querySelector(".section-title").textContent = translate("joinCodeTitle");
    homeCards[1].querySelector("label").textContent = translate("roomCodeLabel");
  }
  roomCodeInput.placeholder = translate("roomCodePlaceholder");
  joinRoomButton.textContent = translate("joinRoom");

  joinView.querySelectorAll(".feature").forEach((feature, index) => {
    const title = feature.querySelector("h3");
    const descriptionNode = feature.querySelector("p");
    if (index === 0) {
      title.textContent = translate("featurePlaybackTitle");
      descriptionNode.textContent = translate("featurePlaybackDescription");
    } else if (index === 1) {
      title.textContent = translate("featureChatTitle");
      descriptionNode.textContent = translate("featureChatDescription");
    } else {
      title.textContent = translate("featurePlaylistTitle");
      descriptionNode.textContent = translate("featurePlaylistDescription");
    }
  });

  const dashboardTitles = dashboardView.querySelectorAll(".section-title");
  if (dashboardTitles[0]) dashboardTitles[0].textContent = translate("searchTitle");
  if (dashboardTitles[1]) dashboardTitles[1].textContent = translate("participants");
  if (dashboardTitles[2]) dashboardTitles[2].textContent = translate("playlist");
  if (dashboardTitles[3]) dashboardTitles[3].textContent = translate("chat");
  if (dashboardTitles[4]) dashboardTitles[4].textContent = translate("playbackDebug");

  searchHelpButton.title = translate("searchHelp");
  searchHelpButton.setAttribute("aria-label", translate("searchHelp"));
  searchInput.placeholder = translate("searchPlaceholder");
  searchButton.textContent = translate("search");
  closeSearchWidget.textContent = translate("close");
  addToPlaylistButton.textContent = translate("addCurrent");
  suggestButton.textContent = translate("suggest");
  chatInput.placeholder = translate("writeMessage");
  chatSendButton.textContent = translate("send");
  clearPlaybackDebugButton.textContent = translate("clear");
  const leaveRoomLabel = leaveRoomButton.querySelector(".concept-room-action-label");
  if (leaveRoomLabel) {
    leaveRoomLabel.textContent = translate("leave");
  } else {
    leaveRoomButton.textContent = translate("leave");
  }
  deleteActiveRoomButton.title = translate("deleteRoom");
  deleteActiveRoomButton.setAttribute("aria-label", translate("deleteRoom"));
  renameRoomButton.title = translate("renameRoom");
  renameRoomButton.setAttribute("aria-label", translate("renameRoom"));
  activeRoomCodeButton.title = translate("copyRoomCode");
  if (activeRoomCodeToggleButton) {
    const roomCode = getActiveRoomState()?.code || "";
    const hidden = getRoomCodeHidden(roomCode);
    activeRoomCodeToggleButton.title = hidden ? translate("showRoomCode") : translate("hideRoomCode");
    activeRoomCodeToggleButton.setAttribute("aria-label", hidden ? translate("showRoomCode") : translate("hideRoomCode"));
  }

  const searchResultsTitle = searchResultsWidget?.querySelector(".section-title");
  if (searchResultsTitle) {
    searchResultsTitle.textContent = translate("searchResults");
  }

  if (pageMode === "rooms") {
    renderRoomsAuthGate();
  } else {
    renderAuthMode();
  }
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

  const currentMedia = getActiveRoomState()?.currentMedia;
  if (playerMediaTitle) {
    playerMediaTitle.textContent = currentMedia?.title || currentMedia?.seriesContext?.title || "";
  }
  if (playerMediaTime) {
    playerMediaTime.textContent = "00:00 / 00:00";
  }
}

function updateActiveRoomCodeControls() {
  const roomState = getActiveRoomState();
  const roomCode = roomState?.code || "";
  const hidden = getRoomCodeHidden(roomCode);

  if (!activeRoomCodeButton || !activeRoomCodeValue || !activeRoomCodeToggleButton) return;

  if (!roomState) {
    activeRoomCodeButton.classList.add("hidden");
    activeRoomCodeToggleButton.classList.add("hidden");
    activeRoomCodeValue.textContent = "--";
    activeRoomCodeButton.classList.remove("is-blurred");
    return;
  }

  activeRoomCodeButton.classList.remove("hidden");
  activeRoomCodeToggleButton.classList.remove("hidden");
  activeRoomCodeValue.textContent = roomCode;
  activeRoomCodeButton.classList.toggle("is-blurred", hidden);
  activeRoomCodeToggleButton.innerHTML = createInlineIcon(hidden ? "eye-off" : "eye");
  activeRoomCodeToggleButton.setAttribute(
    "aria-label",
    hidden ? translate("showRoomCode") : translate("hideRoomCode")
  );
  activeRoomCodeToggleButton.title = hidden ? translate("showRoomCode") : translate("hideRoomCode");
  activeRoomCodeButton.title = translate("copyRoomCode");
}

function updateActiveRoomHeader() {
  const roomState = getActiveRoomState();

  if (!roomState) {
    activeRoomTitle.textContent = translate("noRoomSelected");
    roomStatus.textContent = translate("joinRoomDashboard");
    roomStatus.classList.remove("hidden");
    updateActiveRoomCodeControls();
    return;
  }

  activeRoomTitle.textContent = roomState.title || "Room";
  roomStatus.textContent = "";
  roomStatus.classList.add("hidden");
  updateActiveRoomCodeControls();
}

function renderTopbarUser() {
  const signedIn = Boolean(getAuthToken());
  const nick = state.currentUser?.displayName || normalizeNickname(nicknameInput.value);
  const avatarIdentity = {
    userId: state.currentUser?.id,
    nickname: nick
  };
  document.querySelectorAll("[data-topbar-user]").forEach((user) => {
    user.classList.toggle("hidden", !signedIn);
  });
  document.querySelectorAll("[data-home-auth-controls]").forEach((controls) => {
    controls.classList.toggle("hidden", signedIn);
  });
  document.querySelectorAll("[data-topbar-nick]").forEach((display) => {
    display.textContent = nick;
  });
  document.querySelectorAll("[data-topbar-avatar]").forEach((avatar) => {
    avatar.textContent = nick.charAt(0).toUpperCase();
    avatar.closest("button")?.style.setProperty("background", getAvatarGradient(avatarIdentity));
  });
  document.querySelectorAll("[data-room-topbar-nick]").forEach((display) => {
    display.textContent = nick;
  });
  document.querySelectorAll("[data-room-topbar-avatar]").forEach((avatar) => {
    avatar.textContent = nick.charAt(0).toUpperCase();
    avatar.closest("button")?.style.setProperty("background", getAvatarGradient(avatarIdentity));
  });
  document.querySelectorAll("[data-topbar-account]").forEach((account) => {
    account.classList.toggle("hidden", !signedIn);
  });
  document.querySelectorAll("[data-topbar-auth-controls]").forEach((controls) => {
    controls.classList.toggle("hidden", signedIn);
  });
  topbarAvatarButtons.forEach((button) => {
    button.setAttribute("aria-expanded", String(signedIn && state.topbarMenuOpen));
  });
  document.querySelectorAll("[data-topbar-user-menu]").forEach((menu) => {
    const isRoomMenu = menu.classList.contains("concept-room-user-menu");
    menu.classList.toggle("hidden", !(signedIn && state.topbarMenuOpen && (!isRoomMenu || !state.languageMenuOpen)));
  });
  document.querySelectorAll(".concept-language-menu").forEach((menu) => {
    menu.classList.toggle("hidden", !(state.topbarMenuOpen && state.languageMenuOpen));
  });
  signOutButtons.forEach((button) => button.classList.toggle("hidden", !signedIn));
  changeNicknameButtons.forEach((button) => button.classList.toggle("hidden", !signedIn));
  signInButtons.forEach((button) => button.classList.toggle("hidden", signedIn));
  signUpButtons.forEach((button) => button.classList.toggle("hidden", signedIn));
  languageMenuButtons.forEach((button) => {
    button.setAttribute("aria-expanded", String(state.topbarMenuOpen && state.languageMenuOpen));
  });
  languageDropdowns.forEach((dropdown) => {
    dropdown.classList.toggle("hidden", !(state.topbarMenuOpen && state.languageMenuOpen));
  });
  positionLanguageDropdowns();
}

function positionLanguageDropdowns() {
  languageMenuButtons.forEach((button, index) => {
    const dropdown = languageDropdowns[index];
    const parent = dropdown?.offsetParent;
    if (!dropdown || !parent || dropdown.classList.contains("hidden")) return;

    const buttonRect = button.getBoundingClientRect();
    const parentRect = parent.getBoundingClientRect();
    dropdown.style.left = `${buttonRect.left + buttonRect.width / 2 - parentRect.left}px`;
    dropdown.style.right = "auto";
    dropdown.style.transform = "translateX(-50%)";
  });
}

function closeTopbarMenu() {
  state.topbarMenuOpen = false;
  state.languageMenuOpen = false;
  renderTopbarUser();
}

function updateLastRoomButton() {
  const lastRoom = isAuthenticated()
    ? state.accountRoomCodes[0] || state.activeRoomId || state.joinedRooms[0] || loadStoredValue(STORAGE_KEYS.activeRoomId)
    : state.activeRoomId || state.joinedRooms[0] || loadStoredValue(STORAGE_KEYS.activeRoomId);
  lastRoomButtons.forEach((button) => {
    button.classList.remove("hidden");
    button.toggleAttribute("disabled", !lastRoom && button instanceof HTMLButtonElement);
    button.setAttribute("aria-disabled", lastRoom ? "false" : "true");
    if (lastRoom) {
      button.setAttribute("data-room", lastRoom);
    } else {
      button.removeAttribute("data-room");
    }
  });
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
  joinView.classList.remove("active");
  dashboardView.classList.remove("active");
  roomsView.classList.remove("active");
  if (pageMode === "rooms") {
    joinView.classList.add("hidden");
    dashboardView.classList.add("hidden");
    roomsView.classList.remove("hidden");
    roomsView.classList.add("is-visible");
    roomsView.classList.add("active");
    renderRoomsAuthGate();
    return;
  }

  roomsView.classList.add("hidden");

  if (queryRoom) {
    joinView.classList.add("hidden");
    dashboardView.classList.remove("hidden");
    dashboardView.classList.add("active");
  } else {
    joinView.classList.remove("hidden");
    dashboardView.classList.add("hidden");
    joinView.classList.add("active");
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

  authTitle.textContent = isSignup ? translate("signUp") : translate("authTitle");
  authPrompt.textContent = isSignup ? translate("signUpWithEmail") : translate("signInWithEmail");
  authIdentifierField?.classList.toggle("hidden", isSignup);
  authNameField.classList.toggle("hidden", !isSignup);
  authEmailField.classList.toggle("hidden", !isSignup);
  authSubmitButton.textContent = isSignup ? translate("signUp") : translate("signIn");
  authToggleButton.textContent = isSignup ? translate("backToSignIn") : translate("noAccountSignUp");
  authIdentifierInput.placeholder = isSignup ? translate("enterYourEmail") : translate("enterYourEmailOrName");
  authNameInput.placeholder = translate("yourName");
  authEmailInput.placeholder = "you@example.com";
  authPasswordInput.placeholder = translate("yourPassword");
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
    signedInName.textContent = state.currentUser?.displayName
      ? translate("signedInAs", { name: state.currentUser.displayName })
      : translate("signedIn");
    roomsGrid.classList.remove("hidden");
  } else {
    signedInName.textContent = translate("notSignedIn");
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

  return qualities
    .map((quality) => {
      if (typeof quality === "string" || typeof quality === "number") {
        return { label: String(quality) };
      }

      const label = quality?.label || quality?.name || quality?.quality || quality?.resolution ||
        (Number.isFinite(Number(quality?.height)) ? `${Number(quality.height)}p` : "");
      return label ? { ...quality, label: String(label) } : null;
    })
    .filter((quality) => quality && !quality.label.toLowerCase().includes("ultra"));
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
    const lockedEpisode = getEpisodesForSeason(lockedSeason).find((episode) => episode.episodeId === pendingEpisode.episodeId) || null;
    if (lockedEpisode) {
      return lockedEpisode;
    }
  }

  const activeSeason = getActiveSeason();
  const activeSeasonEpisodes = getEpisodesForSeason(activeSeason);
  if (!activeSeasonEpisodes.length) return null;

  const preferredEpisodeId = Number(getActiveUiState()?.episodeId);
  if (Number.isFinite(preferredEpisodeId)) {
    const preferredEpisode = activeSeasonEpisodes.find((episode) => episode.episodeId === preferredEpisodeId);
    if (preferredEpisode) return preferredEpisode;
  }

  const currentSeasonId = Number(getActiveSeriesContext()?.currentSeasonId);
  const currentEpisodeId = Number(getActiveSeriesContext()?.currentEpisodeId);

  if (
    Number.isFinite(currentSeasonId) &&
    Number.isFinite(currentEpisodeId) &&
    activeSeason.seasonId === currentSeasonId
  ) {
    const currentEpisode = activeSeasonEpisodes.find((episode) => episode.episodeId === currentEpisodeId);
    if (currentEpisode) return currentEpisode;
  }

  return activeSeasonEpisodes[0];
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
    button.dataset.value = String(value);
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

function formatEpisodeDuration(episode) {
  const rawDuration = episode?.duration ?? episode?.durationSeconds ?? episode?.runtime ?? episode?.length;
  if (typeof rawDuration === "string" && rawDuration.trim()) return rawDuration.trim();

  const durationMinutes = Number(rawDuration);
  if (!Number.isFinite(durationMinutes) || durationMinutes <= 0) return "—";

  const hours = Math.floor(durationMinutes / 60);
  const minutes = Math.round(durationMinutes % 60);
  return hours > 0 ? `${hours}h ${minutes}min` : `${minutes}min`;
}

function renderSeriesPanel() {
  const roomState = getActiveRoomState();
  const currentMedia = roomState?.currentMedia || null;
  const seriesContext = currentMedia?.seriesContext || null;
  const seasons = Array.isArray(seriesContext?.seasons) ? seriesContext.seasons : [];

  if (!roomState || !currentMedia) {
    seriesPanel.classList.remove("hidden");
    seriesTitleEl.textContent = "";
    seriesMetaEl.textContent = "";
    if (seasonPickerValue) seasonPickerValue.textContent = "";
    if (episodePickerValue) episodePickerValue.textContent = "";
    if (translatorPickerValue) translatorPickerValue.textContent = "";
    if (qualityPickerValue) qualityPickerValue.textContent = "";
    seasonButtonsEl.textContent = "";
    translatorButtonsEl.textContent = "";
    seriesEpisodesEl.textContent = "";
    const emptyState = document.createElement("div");
    emptyState.className = "concept-empty-episodes";
    emptyState.textContent = "Load a series to see upcoming episodes.";
    seriesEpisodesEl.appendChild(emptyState);
    if (qualityButtonsEl) qualityButtonsEl.textContent = "";
    seasonPicker?.removeAttribute("open");
    episodePicker?.setAttribute("open", "");
    translatorPicker?.removeAttribute("open");
    if (qualityPicker) qualityPicker?.removeAttribute("open");
    updateSeriesEpisodeOverflow();
    return;
  }

  sanitizeRoomUi(roomState);

  const ui = getActiveUiState();
  const activeSeason = getActiveSeason();
  const activeSeasonEpisodes = getEpisodesForSeason(activeSeason, seriesContext);
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
  const selectedEpisodeTitle = `Episode ${selectedEpisodeIndex > 0 ? selectedEpisodeIndex : 1}`;
  const selectedTranslatorTitle = getSelectedTranslatorTitle() || "Auto";

  seriesPanel.classList.remove("hidden");
  const seriesBanner = currentMedia.banner || currentMedia.backdrop || seriesContext?.banner || seriesContext?.backdrop || "";
  seriesPanel.style.setProperty("--series-banner", seriesBanner ? `url(\"${String(seriesBanner).replaceAll('"', '%22')}\")` : "none");
  seriesPanel.classList.toggle("has-series-banner", Boolean(seriesBanner));
  seriesTitleEl.textContent = title;
  seriesMetaEl.textContent = displayYear ? `(${displayYear})` : "";
  if (seasonPickerValue) seasonPickerValue.textContent = selectedSeasonTitle;
  if (episodePickerValue) episodePickerValue.textContent = selectedEpisodeTitle;
  if (translatorPickerValue) translatorPickerValue.textContent = selectedTranslatorTitle;

  const qualities = getAvailableQualities();
  if (qualityPickerValue) {
    qualityPickerValue.textContent = ui.qualityLabel || getHighestQuality(qualities)?.label || "";
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
    updateSeriesEpisodeOverflow();
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
      if (!canCurrentUserManageContent(roomState) && window.__sendMediaRequest) {
        setPendingEpisodeSelection(roomState, nextEpisode);
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
      if (!canCurrentUserManageContent(roomState) && window.__sendMediaRequest) {
        setPendingEpisodeSelection(roomState, selectedEpisode);
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
      if (!canCurrentUserManageContent(roomState) && window.__sendMediaRequest) {
        setPendingEpisodeSelection(roomState, selectedEpisode);
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
    updateSeriesEpisodeOverflow();
    return;
  }

  seriesEpisodesEl.classList.add("is-visible");
  episodePicker?.setAttribute("open", "");

  activeSeasonEpisodes.forEach((episode, index) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "series-episode-button";
    button.setAttribute("role", "listitem");
    if (episode?.seasonId != null) button.dataset.seasonId = String(episode.seasonId);
    if (episode?.episodeId != null) button.dataset.episodeId = String(episode.episodeId);

    const thumbnail = document.createElement("span");
    thumbnail.className = "series-episode-thumb";
    const episodeNumber = getEpisodeNumber(episode, index);
    const seasonNumber = episode?.seasonId ?? activeSeason?.seasonId ?? 1;
    const tmdbSeasonEpisodes = state.tmdbSeasonCache.get(`${getTmdbSeriesTitle(currentMedia).toLowerCase()}:${seasonNumber}`) || [];
    const tmdbEpisode = tmdbSeasonEpisodes.find((item) => Number(item.episodeNumber) === episodeNumber) ||
      state.tmdbEpisodeCache.get(`${getTmdbSeriesTitle(currentMedia).toLowerCase()}:${seasonNumber}:${episodeNumber}`);
    const thumbnailUrl = tmdbEpisode?.thumbnail || episode?.thumbnail || episode?.thumbnailUrl || episode?.image || episode?.poster || episode?.banner || seriesContext?.banner || seriesContext?.backdrop || "";
    if (thumbnailUrl) {
      thumbnail.style.backgroundImage = `url("${String(thumbnailUrl).replaceAll('"', '%22')}")`;
      thumbnail.classList.add("has-image");
    } else {
      thumbnail.classList.add(`tone-${(index % 3) + 1}`);
    }

    const overlay = document.createElement("span");
    overlay.className = "series-episode-overlay";

    const title = document.createElement("strong");
    title.className = "series-episode-title";
    title.textContent = tmdbEpisode?.title || episode?.title || episode?.name || episode?.episodeTitle || `Episode ${index + 1}`;

    const meta = document.createElement("span");
    meta.className = "series-episode-meta";
    const number = document.createElement("span");
    number.textContent = `S${episode?.seasonId || activeSeason?.seasonId || 1} E${index + 1}`;
    const duration = document.createElement("span");
    duration.textContent = formatEpisodeDuration(episode);
    meta.append(number, duration);
    overlay.append(title, meta);
    thumbnail.appendChild(overlay);
    button.appendChild(thumbnail);

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
      if (!canCurrentUserManageContent(roomState) && window.__sendMediaRequest) {
        setPendingEpisodeSelection(roomState, episode);
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
  requestAnimationFrame(updateSeriesEpisodeOverflow);
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
  const participants = Array.isArray(roomState?.participants) ? roomState.participants : [];
  const hasMedia = Boolean(roomState?.currentMedia?.mediaUrl);
  participantsList.textContent = "";
  const participantsCount = document.getElementById("participantsCount");
  if (participantsCount) {
    participantsCount.textContent = participants.length ? String(participants.length) : "";
  }

  if (!participants.length) {
    const placeholder = document.createElement("div");
    placeholder.className = "status";
    placeholder.textContent = "No participants yet.";
    participantsList.appendChild(placeholder);
    return;
  }

  participants.forEach((participant) => {
    const item = document.createElement("div");
    item.className = "pw-item concept-participant-item";
    const participantMenuKey = getParticipantMenuKey(roomState, participant);
    item.dataset.participantKey = participantMenuKey;
    const isSelf = isSelfParticipant(participant);

    const actions = document.createElement("div");
    actions.className = "pw-actions";

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

    if (canCurrentUserManageParticipants(roomState) && !isSelf && participant.connected !== false) {
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
    avatarWrap.className = "pw-av";
    avatarWrap.appendChild(createParticipantAvatar(participant));

    const nameRow = document.createElement("div");
    nameRow.className = "pw-info";

    const name = document.createElement("div");
    name.className = "pw-name";
    name.textContent = participant.nickname || translate("guest");

    nameRow.appendChild(name);

    const status = document.createElement("div");
    status.className = "pw-status";
    status.dataset.syncStatus = participantMenuKey;
    const presenceStatus = getParticipantPresenceStatus(participant);
    const syncMs = getParticipantSyncMs(participant);
    const syncClass = presenceStatus !== "online"
      ? "pw-dot-muted"
      : syncMs >= 400 ? "pw-dot-red" : syncMs >= 150 ? "pw-dot-yellow" : "pw-dot-green";
    const playbackState = participantPlaybackStates.get(participant.clientId) || "paused";
    const playbackIconKind = !hasMedia || presenceStatus !== "online" ? "empty" : playbackState === "playing"
      ? "play"
      : playbackState === "paused" ? "pause" : "loading";
    const playbackIcon = document.createElement("span");
    playbackIcon.className = `participant-playback-status ${syncClass} ${playbackIconKind === "loading" ? "is-loading" : ""} ${playbackIconKind === "empty" ? "is-empty" : ""}`;
    playbackIcon.dataset.playbackStatus = participantMenuKey;
    playbackIcon.dataset.playbackKind = playbackIconKind;
    playbackIcon.title = playbackIconKind === "empty" ? "No media loaded" : playbackState;
    playbackIcon.textContent = playbackIconKind === "empty" ? "-" : "";
    if (playbackIconKind !== "empty") playbackIcon.innerHTML = createInlineIcon(playbackIconKind);
    status.appendChild(playbackIcon);
    const isLoading = isParticipantPlaybackLoading(participant);
    const statusText = presenceStatus === "offline"
      ? "Offline"
      : presenceStatus === "not-in-room"
        ? "Not in room"
        : !hasMedia ? "No media loaded" : isLoading ? "Loading" : `Sync ${syncMs}ms`;
    status.appendChild(document.createTextNode(statusText));
    nameRow.appendChild(status);

    item.appendChild(avatarWrap);
    item.appendChild(nameRow);
    item.appendChild(actions);

    if (state.openParticipantMenuKey === participantMenuKey && canCurrentUserManageParticipants(roomState) && !isSelf && participant.connected !== false) {
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

function getParticipantPresenceStatus(participant) {
  if (participant?.presenceStatus === "not-in-room") return "not-in-room";
  if (participant?.presenceStatus === "offline") return "offline";
  return participant?.connected === false ? "offline" : "online";
}

function getParticipantSyncMs(participant) {
  if (typeof window.__getPlaybackSyncInfo === "function" && participant?.clientId) {
    const syncInfo = window.__getPlaybackSyncInfo(participant.clientId);
    if (Number.isFinite(syncInfo?.offsetMs)) return Math.max(0, Math.round(syncInfo.offsetMs));
  }

  const value = Number(participant?.syncOffsetMs ?? participant?.latencyMs ?? participant?.pingMs ?? 0);
  return Number.isFinite(value) ? Math.max(0, Math.round(value)) : 0;
}

function isParticipantPlaybackLoading(participant) {
  const playbackState = participant?.clientId
    ? participantPlaybackStates.get(participant.clientId)
    : null;
  if (playbackState === "loading") return true;

  if (typeof window.__getPlaybackSyncInfo === "function" && participant?.clientId) {
    const syncInfo = window.__getPlaybackSyncInfo(participant.clientId);
    return Boolean(syncInfo?.buffering);
  }

  return false;
}

function refreshParticipantSyncIndicators() {
  const roomState = getActiveRoomState();
  if (!roomState || !participantsList) return;

  participantsList.querySelectorAll("[data-sync-status]").forEach((status) => {
    const participant = roomState.participants?.find((item) =>
      getParticipantMenuKey(roomState, item) === status.dataset.syncStatus
    );
    if (!participant) return;

    const syncMs = getParticipantSyncMs(participant);
    const isLoading = isParticipantPlaybackLoading(participant);
    const presenceStatus = getParticipantPresenceStatus(participant);
    const syncClass = presenceStatus !== "online"
      ? "pw-dot-muted"
      : syncMs >= 400 ? "pw-dot-red" : syncMs >= 150 ? "pw-dot-yellow" : "pw-dot-green";
    const icon = status.querySelector(".participant-playback-status");
    if (icon) {
      icon.classList.remove("pw-dot-green", "pw-dot-yellow", "pw-dot-red", "pw-dot-muted");
      icon.classList.add(syncClass);
    }
    const text = status.lastChild;
    if (text?.nodeType === Node.TEXT_NODE) {
      text.textContent = presenceStatus === "offline"
        ? "Offline"
        : presenceStatus === "not-in-room"
          ? "Not in room"
          : !roomState.currentMedia?.mediaUrl ? "No media loaded" : isLoading ? "Loading" : `Sync ${syncMs}ms`;
    }
  });
}

function refreshParticipantPlaybackIndicators() {
  const roomState = getActiveRoomState();
  if (!roomState || !participantsList) return;

  participantsList.querySelectorAll("[data-playback-status]").forEach((icon) => {
    const participant = roomState.participants?.find((item) =>
      getParticipantMenuKey(roomState, item) === icon.dataset.playbackStatus
    );
    if (!participant) return;

    const playbackState = participantPlaybackStates.get(participant.clientId) || "paused";
    const playbackIconKind = !roomState.currentMedia?.mediaUrl || getParticipantPresenceStatus(participant) !== "online" ? "empty" : playbackState === "playing"
      ? "play"
      : playbackState === "paused" ? "pause" : "loading";
    if (icon.dataset.playbackKind !== playbackIconKind) {
      icon.textContent = playbackIconKind === "empty" ? "-" : "";
      if (playbackIconKind !== "empty") icon.innerHTML = createInlineIcon(playbackIconKind);
      icon.dataset.playbackKind = playbackIconKind;
    }
    icon.classList.toggle("is-loading", playbackIconKind === "loading");
    icon.classList.toggle("is-empty", playbackIconKind === "empty");
    icon.title = playbackIconKind === "empty" ? "No media loaded" : playbackState;
  });
}

function handleSeriesEpisodesWheel(event) {
  if (!seriesEpisodesEl || seriesEpisodesEl.scrollWidth <= seriesEpisodesEl.clientWidth) return;

  const horizontalDelta = event.deltaX || event.deltaY;
  if (!horizontalDelta) return;

  event.preventDefault();
  seriesEpisodesEl.scrollLeft += horizontalDelta;
}

function updateSeriesEpisodeOverflow() {
  if (!seriesPanel || !seriesEpisodesEl) return;

  const hasLeftOverflow = seriesEpisodesEl.scrollLeft > 1;
  const hasRightOverflow = seriesEpisodesEl.scrollLeft + seriesEpisodesEl.clientWidth < seriesEpisodesEl.scrollWidth - 1;
  seriesPanel.classList.toggle("has-episode-overflow-left", hasLeftOverflow);
  seriesPanel.classList.toggle("has-episode-overflow-right", hasRightOverflow);
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
    if (Array.isArray(roomState.chat)) {
      roomState.chat = roomState.chat.map((message) => {
        const author = message.author;
        const isLocalAuthor =
          (author?.clientId && author.clientId === clientId) ||
          (state.currentUser?.id && author?.userId && author.userId === state.currentUser.id);
        return isLocalAuthor ? { ...message, author: { ...author, nickname: nextName } } : message;
      });
    }
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
    item.className = "chat-msg-group concept-chat-item";

    const authorIdentity = message.author || { nickname: translate("system") };
    const authorParticipant = roomState.participants?.find((participant) =>
      (authorIdentity.clientId && participant.clientId === authorIdentity.clientId) ||
      (authorIdentity.userId && participant.userId === authorIdentity.userId) ||
      (authorIdentity.nickname && participant.nickname === authorIdentity.nickname)
    );
    const avatar = createParticipantAvatar(authorParticipant || authorIdentity, "chat-av");
    item.appendChild(avatar);

    const content = document.createElement("div");
    content.className = "chat-content";

    const top = document.createElement("div");
    top.className = "chat-meta-row";

    const author = document.createElement("div");
    author.className = "chat-author";
    author.textContent = authorParticipant?.nickname || message.author?.nickname || translate("system");

    const meta = document.createElement("div");
    meta.className = "chat-time";
    meta.textContent = formatClock(message.sentAt);

    top.appendChild(author);
    top.appendChild(meta);

    const body = document.createElement("div");
    body.className = "chat-body";
    body.textContent = message.text || "";

    content.appendChild(top);
    content.appendChild(body);
    item.appendChild(content);
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
    placeholder.textContent = translate("playlistEmpty");
    playlistList.appendChild(placeholder);
    return;
  }

  roomState.playlist.forEach((item) => {
    const card = document.createElement("div");
    card.className = "playlist-item concept-playlist-item";

    const top = document.createElement("div");
    top.className = "playlist-top";

    const icon = document.createElement("div");
    icon.className = "concept-playlist-item-icon";
    icon.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 4h14v16H5z"/><path d="M8 8h8M8 12h8M8 16h5"/></svg>';

    const copy = document.createElement("div");
    copy.className = "concept-playlist-item-copy";

    const title = document.createElement("div");
    title.className = "playlist-name";
    title.textContent = item.title || item.mediaUrl || translate("playlistItem");

    const action = document.createElement("button");
    action.type = "button";
    action.textContent = translate("play");
    action.addEventListener("click", () => {
      sendWs({
        type: "playlist:activate",
        roomId: roomState.code,
        playlistItemId: item.id,
        originId: clientId
      });
    });

    top.appendChild(icon);
    copy.appendChild(title);
    top.appendChild(copy);
    top.appendChild(action);

    const meta = document.createElement("div");
    meta.className = "playlist-meta";
    const addedBy = item.addedBy?.nickname || translate("unknown");
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
    loading.textContent = translate("loadingRooms");
    roomsGrid.appendChild(loading);
    return;
  }

  if (!state.roomsDirectory.length) {
    const empty = document.createElement("div");
    empty.className = "status";
    empty.textContent = translate("noRoomsLinked");
    roomsGrid.appendChild(empty);
    return;
  }

  state.roomsDirectory.forEach((room) => {
    const card = document.createElement("div");
    card.className = "room-card";
    card.dataset.createdAt = String(room.createdAt || Date.now());

    const banner = document.createElement("div");
    banner.className = "room-card-banner";
    const mediaUrl = String(room.currentMediaUrl || "").trim();
    if (/\.(avif|gif|jpe?g|png|webp)(\?.*)?$/i.test(mediaUrl)) {
      banner.style.backgroundImage = `url("${mediaUrl.replace(/"/g, "%22")}")`;
      banner.classList.add("has-media-image");
    }

    const bannerOverlay = document.createElement("div");
    bannerOverlay.className = "room-card-banner-overlay";
    const bannerCopy = document.createElement("div");
    bannerCopy.className = "room-card-banner-copy";
    if (room.currentMediaTitle) {
      const mediaTitle = document.createElement("div");
      mediaTitle.className = "room-card-media-title";
      mediaTitle.textContent = room.currentMediaTitle;
      mediaTitle.setAttribute("title", room.currentMediaTitle);
      bannerCopy.appendChild(mediaTitle);
    }
    const titleLine = document.createElement("div");
    titleLine.className = "room-card-title-line";
    const title = document.createElement("div");
    title.className = "room-card-banner-title";
    title.textContent = room.title || "Room";
    title.setAttribute("title", room.title || "Room");
    titleLine.appendChild(title);
    const isPrivate = Boolean(room.isPrivate || room.private);
    const privacyIcon = document.createElement("span");
    privacyIcon.className = "room-card-privacy-icon";
    privacyIcon.title = isPrivate ? "Private room" : "Public room";
    privacyIcon.setAttribute("aria-label", privacyIcon.title);
    privacyIcon.innerHTML = isPrivate
      ? `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="4" y="10" width="16" height="10" rx="2"></rect><path d="M8 10V7a4 4 0 0 1 8 0v3"></path></svg>`
      : `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"></circle><path d="M3 12h18"></path><path d="M12 3c2.4 2.4 3.6 5.4 3.6 9s-1.2 6.6-3.6 9c-2.4-2.4-3.6-5.4-3.6-9S9.6 5.4 12 3Z"></path><path d="M5.2 6.8c2 1 4.3 1.5 6.8 1.5s4.8-.5 6.8-1.5"></path><path d="M5.2 17.2c2-1 4.3-1.5 6.8-1.5s4.8.5 6.8 1.5"></path></svg>`;
    titleLine.appendChild(privacyIcon);
    bannerCopy.appendChild(titleLine);
    const privacy = document.createElement("button");
    privacy.className = "room-card-code-copy";
    privacy.type = "button";
    privacy.textContent = room.code || "------";
    privacy.title = translate("copyRoomCode");
    privacy.setAttribute("aria-label", translate("copyRoomCode"));
    privacy.addEventListener("click", () => copyToClipboard(room.code));
    bannerOverlay.appendChild(bannerCopy);
    bannerOverlay.appendChild(privacy);
    banner.appendChild(bannerOverlay);
    card.appendChild(banner);

    const body = document.createElement("div");
    body.className = "room-card-body";

    const stats = document.createElement("div");
    stats.className = "room-card-metrics";
    const memberCount = room.memberCount || 0;
    const membersStat = document.createElement("div");
    membersStat.className = "room-card-metric";
    membersStat.innerHTML = `<span class="room-card-metric-label">People</span><strong>${memberCount}</strong>`;
    const ageStat = document.createElement("div");
    ageStat.className = "room-card-metric room-card-session";
    ageStat.innerHTML = `<span class="room-card-metric-label">Date</span><strong class="room-card-age-value">${formatRelativeTime(room.createdAt)}</strong>`;
    stats.appendChild(membersStat);
    stats.appendChild(ageStat);
    body.appendChild(stats);

    const actions = document.createElement("div");
    actions.className = "room-card-actions";

    const primaryActions = document.createElement("div");
    primaryActions.className = "room-card-actions-primary";

    const openButton = document.createElement("button");
    openButton.type = "button";
    openButton.className = "btn btn-primary btn-sm";
    openButton.textContent = translate("open");
    openButton.addEventListener("click", () => {
      window.location.href = resolvePageUrl(`./?room=${encodeURIComponent(room.code)}`);
    });

    const leaveButton = document.createElement("button");
    leaveButton.type = "button";
    leaveButton.className = "btn btn-ghost btn-sm";
    leaveButton.textContent = translate("leave");
    leaveButton.addEventListener("click", () => leaveRoom(room.code));
    primaryActions.appendChild(openButton);
    primaryActions.appendChild(leaveButton);
    actions.appendChild(primaryActions);

    const deleteButton = document.createElement("button");
    deleteButton.type = "button";
    deleteButton.className = "room-card-delete-button danger";
    deleteButton.title = translate("deleteRoom");
    deleteButton.setAttribute("aria-label", translate("deleteRoom"));
    deleteButton.innerHTML = `
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M3 6h18"></path>
        <path d="M8 6V4h8v2"></path>
        <path d="M6 6l1 14h10l1-14"></path>
        <path d="M10 11v6"></path>
        <path d="M14 11v6"></path>
      </svg>
    `;
    deleteButton.addEventListener("click", () => deleteRoom(room.code));
    actions.appendChild(deleteButton);

    body.appendChild(actions);
    card.appendChild(body);
    roomsGrid.appendChild(card);
  });
}

const AVATAR_GRADIENTS = [
  ["#7c5dfa", "#c084fc"],
  ["#34d399", "#059669"],
  ["#38bdf8", "#3b82f6"],
  ["#fb7185", "#e11d48"],
  ["#f59e0b", "#ea580c"],
  ["#22d3ee", "#0891b2"]
];

function getAvatarGradient(participant) {
  const identity = String(
    participant?.userId || participant?.id || participant?.nickname || participant?.clientId || "guest"
  );
  let hash = 0;
  for (const character of identity) {
    hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  }
  const [from, to] = AVATAR_GRADIENTS[hash % AVATAR_GRADIENTS.length];
  return `linear-gradient(135deg, ${from}, ${to})`;
}

function createParticipantAvatar(participant, className = "participant-avatar") {
  const avatarUrl = String(participant?.avatarUrl || participant?.avatar || participant?.photoUrl || "").trim();
  const avatar = document.createElement("div");
  avatar.className = className === "participant-avatar" ? className : `${className} participant-avatar`;
  avatar.setAttribute("aria-hidden", "true");
  avatar.style.background = getAvatarGradient(participant);

  if (avatarUrl) {
    const image = document.createElement("img");
    image.src = avatarUrl;
    image.alt = "";
    image.loading = "lazy";
    image.addEventListener("error", () => {
      image.remove();
      avatar.classList.add("is-fallback");
      avatar.textContent = getParticipantInitials(participant);
    }, { once: true });
    avatar.appendChild(image);
    return avatar;
  }

  avatar.classList.add("is-fallback");
  avatar.textContent = getParticipantInitials(participant);
  return avatar;
}

function updateRoomsDirectoryClock() {
  if (pageMode !== "rooms" || !roomsGrid || roomsGrid.classList.contains("hidden")) return;

  roomsGrid.querySelectorAll(".room-card-session").forEach((session) => {
    const roomCard = session.closest(".room-card");
    const createdAt = Number(roomCard?.dataset.createdAt);
    if (Number.isFinite(createdAt)) {
      const value = session.querySelector(".room-card-age-value");
      if (value) value.textContent = formatRelativeTime(createdAt);
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
  const source = String(participant?.nickname || participant?.displayName || translate("guest")).trim();
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
    window.anyTogetherSyncBridge.connectRoom(nextRoom, nextRole, nextName, hasLocalExtension());
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

function loadMedia(url, forceReload = false) {
  const mediaUrl = String(url || "").trim();
  if (!mediaUrl) return false;

  const mediaUrlInput = document.getElementById("mediaUrl");
  if (!forceReload && mediaUrlInput && String(mediaUrlInput.value || "").trim() === mediaUrl) {
    appendPlaybackDebugEntry("Skipping media load", {
      reason: "same source already loaded",
      sourceUrl: mediaUrl
    });
    return true;
  }

  appendPlaybackDebugEntry("Forwarding media to player", mediaUrl);

  if (window.anyTogetherSyncBridge?.loadMedia) {
    try {
      const loaded = window.anyTogetherSyncBridge.loadMedia(mediaUrl, forceReload);
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

function parseMediaSelectionHash(hash) {
  if (!hash || !hash.startsWith('#')) return null;
  const result = {};
  const tMatch = hash.match(/t:(\d+)/);
  if (tMatch) result.translatorId = parseInt(tMatch[1], 10);
  const sMatch = hash.match(/s:(\d+)/);
  if (sMatch) result.seasonId = parseInt(sMatch[1], 10);
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
    setSearchHint(translate("joinOrCreateRoomFirst"), true);
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
  loadedMediaKey = null;
  const mediaUrlInput = document.getElementById("mediaUrl");
  if (mediaUrlInput) {
    mediaUrlInput.value = "";
  }
  if (currentMediaBadge) {
    currentMediaBadge.textContent = "";
    currentMediaBadge.classList.add("hidden");
  }
  const player = document.getElementById("player");
  const idleState = document.querySelector(".player-idle-state");
  if (player) player.style.display = "none";
  if (idleState) idleState.classList.remove("hidden");
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
  const now = Date.now();

  if (!forceReload && currentLoadedUrl && currentLoadedUrl === effectiveUrl) {
    loadedMediaKey = mediaKey;
    if (shouldAutoplay) {
      triggerPendingAutoplay(roomState.code);
    }
    return;
  }
  const shouldReload = forceReload || loadedMediaKey !== mediaKey;

  if (shouldReload) {
    if (!forceReload && lastSyncMediaKey === mediaKey && now < syncMediaBlockUntil) {
      appendPlaybackDebugEntry("syncActiveRoomMedia throttled", {
        mediaKey,
        remainingMs: syncMediaBlockUntil - now
      });
      return;
    }

    lastSyncMediaKey = mediaKey;
    syncMediaBlockUntil = now + SYNC_BLOCK_DURATION_MS;
    if (roomState.currentMedia.masterPlaylistUrl) {
      const masterUrl = roomState.currentMedia.masterPlaylistUrl;
      const mediaUrlInput = document.getElementById("mediaUrl");
      if (mediaUrlInput) {
        mediaUrlInput.dataset.masterPlaylistUrl = masterUrl;
      }
    }
    loadMedia(effectiveUrl, forceReload);
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
  const canManageRoom = Boolean(roomState && canCurrentUserManageParticipants(roomState));
  if (renameRoomButton) {
    renameRoomButton.classList.remove("hidden");
    renameRoomButton.disabled = !canManageRoom;
    renameRoomButton.title = canManageRoom ? translate("renameRoom") : "Only the room owner can rename the room";
  }
  deleteActiveRoomButton.classList.remove("hidden");
  deleteActiveRoomButton.disabled = !canManageRoom;
  deleteActiveRoomButton.title = canManageRoom ? translate("deleteRoom") : "Only the room owner can delete the room";

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

  const roomState = getRoomState(normalized);
  if (roomState && !canCurrentUserManageParticipants(roomState)) {
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
    if (!queryRoom) {
      sendWs({
        type: "presence:active",
        nickname,
        userId: state.currentUser?.id || null
      });
    }
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
        title: String(roomNameInput?.value || "").trim() || `${normalizeNickname(nicknameInput.value)}'s room`
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
    setJoinHint(translate("enterRoomCode"), true);
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

  ensureLocalParticipant(normalized);
  if (state.activeRoomId === normalized) renderParticipants();

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
  const nextSeriesContext = mergePartialSeriesContext(payload.seriesContext, previousSeriesContext);
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
    poster: payload.poster || payload.posterUrl || previousMedia?.poster || null,
    banner: payload.banner || payload.bannerUrl || payload.backdrop || payload.backdropUrl || previousMedia?.banner || previousMedia?.backdrop || null,
    backdrop: payload.backdrop || payload.backdropUrl || payload.banner || payload.bannerUrl || previousMedia?.backdrop || previousMedia?.banner || null,
    pageUrl: nextPageUrl,
    sourcePageUrl: nextSourcePageUrl,
    title: payload.title || nextSeriesContext?.title || previousMedia?.title || null,
    seriesContext: nextSeriesContext,
    updatedAt: Date.now(),
    addedToPlaylistId: payload.addedToPlaylistId || null
  };
  if (payload.seriesContext) {
    roomState.ui = mergeUiFromSeriesContext(roomState, nextSeriesContext, previousSeriesContext, {
      preferContextSelection: true
    });
  } else if (!roomState.ui) {
    roomState.ui = createDefaultUi(nextSeriesContext);
  }
  roomState.currentPlayback = {
    state: "paused",
    time: 0,
    updatedAt: Date.now()
  };
  sanitizeRoomUi(roomState);
  void enrichCurrentMediaArt(roomState);

  const pendingEpisode = getPendingEpisodeSelection(roomState);
  const payloadSeasonId = Number(nextSeriesContext?.currentSeasonId);
  const payloadEpisodeId = Number(nextSeriesContext?.currentEpisodeId);
  const pendingEpisodeMatched = Boolean(
    pendingEpisode &&
    Number.isFinite(payloadSeasonId) &&
    Number.isFinite(payloadEpisodeId) &&
    pendingEpisode.seasonId === payloadSeasonId &&
    pendingEpisode.episodeId === payloadEpisodeId
  );
  if (pendingEpisodeMatched) {
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
  const shouldReloadPlayer = pendingEpisodeMatched
    || !previousMedia
    || previousLoadSignature !== nextLoadSignature;

  if (shouldBroadcast) {
    sendWs({
      type: "media:set",
      roomId: normalized,
      mediaUrl: payload.mediaUrl,
      masterPlaylistUrl: payload.masterPlaylistUrl || previousMedia?.masterPlaylistUrl || null,
      pageUrl: payload.pageUrl || previousMedia?.pageUrl || null,
      sourcePageUrl: payload.sourcePageUrl || previousMedia?.sourcePageUrl || null,
      title: payload.title || nextSeriesContext?.title || null,
      seriesContext: nextSeriesContext,
      originId: clientId
    });
  }

  if (state.activeRoomId === normalized && shouldReloadPlayer) {
    refreshActiveRoom();
    syncActiveRoomMedia(true);
  }
}

async function enrichCurrentMediaArt(roomState) {
  const media = roomState?.currentMedia;
  const title = getTmdbSeriesTitle(media);
  console.log("[TMDB] Enrichment requested", {
    roomId: roomState?.code || null,
    title,
    mediaTitle: media?.title || null,
    contextTitle: media?.seriesContext?.title || null,
    sourcePageUrl: media?.sourcePageUrl || media?.pageUrl || null
  });
  if (!media || !title) return;
  const lookupKey = `${title}:${media.mediaUrl || ""}`;
  const needsArt = !media.poster || !media.banner;
  const needsEpisodes = Array.isArray(media.seriesContext?.seasons) &&
    media.seriesContext.seasons.some((season) => !season.tmdbLookupDone);
  if (media.artLookupKey === lookupKey && !needsEpisodes) return;
  media.artLookupKey = lookupKey;
  try {
    await enrichSeriesEpisodes(roomState);
    if (roomState.currentMedia !== media) return;
    if (!needsArt) {
      if (state.activeRoomId === roomState.code) renderSeriesPanel();
      return;
    }
    const response = await fetch(resolveBackendUrl(`/api/media-art?query=${encodeURIComponent(title)}`));
    console.log("[TMDB] Media search response", { title, status: response.status, url: response.url });
    if (roomState.currentMedia !== media) return;
    if (!response.ok) return;
    const result = await response.json();
    const match = Array.isArray(result.results) ? result.results[0] : null;
    if (!match) {
      if (state.activeRoomId === roomState.code) renderSeriesPanel();
      return;
    }
    media.poster ||= match.poster;
    media.banner ||= match.banner;
    media.backdrop ||= match.banner;
    if (state.activeRoomId === roomState.code) renderSeriesPanel();
  } catch {
    media.artLookupKey = null;
  }
}

function getTmdbSeriesTitle(media) {
  const contextTitle = String(media?.seriesContext?.title || "").trim();
  const mediaTitle = String(media?.title || "").trim();
  const isPlaceholder = /^(?:episode|сер(?:и|і)я)\s*\d+$/i.test(contextTitle) ||
    /^(?:episode|сер(?:и|і)я)\s*\d+$/i.test(mediaTitle);
  const sourceUrl = media?.sourcePageUrl || media?.pageUrl || media?.seriesContext?.resolver?.pageUrl;
  try {
    const pathname = new URL(sourceUrl).pathname;
    const slug = decodeURIComponent(pathname.split("/").filter(Boolean).pop() || "")
      .replace(/\.html?$/i, "")
      .replace(/^\d+[-_\s]+/, "")
      .replace(/[-_](?:19|20)\d{2}(?:$|[-_])/i, "-")
      .replace(/[-_]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    if (slug) return slug;
  } catch {
    // Fall back to the extracted page title when the source URL is unavailable.
  }
  if (contextTitle && !isPlaceholder) return contextTitle;
  if (mediaTitle && !isPlaceholder) return mediaTitle;
  return "";
}

async function enrichSeriesEpisodes(roomState) {
  const media = roomState?.currentMedia;
  const context = media?.seriesContext;
  const title = getTmdbSeriesTitle(media);
  console.log("[TMDB] Episode enrichment requested", {
    roomId: roomState?.code || null,
    title,
    seasonCount: Array.isArray(context?.seasons) ? context.seasons.length : 0,
    episodeCount: Array.isArray(context?.episodes) ? context.episodes.length : 0
  });
  if (!context || !title) return;
  const seasons = Array.isArray(context.seasons) ? context.seasons : [];
  for (const season of seasons) {
    const seasonNumber = Number(season.seasonId ?? season.seasonNumber);
    if (!Number.isFinite(seasonNumber) || seasonNumber < 0 || season.tmdbLookupDone) continue;
    season.tmdbLookupDone = true;
    try {
      const endpoint = resolveBackendUrl(`/api/tv-episodes?query=${encodeURIComponent(title)}&season=${seasonNumber}`);
      console.log("[TMDB] Episode search request", { title, season: seasonNumber, url: endpoint });
      const response = await fetch(endpoint);
      console.log("[TMDB] Episode search response", { title, season: seasonNumber, status: response.status, url: response.url });
      if (!response.ok) continue;
      if (roomState.currentMedia !== media) return;
      const result = await response.json();
      state.tmdbSeasonCache.set(`${title.toLowerCase()}:${seasonNumber}`, Array.isArray(result.episodes) ? result.episodes : []);
      const byNumber = new Map((result.episodes || []).map((episode) => [Number(episode.episodeNumber), episode]));
      const episodes = getEpisodesForSeason(season, context);
      let matchedCount = 0;
      for (const [index, episode] of episodes.entries()) {
        const episodeNumber = getEpisodeNumber(episode, index);
        const tmdbEpisode = byNumber.get(episodeNumber);
        if (!tmdbEpisode) continue;
        state.tmdbEpisodeCache.set(`${title.toLowerCase()}:${seasonNumber}:${episodeNumber}`, tmdbEpisode);
        episode.title = tmdbEpisode.title || episode.title;
        episode.thumbnail ||= tmdbEpisode.thumbnail;
        matchedCount += 1;
      }
      console.log("[TMDB] Episodes matched", { title, season: seasonNumber, sourceCount: episodes.length, tmdbCount: byNumber.size, matchedCount });
    } catch {
      season.tmdbLookupDone = false;
    }
  }
}

function updateRoomSeriesContext(roomId, payload, preferContextSelection = true) {
  const normalized = normalizeRoomCode(roomId);
  const incomingContext = payload?.seriesContext || null;
  if (!normalized || !incomingContext) return null;

  const roomState = ensureRoomState(normalized);
  const previousMedia = roomState.currentMedia || null;
  const previousSeriesContext = previousMedia?.seriesContext || null;
  const nextSeriesContext = mergePartialSeriesContext(incomingContext, previousSeriesContext);

  roomState.currentMedia = {
    mediaUrl: previousMedia?.mediaUrl || null,
    masterPlaylistUrl: previousMedia?.masterPlaylistUrl || null,
    pageUrl: payload.pageUrl || nextSeriesContext?.resolver?.pageUrl || previousMedia?.pageUrl || null,
    sourcePageUrl: payload.sourcePageUrl || nextSeriesContext?.resolver?.pageUrl || previousMedia?.sourcePageUrl || null,
    title: payload.title || nextSeriesContext?.title || previousMedia?.title || null,
    seriesContext: nextSeriesContext,
    updatedAt: Date.now(),
    addedToPlaylistId: previousMedia?.addedToPlaylistId || null
  };
  void enrichCurrentMediaArt(roomState);
  roomState.ui = mergeUiFromSeriesContext(roomState, nextSeriesContext, previousSeriesContext, {
    preferContextSelection
  });
  sanitizeRoomUi(roomState);
  state.roomStates.set(normalized, roomState);

  if (state.activeRoomId === normalized) {
    refreshActiveRoom();
  }

  return roomState;
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
    episodeId: targetEpisode.episodeId,
    title: targetEpisode.title || null
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

  console.log("[Interface UI] Media picker resolution requested:", {
    roomId,
    seasonId: payload.targetEpisode?.seasonId ?? null,
    episodeId: payload.targetEpisode?.episodeId ?? null,
    translatorId: payload.selectedTranslatorId ?? null,
    qualityLabel: payload.selectedQualityLabel || null
  });

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
    setSearchHint(translate("joinOrCreateRoomFirst"), true);
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
    setSearchHint(translate("joinOrCreateRoomFirst"), true);
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

function notifyRoomExitForNavigation() {
  if (!queryRoom || !state.activeRoomId || state.ws?.readyState !== WebSocket.OPEN) return;
  state.ws.send(JSON.stringify({
    type: "room:leave",
    roomId: state.activeRoomId,
    keepNotInRoom: true,
    originId: clientId
  }));
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
    sendWs({
      type: "presence:active",
      nickname: normalizeNickname(nicknameInput.value),
      userId: state.currentUser?.id || null
    });

    const roomsToJoin = queryRoom
      ? new Set([...pendingRoomJoins, queryRoom])
      : new Set();
    roomsToJoin.forEach((roomId) => {
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
      const roleRoomId = normalizeRoomCode(msg.roomId);
      if (roleRoomId && roleRoomId !== state.activeRoomId) return;
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

    if (msg.type === "series-context:set") {
      const roomId = normalizeRoomCode(msg.roomId);
      if (!roomId || msg.originId === clientId) return;
      console.log(
        `[Interface UI] Series context received ${msg.contextEventId || "unknown"} room=${roomId} ` +
        `episodes=${Array.isArray(msg.seriesContext?.episodes) ? msg.seriesContext.episodes.length : 0} ` +
        `at=${Date.now()}`
      );
      updateRoomSeriesContext(roomId, msg, true);
      return;
    }

    if (msg.type === "series-context:ack") {
      console.log(
        `[Interface UI] Series context acknowledged ${msg.contextEventId || "unknown"} ` +
        `room=${normalizeRoomCode(msg.roomId) || "unknown"} ` +
        `serverReceivedAt=${msg.receivedAt || "unknown"} browserReceivedAt=${Date.now()}`
      );
      return;
    }

    if (msg.type === "media:set") {
      const roomId = normalizeRoomCode(msg.roomId);
      if (!roomId || msg.originId === clientId) return;

      console.log("[Interface UI] Remote media update received:", {
        roomId,
        seasons: Array.isArray(msg.seriesContext?.seasons) ? msg.seriesContext.seasons.length : 0,
        episodes: Array.isArray(msg.seriesContext?.episodes) ? msg.seriesContext.episodes.length : 0,
        qualities: Array.isArray(msg.seriesContext?.availableQualities) ? msg.seriesContext.availableQualities.length : 0,
        seasonId: msg.seriesContext?.currentSeasonId ?? null,
        episodeId: msg.seriesContext?.currentEpisodeId ?? null
      });

      const prevRoomState = getRoomState(roomId);
      const prevSeriesContext = prevRoomState?.currentMedia?.seriesContext
        ? JSON.parse(JSON.stringify(prevRoomState.currentMedia.seriesContext))
        : null;
      const prevUi = prevRoomState ? { ...prevRoomState.ui } : null;

      updateRoomFromMediaPayload(roomId, msg, false);

      const newRoomState = getRoomState(roomId);
      const newSeriesContext = newRoomState?.currentMedia?.seriesContext || null;
      const seriesChanged = JSON.stringify(newSeriesContext) !== JSON.stringify(prevSeriesContext);

      if (newRoomState && seriesChanged) {
        clearPendingEpisodeSelection(newRoomState);
        newRoomState.ui = createDefaultUi(newRoomState.currentMedia?.seriesContext || null);
        if (typeof prevUi?.codeHidden === "boolean") {
          newRoomState.ui.codeHidden = prevUi.codeHidden;
        }
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
    setJoinHint(translate("enterRoomCode"), true);
    return;
  }

  input.value = roomCode;
  handleRoomJoin(roomCode, { navigateHome: true, setActive: true });
}

function handleRoomsJoinInput() {
  const roomCode = normalizeRoomCode(roomsJoinInput.value);
  if (!roomCode) {
    setJoinHint(translate("enterRoomCode"), true);
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
  seriesEpisodesEl?.addEventListener("wheel", handleSeriesEpisodesWheel, { passive: false });
  seriesEpisodesEl?.addEventListener("scroll", updateSeriesEpisodeOverflow, { passive: true });
  window.addEventListener("resize", updateSeriesEpisodeOverflow);

  document.querySelectorAll(".sidebar .playlist-header").forEach((toggle) => {
    toggle.addEventListener("click", () => {
      const panel = toggle.closest(".sidebar-section");
      if (panel) panel.classList.toggle("is-collapsed");
    });
  });

  document.querySelectorAll(".concept-panel-header").forEach((toggle) => {
    toggle.addEventListener("click", () => {
      const panel = toggle.closest(".concept-sidebar-panel");
      if (panel) panel.classList.toggle("is-collapsed");
    });
  });

  [seasonPicker, episodePicker, translatorPicker].forEach((picker) => {
    const summary = picker?.querySelector(":scope > summary");
    if (!picker || !summary) return;

    summary.addEventListener("click", (event) => {
      if (!event.target.closest("button")) return;
      event.preventDefault();
      picker.open = !picker.open;
    });
  });

  if (homeLink) homeLink.href = resolvePageUrl("./");
  document.querySelectorAll("a[href]").forEach((link) => {
    link.addEventListener("click", () => {
      if (queryRoom) {
        const targetUrl = new URL(link.href, window.location.href);
        if (targetUrl.searchParams.get("room") !== queryRoom) {
          notifyRoomExitForNavigation();
        }
      }
    });
  });
  roomsLinks.forEach((link) => {
    link.href = resolvePageUrl("./?page=rooms");
  });
  createRoomButton?.addEventListener("click", createRoom);
  createdRoomCodeButton?.addEventListener("click", () => copyToClipboard(createdRoomCodeValue.textContent));
  homeSignInButton?.addEventListener("click", () => {
    window.location.href = resolvePageUrl("./?page=rooms&auth=signin");
  });
  homeSignUpButton?.addEventListener("click", () => {
    window.location.href = resolvePageUrl("./?page=rooms&auth=signup");
  });
  joinRoomButton?.addEventListener("click", () => handleRoomJoinInput(roomCodeInput));
  roomsCreateButton?.addEventListener("click", createRoom);
  roomsJoinButton?.addEventListener("click", handleRoomsJoinInput);
  refreshRoomsButton?.addEventListener("click", fetchRoomsDirectory);
  reconnectButton?.addEventListener("click", connectWs);
  clearPlaybackDebugButton?.addEventListener("click", () => {
    if (playbackDebugLog) {
      playbackDebugLog.textContent = "";
    }
  });
  signOutButtons.forEach((button) => button.addEventListener("click", signOutAccount));
  signInButtons.forEach((button) => button.addEventListener("click", (event) => {
    event.stopPropagation();
    closeTopbarMenu();
    window.location.href = resolvePageUrl("./?page=rooms&auth=signin");
  }));
  signUpButtons.forEach((button) => button.addEventListener("click", (event) => {
    event.stopPropagation();
    closeTopbarMenu();
    window.location.href = resolvePageUrl("./?page=rooms&auth=signup");
  }));
  changeNicknameButtons.forEach((button) => button.addEventListener("click", (event) => {
    event.stopPropagation();
    const participant = getSelfParticipant(getActiveRoomState()) || { clientId };
    promptParticipantNicknameChange(participant);
    closeTopbarMenu();
  }));
  topbarAvatarButtons.forEach((button) => button.addEventListener("click", (event) => {
    event.stopPropagation();
    const accountMenuIsOpen = state.topbarMenuOpen && !state.languageMenuOpen;
    if (accountMenuIsOpen) {
      closeTopbarMenu();
      return;
    }
    state.topbarMenuOpen = true;
    state.languageMenuOpen = false;
    renderTopbarUser();
  }));
  languageMenuButtons.forEach((button) => button.addEventListener("click", (event) => {
    event.stopPropagation();
    const isRoomLanguageButton = Boolean(button.closest(".concept-room-topbar-user"));
    if (!isRoomLanguageButton && (!isAuthenticated() || !state.topbarMenuOpen)) return;
    setLanguageMenuOpen(!state.languageMenuOpen);
  }));
  languageEnglishButtons.forEach((button) => button.addEventListener("click", (event) => {
    event.stopPropagation();
    setLanguage("en");
    setLanguageMenuOpen(false);
  }));
  languageRussianButtons.forEach((button) => button.addEventListener("click", (event) => {
    event.stopPropagation();
    setLanguage("ru");
    setLanguageMenuOpen(false);
  }));
  lastRoomButtons.forEach((button) => button.addEventListener("click", (event) => {
    const roomCode = button.getAttribute("data-room") || state.activeRoomId || state.joinedRooms[0];
    if (!roomCode) {
      event.preventDefault();
      return;
    }
    event.preventDefault();
    window.location.href = resolvePageUrl(`./?room=${encodeURIComponent(roomCode)}`);
  }));
  deleteActiveRoomButton?.addEventListener("click", () => {
    if (state.activeRoomId) {
      deleteRoom(state.activeRoomId);
    }
  });
  renameRoomButton?.addEventListener("click", promptRoomRename);
  leaveRoomButton?.addEventListener("click", leaveActiveRoom);
  activeRoomCodeButton?.addEventListener("click", () => {
    if (state.activeRoomId) {
      copyToClipboard(state.activeRoomId);
    }
  });
  activeRoomCodeToggleButton?.addEventListener("click", () => {
    if (!state.activeRoomId) return;
    setRoomCodeHidden(state.activeRoomId, !getRoomCodeHidden(state.activeRoomId));
    updateActiveRoomCodeControls();
    if (pageMode === "rooms") {
      renderRoomsDirectory();
    }
  });
  document.addEventListener("click", (event) => {
    const target = event.target instanceof Element ? event.target : null;
    if (state.topbarMenuOpen && (!target || !target.closest(".topbar-user, .concept-room-topbar-user"))) {
      closeTopbarMenu();
    }
  }, true);
  document.addEventListener("pointerdown", (event) => {
    const target = event.target instanceof Element ? event.target : null;
    if (state.topbarMenuOpen && (!target || !target.closest(".topbar-user, .concept-room-topbar-user"))) {
      closeTopbarMenu();
    }
  }, true);
  document.addEventListener("click", (event) => {
    if (!state.openParticipantMenuKey) return;
    if (event.target.closest(".participant-actions")) return;
    if (event.target.closest(".participant-menu")) return;
    state.openParticipantMenuKey = null;
    renderParticipants();
  });
  topbarRoomCodeButton?.addEventListener("click", () => {
    if (!state.activeRoomId) return;
    window.location.href = resolvePageUrl(`./?room=${encodeURIComponent(state.activeRoomId)}`);
  });
  addToPlaylistButton?.addEventListener("click", addCurrentMediaToPlaylist);
  suggestButton?.addEventListener("click", suggestCurrentMedia);
  authToggleButton?.addEventListener("click", () => setAuthMode(state.authMode === "signup" ? "signin" : "signup"));
  googleSignInButton?.addEventListener("click", () => setAuthStatus("Google sign-in is not configured yet.", true));
  appleSignInButton?.addEventListener("click", () => setAuthStatus("Apple sign-in is not configured yet.", true));
  forgotPasswordButton?.addEventListener("click", () => setAuthStatus("Password reset is not configured yet.", true));

  authForm?.addEventListener("submit", async (event) => {
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

  async function handleSearchSubmit() {
    const query = searchInput.value.trim();
    if (!query) {
      setSearchHint("Enter a search query", true);
      return;
    }

    if (isDirectMediaUrl(query)) {
      loadDirectMediaUrl(query);
      return;
    }

    let hashParams = null;
    try {
      const url = new URL(query);
      hashParams = parseMediaSelectionHash(url.hash);
    } catch {}

    pendingMediaSelection = hashParams;
    if (hashParams) {
      appendPlaybackDebugEntry("Media selection saved for loading", hashParams);
    }

    _lastLoadedMediaKey = "";

    // Option D: Open DuckDuckGo search directly in popup window (not iframe)
    const searchUrl = 'https://html.duckduckgo.com/html/?q=' + encodeURIComponent(query);

    const features = [
      'width=' + Math.round(window.screen.width/1.5),
      'height=' + Math.round(window.screen.height/1.5),
      'left=' + Math.round(window.screen.width/4),
      'top=' + Math.round(window.screen.height/4),
      'toolbar=no',
      'location=no',
      'status=no',
      'menubar=no',
      'scrollbars=yes',
      'resizable=yes',
      'popup=yes',
      'noopener=yes'
    ];
    if (_searchPopupWindow && !_searchPopupWindow.closed) {
      try { _searchPopupWindow.close(); } catch {}
    }
    _searchPopupWindow = window.open(searchUrl, 'AnyTogetherSearch', features.join(','));
    if (!_searchPopupWindow) {
      setSearchHint("Allow popups for this site to open search results.", true);
      return;
    }
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
  }

  searchInput?.addEventListener("keydown", (event) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    handleSearchSubmit();
  });

  searchClearButton?.addEventListener("click", () => {
    searchInput.value = "";
    setSearchHint("");
    searchInput.focus();
  });

  searchButton?.addEventListener("click", handleSearchSubmit);
  window.handleAnyTogetherSearch = handleSearchSubmit;

  nicknameInput?.addEventListener("change", syncProfile);
  nicknameInput?.addEventListener("blur", syncProfile);

  roomCodeInput?.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      handleRoomJoinInput(roomCodeInput);
    }
  });

  roomsJoinInput?.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      handleRoomsJoinInput();
    }
  });

  authIdentifierInput?.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && state.authMode === "signin") {
      event.preventDefault();
      authForm.requestSubmit();
    }
  });

  authPasswordInput?.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      authForm.requestSubmit();
    }
  });

  chatForm?.addEventListener("submit", (event) => {
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
  setInterval(refreshParticipantSyncIndicators, 250);
  setInterval(() => {
    if (!queryRoom && state.ws?.readyState === WebSocket.OPEN) {
      sendWs({
        type: "presence:active",
        nickname: normalizeNickname(nicknameInput.value),
        userId: state.currentUser?.id || null
      });
    }
  }, 2000);
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
  updateLanguageDependentText();
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
    const title = event.detail?.title || "Playback event";
    const detail = event.detail?.detail || "";
    appendPlaybackDebugEntry(title, detail);
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

    if (event.data?.type === "anytogether:participant-playback") {
      const roomId = normalizeRoomCode(event.data.roomId);
      if (!roomId || roomId !== state.activeRoomId) return;
      for (const member of Array.isArray(event.data.members) ? event.data.members : []) {
        if (member?.clientId) {
          participantPlaybackStates.set(member.clientId, member.playbackState || "paused");
        }
      }
      if (participantsList.querySelector("[data-playback-status]")) {
        refreshParticipantPlaybackIndicators();
      } else {
        renderParticipants();
      }
      return;
    }
    if (event.data?.type === "anytogether:series-context") {
      const roomId = normalizeRoomCode(event.data.roomId);
      console.log(
        `[Interface UI] Playback series context received room=${roomId || "unknown"} ` +
        `episodes=${Array.isArray(event.data.seriesContext?.episodes) ? event.data.seriesContext.episodes.length : 0} ` +
        `origin=${event.data.originId || "none"} local=${clientId} receivedAt=${Date.now()}`
      );
      if (!roomId || !event.data.seriesContext || event.data.originId === clientId) return;
      updateRoomSeriesContext(roomId, event.data, true);
      console.log(`[Interface UI] Playback series context applied room=${roomId} at=${Date.now()}`);
      return;
    }
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

      updateRoomSeriesContext(roomId, payload, true);
      console.log(
        `[Interface UI] Local series context applied room=${roomId} ` +
        `episodes=${Array.isArray(seriesContext.episodes) ? seriesContext.episodes.length : 0} ` +
        `strategy=${seriesContext.discoveryStrategy || "unknown"} at=${Date.now()}`
      );
      const contextSignature = buildSeriesContextSignature(seriesContext);
      if (lastBroadcastSeriesContextSignatures.get(roomId) !== contextSignature) {
        const contextEventId = crypto.randomUUID();
        console.log(
          `[Interface UI] Series context sent ${contextEventId} room=${roomId} ` +
          `episodes=${Array.isArray(seriesContext.episodes) ? seriesContext.episodes.length : 0} ` +
          `strategy=${seriesContext.discoveryStrategy || "unknown"} ` +
          `at=${Date.now()}`
        );
        const contextWasSent = sendWs({
          type: "series-context:set",
          contextEventId,
          roomId,
          pageUrl: payload.pageUrl || null,
          sourcePageUrl: payload.sourcePageUrl || payload.pageUrl || null,
          title: seriesContext.title || null,
          seriesContext,
          originId: clientId
        });
        if (contextWasSent) {
          lastBroadcastSeriesContextSignatures.set(roomId, contextSignature);
        }
      }
      return;
    }

    if (event.data?.type === PAGE_EVENT_EXTRACTION_DIAGNOSTIC) {
      const payload = event.data.payload || {};
      const fields = [
        payload.durationMs != null ? `durationMs=${payload.durationMs}` : null,
        payload.episodes != null ? `episodes=${payload.episodes}` : null,
        payload.bytes != null ? `bytes=${payload.bytes}` : null,
        payload.status != null ? `status=${payload.status}` : null,
        payload.configuredWaitMs != null ? `configuredWaitMs=${payload.configuredWaitMs}` : null,
        payload.error ? `error=${payload.error}` : null,
        payload.pageUrl ? `pageUrl=${String(payload.pageUrl).substring(0, 100)}` : null
      ].filter(Boolean);
      console.log(`[Extraction] ${payload.stage || "unknown"}${fields.length ? ` ${fields.join(" ")}` : ""}`);
      return;
    }

    if (event.data?.type === PAGE_EVENT_MEDIA_FOUND) {
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

      const isExtensionSource =
        /^chrome-extension:\/\//i.test(String(payload.pageUrl || "")) ||
        /^chrome-extension:\/\//i.test(String(payload.sourcePageUrl || ""));
      if (!incomingRoomId && isExtensionSource) {
        appendPlaybackDebugEntry("Ignoring extension-origin media event", {
          pageUrl: payload.pageUrl || null,
          sourcePageUrl: payload.sourcePageUrl || null,
          mediaUrl: String(payload.mediaUrl || "").substring(0, 80)
        });
        return;
      }

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
      const hasSeriesContext = hasNavigableSeriesContext(payload.seriesContext);
      const currentSeriesContext = roomState.currentMedia?.seriesContext || null;
      const contextWasExpanded = hasSeriesContextUpgrade(payload.seriesContext, currentSeriesContext);
      const video = document.getElementById('player');
      if (
        video &&
        Number.isFinite(video.currentTime) &&
        video.currentTime > 1 &&
        !video.paused &&
        mediaUrl === _lastLoadedMediaKey &&
        !contextWasExpanded
      ) {
        appendPlaybackDebugEntry("Ignoring same URL already playing", { url: mediaUrl.substring(0, 80) });
        return;
      }

      const now = Date.now();

      if (!incomingRoomId && hasSeriesContext) {
        clearPendingEpisodeSelection(roomState);
      }
      const pendingEpisode = getPendingEpisodeSelection(roomState);
      const payloadSeasonId = Number(payload.seriesContext?.currentSeasonId);
      const payloadEpisodeId = Number(payload.seriesContext?.currentEpisodeId);
      const payloadMatchesPendingEpisode =
        pendingEpisode &&
        Number.isFinite(payloadSeasonId) &&
        Number.isFinite(payloadEpisodeId) &&
        pendingEpisode.seasonId === payloadSeasonId &&
        pendingEpisode.episodeId === payloadEpisodeId;

      if (pendingEpisode && !payloadMatchesPendingEpisode) {
        appendPlaybackDebugEntry("Ignoring media while episode switch is pending", {
          pendingSeasonId: pendingEpisode.seasonId,
          pendingEpisodeId: pendingEpisode.episodeId,
          payloadSeasonId: Number.isFinite(payloadSeasonId) ? payloadSeasonId : null,
          payloadEpisodeId: Number.isFinite(payloadEpisodeId) ? payloadEpisodeId : null,
          hasSeriesContext: hasSeriesContext ? "yes" : "no",
          url: mediaUrl.substring(0, 80)
        });
        return;
      }

      if (payloadMatchesPendingEpisode) {
        _lastLoadBlockedUntil = 0;
      }

      if (
        !incomingRoomId &&
        mediaUrl !== _lastLoadedMediaKey &&
        _lastLoadHadContext &&
        isSameMediaSelection(payload.seriesContext, currentSeriesContext) &&
        !contextWasExpanded
      ) {
        appendPlaybackDebugEntry("Ignoring alternate URL for current media selection", {
          url: mediaUrl.substring(0, 80)
        });
        return;
      }

      if (mediaUrl === _lastLoadedMediaKey) {
        if (_lastLoadHadContext && !contextWasExpanded) {
          appendPlaybackDebugEntry("Ignoring duplicate media URL (already loaded with context)", { url: mediaUrl.substring(0, 80) });
          return;
        }
        if (hasSeriesContext || contextWasExpanded) {
          appendPlaybackDebugEntry("Replacing URL with series context", { url: mediaUrl.substring(0, 80) });
          _lastLoadBlockedUntil = 0;
        }
      }

      if (contextWasExpanded) {
        _lastLoadBlockedUntil = 0;
      }

      if (now < _lastLoadBlockedUntil) {
        appendPlaybackDebugEntry("Load throttled (5s window)", { url: mediaUrl.substring(0, 80), remainingMs: _lastLoadBlockedUntil - now });
        return;
      }

      _lastLoadedMediaKey = mediaUrl;
      _lastLoadBlockedUntil = now + LOAD_BLOCK_DURATION_MS;
      _lastLoadHadContext = hasSeriesContext || hasNavigableSeriesContext(roomState.currentMedia?.seriesContext);

      console.log("[Interface UI] Media payload accepted:", {
        roomId: incomingRoomId || effectiveRoomId,
        seasons: Array.isArray(payload.seriesContext?.seasons) ? payload.seriesContext.seasons.length : 0,
        episodes: Array.isArray(payload.seriesContext?.episodes) ? payload.seriesContext.episodes.length : 0,
        qualities: Array.isArray(payload.seriesContext?.availableQualities) ? payload.seriesContext.availableQualities.length : 0,
        seasonId: payload.seriesContext?.currentSeasonId ?? null,
        episodeId: payload.seriesContext?.currentEpisodeId ?? null
      });

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

      if (pendingMediaSelection) {
        const selection = pendingMediaSelection;
        const rs = getRoomState(effectiveRoomId);
        if (rs) {
          if (selection.translatorId) rs.ui.translatorId = selection.translatorId;
          if (selection.seasonId) rs.ui.seasonId = selection.seasonId;
          if (selection.episodeId) rs.ui.episodeId = selection.episodeId;
          appendPlaybackDebugEntry("Media selection applied after loading", selection);
          renderSeriesPanel();
          const episode = getSelectedEpisodeForActions();
          if (episode) {
            requestEpisodeResolution(episode, {
              translatorId: rs.ui.translatorId,
              qualityLabel: rs.ui.qualityLabel
            });
          }
        }
        pendingMediaSelection = null;
      }

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

  void probeExtensionAvailability().then((detected) => {
    console.log("[Interface UI] Extension availability:", detected ? "detected" : "not detected");
  });

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
    if (!roomState || !hasLocalExtension()) return;

    console.log("[Interface UI] Media picker request received:", {
      seasonId: detail.requestedSeasonId ?? null,
      episodeId: detail.requestedEpisodeId ?? null,
      translatorId: detail.requestedTranslatorId ?? null,
      qualityLabel: detail.requestedQualityLabel || null,
      from: detail.requestedBy || null
    });

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

window.anyTogetherUI = Object.freeze({
  createRoom,
  joinRoom: () => handleRoomJoinInput(roomCodeInput),
  leaveRoom: leaveActiveRoom,
  addCurrentMediaToPlaylist,
  suggestCurrentMedia
});

void start();
