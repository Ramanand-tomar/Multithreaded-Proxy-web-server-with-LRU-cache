const { describe, it } = require("node:test");
const assert = require("node:assert");
const {
  filterUpstreamHeaders,
  isCacheableMethod,
  normalizePath,
  HOP_BY_HOP_HEADERS
} = require("../../httpUtils");

describe("HTTP Utilities & Standards Compliance", () => {
  it("should strip standard hop-by-hop headers per RFC 7230", () => {
    const rawHeaders = {
      connection: "keep-alive, x-custom-hop",
      "keep-alive": "timeout=5",
      "proxy-authenticate": "Basic",
      "proxy-authorization": "Bearer token",
      te: "trailers",
      trailer: "Expires",
      "transfer-encoding": "chunked",
      upgrade: "websocket",
      host: "original.host",
      "x-custom-hop": "strip-me",
      "x-regular-header": "keep-me",
      "content-type": "application/json"
    };

    const filtered = filterUpstreamHeaders(rawHeaders);

    assert.strictEqual(filtered["x-regular-header"], "keep-me");
    assert.strictEqual(filtered["content-type"], "application/json");
    assert.strictEqual(filtered["connection"], undefined);
    assert.strictEqual(filtered["keep-alive"], undefined);
    assert.strictEqual(filtered["proxy-authenticate"], undefined);
    assert.strictEqual(filtered["proxy-authorization"], undefined);
    assert.strictEqual(filtered["transfer-encoding"], undefined);
    assert.strictEqual(filtered["upgrade"], undefined);
    assert.strictEqual(filtered["x-custom-hop"], undefined);
  });

  it("should identify cacheable vs non-cacheable HTTP methods per RFC 9111", () => {
    assert.strictEqual(isCacheableMethod("GET"), true);
    assert.strictEqual(isCacheableMethod("get"), true);
    assert.strictEqual(isCacheableMethod("HEAD"), true);

    // Non-cacheable mutations
    assert.strictEqual(isCacheableMethod("POST"), false);
    assert.strictEqual(isCacheableMethod("PUT"), false);
    assert.strictEqual(isCacheableMethod("DELETE"), false);
    assert.strictEqual(isCacheableMethod("PATCH"), false);
    assert.strictEqual(isCacheableMethod("OPTIONS"), false);
  });

  it("should normalize paths with trailing slashes", () => {
    assert.strictEqual(normalizePath("/dashboard/"), "/dashboard");
    assert.strictEqual(normalizePath("/dashboard///"), "/dashboard");
    assert.strictEqual(normalizePath("/api/cache-status/"), "/api/cache-status");
    assert.strictEqual(normalizePath("/"), "/");
    assert.strictEqual(normalizePath(""), "/");
  });
});

