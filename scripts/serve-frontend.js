import http from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
const publicDirectory = path.resolve(currentDirectory, "..", "public");
const port = Number.parseInt(process.env.FRONTEND_PORT || "3000", 10);
const contentTypes = new Map([
  [".css", "text/css; charset=utf-8"],
  [".html", "text/html; charset=utf-8"],
  [".ico", "image/x-icon"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".svg", "image/svg+xml"]
]);

function resolvePublicPath(pathname) {
  const requestedPath = pathname === "/" ? "index.html" : decodeURIComponent(pathname).replace(/^\/+/, "");
  const resolvedPath = path.resolve(publicDirectory, requestedPath);
  const relativePath = path.relative(publicDirectory, resolvedPath);
  return relativePath.startsWith("..") || path.isAbsolute(relativePath) ? null : resolvedPath;
}

async function sendFile(response, filePath) {
  const body = await readFile(filePath);
  response.writeHead(200, {
    "Cache-Control": "no-store",
    "Content-Type": contentTypes.get(path.extname(filePath).toLowerCase()) || "application/octet-stream"
  });
  response.end(body);
}

const server = http.createServer(async (request, response) => {
  const url = new URL(request.url, `http://${request.headers.host || "localhost"}`);
  const filePath = resolvePublicPath(url.pathname);
  if (!filePath) {
    response.writeHead(403, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("Forbidden");
    return;
  }

  try {
    await sendFile(response, filePath);
  } catch {
    try {
      await sendFile(response, path.join(publicDirectory, "index.html"));
    } catch {
      response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      response.end("Not found");
    }
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

server.listen(port, () => {
  console.log(`AnyTogether frontend is running at http://localhost:${port}`);
});
