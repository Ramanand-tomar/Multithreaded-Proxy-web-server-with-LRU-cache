const http = require("http");
const https = require("https");
const url = require("url");
const cluster = require("cluster");
const cacheManager = require("./cacheManager");

// Use the shared cache instance
const cache = cacheManager;

function handleRequest(clientReq, clientRes) {
  // Skip favicon for proxy requests (already handled in server.js for dashboard)
  if (clientReq.url === "/favicon.ico") {
    clientRes.writeHead(204, { "Content-Type": "image/x-icon" });
    clientRes.end();
    return;
  }

  console.log(`Original URL: ${clientReq.url}`);
  
  let targetUrl;
  const cleanUrl = clientReq.url.startsWith("/") ? clientReq.url.slice(1) : clientReq.url;
  
  // Check if it's a full URL
  if (cleanUrl.startsWith("http://") || cleanUrl.startsWith("https://")) {
    targetUrl = cleanUrl;
  } else {
    // Check if it looks like a domain (contains dot or known TLD)
    const hasDomain = /\.|localhost|:\d+/.test(cleanUrl.split("/")[0]);
    if (hasDomain && cleanUrl) {
      targetUrl = `http://${cleanUrl}`;
    } else {
      // No default target host: reject ambiguous paths
      clientRes.writeHead(400, { "Content-Type": "text/plain" });
      clientRes.end("Bad Request: provide a full URL (http/https) or a domain, e.g., /http://example.com or /example.com");
      return;
    }
  }

  const parsed = url.parse(targetUrl);
  const cacheKey = targetUrl;

  console.log(`Proxying to: ${targetUrl}`);
  console.log(`Cache size: ${cache.getCache().size}`);

  // Check cache - use shared cache instance
  const cachedResponse = cache.get(cacheKey);
  if (cachedResponse) {
    console.log(`Serving from cache: ${cacheKey}`);
    // Expose cache and worker info headers
    try {
      clientRes.setHeader('X-Cache', 'HIT');
      clientRes.setHeader('X-Worker-PID', String(process.pid));
      if (cluster && cluster.worker && typeof cluster.worker.id !== 'undefined') {
        clientRes.setHeader('X-Worker-ID', String(cluster.worker.id));
      }
      const stats = cache.getStats();
      clientRes.setHeader('X-Cache-Size', String(stats.size));
      clientRes.setHeader('X-Cache-Hits', String(stats.hits));
      clientRes.setHeader('X-Cache-Misses', String(stats.misses));
    } catch (e) {}
    clientRes.writeHead(200, { "Content-Type": "text/html" });
    clientRes.end(cachedResponse);
    return;
  }

  // Choose http or https module based on protocol
  const proxyModule = parsed.protocol === "https:" ? https : http;
  
  const options = {
    hostname: parsed.hostname,
    port: parsed.port || (parsed.protocol === "https:" ? 443 : 80),
    path: parsed.path || "/",
    method: clientReq.method,
    headers: {
      ...clientReq.headers,
      host: parsed.hostname,
    },
  };

  // Remove headers that shouldn't be forwarded
  delete options.headers["accept-encoding"];

  const proxy = proxyModule.request(options, (res) => {
    let body = Buffer.from("");

    // Collect response headers for caching
    const responseHeaders = { ...res.headers };
    
    res.on("data", (chunk) => {
      body = Buffer.concat([body, chunk]);
    });

    res.on("end", () => {
      const responseBody = body.toString();
      
      // Only cache successful responses
      if (res.statusCode === 200) {
        cache.put(cacheKey, responseBody);
        console.log(`Cached response for: ${cacheKey}`);
      }

      // Send headers and response to client
      try {
        const stats = cache.getStats();
        responseHeaders['X-Cache'] = res.statusCode === 200 ? 'MISS' : 'BYPASS';
        responseHeaders['X-Worker-PID'] = String(process.pid);
        if (cluster && cluster.worker && typeof cluster.worker.id !== 'undefined') {
          responseHeaders['X-Worker-ID'] = String(cluster.worker.id);
        }
        responseHeaders['X-Cache-Size'] = String(stats.size);
        responseHeaders['X-Cache-Hits'] = String(stats.hits);
        responseHeaders['X-Cache-Misses'] = String(stats.misses);
      } catch (e) {}
      clientRes.writeHead(res.statusCode, responseHeaders);
      clientRes.end(body);
      
      console.log(`Proxied response completed for: ${cacheKey}`);
    });
  });

  proxy.on("error", (err) => {
    console.error("Proxy error:", err.message);
    clientRes.writeHead(500);
    clientRes.end("Internal Proxy Error");
  });

  // Forward client request body
  clientReq.pipe(proxy);
}

module.exports = handleRequest;