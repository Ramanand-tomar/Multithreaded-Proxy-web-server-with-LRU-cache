# Multithreaded Proxy Web Server with LRU Cache

[![Node.js CI](https://img.shields.io/badge/Node.js-v22+-green.svg)](https://nodejs.org)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Tests: 30 Passed](https://img.shields.io/badge/Tests-30%20Passed-success.svg)](test/)

A high-concurrency, security-hardened, production-grade HTTP/HTTPS reverse and forward proxy server built on Node.js. Features multi-process clustering with an authoritative IPC-coordinated LRU cache, single-flight stampede protection, dual-bounded memory management, SSRF defense, streaming with backpressure control, and a real-time monitoring dashboard.

---

## Architecture Flowchart

![Flowchart of Multi-threaded Proxy Server](public/Gemini_Generated_Image_p0ae7pp0ae7pp0ae.png)

---

## Key Architectural Highlights

- **Centralized Master Cache over IPC:** Eliminates worker cache split-brain. The cluster master process acts as the single source of truth for cache storage and eviction, responding to asynchronous IPC requests from worker processes.
- **Dual-Bounded LRU Engine:** Bounded by both maximum entry count (`CACHE_LIMIT`) and total byte consumption (`MAX_CACHE_BYTES`). Large payloads exceeding `MAX_ITEM_BYTES` automatically bypass caching to prevent cache exhaustion.
- **Single-Flight Request Coalescing:** Eliminates cache stampedes (thundering herd). Concurrent requests for identical uncached URLs coalesce onto a single upstream network call.
- **SSRF Defense Shield:** DNS pre-resolution and validation blocks private IP ranges (RFC 1918, RFC 3927 link-local, RFC 4193 IPv6 ULA, cloud metadata `169.254.169.254`, and loopback).
- **Zero-Corruption Streaming Pipeline:** True binary-safe Node.js streams preserve exact byte lengths, gzip/brotli compression payloads, and image/media data with backpressure control.
- **Worker Crash Resilience:** Automatic supervision loop detects worker crashes and restarts failed workers with exponential backoff and circuit-breaking.
- **Single-Port Cloud Deployment Ready:** Dual-mode telemetry serves worker status via standard `/api/workers-status` on the primary HTTP port (ideal for Render, Railway, Heroku) as well as a dedicated internal telemetry port.
- **XSS-Hardened Modern Dashboard:** Responsive UI with Dark/Light theme toggle, interactive proxy testing sandbox, real-time KPI metrics, and LRU cache explorer built using native DOM construction with `textContent` and event listeners.

---

## System Architecture

```
                                  +-------------------------------------------------------------+
                                  |                 Master Process (Supervisor)                 |
                                  |  - Process Supervisor & Crash Resiliency Loop               |
                                  |  - Authoritative Dual-Bounded LRU Cache (Memory-Aware)     |
                                  |  - IPC Cache Protocol Dispatcher (GET/PUT/DEL/STATS)        |
                                  |  - Worker Status Registry (/api/workers-status)             |
                                  +-------------------------------------------------------------+
                                                 /              |              \
                                     IPC Channel/               |               \IPC Channel
                                               v                v                v
                       +-------------------------------+ +-------------------------------+
                       |        Worker Process 1       | |        Worker Process N       |
                       | - Primary Port (Load balanced)| | - Primary Port (Load balanced)|
                       | - Single-Flight Stampede Guard| | - Single-Flight Stampede Guard|
                       | - SSRF & Destination Validator| | - SSRF & Destination Validator|
                       | - Bounded Stream Forwarder    | | - Bounded Stream Forwarder    |
                       | - Dashboard & REST Router     | | - Dashboard & REST Router     |
                       +-------------------------------+ +-------------------------------+
```

For complete technical diagrams and data flow specifications, see [ARCHITECTURE.md](ARCHITECTURE.md).  
For the detailed threat model and defensive controls, see [SECURITY.md](SECURITY.md).  
For benchmarks and algorithmic complexity tables, see [PERFORMANCE.md](PERFORMANCE.md).  

---

## Configuration (`config.js`)

All parameters support environment variable overrides:

| Variable | Default | Description |
| :--- | :--- | :--- |
| `PORT` | `8080` | Proxy server & dashboard HTTP port |
| `STATUS_PORT` | `8081` | Master worker status telemetry port |
| `CACHE_LIMIT` | `50` | Maximum number of items in LRU cache |
| `MAX_CACHE_BYTES` | `104857600` | Maximum cumulative cache memory budget (100 MiB) |
| `MAX_ITEM_BYTES` | `5242880` | Maximum individual cache item size (5 MiB) |
| `UPSTREAM_TIMEOUT_MS` | `15000` | Upstream connection timeout (15 seconds) |
| `WORKER_COUNT` | `0` | Number of worker processes (0 = all CPU cores) |
| `ALLOW_PRIVATE_IP` | `false` | When true, permits connections to loopback/private IPs (used in tests) |

---

## Quick Start

### 1. Installation
```bash
git clone https://github.com/Ramanand-tomar/Multithreaded-Proxy-web-server-with-LRU-cache.git
cd "Multihtreaded Server With LRU cache"
npm install
```

### 2. Run Automated Test Suite
Zero external testing dependencies — uses Node.js native test runner:
```bash
npm test
```

### 3. Start the Server
```bash
# Production mode
npm start

# Development mode (with auto-reload)
npm run dev
```

### 4. Open the Web Dashboard
Navigate to `http://localhost:8080/` or `http://localhost:8080/dashboard`.

---

## API Endpoints

### Proxy Usage
```bash
# Proxy an external HTTP/HTTPS resource
curl -i http://localhost:8080/https://jsonplaceholder.typicode.com/posts/1

# Check proxy metadata response headers
# X-Cache: HIT | MISS | BYPASS
# X-Worker-PID: <PID>
# X-Cache-Size: <Current Cache Count>
# X-Cache-Hits: <Total Hits>
# X-Cache-Misses: <Total Misses>
```

### Administrative Endpoints
- `GET /api/cache-status` — Returns authoritative cache statistics (hit ratio, memory in MB, keys).
- `POST /api/clear-cache` — Purges the centralized cache across all cluster processes.
- `GET /api/cache-item?key=<URL>` — Inspects individual cache entry metadata.
- `DELETE /api/cache-item?key=<URL>` — Evicts a specific key from the cache.
- `GET /api/workers-status` — Returns worker process status, PID, and request counters.

---

## Automated Test Coverage

```
TAP version 13
✔ Streaming Backpressure & Bounded Buffering Integration Tests (2 tests)
✔ HTTP Proxy & Caching Integration Tests (5 tests)
✔ HTTP Utilities & Standards Compliance (3 tests)
✔ LRU Cache Implementation (6 tests)
✔ LRU Cache Byte-Aware Eviction & Limits (2 tests)
✔ Security Hardening & SSRF Protection (10 tests)
✔ SingleFlight Request Coalescing (2 tests)

30 tests passed, 0 failures.
```

---

## License

This project is licensed under the [MIT License](LICENSE).
