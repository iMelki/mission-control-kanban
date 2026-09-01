const DEFAULT_TIMEOUT_MS = 10_000;

export async function fetchWithBudget(
  input: RequestInfo | URL,
  init: RequestInit & { timeoutMs?: number } = {},
): Promise<Response> {
  const { timeoutMs = DEFAULT_TIMEOUT_MS, signal, ...rest } = init;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  const onAbort = () => controller.abort();
  signal?.addEventListener('abort', onAbort, { once: true });

  try {
    return await fetch(input, {
      ...rest,
      cache: rest.cache ?? 'no-store',
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  }
}
