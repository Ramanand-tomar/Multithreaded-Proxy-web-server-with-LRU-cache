// Single-Flight Request Coalescing (Cache Stampede Protection)
// Ensures that concurrent requests for the same resource trigger only one upstream fetch

class SingleFlight {
  constructor() {
    this.inFlight = new Map();
  }

  /**
   * Execute an async function once for a given key, sharing the in-flight promise with concurrent callers
   * @template T
   * @param {string} key
   * @param {() => Promise<T>} fn
   * @returns {Promise<T>}
   */
  async do(key, fn) {
    if (this.inFlight.has(key)) {
      return this.inFlight.get(key);
    }

    const promise = (async () => {
      try {
        return await fn();
      } finally {
        this.inFlight.delete(key);
      }
    })();

    this.inFlight.set(key, promise);
    return promise;
  }

  get pendingCount() {
    return this.inFlight.size;
  }
}

module.exports = SingleFlight;

