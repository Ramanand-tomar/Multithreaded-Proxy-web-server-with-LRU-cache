const fs = require("fs");
const path = require("path");
const cacheManager = require("../cacheManager");
const { normalizePath } = require("../httpUtils");

const PUBLIC_DIR = path.join(__dirname, "..", "public");

const MIME_TYPES = {
  ".html": "text/html",
  ".css": "text/css",
  ".js": "application/javascript",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".json": "application/json",
  ".webp": "image/webp"
};

async function handleDashboardRoutes(req, res) {
  const method = req.method;
  const cleanPath = normalizePath(req.url);

  // Set default CORS for local dashboard usage
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS, HEAD");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return true;
  }

  // Dashboard HTML
  if ((cleanPath === "/" || cleanPath === "/index.html" || cleanPath === "/dashboard") && (method === "GET" || method === "HEAD")) {
    const filePath = path.join(PUBLIC_DIR, "index.html");
    fs.readFile(filePath, (err, data) => {
      if (err) {
        res.writeHead(200, { "Content-Type": "text/html" });
        if (method === "HEAD") {
          res.end();
          return;
        }
        res.end(`
          <!DOCTYPE html>
          <html>
            <head><title>Proxy Dashboard</title></head>
            <body>
              <h1>Proxy Server Dashboard</h1>
              <p>Dashboard is running on worker ${process.pid}</p>
              <p><a href="/api/cache-status">View Cache Status</a></p>
            </body>
          </html>
        `);
        return;
      }
      res.writeHead(200, { "Content-Type": "text/html", "Content-Length": data.length });
      if (method === "HEAD") {
        res.end();
        return;
      }
      res.end(data);
    });
    return true;
  }

  // Static Assets from /public (screenshots, icons, images, styles, scripts)
  if (method === "GET" || method === "HEAD") {
    const safePath = path.normalize(cleanPath).replace(/^(\.\.[\/\\])+/, "");
    const candidatePath = path.resolve(PUBLIC_DIR, "." + safePath);
    if (candidatePath.startsWith(PUBLIC_DIR) && fs.existsSync(candidatePath)) {
      try {
        const stat = fs.statSync(candidatePath);
        if (stat.isFile()) {
          const ext = path.extname(candidatePath).toLowerCase();
          const contentType = MIME_TYPES[ext] || "application/octet-stream";
          res.writeHead(200, {
            "Content-Type": contentType,
            "Content-Length": stat.size
          });
          if (method === "HEAD") {
            res.end();
            return true;
          }
          fs.createReadStream(candidatePath).pipe(res);
          return true;
        }
      } catch {
        // Fall through on any filesystem race
      }
    }
  }

  // API: Get Cache Status
  if (cleanPath === "/api/cache-status" && (method === "GET" || method === "HEAD")) {
    const stats = await cacheManager.getStats();
    const payload = JSON.stringify(stats);
    res.writeHead(200, {
      "Content-Type": "application/json",
      "Content-Length": Buffer.byteLength(payload)
    });
    if (method === "HEAD") {
      res.end();
      return true;
    }
    res.end(payload);
    return true;
  }

  // API: Get Workers Status (Single-Port Cloud Ready)
  if (cleanPath === "/api/workers-status" && (method === "GET" || method === "HEAD")) {
    const workers = await cacheManager.getWorkersStatus();
    const payload = JSON.stringify({ workers });
    res.writeHead(200, {
      "Content-Type": "application/json",
      "Content-Length": Buffer.byteLength(payload)
    });
    if (method === "HEAD") {
      res.end();
      return true;
    }
    res.end(payload);
    return true;
  }

  // API: Clear Cache
  if (cleanPath === "/api/clear-cache" && method === "POST") {
    res.writeHead(200, { "Content-Type": "application/json" });
    await cacheManager.clear();
    res.end(JSON.stringify({ success: true, message: "Cache cleared" }));
    return true;
  }

  // API: Cache Item (GET/DELETE)
  if (cleanPath === "/api/cache-item") {
    const urlObj = new URL(req.url, `http://${req.headers.host || "localhost"}`);
    const key = urlObj.searchParams.get("key");

    if (!key) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Key parameter required" }));
      return true;
    }

    if (method === "GET" || method === "HEAD") {
      const item = await cacheManager.get(key);
      if (item === null || item === undefined) {
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Item not found in cache" }));
        return true;
      }

      let size = 0;
      let preview = "";
      if (Buffer.isBuffer(item)) {
        size = item.length;
        preview = item.toString("utf8").slice(0, 500);
      } else if (item && item.data && Buffer.isBuffer(item.data)) {
        size = item.data.length;
        preview = item.data.toString("utf8").slice(0, 500);
      } else if (typeof item === "string") {
        size = Buffer.byteLength(item, "utf8");
        preview = item.slice(0, 500);
      }

      const payload = JSON.stringify({
        key,
        size,
        preview,
        lastAccessed: Date.now()
      });
      res.writeHead(200, {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(payload)
      });
      if (method === "HEAD") {
        res.end();
        return true;
      }
      res.end(payload);
      return true;
    }

    if (method === "DELETE") {
      const deleted = await cacheManager.delete(key);
      if (deleted) {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ success: true, message: "Item deleted" }));
      } else {
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Item not found in cache" }));
      }
      return true;
    }
  }

  return false;
}

module.exports = handleDashboardRoutes;
