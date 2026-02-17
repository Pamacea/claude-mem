import path from "path";
import { readFileSync } from "fs";
import { logger } from "../utils/logger.js";
import { HOOK_TIMEOUTS, getTimeout } from "./hook-constants.js";
import { SettingsDefaultsManager } from "./SettingsDefaultsManager.js";
import { MARKETPLACE_ROOT } from "./paths.js";
import { fetchKeepAlive } from "./http-client.js";

// Named constants for health checks
const HEALTH_CHECK_TIMEOUT_MS = getTimeout(HOOK_TIMEOUTS.HEALTH_CHECK);

/**
 * Fetch with a timeout using Promise.race instead of AbortSignal.
 * AbortSignal.timeout() causes a libuv assertion crash in Bun on Windows,
 * so we use a racing setTimeout pattern that avoids signal cleanup entirely.
 * The orphaned fetch is harmless since the process exits shortly after.
 */
export function fetchWithTimeout(url: string, init: RequestInit = {}, timeoutMs: number): Promise<Response> {
  return new Promise((resolve, reject) => {
    const timeoutId = setTimeout(
      () => reject(new Error(`Request timed out after ${timeoutMs}ms`)),
      timeoutMs
    );
    fetch(url, init).then(
      response => { clearTimeout(timeoutId); resolve(response); },
      err => { clearTimeout(timeoutId); reject(err); }
    );
  });
}

// Cache to avoid repeated settings file reads
let cachedPort: number | null = null;
let cachedHost: string | null = null;
let cacheTime: number = 0;
const CACHE_TTL = 60000;  // 60 seconds TTL for settings cache

/**
 * Get the worker port number from environment variable or settings
 * Priority:
 * 1. CLAUDE_MEM_WORKER_PORT environment variable (used when spawning with fallback port)
 * 2. CLAUDE_MEM_WORKER_PORT from settings file
 * 3. Default port (37777)
 *
 * Caches the port value to avoid repeated file reads
 */
export function getWorkerPort(): number {
  // First check environment variable (used for dynamic port assignment)
  if (process.env.CLAUDE_MEM_WORKER_PORT) {
    const envPort = parseInt(process.env.CLAUDE_MEM_WORKER_PORT, 10);
    if (!isNaN(envPort)) {
      return envPort;
    }
  }

  const now = Date.now();

  // Return cached value if still valid (within TTL)
  if (cachedPort !== null && (now - cacheTime) < CACHE_TTL) {
    return cachedPort;
  }

  // Cache expired or not set - reload from file
  const settingsPath = path.join(SettingsDefaultsManager.get('CLAUDE_MEM_DATA_DIR'), 'settings.json');
  const settings = SettingsDefaultsManager.loadFromFile(settingsPath);
  cachedPort = parseInt(settings.CLAUDE_MEM_WORKER_PORT, 10);
  cacheTime = now;

  return cachedPort;
}

/**
 * Get the worker host address
 * Uses CLAUDE_MEM_WORKER_HOST from settings file or default (127.0.0.1)
 * Caches the host value to avoid repeated file reads
 */
export function getWorkerHost(): string {
  if (cachedHost !== null) {
    return cachedHost;
  }

  const settingsPath = path.join(SettingsDefaultsManager.get('CLAUDE_MEM_DATA_DIR'), 'settings.json');
  const settings = SettingsDefaultsManager.loadFromFile(settingsPath);
  cachedHost = settings.CLAUDE_MEM_WORKER_HOST;
  return cachedHost;
}

/**
 * Clear the cached port and host values
 * Call this when settings are updated to force re-reading from file
 */
export function clearPortCache(): void {
  cachedPort = null;
  cachedHost = null;
}

/**
 * Find an available port starting from the given base port
 * Tries up to 10 consecutive ports before giving up
 * Returns the first available port or the base port if all are occupied
 */
export async function findAvailablePort(basePort: number, host: string = '127.0.0.1', maxAttempts: number = 10): Promise<number> {
  const { isPortAvailableAtTcpLevel } = await import('../services/infrastructure/HealthMonitor.js');

  for (let i = 0; i < maxAttempts; i++) {
    const portToTry = basePort + i;
    if (await isPortAvailableAtTcpLevel(portToTry, host)) {
      if (i > 0) {
        logger.warn('SYSTEM', `Port ${basePort} is occupied, using fallback port ${portToTry}`);
      }
      return portToTry;
    }
  }

  // All ports occupied, return base port and let caller handle the error
  return basePort;
}

/**
 * Get a worker port with automatic fallback if the default port is occupied
 * This is called during worker startup to find an available port
 */
export async function getAvailableWorkerPort(): Promise<number> {
  const basePort = getWorkerPort();
  const host = getWorkerHost();
  return findAvailablePort(basePort, host);
}

/**
 * Check if worker HTTP server is responsive
 * Uses /api/health (liveness) instead of /api/readiness because:
 * - Hooks have 15-second timeout, but full initialization can take 5+ minutes (MCP connection)
 * - /api/health returns 200 as soon as HTTP server is up (sufficient for hook communication)
 * - /api/readiness returns 503 until full initialization completes (too slow for hooks)
 * See: https://github.com/thedotmack/claude-mem/issues/811
 */
async function isWorkerHealthy(): Promise<boolean> {
  const port = getWorkerPort();
  const response = await fetchKeepAlive(
    `http://127.0.0.1:${port}/api/health`
  );
  return response.ok;
}

/**
 * Get the current plugin version from package.json
 */
function getPluginVersion(): string {
  const packageJsonPath = path.join(MARKETPLACE_ROOT, 'package.json');
  const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf-8'));
  return packageJson.version;
}

/**
 * Get the running worker's version from the API
 */
async function getWorkerVersion(): Promise<string> {
  const port = getWorkerPort();
  const response = await fetchKeepAlive(
    `http://127.0.0.1:${port}/api/version`
  );
  if (!response.ok) {
    throw new Error(`Failed to get worker version: ${response.status}`);
  }
  const data = await response.json() as { version: string };
  return data.version;
}

/**
 * Check if worker version matches plugin version
 * Note: Auto-restart on version mismatch is now handled in worker-service.ts start command (issue #484)
 * This function logs for informational purposes only
 */
async function checkWorkerVersion(): Promise<void> {
  const pluginVersion = getPluginVersion();
  const workerVersion = await getWorkerVersion();

  if (pluginVersion !== workerVersion) {
    // Just log debug info - auto-restart handles the mismatch in worker-service.ts
    logger.debug('SYSTEM', 'Version check', {
      pluginVersion,
      workerVersion,
      note: 'Mismatch will be auto-restarted by worker-service start command'
    });
  }
}


/**
 * Ensure worker service is running
 * Quick health check - returns false if worker not healthy (doesn't block)
 * Port might be in use by another process, or worker might not be started yet
 */
export async function ensureWorkerRunning(): Promise<boolean> {
  // Quick health check (single attempt, no polling)
  try {
    if (await isWorkerHealthy()) {
      await checkWorkerVersion();  // logs warning on mismatch, doesn't restart
      return true;  // Worker healthy
    }
  } catch (e) {
    // Not healthy - log for debugging
    logger.debug('SYSTEM', 'Worker health check failed', {
      error: e instanceof Error ? e.message : String(e)
    });
  }

  // Port might be in use by something else, or worker not started
  // Return false but don't throw - let caller decide how to handle
  logger.warn('SYSTEM', 'Worker not healthy, hook will proceed gracefully');
  return false;
}
