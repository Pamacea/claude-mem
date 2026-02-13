/**
 * PostToolUse Hook
 *
 * Runs after Claude uses a tool (MCP tool, script, etc.)
 *
 * Responsibilities:
 * - Capture tool usage observations
 * - Extract patterns from tool calls
 * - Store for memory compression
 *
 * Exit codes:
 * - 0: Success (observation captured, continue processing)
 * - 3: User message only (stdout shown to user, stderr hidden)
 */
import { getSessionId } from '../shared/hook-constants.js';
import { getWorkerPort } from '../shared/worker-utils.js';

export async function handlePostToolUse(): Promise<number> {
  try {
    const sessionId = getSessionId();

    // Get tool use data from stdin
    const { readJsonFromStdin } = await import('../cli/stdin-reader.js');
    const input = await readJsonFromStdin();

    // Save observation for memory via Worker API
    const port = getWorkerPort();
    const response = await fetch(`http://127.0.0.1:${port}/api/sessions/${sessionId}/observation`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        observation: input
      })
    });

    if (!response.ok) {
      throw new Error(`Failed to save observation: ${response.status}`);
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
