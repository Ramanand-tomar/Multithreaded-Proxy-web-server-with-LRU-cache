// threadWorker.js: Worker thread execution script
// Attaches directly to the SharedArrayBuffer and executes offloaded CPU / Caching tasks

const { parentPort, workerData } = require("node:worker_threads");
const zlib = require("node:zlib");
const crypto = require("node:crypto");
const { SharedMemoryLRU } = require("./sharedMemoryLRU");

const threadId = workerData.threadId;
const sharedCache = new SharedMemoryLRU({
  sharedBuffer: workerData.sab,
  maxEntries: workerData.capacity
});

parentPort.on("message", ({ id, action, payload }) => {
  try {
    let result;

    switch (action) {
      case "CACHE_GET": {
        result = sharedCache.get(payload.key);
        break;
      }

      case "CACHE_PUT": {
        result = sharedCache.put(payload.key, payload.entry);
        break;
      }

      case "CACHE_DELETE": {
        result = sharedCache.delete(payload.key);
        break;
      }

      case "CACHE_STATS": {
        result = sharedCache.getStats();
        break;
      }

      case "COMPRESS_BROTLI": {
        const input = Buffer.isBuffer(payload) ? payload : Buffer.from(payload);
        result = zlib.brotliCompressSync(input);
        break;
      }

      case "DECOMPRESS_BROTLI": {
        const input = Buffer.isBuffer(payload) ? payload : Buffer.from(payload);
        result = zlib.brotliDecompressSync(input);
        break;
      }

      case "COMPUTE_ETAG": {
        const input = Buffer.isBuffer(payload) ? payload : Buffer.from(payload);
        result = 'W/"' + crypto.createHash("sha256").update(input).digest("hex").slice(0, 16) + '"';
        break;
      }

      case "PING": {
        result = { threadId, pong: true, time: Date.now() };
        break;
      }

      default:
        throw new Error(`Unknown action: ${action}`);
    }

    parentPort.postMessage({ id, success: true, result });
  } catch (error) {
    parentPort.postMessage({ id, success: false, error: error.message });
  }
});
