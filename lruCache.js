// Production-grade, dual-bounded (Items & Bytes) LRU Cache with O(1) operations
class Node {
  constructor(key, value, size = 0) {
    this.key = key;
    this.value = value;
    this.size = size;
    this.prev = null;
    this.next = null;
    this.lastAccessed = Date.now();
  }
}

class LRUCache {
  /**
   * @param {object|number} options
   * @param {number} [options.maxEntries=50]
   * @param {number} [options.maxBytes=104857600] // 100 MiB default
   * @param {number} [options.maxItemBytes=5242880] // 5 MiB default
   */
  constructor(options = 50) {
    let maxEntries = 50;
    let maxBytes = 100 * 1024 * 1024;
    let maxItemBytes = 5 * 1024 * 1024;

    if (typeof options === "number") {
      maxEntries = options;
    } else if (typeof options === "object" && options !== null) {
      if (options.limit || options.maxEntries) maxEntries = options.limit || options.maxEntries;
      if (options.maxBytes) maxBytes = options.maxBytes;
      if (options.maxItemBytes) maxItemBytes = options.maxItemBytes;
    }

    this.maxEntries = Number.isInteger(maxEntries) && maxEntries > 0 ? maxEntries : 50;
    this.maxBytes = Number.isFinite(maxBytes) && maxBytes > 0 ? maxBytes : 100 * 1024 * 1024;
    this.maxItemBytes = Number.isFinite(maxItemBytes) && maxItemBytes > 0 ? maxItemBytes : 5 * 1024 * 1024;

    this.size = 0; // Item count
    this.currentBytes = 0; // Total memory tracked in bytes
    this.map = new Map();

    // Sentinel nodes
    this.head = new Node(null, null, 0);
    this.tail = new Node(null, null, 0);
    this.head.next = this.tail;
    this.tail.prev = this.head;

    // Metrics
    this.hits = 0;
    this.misses = 0;
    this.evictions = 0;
  }

  // Alias limit to maxEntries for backwards compatibility
  get limit() {
    return this.maxEntries;
  }

  set limit(val) {
    this.maxEntries = val;
  }

  _calculateItemBytes(key, value) {
    const keyBytes = Buffer.byteLength(String(key || ""), "utf8");
    let valBytes = 0;

    if (value) {
      if (Buffer.isBuffer(value)) {
        valBytes = value.length;
      } else if (value.data && Buffer.isBuffer(value.data)) {
        valBytes = value.data.length;
      } else if (typeof value === "string") {
        valBytes = Buffer.byteLength(value, "utf8");
      } else if (value.size) {
        valBytes = Number(value.size) || 0;
      }
    }

    return keyBytes + valBytes;
  }

  _remove(node) {
    if (!node || node === this.head || node === this.tail) {
      return;
    }
    if (node.prev) node.prev.next = node.next;
    if (node.next) node.next.prev = node.prev;
    node.prev = null;
    node.next = null;
    this.size = Math.max(0, this.size - 1);
  }

  _add(node) {
    if (!node || node === this.head || node === this.tail) {
      return;
    }
    node.next = this.head.next;
    node.prev = this.head;
    this.head.next.prev = node;
    this.head.next = node;
    this.size++;
  }

  get(key) {
    if (!this.map.has(key)) {
      this.misses++;
      return null;
    }
    const node = this.map.get(key);
    node.lastAccessed = Date.now();
    this._remove(node);
    this._add(node); // Move to head (most recently used)
    this.hits++;
    return node.value;
  }

  put(key, value) {
    const itemBytes = this._calculateItemBytes(key, value);

    // Reject items larger than individual size budget
    if (itemBytes > this.maxItemBytes) {
      return null;
    }

    if (this.map.has(key)) {
      const existingNode = this.map.get(key);
      this.currentBytes = Math.max(0, this.currentBytes - existingNode.size + itemBytes);
      existingNode.value = value;
      existingNode.size = itemBytes;
      existingNode.lastAccessed = Date.now();
      this._remove(existingNode);
      this._add(existingNode);
      this._enforceMemoryBounds();
      return existingNode;
    }

    // New item: make room if needed
    while (
      (this.map.size >= this.maxEntries || (this.currentBytes + itemBytes > this.maxBytes)) &&
      this.tail.prev !== this.head
    ) {
      const lru = this.tail.prev;
      this.currentBytes = Math.max(0, this.currentBytes - lru.size);
      this._remove(lru);
      this.map.delete(lru.key);
      this.evictions++;
    }

    const newNode = new Node(key, value, itemBytes);
    newNode.lastAccessed = Date.now();
    this._add(newNode);
    this.map.set(key, newNode);
    this.currentBytes += itemBytes;
    return newNode;
  }

  _enforceMemoryBounds() {
    while (this.currentBytes > this.maxBytes && this.tail.prev !== this.head) {
      const lru = this.tail.prev;
      this.currentBytes = Math.max(0, this.currentBytes - lru.size);
      this._remove(lru);
      this.map.delete(lru.key);
      this.evictions++;
    }
  }

  delete(key) {
    if (!this.map.has(key)) return false;
    const node = this.map.get(key);
    this.currentBytes = Math.max(0, this.currentBytes - node.size);
    this._remove(node);
    this.map.delete(key);
    return true;
  }

  clear() {
    this.map.clear();
    this.size = 0;
    this.currentBytes = 0;
    this.head.next = this.tail;
    this.tail.prev = this.head;
  }

  has(key) {
    return this.map.has(key);
  }

  getAllItems() {
    const items = [];
    let node = this.head.next;
    while (node && node !== this.tail) {
      items.push({
        key: node.key,
        value: node.value,
        size: node.size,
        lastAccessed: node.lastAccessed
      });
      node = node.next;
    }
    return items;
  }
}

module.exports = LRUCache;
