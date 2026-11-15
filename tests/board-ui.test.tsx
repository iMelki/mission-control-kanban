/**
 * The board and task dialog rendered in jsdom (#194 round 4): failure alerts and the
 * focus fallback after Retry/Dismiss, alerts and "Saving…" surviving a tab switch, and
 * the dialog's status handling. Run by `npm run test:board-attention` (CI "Board attention").
 */

import assert from 'node:assert/strict';
import test, { after, before } from 'node:test';
import { JSDOM } from 'jsdom';
import type { Task, TaskStatus } from '../src/lib/types';

const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost/', pretendToBeVisual: true });
const win = dom.window as unknown as Window & typeof globalThis;
const globals: Record<string, unknown> = {
  window: win,
  document: win.document,
  navigator: win.navigator,
  HTMLElement: win.HTMLElement,
  HTMLInputElement: win.HTMLInputElement,
  HTMLSelectElement: win.HTMLSelectElement,
  HTMLTextAreaElement: win.HTMLTextAreaElement,
  Element: win.Element,
  Node: win.Node,
  Event: win.Event,
  CustomEvent: win.CustomEvent,
  NodeFilter: win.NodeFilter,
  HTMLFormElement: win.HTMLFormElement,
  HTMLButtonElement: win.HTMLButtonElement,
  SVGElement: win.SVGElement,
  EventTarget: win.EventTarget,
  KeyboardEvent: win.KeyboardEvent,
  MouseEvent: win.MouseEvent,
  PointerEvent: win.MouseEvent,
  FocusEvent: win.FocusEvent,
  MutationObserver: win.MutationObserver,
  DocumentFragment: win.DocumentFragment,
  localStorage: win.localStorage,
  sessionStorage: win.sessionStorage,
  getComputedStyle: win.getComputedStyle.bind(win),
  requestAnimationFrame: win.requestAnimationFrame.bind(win),
  cancelAnimationFrame: win.cancelAnimationFrame.bind(win),
  IS_REACT_ACT_ENVIRONMENT: true,
};
for (const [key, value] of Object.entries(globals)) {
  Object.defineProperty(globalThis, key, { value, configurable: true, writable: true });
}
win.matchMedia = ((query: string) => ({
  matches: false, media: query, onchange: null,
  addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent: () => false,
})) as unknown as typeof win.matchMedia;
class ResizeObserverStub { observe() {} unobserve() {} disconnect() {} }
Object.defineProperty(globalThis, 'ResizeObserver', { value: ResizeObserverStub, configurable: true, writable: true });
(win as unknown as Record<string, unknown>).ResizeObserver = ResizeObserverStub;
win.HTMLElement.prototype.scrollIntoView = () => {};
win.HTMLElement.prototype.hasPointerCapture = () => false;
win.HTMLElement.prototype.releasePointerCapture = () => {};

type Mods = {
  React: typeof import('react');
  createRoot: typeof import('react-dom/client').createRoot;
  MissionQueue: typeof import('../src/components/MissionQueue').MissionQueue;
  TaskModal: typeof import('../src/components/TaskModal').TaskModal;
  registry: typeof import('../src/lib/board-move-registry');
  store: typeof import('../src/lib/store');
};
let m: Mods;
const originalFetch = globalThis.fetch;

before(async () => {
  m = {
    React: await import('react'),
    createRoot: (await import('react-dom/client')).createRoot,
    MissionQueue: (await import('../src/components/MissionQueue')).MissionQueue,
    TaskModal: (await import('../src/components/TaskModal')).TaskModal,
    registry: await import('../src/lib/board-move-registry'),
    store: await import('../src/lib/store'),
  };
});

after(() => {
  globalThis.fetch = originalFetch;
  dom.window.close();
});

const T0 = '2026-11-15T10:00:00.000Z';
const WS = 'ws-ui';
const card = (id: string, title: string, status: TaskStatus, extra: Partial<Task> = {}): Task => ({
  id, title, status, priority: 'normal', workspace_id: WS, business_id: 'default', created_at: T0, updated_at: T0, ...extra,
}) as Task;

type FetchRoute = (url: string, init: RequestInit | undefined) => Promise<Response | undefined> | undefined;
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
/** Route fetches; anything unrouted answers 200 [] so unrelated panels stay quiet. */
function stubFetch(route: FetchRoute) {
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    return (await route(url, init)) ?? json([]);
  }) as typeof fetch;
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function mount(element: import('react').ReactElement) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = m.createRoot(container);
  await m.React.act(async () => { root.render(element); });
  return {
    container,
    rerender: async (next: import('react').ReactElement) => { await m.React.act(async () => { root.render(next); }); },
    unmount: async () => { await m.React.act(async () => root.unmount()); container.remove(); },
  };
}

function seedBoard(tasks: Task[]) {
  m.registry.resetBoardMoveControllers();
  const state = m.store.useMissionControl.getState();
  state.setTasks(tasks);
  state.setBoardLoadStatus('ready');
}

/** A move started the way a drop starts it, inside act so React sees the store and controller updates. */
async function moveCard(id: string, target: TaskStatus) {
  const controller = m.registry.getBoardMoveController(WS);
  const task = m.store.useMissionControl.getState().tasks.find((t) => t.id === id)!;
  let run!: Promise<void>;
  await m.React.act(async () => { run = controller.start(task, target); });
  return run;
}

const alerts = (root: ParentNode) => [...root.querySelectorAll('[role="alert"][data-drop-error="save-failed"]')];
const button = (root: ParentNode, name: string) => [...root.querySelectorAll('button')].find((b) => b.textContent?.trim() === name) as HTMLButtonElement | undefined;
const statusOf = (id: string) => m.store.useMissionControl.getState().tasks.find((t) => t.id === id)?.status;

test('a failed save shows one "Move not saved" alert; Dismiss removes it and focus lands on the board, not the page', async () => {
  seedBoard([card('a', 'Alpha', 'inbox')]);
  stubFetch(async (url, init) => (init?.method === 'PATCH' || url.endsWith('/api/tasks/a') ? Promise.reject(new TypeError('Failed to fetch')) : undefined));
  const view = await mount(m.React.createElement(m.MissionQueue, { workspaceId: WS }));
  await m.React.act(async () => { await moveCard('a', 'assigned'); });
  const shown = alerts(view.container);
  assert.equal(shown.length, 1);
  assert.match(shown[0].textContent ?? '', /Move not saved/);
  assert.match(shown[0].textContent ?? '', /Alpha is in Inbox/);
  // The failure is spoken once: by the alert, not also by the polite region.
  assert.doesNotMatch(view.container.querySelector('[data-move-announcements]')?.textContent ?? '', /not/);
  const dismiss = button(shown[0], 'Dismiss')!;
  dismiss.focus();
  assert.equal(document.activeElement, dismiss);
  await m.React.act(async () => { dismiss.click(); });
  await m.React.act(async () => { await wait(120); });
  assert.equal(alerts(view.container).length, 0);
  assert.equal((document.activeElement as HTMLElement | null)?.getAttribute('aria-label'), 'Mission queue board');
  await view.unmount();
});

test('Retry re-runs the move; when it saves the alert goes and focus stays on the board', async () => {
  seedBoard([card('a', 'Alpha', 'inbox')]);
  let online = false;
  stubFetch(async (url, init) => {
    if (init?.method === 'PATCH') return online ? json({ ...card('a', 'Alpha', 'assigned'), updated_at: '2026-11-15T10:00:05.000Z' }) : Promise.reject(new TypeError('Failed to fetch'));
    if (url.endsWith('/api/tasks/a')) return Promise.reject(new TypeError('Failed to fetch'));
    return undefined;
  });
  const view = await mount(m.React.createElement(m.MissionQueue, { workspaceId: WS }));
  await m.React.act(async () => { await moveCard('a', 'assigned'); });
  const retry = button(alerts(view.container)[0], 'Retry move')!;
  online = true;
  retry.focus();
  await m.React.act(async () => { retry.click(); });
  await m.React.act(async () => { await m.registry.getBoardMoveController(WS).waitForIdle('a'); await wait(120); });
  assert.equal(statusOf('a'), 'assigned');
  assert.equal(alerts(view.container).length, 0);
  assert.equal((document.activeElement as HTMLElement | null)?.getAttribute('aria-label'), 'Mission queue board');
  await view.unmount();
});

test('a failure alert survives a tab switch (unmount and remount of the board)', async () => {
  seedBoard([card('a', 'Alpha', 'inbox')]);
  stubFetch(async (url, init) => (init?.method === 'PATCH' || url.endsWith('/api/tasks/a') ? Promise.reject(new TypeError('Failed to fetch')) : undefined));
  const first = await mount(m.React.createElement(m.MissionQueue, { workspaceId: WS }));
  await m.React.act(async () => { await moveCard('a', 'assigned'); });
  assert.equal(alerts(first.container).length, 1);
  await first.unmount();
  const second = await mount(m.React.createElement(m.MissionQueue, { workspaceId: WS }));
  assert.equal(alerts(second.container).length, 1);
  assert.ok(button(alerts(second.container)[0], 'Retry move'));
  await second.unmount();
});

test('a save in flight is still "Saving…" (aria-busy) after a tab switch, and resolving it while unmounted leaves no stale lock', async () => {
  seedBoard([card('a', 'Alpha', 'inbox')]);
  let answer!: (response: Response) => void;
  stubFetch(async (_url, init) => (init?.method === 'PATCH' ? new Promise<Response>((resolve) => { answer = resolve; }) : undefined));
  const first = await mount(m.React.createElement(m.MissionQueue, { workspaceId: WS }));
  const controller = m.registry.getBoardMoveController(WS);
  // Start the save (as a drop does) without waiting for its answer.
  await m.React.act(async () => { void controller.start(m.store.useMissionControl.getState().tasks[0], 'assigned'); });
  const busy = (root: ParentNode) => root.querySelector('[data-task-card][aria-busy="true"]');
  assert.ok(busy(first.container));
  await first.unmount();
  const second = await mount(m.React.createElement(m.MissionQueue, { workspaceId: WS }));
  assert.ok(busy(second.container), 'the remounted board shows the pending save');
  assert.match(busy(second.container)?.textContent ?? '', /Saving…/);
  await m.React.act(async () => {
    answer(json({ ...card('a', 'Alpha', 'assigned'), updated_at: '2026-11-15T10:00:05.000Z' }));
    await m.registry.getBoardMoveController(WS).waitForIdle('a');
  });
  assert.equal(busy(second.container), null);
  assert.equal(statusOf('a'), 'assigned');
  await second.unmount();
});

function setValue(el: HTMLInputElement | HTMLSelectElement, value: string) {
  const proto = el instanceof win.HTMLSelectElement ? win.HTMLSelectElement.prototype : win.HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(el, value);
  el.dispatchEvent(new win.Event(el instanceof win.HTMLSelectElement ? 'change' : 'input', { bubbles: true }));
}

async function submitDialog() {
  const form = document.querySelector('[role="dialog"] form') as HTMLFormElement;
  await m.React.act(async () => { form.requestSubmit(); });
  await m.React.act(async () => { await wait(50); });
}

test('the dialog does not send a status the user did not change (a stale snapshot is never re-applied)', async () => {
  seedBoard([card('a', 'Alpha', 'assigned')]);
  const sent: Record<string, unknown>[] = [];
  stubFetch(async (url, init) => {
    if (url.endsWith('/api/tasks/a') && init?.method === 'PATCH') {
      const body = JSON.parse(String(init.body));
      sent.push(body);
      return json({ ...card('a', String(body.title), 'inbox'), updated_at: '2026-11-15T10:00:05.000Z' });
    }
    return undefined;
  });
  const view = await mount(m.React.createElement(m.TaskModal, { task: card('a', 'Alpha', 'assigned'), onClose: () => {}, workspaceId: WS }));
  setValue(document.querySelector('[role="dialog"] input') as HTMLInputElement, 'Alpha renamed');
  await submitDialog();
  assert.equal(sent.length, 1);
  assert.equal(sent[0].title, 'Alpha renamed');
  assert.equal('status' in sent[0], false);
  await view.unmount();
});

test('after the dialog is rebuilt from a fresh server copy, a status change is checked against that copy (not the first one)', async () => {
  seedBoard([card('a', 'Alpha', 'assigned')]);
  const sent: Record<string, unknown>[] = [];
  stubFetch(async (url, init) => {
    if (!url.endsWith('/api/tasks/a')) return undefined;
    if (init?.method === 'PATCH') {
      sent.push(JSON.parse(String(init.body)));
      return json({ ...card('a', 'Alpha', 'review'), updated_at: '2026-11-15T10:00:05.000Z' });
    }
    return json(card('a', 'Alpha', 'inbox')); // the server has it in Inbox, as the refreshed copy says
  });
  const props = { onClose: () => {}, workspaceId: WS };
  const view = await mount(m.React.createElement(m.TaskModal, { ...props, task: card('a', 'Alpha', 'assigned') }));
  // A refresh hands the dialog a newer server copy (Inbox); the form is rebuilt from it.
  await view.rerender(m.React.createElement(m.TaskModal, { ...props, task: card('a', 'Alpha', 'inbox', { updated_at: '2026-11-15T10:00:03.000Z' }) }));
  setValue(document.querySelector('[role="dialog"] select') as HTMLSelectElement, 'review');
  await submitDialog();
  assert.equal(document.querySelector('[role="dialog"]')?.textContent?.includes('while the dialog was open'), false, 'not refused');
  assert.equal(sent.length, 1);
  assert.equal(sent[0].status, 'review');
  await view.unmount();
});
