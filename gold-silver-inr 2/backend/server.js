import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { join, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { getWorldPrices, getPricesInr } from "./prices.js";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const ROOT = join(__dirname, "..");
const PORT = process.env.PORT || 3456;
const isProd = process.env.NODE_ENV === "production";

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
  ".json": "application/json",
  ".geojson": "application/json",
};

function corsHeaders(origin) {
  const allowed = ["http://localhost:5173", "http://127.0.0.1:5173"];
  if (origin && allowed.includes(origin)) {
    return {
      "Access-Control-Allow-Origin": origin,
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    };
  }
  return {};
}

async function serveStatic(pathname) {
  const distRoot = join(ROOT, "frontend", "dist");
  const filePath = join(distRoot, pathname === "/" ? "index.html" : pathname);
  const ext = extname(filePath);
  const body = await readFile(filePath);
  return { body, type: MIME[ext] || "application/octet-stream" };
}

const server = createServer(async (req, res) => {
  const origin = req.headers.origin;
  const headers = corsHeaders(origin);

  if (req.method === "OPTIONS") {
    res.writeHead(204, headers);
    res.end();
    return;
  }

  try {
    const url = new URL(req.url, `http://localhost:${PORT}`);

    if (url.pathname === "/api/world-prices" && req.method === "GET") {
      const prices = await getWorldPrices();
      res.writeHead(200, {
        ...headers,
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
      });
      res.end(JSON.stringify(prices));
      return;
    }

    if (url.pathname === "/api/prices" && req.method === "GET") {
      const prices = await getPricesInr();
      res.writeHead(200, {
        ...headers,
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
      });
      res.end(JSON.stringify(prices));
      return;
    }

    if (url.pathname === "/api/health" && req.method === "GET") {
      res.writeHead(200, { ...headers, "Content-Type": "application/json" });
      res.end(JSON.stringify({ status: "ok", port: PORT }));
      return;
    }

    if (isProd) {
      const { body, type } = await serveStatic(url.pathname);
      res.writeHead(200, { "Content-Type": type });
      res.end(body);
      return;
    }

    res.writeHead(404, { ...headers, "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Not found. Run the frontend dev server on port 5173." }));
  } catch (err) {
    const isApi = req.url?.startsWith("/api");
    res.writeHead(isApi ? 502 : 404, {
      ...headers,
      "Content-Type": "application/json",
    });
    res.end(JSON.stringify({ error: err.message || "Something went wrong" }));
  }
});

server.listen(PORT, () => {
  console.log(`API server running at http://localhost:${PORT}`);
  if (!isProd) {
    console.log(`  GET /api/world-prices  — all countries`);
    console.log(`  GET /api/prices        — India (legacy)`);
    console.log(`  GET /api/health        — connection check`);
  }
});
