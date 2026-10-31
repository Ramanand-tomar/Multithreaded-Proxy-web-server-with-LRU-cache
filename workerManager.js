// Worker Supervisor: Lifecycle Monitoring, Crash Detection with Backoff, IPC Cache Coordination, and Graceful Shutdown
const cluster = require("cluster");
const os = require("os");
const LRUCache = require("./lruCache");
const { CACHE_LIMIT, MAX_CACHE_BYTES, MAX_ITEM_BYTES, WORKER_COUNT } = require("./config");

class WorkerManager {
  constructor() {
    this.numWorkers = WORKER_COUNT > 0 ? WORKER_COUNT : os.cpus().length;
    this.workerStats = new Map();
    this.masterCache = new LRUCache({
      maxEntries: CACHE_LIMIT,
      maxBytes: MAX_CACHE_BYTES,
      maxItemBytes: MAX_ITEM_BYTES
    });

    // Crash loop protection
    this.recentCrashes = [];
    this.maxRapidCrashes = 5;
    this.rapidCrashWindowMs = 15000;
    this.isShuttingDown = false;
  }

  start() {
    console.log(`[Supervisor] Master process (PID: ${process.pid}) initializing. Target workers: ${this.numWorkers}`);

    for (let i = 0; i < this.numWorkers; i++) {
      this._spawnWorker();
    }

    cluster.on("exit", (worker, code, signal) => {
      this._handleWorkerExit(worker, code, signal);
    });

    process.on("SIGINT", () => this.gracefulShutdown("SIGINT"));
    process.on("SIGTERM", () => this.gracefulShutdown("SIGTERM"));
  }

  _spawnWorker() {
    if (this.isShuttingDown) return null;

    const worker = cluster.fork();
    const stats = {
      id: worker.id,
      pid: worker.process.pid,
      status: "available",
      requests: 0,
      restarts: 0,
      startedAt: Date.now(),
      lastRequest: null
    };

    this.workerStats.set(worker.id, stats);

    worker.on("message", (msg) => {
      this._handleWorkerMessage(worker, msg);
    });

    return worker;
  }

  _handleWorkerExit(worker, code, signal) {
    const stats = this.workerStats.get(worker.id);
    const restarts = (stats ? stats.restarts : 0) + 1;
    this.workerStats.delete(worker.id);

    if (this.isShuttingDown) {
      console.log(`[Supervisor] Worker ${worker.id} (PID: ${worker.process.pid}) exited cleanly during shutdown.`);
      return;
    }

    console.warn(`[Supervisor] Worker ${worker.id} (PID: ${worker.process.pid}) died (Code: ${code}, Signal: ${signal}).`);

    const now = Date.now();
    this.recentCrashes.push(now);
    this.recentCrashes = this.recentCrashes.filter((t) => now - t < this.rapidCrashWindowMs);

    if (this.recentCrashes.length >= this.maxRapidCrashes) {
      console.error(`[Supervisor] CRITICAL: ${this.recentCrashes.length} crashes detected within ${this.rapidCrashWindowMs / 1000}s. Pausing worker restarts for 5 seconds.`);
      setTimeout(() => {
        if (!this.isShuttingDown) {
          const newWorker = this._spawnWorker();
          if (newWorker && stats) {
            const newStats = this.workerStats.get(newWorker.id);
            if (newStats) newStats.restarts = restarts;
          }
        }
      }, 5000);
      return;
    }

    const delay = Math.min(1000 * Math.pow(1.5, restarts - 1), 5000);
    setTimeout(() => {
      if (!this.isShuttingDown) {
        const newWorker = this._spawnWorker();
        if (newWorker && stats) {
          const newStats = this.workerStats.get(newWorker.id);
          if (newStats) newStats.restarts = restarts;
        }
      }
    }, delay);
  }

  _handleWorkerMessage(worker, msg) {
    if (!msg || typeof msg !== "object") return;

    // Worker status update
    if (msg.type === "status") {
      const current = this.workerStats.get(worker.id);
      if (current) {
        Object.assign(current, msg.data, { pid: worker.process.pid });
      }
      return;
    }

    // Worker telemetry query
    if (msg.type === "GET_WORKERS_STATUS") {
      const workers = this.getWorkersList();
      worker.send({ type: "GET_WORKERS_STATUS_RESP", id: msg.id, workers });
      return;
    }

    // Authoritative Shared Cache IPC Protocol
    if (msg.type === "CACHE_GET") {
      const cached = this.masterCache.get(msg.key);
      let payload = null;
      if (cached) {
        payload = {
          headers: cached.headers,
          statusCode: cached.statusCode,
          size: cached.size,
          dataBase64: cached.data ? cached.data.toString("base64") : null
        };
      }
      worker.send({ type: "CACHE_GET_RESP", id: msg.id, payload });
      return;
    }

    if (msg.type === "CACHE_PUT") {
      if (msg.entry) {
        const dataBuffer = msg.entry.dataBase64
          ? Buffer.from(msg.entry.dataBase64, "base64")
          : Buffer.from("");
        this.masterCache.put(msg.key, {
          data: dataBuffer,
          headers: msg.entry.headers,
          statusCode: msg.entry.statusCode,
          size: dataBuffer.length
        });
      }
      worker.send({ type: "CACHE_PUT_ACK", id: msg.id });
      return;
    }

    if (msg.type === "CACHE_DELETE") {
      const deleted = this.masterCache.delete(msg.key);
      worker.send({ type: "CACHE_DELETE_RESP", id: msg.id, deleted });
      return;
    }

    if (msg.type === "CACHE_CLEAR") {
      this.masterCache.clear();
      worker.send({ type: "CACHE_CLEAR_ACK", id: msg.id });
      return;
    }

    if (msg.type === "CACHE_STATS") {
      const stats = this._getMasterCacheStats();
      worker.send({ type: "CACHE_STATS_RESP", id: msg.id, stats });
      return;
    }
  }

  _getMasterCacheStats() {
    const keys = [];
    let totalBytes = 0;
    let node = this.masterCache.head.next;

    while (node && node !== this.masterCache.tail) {
      const itemBytes = node.size || 0;
      totalBytes += itemBytes;
      keys.push({
        key: node.key,
        size: itemBytes,
        lastAccessed: node.lastAccessed
      });
      node = node.next;
    }

    const totalRequests = this.masterCache.hits + this.masterCache.misses;
    const hitRatio = totalRequests > 0 ? (this.masterCache.hits / totalRequests * 100).toFixed(1) : "0.0";
    const memoryUsageMB = (totalBytes / (1024 * 1024)).toFixed(2);

    return {
      size: this.masterCache.size,
      limit: this.masterCache.limit,
      hitRatio,
      memoryUsage: memoryUsageMB,
      totalBytes,
      hits: this.masterCache.hits,
      misses: this.masterCache.misses,
      evictions: this.masterCache.evictions,
      totalRequests,
      keys
    };
  }

  getWorkersList() {
    return Array.from(this.workerStats.values());
  }

  gracefulShutdown(signal) {
    if (this.isShuttingDown) return;
    this.isShuttingDown = true;
    console.log(`[Supervisor] Received ${signal}. Commencing graceful cluster termination...`);

    for (const id in cluster.workers) {
      const worker = cluster.workers[id];
      if (worker) {
        worker.send({ type: "SHUTDOWN" });
        worker.disconnect();
      }
    }

    const forceExitTimer = setTimeout(() => {
      console.warn("[Supervisor] Graceful shutdown timeout elapsed. Forcing master process termination.");
      process.exit(1);
    }, 4000);

    forceExitTimer.unref();
  }
}

module.exports = WorkerManager;
