class Node {
  constructor(key, value) {
    this.key = key;
    this.value = value;
    this.prev = null;
    this.next = null;
    this.lastAccessed = Date.now();
  }
}

class LRUCache {
  constructor(limit) {
    this.limit = limit;
    this.size = 0;
    this.map = new Map();
    this.head = new Node(null, null); // dummy head
    this.tail = new Node(null, null); // dummy tail
    this.head.next = this.tail;
    this.tail.prev = this.head;
    
    // Add hit/miss tracking for dashboard
    this.hits = 0;
    this.misses = 0;
  }

  _remove(node) {
    node.prev.next = node.next;
    node.next.prev = node.prev;
    this.size--;
  }

  _add(node) {
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
    this._add(node); // move to front (most recently used)
    this.hits++;
    return node.value;
  }

  put(key, value) {
    if (this.map.has(key)) {
      // Update existing item
      const existingNode = this.map.get(key);
      existingNode.value = value;
      existingNode.lastAccessed = Date.now();
      this._remove(existingNode);
      this._add(existingNode);
    } else {
      // Add new item
      if (this.map.size >= this.limit) {
        const lru = this.tail.prev;
        this._remove(lru);
        this.map.delete(lru.key);
      }
      const newNode = new Node(key, value);
      newNode.lastAccessed = Date.now();
      this._add(newNode);
      this.map.set(key, newNode);
    }
  }

  // Debug method to get all items
  getAllItems() {
    const items = [];
    let node = this.head.next;
    while (node && node !== this.tail) {
      items.push({
        key: node.key,
        value: node.value,
        lastAccessed: node.lastAccessed
      });
      node = node.next;
    }
    return items;
  }
}

module.exports = LRUCache;