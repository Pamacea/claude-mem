/**
 * Stop Hook
 *
 * Runs when Claude Code is stopped/closed.
 *
 * Responsibilities:
 * - Cleanup session state
 * - Prepare for compression
 * - Save pending data
 *
 * Exit codes:
 * - 0: Success (cleanup complete)
 * - 2: Blocking error (stderr shown)
 */
import { getSessionId } from '../shared/hook-constants.js';
import { getWorkerPort } from '../shared/worker-utils.js';

export async function handleStop(): Promise<number> {
  try {
    const sessionId = getSessionId();

    // Prepare session for compression via Worker API
    const port = getWorkerPort();
    const response = await fetch(`http://127.0.0.1:${port}/api/sessions/${sessionId}/prepare`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({})
    });

    if (!response.ok) {
      throw new Error(`Failed to prepare session: ${response.status}`);
    }

    console.log(JSON.stringify({
      continue: false,
      suppressOutput: true,
      message: 'Session stopped',
    }));

    return 0;
  } catch (error) {
    console.error(JSON.stringify({
      error: error instanceof Error ? error.message : String(error),
      exitCode: 2,
    }));
    return 2;
  }
}
