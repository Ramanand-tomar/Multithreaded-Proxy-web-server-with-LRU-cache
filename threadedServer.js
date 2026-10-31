// threadedServer.js: Multithreaded Proxy Server Engine using node:worker_threads & SharedMemoryLRU
// Implements true OS-thread concurrency with zero-copy shared memory caching.

const http = require("node:http");
const { isMainThread } = require("node:worker_threads");
const ThreadPool = require("./threadPool");
const handleRequest = require("./proxyHandler");
const handleDashboardRoutes = require("./routes/dashboard");
const cacheManager = require("./cacheManager");
const { PORT, WORKER_COUNT, CACHE_LIMIT, MAX_CACHE_BYTES } = require("./config");

if (isMainThread) {
  const threads = WORKER_COUNT > 0 ? WORKER_COUNT : Math.max(2, require("node:os").cpus().length);
  console.log(`[ThreadedServer] Starting multithreaded engine with ${threads} OS worker threads...`);

  // Initialize ThreadPool with SharedMemoryLRU
  const pool = new ThreadPool({
    threads,
    maxEntries: CACHE_LIMIT,
    maxBytes: MAX_CACHE_BYTES
  });
  pool.init();

  // Configure cacheManager to use the zero-copy SharedMemoryLRU directly
  cacheManager.localCache = pool.sharedCache;

  const server = http.createServer(async (req, res) => {
    try {
      const handled = await handleDashboardRoutes(req, res);
      if (handled) return;

      if (req.url === "/favicon.ico") {
        res.writeHead(204, { "Content-Type": "image/x-icon" });
        res.end();
        return;
      }

      await handleRequest(req, res);
    } catch (err) {
      if (!res.headersSent) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Internal Server Error", message: err.message }));
      }
    }
  });

  server.listen(PORT, () => {
    console.log(`[ThreadedServer] 🚀 Server running on port ${PORT} [Mode: Multi-Threaded Worker Threads]`);
    console.log(`[ThreadedServer] 🧠 Shared-Memory LRU Cache active (Zero-Copy SharedArrayBuffer with Atomics)`);
    console.log(`[ThreadedServer] 📊 Dashboard: http://localhost:${PORT}/`);
  });

  process.on("SIGINT", async () => {
    console.log("[ThreadedServer] Shutting down thread pool...");
    await pool.destroy();
    server.close(() => process.exit(0));
  });

  process.on("SIGTERM", async () => {
    console.log("[ThreadedServer] Shutting down thread pool...");
    await pool.destroy();
    server.close(() => process.exit(0));
  });
}

