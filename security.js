// Security Hardening: SSRF Prevention, IP Filtering, DNS Rebinding Protection, and Rate Limiting
const dns = require("dns").promises;
const net = require("net");

const BLOCKED_HOSTNAMES = new Set([
  "localhost",
  "metadata.google.internal",
  "169.254.169.254"
]);

/**
 * Checks if an IP address belongs to private, loopback, link-local, or reserved blocks
 * @param {string} ip
 * @returns {boolean}
 */
function isPrivateIP(ip) {
  if (!ip) return true;

  // Handle IPv4-mapped IPv6 addresses (e.g. ::ffff:127.0.0.1)
  if (ip.startsWith("::ffff:") && ip.includes(".")) {
    ip = ip.replace("::ffff:", "");
  }

  if (net.isIPv4(ip)) {
    const parts = ip.split(".").map((n) => parseInt(n, 10));
    if (parts.length !== 4 || parts.some((p) => isNaN(p) || p < 0 || p > 255)) {
      return true;
    }

    const [a, b] = parts;
    return (
      a === 0 || // 0.0.0.0/8 Current network
      a === 10 || // 10.0.0.0/8 Private network
      a === 127 || // 127.0.0.0/8 Loopback
      (a === 100 && b >= 64 && b <= 127) || // 100.64.0.0/10 Carrier-grade NAT
      (a === 169 && b === 254) || // 169.254.0.0/16 Link-local / Cloud Metadata
      (a === 172 && b >= 16 && b <= 31) || // 172.16.0.0/12 Private network
      (a === 192 && b === 168) || // 192.168.0.0/16 Private network
      (a === 192 && b === 0 && parts[2] === 2) || // 192.0.2.0/24 Documentation (TEST-NET-1)
      (a === 198 && (b === 18 || b === 19)) || // 198.18.0.0/15 Benchmark testing
      (a === 198 && b === 51 && parts[2] === 100) || // 198.51.100.0/24 Documentation (TEST-NET-2)
      (a === 203 && b === 0 && parts[2] === 113) || // 203.0.113.0/24 Documentation (TEST-NET-3)
      a >= 224 // 224.0.0.0/4 Multicast & 240.0.0.0/4 Reserved
    );
  }

  if (net.isIPv6(ip)) {
    const normalized = ip.toLowerCase();
    return (
      normalized === "::1" || // Loopback
      normalized === "::" || // Unspecified
      normalized.startsWith("fe80:") || // Link-local
      /^f[cd][0-9a-f]{2}:/i.test(normalized) || // fc00::/7 Unique Local Address (ULA: fc00 - fdff)
      normalized.startsWith("ff") || // Multicast (ff00::/8)
      normalized.startsWith("2001:db8:") // Documentation
    );
  }

  return true;
}

/**
 * Validates a target URL against SSRF and DNS rebinding attacks
 * @param {string} rawUrl
 * @param {boolean} [allowPrivate=false]
 * @returns {Promise<{ parsedUrl: URL, targetIP: string }>}
 */
async function validateTargetDestination(rawUrl, allowPrivate = false) {
  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch (err) {
    throw new Error(`Invalid URL format: ${err.message}`);
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(`Disallowed protocol "${parsed.protocol}". Only HTTP and HTTPS are permitted.`);
  }

  const hostname = parsed.hostname.toLowerCase();

  if (!allowPrivate) {
    if (BLOCKED_HOSTNAMES.has(hostname) || hostname.endsWith(".internal") || hostname.endsWith(".local")) {
      throw new Error(`Access to private host "${hostname}" is blocked.`);
    }

    // Direct IP address in hostname
    if (net.isIP(hostname)) {
      if (isPrivateIP(hostname)) {
        throw new Error(`Direct connection to private/loopback IP address "${hostname}" is blocked.`);
      }
      return { parsedUrl: parsed, targetIP: hostname };
    }

    // Resolve DNS and check all returned IP addresses
    let records;
    try {
      records = await dns.lookup(hostname, { all: true });
    } catch (err) {
      throw new Error(`DNS resolution failed for host "${hostname}": ${err.message}`);
    }

    if (!records || records.length === 0) {
      throw new Error(`No DNS records found for host "${hostname}"`);
    }

    for (const record of records) {
      if (isPrivateIP(record.address)) {
        throw new Error(`Hostname "${hostname}" resolved to prohibited address ${record.address}`);
      }
    }

    return { parsedUrl: parsed, targetIP: records[0].address };
  }

  return { parsedUrl: parsed, targetIP: parsed.hostname };
}

/**
 * Simple in-memory sliding window rate limiter
 */
class RateLimiter {
  constructor(limit = 100, windowMs = 60000) {
    this.limit = limit;
    this.windowMs = windowMs;
    this.clients = new Map();
  }

  check(clientId) {
    const now = Date.now();
    let record = this.clients.get(clientId);

    if (!record || now - record.windowStart > this.windowMs) {
      record = { windowStart: now, count: 1 };
      this.clients.set(clientId, record);
      return { allowed: true, remaining: this.limit - 1 };
    }

    record.count++;
    if (record.count > this.limit) {
      return { allowed: false, remaining: 0 };
    }

    return { allowed: true, remaining: this.limit - record.count };
  }

  cleanup() {
    const now = Date.now();
    for (const [clientId, record] of this.clients.entries()) {
      if (now - record.windowStart > this.windowMs) {
        this.clients.delete(clientId);
      }
    }
  }
}

module.exports = {
  isPrivateIP,
  validateTargetDestination,
  RateLimiter
};
