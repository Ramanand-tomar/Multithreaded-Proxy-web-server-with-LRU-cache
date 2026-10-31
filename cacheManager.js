// Cache Manager: Unified Client supporting Local and IPC Cluster Shared-Cache modes
const cluster = require("cluster");
const LRUCache = require("./lruCache");
const SingleFlight = require("./singleFlight");
const { CACHE_LIMIT, MAX_CACHE_BYTES, MAX_ITEM_BYTES } = require("./config");

class CacheManager {
  constructor() {
    this.localCache = new LRUCache({
      maxEntries: CACHE_LIMIT,
      maxBytes: MAX_CACHE_BYTES,
      maxItemBytes: MAX_ITEM_BYTES
    });

    this.singleFlight = new SingleFlight();
    this.pendingIpc = new Map();
    this.reqId = 0;
    this.isWorker = cluster.isWorker && typeof process.send === "function";

    if (this.isWorker) {
      process.on("message", (msg) => {
        if (!msg || typeof msg !== "object") return;
        if (msg.id && this.pendingIpc.has(msg.id)) {
          const { resolve } = this.pendingIpc.get(msg.id);
          this.pendingIpc.delete(msg.id);
          resolve(msg);
        }
      });
    }
  }

  _sendIpc(type, payload = {}) {
    return new Promise((resolve) => {
      const id = ++this.reqId;
      const timeout = setTimeout(() => {
        if (this.pendingIpc.has(id)) {
          this.pendingIpc.delete(id);
          resolve(null);
        }
      }, 2000);

      this.pendingIpc.set(id, {
        resolve: (val) => {
          clearTimeout(timeout);
          resolve(val);
        }
      });

      try {
        process.send({ type, id, ...payload });
      } catch (err) {
        clearTimeout(timeout);
        this.pendingIpc.delete(id);
        resolve(null);
      }
    });
  }

  async get(key) {
    if (this.isWorker) {
      const resp = await this._sendIpc("CACHE_GET", { key });
      if (resp && resp.payload) {
        return {
          headers: resp.payload.headers,
          statusCode: resp.payload.statusCode,
          size: resp.payload.size,
          data: resp.payload.dataBase64 ? Buffer.from(resp.payload.dataBase64, "base64") : Buffer.from("")
        };
      }
      return null;
    }
    return this.localCache.get(key);
  }

  async put(key, entry) {
    if (this.isWorker) {
      const dataBase64 = entry.data && Buffer.isBuffer(entry.data)
        ? entry.data.toString("base64")
        : "";

      await this._sendIpc("CACHE_PUT", {
        key,
        entry: {
          dataBase64,
          headers: entry.headers,
          statusCode: entry.statusCode,
          size: entry.size
        }
      });
      return;
    }
    this.localCache.put(key, entry);
  }

  async delete(key) {
    if (this.isWorker) {
      const resp = await this._sendIpc("CACHE_DELETE", { key });
      return resp ? Boolean(resp.deleted) : false;
    }
    return this.localCache.delete(key);
  }

  async clear() {
    if (this.isWorker) {
      await this._sendIpc("CACHE_CLEAR");
      return;
    }
    this.localCache.clear();
  }

  async getStats() {
    if (this.isWorker) {
      const resp = await this._sendIpc("CACHE_STATS");
      if (resp && resp.stats) {
        return resp.stats;
      }
    }

    const keys = [];
    let totalBytes = 0;
    let node = this.localCache.head.next;

    while (node && node !== this.localCache.tail) {
      const itemBytes = node.size || 0;
      totalBytes += itemBytes;
      keys.push({
        key: node.key,
        size: itemBytes,
        lastAccessed: node.lastAccessed
      });
      node = node.next;
    }

    const totalRequests = this.localCache.hits + this.localCache.misses;
    const hitRatio = totalRequests > 0 ? (this.localCache.hits / totalRequests * 100).toFixed(1) : "0.0";
    const memoryUsageMB = (totalBytes / (1024 * 1024)).toFixed(2);

    return {
      size: this.localCache.size,
      limit: this.localCache.limit,
      hitRatio,
      memoryUsage: memoryUsageMB,
      totalBytes,
      hits: this.localCache.hits,
      misses: this.localCache.misses,
      evictions: this.localCache.evictions,
      totalRequests,
      keys
    };
  }

  async getWorkersStatus() {
    if (this.isWorker) {
      const resp = await this._sendIpc("GET_WORKERS_STATUS");
      if (resp && resp.workers) {
        return resp.workers;
      }
    }
    return [{ id: 1, pid: process.pid, status: "available", requests: 0 }];
  }

  getQuickStats() {
    const totalRequests = this.localCache.hits + this.localCache.misses;
    const hitRatio = totalRequests > 0 ? (this.localCache.hits / totalRequests * 100).toFixed(1) : "0.0";
    return {
      size: this.localCache.size,
      limit: this.localCache.limit,
      hits: this.localCache.hits,
      misses: this.localCache.misses,
      hitRatio
    };
  }

  getCache() {
    return this.localCache;
  }
}

module.exports = new CacheManager();
