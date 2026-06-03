# AnyTogether

AnyTogether is a synchronized media room interface with:

- Intent-based WebSocket playback sync for `load`, `play`, `pause`, and `seek`
- A short hidden control lease so only one client drives the room at a time
- Video.js playback for MP4/HLS streams with an in-player HLS quality selector
- A plugin bridge that delivers metasearch results into the page

## Run locally

```bash
npm install
npm run dev
```

The server always starts at `http://localhost:3000`.

## Playback sync

Clients send explicit intents, and the server turns them into room snapshots:

```json
{
  "type": "player-intent",
  "action": "seek",
  "actionId": "2d42e7c1-4f3c-4f91-b6a7-1d0b9b2d7a26",
  "roomId": "lobby",
  "clientId": "host-1",
  "currentTime": 42.5,
  "paused": true
}
```

```json
{
  "type": "player-intent",
  "action": "load",
  "actionId": "9df2c8e6-76c8-4f50-8d0b-9f7cb12c48bc",
  "roomId": "lobby",
  "clientId": "host-1",
  "mediaUrl": "https://example.com/stream.m3u8",
  "currentTime": 0,
  "paused": false
}
```

The room snapshot includes the current media state plus controller metadata so clients can log
lease changes and apply the latest room state safely.

A `seek` intent can carry `paused` when a rapid seek and pause should be committed as one
atomic room update.

## Site and extension bridge

The page sends a search request with `window.postMessage`:

```js
window.postMessage(
  {
    source: "anytogether-web",
    type: "anytogether-plugin:search-request",
    requestId: crypto.randomUUID(),
    room: "lobby",
    role: "host",
    query: "vimeo space station"
  },
  "*"
);
```

A companion extension can reply back to the page with:

```js
window.postMessage(
  {
    source: "anytogether-plugin",
    type: "anytogether-plugin:search-result",
    requestId,
    title: "Sample stream",
    originUrl: "https://example.com/page",
    mediaUrl: "https://example.com/stream.m3u8"
  },
  "*"
);
```

## Network request matcher example

Use a simple pattern when inspecting request URLs for direct stream manifests:

```js
const streamPattern = /\.(?:m3u8|mp4)(?:\?|$)/i;
```

The interface also includes playback diagnostics in the room log, while Video.js exposes HLS quality switching directly inside the player controls.
