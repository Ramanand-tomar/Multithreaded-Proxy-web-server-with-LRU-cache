const { describe, it } = require("node:test");
const assert = require("node:assert");
const LRUCache = require("../../lruCache");

describe("LRU Cache Byte-Aware Eviction & Limits", () => {
  it("should evict items when total byte budget is reached even if item limit is not", () => {
    // 100 bytes max memory, 10 items max
    const cache = new LRUCache({ maxEntries: 10, maxBytes: 100, maxItemBytes: 80 });

    // Insert 40-byte buffer item
    const buf40 = Buffer.alloc(40);
    cache.put("k1", buf40);
    assert.strictEqual(cache.size, 1);
    assert.ok(cache.currentBytes >= 42); // 40 + key length

    // Insert another 40-byte item
    cache.put("k2", buf40);
    assert.strictEqual(cache.size, 2);

    // Insert a 30-byte item -> total exceeds 100 bytes, so k1 must be evicted!
    const buf30 = Buffer.alloc(30);
    cache.put("k3", buf30);

    assert.strictEqual(cache.get("k1"), null); // Evicted due to byte limits!
    assert.ok(cache.get("k2") !== null);
    assert.ok(cache.get("k3") !== null);
    assert.strictEqual(cache.evictions, 1);
  });

  it("should reject items exceeding maxItemBytes", () => {
    const cache = new LRUCache({ maxEntries: 10, maxBytes: 1000, maxItemBytes: 50 });
    const hugeBuf = Buffer.alloc(60);

    const result = cache.put("huge", hugeBuf);
    assert.strictEqual(result, null);
    assert.strictEqual(cache.get("huge"), null);
    assert.strictEqual(cache.size, 0);
  });
});

