/**
 * SessionStart Hook
 *
 * Runs when Claude Code starts a new session.
 *
 * Responsibilities:
 * - Initialize session state
 * - Load previous context from worker
 * - Inject relevant memories into Claude's context
 *
 * Exit codes:
 * - 0: Success (context added to session)
 * - 2: Blocking error (stderr shown to user)
 */
import { getSessionId } from '../shared/hook-constants.js';
import { fetchKeepAlive } from '../shared/http-client.js';

export async function handleSessionStart(): Promise<number> {
  try {
    const sessionId = getSessionId();

    // Initialize session via Worker API and get context to inject
    const port = Number.parseInt(process.env.WORKER_PORT || '37777');
    const response = await fetchKeepAlive(`http://127.0.0.1:${port}/api/sessions/init`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sessionId,
        project: process.cwd(),
        prompt: ''
      })
    });
    const context = await response.json() as { sessionDbId: number; promptNumber: number };

    // Return context to Claude Code (exit 0 = success)
    console.log(JSON.stringify({
      continue: true,
      suppressOutput: true,
      inject: context,
    }));

    return 0;
  } catch (error) {
    // Exit 2 = blocking error (stderr shown to user)
    console.error(JSON.stringify({
      error: error instanceof Error ? error.message : String(error),
      exitCode: 2,
    }));
    return 2;
  }
}
