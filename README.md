# Multithreaded Proxy Web Server with LRU Cache

Repo: https://github.com/Ramanand-tomar/Multithreaded-Proxy-web-server-with-LRU-cache

Overview
--------
This project is a lightweight, multi-process HTTP proxy server built with Node.js. It uses the Node.js `cluster` module to run a worker per CPU core, and implements an in-memory LRU (Least Recently Used) cache to reduce repeated upstream requests. A dashboard served by the same server provides real‑time visibility into cache contents, cache statistics (size, hit/miss ratio, memory estimate), and worker status (busy/available, request counts, last handler).

What this project does
----------------------
- Accepts HTTP(S) proxy requests, supports both full-URLs (e.g. `/http://example.com/path`) and domain shorthand (e.g. `/example.com/path`).
- Forwards requests to target hosts, streams responses back to clients.
- Caches successful (HTTP 200) responses in an in-memory LRU cache.
- Exposes a dashboard (UI) for monitoring cache contents and worker status.
- Exposes small REST APIs for cache stats, clearing cache, and worker status (master runs a status server on PORT+1).

Complete feature list
---------------------
- Multi-process proxy (one worker per CPU) using Node.js `cluster`.
- Shared LRU cache accessible via `cacheManager` module.
- LRU implemented with a doubly linked list + HashMap (O(1) get/put/evict).
- Cache statistics: size, configured limit, hit/miss counts, hit ratio, estimated memory usage and per-item sizes.
- Dashboard UI:
  - LRU items visualized (most recent first), sizes, age, and quick actions (view/delete).
  - Cache progress bar, hit ratio, memory usage.
  - Worker list with status (busy/available), request counts and PID; highlights last handler.
  - Test-proxy form and quick test URLs (JSONPlaceholder).
- Response metadata headers: `X-Cache`, `X-Worker-PID`, `X-Worker-ID`, `X-Cache-Size`, `X-Cache-Hits`, `X-Cache-Misses`.
- APIs:
  - GET `/api/cache-status`
  - POST `/api/clear-cache`
  - GET `/api/workers-status` (served from master on PORT+1)
  - Additional optional endpoints for single cache item (view/delete) are referenced in UI and can be added.

![Flowchart of Multi-threaded Proxy Server](public/Gemini_Generated_Image_p0ae7pp0ae7pp0ae.png)

How it works internally (architecture & data flow)
--------------------------------------------------
1. Master process
   - Starts and forks N worker processes (N = number of CPU cores by default).
   - Maintains worker metadata (status, requests, pid) updated via worker messages (`process.send`).
   - Runs a small status server on PORT+1 to return all workers' info to the dashboard.

2. Worker processes
   - Each worker runs an HTTP server that:
     - Serves dashboard static assets (`index.html`, `dashboard.js`, `dashboard.css`).
     - Handles `/api/*` dashboard routes by calling `cacheManager` (which wraps the shared LRU instance in this process).
     - Processes proxy requests: parses incoming path, determines target URL, checks cache, and either serves cached response or streams request to upstream server.
   - Sends status updates to master when it becomes busy/available and increments request counts.

3. Proxy path handling
   - If request path starts with `/http` or contains a domain-like token, worker builds the target URL.
   - For cached responses:
     - `cacheManager.get(key)` returns cached body string (if exists) and updates cache hit counters.
     - Worker sends response headers and body to client immediately.
   - For uncached responses:
     - Worker forwards the request to the upstream (http/https).
     - Streams data from upstream and buffers response body to cache (only if statusCode === 200).
     - After response end, `cacheManager.put(key, body)` stores it and the dashboard updates.

LRU cache — data structures & operations
----------------------------------------
- Map (hashmap) for O(1) key → node lookup.
- Doubly linked list for LRU ordering:
  - Head: most recently used; Tail: least recently used.
  - On `get`: move node to head; on `put` of existing key: update value and move to head.
  - On `put` of new key when limit reached: evict tail (least recently used).
- Each node holds: key, value (string), prev, next, lastAccessed timestamp.
- CacheManager tracks hits, misses, and maintains `getStats()` that traverses list (head→tail) to produce ordered keys, sizes, and estimated memory usage (key+value bytes + small structure overhead).

DSA and complexity considerations
--------------------------------
- get/put/evict are O(1) time — crucial for keeping proxy fast under load.
- Memory estimation uses `Buffer.byteLength` to approximate stored bytes.
- Balanced space/time trade-offs: counts-based limit (items) by default, can be extended to byte-size limit.
- Using messaging (master/worker) keeps state aggregation centralized and avoids race conditions across processes.

API & Response examples
-----------------------
- GET /api/cache-status
  - Returns:
    {
      size, limit, hitRatio, memoryUsage, totalBytes,
      hits, misses, totalRequests,
      keys: [{ key, size, lastAccessed }, ...]
    }
- POST /api/clear-cache
  - Clears cache, returns { success: true }.
- GET /api/workers-status (master, on PORT+1)
  - Returns: { workers: [{ id, pid, status, requests }, ...] }

Quick start
-----------
1. Clone:
   git clone https://github.com/Ramanand-tomar/Multithreaded-Proxy-web-server-with-LRU-cache
   cd "Multithreaded Server With LRU cache"

2. Install:
   npm install

3. Configure (optional):
   Edit `config.js` to change `PORT` and `CACHE_LIMIT`.

4. Run:
   npm start
   or
   node server.js

5. Open the dashboard:
   http://localhost:8080/dashboard  (default; see config PORT)
   Worker status: http://localhost:8081/api/workers-status

Usage examples
--------------
- Proxy a full URL:
  http://localhost:8080/http://jsonplaceholder.typicode.com/posts
- Proxy by domain shorthand:
  http://localhost:8080/jsonplaceholder.typicode.com/posts
- From dashboard: paste URL in Test Proxy box and submit — check X-Cache header to see HIT / MISS.

Testing & verification
----------------------
- First request to a URL: expect `X-Cache: MISS`, subsequent requests: `X-Cache: HIT`.
- Dashboard shows LRU items in most-recent-first order.
- Worker server on PORT+1 returns current workers info; dashboard polls it periodically.

Troubleshooting
---------------
- Dashboard opens blank / redirects: ensure root path `/` is served by worker and not forwarded to proxy (server routing handles this).
- Worker status API returns 404: confirm master status server is listening on `PORT + 1` and no other process occupies that port.
- Cache not filling: ensure proxied upstream returns 200 and response bodies are not streamed-only without buffering (proxyHandler buffers chunks and caches final body).

Security & production notes
---------------------------
- This project is intended as an educational / development tool. For production:
  - Add authentication and access control for the dashboard.
  - Sanitize and validate proxied URLs to avoid SSRF.
  - Add rate-limiting and input validation.
  - Consider persisting cache (Redis) and using WebSockets for dashboard updates.

Potential improvements
----------------------
- Byte-size based eviction (limit by total bytes not item count).
- TTL per entry & invalidation strategies.
- Persist cache to disk or external store (Redis).
- Replace dashboard polling with WebSocket push.
- Add Prometheus metrics, structured logs, and tracing.
- Add E2E tests and stress tests with tools like `wrk` or `k6`.

Project structure
-----------------
- server.js — master + worker bootstrapping and routing
- proxyHandler.js — proxy request handling and cache integration
- lruCache.js — LRU cache core implementation (Node class + list)
- cacheManager.js — shared cache instance + stats and utilities
- public/* — dashboard UI (index.html, dashboard.js, dashboard.css)
- routes/* — route helpers (optional)
- config.js — configuration (PORT, CACHE_LIMIT, TARGET_HOST)

License & contact
-----------------
License: MIT  
Repo: https://github.com/Ramanand-tomar/Multithreaded-Proxy-web-server-with-LRU-cache  
Author: Ramanand Tomar

References & learning
---------------------
- LRU cache patterns (hashmap + doubly linked list)
- Node.js cluster module and inter-process messaging
- Proxy streaming and header handling in Node.js HTTP/HTTPS modules
