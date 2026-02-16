/**
 * UserPromptSubmit Hook
 *
 * Runs when user submits a prompt to Claude.
 *
 * Responsibilities:
 * - Capture user prompts for memory
 * - Extract useful information
 * - Store for session compression
 *
 * Exit codes:
 * - 0: Success (prompt captured, continue processing)
 * - 3: User message only (stdout shown to user, stderr hidden)
 */
import { getSessionId } from '../shared/hook-constants.js';
import { getWorkerPort } from '../shared/worker-utils.js';
import { fetchKeepAlive } from '../shared/http-client.js';

export async function handleUserPromptSubmit(): Promise<number> {
  try {
    const sessionId = getSessionId();

    // Get prompt from stdin (already parsed by hook-command)
    const { readJsonFromStdin } = await import('../cli/stdin-reader.js');
    const input = await readJsonFromStdin();

    // Save prompt for session summarization via Worker API
    const port = getWorkerPort();
    const response = await fetchKeepAlive(`http://127.0.0.1:${port}/api/sessions/${sessionId}/prompt`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        prompt: input.prompt || input
      })
    });

    if (!response.ok) {
      throw new Error(`Failed to save prompt: ${response.status}`);
    }

    // Exit 3 = user message only (stdout shown, stderr hidden)
    // This allows Claude's response to be shown to user
    console.log(JSON.stringify({
      continue: true,
      suppressOutput: false,
      exitCode: 3,
    }));

    return 3;
  } catch (error) {
    console.error(JSON.stringify({
      error: error instanceof Error ? error.message : String(error),
      exitCode: 2,
    }));
    return 2;
  }
}
