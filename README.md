# AnyTogether Frontend

AnyTogether Frontend provides synchronized media rooms, playback controls, series navigation, extraction diagnostics, and the companion browser extension.

## Run locally

Start the backend from [qvoke/AnyTogether-back](https://github.com/qvoke/AnyTogether-back):

```bash
npm install
npm run dev
```

Then start this frontend:

```bash
npm install
npm run dev
```

The frontend starts at `http://localhost:3000` and uses `http://localhost:3001` as its local backend.

Set a different backend with the `api` query parameter:

```text
http://localhost:3000/?api=https://api.example.com
```

The selected backend is stored in the browser for subsequent sessions. Deployments can also define `window.WATCH_TOGETHER_API_BASE_URL` before the application scripts load.

## Browser extension

Load the `extension` directory as an unpacked extension in a Chromium-based browser. The extension extracts supported media and series data, then sends it to the room interface.

## Validation

```bash
npm run validate:configs
```

Seek test automation is available through the `seek-test` and `seek-test:watch` scripts.
