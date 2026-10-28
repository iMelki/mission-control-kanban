/**
 * Installs the demo network layer. Loaded only by the demo build, through
 * `src/instrumentation-client.demo.ts`, before the app hydrates.
 *
 * - Same-origin `/api/*` and `/metrics` calls are answered in the browser by
 *   `handleDemoRequest` (fixtures plus in-memory writes).
 * - Other same-origin requests (static files, route payloads) pass through.
 * - Any cross-origin request is refused locally, so nothing leaves the page.
 * - EventSource and WebSocket are replaced by inert stand-ins: there is no
 *   realtime server in the demo.
 */

import { DEMO_UNAVAILABLE_MESSAGE, handleDemoRequest } from './api';

const LATENCY_MS = 40;

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'x-demo-mode': '1' },
  });
}

async function readBody(input: RequestInfo | URL, init?: RequestInit): Promise<Record<string, unknown>> {
  let raw: unknown = init?.body;
  if (raw === undefined && input instanceof Request) {
    raw = await input.clone().text();
  }
  if (typeof raw !== 'string' || raw.length === 0) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function isDemoApiPath(pathname: string): boolean {
  return pathname === '/api' || pathname.startsWith('/api/') || pathname === '/metrics';
}

class DemoEventSource extends EventTarget {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSED = 2;
  readonly CONNECTING = 0;
  readonly OPEN = 1;
  readonly CLOSED = 2;
  readonly url: string;
  readonly withCredentials = false;
  readyState = 0;
  onopen: ((this: EventSource, ev: Event) => unknown) | null = null;
  onmessage: ((this: EventSource, ev: MessageEvent) => unknown) | null = null;
  onerror: ((this: EventSource, ev: Event) => unknown) | null = null;

  constructor(url: string | URL) {
    super();
    this.url = String(url);
    // Report an open, silent stream: realtime updates are not part of the demo,
    // and an error here would only trigger reconnect loops.
    setTimeout(() => {
      if (this.readyState === 2) return;
      this.readyState = 1;
      const event = new Event('open');
      this.onopen?.call(this as unknown as EventSource, event);
      this.dispatchEvent(event);
    }, 0);
  }

  close() {
    this.readyState = 2;
  }
}

class DemoWebSocket extends EventTarget {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;

  constructor() {
    super();
    throw new Error(`WebSocket: ${DEMO_UNAVAILABLE_MESSAGE}`);
  }
}

export function installDemoNetwork() {
  if (typeof window === 'undefined') return;
  const flagged = window as unknown as { __mckDemoInstalled?: boolean };
  if (flagged.__mckDemoInstalled) return;
  flagged.__mckDemoInstalled = true;

  const realFetch = window.fetch.bind(window);

  window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const href = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const url = new URL(href, window.location.href);

    if (url.origin !== window.location.origin) {
      return jsonResponse(503, { error: DEMO_UNAVAILABLE_MESSAGE, demo: true });
    }
    if (!isDemoApiPath(url.pathname)) {
      return realFetch(input, init);
    }

    const signal = init?.signal ?? (input instanceof Request ? input.signal : undefined);
    if (signal?.aborted) throw new DOMException('The operation was aborted.', 'AbortError');

    const method = init?.method ?? (input instanceof Request ? input.method : 'GET');
    const body = await readBody(input, init);
    await new Promise((resolve) => setTimeout(resolve, LATENCY_MS));
    if (signal?.aborted) throw new DOMException('The operation was aborted.', 'AbortError');

    const result = handleDemoRequest(method, url, body);
    return jsonResponse(result.status, result.body);
  };

  window.EventSource = DemoEventSource as unknown as typeof EventSource;
  window.WebSocket = DemoWebSocket as unknown as typeof WebSocket;

  if (typeof navigator !== 'undefined' && typeof navigator.sendBeacon === 'function') {
    const realBeacon = navigator.sendBeacon.bind(navigator);
    navigator.sendBeacon = (target: string | URL, data?: BodyInit | null) => {
      const url = new URL(String(target), window.location.href);
      if (url.origin !== window.location.origin || isDemoApiPath(url.pathname)) return false;
      return realBeacon(target, data);
    };
  }
}
