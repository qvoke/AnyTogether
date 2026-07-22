import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectDirectory = path.resolve(scriptDirectory, "..");
const commandPath = path.join(projectDirectory, "data", "seek-test.command.json");
const resultsDirectory = path.join(projectDirectory, "data", "seek-tests");
const defaultCdpPort = 9222;

function createRoomCode() {
  return Math.random().toString(36).slice(2, 8).toUpperCase();
}

function resolveScenarioUrl(command) {
  if (command.scenario !== "new-room-first-media") return command.url;
  const url = new URL(command.url);
  const room = url.searchParams.get("room");
  if (room === "AUTO" || room === "NEW") url.searchParams.set("room", createRoomCode());
  return url.toString();
}

function resolveParticipantUrl(url, participantIndex) {
  const participantUrl = new URL(url);
  participantUrl.searchParams.set("name", String(participantIndex + 1));
  participantUrl.searchParams.set("clientId", randomUUID());
  return participantUrl.toString();
}

async function loadCommand() {
  let command;
  try {
    command = JSON.parse(await readFile(commandPath, "utf8"));
  } catch (error) {
    throw new Error(`Cannot read ${commandPath}: ${error.message}`);
  }

  if (command.run !== true) {
    throw new Error(`Set run=true in ${commandPath} before starting the test.`);
  }

  if (typeof command.url !== "string" || !command.url.trim()) {
    throw new Error(`A test URL is required in ${commandPath}.`);
  }

  const configuredAhkPath = typeof command.ahkPath === "string" ? command.ahkPath.trim() : "AutoHotkey.exe";
  const ahkCandidates = [
    "C:\\Program Files\\AutoHotkey\\v2\\AutoHotkey64.exe",
    "C:\\Program Files\\AutoHotkey\\v2\\AutoHotkey.exe",
    "C:\\Program Files\\AutoHotkey\\AutoHotkey64.exe",
    "C:\\Program Files\\AutoHotkey\\AutoHotkey.exe",
    configuredAhkPath
  ];
  const ahkPath = ahkCandidates.find((candidate) => (
    candidate.includes("\\") ? existsSync(candidate) : true
  )) || configuredAhkPath;

  return {
    ...command,
    url: command.url.trim(),
    scenario: typeof command.scenario === "string" ? command.scenario : "existing-media",
    switchAfterFirstMedia: command.switchAfterFirstMedia || null,
    iterations: Math.min(100, Math.max(1, Number(command.iterations) || 10)),
    cdpPort: Number(command.cdpPort) || defaultCdpPort,
    navigate: command.navigate !== false,
    ahkEnabled: command.ahkEnabled !== false,
    separateWindows: command.separateWindows !== false,
    ahkPath
  };
}

async function getTargets(port) {
  const response = await fetch(`http://127.0.0.1:${port}/json/list`);
  if (!response.ok) {
    throw new Error(`Chrome CDP returned HTTP ${response.status}.`);
  }
  return response.json();
}

async function waitForServer(port, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/`);
      if (response.ok) return;
    } catch {
      // The development server may need a few seconds to restart.
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`AnyTogether did not become available on port ${port}.`);
}

function createCdpClient(target) {
  const socket = new WebSocket(target.webSocketDebuggerUrl);
  let nextCommandId = 0;
  const pending = new Map();
  const consoleMessages = [];

  const opened = new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve, { once: true });
    socket.addEventListener("error", () => reject(new Error(`Failed to connect to CDP target ${target.id}.`)), { once: true });
  });

  socket.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    if (message.method === "Runtime.consoleAPICalled") {
      consoleMessages.push({
        timestamp: new Date().toISOString(),
        type: message.params.type,
        args: message.params.args?.map((argument) => argument.value ?? argument.description ?? "") || []
      });
    }

    const request = pending.get(message.id);
    if (!request) return;
    pending.delete(message.id);
    if (message.error) {
      request.reject(new Error(message.error.message || "CDP command failed."));
      return;
    }
    request.resolve(message.result || {});
  });

  return {
    target,
    consoleMessages,
    async connect() {
      await opened;
      await this.command("Runtime.enable");
    },
    command(method, params = {}) {
      return new Promise((resolve, reject) => {
        const id = ++nextCommandId;
        pending.set(id, { resolve, reject });
        socket.send(JSON.stringify({ id, method, params }));
      });
    },
    close() {
      socket.close();
    }
  };
}

async function evaluate(client, expression, awaitPromise = false) {
  const result = await client.command("Runtime.evaluate", {
    expression,
    awaitPromise,
    returnByValue: true,
    userGesture: true
  });
  if (result.exceptionDetails) {
    const exception = result.exceptionDetails.exception;
    const details = exception?.description || exception?.value || result.exceptionDetails.text || "Page evaluation failed.";
    throw new Error(String(details));
  }
  const remoteValue = result.result;
  if (remoteValue?.subtype === "error") {
    throw new Error(remoteValue.description || "Page evaluation returned an error.");
  }
  return remoteValue?.value;
}

async function waitForPageReady(client, timeoutMs = 60000) {
  const deadline = Date.now() + timeoutMs;
  let nextDiagnosticAt = 0;
  let lastError = "";
  while (Date.now() < deadline) {
    let state;
    try {
      state = await evaluate(client, `({
        readyState: document.readyState,
        hasSeekTest: typeof window.__startSeekStressTest === "function",
        videoCount: document.querySelectorAll("video").length,
        duration: Number(document.querySelector("video")?.duration) || 0,
        url: location.href
      })`);
      lastError = "";
    } catch (error) {
      state = null;
      lastError = error.message;
    }
    if (state?.readyState === "complete" && state.hasSeekTest && state.duration > 0) return;
    if (Date.now() >= nextDiagnosticAt) {
      console.log(`[Seek Test Runner] Waiting for tab ${client.target.id}: ${state ? `readyState=${state.readyState}, hasSeekTest=${state.hasSeekTest}, videoCount=${state.videoCount}, duration=${state.duration}, url=${state.url}` : `page context is not ready (${lastError})`}`);
      nextDiagnosticAt = Date.now() + 5000;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`Timed out waiting for ${client.target.url} to load the seek test.`);
}

async function waitForAppReady(client, timeoutMs = 60000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const ready = await evaluate(client, `Boolean(
      document.readyState === "complete" &&
      typeof window.__startSeekStressTest === "function"
    )`);
    if (ready) return;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`Timed out waiting for ${client.target.url} to initialize.`);
}

async function getMediaSource(client) {
  return evaluate(client, "document.querySelector('video')?.currentSrc || document.querySelector('video')?.src || ''");
}

async function waitForStableMedia(clients, expectedSources = null, stableMs = 2500, timeoutMs = 120000) {
  const deadline = Date.now() + timeoutMs;
  let stableSince = null;
  let lastSources = null;
  while (Date.now() < deadline) {
    const states = await Promise.all(clients.map((client) => evaluate(client, `(() => {
      const video = document.querySelector('video');
      return {
        source: video?.currentSrc || video?.src || '',
        duration: Number(video?.duration) || 0,
        readyState: video?.readyState || 0,
        paused: video?.paused !== false
      };
    })()`)));
    const sources = states.map((state) => state.source);
    const valid = states.every((state, index) =>
      state.source &&
      state.duration > 0 &&
      state.readyState >= 3 &&
      (!expectedSources || state.source === expectedSources[index])
    );
    const unchanged = JSON.stringify(sources) === JSON.stringify(lastSources);
    if (valid && unchanged) {
      stableSince ??= Date.now();
      if (Date.now() - stableSince >= stableMs) {
        await Promise.all(clients.map((client) => evaluate(client, "document.querySelector('video')?.play().catch(() => false); true")));
        return sources;
      }
    } else {
      stableSince = null;
    }
    lastSources = sources;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("Timed out waiting for media source stability in both tabs.");
}

async function waitForMediaChange(clients, previousSources, timeoutMs = 120000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const sources = await Promise.all(clients.map(getMediaSource));
    const states = sources.map((source, index) => ({
      source,
      changed: Boolean(previousSources[index]) && source !== previousSources[index]
    }));
    if (states.every((state) => state.changed)) {
      await Promise.all(clients.map((client) => waitForPageReady(client)));
      return waitForStableMedia(clients, states.map((state) => state.source));
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error("Timed out waiting for the selected episode to load in both tabs.");
}

async function clickEpisode(client, selection) {
  const seasonId = String(selection?.seasonId ?? "");
  const episodeId = String(selection?.episodeId ?? "");
  if (seasonId) {
    const seasonChanged = await evaluate(client, `(() => {
      const button = document.querySelector('#seasonButtons button[data-value="${seasonId}"]');
      if (!button || button.classList.contains('is-selected')) return false;
      button.click();
      return true;
    })()`);
    if (seasonChanged) await new Promise((resolve) => setTimeout(resolve, 300));
  }
  const clicked = await evaluate(client, `(() => {
    const button = document.querySelector(
      '[data-season-id="${seasonId}"][data-episode-id="${episodeId}"]'
    );
    if (!button) return false;
    button.click();
    return true;
  })()`);
  if (!clicked) {
    throw new Error(`Episode button was not found for season ${seasonId}, episode ${episodeId}.`);
  }
}

async function navigate(client, url) {
  await client.command("Page.navigate", { url });
}

async function bringToFront(client) {
  await client.command("Page.bringToFront");
}

async function arrangeParticipantWindows(clients) {
  const bounds = [
    { left: 0, top: 0, width: 960, height: 900 },
    { left: 960, top: 0, width: 960, height: 900 }
  ];
  await Promise.all(clients.map(async (client, index) => {
    try {
      const windowInfo = await client.command("Browser.getWindowForTarget", {
        targetId: client.target.id
      });
      await client.command("Browser.setWindowBounds", {
        windowId: windowInfo.windowId,
        bounds: { ...bounds[index], windowState: "normal" }
      });
    } catch (error) {
      console.warn(`[Seek Test Runner] Could not arrange participant window ${index + 1}: ${error.message}`);
    }
  }));
}

async function pauseMedia(client) {
  await evaluate(client, "document.querySelector('video')?.pause(); true");
}

async function clickSeekTestStart(client, iterations) {
  await evaluate(client, `(() => {
    const input = document.querySelector('[data-seek-test-iterations]');
    if (input) input.value = ${JSON.stringify(iterations)};
    return Boolean(input);
  })()`);
  const bounds = await evaluate(client, `(() => {
    const button = document.querySelector('[data-seek-test-start]');
    if (!button) return null;
    const rect = button.getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  })()`);
  if (!bounds) throw new Error("Seek test start button was not found.");
  await client.command("Input.dispatchMouseEvent", {
    type: "mousePressed",
    x: bounds.x,
    y: bounds.y,
    button: "left",
    clickCount: 1
  });
  await client.command("Input.dispatchMouseEvent", {
    type: "mouseReleased",
    x: bounds.x,
    y: bounds.y,
    button: "left",
    clickCount: 1
  });
}

async function waitForSeekTestReport(clients, iterations, timeoutMs = 180000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    for (const client of clients) {
      const report = await evaluate(client, "window.__seekStressReport || null");
      if (report && report.requestedIterations === iterations) return report;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error("Timed out waiting for the browser seek test report.");
}

function runNotifier(command, runId, resultPath) {
  const notifierPath = path.join(scriptDirectory, "notify-chat.ahk");
  const child = spawn(command.ahkPath, [notifierPath, runId, resultPath], {
    detached: true,
    stdio: "ignore",
    windowsHide: true
  });
  child.unref();
}

function runChromeActivator(command) {
  const activatorPath = path.join(scriptDirectory, "activate-chrome.ahk");
  return new Promise((resolve) => {
    const child = spawn(command.ahkPath, [activatorPath], {
      stdio: "ignore",
      windowsHide: true
    });
    child.once("error", (error) => {
      console.warn(`[Seek Test Runner] Chrome activation skipped: ${error.message}`);
      resolve();
    });
    child.once("close", () => resolve());
  });
}

function runDevelopmentPreparation(command) {
  const preparationPath = path.join(scriptDirectory, "prepare-development.ahk");
  return new Promise((resolve, reject) => {
    const child = spawn(command.ahkPath, [preparationPath], {
      stdio: "ignore",
      windowsHide: true
    });
    child.once("error", reject);
    child.once("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`Development preparation exited with code ${code}.`));
    });
  });
}

function runFirstMediaPreparation(command) {
  const preparationPath = path.join(scriptDirectory, "prepare-first-media.ahk");
  return new Promise((resolve, reject) => {
    const child = spawn(command.ahkPath, [preparationPath], {
      stdio: "ignore",
      windowsHide: true
    });
    child.once("error", reject);
    child.once("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`First-media preparation exited with code ${code}.`));
    });
  });
}

async function main() {
  const command = await loadCommand();
  const runId = command.runId || new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14);
  const startedAt = new Date().toISOString();
  const scenarioUrl = resolveScenarioUrl(command);
  console.log(`[Seek Test Runner] Starting run ${runId}.`);
  if (command.prepareDevelopment && command.ahkEnabled) {
    console.log("[Seek Test Runner] Preparing the development server.");
    await runDevelopmentPreparation(command);
    console.log("[Seek Test Runner] Development preparation finished.");
  } else if (command.activateChrome !== false && command.ahkEnabled) {
    console.log("[Seek Test Runner] Activating Chrome.");
    await runChromeActivator(command);
    console.log("[Seek Test Runner] Chrome activation finished.");
  }
  console.log("[Seek Test Runner] Waiting for the development server.");
  await waitForServer(3000);
  console.log(`[Seek Test Runner] Development server is available on port 3000.`);
  const targets = (await getTargets(command.cdpPort))
    .filter((target) => target.type === "page" && target.webSocketDebuggerUrl && target.url.startsWith("http://localhost:3000"))
    .slice(0, 2);

  console.log(`[Seek Test Runner] Found ${targets.length} matching Chrome tab(s) through CDP.`);

  if (targets.length < 2) {
    throw new Error("Open two AnyTogether room tabs in Chrome before starting the runner.");
  }

  const clients = targets.map(createCdpClient);
  try {
    console.log("[Seek Test Runner] Connecting to Chrome tabs.");
    await Promise.all(clients.map((client) => client.connect()));
    console.log("[Seek Test Runner] Connected to Chrome tabs.");
    if (command.separateWindows) await arrangeParticipantWindows(clients);
    if (command.navigate) {
      await Promise.all(clients.map((client, index) => navigate(
        client,
        command.separateWindows ? resolveParticipantUrl(scenarioUrl, index) : scenarioUrl
      )));
      console.log("[Seek Test Runner] Navigation requested in both tabs.");
    } else {
      console.log("[Seek Test Runner] Keeping the existing tab state.");
    }
    for (const client of clients) {
      await bringToFront(client);
      await (command.scenario === "new-room-first-media"
        ? waitForAppReady(client)
        : waitForPageReady(client));
    }
    if (command.scenario === "new-room-first-media") {
      console.log("[Seek Test Runner] Preparing the first media popup flow.");
      await runFirstMediaPreparation(command);
      await Promise.all(clients.map((client) => waitForPageReady(client)));
      await waitForStableMedia(clients);
      console.log("[Seek Test Runner] First media is ready in both tabs.");
    }
    if (command.switchAfterFirstMedia) {
      const previousSources = await Promise.all(clients.map(getMediaSource));
      await bringToFront(clients[0]);
      await clickEpisode(clients[0], command.switchAfterFirstMedia);
      await waitForMediaChange(clients, previousSources);
      console.log("[Seek Test Runner] Selected episode is ready in both tabs.");
    }
    await bringToFront(clients[0]);
    console.log("[Seek Test Runner] Both tabs are ready for the seek test.");

    await clickSeekTestStart(clients[0], command.iterations);
    const report = await waitForSeekTestReport(clients, command.iterations);
    console.log("[Seek Test Runner] Seek test finished in the browser.");
    await Promise.all(clients.map((client) => pauseMedia(client)));
    console.log("[Seek Test Runner] Media paused in both tabs.");
    const completedAt = new Date().toISOString();
    const result = {
      schemaVersion: 1,
      runId,
      url: scenarioUrl,
      startedAt,
      completedAt,
      initiator: report,
      browserTargets: clients.map((client) => ({
        id: client.target.id,
        url: client.target.url,
        console: client.consoleMessages
      }))
    };

    const runDirectory = path.join(resultsDirectory, runId);
    await mkdir(runDirectory, { recursive: true });
    const resultPath = path.join(runDirectory, "result.json");
    await writeFile(resultPath, JSON.stringify(result, null, 2), "utf8");
    const { runId: configuredRunId, ...commandWithoutRunId } = command;
    void configuredRunId;
    await writeFile(commandPath, JSON.stringify({ ...commandWithoutRunId, run: false }, null, 2), "utf8");
    console.log(`Seek test completed: ${runId}`);
    console.log(`Results: ${resultPath}`);

    if (command.ahkEnabled) {
      runNotifier(command, runId, resultPath);
    }
  } finally {
    clients.forEach((client) => client.close());
  }
}

main().catch((error) => {
  console.error(`[Seek Test Runner] ${error.message}`);
  process.exitCode = 1;
});
