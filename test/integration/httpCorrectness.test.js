process.env.NODE_ENV = "test";
const { describe, it, before, after } = require("node:test");
const assert = require("node:assert");
const http = require("http");
const handleRequest = require("../../proxyHandler");
const handleDashboardRoutes = require("../../routes/dashboard");
const cacheManager = require("../../cacheManager");

describe("HTTP Proxy & Caching Integration Tests", () => {
  let upstreamServer;
  let proxyServer;
  let upstreamPort;
  let proxyPort;
  let upstreamHits = 0;

  before(async () => {
    await cacheManager.clear();

    // Spawn a dummy upstream server
    upstreamServer = http.createServer((req, res) => {
      upstreamHits++;
      if (req.url === "/json-data") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ message: "hello world", count: upstreamHits }));
        return;
      }
      if (req.url === "/binary-data") {
        const dummyBinary = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0xff]);
        res.writeHead(200, { "Content-Type": "image/png" });
        res.end(dummyBinary);
        return;
      }
      if (req.url === "/mutate" && req.method === "POST") {
        res.writeHead(201, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ created: true, id: 99 }));
        return;
      }
      res.writeHead(404);
      res.end("Not Found");
    });

    await new Promise((resolve) => upstreamServer.listen(0, resolve));
    upstreamPort = upstreamServer.address().port;

    // Spawn proxy instance for testing
    proxyServer = http.createServer(async (req, res) => {
      const handled = await handleDashboardRoutes(req, res);
      if (!handled) {
        await handleRequest(req, res);
      }
    });

    await new Promise((resolve) => proxyServer.listen(0, resolve));
    proxyPort = proxyServer.address().port;
  });

  after(async () => {
    await new Promise((resolve) => proxyServer.close(resolve));
    await new Promise((resolve) => upstreamServer.close(resolve));
  });

  it("should serve Cache MISS on first request, and Cache HIT with accurate Content-Type on second request", async () => {
    const targetUrl = `http://127.0.0.1:${upstreamPort}/json-data`;

    // 1st request: Cache MISS
    const res1 = await fetch(`http://127.0.0.1:${proxyPort}/${targetUrl}`);
    assert.strictEqual(res1.status, 200);
    assert.strictEqual(res1.headers.get("x-cache"), "MISS");
    assert.strictEqual(res1.headers.get("content-type"), "application/json");
    const json1 = await res1.json();
    assert.strictEqual(json1.message, "hello world");

    // 2nd request: Cache HIT
    const res2 = await fetch(`http://127.0.0.1:${proxyPort}/${targetUrl}`);
    assert.strictEqual(res2.status, 200);
    assert.strictEqual(res2.headers.get("x-cache"), "HIT");
    assert.strictEqual(res2.headers.get("content-type"), "application/json");
    const json2 = await res2.json();
    assert.strictEqual(json2.count, json1.count); // Served from cache!
  });

  it("should preserve binary Buffer integrity without corrupting data via UTF-8 string conversion", async () => {
    const targetUrl = `http://127.0.0.1:${upstreamPort}/binary-data`;

    const res1 = await fetch(`http://127.0.0.1:${proxyPort}/${targetUrl}`);
    assert.strictEqual(res1.headers.get("content-type"), "image/png");
    const bytes1 = new Uint8Array(await res1.arrayBuffer());

    const res2 = await fetch(`http://127.0.0.1:${proxyPort}/${targetUrl}`);
    assert.strictEqual(res2.headers.get("x-cache"), "HIT");
    assert.strictEqual(res2.headers.get("content-type"), "image/png");
    const bytes2 = new Uint8Array(await res2.arrayBuffer());

    assert.deepStrictEqual(bytes1, bytes2);
    assert.strictEqual(bytes2[0], 0x89);
    assert.strictEqual(bytes2[1], 0x50);
  });

  it("should bypass caching on mutating methods (POST) and not return stale GET cache", async () => {
    const targetUrl = `http://127.0.0.1:${upstreamPort}/mutate`;

    const res = await fetch(`http://127.0.0.1:${proxyPort}/${targetUrl}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ item: "new" })
    });

    assert.strictEqual(res.status, 201);
    assert.strictEqual(res.headers.get("x-cache"), "BYPASS");
    const data = await res.json();
    assert.strictEqual(data.created, true);
  });

  it("should serve dashboard cleanly on trailing slash /dashboard/", async () => {
    const res = await fetch(`http://127.0.0.1:${proxyPort}/dashboard/`);
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.headers.get("content-type"), "text/html");
  });

  it("should return 400 Bad Request on malformed destination URLs without crashing", async () => {
    const res = await fetch(`http://127.0.0.1:${proxyPort}/invalid-non-domain-url`);
    assert.strictEqual(res.status, 400);
  });
});
