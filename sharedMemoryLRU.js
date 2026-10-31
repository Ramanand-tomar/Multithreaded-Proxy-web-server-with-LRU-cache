// SharedMemoryLRU: Zero-Copy Shared-Memory LRU Cache using SharedArrayBuffer and Atomics
// Enables high-throughput, lock-synchronized multithreaded caching across worker_threads.

const { isMainThread } = require("node:worker_threads");

// 32-bit FNV-1a non-cryptographic fast hash for O(1) slot candidate matching
function fnv1a(str) {
  let hash = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash | 0;
}

// Mutex lock implemented with Atomics.compareExchange, Atomics.wait, and Atomics.notify
class SharedMutex {
  constructor(int32View, lockIndex = 0) {
    this.view = int32View;
    this.index = lockIndex;
    this.isWorker = !isMainThread;
  }

  // Synchronous lock: ideal for worker threads
  lockSync(timeoutMs = 5000) {
    const startTime = Date.now();
    while (true) {
      if (Atomics.compareExchange(this.view, this.index, 0, 1) === 0) {
        return true;
      }
      if (Date.now() - startTime > timeoutMs) {
        // Deadlock defense: auto self-healing
        Atomics.store(this.view, this.index, 0);
        return false;
      }
      if (this.isWorker) {
        Atomics.wait(this.view, this.index, 1, 10);
      } else {
        const start = Date.now();
        while (Date.now() - start < 1) {}
      }
    }
  }

  // Universal asynchronous lock: non-blocking on both main thread and workers
  async lockAsync(timeoutMs = 5000) {
    const startTime = Date.now();
    while (true) {
      if (Atomics.compareExchange(this.view, this.index, 0, 1) === 0) {
        return true;
      }
      if (Date.now() - startTime > timeoutMs) {
        Atomics.store(this.view, this.index, 0);
        return false;
      }
      if (typeof Atomics.waitAsync === "function") {
        const res = Atomics.waitAsync(this.view, this.index, 1, 10);
        if (res.async) {
          await res.value;
        }
      } else {
        await new Promise((r) => setImmediate(r));
      }
    }
  }

  unlock() {
    if (Atomics.compareExchange(this.view, this.index, 1, 0) === 1) {
      Atomics.notify(this.view, this.index, 1);
      return true;
    }
    return false;
  }
}

// Memory Layout Constants (32-bit words / 4-byte boundaries)
const HDR_LOCK = 0;              // 0 = unlocked, 1 = locked
const HDR_SIZE = 1;              // Current active entries count
const HDR_CAPACITY = 2;          // Max entries
const HDR_HEAD = 3;              // MRU slot index (-1 if empty)
const HDR_TAIL = 4;              // LRU slot index (-1 if empty)
const HDR_HITS = 5;              // Hit counter
const HDR_MISSES = 6;            // Miss counter
const HDR_EVICTIONS = 7;         // Eviction counter
const HDR_ARENA_OFFSET = 8;      // Byte offset where data arena begins
const HDR_ARENA_SIZE = 9;        // Data arena size in bytes
const HDR_ARENA_ALLOC_PTR = 10;  // Current allocation bump pointer in arena
const HDR_TOTAL_BYTES = 11;      // Total bytes currently stored in arena
const HDR_MAX_TOTAL_BYTES = 12;  // Maximum allowed bytes across all entries
const HDR_FREE_HEAD = 13;        // Head of unused slot indices list
const HDR_MAGIC = 14;            // Magic signature 0x534D4C55 ("SMLU")
const HDR_VERSION = 15;          // Version (1)

const HEADER_WORDS = 16;
const HEADER_BYTES = HEADER_WORDS * 4; // 64 bytes

// Slot Layout (16 Int32 words = 64 bytes per slot)
const SLOT_WORDS = 16;
const SLOT_BYTES = SLOT_WORDS * 4;

const SLOT_STATE = 0;            // 0 = Free, 1 = Active
const SLOT_PREV = 1;             // Previous slot index in LRU linked list (-1 if head)
const SLOT_NEXT = 2;             // Next slot index in LRU linked list (-1 if tail)
const SLOT_FREE_NEXT = 3;        // Next free slot in free list
const SLOT_ACCESSED_LO = 4;      // Last accessed epoch ms (low 32 bits)
const SLOT_ACCESSED_HI = 5;      // Last accessed epoch ms (high 32 bits)
const SLOT_KEY_OFF = 6;          // Offset in data arena
const SLOT_KEY_LEN = 7;          // Length of key in bytes
const SLOT_DATA_OFF = 8;         // Offset in data arena
const SLOT_DATA_LEN = 9;         // Length of data buffer
const SLOT_HDRS_OFF = 10;        // Offset in data arena
const SLOT_HDRS_LEN = 11;        // Length of headers JSON
const SLOT_STATUS = 12;          // HTTP status code
const SLOT_TOTAL_BYTES = 13;     // Key + Data + Headers length
const SLOT_KEY_HASH = 14;        // FNV-1a 32-bit hash of key

class SharedMemoryLRU {
  /**
   * @param {Object} options
   * @param {SharedArrayBuffer} [options.sharedBuffer] - Existing SharedArrayBuffer to attach to
   * @param {number} [options.maxEntries=50] - Maximum entry count
   * @param {number} [options.bufferSizeBytes=20971520] - Total buffer size (default 20MB)
   * @param {number} [options.maxBytes=10485760] - Maximum cache payload bytes budget (10MB)
   * @param {number} [options.maxItemBytes=5242880] - Maximum single item size (5MB)
   */
  constructor(options = {}) {
    const maxEntries = options.maxEntries || 50;
    const totalBufferSize = options.bufferSizeBytes || 20 * 1024 * 1024; // 20 MB
    this.maxItemBytes = options.maxItemBytes || 5 * 1024 * 1024;

    if (options.sharedBuffer && options.sharedBuffer instanceof SharedArrayBuffer) {
      this.sab = options.sharedBuffer;
      this.int32 = new Int32Array(this.sab);
      this.uint8 = new Uint8Array(this.sab);
      this.mutex = new SharedMutex(this.int32, HDR_LOCK);
    } else {
      this.sab = new SharedArrayBuffer(totalBufferSize);
      this.int32 = new Int32Array(this.sab);
      this.uint8 = new Uint8Array(this.sab);
      this.mutex = new SharedMutex(this.int32, HDR_LOCK);

      this._initializeBuffer(maxEntries, totalBufferSize, options.maxBytes || 10 * 1024 * 1024);
    }

    this.capacity = this.int32[HDR_CAPACITY];
    this.arenaOffset = this.int32[HDR_ARENA_OFFSET];
    this.arenaSize = this.int32[HDR_ARENA_SIZE];
  }

  _initializeBuffer(maxEntries, totalBufferSize, maxBytes) {
    const slotsBytes = maxEntries * SLOT_BYTES;
    const arenaOffset = HEADER_BYTES + slotsBytes;
    const arenaSize = totalBufferSize - arenaOffset;

    // Initialize Header
    this.int32[HDR_LOCK] = 0;
    this.int32[HDR_SIZE] = 0;
    this.int32[HDR_CAPACITY] = maxEntries;
    this.int32[HDR_HEAD] = -1;
    this.int32[HDR_TAIL] = -1;
    this.int32[HDR_HITS] = 0;
    this.int32[HDR_MISSES] = 0;
    this.int32[HDR_EVICTIONS] = 0;
    this.int32[HDR_ARENA_OFFSET] = arenaOffset;
    this.int32[HDR_ARENA_SIZE] = arenaSize;
    this.int32[HDR_ARENA_ALLOC_PTR] = 0;
    this.int32[HDR_TOTAL_BYTES] = 0;
    this.int32[HDR_MAX_TOTAL_BYTES] = maxBytes;
    this.int32[HDR_FREE_HEAD] = 0;
    this.int32[HDR_MAGIC] = 0x534d4c55; // "SMLU"
    this.int32[HDR_VERSION] = 1;

    // Initialize Free Slots Linked List
    for (let i = 0; i < maxEntries; i++) {
      const slotWordBase = HEADER_WORDS + i * SLOT_WORDS;
      this.int32[slotWordBase + SLOT_STATE] = 0; // Free
      this.int32[slotWordBase + SLOT_PREV] = -1;
      this.int32[slotWordBase + SLOT_NEXT] = -1;
      this.int32[slotWordBase + SLOT_FREE_NEXT] = i < maxEntries - 1 ? i + 1 : -1;
      this.int32[slotWordBase + SLOT_TOTAL_BYTES] = 0;
    }
  }

  getSharedBuffer() {
    return this.sab;
  }

  // Helper to get slot word index
  _slotBase(slotIdx) {
    return HEADER_WORDS + slotIdx * SLOT_WORDS;
  }

  // Find slot matching key
  _findSlot(key, keyHash) {
    const keyBuf = Buffer.from(key, "utf8");
    const keyLen = keyBuf.length;

    let curr = this.int32[HDR_HEAD];
    while (curr !== -1) {
      const base = this._slotBase(curr);
      if (this.int32[base + SLOT_STATE] === 1 &&
          this.int32[base + SLOT_KEY_HASH] === keyHash &&
          this.int32[base + SLOT_KEY_LEN] === keyLen) {
        
        // Exact byte verification
        const keyOffset = this.arenaOffset + this.int32[base + SLOT_KEY_OFF];
        const storedKeyBuf = Buffer.from(this.sab, keyOffset, keyLen);
        if (keyBuf.equals(storedKeyBuf)) {
          return curr;
        }
      }
      curr = this.int32[base + SLOT_NEXT];
    }
    return -1;
  }

  // Move active slot to head (MRU)
  _moveToHead(slotIdx) {
    const head = this.int32[HDR_HEAD];
    if (head === slotIdx) return; // Already at head

    const base = this._slotBase(slotIdx);
    const prev = this.int32[base + SLOT_PREV];
    const next = this.int32[base + SLOT_NEXT];

    // Unlink
    if (prev !== -1) {
      this.int32[this._slotBase(prev) + SLOT_NEXT] = next;
    }
    if (next !== -1) {
      this.int32[this._slotBase(next) + SLOT_PREV] = prev;
    }
    if (this.int32[HDR_TAIL] === slotIdx) {
      this.int32[HDR_TAIL] = prev;
    }

    // Attach at head
    this.int32[base + SLOT_PREV] = -1;
    this.int32[base + SLOT_NEXT] = head;
    if (head !== -1) {
      this.int32[this._slotBase(head) + SLOT_PREV] = slotIdx;
    }
    this.int32[HDR_HEAD] = slotIdx;

    if (this.int32[HDR_TAIL] === -1) {
      this.int32[HDR_TAIL] = slotIdx;
    }
  }

  // Evict least recently used slot (tail)
  _evictTail() {
    const tail = this.int32[HDR_TAIL];
    if (tail === -1) return -1;

    const base = this._slotBase(tail);
    const prev = this.int32[base + SLOT_PREV];
    const entryBytes = this.int32[base + SLOT_TOTAL_BYTES];

    // Unlink tail
    if (prev !== -1) {
      this.int32[this._slotBase(prev) + SLOT_NEXT] = -1;
      this.int32[HDR_TAIL] = prev;
    } else {
      this.int32[HDR_HEAD] = -1;
      this.int32[HDR_TAIL] = -1;
    }

    // Reset slot state
    this.int32[base + SLOT_STATE] = 0; // Free
    this.int32[base + SLOT_PREV] = -1;
    this.int32[base + SLOT_NEXT] = -1;
    this.int32[base + SLOT_FREE_NEXT] = this.int32[HDR_FREE_HEAD];
    this.int32[HDR_FREE_HEAD] = tail;

    this.int32[HDR_SIZE] = Math.max(0, this.int32[HDR_SIZE] - 1);
    this.int32[HDR_TOTAL_BYTES] = Math.max(0, this.int32[HDR_TOTAL_BYTES] - entryBytes);
    this.int32[HDR_EVICTIONS] = this.int32[HDR_EVICTIONS] + 1;

    return tail;
  }

  // Defragment / compact active entries in arena
  _compactArena() {
    let newAllocPtr = 0;
    const tempBuffer = Buffer.alloc(this.arenaSize);

    let curr = this.int32[HDR_HEAD];
    while (curr !== -1) {
      const base = this._slotBase(curr);
      const keyLen = this.int32[base + SLOT_KEY_LEN];
      const dataLen = this.int32[base + SLOT_DATA_LEN];
      const hdrsLen = this.int32[base + SLOT_HDRS_LEN];

      const oldKeyOff = this.arenaOffset + this.int32[base + SLOT_KEY_OFF];
      const oldDataOff = this.arenaOffset + this.int32[base + SLOT_DATA_OFF];
      const oldHdrsOff = this.arenaOffset + this.int32[base + SLOT_HDRS_OFF];

      // Copy key
      tempBuffer.set(this.uint8.subarray(oldKeyOff, oldKeyOff + keyLen), newAllocPtr);
      this.int32[base + SLOT_KEY_OFF] = newAllocPtr;
      newAllocPtr += keyLen;

      // Copy data
      if (dataLen > 0) {
        tempBuffer.set(this.uint8.subarray(oldDataOff, oldDataOff + dataLen), newAllocPtr);
        this.int32[base + SLOT_DATA_OFF] = newAllocPtr;
        newAllocPtr += dataLen;
      }

      // Copy headers
      if (hdrsLen > 0) {
        tempBuffer.set(this.uint8.subarray(oldHdrsOff, oldHdrsOff + hdrsLen), newAllocPtr);
        this.int32[base + SLOT_HDRS_OFF] = newAllocPtr;
        newAllocPtr += hdrsLen;
      }

      curr = this.int32[base + SLOT_NEXT];
    }

    // Write back compacted arena
    this.uint8.set(tempBuffer.subarray(0, newAllocPtr), this.arenaOffset);
    this.int32[HDR_ARENA_ALLOC_PTR] = newAllocPtr;
  }

  /**
   * Get cached entry by key
   * @param {string} key
   * @returns {Object|null}
   */
  get(key) {
    if (!key || typeof key !== "string") return null;
    const keyHash = fnv1a(key);

    this.mutex.lockSync();
    try {
      const slotIdx = this._findSlot(key, keyHash);
      if (slotIdx === -1) {
        this.int32[HDR_MISSES] = this.int32[HDR_MISSES] + 1;
        return null;
      }

      // Cache HIT: Move to head
      this._moveToHead(slotIdx);
      const base = this._slotBase(slotIdx);

      // Update timestamp
      const now = Date.now();
      this.int32[base + SLOT_ACCESSED_LO] = now & 0xffffffff;
      this.int32[base + SLOT_ACCESSED_HI] = Math.floor(now / 0x100000000);
      this.int32[HDR_HITS] = this.int32[HDR_HITS] + 1;

      // Extract payload
      const dataLen = this.int32[base + SLOT_DATA_LEN];
      const dataOff = this.arenaOffset + this.int32[base + SLOT_DATA_OFF];
      const data = dataLen > 0 ? Buffer.from(this.sab.slice(dataOff, dataOff + dataLen)) : Buffer.alloc(0);

      const hdrsLen = this.int32[base + SLOT_HDRS_LEN];
      let headers = {};
      if (hdrsLen > 0) {
        const hdrsOff = this.arenaOffset + this.int32[base + SLOT_HDRS_OFF];
        const hdrsStr = Buffer.from(this.sab, hdrsOff, hdrsLen).toString("utf8");
        try { headers = JSON.parse(hdrsStr); } catch (_) {}
      }

      const statusCode = this.int32[base + SLOT_STATUS] || 200;
      const size = this.int32[base + SLOT_TOTAL_BYTES];

      return {
        data,
        headers,
        statusCode,
        size,
        lastAccessed: now
      };
    } finally {
      this.mutex.unlock();
    }
  }

  /**
   * Put or update entry in cache
   * @param {string} key
   * @param {Object} entry
   * @returns {boolean}
   */
  put(key, entry) {
    if (!key || typeof key !== "string" || !entry) return false;

    const dataBuf = Buffer.isBuffer(entry.data)
      ? entry.data
      : (typeof entry.data === "string" ? Buffer.from(entry.data, "utf8") : Buffer.alloc(0));

    const hdrsStr = JSON.stringify(entry.headers || {});
    const hdrsBuf = Buffer.from(hdrsStr, "utf8");
    const keyBuf = Buffer.from(key, "utf8");

    const totalEntryBytes = keyBuf.length + dataBuf.length + hdrsBuf.length;
    if (totalEntryBytes > this.maxItemBytes) {
      return false; // Item exceeds threshold, bypass
    }

    const keyHash = fnv1a(key);
    this.mutex.lockSync();
    try {
      // Check if existing
      const existingSlot = this._findSlot(key, keyHash);
      if (existingSlot !== -1) {
        this._moveToHead(existingSlot);
        return true; // Simplified: Keep existing or update
      }

      // Check entry limit & memory budget: Evict LRU tail until fits
      while (this.int32[HDR_SIZE] >= this.int32[HDR_CAPACITY]) {
        if (this._evictTail() === -1) break;
      }

      while (this.int32[HDR_TOTAL_BYTES] + totalEntryBytes > this.int32[HDR_MAX_TOTAL_BYTES] && this.int32[HDR_SIZE] > 0) {
        if (this._evictTail() === -1) break;
      }

      // Check arena space
      if (this.int32[HDR_ARENA_ALLOC_PTR] + totalEntryBytes > this.arenaSize) {
        this._compactArena();
        while (this.int32[HDR_ARENA_ALLOC_PTR] + totalEntryBytes > this.arenaSize && this.int32[HDR_SIZE] > 0) {
          if (this._evictTail() === -1) break;
          this._compactArena();
        }
      }

      if (this.int32[HDR_ARENA_ALLOC_PTR] + totalEntryBytes > this.arenaSize) {
        return false; // Cannot fit even after full compaction
      }

      // Allocate slot
      const slotIdx = this.int32[HDR_FREE_HEAD];
      if (slotIdx === -1) return false;

      const base = this._slotBase(slotIdx);
      this.int32[HDR_FREE_HEAD] = this.int32[base + SLOT_FREE_NEXT];

      // Write into Arena
      let allocPtr = this.int32[HDR_ARENA_ALLOC_PTR];

      // 1. Write Key
      const keyOffset = allocPtr;
      this.uint8.set(keyBuf, this.arenaOffset + keyOffset);
      allocPtr += keyBuf.length;

      // 2. Write Data
      const dataOffset = allocPtr;
      if (dataBuf.length > 0) {
        this.uint8.set(dataBuf, this.arenaOffset + dataOffset);
        allocPtr += dataBuf.length;
      }

      // 3. Write Headers
      const hdrsOffset = allocPtr;
      if (hdrsBuf.length > 0) {
        this.uint8.set(hdrsBuf, this.arenaOffset + hdrsOffset);
        allocPtr += hdrsBuf.length;
      }

      this.int32[HDR_ARENA_ALLOC_PTR] = allocPtr;

      // Populate Slot Descriptor
      const now = Date.now();
      this.int32[base + SLOT_STATE] = 1; // Active
      this.int32[base + SLOT_PREV] = -1;
      this.int32[base + SLOT_NEXT] = -1;
      this.int32[base + SLOT_ACCESSED_LO] = now & 0xffffffff;
      this.int32[base + SLOT_ACCESSED_HI] = Math.floor(now / 0x100000000);
      this.int32[base + SLOT_KEY_OFF] = keyOffset;
      this.int32[base + SLOT_KEY_LEN] = keyBuf.length;
      this.int32[base + SLOT_DATA_OFF] = dataOffset;
      this.int32[base + SLOT_DATA_LEN] = dataBuf.length;
      this.int32[base + SLOT_HDRS_OFF] = hdrsOffset;
      this.int32[base + SLOT_HDRS_LEN] = hdrsBuf.length;
      this.int32[base + SLOT_STATUS] = entry.statusCode || 200;
      this.int32[base + SLOT_TOTAL_BYTES] = totalEntryBytes;
      this.int32[base + SLOT_KEY_HASH] = keyHash;

      // Link to Head
      const head = this.int32[HDR_HEAD];
      this.int32[base + SLOT_NEXT] = head;
      if (head !== -1) {
        this.int32[this._slotBase(head) + SLOT_PREV] = slotIdx;
      }
      this.int32[HDR_HEAD] = slotIdx;
      if (this.int32[HDR_TAIL] === -1) {
        this.int32[HDR_TAIL] = slotIdx;
      }

      this.int32[HDR_SIZE] = this.int32[HDR_SIZE] + 1;
      this.int32[HDR_TOTAL_BYTES] = this.int32[HDR_TOTAL_BYTES] + totalEntryBytes;

      return true;
    } finally {
      this.mutex.unlock();
    }
  }

  delete(key) {
    if (!key || typeof key !== "string") return false;
    const keyHash = fnv1a(key);

    this.mutex.lockSync();
    try {
      const slotIdx = this._findSlot(key, keyHash);
      if (slotIdx === -1) return false;

      const base = this._slotBase(slotIdx);
      const prev = this.int32[base + SLOT_PREV];
      const next = this.int32[base + SLOT_NEXT];
      const entryBytes = this.int32[base + SLOT_TOTAL_BYTES];

      if (prev !== -1) {
        this.int32[this._slotBase(prev) + SLOT_NEXT] = next;
      } else {
        this.int32[HDR_HEAD] = next;
      }

      if (next !== -1) {
        this.int32[this._slotBase(next) + SLOT_PREV] = prev;
      } else {
        this.int32[HDR_TAIL] = prev;
      }

      this.int32[base + SLOT_STATE] = 0;
      this.int32[base + SLOT_FREE_NEXT] = this.int32[HDR_FREE_HEAD];
      this.int32[HDR_FREE_HEAD] = slotIdx;

      this.int32[HDR_SIZE] = Math.max(0, this.int32[HDR_SIZE] - 1);
      this.int32[HDR_TOTAL_BYTES] = Math.max(0, this.int32[HDR_TOTAL_BYTES] - entryBytes);

      return true;
    } finally {
      this.mutex.unlock();
    }
  }

  clear() {
    this.mutex.lockSync();
    try {
      const maxEntries = this.int32[HDR_CAPACITY];
      this.int32[HDR_SIZE] = 0;
      this.int32[HDR_HEAD] = -1;
      this.int32[HDR_TAIL] = -1;
      this.int32[HDR_ARENA_ALLOC_PTR] = 0;
      this.int32[HDR_TOTAL_BYTES] = 0;
      this.int32[HDR_FREE_HEAD] = 0;

      for (let i = 0; i < maxEntries; i++) {
        const base = this._slotBase(i);
        this.int32[base + SLOT_STATE] = 0;
        this.int32[base + SLOT_PREV] = -1;
        this.int32[base + SLOT_NEXT] = -1;
        this.int32[base + SLOT_FREE_NEXT] = i < maxEntries - 1 ? i + 1 : -1;
        this.int32[base + SLOT_TOTAL_BYTES] = 0;
      }
    } finally {
      this.mutex.unlock();
    }
  }

  getStats() {
    this.mutex.lockSync();
    try {
      const keys = [];
      let curr = this.int32[HDR_HEAD];

      while (curr !== -1) {
        const base = this._slotBase(curr);
        const keyLen = this.int32[base + SLOT_KEY_LEN];
        const keyOff = this.arenaOffset + this.int32[base + SLOT_KEY_OFF];
        const key = Buffer.from(this.sab, keyOff, keyLen).toString("utf8");
        const size = this.int32[base + SLOT_TOTAL_BYTES];
        const lo = this.int32[base + SLOT_ACCESSED_LO] >>> 0;
        const hi = this.int32[base + SLOT_ACCESSED_HI] >>> 0;
        const lastAccessed = hi * 0x100000000 + lo;

        keys.push({ key, size, lastAccessed });
        curr = this.int32[base + SLOT_NEXT];
      }

      const size = this.int32[HDR_SIZE];
      const limit = this.int32[HDR_CAPACITY];
      const hits = this.int32[HDR_HITS];
      const misses = this.int32[HDR_MISSES];
      const evictions = this.int32[HDR_EVICTIONS];
      const totalBytes = this.int32[HDR_TOTAL_BYTES];
      const totalRequests = hits + misses;
      const hitRatio = totalRequests > 0 ? ((hits / totalRequests) * 100).toFixed(1) : "0.0";
      const memoryUsage = (totalBytes / (1024 * 1024)).toFixed(2);

      return {
        size,
        limit,
        hitRatio,
        memoryUsage,
        totalBytes,
        hits,
        misses,
        evictions,
        totalRequests,
        keys
      };
    } finally {
      this.mutex.unlock();
    }
  }
}

module.exports = {
  SharedMemoryLRU,
  SharedMutex,
  fnv1a
};
