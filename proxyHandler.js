const cluster = require("cluster");
const cacheManager = require("./cacheManager");
const { isCacheableMethod } = require("./httpUtils");
const { validateTargetDestination } = require("./security");
const { forwardRequestStream, fetchUpstreamResponse } = require("./upstreamClient");
const { ALLOW_PRIVATE_IP, MAX_ITEM_BYTES } = require("./config");

async function handleRequest(clientReq, clientRes) {
  if (clientReq.url === "/favicon.ico") {
    clientRes.writeHead(204, { "Content-Type": "image/x-icon" });
    clientRes.end();
    return;
  }

  let targetUrl;
  const rawPath = clientReq.url.startsWith("/") ? clientReq.url.slice(1) : clientReq.url;

  if (rawPath.startsWith("http://") || rawPath.startsWith("https://")) {
    targetUrl = rawPath;
  } else {
    const hasDomain = /\.|localhost|:\d+/.test(rawPath.split("/")[0]);
    if (hasDomain && rawPath) {
      targetUrl = `http://${rawPath}`;
    } else {
      clientRes.writeHead(400, { "Content-Type": "application/json" });
      clientRes.end(JSON.stringify({
        error: "Bad Request",
        message: "Provide a valid target URL (e.g., /http://example.com or /example.com)"
      }));
      return;
    }
  }

  // 1. SSRF and Destination Validation
  let validated;
  try {
    validated = await validateTargetDestination(targetUrl, ALLOW_PRIVATE_IP);
  } catch (err) {
    clientRes.writeHead(403, { "Content-Type": "application/json" });
    clientRes.end(JSON.stringify({
      error: "Forbidden",
      message: "SSRF Policy Violation: " + err.message
    }));
    return;
  }

  const { parsedUrl, targetIP } = validated;
  const cacheKey = `${parsedUrl.origin}${parsedUrl.pathname}${parsedUrl.search}`;
  const isCacheable = isCacheableMethod(clientReq.method);

  // Common response metadata headers
  const stats = cacheManager.getQuickStats();
  const extraHeaders = {
    "X-Worker-PID": String(process.pid),
    "X-Cache-Size": String(stats.size),
    "X-Cache-Hits": String(stats.hits),
    "X-Cache-Misses": String(stats.misses)
  };
  if (cluster && cluster.worker && typeof cluster.worker.id !== "undefined") {
    extraHeaders["X-Worker-ID"] = String(cluster.worker.id);
  }

  // 2. Cache HIT Evaluation (Safe methods only)
  if (isCacheable) {
    const cachedEntry = await cacheManager.get(cacheKey);
    if (cachedEntry) {
      extraHeaders["X-Cache"] = "HIT";

      if (cachedEntry && typeof cachedEntry === "object" && cachedEntry.data) {
        const preservedHeaders = { ...(cachedEntry.headers || {}) };
        delete preservedHeaders["connection"];
        delete preservedHeaders["keep-alive"];
        delete preservedHeaders["transfer-encoding"];

        Object.assign(preservedHeaders, extraHeaders);
        clientRes.writeHead(cachedEntry.statusCode || 200, preservedHeaders);
        clientRes.end(cachedEntry.data);
      } else {
        extraHeaders["Content-Type"] = "text/html";
        clientRes.writeHead(200, extraHeaders);
        clientRes.end(cachedEntry);
      }
      return;
    }
  }

  // 3. Cache MISS with Single-Flight Stampede Coalescing
  try {
    if (isCacheable) {
      const upstreamResult = await cacheManager.singleFlight.do(cacheKey, async () => {
        // Double check cache in case a previous coalesced request populated it
        const entry = await cacheManager.get(cacheKey);
        if (entry) return entry;

        const fetched = await fetchUpstreamResponse(clientReq, parsedUrl, targetIP);
        if (fetched.statusCode === 200 && fetched.buffer.length <= MAX_ITEM_BYTES) {
          await cacheManager.put(cacheKey, {
            data: fetched.buffer,
            headers: fetched.headers,
            statusCode: fetched.statusCode,
            size: fetched.buffer.length
          });
        }
        return {
          data: fetched.buffer,
          headers: fetched.headers,
          statusCode: fetched.statusCode
        };
      });

      const responseHeaders = { ...(upstreamResult.headers || {}) };
      delete responseHeaders["connection"];
      delete responseHeaders["keep-alive"];
      delete responseHeaders["transfer-encoding"];

      extraHeaders["X-Cache"] = "MISS";
      Object.assign(responseHeaders, extraHeaders);

      clientRes.writeHead(upstreamResult.statusCode || 200, responseHeaders);
      clientRes.end(upstreamResult.data);
    } else {
      // Non-idempotent methods (POST, PUT, DELETE) stream directly to upstream
      extraHeaders["X-Cache"] = "BYPASS";
      await forwardRequestStream(clientReq, clientRes, parsedUrl, targetIP, extraHeaders);
    }
  } catch (err) {
    if (!clientRes.headersSent) {
      const isTimeout = err.message && err.message.includes("timed out");
      const statusCode = isTimeout ? 504 : 502;
      clientRes.writeHead(statusCode, { "Content-Type": "application/json" });
      clientRes.end(JSON.stringify({
        error: isTimeout ? "Gateway Timeout" : "Bad Gateway",
        message: err.message
      }));
    }
  }
}

module.exports = handleRequest;
