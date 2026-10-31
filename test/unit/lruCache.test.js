const { describe, it } = require("node:test");
const assert = require("node:assert");
const LRUCache = require("../../lruCache");

describe("LRU Cache Implementation", () => {
  it("should insert and retrieve items in O(1) order", () => {
    const cache = new LRUCache(3);
    cache.put("a", 1);
    cache.put("b", 2);
    cache.put("c", 3);

    assert.strictEqual(cache.get("a"), 1);
    assert.strictEqual(cache.get("b"), 2);
    assert.strictEqual(cache.get("c"), 3);
    assert.strictEqual(cache.hits, 3);
  });

  it("should evict least recently used items when limit is exceeded", () => {
    const cache = new LRUCache(2);
    cache.put("x", 10);
    cache.put("y", 20);
    // Access x so y becomes the LRU
    cache.get("x");
    // Insert z, which should evict y
    cache.put("z", 30);

    assert.strictEqual(cache.get("x"), 10);
    assert.strictEqual(cache.get("y"), null); // Evicted!
    assert.strictEqual(cache.get("z"), 30);
    assert.strictEqual(cache.evictions, 1);
  });

  it("should update value and move item to front when key already exists", () => {
    const cache = new LRUCache(2);
    cache.put("key1", "val1");
    cache.put("key2", "val2");
    cache.put("key1", "val1-updated");

    assert.strictEqual(cache.size, 2);
    assert.strictEqual(cache.get("key1"), "val1-updated");
  });

  it("should safely delete individual items", () => {
    const cache = new LRUCache(3);
    cache.put("k1", "v1");
    cache.put("k2", "v2");

    assert.strictEqual(cache.delete("k1"), true);
    assert.strictEqual(cache.get("k1"), null);
    assert.strictEqual(cache.size, 1);
    assert.strictEqual(cache.delete("nonexistent"), false);
  });

  it("should safely clear all entries", () => {
    const cache = new LRUCache(3);
    cache.put("k1", "v1");
    cache.put("k2", "v2");
    cache.clear();

    assert.strictEqual(cache.size, 0);
    assert.strictEqual(cache.get("k1"), null);
    assert.strictEqual(cache.map.size, 0);
  });

  it("should not crash or corrupt sentinels with invalid limits", () => {
    // Should fallback to default positive limit rather than crashing
    const cacheZero = new LRUCache(0);
    assert.ok(cacheZero.limit > 0);
    cacheZero.put("test", 123);
    assert.strictEqual(cacheZero.get("test"), 123);

    const cacheNeg = new LRUCache(-10);
    assert.ok(cacheNeg.limit > 0);
    cacheNeg.put("testNeg", 456);
    assert.strictEqual(cacheNeg.get("testNeg"), 456);
  });
});

