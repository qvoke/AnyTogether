import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectDirectory = path.resolve(scriptDirectory, "..");
const commandPath = path.join(projectDirectory, "data", "seek-test.command.json");
const runnerPath = path.join(scriptDirectory, "run-seek-test.js");
let runnerActive = false;

async function readCommand() {
  try {
    return JSON.parse(await readFile(commandPath, "utf8"));
  } catch {
    return null;
  }
}

async function disableCommand(command) {
  if (!command) return;
  await writeFile(commandPath, JSON.stringify({ ...command, run: false }, null, 2), "utf8");
}

function startRunner(command) {
  runnerActive = true;
  const child = spawn(process.execPath, [runnerPath], {
    cwd: projectDirectory,
    stdio: "inherit",
    windowsHide: false,
    env: process.env
  });

  child.once("error", async (error) => {
    console.error(`[Seek Test Watcher] Failed to start runner: ${error.message}`);
    await disableCommand(command);
    runnerActive = false;
  });
  child.once("close", async (code) => {
    if (code !== 0) {
      await disableCommand(command);
      console.error(`[Seek Test Watcher] Runner exited with code ${code}.`);
    }
    runnerActive = false;
  });
}

console.log("[Seek Test Watcher] Waiting for run=true in data/seek-test.command.json");
setInterval(async () => {
  if (runnerActive) return;
  const command = await readCommand();
  if (command?.run === true) startRunner(command);
}, 1000);
