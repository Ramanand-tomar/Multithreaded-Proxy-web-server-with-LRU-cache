// Centralized, environment-aware configuration with robust defaults
const path = require("path");

function getEnvInt(name, fallback) {
  const val = process.env[name];
  if (val === undefined || val === "") return fallback;
  const num = parseInt(val, 10);
  return Number.isFinite(num) ? num : fallback;
}

module.exports = {
  PORT: getEnvInt("PORT", 8080),
  STATUS_PORT: getEnvInt("STATUS_PORT", 8081),
  CACHE_LIMIT: getEnvInt("CACHE_LIMIT", 50),
  MAX_CACHE_BYTES: getEnvInt("MAX_CACHE_BYTES", 100 * 1024 * 1024), // 100 MiB total cache budget
  MAX_ITEM_BYTES: getEnvInt("MAX_ITEM_BYTES", 5 * 1024 * 1024), // 5 MiB max per entry
  UPSTREAM_TIMEOUT_MS: getEnvInt("UPSTREAM_TIMEOUT_MS", 15000), // 15 seconds
  TARGET_HOST: process.env.TARGET_HOST || "",
  TARGET_PORT: getEnvInt("TARGET_PORT", 80),
  WORKER_COUNT: getEnvInt("WORKER_COUNT", 0), // 0 = os.cpus().length
  ALLOW_PRIVATE_IP: process.env.ALLOW_PRIVATE_IP === "true" || process.env.NODE_ENV === "test",
  CONCURRENCY_MODE: process.env.CONCURRENCY_MODE || "cluster", // "cluster" (multi-process) or "threads" (worker_threads)
  PUBLIC_DIR: path.join(__dirname, "public"),
};
