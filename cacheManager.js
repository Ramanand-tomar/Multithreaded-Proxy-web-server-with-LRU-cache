const LRUCache = require("./lruCache");
const { CACHE_LIMIT } = require("./config");

class CacheManager {
    constructor() {
        this.cache = new LRUCache(CACHE_LIMIT);
        this.stats = {
            hits: 0,
            misses: 0,
            totalRequests: 0
        };
    }

    get(key) {
        const value = this.cache.get(key);
        if (value !== null) {
            this.stats.hits++;
        } else {
            this.stats.misses++;
        }
        this.stats.totalRequests++;
        return value;
    }

    put(key, value) {
        const result = this.cache.put(key, value);
        return result;
    }

    getStats() {
        const keys = [];
        let totalBytes = 0;
        
        // Traverse the linked list to get all items in LRU order
        let node = this.cache.head.next;
        while (node && node !== this.cache.tail) {
            const keySize = Buffer.byteLength(node.key || '', 'utf8');
            const valueSize = Buffer.byteLength(node.value || '', 'utf8');
            const itemSize = keySize + valueSize;
            totalBytes += itemSize;
            
            keys.push({
                key: node.key,
                size: valueSize, // The size of the response body
                lastAccessed: node.lastAccessed || Date.now() // Use node's timestamp
            });
            
            node = node.next;
        }

        // Calculate memory usage and hit ratio
        const memoryUsageMB = totalBytes / (1024 * 1024);
        const hitRatio = this.stats.totalRequests > 0 ? 
            (this.stats.hits / this.stats.totalRequests * 100) : 0;

        return {
            size: this.cache.size, // Use actual cache size
            limit: this.cache.limit,
            hitRatio: hitRatio.toFixed(1),
            memoryUsage: memoryUsageMB.toFixed(2),
            totalBytes: totalBytes,
            hits: this.stats.hits,
            misses: this.stats.misses,
            totalRequests: this.stats.totalRequests,
            keys: keys // Already in LRU order from head to tail
        };
    }

    getCache() {
        return this.cache;
    }

    clear() {
        this.cache.map.clear();
        this.cache.size = 0;
        this.cache.head.next = this.cache.tail;
        this.cache.tail.prev = this.cache.head;
        this.cache.hits = 0;
        this.cache.misses = 0;
        this.stats = { hits: 0, misses: 0, totalRequests: 0 };
    }
}

module.exports = new CacheManager();