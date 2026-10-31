const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { SharedMemoryLRU } = require("../../sharedMemoryLRU");

describe("Shared-Memory LRU Cache with SharedArrayBuffer & Atomics", () => {
  it("should insert, retrieve, and update items in shared memory", () => {
    const cache = new SharedMemoryLRU({
      maxEntries: 3,
      bufferSizeBytes: 1024 * 1024,
      maxBytes: 100 * 1024
    });

    const putRes = cache.put("https://example.com/item1", {
      data: Buffer.from("data-1"),
      headers: { "content-type": "text/plain" },
      statusCode: 200
    });
    assert.strictEqual(putRes, true);

    const item = cache.get("https://example.com/item1");
    assert.ok(item);
    assert.strictEqual(item.data.toString("utf8"), "data-1");
    assert.strictEqual(item.headers["content-type"], "text/plain");
    assert.strictEqual(item.statusCode, 200);

    const stats = cache.getStats();
    assert.strictEqual(stats.size, 1);
    assert.strictEqual(stats.hits, 1);
    assert.strictEqual(stats.misses, 0);
  });

  it("should evict least recently used entries when capacity limit is reached", () => {
    const cache = new SharedMemoryLRU({
      maxEntries: 2,
      bufferSizeBytes: 1024 * 1024,
      maxBytes: 100 * 1024
    });

    cache.put("key1", { data: Buffer.from("v1"), statusCode: 200 });
    cache.put("key2", { data: Buffer.from("v2"), statusCode: 200 });

    // Access key1 so key2 becomes LRU
    assert.ok(cache.get("key1"));

    // Insert key3 -> key2 must be evicted
    cache.put("key3", { data: Buffer.from("v3"), statusCode: 200 });

    assert.strictEqual(cache.get("key2"), null);
    assert.ok(cache.get("key1"));
    assert.ok(cache.get("key3"));

    const stats = cache.getStats();
    assert.strictEqual(stats.size, 2);
    assert.strictEqual(stats.evictions, 1);
  });

  it("should evict entries when total byte budget is reached", () => {
    const cache = new SharedMemoryLRU({
      maxEntries: 10,
      bufferSizeBytes: 1024 * 1024,
      maxBytes: 150 // Small budget
    });

    // Each payload is ~60 bytes total
    cache.put("item1", { data: Buffer.alloc(50, 1) });
    cache.put("item2", { data: Buffer.alloc(50, 2) });
    cache.put("item3", { data: Buffer.alloc(50, 3) });

    const stats = cache.getStats();
    // Budget 150 bytes should have caused eviction
    assert.ok(stats.size <= 2);
    assert.ok(stats.evictions >= 1);
  });

  it("should safely delete individual keys and clear the cache", () => {
    const cache = new SharedMemoryLRU({
      maxEntries: 5,
      bufferSizeBytes: 1024 * 1024
    });

    cache.put("del1", { data: Buffer.from("a") });
    cache.put("del2", { data: Buffer.from("b") });

    assert.strictEqual(cache.delete("del1"), true);
    assert.strictEqual(cache.get("del1"), null);
    assert.ok(cache.get("del2"));

    cache.clear();
    const stats = cache.getStats();
    assert.strictEqual(stats.size, 0);
    assert.strictEqual(cache.get("del2"), null);
  });

  it("should allow two separate instances to share the exact same SharedArrayBuffer", () => {
    const mainCache = new SharedMemoryLRU({
      maxEntries: 5,
      bufferSizeBytes: 1024 * 1024
    });

    // Obtain the raw SharedArrayBuffer
    const sab = mainCache.getSharedBuffer();

    // Secondary instance attaching to the same buffer
    const threadCache = new SharedMemoryLRU({
      sharedBuffer: sab,
      maxEntries: 5
    });

    // Write through instance A
    mainCache.put("shared-key-1", {
      data: Buffer.from("shared-thread-content"),
      headers: { "x-thread": "worker-1" },
      statusCode: 200
    });

    // Read through instance B (zero-copy from the same SharedArrayBuffer)
    const readItem = threadCache.get("shared-key-1");
    assert.ok(readItem);
    assert.strictEqual(readItem.data.toString("utf8"), "shared-thread-content");
    assert.strictEqual(readItem.headers["x-thread"], "worker-1");

    // Modify through instance B and read back through instance A
    threadCache.put("shared-key-2", { data: Buffer.from("from-thread-2") });
    assert.ok(mainCache.get("shared-key-2"));
  });
});
