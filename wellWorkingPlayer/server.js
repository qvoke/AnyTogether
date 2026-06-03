import http from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocketServer } from "ws";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const publicDir = path.join(__dirname, "public");
const port = 3000;
const controlLeaseMs = 1200;

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

const rooms = new Map();

function createRoom(roomId) {
  return {
    roomId,
    revision: 0,
    snapshot: null,
    clients: new Set(),
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
  if (!rooms.has(roomId)) {
    rooms.set(roomId, createRoom(roomId));
  }

  return rooms.get(roomId);
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

function sendJson(socket, payload) {
  if (socket.readyState === 1) {
    socket.send(JSON.stringify(payload));
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

function applyPlayerIntent(room, context, message, now) {
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
    room.control.leaseUntil > now
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
    leaseUntil: now + controlLeaseMs,
    actionId
  };

  room.revision += 1;
  room.snapshot = {
    ...next,
    revision: room.revision,
    updatedAt: now,
    lastAction: action,
    lastActionId: actionId,
    control: serializeControl(room)
  };

  return {
    accepted: true,
    actionId
  };
}

const server = http.createServer((request, response) => {
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
  const roomId = url.searchParams.get("room") || "lobby";
  const role = url.searchParams.get("role") || "guest";
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

      return;
    }

    if (message.type === "request-sync") {
      sendJson(socket, createRoomStatePayload(room));
      return;
    }

    if (message.type === "player-intent") {
      const result = applyPlayerIntent(room, socket.context, message, Date.now());

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

    if (room.clients.size === 0) {
      rooms.delete(roomId);
      return;
    }

    broadcast(room, createPresencePayload(room));
  });
});

server.on("error", (error) => {
  if (error.code === "EADDRINUSE") {
    console.error(`Port ${port} is already in use. Stop the process that is bound to it and try again.`);
    process.exitCode = 1;
    return;
  }

  throw error;
});

server.listen(port, () => {
  console.log(`AnyTogether is running at http://localhost:${port}`);
});
