const { describe, it, after } = require("node:test");
const assert = require("node:assert/strict");
const ThreadPool = require("../../threadPool");

describe("ThreadPool with SharedMemoryLRU and Offloaded Worker Tasks", () => {
  let pool;

  after(async () => {
    if (pool) {
      await pool.destroy();
    }
  });

  it("should spawn workers, share SharedArrayBuffer, and execute tasks", async () => {
    pool = new ThreadPool({ threads: 2, maxEntries: 10, bufferSizeBytes: 2 * 1024 * 1024 });
    pool.init();

    // 1. Ping worker thread
    const pong = await pool.execute("PING");
    assert.strictEqual(pong.pong, true);

    // 2. Offload Brotli compression to thread
    const originalText = "Hello World! This is a high-performance multithreaded proxy with shared memory.";
    const compressed = await pool.execute("COMPRESS_BROTLI", Buffer.from(originalText));
    assert.ok(compressed instanceof Uint8Array);

    // 3. Decompress back in worker thread
    const decompressed = await pool.execute("DECOMPRESS_BROTLI", Buffer.from(compressed));
    assert.strictEqual(Buffer.from(decompressed).toString("utf8"), originalText);

    // 4. Compute ETag in worker thread
    const etag = await pool.execute("COMPUTE_ETAG", Buffer.from(originalText));
    assert.ok(etag.startsWith('W/"'));

    // 5. Verify direct shared cache access via SharedArrayBuffer
    pool.put("main-written-key", {
      data: Buffer.from("zero-copy-shared-data"),
      headers: { "x-multithread": "true" },
      statusCode: 200
    });

    // Read through worker thread from the same SharedArrayBuffer
    const threadRead = await pool.execute("CACHE_GET", { key: "main-written-key" });
    assert.ok(threadRead);
    assert.strictEqual(Buffer.from(threadRead.data).toString("utf8"), "zero-copy-shared-data");
    assert.strictEqual(threadRead.headers["x-multithread"], "true");
  });
});
