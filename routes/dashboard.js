const fs = require("fs");
const path = require("path");
const cacheManager = require("../cacheManager");
const { normalizePath } = require("../httpUtils");

const PUBLIC_DIR = path.join(__dirname, "..", "public");

async function handleDashboardRoutes(req, res) {
  const method = req.method;
  const cleanPath = normalizePath(req.url);

  // Set default CORS for local dashboard usage
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return true;
  }

  // Dashboard HTML
  if (cleanPath === "/" || cleanPath === "/index.html" || cleanPath === "/dashboard") {
    const filePath = path.join(PUBLIC_DIR, "index.html");
    fs.readFile(filePath, (err, data) => {
      if (err) {
        res.writeHead(200, { "Content-Type": "text/html" });
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
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(data);
    });
    return true;
  }

  // Dashboard JS
  if (cleanPath === "/dashboard.js") {
    const filePath = path.join(PUBLIC_DIR, "dashboard.js");
    fs.readFile(filePath, (err, data) => {
      if (err) {
        res.writeHead(404, { "Content-Type": "text/plain" });
        res.end("Dashboard JS not found");
        return;
      }
      res.writeHead(200, { "Content-Type": "application/javascript" });
      res.end(data);
    });
    return true;
  }

  // Dashboard CSS
  if (cleanPath === "/dashboard.css") {
    const filePath = path.join(PUBLIC_DIR, "dashboard.css");
    fs.readFile(filePath, (err, data) => {
      if (err) {
        res.writeHead(404, { "Content-Type": "text/plain" });
        res.end("Dashboard CSS not found");
        return;
      }
      res.writeHead(200, { "Content-Type": "text/css" });
      res.end(data);
    });
    return true;
  }

  // API: Get Cache Status
  if (cleanPath === "/api/cache-status" && method === "GET") {
    res.writeHead(200, { "Content-Type": "application/json" });
    const stats = await cacheManager.getStats();
    res.end(JSON.stringify(stats));
    return true;
  }

  // API: Get Workers Status (Single-Port Cloud Ready)
  if (cleanPath === "/api/workers-status" && method === "GET") {
    res.writeHead(200, { "Content-Type": "application/json" });
    const workers = await cacheManager.getWorkersStatus();
    res.end(JSON.stringify({ workers }));
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

    if (method === "GET") {
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

      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({
        key,
        size,
        preview,
        lastAccessed: Date.now()
      }));
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
