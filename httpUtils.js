// HTTP and caching specification utilities (RFC 7230, RFC 9111)

const HOP_BY_HOP_HEADERS = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
  "host" // Will be recomputed for upstream
]);

const CACHEABLE_METHODS = new Set(["GET", "HEAD"]);

/**
 * Filter hop-by-hop headers and connection-listed headers before proxying
 * @param {import('http').IncomingHttpHeaders} rawHeaders
 * @returns {Record<string, string | string[]>}
 */
function filterUpstreamHeaders(rawHeaders) {
  const filtered = {};
  const connectionHeader = rawHeaders["connection"];
  const connectionTokens = new Set();

  if (typeof connectionHeader === "string") {
    connectionHeader.split(",").forEach((token) => {
      const trimmed = token.trim().toLowerCase();
      if (trimmed) connectionTokens.add(trimmed);
    });
  }

  for (const [key, value] of Object.entries(rawHeaders)) {
    const lowerKey = key.toLowerCase();
    if (
      !HOP_BY_HOP_HEADERS.has(lowerKey) &&
      !connectionTokens.has(lowerKey) &&
      lowerKey !== "accept-encoding" // Let upstream return plain or handled encoding
    ) {
      filtered[key] = value;
    }
  }

  return filtered;
}

/**
 * Check if the HTTP method is eligible for caching under RFC 9111
 * @param {string} method
 * @returns {boolean}
 */
function isCacheableMethod(method) {
  return CACHEABLE_METHODS.has((method || "").toUpperCase());
}

/**
 * Normalize requested URL path to prevent routing mismatches
 * e.g. "/dashboard/" -> "/dashboard", "/api/cache-status/" -> "/api/cache-status"
 * @param {string} rawUrl
 * @returns {string}
 */
function normalizePath(rawUrl) {
  if (!rawUrl) return "/";
  const [pathOnly] = rawUrl.split("?");
  const trimmed = pathOnly.replace(/\/+$/, "");
  return trimmed === "" ? "/" : trimmed;
}

module.exports = {
  HOP_BY_HOP_HEADERS,
  CACHEABLE_METHODS,
  filterUpstreamHeaders,
  isCacheableMethod,
  normalizePath
};

