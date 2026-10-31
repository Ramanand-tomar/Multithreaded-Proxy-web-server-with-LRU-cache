// ThreadPool: High-Performance Worker Thread Pool sharing a SharedMemoryLRU
// Provides multithreaded execution across CPU cores using node:worker_threads

const { Worker } = require("node:worker_threads");
const os = require("node:os");
const path = require("node:path");
const { SharedMemoryLRU } = require("./sharedMemoryLRU");
const { CACHE_LIMIT, MAX_CACHE_BYTES, MAX_ITEM_BYTES } = require("./config");

class ThreadPool {
  /**
   * @param {Object} [options]
   * @param {number} [options.threads] - Number of worker threads (defaults to CPU cores or 2)
   * @param {number} [options.maxEntries] - Shared cache capacity
   * @param {number} [options.bufferSizeBytes] - Size of SharedArrayBuffer
   */
  constructor(options = {}) {
    this.threadCount = options.threads || Math.max(2, Math.min(8, os.cpus().length));
    this.sharedCache = new SharedMemoryLRU({
      maxEntries: options.maxEntries || CACHE_LIMIT,
      maxBytes: options.maxBytes || MAX_CACHE_BYTES,
      maxItemBytes: options.maxItemBytes || MAX_ITEM_BYTES,
      bufferSizeBytes: options.bufferSizeBytes || 20 * 1024 * 1024 // 20 MB default
    });

    this.sab = this.sharedCache.getSharedBuffer();
    this.workers = [];
    this.freeWorkers = [];
    this.taskQueue = [];
    this.taskId = 0;
    this.pendingTasks = new Map();
    this.isInitialized = false;
    this.isDestroyed = false;
  }

  init() {
    if (this.isInitialized) return;
    this.isInitialized = true;

    const workerScript = path.join(__dirname, "threadWorker.js");

    for (let i = 0; i < this.threadCount; i++) {
      this._spawnWorker(i, workerScript);
    }
  }

  _spawnWorker(threadId, scriptPath) {
    const worker = new Worker(scriptPath, {
      workerData: {
        threadId,
        sab: this.sab,
        capacity: this.sharedCache.capacity
      }
    });

    worker.on("message", (msg) => {
      if (!msg || typeof msg !== "object") return;
      const { id, success, result, error } = msg;

      if (id && this.pendingTasks.has(id)) {
        const { resolve, reject } = this.pendingTasks.get(id);
        this.pendingTasks.delete(id);
        if (success) resolve(result);
        else reject(new Error(error || "Worker task failed"));
      }

      this.freeWorkers.push(worker);
      this._drainQueue();
    });

    worker.on("error", (err) => {
      console.error(`[ThreadPool] Worker ${threadId} error:`, err);
    });

    worker.on("exit", (code) => {
      if (this.isDestroyed) return;
      if (code !== 0) {
        console.warn(`[ThreadPool] Worker ${threadId} exited with code ${code}. Respawning...`);
        const idx = this.workers.indexOf(worker);
        if (idx !== -1) this.workers.splice(idx, 1);
        const freeIdx = this.freeWorkers.indexOf(worker);
        if (freeIdx !== -1) this.freeWorkers.splice(freeIdx, 1);
        this._spawnWorker(threadId, scriptPath);
      }
    });

    this.workers.push(worker);
    this.freeWorkers.push(worker);
  }

  _drainQueue() {
    while (this.freeWorkers.length > 0 && this.taskQueue.length > 0) {
      const worker = this.freeWorkers.pop();
      const task = this.taskQueue.shift();
      this.pendingTasks.set(task.id, task);
      worker.postMessage({ id: task.id, action: task.action, payload: task.payload });
    }
  }

  /**
   * Execute an offloaded task inside an OS worker thread
   */
  execute(action, payload) {
    if (!this.isInitialized) this.init();

    return new Promise((resolve, reject) => {
      const id = ++this.taskId;
      this.taskQueue.push({ id, action, payload, resolve, reject });
      this._drainQueue();
    });
  }

  // Direct zero-copy access to the shared cache from the main thread
  get(key) {
    return this.sharedCache.get(key);
  }

  put(key, entry) {
    return this.sharedCache.put(key, entry);
  }

  delete(key) {
    return this.sharedCache.delete(key);
  }

  clear() {
    return this.sharedCache.clear();
  }

  getStats() {
    return this.sharedCache.getStats();
  }

  getSharedBuffer() {
    return this.sab;
  }

  destroy() {
    this.isDestroyed = true;
    return Promise.all(this.workers.map((w) => w.terminate()));
  }
}

module.exports = ThreadPool;
