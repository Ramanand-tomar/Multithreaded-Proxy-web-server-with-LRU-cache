const cluster = require("cluster");
const http = require("http");
const handleRequest = require("./proxyHandler");
const handleDashboardRoutes = require("./routes/dashboard");
const WorkerManager = require("./workerManager");
const { PORT, STATUS_PORT, CONCURRENCY_MODE } = require("./config");

// If configured for pure multithreading, delegate to threadedServer engine
if (CONCURRENCY_MODE === "threads") {
  require("./threadedServer");
  return;
}

// Route dispatcher delegating to dashboard router or proxy handler
async function handleRoutes(req, res) {
  try {
    const handled = await handleDashboardRoutes(req, res);
    if (handled) return;

    // Favicon bypass
    if (req.url === "/favicon.ico") {
      res.writeHead(204, { "Content-Type": "image/x-icon" });
      res.end();
      return;
    }

    // All other requests go to proxy handler
    await handleRequest(req, res);
  } catch (err) {
    if (!res.headersSent) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Internal Server Error", message: err.message }));
    }
  }
}

if (cluster.isMaster) {
  // Initialize resilient Master Worker Supervisor & Centralized IPC Cache
  const supervisor = new WorkerManager();
  supervisor.start();

  // Master status server for cluster telemetry
  const statusServer = http.createServer((req, res) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Content-Type", "application/json");

    if (req.url === "/api/workers-status" && req.method === "GET") {
      const workers = supervisor.getWorkersList();
      res.end(JSON.stringify({ workers }));
    } else {
      res.writeHead(404);
      res.end(JSON.stringify({ error: "Not found" }));
    }
  });

  statusServer.on("error", (err) => {
    if (err && err.code === "EADDRINUSE") {
      console.warn(`Status port ${STATUS_PORT} is already in use. Skipping worker status server.`);
    } else {
      console.error("Worker status server error:", err);
    }
  });

  statusServer.listen(STATUS_PORT, () => {
    console.log(`[Supervisor] Worker status telemetry server running on port ${STATUS_PORT}`);
  });
} else {
  // Worker process
  let requestCount = 0;
  let activeConnections = 0;
  let isShuttingDown = false;

  const server = http.createServer((req, res) => {
    if (isShuttingDown) {
      res.setHeader("Connection", "close");
      res.writeHead(503, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Worker is shutting down" }));
      return;
    }

    activeConnections++;
    const updateStatus = (status) => {
      if (process.send) {
        try {
          process.send({
            type: "status",
            data: {
              status,
              requests: ++requestCount,
              activeConnections,
              lastRequest: new Date().toISOString(),
              pid: process.pid
            }
          });
        } catch (_) {}
      }
    };

    updateStatus("busy");
    handleRoutes(req, res).finally(() => {
      activeConnections = Math.max(0, activeConnections - 1);
      updateStatus("available");
    });
  });

  // Handle graceful shutdown message from master
  process.on("message", (msg) => {
    if (msg && msg.type === "SHUTDOWN") {
      isShuttingDown = true;
      console.log(`[Worker ${process.pid}] Commencing graceful connection drain...`);
      server.close(() => {
        console.log(`[Worker ${process.pid}] Closed all server connections. Exiting.`);
        process.exit(0);
      });

      // Force close if connections don't drain within 3 seconds
      setTimeout(() => {
        console.warn(`[Worker ${process.pid}] Shutdown timeout elapsed. Forcing exit.`);
        process.exit(0);
      }, 3000).unref();
    }
  });

  server.on("error", (err) => {
    if (err && err.code === "EADDRINUSE") {
      console.warn(`Port ${PORT} in use. Exiting worker ${process.pid}.`);
      try { server.close(); } catch (_) {}
      process.exit(0);
    } else {
      throw err;
    }
  });

  server.listen(PORT, () => {
    console.log(`[Worker ${process.pid}] Listening on port ${PORT}`);
    console.log(`🚀 Dashboard: http://localhost:${PORT}/`);
    console.log(`🔗 Proxy: http://localhost:${PORT}/`);
  });
}
