# Security Policy & Hardening Specifications

**System:** Multithreaded Proxy Web Server with LRU Cache  
**Scope:** Threat Model, Defensive Remediations, Network Boundaries, and Operational Safeguards  

---

## 1. Threat Model & Mitigation Matrix

| Threat Category | Potential Attack Vector | Defensive Mitigation | Implementation |
| :--- | :--- | :--- | :--- |
| **Server-Side Request Forgery (SSRF)** | Attacker requests AWS metadata (`169.254.169.254`), internal microservices (`10.0.0.0/8`, `192.168.0.0/16`), or loopback admin interfaces (`127.0.0.1`). | DNS pre-resolution and strict IP blocklisting (IPv4 private, loopback, link-local, multicast, documentation; IPv6 ULA, loopback, link-local). | `security.js`: `isPrivateIP()`, `validateTargetDestination()` |
| **DNS Rebinding** | Attacker configures DNS hostname to resolve initially to public IP, then switches to internal IP (`127.0.0.1`) upon connection. | Direct connection to resolved and validated IP address while transmitting original `Host` header. | `upstreamClient.js` connects via validated IP |
| **Stored / Reflected DOM XSS** | Attacker submits crafted URL containing quotes or script tags, rendered in the admin dashboard. | Complete elimination of `innerHTML` and inline `onclick` string interpolation. Native DOM node construction with `textContent` and `addEventListener`. | `public/dashboard.js`: `updateCacheItems()` |
| **Denial of Service (OOM Crash)** | Attacker requests massive gigabyte payloads (ISOs, videos) forcing proxy to buffer entire stream in heap memory. | Bounded buffering capped at `MAX_ITEM_BYTES` (5 MB default). Oversized payloads stream to client but bypass cache. Direct streaming backpressure. | `upstreamClient.js`: `forwardRequestStream()` |
| **Cache Poisoning / Method Smuggling** | Attacker executes `POST` or `DELETE` through proxy, expecting response to poison subsequent `GET` requests for other users. | Strict method gating per RFC 9111. Caching restricted exclusively to safe, idempotent methods (`GET`, `HEAD`). Mutations bypass cache. | `httpUtils.js`: `isCacheableMethod()`, `proxyHandler.js` |
| **Credential & Secret Leakage** | Hardcoded API keys or credentials in codebase or version control. | Complete removal of hardcoded tokens. Strict environment variable configuration via `.env` with `.gitignore` enforcement. | `config.js` |
| **HTTP Request Smuggling** | Client passes conflicting `Connection`, `Transfer-Encoding`, or hop-by-hop headers. | Strict RFC 7230 hop-by-hop header removal before upstream forwarding. | `httpUtils.js`: `filterUpstreamHeaders()` |
| **Cluster Crash Loop (Fork Bomb)** | Rapid sequential worker crashes exhaust system PID limits and CPU. | Master supervisor circuit breaker: pauses restarts if $\ge 5$ crashes occur within 15 seconds. | `workerManager.js` |

---

## 2. Blocked Network Ranges (SSRF Filter)

The destination validator in `security.js` strictly prohibits all egress to:

### IPv4 Prohibited Ranges:
- `0.0.0.0/8` — Current network
- `10.0.0.0/8` — Private network (RFC 1918)
- `100.64.0.0/10` — Carrier-grade NAT (RFC 6598)
- `127.0.0.0/8` — Loopback
- `169.254.0.0/16` — Link-local / Cloud Metadata (AWS, GCP, Azure, OpenStack)
- `172.16.0.0/12` — Private network (RFC 1918)
- `192.168.0.0/16` — Private network (RFC 1918)
- `192.0.2.0/24`, `198.51.100.0/24`, `203.0.113.0/24` — Documentation blocks (TEST-NET)
- `198.18.0.0/15` — Benchmarking
- `224.0.0.0/4` — Multicast
- `240.0.0.0/4` — Reserved / Future use

### IPv6 Prohibited Ranges:
- `::1` — Loopback
- `::` — Unspecified
- `fe80::/10` — Link-local
- `fc00::/7` (`fc00` to `fdff`) — Unique Local Address (ULA)
- `ff00::/8` — Multicast
- `::ffff:0:0/96` — IPv4-mapped IPv6 addresses (unwrapped and verified against IPv4 rules)

---

## 3. Operational Security Recommendations

1. **Production Deployment:**
   - Always run behind a TLS reverse proxy (e.g. Nginx, Cloudflare, AWS ALB) for terminating client TLS.
   - Deploy as an unprivileged system user (`nobody` or non-root container user).
2. **Access Control:**
   - In production environments, restrict access to the `/dashboard` and `/api/*` endpoints to authenticated internal operators via reverse proxy HTTP Basic Auth or VPN.

