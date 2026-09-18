const DEFAULT_TIMEOUT_MS = 10_000;

type BudgetedResponse = {
  response: Response;
  json: <T>() => Promise<T>;
  release: () => void;
};

function createAbortError(reason: unknown): Error {
  if (reason instanceof Error) return reason;

  const error = new Error('Request aborted.');
  error.name = 'AbortError';
  return error;
}

function readJsonWithinBudget<T>(response: Response, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(createAbortError(signal.reason));

  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(createAbortError(signal.reason));
    signal.addEventListener('abort', onAbort, { once: true });

    void response.json()
      .then((payload) => resolve(payload as T), reject)
      .finally(() => signal.removeEventListener('abort', onAbort));
  });
}

export async function fetchWithBudget(
  input: RequestInfo | URL,
  init: RequestInit & { timeoutMs?: number } = {},
): Promise<BudgetedResponse> {
  const { timeoutMs = DEFAULT_TIMEOUT_MS, signal, ...rest } = init;
  if (signal?.aborted) throw createAbortError(signal.reason);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  const onAbort = () => controller.abort(signal?.reason);
  signal?.addEventListener('abort', onAbort, { once: true });
  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  };

  try {
    const response = await fetch(input, {
      ...rest,
      cache: rest.cache ?? 'no-store',
      signal: controller.signal,
    });
    return {
      response,
      json: async <T>() => {
        try {
          return await readJsonWithinBudget<T>(response, controller.signal);
        } finally {
          release();
        }
      },
      release,
    };
  } catch (error) {
    release();
    throw error;
  }
}
