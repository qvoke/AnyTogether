import { createServer } from "node:http";
import crypto, { pbkdf2Sync, timingSafeEqual } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { WebSocketServer } from "ws";

const dataDir = new URL("./data/", import.meta.url);
const roomStorePath = new URL("./data/rooms.json", import.meta.url);
const authStorePath = new URL("./data/auth.json", import.meta.url);

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

function createEmptyPlaybackState() {
  return {
    state: "paused",
    time: 0,
    updatedAt: now()
  };
}

function normalizeEmail(value) {
  return String(value || "").trim().toLowerCase();
}

function normalizeDisplayName(value) {
  const displayName = String(value || "").trim().slice(0, 60);
  return displayName || "Guest";
}

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

function createRoomRecord(roomCode, title, ownerId = null) {
  const createdAt = now();
  return {
    code: roomCode,
    title: title || `Room ${roomCode}`,
    ownerId: ownerId ? String(ownerId) : null,
    createdAt,
    sessionStartedAt: createdAt,
    chat: [],
    playlist: [],
    currentMedia: null,
    currentPlayback: createEmptyPlaybackState(),
    lastUpdatedAt: createdAt
  };
}

function normalizePersistedRoom(roomData) {
  const code = normalizeRoomCode(roomData?.code);
  if (!code) return null;

  const createdAt = Number.isFinite(roomData?.createdAt) ? roomData.createdAt : now();
  const sessionStartedAt = Number.isFinite(roomData?.sessionStartedAt)
    ? roomData.sessionStartedAt
    : createdAt;

  return {
    code,
    title: String(roomData?.title || `Room ${code}`),
    ownerId: roomData?.ownerId ? String(roomData.ownerId) : null,
    createdAt,
    sessionStartedAt,
    chat: Array.isArray(roomData?.chat) ? roomData.chat : [],
    playlist: Array.isArray(roomData?.playlist) ? roomData.playlist : [],
    currentMedia: roomData?.currentMedia && typeof roomData.currentMedia === "object" ? roomData.currentMedia : null,
    currentPlayback:
      roomData?.currentPlayback && typeof roomData.currentPlayback === "object"
        ? {
            state: roomData.currentPlayback.state === "playing" ? "playing" : "paused",
            time: Number.isFinite(roomData.currentPlayback.time) ? roomData.currentPlayback.time : 0,
            updatedAt: Number.isFinite(roomData.currentPlayback.updatedAt)
              ? roomData.currentPlayback.updatedAt
              : createdAt
          }
        : createEmptyPlaybackState(),
    lastUpdatedAt: Number.isFinite(roomData?.lastUpdatedAt) ? roomData.lastUpdatedAt : createdAt
  };
}

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

function getRoomMembers(roomCode) {
  if (!roomMembers.has(roomCode)) {
    roomMembers.set(roomCode, new Set());
  }

  return roomMembers.get(roomCode);
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
      rooms: new Set()
    });
  }

  return socketState.get(socket);
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

async function loadRoomsFromDisk() {
  try {
    const raw = await readFile(roomStorePath, "utf8");
    const parsed = JSON.parse(raw);
    const storedRooms = parsed && typeof parsed === "object" && parsed.rooms && typeof parsed.rooms === "object" ? parsed.rooms : {};

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

    const storedUsers = parsed && typeof parsed === "object" && parsed.users && typeof parsed.users === "object" ? parsed.users : {};
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

    const storedSessions = parsed && typeof parsed === "object" && parsed.sessions && typeof parsed.sessions === "object" ? parsed.sessions : {};
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

function ensureRoom(roomCode, title, ownerId = null) {
  const normalizedCode = normalizeRoomCode(roomCode);
  if (!normalizedCode) return null;

  if (!rooms.has(normalizedCode)) {
    rooms.set(normalizedCode, createRoomRecord(normalizedCode, title, ownerId));
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

function broadcastToSockets(sockets, payload) {
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

  broadcastToSockets(getRoomMembers(roomCode), {
    type: "room:snapshot",
    roomId: roomCode,
    room: buildRoomSnapshot(room)
  });
}

function broadcastRoomsList() {
  const summaries = [...rooms.values()]
    .map((room) => buildRoomSummary(room))
    .sort((left, right) => right.createdAt - left.createdAt);

  broadcastToSockets(connectedSockets, {
    type: "rooms:update",
    rooms: summaries
  });
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

  broadcastRoomSnapshot(roomCode);
  broadcastRoomsList();
}

function joinRoom(roomCode, socket, profile = {}) {
  const room = ensureRoom(roomCode);
  if (!room) return null;

  const state = getSocketState(socket);
  state.nickname = normalizeNickname(profile.nickname ?? state.nickname);
  state.role = normalizeRole(profile.role ?? state.role);
  state.clientId = profile.clientId ? String(profile.clientId) : state.clientId;
  state.joinedAtByRoom = state.joinedAtByRoom || {};
  state.joinedAtByRoom[room.code] = state.joinedAtByRoom[room.code] || now();
  state.rooms.add(room.code);

  getRoomMembers(room.code).add(socket);

  if (state.userId) {
    attachRoomToUser(state.userId, room.code);
  }

  room.participantCountHint = getRoomMembers(room.code).size;
  markRoomUpdated(room.code, false);

  socket.send(
    JSON.stringify({
      type: "room:snapshot",
      roomId: room.code,
      room: buildRoomSnapshot(room)
    })
  );

  broadcastRoomsList();
  return room;
}

function leaveRoom(roomCode, socket) {
  const room = rooms.get(roomCode);
  if (!room) return;

  const members = getRoomMembers(roomCode);
  const state = socketState.get(socket);
  const wasHost = state?.role === "host";
  members.delete(socket);

  if (state) {
    state.rooms.delete(roomCode);
    if (state.joinedAtByRoom) {
      delete state.joinedAtByRoom[roomCode];
    }
    if (state.userId) {
      detachRoomFromUser(state.userId, roomCode);
    }
  }

  room.lastUpdatedAt = now();

  if (members.size < 1) {
    roomMembers.delete(roomCode);
    schedulePersist();
    broadcastRoomsList();
    return;
  }

  if (wasHost && members.size > 0) {
    assignNextHost(roomCode, socket);
  }

  broadcastRoomSnapshot(roomCode);
  broadcastRoomsList();
}

function leaveAllRooms(socket) {
  const state = socketState.get(socket);
  if (!state) return;

  for (const roomCode of [...state.rooms]) {
    leaveRoom(roomCode, socket);
  }
}

function deleteRoom(roomCode) {
  const normalizedCode = normalizeRoomCode(roomCode);
  if (!normalizedCode || !rooms.has(normalizedCode)) return false;

  const members = [...getRoomMembers(normalizedCode)];
  for (const socket of members) {
    const state = socketState.get(socket);
    if (state) {
      state.rooms.delete(normalizedCode);
      if (state.joinedAtByRoom) {
        delete state.joinedAtByRoom[normalizedCode];
      }
    }

    if (socket.readyState === 1) {
      socket.send(
        JSON.stringify({
          type: "room:deleted",
          roomId: normalizedCode
        })
      );
    }
  }

  for (const user of usersById.values()) {
    if (user.roomCodes.delete(normalizedCode)) {
      scheduleAuthPersist();
    }
  }

  roomMembers.delete(normalizedCode);
  rooms.delete(normalizedCode);
  schedulePersist();
  broadcastRoomsList();
  return true;
}

function setRoomMedia(roomCode, mediaPayload) {
  const room = rooms.get(roomCode);
  if (!room || !mediaPayload?.mediaUrl) return null;

  room.currentMedia = {
    mediaUrl: mediaPayload.mediaUrl,
    pageUrl: mediaPayload.pageUrl || null,
    title: mediaPayload.title || mediaPayload.seriesContext?.title || null,
    seriesContext: mediaPayload.seriesContext || null,
    updatedAt: now(),
    addedToPlaylistId: mediaPayload.addedToPlaylistId || null
  };

  room.currentPlayback = createEmptyPlaybackState();
  room.lastUpdatedAt = now();
  schedulePersist();
  broadcastRoomSnapshot(roomCode);
  broadcastRoomsList();

  return room;
}

function updatePlaybackState(roomCode, nextPlayback) {
  const room = rooms.get(roomCode);
  if (!room) return null;

  room.currentPlayback = {
    state: nextPlayback.state === "playing" ? "playing" : "paused",
    time: Number.isFinite(nextPlayback.time) ? nextPlayback.time : room.currentPlayback?.time || 0,
    updatedAt: now()
  };
  room.lastUpdatedAt = now();
  schedulePersist();
  broadcastRoomSnapshot(roomCode);
  return room;
}

function addChatMessage(roomCode, message) {
  const room = rooms.get(roomCode);
  if (!room) return null;

  room.chat.push(message);
  room.lastUpdatedAt = now();
  schedulePersist();
  broadcastRoomSnapshot(roomCode);
  broadcastRoomsList();
  return room;
}

function addPlaylistItem(roomCode, item) {
  const room = rooms.get(roomCode);
  if (!room) return null;

  room.playlist.push(item);
  room.lastUpdatedAt = now();
  schedulePersist();
  broadcastRoomSnapshot(roomCode);
  broadcastRoomsList();
  return room;
}

function activatePlaylistItem(roomCode, playlistItemId) {
  const room = rooms.get(roomCode);
  if (!room) return null;

  const item = room.playlist.find((entry) => entry.id === playlistItemId);
  if (!item || !item.mediaUrl) return null;

  room.currentMedia = {
    mediaUrl: item.mediaUrl,
    pageUrl: item.pageUrl || null,
    title: item.title || null,
    seriesContext: item.seriesContext || null,
    updatedAt: now(),
    addedToPlaylistId: item.id
  };
  room.currentPlayback = createEmptyPlaybackState();
  room.lastUpdatedAt = now();
  schedulePersist();

  const payload = {
    type: "media:set",
    roomId: roomCode,
    mediaUrl: item.mediaUrl,
    pageUrl: item.pageUrl || null,
    title: item.title || null,
    seriesContext: item.seriesContext || null,
    originId: null
  };

  broadcastToSockets(getRoomMembers(roomCode), payload);
  broadcastRoomSnapshot(roomCode);
  broadcastRoomsList();

  return room;
}

function buildRoomsApiResponse() {
  return [...rooms.values()]
    .map((room) => buildRoomSummary(room))
    .sort((left, right) => right.createdAt - left.createdAt);
}

function sendJson(res, statusCode, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Cache-Control": "no-store"
  });
  res.end(body);
}

async function readJsonBody(req) {
  const chunks = [];

  for await (const chunk of req) {
    chunks.push(chunk);
  }

  if (chunks.length < 1) return null;

  const raw = Buffer.concat(chunks).toString("utf8");
  if (!raw.trim()) return null;

  return JSON.parse(raw);
}

async function handleApiRequest(req, res, url) {
  if (req.method === "OPTIONS" && url.pathname.startsWith("/api/")) {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Auth-Token",
      "Cache-Control": "no-store"
    });
    res.end();
    return true;
  }

  if (req.method === "POST" && (url.pathname === "/api/auth/register" || url.pathname === "/api/auth/signup")) {
    let body = null;

    try {
      body = await readJsonBody(req);
    } catch {
      sendJson(res, 400, { error: "Invalid JSON body" });
      return true;
    }

    try {
      const displayName = normalizeDisplayName(body?.displayName || body?.name);
      const email = normalizeEmail(body?.email);
      const password = String(body?.password || "");
      if (!displayName || !email || password.trim().length < 8) {
        sendJson(res, 400, { error: "Display name, email, and a password with at least 8 characters are required" });
        return true;
      }

      const user = createUserRecord({ displayName, email, password });
      if (!user) {
        sendJson(res, 400, { error: "Unable to create user" });
        return true;
      }

      const token = createSession(user.id);
      if (!token) {
        sendJson(res, 500, { error: "Unable to create session" });
        return true;
      }

      sendJson(res, 201, { token, user: serializeUser(user) });
    } catch (error) {
      sendJson(res, 409, { error: error.message || "Registration failed" });
    }

    return true;
  }

  if (req.method === "POST" && url.pathname === "/api/auth/login") {
    let body = null;

    try {
      body = await readJsonBody(req);
    } catch {
      sendJson(res, 400, { error: "Invalid JSON body" });
      return true;
    }

    const identifier = String(body?.identifier || body?.email || body?.name || "").trim();
    const password = String(body?.password || "");
    if (!identifier || !password) {
      sendJson(res, 400, { error: "Identifier and password are required" });
      return true;
    }

    const user = authenticateUser(identifier, password);
    if (!user) {
      sendJson(res, 401, { error: "Invalid credentials" });
      return true;
    }

    const token = createSession(user.id);
    if (!token) {
      sendJson(res, 500, { error: "Unable to create session" });
      return true;
    }

    sendJson(res, 200, { token, user: serializeUser(user) });
    return true;
  }

  if (req.method === "POST" && url.pathname === "/api/auth/logout") {
    const session = getSessionFromRequest(req);
    if (session) {
      revokeSession(session.token);
    }

    sendJson(res, 200, { ok: true });
    return true;
  }

  if (req.method === "GET" && url.pathname === "/api/auth/me") {
    const user = getUserFromRequest(req);
    if (!user) {
      sendJson(res, 401, { error: "Not authenticated" });
      return true;
    }

    sendJson(res, 200, { user: serializeUser(user) });
    return true;
  }

  if (req.method === "GET" && url.pathname === "/api/me/rooms") {
    const user = getUserFromRequest(req);
    if (!user) {
      sendJson(res, 401, { error: "Not authenticated" });
      return true;
    }

    sendJson(res, 200, { rooms: getRoomsForUser(user.id), user: serializeUser(user) });
    return true;
  }

  if (req.method === "GET" && url.pathname === "/api/rooms") {
    sendJson(res, 200, { rooms: buildRoomsApiResponse() });
    return true;
  }

  if (req.method === "GET" && url.pathname.startsWith("/api/rooms/")) {
    const roomCode = normalizeRoomCode(url.pathname.slice("/api/rooms/".length));
    const room = roomCode ? rooms.get(roomCode) : null;

    if (!room) {
      sendJson(res, 404, { error: "Room not found" });
      return true;
    }

    sendJson(res, 200, { room: buildRoomSnapshot(room) });
    return true;
  }

  if (req.method === "POST" && url.pathname === "/api/rooms") {
    let body = null;

    try {
      body = await readJsonBody(req);
    } catch {
      sendJson(res, 400, { error: "Invalid JSON body" });
      return true;
    }

    const code = normalizeRoomCode(body?.code) || generateRoomCode();
    const user = getUserFromRequest(req);
    const room = ensureRoom(code, body?.title, user?.id || null);
    if (!room) {
      sendJson(res, 400, { error: "Invalid room code" });
      return true;
    }

    if (user) {
      attachRoomToUser(user.id, room.code);
    }

    schedulePersist();
    broadcastRoomsList();
    sendJson(res, 201, { room: buildRoomSnapshot(room) });
    return true;
  }

  if (req.method === "DELETE" && url.pathname.startsWith("/api/rooms/")) {
    const roomCode = normalizeRoomCode(url.pathname.slice("/api/rooms/".length));
    if (!roomCode) {
      sendJson(res, 400, { error: "Invalid room code" });
      return true;
    }

    if (!deleteRoom(roomCode)) {
      sendJson(res, 404, { error: "Room not found" });
      return true;
    }

    sendJson(res, 200, { ok: true });
    return true;
  }

  return false;
}

await loadRoomsFromDisk();
await loadAuthFromDisk();

const server = createServer(async (req, res) => {
  if (!req.url) {
    res.writeHead(400).end("Bad request");
    return;
  }

  const url = new URL(req.url, "http://localhost");

  if (url.pathname.startsWith("/api/")) {
    const handled = await handleApiRequest(req, res, url);
    if (!handled) {
      sendJson(res, 404, { error: "Not found" });
    }
    return;
  }

  res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
  res.end("Not found");
});

const wss = new WebSocketServer({ server, path: "/ws" });

wss.on("connection", (socket) => {
  connectedSockets.add(socket);
  getSocketState(socket);

  socket.send(
    JSON.stringify({
      type: "rooms:update",
      rooms: buildRoomsApiResponse()
    })
  );

  socket.on("message", async (raw) => {
    let message;

    try {
      message = JSON.parse(raw.toString());
    } catch {
      return;
    }

    if (!message || typeof message !== "object" || !message.type) return;

    if (message.type === "auth:identify") {
      const token = String(message.token || "").trim();
      const session = token ? sessionsByToken.get(token) : null;
      const user = session ? getUserById(session.userId) : null;

      const state = getSocketState(socket);
      state.sessionToken = user ? token : null;
      state.userId = user ? user.id : null;
      if (user) {
        state.nickname = user.displayName;
        state.role = "guest";
        session.lastSeenAt = now();
        socket.send(
          JSON.stringify({
            type: "auth:accepted",
            user: serializeUser(user)
          })
        );
      } else {
        socket.send(
          JSON.stringify({
            type: "auth:rejected"
          })
        );
      }
      return;
    }

    if (message.type === "room:join") {
      const roomCode = normalizeRoomCode(message.roomId);
      if (!roomCode) return;

      const room = rooms.get(roomCode);
      if (!room) {
        socket.send(
          JSON.stringify({
            type: "room:error",
            roomId: roomCode,
            message: "Room not found"
          })
        );
        return;
      }

      joinRoom(roomCode, socket, {
        nickname: message.nickname,
        role: message.role,
        clientId: message.clientId
      });
      return;
    }

    if (message.type === "room:leave") {
      const roomCode = normalizeRoomCode(message.roomId);
      if (!roomCode) return;
      leaveRoom(roomCode, socket);
      return;
    }

    if (!message.roomId) return;

    const roomCode = normalizeRoomCode(message.roomId);
    if (!roomCode || !rooms.has(roomCode)) return;

    if (message.type === "room:profile") {
      const state = getSocketState(socket);
      state.nickname = normalizeNickname(message.nickname ?? state.nickname);
      state.role = normalizeRole(message.role ?? state.role);
      state.clientId = message.clientId ? String(message.clientId) : state.clientId;
      for (const joinedRoomCode of state.rooms) {
        markRoomUpdated(joinedRoomCode, false);
      }
      broadcastRoomsList();
      return;
    }

    if (message.type === "chat:message") {
      const state = getSocketState(socket);
      addChatMessage(roomCode, {
        id: crypto.randomUUID(),
        type: "message",
        text: String(message.text || "").trim().slice(0, 1000),
        author: {
          socketId: state.socketId,
          clientId: state.clientId,
          nickname: normalizeNickname(message.nickname ?? state.nickname),
          role: normalizeRole(message.role ?? state.role)
        },
        sentAt: now()
      });
      return;
    }

    if (message.type === "playlist:add") {
      const state = getSocketState(socket);
      const payloadItem = message.item && typeof message.item === "object" ? message.item : null;
      if (!payloadItem?.mediaUrl) return;

      addPlaylistItem(roomCode, {
        id: crypto.randomUUID(),
        title: String(payloadItem.title || payloadItem.mediaUrl).slice(0, 200),
        mediaUrl: String(payloadItem.mediaUrl),
        pageUrl: payloadItem.pageUrl ? String(payloadItem.pageUrl) : null,
        seriesContext: payloadItem.seriesContext && typeof payloadItem.seriesContext === "object" ? payloadItem.seriesContext : null,
        addedBy: {
          socketId: state.socketId,
          clientId: state.clientId,
          nickname: normalizeNickname(message.nickname ?? state.nickname),
          role: normalizeRole(message.role ?? state.role)
        },
        addedAt: now()
      });
      return;
    }

    if (message.type === "playlist:suggest") {
      const state = getSocketState(socket);
      const payloadItem = message.item && typeof message.item === "object" ? message.item : null;
      const title = String(payloadItem?.title || payloadItem?.mediaUrl || "Suggestion").slice(0, 200);

      addChatMessage(roomCode, {
        id: crypto.randomUUID(),
        type: "system",
        text: `Suggested: ${title}`,
        author: {
          socketId: state.socketId,
          clientId: state.clientId,
          nickname: normalizeNickname(message.nickname ?? state.nickname),
          role: normalizeRole(message.role ?? state.role)
        },
        sentAt: now()
      });
      return;
    }

    if (message.type === "playlist:activate") {
      const room = activatePlaylistItem(roomCode, message.playlistItemId);
      if (!room) return;
      return;
    }

    if (message.type === "media:set") {
      if (!message.mediaUrl) return;

      setRoomMedia(roomCode, {
        mediaUrl: message.mediaUrl,
        pageUrl: message.pageUrl || null,
        title: message.title || null,
        seriesContext: message.seriesContext || null,
        addedToPlaylistId: message.addedToPlaylistId || null
      });
      broadcastToSockets(getRoomMembers(roomCode), {
        ...message,
        roomId: roomCode
      });
      return;
    }

    if (message.type === "player:play") {
      updatePlaybackState(roomCode, {
        state: "playing",
        time: Number.isFinite(message.time) ? message.time : rooms.get(roomCode)?.currentPlayback?.time || 0
      });
      broadcastToSockets(getRoomMembers(roomCode), message);
      return;
    }

    if (message.type === "player:pause") {
      updatePlaybackState(roomCode, {
        state: "paused",
        time: Number.isFinite(message.time) ? message.time : rooms.get(roomCode)?.currentPlayback?.time || 0
      });
      broadcastToSockets(getRoomMembers(roomCode), message);
      return;
    }

    if (message.type === "player:seek") {
      updatePlaybackState(roomCode, {
        state: rooms.get(roomCode)?.currentPlayback?.state || "paused",
        time: Number.isFinite(message.time) ? message.time : 0
      });
      broadcastToSockets(getRoomMembers(roomCode), message);
      return;
    }

    broadcastToSockets(getRoomMembers(roomCode), message);
  });

  socket.on("close", () => {
    leaveAllRooms(socket);
    connectedSockets.delete(socket);
    socketState.delete(socket);
    broadcastRoomsList();
  });
});

const port = Number(process.env.PORT || 3000);
server.on("error", (error) => {
  if (error?.code === "EADDRINUSE") {
    console.log(`Server is already running on http://localhost:${port}`);
    process.exit(0);
  }

  throw error;
});

server.listen(port, () => {
  console.log(`HTTP server is listening on http://localhost:${port}`);
  console.log(`WebSocket relay is listening on ws://localhost:${port}/ws`);
});
