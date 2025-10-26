class Dashboard {
    constructor() {
        this.baseUrl = window.location.origin;
        this.lastWorkerPid = null;
        this.lastWorkerId = null;
        this.init();
    }

    init() {
        this.checkServerStatus();
        this.loadCacheStats();
        this.loadWorkersStatus();
        this.setupEventListeners();
        
        // Auto-refresh every 1 second for better real-time updates
        setInterval(() => {
            this.loadCacheStats();
            this.loadWorkersStatus();
        }, 1000);
    }

    async checkServerStatus() {
        try {
            const response = await fetch(`${this.baseUrl}/api/cache-status`);
            if (response.ok) {
                this.updateServerStatus(true);
            } else {
                this.updateServerStatus(false);
            }
        } catch (error) {
            this.updateServerStatus(false);
        }
    }

    updateServerStatus(online) {
        const statusElement = document.getElementById('serverStatus');
        if (online) {
            statusElement.textContent = 'Online';
            statusElement.className = 'status-online';
        } else {
            statusElement.textContent = 'Offline';
            statusElement.className = 'status-offline';
        }
    }

    async loadCacheStats() {
        try {
            const response = await fetch(`${this.baseUrl}/api/cache-status`);
            const data = await response.json();
            
            this.updateCacheDisplay(data);
            this.updateCacheItems(data.keys || []);
            this.updateLRUStatistics(data);
        } catch (error) {
            console.error('Error loading cache stats:', error);
            this.logActivity('Error loading cache stats', 'error');
        }
    }

    async loadWorkersStatus() {
        try {
            const workerPort = parseInt(window.location.port) + 1;
            const workerUrl = `${window.location.protocol}//${window.location.hostname}:${workerPort}/api/workers-status`;
            
            const response = await fetch(workerUrl);
            const data = await response.json();
            
            this.updateWorkersDisplay(data.workers || []);
        } catch (error) {
            console.log('Worker status not available, using mock data');
            // Show mock workers for demo
            const basePid = 15000 + Math.floor(Math.random() * 5000);
            this.updateWorkersDisplay([
                { id: 1, status: 'available', requests: Math.floor(Math.random() * 100), pid: basePid },
                { id: 2, status: 'busy', requests: Math.floor(Math.random() * 100), pid: basePid + 1 },
                { id: 3, status: 'available', requests: Math.floor(Math.random() * 100), pid: basePid + 2 },
                { id: 4, status: 'available', requests: Math.floor(Math.random() * 100), pid: basePid + 3 }
            ]);
        }
    }

    updateCacheDisplay(data) {
        // Update cache size and limit
        this.animateNumber(document.getElementById('cacheSize'), Number(data.size || 0));
        document.getElementById('cacheLimit').textContent = data.limit || 50;
        
        // Update hit ratio
        const hitRatio = parseFloat(data.hitRatio) || 0;
        const hitRatioElement = document.getElementById('hitRatio');
        this.animatePercent(hitRatioElement, hitRatio);
        
        // Update memory usage
        const memoryUsage = parseFloat(data.memoryUsage) || 0;
        const totalBytes = data.totalBytes || 0;
        let memoryText;
        if (totalBytes < 1024) {
            memoryText = `${totalBytes} B`;
        } else if (totalBytes < 1024 * 1024) {
            memoryText = `${(totalBytes / 1024).toFixed(2)} KB`;
        } else {
            memoryText = `${(totalBytes / (1024 * 1024)).toFixed(2)} MB`;
        }
        const memEl = document.getElementById('memoryUsage');
        if (memEl && memEl.textContent !== memoryText) {
            memEl.textContent = memoryText;
            this.flash(memEl);
        }
        
        // Update progress bar based on cache item count ratio
        const sizeRatio = data.limit > 0 ? ((data.size || 0) / data.limit) * 100 : 0;
        const progressFill = document.getElementById('cacheProgress');
        if (progressFill) {
            progressFill.style.width = `${Math.min(sizeRatio, 100)}%`;
            
            // Change color based on usage
            if (sizeRatio > 80) {
                progressFill.style.background = 'linear-gradient(90deg, #ff6b6b, #ee5a24)';
            } else if (sizeRatio > 60) {
                progressFill.style.background = 'linear-gradient(90deg, #ffa726, #ff9800)';
            } else {
                progressFill.style.background = 'linear-gradient(90deg, #4CAF50, #45a049)';
            }
            this.flash(progressFill);
        }
        
        // Update cache statistics
        this.updateCacheStatistics(data);
    }

    // Update LRU-specific statistics
    updateLRUStatistics(data) {
        // Update hits and misses
        const hitsEl = document.getElementById('cacheHits');
        const missesEl = document.getElementById('cacheMisses');
        
        if (hitsEl) this.animateNumber(hitsEl, data.hits || 0);
        if (missesEl) this.animateNumber(missesEl, data.misses || 0);
        
        // Update hit rate percentage
        const totalRequests = (data.hits || 0) + (data.misses || 0);
        const hitRate = totalRequests > 0 ? ((data.hits || 0) / totalRequests * 100) : 0;
        const hitRateEl = document.getElementById('hitRate');
        if (hitRateEl) this.animatePercent(hitRateEl, hitRate);
        
        // Update eviction count if available
        const evictionsEl = document.getElementById('cacheEvictions');
        if (evictionsEl) this.animateNumber(evictionsEl, data.evictions || 0);
    }

    // Update general cache statistics
    updateCacheStatistics(data) {
        const stats = [
            { id: 'totalRequests', value: (data.hits || 0) + (data.misses || 0) },
            { id: 'averageItemSize', value: data.averageSize ? `${(data.averageSize / 1024).toFixed(2)} KB` : '0 KB' },
            { id: 'oldestItem', value: this.formatAge(data.oldestItem) },
            { id: 'newestItem', value: this.formatAge(data.newestItem) }
        ];
        
        stats.forEach(stat => {
            const el = document.getElementById(stat.id);
            if (el) {
                if (typeof stat.value === 'number') {
                    this.animateNumber(el, stat.value);
                } else {
                    if (el.textContent !== stat.value) {
                        el.textContent = stat.value;
                        this.flash(el);
                    }
                }
            }
        });
    }

    // Format age in human readable format
    formatAge(timestamp) {
        if (!timestamp) return 'N/A';
        
        const ageInSeconds = Math.round((Date.now() - timestamp) / 1000);
        
        if (ageInSeconds < 60) {
            return `${ageInSeconds}s ago`;
        } else if (ageInSeconds < 3600) {
            return `${Math.floor(ageInSeconds / 60)}m ago`;
        } else if (ageInSeconds < 86400) {
            return `${Math.floor(ageInSeconds / 3600)}h ago`;
        } else {
            return `${Math.floor(ageInSeconds / 86400)}d ago`;
        }
    }

    // Update cache items with detailed information
    updateCacheItems(keys) {
        const container = document.getElementById('cacheItems');
        if (!container) return;
        
        container.innerHTML = '';
        
        if (!keys || keys.length === 0) {
            container.innerHTML = '<div class="cache-item empty">No items in cache.</div>';
            return;
        }
        
        // Show items in LRU order (most recent first)
        keys.forEach((item, index) => {
            const cacheItem = document.createElement('div');
            cacheItem.className = 'cache-item';
            cacheItem.setAttribute('data-key', item.key);
            
            const sizeInKB = (item.size / 1024).toFixed(2);
            const age = this.formatAge(item.lastAccessed);
            const accessCount = item.accessCount || 1;
            
            // Determine priority/heat based on access patterns
            const heatLevel = accessCount > 10 ? 'high' : accessCount > 5 ? 'medium' : 'low';
            
            cacheItem.innerHTML = `
                <div class="cache-item-header">
                    <div class="cache-index">${index + 1}.</div>
                    <div class="cache-heat heat-${heatLevel}" title="Accessed ${accessCount} times">${accessCount}🔥</div>
                </div>
                <div class="cache-url" title="${item.key}">${this.truncateUrl(item.key, 60)}</div>
                <div class="cache-details">
                    <div class="cache-size">${sizeInKB} KB</div>
                    <div class="cache-age">${age}</div>
                    <div class="cache-priority">${item.priority || 'normal'}</div>
                </div>
                <div class="cache-actions">
                    <button class="btn-view" onclick="dashboard.viewCacheItem('${item.key}')">View</button>
                    <button class="btn-delete" onclick="dashboard.deleteCacheItem('${item.key}')">Delete</button>
                </div>
            `;
            container.appendChild(cacheItem);
        });
    }

    updateWorkersDisplay(workers) {
        const container = document.getElementById('workersList');
        if (!container) return;
        
        container.innerHTML = '';
        
        workers.forEach(worker => {
            const workerElement = document.createElement('div');
            const isLast = this.lastWorkerPid && String(worker.pid) === String(this.lastWorkerPid);
            workerElement.className = `worker ${worker.status === 'busy' ? 'busy' : ''} ${isLast ? 'last-handler' : ''}`;
            if (isLast) {
                workerElement.style.outline = '2px solid #3f51b5';
                workerElement.style.boxShadow = '0 0 10px rgba(63,81,181,0.6)';
            }
            workerElement.innerHTML = `
                <div class="worker-id">Worker ${worker.id}</div>
                <div class="worker-status">${worker.status === 'busy' ? '🟡 Busy' : '🟢 Available'}</div>
                <div class="worker-requests">Requests: ${worker.requests || 0}</div>
                <div class="worker-pid">PID: ${worker.pid || 'N/A'}</div>
            `;
            container.appendChild(workerElement);
        });
    }

    setupEventListeners() {
        const proxyForm = document.getElementById('proxyForm');
        if (proxyForm) {
            proxyForm.addEventListener('submit', (e) => {
                e.preventDefault();
                this.testProxy();
            });
        }

        // Wire quick test URLs
        const testUrls = document.getElementById('testUrls');
        if (testUrls) {
            testUrls.addEventListener('click', (e) => {
                const target = e.target;
                if (target && target.classList && target.classList.contains('test-url')) {
                    const url = target.getAttribute('data-url') || '';
                    const input = document.getElementById('targetUrl');
                    if (input) input.value = url;
                    this.testProxy();
                }
            });
        }

        // Add clear cache button
        const clearCacheBtn = document.createElement('button');
        clearCacheBtn.textContent = 'Clear Cache';
        clearCacheBtn.type = 'button';
        clearCacheBtn.className = 'btn-clear-cache';
        clearCacheBtn.onclick = () => this.clearCache();
        
        const cacheStats = document.querySelector('.cache-stats');
        if (cacheStats) {
            cacheStats.appendChild(clearCacheBtn);
        }

        // Add refresh cache button
        const refreshCacheBtn = document.createElement('button');
        refreshCacheBtn.textContent = 'Refresh Cache';
        refreshCacheBtn.type = 'button';
        refreshCacheBtn.className = 'btn-refresh-cache';
        refreshCacheBtn.onclick = () => this.loadCacheStats();
        
        if (cacheStats) {
            cacheStats.appendChild(refreshCacheBtn);
        }
    }

    async testProxy() {
        const urlInput = document.getElementById('targetUrl');
        const resultDiv = document.getElementById('proxyResult');
        const url = urlInput ? urlInput.value.trim() : '';
        
        if (!url) {
            if (resultDiv) resultDiv.textContent = 'Please enter a URL';
            return;
        }

        try {
            if (resultDiv) resultDiv.textContent = 'Fetching...';
            this.logActivity(`Testing proxy for: ${url}`, 'info');
            
            // Format URL for proxy
            let proxyUrl;
            if (url.startsWith('http://') || url.startsWith('https://')) {
                proxyUrl = `${this.baseUrl}/${url}`;
            } else {
                proxyUrl = `${this.baseUrl}/http://${url}`;
            }
            
            const response = await fetch(proxyUrl);
            const data = await response.text();
            // Read runtime headers
            const cacheHeader = response.headers.get('X-Cache');
            const workerPid = response.headers.get('X-Worker-PID');
            const workerId = response.headers.get('X-Worker-ID');
            const cacheSize = response.headers.get('X-Cache-Size');
            const cacheHits = response.headers.get('X-Cache-Hits');
            const cacheMisses = response.headers.get('X-Cache-Misses');
            if (workerPid) this.lastWorkerPid = workerPid;
            if (workerId) this.lastWorkerId = workerId;
            
            // Show truncated result
            const displayText = data.length > 300 ? 
                data.substring(0, 300) + '... [truncated]' : 
                data;
            
            if (resultDiv) {
                resultDiv.textContent = displayText;
                resultDiv.style.color = '#333';
            }
            
            const tag = cacheHeader === 'HIT' ? 'cache-hit' : 'cache-miss';
            const extra = workerPid || workerId ? ` | Worker ${workerId ? `#${workerId}` : ''} PID ${workerPid || ''}`.trim() : '';
            this.logActivity(`Successfully proxied: ${url} (${data.length} bytes) [${cacheHeader || 'BYPASS'}]${extra}`, tag);
            
            // Update badges
            const badge = document.getElementById('lastResultBadge');
            if (badge) {
                badge.className = `badge ${cacheHeader === 'HIT' ? 'badge-hit' : cacheHeader === 'MISS' ? 'badge-miss' : 'badge-bypass'}`;
                badge.textContent = cacheHeader || 'BYPASS';
            }
            const lastWorkerInfo = document.getElementById('lastWorkerInfo');
            if (lastWorkerInfo) {
                lastWorkerInfo.textContent = workerId ? `#${workerId} (PID ${workerPid || 'N/A'})` : (workerPid ? `PID ${workerPid}` : 'N/A');
            }
            
            // Refresh cache stats to show new item immediately
            this.loadCacheStats();
            this.loadWorkersStatus();
            
        } catch (error) {
            if (resultDiv) {
                resultDiv.textContent = `Error: ${error.message}`;
                resultDiv.style.color = '#e74c3c';
            }
            this.logActivity(`Proxy error: ${error.message}`, 'error');
        }
    }

    async clearCache() {
        try {
            const response = await fetch(`${this.baseUrl}/api/clear-cache`, {
                method: 'POST'
            });
            const result = await response.json();
            
            if (result.success) {
                this.logActivity('Cache cleared successfully', 'info');
                this.loadCacheStats(); // Refresh display
            }
        } catch (error) {
            this.logActivity(`Error clearing cache: ${error.message}`, 'error');
        }
    }

    async viewCacheItem(key) {
        try {
            const response = await fetch(`${this.baseUrl}/api/cache-item?key=${encodeURIComponent(key)}`);
            const data = await response.json();
            
            // Show item details in modal or alert
            alert(`Cache Item: ${key}\nSize: ${(data.size / 1024).toFixed(2)} KB\nLast Accessed: ${new Date(data.lastAccessed).toLocaleString()}\nAccess Count: ${data.accessCount || 1}`);
        } catch (error) {
            this.logActivity(`Error viewing cache item: ${error.message}`, 'error');
        }
    }

    async deleteCacheItem(key) {
        try {
            const response = await fetch(`${this.baseUrl}/api/cache-item?key=${encodeURIComponent(key)}`, {
                method: 'DELETE'
            });
            const result = await response.json();
            
            if (result.success) {
                this.logActivity(`Cache item deleted: ${this.truncateUrl(key, 30)}`, 'info');
                this.loadCacheStats(); // Refresh display
            }
        } catch (error) {
            this.logActivity(`Error deleting cache item: ${error.message}`, 'error');
        }
    }

    logActivity(message, type = 'info') {
        const logContainer = document.getElementById('activityLog');
        if (!logContainer) return;
        
        const activityItem = document.createElement('div');
        activityItem.className = `activity-item ${type}`;
        activityItem.textContent = `[${new Date().toLocaleTimeString()}] ${message}`;
        
        logContainer.appendChild(activityItem);
        logContainer.scrollTop = logContainer.scrollHeight;
        
        // Keep only last 15 items
        const items = logContainer.getElementsByClassName('activity-item');
        if (items.length > 15) {
            items[0].remove();
        }
    }

    truncateUrl(url, maxLength = 50) {
        if (!url || url.length <= maxLength) return url || '';
        
        const start = url.substring(0, maxLength / 2);
        const end = url.substring(url.length - maxLength / 2);
        return start + '...' + end;
    }

    // Smoothly animate numerical changes to avoid jarring jumps
    animateNumber(el, target) {
        if (!el) return;
        const start = Number(el.textContent || 0);
        const startTime = performance.now();
        const duration = 300;
        const step = (now) => {
            const t = Math.min(1, (now - startTime) / duration);
            const val = Math.round(start + (target - start) * t);
            el.textContent = String(val);
            if (t < 1) requestAnimationFrame(step); else this.flash(el);
        };
        requestAnimationFrame(step);
    }

    animatePercent(el, target) {
        if (!el) return;
        const current = parseFloat((el.textContent || '0').replace('%','')) || 0;
        const startTime = performance.now();
        const duration = 300;
        const step = (now) => {
            const t = Math.min(1, (now - startTime) / duration);
            const val = (current + (target - current) * t).toFixed(1);
            el.textContent = `${val}%`;
            if (t < 1) requestAnimationFrame(step); else this.flash(el);
        };
        requestAnimationFrame(step);
    }

    // Brief highlight to indicate change
    flash(el) {
        try {
            el.style.transition = 'background-color 0.3s';
            el.style.backgroundColor = 'rgba(255,255,0,0.3)';
            setTimeout(() => { el.style.backgroundColor = 'transparent'; }, 300);
        } catch (_) {}
    }
}

// Initialize dashboard when page loads
document.addEventListener('DOMContentLoaded', () => {
    window.dashboard = new Dashboard();
});