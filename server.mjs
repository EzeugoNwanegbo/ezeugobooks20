import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize, resolve } from "node:path";
import { Readable } from "node:stream";
import app from "./dist/server/server.js";

const port = Number(process.env.PORT || 10000);
const host = process.env.HOST || "0.0.0.0";
const clientDir = resolve("dist/client");

const mimeTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".txt": "text/plain; charset=utf-8",
  ".webp": "image/webp",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

function staticPath(pathname) {
  const decoded = decodeURIComponent(pathname);
  const clean = normalize(decoded).replace(/^(\.\.[/\\])+/, "");
  const filePath = resolve(join(clientDir, clean));
  return filePath.startsWith(clientDir) ? filePath : null;
}

function serveStatic(req, res, url) {
  if (req.method !== "GET" && req.method !== "HEAD") return false;

  const filePath = staticPath(url.pathname);
  if (!filePath || !existsSync(filePath) || !statSync(filePath).isFile()) return false;

  res.statusCode = 200;
  res.setHeader("Content-Type", mimeTypes[extname(filePath)] || "application/octet-stream");
  res.setHeader(
    "Cache-Control",
    url.pathname.startsWith("/assets/")
      ? "public, max-age=31536000, immutable"
      : "public, max-age=300",
  );

  if (req.method === "HEAD") {
    res.end();
    return true;
  }

  createReadStream(filePath).pipe(res);
  return true;
}

function toRequest(req, url) {
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (Array.isArray(value)) {
      for (const item of value) headers.append(key, item);
    } else if (value !== undefined) {
      headers.set(key, value);
    }
  }

  const init = {
    method: req.method,
    headers,
  };

  if (req.method !== "GET" && req.method !== "HEAD") {
    init.body = Readable.toWeb(req);
    init.duplex = "half";
  }

  return new Request(url, init);
}

async function writeResponse(res, response) {
  res.statusCode = response.status;
  res.statusMessage = response.statusText;

  response.headers.forEach((value, key) => {
    res.setHeader(key, value);
  });

  if (!response.body) {
    res.end();
    return;
  }

  Readable.fromWeb(response.body).pipe(res);
}

createServer(async (req, res) => {
  const proto = req.headers["x-forwarded-proto"] || "http";
  const hostHeader = req.headers.host || `${host}:${port}`;
  const url = new URL(req.url || "/", `${proto}://${hostHeader}`);

  try {
    if (serveStatic(req, res, url)) return;
    const request = toRequest(req, url);
    const response = await app.fetch(request);
    await writeResponse(res, response);
  } catch (error) {
    console.error(error);
    res.statusCode = 500;
    res.end("Internal Server Error");
  }
}).listen(port, host, () => {
  console.log(`MedAI Hub listening on http://${host}:${port}`);
});
