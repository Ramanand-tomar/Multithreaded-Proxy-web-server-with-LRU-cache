class Dashboard {
    constructor() {
        this.baseUrl = window.location.origin;
        this.lastWorkerPid = null;
        this.lastWorkerId = null;
        this.cachedKeys = [];
        this.filterQuery = "";
        this.init();
    }

    init() {
        this.initTheme();
        this.checkServerStatus();
        this.loadCacheStats();
        this.loadWorkersStatus();
        this.setupEventListeners();

        // Adaptive polling: 2.5 seconds, paused when tab is in background
        setInterval(() => {
            if (document.hidden) return;
            this.loadCacheStats();
            this.loadWorkersStatus();
        }, 2500);
    }

    initTheme() {
        const savedTheme = localStorage.getItem("proxyengine_theme") || "dark";
        document.documentElement.setAttribute("data-theme", savedTheme);
        const icon = document.querySelector(".theme-icon");
        if (icon) icon.textContent = savedTheme === "dark" ? "🌙" : "☀️";
    }

    toggleTheme() {
        const current = document.documentElement.getAttribute("data-theme") || "dark";
        const next = current === "dark" ? "light" : "dark";
        document.documentElement.setAttribute("data-theme", next);
        localStorage.setItem("proxyengine_theme", next);
        const icon = document.querySelector(".theme-icon");
        if (icon) icon.textContent = next === "dark" ? "🌙" : "☀️";
    }

    async checkServerStatus() {
        try {
            const response = await fetch(`${this.baseUrl}/api/cache-status`);
            this.updateServerStatus(response.ok);
        } catch {
            this.updateServerStatus(false);
        }
    }

    updateServerStatus(online) {
        const statusElement = document.getElementById("serverStatus");
        if (!statusElement) return;
        if (online) {
            statusElement.textContent = "Online";
            statusElement.className = "status-online";
        } else {
            statusElement.textContent = "Offline";
            statusElement.className = "status-offline";
        }
    }

    async loadCacheStats() {
        try {
            const response = await fetch(`${this.baseUrl}/api/cache-status`);
            const data = await response.json();
            this.cachedKeys = data.keys || [];
            this.updateCacheDisplay(data);
            this.renderFilteredCacheItems();
            this.updateLRUStatistics(data);
        } catch (error) {
            this.logActivity("Error loading cache stats: " + error.message, "error");
        }
    }

    async loadWorkersStatus() {
        try {
            const workerUrl = `${this.baseUrl}/api/workers-status`;
            const response = await fetch(workerUrl);
            const data = await response.json();
            const workers = data.workers || [];
            this.updateWorkersDisplay(workers);
            const countEl = document.getElementById("activeWorkersCount");
            if (countEl) countEl.textContent = workers.length;
            const summaryEl = document.getElementById("clusterSummary");
            if (summaryEl) summaryEl.textContent = `${workers.length} nodes active`;
        } catch {
            // Worker supervisor offline or starting up
        }
    }

    updateCacheDisplay(data) {
        this.animateNumber(document.getElementById("cacheSize"), Number(data.size || 0));
        const limitEl = document.getElementById("cacheLimit");
        if (limitEl) limitEl.textContent = data.limit || 50;

        const hitRatio = parseFloat(data.hitRatio) || 0;
        const hitRatioEl = document.getElementById("hitRatio");
        this.animatePercent(hitRatioEl, hitRatio);

        const meterBar = document.getElementById("hitRatioBar");
        if (meterBar) meterBar.style.width = `${Math.min(hitRatio, 100)}%`;

        const totalBytes = data.totalBytes || 0;
        let memoryText;
        if (totalBytes < 1024) {
            memoryText = `${totalBytes} B`;
        } else if (totalBytes < 1024 * 1024) {
            memoryText = `${(totalBytes / 1024).toFixed(2)} KB`;
        } else {
            memoryText = `${(totalBytes / (1024 * 1024)).toFixed(2)} MB`;
        }

        const memEl = document.getElementById("memoryUsage");
        if (memEl && memEl.textContent !== memoryText) {
            memEl.textContent = memoryText;
        }

        const sizeRatio = data.limit > 0 ? ((data.size || 0) / data.limit) * 100 : 0;
        const progressFill = document.getElementById("cacheProgress");
        if (progressFill) {
            progressFill.style.width = `${Math.min(sizeRatio, 100)}%`;
        }
    }

    updateLRUStatistics(data) {
        const hitsEl = document.getElementById("cacheHits");
        const missesEl = document.getElementById("cacheMisses");
        if (hitsEl) this.animateNumber(hitsEl, data.hits || 0);
        if (missesEl) this.animateNumber(missesEl, data.misses || 0);

        const evictionsEl = document.getElementById("cacheEvictions");
        if (evictionsEl) evictionsEl.textContent = `${data.evictions || 0} evictions`;

        const totalEl = document.getElementById("totalRequests");
        if (totalEl) this.animateNumber(totalEl, (data.hits || 0) + (data.misses || 0));
    }

    formatAge(timestamp) {
        if (!timestamp) return "N/A";
        const ageInSeconds = Math.max(0, Math.round((Date.now() - timestamp) / 1000));
        if (ageInSeconds < 60) return `${ageInSeconds}s ago`;
        if (ageInSeconds < 3600) return `${Math.floor(ageInSeconds / 60)}m ago`;
        if (ageInSeconds < 86400) return `${Math.floor(ageInSeconds / 3600)}h ago`;
        return `${Math.floor(ageInSeconds / 86400)}d ago`;
    }

    renderFilteredCacheItems() {
        const query = this.filterQuery.toLowerCase().trim();
        const filtered = query
            ? this.cachedKeys.filter(item => (item.key || "").toLowerCase().includes(query))
            : this.cachedKeys;
        this.updateCacheItems(filtered);
    }

    // Safe DOM construction: completely immune to Stored / Reflected XSS
    updateCacheItems(keys) {
        const container = document.getElementById("cacheItems");
        if (!container) return;
        container.replaceChildren();

        if (!keys || keys.length === 0) {
            const emptyEl = document.createElement("div");
            emptyEl.className = "cache-item empty";
            emptyEl.textContent = this.filterQuery ? "No matching cache items found." : "Cache is currently empty.";
            container.appendChild(emptyEl);
            return;
        }

        keys.forEach((item, index) => {
            const cacheItem = document.createElement("div");
            cacheItem.className = "cache-item";
            cacheItem.setAttribute("data-key", item.key);

            const sizeInKB = (item.size / 1024).toFixed(2);
            const age = this.formatAge(item.lastAccessed);

            // Header
            const headerDiv = document.createElement("div");
            headerDiv.className = "cache-item-header";

            const indexDiv = document.createElement("div");
            indexDiv.className = "cache-index";
            indexDiv.textContent = `#${index + 1}`;

            const heatDiv = document.createElement("div");
            heatDiv.className = "cache-heat heat-low";
            heatDiv.textContent = "LRU Node";
            headerDiv.append(indexDiv, heatDiv);

            // URL
            const urlDiv = document.createElement("div");
            urlDiv.className = "cache-url";
            urlDiv.title = item.key;
            urlDiv.textContent = item.key;

            // Details
            const detailsDiv = document.createElement("div");
            detailsDiv.className = "cache-details";

            const sizeDiv = document.createElement("div");
            sizeDiv.textContent = `${sizeInKB} KB`;

            const ageDiv = document.createElement("div");
            ageDiv.textContent = age;

            detailsDiv.append(sizeDiv, ageDiv);

            // Actions
            const actionsDiv = document.createElement("div");
            actionsDiv.className = "cache-actions";

            const viewBtn = document.createElement("button");
            viewBtn.type = "button";
            viewBtn.className = "btn-view";
            viewBtn.textContent = "Inspect";
            viewBtn.addEventListener("click", () => this.viewCacheItem(item.key));

            const deleteBtn = document.createElement("button");
            deleteBtn.type = "button";
            deleteBtn.className = "btn-delete";
            deleteBtn.textContent = "Evict";
            deleteBtn.addEventListener("click", () => this.deleteCacheItem(item.key));

            actionsDiv.append(viewBtn, deleteBtn);
            cacheItem.append(headerDiv, urlDiv, detailsDiv, actionsDiv);
            container.appendChild(cacheItem);
        });
    }

    updateWorkersDisplay(workers) {
        const container = document.getElementById("workersList");
        if (!container) return;
        container.replaceChildren();

        workers.forEach(worker => {
            const workerElement = document.createElement("div");
            const isLast = this.lastWorkerPid && String(worker.pid) === String(this.lastWorkerPid);
            workerElement.className = `worker ${worker.status === "busy" ? "busy" : ""} ${isLast ? "last-handler" : ""}`;

            const idDiv = document.createElement("div");
            idDiv.className = "worker-id";
            idDiv.textContent = `Worker #${worker.id}`;

            const statusDiv = document.createElement("div");
            statusDiv.className = "worker-status";
            statusDiv.textContent = worker.status === "busy" ? "🟡 Busy" : "🟢 Available";

            const reqDiv = document.createElement("div");
            reqDiv.className = "worker-requests";
            reqDiv.textContent = `Handled: ${worker.requests || 0}`;

            const pidDiv = document.createElement("div");
            pidDiv.className = "worker-pid";
            pidDiv.textContent = `PID ${worker.pid || "N/A"}`;

            workerElement.append(idDiv, statusDiv, reqDiv, pidDiv);
            container.appendChild(workerElement);
        });
    }

    setupEventListeners() {
        // Theme Toggle
        const themeBtn = document.getElementById("themeToggle");
        if (themeBtn) themeBtn.addEventListener("click", () => this.toggleTheme());

        // Header Action Buttons
        const refreshBtn = document.getElementById("btnRefreshCache");
        if (refreshBtn) refreshBtn.addEventListener("click", () => {
            this.loadCacheStats();
            this.showToast("Cache stats refreshed");
        });

        const clearBtn = document.getElementById("btnClearCache");
        if (clearBtn) clearBtn.addEventListener("click", () => this.clearCache());

        // Cache Search Filter
        const searchInput = document.getElementById("cacheSearch");
        if (searchInput) {
            searchInput.addEventListener("input", (e) => {
                this.filterQuery = e.target.value;
                this.renderFilteredCacheItems();
            });
        }

        // Modal Close
        const modalClose = document.getElementById("modalClose");
        if (modalClose) {
            modalClose.addEventListener("click", () => {
                document.getElementById("detailsModal").classList.add("hidden");
            });
        }

        // Proxy Form Submission
        const proxyForm = document.getElementById("proxyForm");
        if (proxyForm) {
            proxyForm.addEventListener("submit", (e) => {
                e.preventDefault();
                this.testProxy();
            });
        }

        // Preset Chips
        const testUrls = document.getElementById("testUrls");
        if (testUrls) {
            testUrls.addEventListener("click", (e) => {
                const target = e.target;
                if (target && target.classList && target.classList.contains("test-url")) {
                    const url = target.getAttribute("data-url") || "";
                    const input = document.getElementById("targetUrl");
                    if (input) input.value = url;
                    this.testProxy();
                }
            });
        }

        // Clear activity log button
        const clearLogBtn = document.getElementById("btnClearLogs");
        if (clearLogBtn) {
            clearLogBtn.addEventListener("click", () => {
                const feed = document.getElementById("activityLog");
                if (feed) feed.replaceChildren();
            });
        }
    }

    async testProxy() {
        const urlInput = document.getElementById("targetUrl");
        const methodSelect = document.getElementById("reqMethod");
        const resultDiv = document.getElementById("proxyResult");
        const url = urlInput ? urlInput.value.trim() : "";
        const method = methodSelect ? methodSelect.value : "GET";

        if (!url) return;

        const startTime = performance.now();
        if (resultDiv) resultDiv.textContent = `[Sending ${method} request to proxy...]`;

        try {
            let proxyUrl;
            if (url.startsWith("http://") || url.startsWith("https://")) {
                proxyUrl = `${this.baseUrl}/${url}`;
            } else {
                proxyUrl = `${this.baseUrl}/http://${url}`;
            }

            const response = await fetch(proxyUrl, { method });
            const latency = Math.round(performance.now() - startTime);
            const dataText = await response.text();

            // Extract telemetry headers
            const cacheHeader = response.headers.get("X-Cache") || "BYPASS";
            const workerPid = response.headers.get("X-Worker-PID");
            const workerId = response.headers.get("X-Worker-ID");
            const contentType = response.headers.get("Content-Type") || "text/plain";

            if (workerPid) this.lastWorkerPid = workerPid;
            if (workerId) this.lastWorkerId = workerId;

            // Update Inspector Status Chips
            const statusBadge = document.getElementById("resStatusBadge");
            if (statusBadge) {
                statusBadge.textContent = `${response.status} ${response.statusText || ""}`;
                statusBadge.className = `status-chip ${response.ok ? "badge-hit" : "badge-miss"}`;
            }

            const latencyBadge = document.getElementById("resLatencyBadge");
            if (latencyBadge) {
                latencyBadge.textContent = `${latency} ms`;
            }

            const cacheBadge = document.getElementById("resCacheBadge");
            if (cacheBadge) {
                cacheBadge.textContent = `X-Cache: ${cacheHeader}`;
                cacheBadge.className = `status-chip ${cacheHeader === "HIT" ? "badge-hit" : cacheHeader === "MISS" ? "badge-miss" : "badge-bypass"}`;
            }

            // Format body output (pretty print JSON if applicable)
            let formattedBody = dataText;
            if (contentType.includes("application/json")) {
                try {
                    formattedBody = JSON.stringify(JSON.parse(dataText), null, 2);
                } catch {}
            }

            const headerSummary = `HTTP/1.1 ${response.status} ${response.statusText}\n` +
                `X-Cache: ${cacheHeader} | Latency: ${latency}ms | Worker: #${workerId || "0"} (PID: ${workerPid || "N/A"})\n` +
                `Content-Type: ${contentType}\n\n`;

            if (resultDiv) {
                resultDiv.textContent = headerSummary + formattedBody;
            }

            // Update overview badges
            const lastBadge = document.getElementById("lastResultBadge");
            if (lastBadge) {
                lastBadge.className = `badge ${cacheHeader === "HIT" ? "badge-hit" : cacheHeader === "MISS" ? "badge-miss" : "badge-bypass"}`;
                lastBadge.textContent = cacheHeader;
            }

            const lastWorkerInfo = document.getElementById("lastWorkerInfo");
            if (lastWorkerInfo) {
                lastWorkerInfo.textContent = workerId ? `#${workerId} (${workerPid})` : `PID ${workerPid || "N/A"}`;
            }

            const logType = cacheHeader === "HIT" ? "cache-hit" : cacheHeader === "MISS" ? "cache-miss" : "info";
            this.logActivity(`${method} ${url} -> ${response.status} [${cacheHeader}] in ${latency}ms`, logType);

            this.loadCacheStats();
            this.loadWorkersStatus();
        } catch (error) {
            if (resultDiv) {
                resultDiv.textContent = `Error connecting through proxy: ${error.message}`;
            }
            this.logActivity(`Proxy Dispatch Failed: ${error.message}`, "error");
        }
    }

    async clearCache() {
        if (!confirm("Are you sure you want to purge the entire authoritative cache?")) return;
        try {
            const response = await fetch(`${this.baseUrl}/api/clear-cache`, { method: "POST" });
            const result = await response.json();
            if (result.success) {
                this.showToast("Cache successfully cleared");
                this.logActivity("Centralized cache cleared by operator", "info");
                this.loadCacheStats();
            }
        } catch (error) {
            this.showToast("Failed to clear cache: " + error.message, true);
        }
    }

    async viewCacheItem(key) {
        try {
            const response = await fetch(`${this.baseUrl}/api/cache-item?key=${encodeURIComponent(key)}`);
            const data = await response.json();

            document.getElementById("modalKey").textContent = key;
            document.getElementById("modalSize").textContent = `${(data.size / 1024).toFixed(2)} KB (${data.size} bytes)`;
            document.getElementById("modalAccessed").textContent = new Date(data.lastAccessed).toLocaleString();
            document.getElementById("modalPreview").textContent = data.preview || "// Empty or binary payload";

            document.getElementById("detailsModal").classList.remove("hidden");
        } catch (error) {
            this.showToast("Could not inspect item: " + error.message, true);
        }
    }

    async deleteCacheItem(key) {
        try {
            const response = await fetch(`${this.baseUrl}/api/cache-item?key=${encodeURIComponent(key)}`, {
                method: "DELETE"
            });
            const result = await response.json();
            if (result.success) {
                this.showToast(`Evicted: ${this.truncateUrl(key, 30)}`);
                this.logActivity(`Manually evicted cache entry: ${key}`, "info");
                this.loadCacheStats();
            }
        } catch (error) {
            this.showToast("Failed to evict item: " + error.message, true);
        }
    }

    showToast(message, isError = false) {
        const container = document.getElementById("toastContainer");
        if (!container) return;

        const toast = document.createElement("div");
        toast.className = `toast ${isError ? "toast-error" : ""}`;
        toast.textContent = message;

        container.appendChild(toast);
        setTimeout(() => {
            toast.style.opacity = "0";
            toast.style.transition = "opacity 0.3s ease";
            setTimeout(() => toast.remove(), 300);
        }, 3000);
    }

    logActivity(message, type = "info") {
        const logContainer = document.getElementById("activityLog");
        if (!logContainer) return;

        const activityItem = document.createElement("div");
        activityItem.className = `activity-item ${type}`;
        activityItem.textContent = `[${new Date().toLocaleTimeString()}] ${message}`;

        logContainer.prepend(activityItem);
        const items = logContainer.getElementsByClassName("activity-item");
        if (items.length > 25) {
            items[items.length - 1].remove();
        }
    }

    truncateUrl(url, maxLength = 50) {
        if (!url || url.length <= maxLength) return url || "";
        const start = url.substring(0, maxLength / 2);
        const end = url.substring(url.length - maxLength / 2);
        return start + "..." + end;
    }

    animateNumber(el, target) {
        if (!el) return;
        const start = Number(el.textContent || 0);
        const startTime = performance.now();
        const duration = 250;
        const step = (now) => {
            const t = Math.min(1, (now - startTime) / duration);
            const val = Math.round(start + (target - start) * t);
            el.textContent = String(val);
            if (t < 1) requestAnimationFrame(step);
        };
        requestAnimationFrame(step);
    }

    animatePercent(el, target) {
        if (!el) return;
        const current = parseFloat((el.textContent || "0").replace("%", "")) || 0;
        const startTime = performance.now();
        const duration = 250;
        const step = (now) => {
            const t = Math.min(1, (now - startTime) / duration);
            const val = (current + (target - current) * t).toFixed(1);
            el.textContent = `${val}%`;
            if (t < 1) requestAnimationFrame(step);
        };
        requestAnimationFrame(step);
    }
}

document.addEventListener("DOMContentLoaded", () => {
    window.dashboard = new Dashboard();
});
