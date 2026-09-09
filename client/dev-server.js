#!/usr/bin/env node
/**
 * Development server. Stands in for the nginx block in ops/nginx/kotoba.conf.
 *
 *   node client/dev-server.js --api http://127.0.0.1:8080 --port 5173
 *
 * It matters that this mirrors nginx rather than serving the client from the
 * root: everything lives under /kotoba/ so the service worker scope, the
 * manifest scope and the session cookie path line up (§2). Serve the client
 * anywhere else and the cookie silently stops being sent.
 */
import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer, request as httpRequest } from "node:http";
import { extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("./", import.meta.url)));

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    if (!argv[i].startsWith("--")) continue;
    out[argv[i].slice(2)] = argv[i + 1]?.startsWith("--") ? true : argv[++i];
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));
const port = Number(args.port ?? 5173);
const prefix = args.prefix ?? "/kotoba";
const apiTarget = new URL(args.api ?? "http://127.0.0.1:8080");
const mediaRoot = resolve(args.media ?? join(root, "..", "media"));

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".mp3": "audio/mpeg",
};

const server = createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  if (!url.pathname.startsWith(prefix)) {
    res.writeHead(302, { location: `${prefix}/` });
    res.end();
    return;
  }

  const path = url.pathname.slice(prefix.length) || "/";

  // /kotoba/api/ → the Fastify container, prefix stripped, exactly as the
  // nginx `proxy_pass` with a trailing slash does.
  if (path.startsWith("/api/")) {
    const proxied = httpRequest(
      {
        hostname: apiTarget.hostname,
        port: apiTarget.port,
        path: path + url.search,
        method: req.method,
        headers: { ...req.headers, host: apiTarget.host },
      },
      (upstream) => {
        res.writeHead(upstream.statusCode ?? 502, upstream.headers);
        upstream.pipe(res);
      },
    );
    proxied.on("error", (err) => {
      res.writeHead(502, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "api_unreachable", detail: err.message }));
    });
    req.pipe(proxied);
    return;
  }

  // /kotoba/media/ → the audio directory, as nginx serves it (§9).
  if (path.startsWith("/media/")) {
    const name = decodeURIComponent(path.slice("/media/".length));
    const file = join(mediaRoot, normalize(name).replace(/^(\.\.[/\\])+/, ""));
    if (!existsSync(file)) {
      res.writeHead(404, { "content-type": "text/plain" });
      res.end("not found");
      return;
    }
    res.writeHead(200, { "content-type": "audio/mpeg", "cache-control": "public, max-age=31536000" });
    createReadStream(file).pipe(res);
    return;
  }

  // Static, with a deep link falling back to the shell — `try_files`.
  const rel = normalize(path).replace(/^(\.\.[/\\])+/, "");
  let file = join(root, rel);
  if (!existsSync(file) || statSync(file).isDirectory()) file = join(root, "index.html");

  res.writeHead(200, {
    "content-type": TYPES[extname(file)] ?? "application/octet-stream",
    "cache-control": "no-cache",
  });
  createReadStream(file).pipe(res);
});

server.listen(port, "127.0.0.1", () => {
  process.stdout.write(
    `client  http://127.0.0.1:${port}${prefix}/\n` +
      `api     ${apiTarget.origin} (proxied at ${prefix}/api/)\n`,
  );
});
