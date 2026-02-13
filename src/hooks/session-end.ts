/**
 * SessionEnd Hook
 *
 * Runs when Claude Code session ends (final hook before termination).
 *
 * Responsibilities:
 * - Compress session into summary
 * - Store summary in database
 * - Clean up temporary files
 *
 * Exit codes:
 * - 0: Success (session compressed and stored)
 * - 2: Blocking error (stderr shown)
 */
import { getSessionId } from '../shared/hook-constants.js';
import { getWorkerPort } from '../shared/worker-utils.js';

export async function handleSessionEnd(): Promise<number> {
  try {
    const sessionId = getSessionId();

    // Compress session and store in database via Worker API
    const port = getWorkerPort();
    const response = await fetch(`http://127.0.0.1:${port}/api/sessions/${sessionId}/compress`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({})
    });

    if (!response.ok) {
      throw new Error(`Failed to compress session: ${response.status}`);
    }

    console.log(JSON.stringify({
      continue: false,
      suppressOutput: true,
      message: 'Session compressed and stored',
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
