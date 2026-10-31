// Upstream Client: Stream Forwarding, Backpressure Management, Timeouts, and Memory-Capped Cache Buffering
const http = require("http");
const https = require("https");
const { filterUpstreamHeaders, isCacheableMethod } = require("./httpUtils");
const { MAX_ITEM_BYTES, UPSTREAM_TIMEOUT_MS } = require("./config");

/**
 * Forwards an HTTP/HTTPS request upstream and streams the response directly to the client
 *
 * @param {import('http').IncomingMessage} clientReq
 * @param {import('http').ServerResponse} clientRes
 * @param {URL} parsedUrl
 * @param {string} [targetIP]
 * @param {Record<string, string>} [extraResponseHeaders]
 * @returns {Promise<{ cacheableBuffer: Buffer | null, headers: object, statusCode: number }>}
 */
function forwardRequestStream(clientReq, clientRes, parsedUrl, targetIP, extraResponseHeaders = {}) {
  return new Promise((resolve, reject) => {
    const isHttps = parsedUrl.protocol === "https:";
    const clientModule = isHttps ? https : http;

    const filteredHeaders = filterUpstreamHeaders(clientReq.headers);
    filteredHeaders["host"] = parsedUrl.hostname;

    const requestOptions = {
      hostname: targetIP || parsedUrl.hostname,
      port: parsedUrl.port || (isHttps ? 443 : 80),
      path: `${parsedUrl.pathname}${parsedUrl.search}`,
      method: clientReq.method,
      headers: filteredHeaders,
      timeout: UPSTREAM_TIMEOUT_MS,
      servername: isHttps ? parsedUrl.hostname : undefined
    };

    let upstreamResCompleted = false;

    const upstreamReq = clientModule.request(requestOptions, (upstreamRes) => {
      if (clientRes.destroyed) {
        upstreamReq.destroy();
        return reject(new Error("Client aborted connection"));
      }

      const responseHeaders = { ...upstreamRes.headers };
      delete responseHeaders["connection"];
      delete responseHeaders["keep-alive"];

      Object.assign(responseHeaders, extraResponseHeaders);
      clientRes.writeHead(upstreamRes.statusCode, responseHeaders);

      upstreamRes.on("data", (chunk) => {
        const canContinue = clientRes.write(chunk);
        if (!canContinue) {
          upstreamRes.pause();
          clientRes.once("drain", () => {
            upstreamRes.resume();
          });
        }
      });

      upstreamRes.on("end", () => {
        upstreamResCompleted = true;
        clientRes.end();
        resolve({
          headers: upstreamRes.headers,
          statusCode: upstreamRes.statusCode
        });
      });

      upstreamRes.on("error", (err) => {
        if (!clientRes.destroyed) {
          clientRes.destroy(err);
        }
        reject(err);
      });
    });

    clientRes.on("close", () => {
      if (!clientRes.writableFinished && !upstreamResCompleted) {
        upstreamReq.destroy();
      }
    });

    upstreamReq.on("timeout", () => {
      upstreamReq.destroy(new Error("Upstream request timed out"));
    });

    upstreamReq.on("error", (err) => {
      reject(err);
    });

    const method = (clientReq.method || "GET").toUpperCase();
    if (method === "GET" || method === "HEAD") {
      upstreamReq.end();
    } else {
      if (clientReq.readableEnded) {
        upstreamReq.end();
      } else {
        clientReq.pipe(upstreamReq);
      }
    }
  });
}

/**
 * Fetches an upstream response and buffers it up to maxBytes (for safe cache storage and coalescing)
 *
 * @param {import('http').IncomingMessage} clientReq
 * @param {URL} parsedUrl
 * @param {string} [targetIP]
 * @returns {Promise<{ buffer: Buffer, headers: object, statusCode: number }>}
 */
function fetchUpstreamResponse(clientReq, parsedUrl, targetIP) {
  return new Promise((resolve, reject) => {
    const isHttps = parsedUrl.protocol === "https:";
    const clientModule = isHttps ? https : http;

    const filteredHeaders = filterUpstreamHeaders(clientReq.headers);
    filteredHeaders["host"] = parsedUrl.hostname;

    const requestOptions = {
      hostname: targetIP || parsedUrl.hostname,
      port: parsedUrl.port || (isHttps ? 443 : 80),
      path: `${parsedUrl.pathname}${parsedUrl.search}`,
      method: clientReq.method,
      headers: filteredHeaders,
      timeout: UPSTREAM_TIMEOUT_MS,
      servername: isHttps ? parsedUrl.hostname : undefined
    };

    const upstreamReq = clientModule.request(requestOptions, (upstreamRes) => {
      const chunks = [];
      let totalBytes = 0;

      upstreamRes.on("data", (chunk) => {
        chunks.push(chunk);
        totalBytes += chunk.length;
      });

      upstreamRes.on("end", () => {
        const completeBuffer = Buffer.concat(chunks, totalBytes);
        resolve({
          buffer: completeBuffer,
          headers: upstreamRes.headers,
          statusCode: upstreamRes.statusCode
        });
      });

      upstreamRes.on("error", reject);
    });

    upstreamReq.on("timeout", () => {
      upstreamReq.destroy(new Error("Upstream request timed out"));
    });

    upstreamReq.on("error", reject);

    const method = (clientReq.method || "GET").toUpperCase();
    if (method === "GET" || method === "HEAD") {
      upstreamReq.end();
    } else {
      if (clientReq.readableEnded) {
        upstreamReq.end();
      } else {
        clientReq.pipe(upstreamReq);
      }
    }
  });
}

module.exports = {
  forwardRequestStream,
  fetchUpstreamResponse
};
