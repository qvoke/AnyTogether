import http from "node:http";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocketServer } from "ws";
import crypto, { pbkdf2Sync, timingSafeEqual } from "node:crypto";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const publicDir = path.join(__dirname, "public");
const port = 3000;
const controlLeaseMs = 1200;

// Disk persistence variables
const dataDir = path.join(__dirname, "data");
const roomStorePath = path.join(dataDir, "rooms.json");
const authStorePath = path.join(dataDir, "auth.json");

const contentTypes = new Map([
  [".html", "text/html; charset=utf-8"],
  [".css", "text/css; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".svg", "image/svg+xml"],
  [".ico", "image/x-icon"]
]);

const defaultPlaybackSnapshot = {
  mediaUrl: "",
  currentTime: 0,
  paused: true,
  playbackRate: 1,
  volume: 1,
  muted: false
};

// Unified Maps and Sets
const rooms = new Map();
const roomMembers = new Map();
const socketState = new Map();
const connectedSockets = new Set();
const usersById = new Map();
const sessionsByToken = new Map();

let persistTimer = null;
let authPersistTimer = null;

function now() {
  return Date.now();
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

function normalizeDisplayName(value) {
  const displayName = String(value || "").trim().slice(0, 60);
  return displayName || "Guest";
}

// Password hashing & session logic
function createPasswordRecord(password, salt = null) {
  const passwordSalt = salt || crypto.randomBytes(16).toString("hex");
  const passwordHash = pbkdf2Sync(String(password || ""), passwordSalt, 120000, 64, "sha512").toString("hex");

  return { passwordSalt, passwordHash };
}

function verifyPassword(password, passwordSalt, expectedHash) {
  const actualHash = pbkdf2Sync(String(password || ""), passwordSalt, 120000, 64, "sha512");
  const expectedBuffer = Buffer.from(String(expectedHash || ""), "hex");

  if (expectedBuffer.length !== actualHash.length) {
    return false;
  }

  return timingSafeEqual(actualHash, expectedBuffer);
}

function createRoom(roomId, title = null, ownerId = null) {
  const code = normalizeRoomCode(roomId);
  const createdAt = now();
  return {
    roomId: code,
    code,
    title: title || `Room ${code}`,
    ownerId: ownerId ? String(ownerId) : null,
    createdAt,
    sessionStartedAt: createdAt,
    lastUpdatedAt: createdAt,
    chat: [],
    playlist: [],
    currentMedia: null,
    currentPlayback: {
      state: "paused",
      time: 0,
      updatedAt: createdAt
    },

    // Playback sync properties:
    revision: 0,
    snapshot: null,
    clients: new Set(), // Playback sync WebSocket clients (Connection 1)
    control: {
      clientId: null,
      name: "",
      role: "",
      leaseUntil: 0,
      actionId: null
    }
  };
}

function getRoom(roomId) {
  const normalized = normalizeRoomCode(roomId);
  if (!normalized) return null;

  if (!rooms.has(normalized)) {
    rooms.set(normalized, createRoom(normalized));
  }

  return rooms.get(normalized);
}

function ensureRoom(roomCode, title, ownerId = null) {
  const normalizedCode = normalizeRoomCode(roomCode);
  if (!normalizedCode) return null;

  if (!rooms.has(normalizedCode)) {
    rooms.set(normalizedCode, createRoom(normalizedCode, title, ownerId));
    schedulePersist();
  }

  const room = rooms.get(normalizedCode);
  if (title && !room.title) {
    room.title = title;
    room.lastUpdatedAt = now();
    schedulePersist();
  }

  if (ownerId && !room.ownerId) {
    room.ownerId = String(ownerId);
    room.lastUpdatedAt = now();
    schedulePersist();
  }

  return room;
}

function getRoomMembers(roomCode) {
  const normalized = normalizeRoomCode(roomCode);
  if (!normalized) return new Set();

  if (!roomMembers.has(normalized)) {
    roomMembers.set(normalized, new Set());
  }

  return roomMembers.get(normalized);
}

function getSocketState(socket) {
  if (!socketState.has(socket)) {
    socketState.set(socket, {
      socketId: crypto.randomUUID(),
      nickname: "Guest",
      role: "guest",
      clientId: null,
      userId: null,
      sessionToken: null,
      rooms: new Set(),
      joinedAtByRoom: {}
    });
  }

  return socketState.get(socket);
}

function serializeControl(room) {
  if (!room.control.clientId) {
    return null;
  }

  return {
    ...room.control
  };
}

function serializeSnapshot(room) {
  if (!room.snapshot) {
    return null;
  }

  return {
    ...room.snapshot,
    control: serializeControl(room)
  };
}

function sendJson(responseOrSocket, statusCodeOrPayload, payloadIfResponse = null) {
  if (typeof responseOrSocket.writeHead === "function") {
    // It's an HTTP response
    responseOrSocket.writeHead(statusCodeOrPayload, { "Content-Type": "application/json; charset=utf-8" });
    responseOrSocket.end(JSON.stringify(payloadIfResponse));
  } else {
    // It's a WebSocket
    if (responseOrSocket.readyState === 1) {
      responseOrSocket.send(JSON.stringify(statusCodeOrPayload));
    }
  }
}

function broadcast(room, payload, exceptSocket = null) {
  for (const client of room.clients) {
    if (client === exceptSocket || client.readyState !== 1) {
      continue;
    }

    client.send(JSON.stringify(payload));
  }
}

function createRoomStatePayload(room) {
  return {
    type: "room-snapshot",
    roomId: room.roomId,
    revision: room.revision,
    snapshot: serializeSnapshot(room)
  };
}

function createPresencePayload(room) {
  return {
    type: "presence",
    roomId: room.roomId,
    control: serializeControl(room),
    members: Array.from(room.clients).map((client) => ({
      clientId: client.context.clientId,
      name: client.context.name,
      role: client.context.role
    }))
  };
}

// Synced bridges
function syncRoomPlaybackState(room) {
  if (room.snapshot) {
    room.currentPlayback = {
      state: room.snapshot.paused ? "paused" : "playing",
      time: room.snapshot.currentTime,
      updatedAt: now()
    };
    if (room.snapshot.mediaUrl) {
      room.currentMedia = {
        mediaUrl: room.snapshot.mediaUrl,
        pageUrl: room.currentMedia?.pageUrl || null,
        title: room.currentMedia?.title || null,
        seriesContext: room.currentMedia?.seriesContext || null,
        updatedAt: now()
      };
    }
    room.lastUpdatedAt = now();
  }
}

function syncRoomSnapshotFromUI(room, mediaUrl, paused = true, time = 0) {
  room.snapshot = room.snapshot || {
    mediaUrl: "",
    currentTime: 0,
    paused: true,
    playbackRate: 1,
    volume: 1,
    muted: false
  };

  room.snapshot.mediaUrl = mediaUrl || "";
  room.snapshot.paused = paused;
  room.snapshot.currentTime = time;
  room.revision += 1;
  room.snapshot.revision = room.revision;
  room.snapshot.updatedAt = now();
  room.snapshot.lastAction = "load";
  room.snapshot.lastActionId = crypto.randomUUID();
  room.lastUpdatedAt = now();
}

function broadcastToUiSockets(sockets, payload) {
  const message = JSON.stringify(payload);

  for (const socket of sockets) {
    if (socket.readyState === 1) {
      socket.send(message);
    }
  }
}

function broadcastRoomSnapshot(roomCode) {
  const room = rooms.get(roomCode);
  if (!room) return;

  broadcastToUiSockets(getRoomMembers(roomCode), {
    type: "room:snapshot",
    roomId: roomCode,
    room: buildRoomSnapshot(room)
  });
}

function broadcastRoomsList() {
  const summaries = [...rooms.values()]
    .map((room) => buildRoomSummary(room))
    .sort((left, right) => right.createdAt - left.createdAt);

  broadcastToUiSockets(connectedSockets, {
    type: "rooms:update",
    rooms: summaries
  });
}

// Disk persistence logic
function roomToPersistable(room) {
  return {
    code: room.code,
    title: room.title,
    ownerId: room.ownerId || null,
    createdAt: room.createdAt,
    sessionStartedAt: room.sessionStartedAt,
    chat: room.chat,
    playlist: room.playlist,
    currentMedia: room.currentMedia,
    currentPlayback: room.currentPlayback,
    lastUpdatedAt: room.lastUpdatedAt
  };
}

function schedulePersist() {
  if (persistTimer) return;

  persistTimer = setTimeout(async () => {
    persistTimer = null;

    try {
      const snapshot = {
        rooms: Object.fromEntries(
          [...rooms.entries()].map(([code, room]) => [code, roomToPersistable(room)])
        )
      };

      await mkdir(dataDir, { recursive: true });
      await writeFile(roomStorePath, `${JSON.stringify(snapshot, null, 2)}\n`, "utf8");
    } catch (error) {
      console.error("Failed to persist room store", error);
    }
  }, 150);
}

function normalizePersistedRoom(roomData) {
  const code = normalizeRoomCode(roomData?.code);
  if (!code) return null;

  const room = createRoom(code, roomData?.title, roomData?.ownerId);
  room.createdAt = Number.isFinite(roomData?.createdAt) ? roomData.createdAt : room.createdAt;
  room.sessionStartedAt = Number.isFinite(roomData?.sessionStartedAt) ? roomData.sessionStartedAt : room.createdAt;
  room.chat = Array.isArray(roomData?.chat) ? roomData.chat : [];
  room.playlist = Array.isArray(roomData?.playlist) ? roomData.playlist : [];

  if (roomData?.currentMedia && typeof roomData.currentMedia === "object") {
    room.currentMedia = {
      mediaUrl: String(roomData.currentMedia.mediaUrl || ""),
      pageUrl: roomData.currentMedia.pageUrl || null,
      title: roomData.currentMedia.title || null,
      seriesContext: roomData.currentMedia.seriesContext || null,
      updatedAt: roomData.currentMedia.updatedAt || room.createdAt
    };
  }

  if (roomData?.currentPlayback && typeof roomData.currentPlayback === "object") {
    room.currentPlayback = {
      state: roomData.currentPlayback.state === "playing" ? "playing" : "paused",
      time: Number.isFinite(roomData.currentPlayback.time) ? roomData.currentPlayback.time : 0,
      updatedAt: roomData.currentPlayback.updatedAt || room.createdAt
    };
  }

  room.lastUpdatedAt = Number.isFinite(roomData?.lastUpdatedAt) ? roomData.lastUpdatedAt : room.createdAt;

  // Initialize playback snapshot based on currentMedia and currentPlayback:
  room.snapshot = {
    mediaUrl: room.currentMedia?.mediaUrl || "",
    currentTime: room.currentPlayback?.time || 0,
    paused: room.currentPlayback?.state === "paused",
    playbackRate: 1,
    volume: 1,
    muted: false
  };

  return room;
}

async function loadRoomsFromDisk() {
  try {
    const raw = await readFile(roomStorePath, "utf8");
    const parsed = JSON.parse(raw);
    const storedRooms = parsed?.rooms || {};

    for (const roomData of Object.values(storedRooms)) {
      const room = normalizePersistedRoom(roomData);
      if (room) {
        rooms.set(room.code, room);
      }
    }
  } catch (error) {
    if (error?.code !== "ENOENT") {
      throw error;
    }
  }
}

function createAuthStoreSnapshot() {
  return {
    users: Object.fromEntries(
      [...usersById.entries()].map(([userId, user]) => [
        userId,
        {
          id: user.id,
          displayName: user.displayName,
          displayNameLower: user.displayNameLower,
          email: user.email,
          emailLower: user.emailLower,
          passwordSalt: user.passwordSalt,
          passwordHash: user.passwordHash,
          createdAt: user.createdAt,
          lastLoginAt: user.lastLoginAt,
          roomCodes: [...user.roomCodes]
        }
      ])
    ),
    sessions: Object.fromEntries(
      [...sessionsByToken.entries()].map(([token, session]) => [
        token,
        {
          token: session.token,
          userId: session.userId,
          createdAt: session.createdAt,
          lastSeenAt: session.lastSeenAt
        }
      ])
    )
  };
}

function scheduleAuthPersist() {
  if (authPersistTimer) return;

  authPersistTimer = setTimeout(async () => {
    authPersistTimer = null;

    try {
      await mkdir(dataDir, { recursive: true });
      await writeFile(authStorePath, `${JSON.stringify(createAuthStoreSnapshot(), null, 2)}\n`, "utf8");
    } catch (error) {
      console.error("Failed to persist auth store", error);
    }
  }, 150);
}

async function loadAuthFromDisk() {
  try {
    const raw = await readFile(authStorePath, "utf8");
    const parsed = JSON.parse(raw);

    const storedUsers = parsed?.users || {};
    for (const userData of Object.values(storedUsers)) {
      const userId = String(userData?.id || crypto.randomUUID());
      const roomCodes = Array.isArray(userData?.roomCodes) ? userData.roomCodes.map(normalizeRoomCode).filter(Boolean) : [];

      usersById.set(userId, {
        id: userId,
        displayName: normalizeDisplayName(userData?.displayName || userData?.name),
        displayNameLower: normalizeDisplayName(userData?.displayName || userData?.name).toLowerCase(),
        email: String(userData?.email || ""),
        emailLower: normalizeEmail(userData?.email || userData?.emailLower),
        passwordSalt: String(userData?.passwordSalt || ""),
        passwordHash: String(userData?.passwordHash || ""),
        createdAt: Number.isFinite(userData?.createdAt) ? userData.createdAt : now(),
        lastLoginAt: Number.isFinite(userData?.lastLoginAt) ? userData.lastLoginAt : null,
        roomCodes: new Set(roomCodes)
      });
    }

    const storedSessions = parsed?.sessions || {};
    for (const sessionData of Object.values(storedSessions)) {
      const token = String(sessionData?.token || "").trim();
      const userId = String(sessionData?.userId || "").trim();
      if (!token || !usersById.has(userId)) continue;

      sessionsByToken.set(token, {
        token,
        userId,
        createdAt: Number.isFinite(sessionData?.createdAt) ? sessionData.createdAt : now(),
        lastSeenAt: Number.isFinite(sessionData?.lastSeenAt) ? sessionData.lastSeenAt : now()
      });
    }
  } catch (error) {
    if (error?.code !== "ENOENT") {
      throw error;
    }
  }
}

// User fetch helpers
function getUserById(userId) {
  const normalized = String(userId || "").trim();
  if (!normalized) return null;
  return usersById.get(normalized) || null;
}

function serializeUser(user) {
  if (!user) return null;

  return {
    id: user.id,
    displayName: user.displayName,
    email: user.email,
    createdAt: user.createdAt,
    lastLoginAt: user.lastLoginAt,
    roomCount: user.roomCodes.size
  };
}

function createSession(userId) {
  const user = getUserById(userId);
  if (!user) return null;

  const token = crypto.randomUUID();
  sessionsByToken.set(token, {
    token,
    userId: user.id,
    createdAt: now(),
    lastSeenAt: now()
  });
  scheduleAuthPersist();
  return token;
}

function revokeSession(token) {
  const normalized = String(token || "").trim();
  if (!normalized) return false;
  const removed = sessionsByToken.delete(normalized);
  if (removed) {
    scheduleAuthPersist();
  }
  return removed;
}

function getSessionFromRequest(req) {
  const authHeader = String(req.headers.authorization || "").trim();
  const bearerToken = authHeader.toLowerCase().startsWith("bearer ") ? authHeader.slice(7).trim() : null;
  const token = bearerToken || String(req.headers["x-auth-token"] || "").trim();
  if (!token) return null;

  const session = sessionsByToken.get(token);
  if (!session) return null;

  session.lastSeenAt = now();
  return session;
}

function getUserFromRequest(req) {
  const session = getSessionFromRequest(req);
  if (!session) return null;
  const user = getUserById(session.userId);
  return user || null;
}

function createUserRecord({ displayName, email, password }) {
  const emailLower = normalizeEmail(email);
  const displayNameValue = normalizeDisplayName(displayName);
  if (!emailLower || !displayNameValue || !String(password || "").trim()) return null;

  const existingEmail = [...usersById.values()].some((user) => user.emailLower === emailLower);
  if (existingEmail) {
    throw new Error("Email already registered");
  }

  const existingName = [...usersById.values()].some((user) => user.displayNameLower === displayNameValue.toLowerCase());
  if (existingName) {
    throw new Error("Display name already registered");
  }

  const id = crypto.randomUUID();
  const { passwordSalt, passwordHash } = createPasswordRecord(password);
  const user = {
    id,
    displayName: displayNameValue,
    displayNameLower: displayNameValue.toLowerCase(),
    email: emailLower,
    emailLower,
    passwordSalt,
    passwordHash,
    createdAt: now(),
    lastLoginAt: now(),
    roomCodes: new Set()
  };

  usersById.set(id, user);
  scheduleAuthPersist();
  return user;
}

function authenticateUser(identifier, password) {
  const normalizedIdentifier = normalizeEmail(identifier) || normalizeDisplayName(identifier).toLowerCase();
  if (!normalizedIdentifier) return null;

  const user = [...usersById.values()].find((entry) => entry.emailLower === normalizedIdentifier || entry.displayNameLower === normalizedIdentifier);
  if (!user) return null;

  if (!verifyPassword(password, user.passwordSalt, user.passwordHash)) {
    return null;
  }

  user.lastLoginAt = now();
  scheduleAuthPersist();
  return user;
}

function attachRoomToUser(userId, roomCode) {
  const user = getUserById(userId);
  const normalizedRoomCode = normalizeRoomCode(roomCode);
  if (!user || !normalizedRoomCode) return false;

  const before = user.roomCodes.size;
  user.roomCodes.add(normalizedRoomCode);
  if (user.roomCodes.size !== before) {
    scheduleAuthPersist();
  }

  return true;
}

function detachRoomFromUser(userId, roomCode) {
  const user = getUserById(userId);
  const normalizedRoomCode = normalizeRoomCode(roomCode);
  if (!user || !normalizedRoomCode) return false;

  const removed = user.roomCodes.delete(normalizedRoomCode);
  if (removed) {
    scheduleAuthPersist();
  }

  return removed;
}

function getRoomsForUser(userId) {
  const user = getUserById(userId);
  if (!user) return [];

  const existingCodes = [...user.roomCodes].filter((roomCode) => rooms.has(roomCode));
  if (existingCodes.length !== user.roomCodes.size) {
    user.roomCodes = new Set(existingCodes);
    scheduleAuthPersist();
  }

  return existingCodes
    .map((roomCode) => rooms.get(roomCode))
    .filter(Boolean)
    .map((room) => buildRoomSummary(room))
    .sort((left, right) => right.lastUpdatedAt - left.lastUpdatedAt);
}

function generateRoomCode() {
  let candidate = null;

  do {
    candidate = crypto.randomBytes(3).toString("hex").toUpperCase();
  } while (rooms.has(candidate));

  return candidate;
}

function buildParticipantList(roomCode) {
  const members = [...getRoomMembers(roomCode)];

  return members
    .map((socket) => {
      const state = socketState.get(socket);
      if (!state) return null;

      return {
        socketId: state.socketId,
        clientId: state.clientId,
        nickname: state.nickname,
        role: state.role,
        joinedAt: state.joinedAtByRoom?.[roomCode] || null
      };
    })
    .filter(Boolean);
}

function buildRoomSnapshot(room) {
  return {
    code: room.code,
    title: room.title,
    createdAt: room.createdAt,
    sessionStartedAt: room.sessionStartedAt,
    memberCount: getRoomMembers(room.code).size,
    participants: buildParticipantList(room.code),
    chat: room.chat,
    playlist: room.playlist,
    currentMedia: room.currentMedia,
    currentPlayback: room.currentPlayback,
    lastUpdatedAt: room.lastUpdatedAt
  };
}

function buildRoomSummary(room) {
  return {
    code: room.code,
    title: room.title,
    createdAt: room.createdAt,
    sessionStartedAt: room.sessionStartedAt,
    memberCount: getRoomMembers(room.code).size,
    chatCount: room.chat.length,
    playlistCount: room.playlist.length,
    currentMediaTitle: room.currentMedia?.title || room.currentMedia?.seriesContext?.title || null,
    currentMediaUrl: room.currentMedia?.mediaUrl || null,
    lastUpdatedAt: room.lastUpdatedAt
  };
}

function assignNextHost(roomCode, excludedSocket = null) {
  const members = [...getRoomMembers(roomCode)].filter((socket) => socket !== excludedSocket);
  if (!members.length) return null;

  const nextHost = members[0];
  const state = getSocketState(nextHost);
  state.role = "host";

  if (nextHost.readyState === 1) {
    nextHost.send(
      JSON.stringify({
        type: "room:role",
        roomId: roomCode,
        role: "host"
      })
    );
  }

  return nextHost;
}

function markRoomUpdated(roomCode, persist = true) {
  const room = rooms.get(roomCode);
  if (!room) return;

  room.lastUpdatedAt = now();

  if (persist) {
    schedulePersist();
  }
}

// WS joining/leaving for Connection 2 UI sockets
function joinRoom(roomCode, socket, { nickname, role, clientId }) {
  const normalized = normalizeRoomCode(roomCode);
  if (!normalized) return;

  const room = ensureRoom(normalized);
  const state = getSocketState(socket);

  state.clientId = clientId || state.clientId;
  state.nickname = nickname ? normalizeNickname(nickname) : state.nickname;

  const firstMember = getRoomMembers(normalized).size === 0;
  state.role = role ? normalizeRole(role) : firstMember ? "host" : "guest";

  getRoomMembers(normalized).add(socket);
  state.rooms.add(normalized);
  state.joinedAtByRoom[normalized] = now();

  sendJson(socket, {
    type: "room:snapshot",
    roomId: normalized,
    room: buildRoomSnapshot(room)
  });

  if (state.role === "host") {
    sendJson(socket, {
      type: "room:role",
      roomId: normalized,
      role: "host"
    });
  }

  broadcastRoomSnapshot(normalized);
  broadcastRoomsList();
}

function leaveRoomFromUI(roomCode, socket) {
  const normalized = normalizeRoomCode(roomCode);
  if (!normalized) return;

  const room = rooms.get(normalized);
  const state = getSocketState(socket);

  getRoomMembers(normalized).delete(socket);
  state.rooms.delete(normalized);
  delete state.joinedAtByRoom[normalized];

  if (state.role === "host") {
    state.role = "guest";
    assignNextHost(normalized, socket);
  }

  broadcastRoomSnapshot(normalized);
  broadcastRoomsList();
}

function leaveAllRooms(socket) {
  const state = getSocketState(socket);
  for (const roomCode of state.rooms) {
    leaveRoomFromUI(roomCode, socket);
  }
}

// REST API Request handler
async function readBody(request) {
  return new Promise((resolve) => {
    let body = "";
    request.on("data", (chunk) => {
      body += chunk.toString("utf8");
    });
    request.on("end", () => {
      try {
        resolve(JSON.parse(body));
      } catch {
        resolve({});
      }
    });
  });
}

async function handleApiRequest(request, response, url) {
  const method = request.method;
  const pathPart = url.pathname;

  // POST /api/auth/register
  if (method === "POST" && (pathPart === "/api/auth/register" || pathPart === "/api/auth/signup")) {
    const { displayName, email, password } = await readBody(request);
    try {
      const user = createUserRecord({ displayName, email, password });
      if (!user) {
        sendJson(response, 400, { error: "Failed to create user account" });
        return true;
      }
      const token = createSession(user.id);
      sendJson(response, 200, { token, user: serializeUser(user) });
    } catch (error) {
      sendJson(response, 400, { error: error.message });
    }
    return true;
  }

  // POST /api/auth/login
  if (method === "POST" && pathPart === "/api/auth/login") {
    const { identifier, password } = await readBody(request);
    const user = authenticateUser(identifier, password);
    if (!user) {
      sendJson(response, 401, { error: "Invalid username or password" });
      return true;
    }
    const token = createSession(user.id);
    sendJson(response, 200, { token, user: serializeUser(user) });
    return true;
  }

  // POST /api/auth/logout
  if (method === "POST" && pathPart === "/api/auth/logout") {
    const session = getSessionFromRequest(request);
    if (session) {
      revokeSession(session.token);
    }
    sendJson(response, 200, { ok: true });
    return true;
  }

  // GET /api/auth/me
  if (method === "GET" && pathPart === "/api/auth/me") {
    const user = getUserFromRequest(request);
    if (!user) {
      sendJson(response, 401, { error: "Authentication required" });
      return true;
    }
    sendJson(response, 200, { user: serializeUser(user) });
    return true;
  }

  // GET /api/me/rooms
  if (method === "GET" && pathPart === "/api/me/rooms") {
    const user = getUserFromRequest(request);
    if (!user) {
      sendJson(response, 401, { error: "Authentication required" });
      return true;
    }
    const userRooms = getRoomsForUser(user.id);
    sendJson(response, 200, { rooms: userRooms, user: serializeUser(user) });
    return true;
  }

  // GET /api/rooms
  if (method === "GET" && pathPart === "/api/rooms") {
    const summaries = [...rooms.values()]
      .map((room) => buildRoomSummary(room))
      .sort((left, right) => right.createdAt - left.createdAt);
    sendJson(response, 200, { rooms: summaries });
    return true;
  }

  // POST /api/rooms
  if (method === "POST" && pathPart === "/api/rooms") {
    const user = getUserFromRequest(request);
    const { title } = await readBody(request);

    const roomCode = generateRoomCode();
    const ownerId = user ? user.id : null;
    const room = ensureRoom(roomCode, title, ownerId);

    if (user) {
      attachRoomToUser(user.id, roomCode);
    }

    broadcastRoomsList();
    sendJson(response, 200, { room: buildRoomSummary(room) });
    return true;
  }

  // GET /api/rooms/:roomId
  if (method === "GET" && pathPart.startsWith("/api/rooms/")) {
    const roomCode = normalizeRoomCode(pathPart.split("/").pop());
    const room = rooms.get(roomCode);
    if (!room) {
      sendJson(response, 404, { error: "Room not found" });
      return true;
    }
    sendJson(response, 200, { room: buildRoomSnapshot(room) });
    return true;
  }

  // DELETE /api/rooms/:roomId
  if (method === "DELETE" && pathPart.startsWith("/api/rooms/")) {
    const roomCode = normalizeRoomCode(pathPart.split("/").pop());
    const room = rooms.get(roomCode);
    if (!room) {
      sendJson(response, 404, { error: "Room not found" });
      return true;
    }

    const user = getUserFromRequest(request);
    if (room.ownerId && (!user || room.ownerId !== user.id)) {
      sendJson(response, 403, { error: "Forbidden: You are not the owner of this room" });
      return true;
    }

    rooms.delete(roomCode);
    if (user) {
      detachRoomFromUser(user.id, roomCode);
    }

    // Broadcast to UI sockets that room is deleted
    broadcastToUiSockets(getRoomMembers(roomCode), {
      type: "room:deleted",
      roomId: roomCode
    });

    getRoomMembers(roomCode).forEach((socket) => {
      const state = getSocketState(socket);
      state.rooms.delete(roomCode);
    });
    roomMembers.delete(roomCode);

    broadcastRoomsList();
    schedulePersist();
    sendJson(response, 200, { ok: true });
    return true;
  }

  return false;
}

function getRequestPath(request) {
  const url = new URL(request.url, `http://${request.headers.host || "localhost"}`);
  const pathname = url.pathname === "/" ? "/index.html" : url.pathname;
  return path.normalize(path.join(publicDir, pathname));
}

async function serveStatic(request, response) {
  try {
    const filePath = getRequestPath(request);
    if (!filePath.startsWith(publicDir)) {
      response.writeHead(403);
      response.end("Forbidden");
      return;
    }

    const file = await readFile(filePath);
    const ext = path.extname(filePath).toLowerCase();
    response.writeHead(200, {
      "Content-Type": contentTypes.get(ext) || "application/octet-stream",
      "Cache-Control": "no-store"
    });
    response.end(file);
  } catch {
    response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("Not found");
  }
}

function clampCurrentTime(value) {
  if (!Number.isFinite(value)) {
    return 0;
  }

  return Math.max(0, value);
}

function applyPlayerIntent(room, context, message, nowVal) {
  const action = typeof message.action === "string" ? message.action : "";
  const actionId = typeof message.actionId === "string" && message.actionId ? message.actionId : crypto.randomUUID();

  if (!["load", "play", "pause", "seek", "ratechange", "volumechange"].includes(action)) {
    return {
      accepted: false,
      reason: "unknown-action",
      actionId
    };
  }

  if (
    room.control.clientId &&
    room.control.clientId !== context.clientId &&
    room.control.leaseUntil > nowVal
  ) {
    return {
      accepted: false,
      reason: "control-lease-held",
      actionId
    };
  }

  const current = room.snapshot || { ...defaultPlaybackSnapshot };
  const next = {
    ...current
  };

  if (action === "load") {
    if (typeof message.mediaUrl === "string" && message.mediaUrl.trim()) {
      next.mediaUrl = message.mediaUrl.trim();
    }

    next.currentTime = clampCurrentTime(
      typeof message.currentTime === "number" && Number.isFinite(message.currentTime) ? message.currentTime : 0
    );

    if (typeof message.paused === "boolean") {
      next.paused = message.paused;
    }
  }

  if (typeof message.currentTime === "number" && Number.isFinite(message.currentTime)) {
    next.currentTime = clampCurrentTime(message.currentTime);
  }

  if (typeof message.playbackRate === "number" && Number.isFinite(message.playbackRate)) {
    next.playbackRate = message.playbackRate;
  }

  if (typeof message.volume === "number" && Number.isFinite(message.volume)) {
    next.volume = Math.min(1, Math.max(0, message.volume));
  }

  if (typeof message.muted === "boolean") {
    next.muted = message.muted;
  }

  if (action === "seek" && typeof message.paused === "boolean") {
    next.paused = message.paused;
  }

  if (action === "play") {
    next.paused = false;
  }

  if (action === "pause") {
    next.paused = true;
  }

  room.control = {
    clientId: context.clientId,
    name: context.name,
    role: context.role,
    leaseUntil: nowVal + controlLeaseMs,
    actionId
  };

  room.revision += 1;
  room.snapshot = {
    ...next,
    revision: room.revision,
    updatedAt: nowVal,
    lastAction: action,
    lastActionId: actionId,
    control: serializeControl(room)
  };

  // Sync to UI structure
  syncRoomPlaybackState(room);
  broadcastRoomSnapshot(room.code);
  schedulePersist();

  return {
    accepted: true,
    actionId
  };
}

const server = http.createServer(async (request, response) => {
  const url = new URL(request.url, `http://${request.headers.host || "localhost"}`);
  if (url.pathname.startsWith("/api/")) {
    const handled = await handleApiRequest(request, response, url);
    if (!handled) {
      sendJson(response, 404, { error: "Not found" });
    }
    return;
  }

  void serveStatic(request, response);
});

const wss = new WebSocketServer({ noServer: true });

server.on("upgrade", (request, socket, head) => {
  const url = new URL(request.url, `http://${request.headers.host || "localhost"}`);
  if (url.pathname !== "/ws") {
    socket.destroy();
    return;
  }

  wss.handleUpgrade(request, socket, head, (ws) => {
    wss.emit("connection", ws, request);
  });
});

wss.on("connection", (socket, request) => {
  const url = new URL(request.url, `http://${request.headers.host || "localhost"}`);
  const roomQuery = url.searchParams.get("room");
  const roleQuery = url.searchParams.get("role");

  // Determine if it is a playback sync engine client (Connection 1) or UI client (Connection 2)
  const isSyncEngine = roomQuery != null || roleQuery != null;

  if (isSyncEngine) {
    // ---------------- PLAYBACK SYNC ENGINE PROTOCOL ----------------
    const roomId = roomQuery || "lobby";
    const role = roleQuery || "guest";
    const name = url.searchParams.get("name") || "Guest";
    const clientId = url.searchParams.get("clientId") || crypto.randomUUID();
    const room = getRoom(roomId);

    socket.context = {
      clientId,
      name,
      roomId,
      role
    };

    room.clients.add(socket);

    sendJson(socket, {
      type: "connected",
      roomId,
      clientId,
      revision: room.revision,
      snapshot: serializeSnapshot(room),
      control: serializeControl(room)
    });

    // Notify UI sockets that participant joined
    broadcastRoomSnapshot(room.roomId);

    socket.on("message", (raw) => {
      let message;

      try {
        message = JSON.parse(raw.toString("utf8"));
      } catch {
        return;
      }

      if (message.type === "join") {
        socket.context = {
          ...socket.context,
          name: typeof message.name === "string" ? message.name : socket.context.name,
          role: typeof message.role === "string" ? message.role : socket.context.role
        };

        broadcast(room, createPresencePayload(room));
        broadcastRoomSnapshot(room.roomId);
        return;
      }

      if (message.type === "request-sync") {
        sendJson(socket, createRoomStatePayload(room));
        return;
      }

      if (message.type === "player-intent") {
        const result = applyPlayerIntent(room, socket.context, message, now());

        if (!result.accepted) {
          sendJson(socket, {
            type: "player-intent-rejected",
            roomId,
            actionId: result.actionId,
            reason: result.reason,
            revision: room.revision,
            control: serializeControl(room),
            snapshot: serializeSnapshot(room)
          });

          sendJson(socket, createRoomStatePayload(room));
          return;
        }

        broadcast(
          room,
          createRoomStatePayload(room),
          socket
        );

        sendJson(socket, {
          type: "player-ack",
          roomId,
          actionId: result.actionId,
          revision: room.revision,
          control: serializeControl(room)
        });

        broadcast(room, createPresencePayload(room));
        return;
      }
    });

    socket.on("close", () => {
      room.clients.delete(socket);

      if (room.control.clientId === socket.context.clientId) {
        room.control = {
          clientId: null,
          name: "",
          role: "",
          leaseUntil: 0,
          actionId: null
        };
      }

      broadcastRoomSnapshot(room.roomId);

      if (room.clients.size === 0 && getRoomMembers(roomId).size === 0) {
        // Only delete the room if BOTH connection groups are empty
        rooms.delete(roomId);
        roomMembers.delete(roomId);
        schedulePersist();
        return;
      }

      broadcast(room, createPresencePayload(room));
    });

  } else {
    // ---------------- UI DIRECTORY & CHAT & PLAYLIST PROTOCOL ----------------
    connectedSockets.add(socket);

    socket.on("message", (raw) => {
      let message;
      try {
        message = JSON.parse(raw.toString("utf8"));
      } catch {
        return;
      }

      const state = getSocketState(socket);

      if (message.type === "auth:identify") {
        const token = String(message.token || "").trim();
        if (!token) {
          state.userId = null;
          state.sessionToken = null;
          sendJson(socket, { type: "auth:rejected" });
          return;
        }

        const session = sessionsByToken.get(token);
        if (!session) {
          state.userId = null;
          state.sessionToken = null;
          sendJson(socket, { type: "auth:rejected" });
          return;
        }

        const user = getUserById(session.userId);
        if (!user) {
          state.userId = null;
          state.sessionToken = null;
          sendJson(socket, { type: "auth:rejected" });
          return;
        }

        state.userId = user.id;
        state.sessionToken = token;
        state.nickname = user.displayName;

        sendJson(socket, {
          type: "auth:accepted",
          user: serializeUser(user)
        });
        return;
      }

      if (message.type === "room:join") {
        const roomId = normalizeRoomCode(message.roomId);
        if (!roomId) return;
        joinRoom(roomId, socket, {
          nickname: message.nickname,
          role: message.role,
          clientId: message.clientId
        });
        return;
      }

      if (message.type === "room:leave") {
        const roomId = normalizeRoomCode(message.roomId);
        if (!roomId) return;
        leaveRoomFromUI(roomId, socket);
        return;
      }

      if (message.type === "room:profile") {
        const roomId = normalizeRoomCode(message.roomId);
        if (!roomId) return;

        state.nickname = message.nickname ? normalizeNickname(message.nickname) : state.nickname;
        state.role = message.role ? normalizeRole(message.role) : state.role;
        state.clientId = message.clientId || state.clientId;

        broadcastRoomSnapshot(roomId);
        broadcastRoomsList();
        return;
      }

      if (message.type === "chat:message") {
        const roomId = normalizeRoomCode(message.roomId);
        const room = rooms.get(roomId);
        if (!room) return;

        const chatMessage = {
          id: crypto.randomUUID(),
          sentAt: now(),
          author: {
            nickname: state.nickname,
            role: state.role,
            clientId: state.clientId,
            userId: state.userId
          },
          text: String(message.text || "").trim()
        };

        room.chat.push(chatMessage);
        markRoomUpdated(roomId);

        // Broadcast to Connection 2 sockets
        broadcastToUiSockets(getRoomMembers(roomId), {
          type: "chat:message",
          roomId,
          message: chatMessage
        });
        broadcastRoomSnapshot(roomId);
        return;
      }

      if (message.type === "playlist:add") {
        const roomId = normalizeRoomCode(message.roomId);
        const room = rooms.get(roomId);
        if (!room || !message.item) return;

        const playlistItem = {
          id: crypto.randomUUID(),
          addedAt: now(),
          addedBy: {
            nickname: state.nickname,
            role: state.role,
            clientId: state.clientId
          },
          title: String(message.item.title || "Playlist item"),
          mediaUrl: String(message.item.mediaUrl || ""),
          pageUrl: message.item.pageUrl || null,
          seriesContext: message.item.seriesContext || null
        };

        room.playlist.push(playlistItem);
        markRoomUpdated(roomId);
        broadcastRoomSnapshot(roomId);
        return;
      }

      if (message.type === "playlist:suggest") {
        const roomId = normalizeRoomCode(message.roomId);
        const room = rooms.get(roomId);
        if (!room || !message.item) return;

        const chatMessage = {
          id: crypto.randomUUID(),
          sentAt: now(),
          author: {
            nickname: "System",
            role: "system",
            clientId: "system"
          },
          text: `${state.nickname} suggested watching: "${message.item.title || message.item.mediaUrl}"`
        };

        room.chat.push(chatMessage);
        markRoomUpdated(roomId);

        broadcastToUiSockets(getRoomMembers(roomId), {
          type: "chat:message",
          roomId,
          message: chatMessage
        });
        broadcastRoomSnapshot(roomId);
        return;
      }

      if (message.type === "playlist:activate") {
        const roomId = normalizeRoomCode(message.roomId);
        const room = rooms.get(roomId);
        if (!room) return;

        const item = room.playlist.find((i) => i.id === message.playlistItemId);
        if (!item) return;

        room.currentMedia = {
          mediaUrl: item.mediaUrl,
          pageUrl: item.pageUrl || null,
          title: item.title,
          seriesContext: item.seriesContext || null,
          updatedAt: now()
        };

        room.currentPlayback = {
          state: "paused",
          time: 0,
          updatedAt: now()
        };

        // Sync to sync engine snapshot and broadcast to Connection 1 clients
        syncRoomSnapshotFromUI(room, item.mediaUrl, true, 0);
        broadcast(room, createRoomStatePayload(room));

        markRoomUpdated(roomId);
        broadcastRoomSnapshot(roomId);
        broadcastRoomsList();
        return;
      }

      if (message.type === "media:set") {
        const roomId = normalizeRoomCode(message.roomId);
        const room = rooms.get(roomId);
        if (!room) return;

        room.currentMedia = {
          mediaUrl: String(message.mediaUrl || ""),
          pageUrl: message.pageUrl || null,
          title: message.title || null,
          seriesContext: message.seriesContext || null,
          updatedAt: now()
        };

        room.currentPlayback = {
          state: "paused",
          time: 0,
          updatedAt: now()
        };

        // Sync to sync engine snapshot and broadcast to Connection 1 clients
        syncRoomSnapshotFromUI(room, message.mediaUrl, true, 0);
        broadcast(room, createRoomStatePayload(room));

        markRoomUpdated(roomId);
        broadcastRoomSnapshot(roomId);
        broadcastRoomsList();
        return;
      }
    });

    socket.on("close", () => {
      leaveAllRooms(socket);
      connectedSockets.delete(socket);
      socketState.delete(socket);
      broadcastRoomsList();
    });
  }
});

server.on("error", (error) => {
  if (error.code === "EADDRINUSE") {
    console.error(`Port ${port} is already in use. Stop the process that is bound to it and try again.`);
    process.exitCode = 1;
    return;
  }

  throw error;
});

// Initialization
async function startServer() {
  await loadRoomsFromDisk();
  await loadAuthFromDisk();

  server.listen(port, () => {
    console.log(`AnyTogether is running at http://localhost:${port}`);
  });
}

void startServer();
