/**
 * A maintenance action's answer for its result panel (RuntimeOpsSettings: retention and
 * callback prune). The status is checked before the body is read: a non-OK answer shows the
 * server's error (or its HTTP status), never an error body as if it were the action's result.
 * Pinned by tests/runtime-ops-settings.test.ts.
 */
export async function readActionResult(response: Response): Promise<Record<string, unknown>> {
  if (!response.ok) {
    const failure = await response.json().catch(() => null);
    return { error: typeof failure?.error === 'string' && failure.error ? failure.error : `The server answered HTTP ${response.status}` };
  }
  return response.json();
}
