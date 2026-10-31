const { describe, it } = require("node:test");
const assert = require("node:assert");
const { isPrivateIP, validateTargetDestination, RateLimiter } = require("../../security");

describe("Security Hardening & SSRF Protection", () => {
  describe("isPrivateIP", () => {
    it("should detect loopback IPv4 addresses", () => {
      assert.strictEqual(isPrivateIP("127.0.0.1"), true);
      assert.strictEqual(isPrivateIP("127.1.2.3"), true);
    });

    it("should detect private RFC 1918 subnets", () => {
      assert.strictEqual(isPrivateIP("10.0.0.1"), true);
      assert.strictEqual(isPrivateIP("10.254.254.254"), true);
      assert.strictEqual(isPrivateIP("172.16.0.1"), true);
      assert.strictEqual(isPrivateIP("172.31.255.255"), true);
      assert.strictEqual(isPrivateIP("192.168.1.1"), true);
      assert.strictEqual(isPrivateIP("192.168.100.50"), true);
    });

    it("should detect cloud metadata and link-local addresses", () => {
      assert.strictEqual(isPrivateIP("169.254.169.254"), true);
      assert.strictEqual(isPrivateIP("169.254.1.1"), true);
    });

    it("should allow public IPv4 addresses", () => {
      assert.strictEqual(isPrivateIP("8.8.8.8"), false);
      assert.strictEqual(isPrivateIP("1.1.1.1"), false);
      assert.strictEqual(isPrivateIP("142.250.190.46"), false);
    });

    it("should detect private and loopback IPv6 addresses", () => {
      assert.strictEqual(isPrivateIP("::1"), true);
      assert.strictEqual(isPrivateIP("fe80::1"), true);
      assert.strictEqual(isPrivateIP("fc00::1"), true);
      assert.strictEqual(isPrivateIP("fd12:3456:789a::1"), true);
    });

    it("should detect IPv4-mapped IPv6 private addresses", () => {
      assert.strictEqual(isPrivateIP("::ffff:127.0.0.1"), true);
      assert.strictEqual(isPrivateIP("::ffff:10.0.0.5"), true);
      assert.strictEqual(isPrivateIP("::ffff:8.8.8.8"), false);
    });
  });

  describe("validateTargetDestination", () => {
    it("should reject disallowed protocols (ftp, file, javascript)", async () => {
      await assert.rejects(
        async () => validateTargetDestination("ftp://example.com/file.txt"),
        /Disallowed protocol/
      );
      await assert.rejects(
        async () => validateTargetDestination("javascript:alert(1)"),
        /Disallowed protocol/
      );
    });

    it("should reject explicit loopback and metadata destinations", async () => {
      await assert.rejects(
        async () => validateTargetDestination("http://127.0.0.1:8080/admin"),
        /Direct connection to private\/loopback IP address/
      );
      await assert.rejects(
        async () => validateTargetDestination("http://169.254.169.254/latest/meta-data"),
        /Access to private host/
      );
      await assert.rejects(
        async () => validateTargetDestination("http://localhost:3000/"),
        /Access to private host/
      );
    });

    it("should accept valid public URLs", async () => {
      const result = await validateTargetDestination("https://example.com/api");
      assert.ok(result.parsedUrl);
      assert.strictEqual(result.parsedUrl.hostname, "example.com");
      assert.ok(result.targetIP);
    });
  });

  describe("RateLimiter", () => {
    it("should limit requests after threshold", () => {
      const limiter = new RateLimiter(3, 1000);
      assert.strictEqual(limiter.check("client1").allowed, true);
      assert.strictEqual(limiter.check("client1").allowed, true);
      assert.strictEqual(limiter.check("client1").allowed, true);
      assert.strictEqual(limiter.check("client1").allowed, false);
      assert.strictEqual(limiter.check("client2").allowed, true);
    });
  });
});

