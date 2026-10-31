process.env.NODE_ENV = "test";
const { describe, it, before, after } = require("node:test");
const assert = require("node:assert");
const http = require("http");
const handleRequest = require("../../proxyHandler");
const cacheManager = require("../../cacheManager");

describe("Streaming Backpressure & Bounded Buffering Integration Tests", () => {
  let upstreamServer;
  let proxyServer;
  let upstreamPort;
  let proxyPort;
  let requestsHandled = 0;

  before(async () => {
    await cacheManager.clear();

    upstreamServer = http.createServer((req, res) => {
      requestsHandled++;
      if (req.url === "/large-stream") {
        // Stream 6 chunks of 1MB each = 6MB (exceeds default 5MB cache limit)
        const chunk1MB = Buffer.alloc(1024 * 1024, 0x41);
        res.writeHead(200, { "Content-Type": "application/octet-stream" });
        for (let i = 0; i < 6; i++) {
          res.write(chunk1MB);
        }
        res.end();
        return;
      }

      if (req.url === "/slow-coalesce") {
        setTimeout(() => {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ requestNum: requestsHandled }));
        }, 80);
        return;
      }

      res.writeHead(404);
      res.end();
    });

    await new Promise((resolve) => upstreamServer.listen(0, resolve));
    upstreamPort = upstreamServer.address().port;

    proxyServer = http.createServer(async (req, res) => {
      await handleRequest(req, res);
    });

    await new Promise((resolve) => proxyServer.listen(0, resolve));
    proxyPort = proxyServer.address().port;
  });

  after(async () => {
    await new Promise((resolve) => proxyServer.close(resolve));
    await new Promise((resolve) => upstreamServer.close(resolve));
  });

  it("should stream payloads exceeding cache size limits to client without caching them", async () => {
    const targetUrl = `http://127.0.0.1:${upstreamPort}/large-stream`;

    const res = await fetch(`http://127.0.0.1:${proxyPort}/${targetUrl}`);
    assert.strictEqual(res.status, 200);

    const buffer = Buffer.from(await res.arrayBuffer());
    assert.strictEqual(buffer.length, 6 * 1024 * 1024); // 6 MB received cleanly

    // Verify it was NOT stored in the cache (protects from OOM!)
    const cached = await cacheManager.get(`http://127.0.0.1:${upstreamPort}/large-stream`);
    assert.strictEqual(cached, null);
  });

  it("should coalesce concurrent cache misses using single-flight stampede protection", async () => {
    const targetUrl = `http://127.0.0.1:${upstreamPort}/slow-coalesce`;
    const initialHits = requestsHandled;

    // Send 4 concurrent requests for the slow uncached endpoint
    const promises = [
      fetch(`http://127.0.0.1:${proxyPort}/${targetUrl}`).then((r) => r.json()),
      fetch(`http://127.0.0.1:${proxyPort}/${targetUrl}`).then((r) => r.json()),
      fetch(`http://127.0.0.1:${proxyPort}/${targetUrl}`).then((r) => r.json()),
      fetch(`http://127.0.0.1:${proxyPort}/${targetUrl}`).then((r) => r.json())
    ];

    const results = await Promise.all(promises);

    // Upstream should have received only 1 request despite 4 clients requesting concurrently!
    const upstreamDelta = requestsHandled - initialHits;
    assert.strictEqual(upstreamDelta, 1);

    // All clients received the valid response
    results.forEach((r) => {
      assert.ok(r.requestNum !== undefined);
    });
  });
});

