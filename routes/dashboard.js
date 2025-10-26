const cacheManager = require('../cacheManager');

function dashboardRoutes(req, res) {
  // Set CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Content-Type', 'application/json');

  if (req.url === '/api/cache-status' && req.method === 'GET') {
    const stats = cacheManager.getStats();
    res.end(JSON.stringify(stats));
  } else if (req.url === '/api/clear-cache' && req.method === 'POST') {
    cacheManager.clear();
    res.end(JSON.stringify({ success: true, message: 'Cache cleared' }));
  } else {
    res.statusCode = 404;
    res.end(JSON.stringify({ error: 'Endpoint not found' }));
  }
}

module.exports = dashboardRoutes;