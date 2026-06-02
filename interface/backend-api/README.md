# WatchTogether Backend

Node.js backend for room storage, HTTP API, and WebSocket synchronization.

## Run

```bash
npm install
npm run ws
```

The server listens on `http://localhost:3000` by default.

## Endpoints

- `POST /api/auth/signup`
- `POST /api/auth/register`
- `POST /api/auth/login`
- `POST /api/auth/logout`
- `GET /api/auth/me`
- `GET /api/me/rooms`
- `GET /api/rooms`
- `GET /api/rooms/:code`
- `POST /api/rooms`
- `DELETE /api/rooms/:code`
- `GET /ws` for WebSocket connections

## Data

Room state is stored in `server/data/rooms.json`.
User accounts and sessions are stored in `server/data/auth.json`.
