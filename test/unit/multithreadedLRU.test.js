const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { Worker } = require("node:worker_threads");
const path = require("node:path");
const { SharedMemoryLRU } = require("../../sharedMemoryLRU");

describe("Multithreaded Concurrent Execution with worker_threads & SharedArrayBuffer", () => {
  it("should handle highly concurrent writes and reads across 4 worker threads without race conditions", async () => {
    const threadCount = 4;
    const itemsPerThread = 15;
    const capacity = threadCount * itemsPerThread + 10;

    // Create shared cache on main thread
    const mainCache = new SharedMemoryLRU({
      maxEntries: capacity,
      bufferSizeBytes: 5 * 1024 * 1024,
      maxBytes: 2 * 1024 * 1024
    });

    const sab = mainCache.getSharedBuffer();

    const workerScript = `
      const { workerData, parentPort } = require("node:worker_threads");
      const { SharedMemoryLRU } = require("${path.join(__dirname, "../../sharedMemoryLRU").replace(/\\/g, "/")}");

      const cache = new SharedMemoryLRU({
        sharedBuffer: workerData.sab,
        maxEntries: workerData.capacity
      });

      const threadId = workerData.threadId;
      const count = workerData.itemsPerThread;

      // Concurrent PUTs
      for (let i = 0; i < count; i++) {
        const key = "thread-" + threadId + "-item-" + i;
        cache.put(key, {
          data: Buffer.from("payload-content-" + threadId + "-" + i),
          headers: { "x-worker-thread": String(threadId) },
          statusCode: 200
        });
      }

      // Concurrent GETs across items
      let localHits = 0;
      for (let i = 0; i < count; i++) {
        const key = "thread-" + threadId + "-item-" + i;
        const item = cache.get(key);
        if (item && item.data.toString("utf8") === "payload-content-" + threadId + "-" + i) {
          localHits++;
        }
      }

      parentPort.postMessage({ success: true, threadId, localHits });
    `;

    // Launch 4 OS worker threads concurrently
    const workerPromises = [];
    for (let t = 0; t < threadCount; t++) {
      workerPromises.push(
        new Promise((resolve, reject) => {
          const worker = new Worker(workerScript, {
            eval: true,
            workerData: { sab, capacity, threadId: t, itemsPerThread }
          });
          worker.on("message", resolve);
          worker.on("error", reject);
        })
      );
    }

    const results = await Promise.all(workerPromises);
    assert.strictEqual(results.length, threadCount);

    for (const r of results) {
      assert.strictEqual(r.success, true);
      assert.strictEqual(r.localHits, itemsPerThread);
    }

    // Verify main thread sees all data in the shared memory without needing IPC
    const stats = mainCache.getStats();
    assert.strictEqual(stats.size, threadCount * itemsPerThread);
    assert.strictEqual(stats.hits, threadCount * itemsPerThread);
    assert.strictEqual(stats.evictions, 0);

    // Cross-thread read verification: Main thread reads keys created by thread 2 and thread 3
    const crossItem1 = mainCache.get("thread-2-item-5");
    assert.ok(crossItem1);
    assert.strictEqual(crossItem1.data.toString("utf8"), "payload-content-2-5");
    assert.strictEqual(crossItem1.headers["x-worker-thread"], "2");

    const crossItem2 = mainCache.get("thread-3-item-12");
    assert.ok(crossItem2);
    assert.strictEqual(crossItem2.data.toString("utf8"), "payload-content-3-12");
    assert.strictEqual(crossItem2.headers["x-worker-thread"], "3");
  });
});

