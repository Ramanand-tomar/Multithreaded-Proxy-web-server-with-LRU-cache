const cluster = require("cluster");
const http = require("http");
const os = require("os");
const fs = require("fs");
const path = require("path");
const handleRequest = require("./proxyHandler");
const cacheManager = require("./cacheManager");
// const { PORT } = require("./config");
const PORT = 8080;

// Simple routing system
function handleRoutes(req, res) {
    const url = req.url;
    const method = req.method;

    // Set common headers
    res.setHeader('Access-Control-Allow-Origin', '*');

    console.log(`Request received: ${method} ${url}`);

    // Route handling - Dashboard and static files first
    if (url === '/' || url === '/index.html' || url === '/dashboard') {
        // Serve dashboard HTML
        const filePath = path.join(__dirname, 'public', 'index.html');
        fs.readFile(filePath, (err, data) => {
            if (err) {
                console.log('Dashboard HTML not found, serving default');
                res.writeHead(200, { 'Content-Type': 'text/html' });
                res.end(`
                    <html>
                        <head><title>Proxy Dashboard</title></head>
                        <body>
                            <h1>Proxy Server Dashboard</h1>
                            <p>Dashboard is running on worker ${process.pid}</p>
                            <p><a href="/api/cache-status">View Cache Status</a></p>
                        </body>
                    </html>
                `);
                return;
            }
            res.writeHead(200, { 'Content-Type': 'text/html' });
            res.end(data);
        });
        return;
    }
    else if (url === '/dashboard.js') {
        // Serve dashboard JavaScript
        const filePath = path.join(__dirname, 'public', 'dashboard.js');
        fs.readFile(filePath, (err, data) => {
            if (err) {
                res.writeHead(404);
                res.end('Dashboard JS not found');
                return;
            }
            res.writeHead(200, { 'Content-Type': 'application/javascript' });
            res.end(data);
        });
        return;
    }
    else if (url === '/dashboard.css') {
        // Serve dashboard CSS
        const filePath = path.join(__dirname, 'public', 'dashboard.css');
        fs.readFile(filePath, (err, data) => {
            if (err) {
                res.writeHead(404);
                res.end('Dashboard CSS not found');
                return;
            }
            res.writeHead(200, { 'Content-Type': 'text/css' });
            res.end(data);
        });
        return;
    }
    else if (url === '/api/cache-status' && method === 'GET') {
        // API: Get cache status
        res.setHeader('Content-Type', 'application/json');
        const stats = cacheManager.getStats();
        res.end(JSON.stringify(stats));
        return;
    }
    else if (url === '/api/clear-cache' && method === 'POST') {
        // API: Clear cache
        res.setHeader('Content-Type', 'application/json');
        cacheManager.clear();
        res.end(JSON.stringify({ success: true, message: 'Cache cleared' }));
        return;
    }
    else if (url.startsWith('/api/cache-item') && method === 'GET') {
        // API: Get individual cache item
        const urlObj = new URL(req.url, `http://${req.headers.host}`);
        const key = urlObj.searchParams.get('key');
        
        if (!key) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Key parameter required' }));
            return;
        }
        
        const value = cacheManager.get(key);
        if (value === null) {
            res.writeHead(404, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Item not found' }));
            return;
        }
        
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({
            key: key,
            value: value,
            size: Buffer.byteLength(value, 'utf8'),
            lastAccessed: Date.now() // This would need to be tracked in the cache
        }));
        return;
    }
    else if (url.startsWith('/api/cache-item') && method === 'DELETE') {
        // API: Delete individual cache item
        const urlObj = new URL(req.url, `http://${req.headers.host}`);
        const key = urlObj.searchParams.get('key');
        
        if (!key) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Key parameter required' }));
            return;
        }
        
        // Remove from cache
        const cache = cacheManager.getCache();
        if (cache.map.has(key)) {
            const node = cache.map.get(key);
            cache._remove(node);
            cache.map.delete(key);
        }
        
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ success: true, message: 'Item deleted' }));
        return;
    }
    else if (url === '/favicon.ico') {
        // Handle favicon
        res.writeHead(204, { "Content-Type": "image/x-icon" });
        res.end();
        return;
    }
    else {
        // All other requests go to proxy handler
        console.log(`Forwarding to proxy handler: ${url}`);
        handleRequest(req, res);
        return;
    }
}

if (cluster.isMaster) {
    const numCPUs = os.cpus().length;
    console.log(`Master process running. Forking ${numCPUs} workers...`);

    const workerStats = {};

    for (let i = 0; i < numCPUs; i++) {
        const worker = cluster.fork();
        workerStats[worker.id] = {
            id: worker.id,
            status: 'available',
            requests: 0,
            pid: worker.process.pid
        };

        worker.on('message', (msg) => {
            if (msg.type === 'status') {
                workerStats[worker.id] = {
                    ...workerStats[worker.id],
                    ...msg.data
                };
            }
        });
    }

    // HTTP server for worker stats
    const statusServer = http.createServer((req, res) => {
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Content-Type', 'application/json');
        
        if (req.url === '/api/workers-status' && req.method === 'GET') {
            const workers = Object.values(workerStats);
            res.end(JSON.stringify({ workers }));
        } else {
            res.writeHead(404);
            res.end(JSON.stringify({ error: 'Not found' }));
        }
    });
    
    statusServer.on('error', (err) => {
        if (err && err.code === 'EADDRINUSE') {
            console.warn(`Port ${PORT + 1} already in use. Skipping worker status server.`);
        } else {
            throw err;
        }
    });

    statusServer.listen(PORT + 1, () => {
        console.log(`Worker status server running on port ${PORT + 1}`);
    });
} else {
    let requestCount = 0;
    const server = http.createServer((req, res) => {
        // Track worker status
        const updateStatus = (status) => {
            if (process.send) {
                process.send({
                    type: 'status',
                    data: {
                        status,
                        requests: ++requestCount,
                        lastRequest: new Date().toISOString(),
                        pid: process.pid
                    }
                });
            }
        };

        // Notify master: busy
        updateStatus('busy');
        
        // Handle all routes through the simple routing system
        handleRoutes(req, res);
        
        // After response finishes, notify master: available
        res.on('finish', () => {
            updateStatus('available');
        });
    });
    
    server.on('error', (err) => {
        if (err && err.code === 'EADDRINUSE') {
            console.warn(`Port ${PORT} is already in use. Another instance may be running. Exiting worker ${process.pid}.`);
            try { server.close(); } catch (_) {}
            process.exit(0);
        } else {
            throw err;
        }
    });

    server.listen(PORT, () => {
        console.log(`Worker ${process.pid} listening on port ${PORT}`);
        console.log(`🚀 Dashboard available at: http://localhost:${PORT}/`);
        console.log(`🔗 Proxy server running on: http://localhost:${PORT}/`);
    });
}