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

const alerts = (root: ParentNode) => [...root.querySelectorAll('[data-save-failure]')];
const liveAlerts = (root: ParentNode) => [...root.querySelectorAll('[data-save-failure] [role="alert"]')];
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
  // Already announced when it happened: restored without role="alert", so it is not re-announced.
  assert.equal(liveAlerts(second.container).length, 0);
  await second.unmount();
});

test('a save that fails while the board is unmounted is announced on remount (role="alert"), once', async () => {
  seedBoard([card('a', 'Alpha', 'inbox')]);
  let fail!: () => void;
  stubFetch(async (url, init) => {
    if (init?.method === 'PATCH') return new Promise<Response>((_resolve, reject) => { fail = () => reject(new TypeError('Failed to fetch')); });
    if (url.endsWith('/api/tasks/a')) return Promise.reject(new TypeError('Failed to fetch'));
    return undefined;
  });
  const first = await mount(m.React.createElement(m.MissionQueue, { workspaceId: WS }));
  const controller = m.registry.getBoardMoveController(WS);
  await m.React.act(async () => { void controller.start(m.store.useMissionControl.getState().tasks[0], 'assigned'); });
  // Tab switch while the save is pending; it then fails while no board is mounted.
  await first.unmount();
  fail();
  await controller.waitForIdle('a');
  assert.equal(controller.getFailuresSnapshot().length, 1);
  const second = await mount(m.React.createElement(m.MissionQueue, { workspaceId: WS }));
  assert.equal(alerts(second.container).length, 1);
  // Nobody has heard it yet: the restored alert is live, and nothing else speaks the failure.
  assert.equal(liveAlerts(second.container).length, 1);
  assert.doesNotMatch(second.container.querySelector('[data-move-announcements]')?.textContent ?? '', /not/);
  await second.unmount();
  // Announced on that mount: the next tab switch restores it quietly.
  const third = await mount(m.React.createElement(m.MissionQueue, { workspaceId: WS }));
  assert.equal(alerts(third.container).length, 1);
  assert.equal(liveAlerts(third.container).length, 0);
  await third.unmount();
});

test('a failure that is already settled when the board remounts never attaches an alert (not even for one frame)', async () => {
  seedBoard([card('a', 'Alpha', 'inbox')]);
  let fail!: () => void;
  stubFetch(async (url, init) => {
    if (init?.method === 'PATCH') return new Promise<Response>((_resolve, reject) => { fail = () => reject(new TypeError('Failed to fetch')); });
    if (url.endsWith('/api/tasks/a')) return Promise.reject(new TypeError('Failed to fetch'));
    return undefined;
  });
  const first = await mount(m.React.createElement(m.MissionQueue, { workspaceId: WS }));
  const controller = m.registry.getBoardMoveController(WS);
  await m.React.act(async () => { void controller.start(m.store.useMissionControl.getState().tasks[0], 'assigned'); });
  await first.unmount();
  fail();
  await controller.waitForIdle('a');
  assert.equal(controller.getFailuresSnapshot().length, 1);
  // While unmounted, the server reports the card in its target lane (a stream event).
  m.registry.taskStreamHandlers().onTaskUpdated(card('a', 'Alpha', 'assigned', { updated_at: '2026-11-15T10:00:09.000Z' }));
  assert.equal(statusOf('a'), 'assigned');
  const attached: Element[] = [];
  const observer = new win.MutationObserver((records) => {
    for (const record of records) {
      // A node removed again by a later effect is checked through removedNodes: a removed
      // subtree keeps its children, while an added subtree is only seen as it is now.
      for (const node of [...record.addedNodes, ...record.removedNodes]) {
        if (!(node instanceof win.Element)) continue;
        if (node.matches('[role="alert"], [data-save-failure]')) attached.push(node);
        attached.push(...node.querySelectorAll('[role="alert"], [data-save-failure]'));
      }
      if (record.type === 'attributes' && record.target instanceof win.Element && record.target.getAttribute('role') === 'alert') attached.push(record.target);
    }
  });
  observer.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['role'] });
  const second = await mount(m.React.createElement(m.MissionQueue, { workspaceId: WS }));
  await m.React.act(async () => { await wait(40); });
  await second.rerender(m.React.createElement(m.MissionQueue, { workspaceId: WS }));
  await m.React.act(async () => { await wait(40); });
  assert.deepEqual(attached.map((node) => node.outerHTML.slice(0, 80)), [], 'no alert was ever attached');
  assert.equal(controller.getFailuresSnapshot().length, 0, 'the settled failure is cleared in the controller');
  await second.unmount();
  observer.disconnect();
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

test('a failure alert names the card\'s current lane, and the alert list is a bounded scrolling area', async () => {
  seedBoard([card('a', 'Alpha', 'inbox')]);
  stubFetch(async (url, init) => (init?.method === 'PATCH' || url.endsWith('/api/tasks/a') ? Promise.reject(new TypeError('Failed to fetch')) : undefined));
  const view = await mount(m.React.createElement(m.MissionQueue, { workspaceId: WS }));
  await m.React.act(async () => { await moveCard('a', 'assigned'); });
  assert.match(alerts(view.container)[0].textContent ?? '', /Alpha is in Inbox/);
  // The card moves on (another client) to Review: the alert follows the card.
  await m.React.act(async () => { m.store.useMissionControl.getState().updateTaskStatus('a', 'review'); });
  assert.match(alerts(view.container)[0].textContent ?? '', /Alpha is in Review/);
  const list = view.container.querySelector('[data-save-failures]') as HTMLElement;
  assert.ok(list.className.includes('overflow-y-auto') && list.className.includes('max-h-'));
  await view.unmount();
});

test('a live alert is not re-spoken when the card changes lane: its live text is frozen, the current lane is a non-live sibling', async () => {
  seedBoard([card('a', 'Alpha', 'inbox')]);
  stubFetch(async (url, init) => (init?.method === 'PATCH' || url.endsWith('/api/tasks/a') ? Promise.reject(new TypeError('Failed to fetch')) : undefined));
  const view = await mount(m.React.createElement(m.MissionQueue, { workspaceId: WS }));
  await m.React.act(async () => { await moveCard('a', 'assigned'); });
  // Either structure (role on the alert box, or on a node inside it): the test is about the live node.
  const live = view.container.querySelector('[data-save-failure] [role="alert"], [role="alert"][data-save-failure]') as HTMLElement;
  assert.ok(live, 'the failure is announced by a live alert');
  const before = live.textContent;
  const mutations: MutationRecord[] = [];
  const observer = new win.MutationObserver((records) => { mutations.push(...records); });
  observer.observe(live, { subtree: true, childList: true, characterData: true, attributes: true });
  await m.React.act(async () => { m.store.useMissionControl.getState().updateTaskStatus('a', 'testing'); });
  await m.React.act(async () => { m.store.useMissionControl.getState().updateTaskStatus('a', 'review'); });
  mutations.push(...observer.takeRecords());
  observer.disconnect();
  assert.equal(mutations.length, 0, 'nothing inside the live alert changed, so nothing is re-read');
  assert.equal(live.textContent, before);
  assert.ok(live.isConnected && live.getAttribute('role') === 'alert');
  // The visible alert still names where the card is now, outside the live node.
  assert.match(alerts(view.container)[0].textContent ?? '', /Alpha is in Review/);
  assert.doesNotMatch(live.textContent ?? '', /is in Review/);
  await view.unmount();
});

test('a Retry refused by the dispatch gate is announced (a retry is not a drag, so dnd-kit says nothing)', async () => {
  const github = { repo_owner: 'example', repo_name: 'repo', issue_number: 7, issue_url: 'https://github.com/example/repo/issues/7' };
  const ready = {
    target_repo: 'example/repo', project_workstream: 'Board', allowed_file_scope: ['src/**'], acceptance_criteria: ['moves'],
    test_requirements: ['npm test'], risk_level: 'low', readiness: 'ready_for_agent', review_mode: 'human_required', impact: 'UI', rollback_plan: 'revert',
  } as Task['dispatch_metadata'];
  seedBoard([card('g', 'Gamma', 'inbox', { github_source: github, dispatch_metadata: ready, dispatch_blockers: [] })]);
  stubFetch(async (url, init) => (init?.method === 'PATCH' || url.endsWith('/api/tasks/g') ? Promise.reject(new TypeError('Failed to fetch')) : undefined));
  const view = await mount(m.React.createElement(m.MissionQueue, { workspaceId: WS }));
  await m.React.act(async () => { await moveCard('g', 'assigned'); });
  // Meanwhile the contract became incomplete; the card is back in Inbox.
  await m.React.act(async () => {
    const t = m.store.useMissionControl.getState().tasks[0];
    m.store.useMissionControl.getState().updateTask({ ...t, dispatch_metadata: { ...ready, readiness: 'needs_grooming' } as Task['dispatch_metadata'] });
  });
  await m.React.act(async () => { button(alerts(view.container)[0], 'Retry move')!.click(); });
  const spoken = view.container.querySelector('[data-move-announcements]')?.textContent ?? '';
  assert.match(spoken, /Gamma cannot move to Assigned yet: the dispatch contract is incomplete\./);
  await view.unmount();
});

/** Record focus() calls so preventScroll can be checked. */
function recordFocus() {
  const calls: { label: string | null; options?: FocusOptions }[] = [];
  const original = win.HTMLElement.prototype.focus;
  win.HTMLElement.prototype.focus = function (this: HTMLElement, options?: FocusOptions) {
    calls.push({ label: this.getAttribute('aria-label') ?? this.textContent?.trim() ?? null, options });
    return original.call(this, options);
  };
  return { calls, restore: () => { win.HTMLElement.prototype.focus = original; } };
}

const failingFetch = (ids: string[]) => stubFetch(async (url, init) =>
  (init?.method === 'PATCH' || ids.some((id) => url.endsWith(`/api/tasks/${id}`)) ? Promise.reject(new TypeError('Failed to fetch')) : undefined));

test('focus that left an alert for the page is not pulled back when that alert auto-clears', async () => {
  seedBoard([card('a', 'Alpha', 'inbox'), card('b', 'Beta', 'inbox')]);
  failingFetch(['a', 'b']);
  const view = await mount(m.React.createElement(m.MissionQueue, { workspaceId: WS }));
  await m.React.act(async () => { await moveCard('a', 'assigned'); await moveCard('b', 'assigned'); });
  assert.equal(alerts(view.container).length, 2);
  // Focus Alpha's Dismiss, then click a blank area: focus goes to <body> (focusout, no focusin).
  const dismiss = button(alerts(view.container)[0], 'Dismiss')!;
  dismiss.focus();
  assert.ok(document.activeElement === dismiss);
  await m.React.act(async () => { dismiss.blur(); await wait(0); });
  // (Compare names, not elements: a failing assert on two jsdom nodes tries to diff them.)
  const focused = () => (document.activeElement === document.body ? 'body' : document.activeElement?.textContent?.trim() ?? String(document.activeElement));
  assert.equal(focused(), 'body');
  // Later the server puts Alpha in its target and its alert clears: focus must stay where it is.
  await m.React.act(async () => { m.store.useMissionControl.getState().updateTaskStatus('a', 'assigned'); });
  await m.React.act(async () => { await wait(80); });
  assert.equal(alerts(view.container).length, 1);
  assert.equal(focused(), 'body', 'focus did not jump to Beta\'s alert or the board');
  await view.unmount();
});

test('the polite move region speaks each addition on its own (aria-atomic="false", one node per announcement)', async () => {
  seedBoard([card('a', 'Alpha', 'inbox'), card('b', 'Beta', 'inbox')]);
  stubFetch(async (url, init) => {
    if (init?.method === 'PATCH') {
      const id = url.split('/').pop()!;
      return json({ ...card(id, id === 'a' ? 'Alpha' : 'Beta', 'assigned'), updated_at: '2026-11-15T10:00:05.000Z' });
    }
    return undefined;
  });
  const view = await mount(m.React.createElement(m.MissionQueue, { workspaceId: WS }));
  await m.React.act(async () => { await moveCard('a', 'assigned'); });
  await m.React.act(async () => { await moveCard('b', 'assigned'); });
  const region = view.container.querySelector('[data-move-announcements]') as HTMLElement;
  // role="status" defaults to aria-atomic="true", which would re-read "Moved Alpha" with "Moved Beta".
  assert.equal(region.getAttribute('role'), 'status');
  assert.equal(region.getAttribute('aria-atomic'), 'false');
  assert.equal(region.getAttribute('aria-relevant'), 'additions');
  const entries = [...region.children].map((node) => node.textContent);
  assert.deepEqual(entries, ['Moved Alpha to Assigned.', 'Moved Beta to Assigned.']);
  await view.unmount();
});

test('auto-clear leaves focus alone when it is outside the alert; when it was on the alert, focus goes to the board without scrolling', async () => {
  seedBoard([card('a', 'Alpha', 'inbox'), card('b', 'Beta', 'inbox')]);
  failingFetch(['a', 'b']);
  const view = await mount(m.React.createElement(m.MissionQueue, { workspaceId: WS }));
  await m.React.act(async () => { await moveCard('a', 'assigned'); await moveCard('b', 'assigned'); });
  assert.equal(alerts(view.container).length, 2);
  // Focus elsewhere (New Task): the server puts Alpha in its target, its alert clears, focus stays.
  const newTask = button(view.container, 'New Task')!;
  newTask.focus();
  await m.React.act(async () => { m.store.useMissionControl.getState().updateTaskStatus('a', 'assigned'); });
  await m.React.act(async () => { await wait(80); });
  assert.equal(alerts(view.container).length, 1);
  assert.equal(document.activeElement, newTask);
  // Focus on Beta's Retry: its alert clears the same way, and focus moves to the board.
  const focus = recordFocus();
  try {
    button(alerts(view.container)[0], 'Retry move')!.focus();
    await m.React.act(async () => { m.store.useMissionControl.getState().updateTaskStatus('b', 'assigned'); });
    await m.React.act(async () => { await wait(80); });
    assert.equal(alerts(view.container).length, 0);
    assert.equal((document.activeElement as HTMLElement | null)?.getAttribute('aria-label'), 'Mission queue board');
    const boardFocus = focus.calls.find((call) => call.label === 'Mission queue board');
    assert.deepEqual(boardFocus?.options, { preventScroll: true });
  } finally {
    focus.restore();
  }
  await view.unmount();
});

test('a not-saved alert clears itself once the card reaches its target', async () => {
  seedBoard([card('a', 'Alpha', 'inbox')]);
  stubFetch(async (url, init) => {
    if (init?.method === 'PATCH') return json({ error: 'Conflict' }, 409);
    if (url.endsWith('/api/tasks/a')) return json(card('a', 'Alpha', 'inbox'));
    return undefined;
  });
  const view = await mount(m.React.createElement(m.MissionQueue, { workspaceId: WS }));
  await m.React.act(async () => { await moveCard('a', 'assigned'); });
  assert.equal(alerts(view.container).length, 1);
  assert.equal(button(alerts(view.container)[0], 'Retry move'), undefined); // not-saved: no retry
  await m.React.act(async () => { m.store.useMissionControl.getState().updateTaskStatus('a', 'assigned'); });
  await m.React.act(async () => { await wait(20); });
  assert.equal(alerts(view.container).length, 0);
  await view.unmount();
});

test('Dismiss moves focus to the next alert when there is one', async () => {
  seedBoard([card('a', 'Alpha', 'inbox'), card('b', 'Beta', 'inbox')]);
  failingFetch(['a', 'b']);
  const view = await mount(m.React.createElement(m.MissionQueue, { workspaceId: WS }));
  await m.React.act(async () => { await moveCard('a', 'assigned'); await moveCard('b', 'assigned'); });
  const dismiss = button(alerts(view.container)[0], 'Dismiss')!;
  dismiss.focus();
  await m.React.act(async () => { dismiss.click(); });
  await m.React.act(async () => { await wait(80); });
  assert.equal(alerts(view.container).length, 1);
  const focused = document.activeElement as HTMLElement | null;
  assert.equal(focused?.closest('[data-save-failure]')?.getAttribute('data-save-failure'), 'b');
  await view.unmount();
});

/** Open a card's dialog from the board (the card's open button). */
async function openCardDialog(root: ParentNode, title: string) {
  const cardEl = [...root.querySelectorAll('[data-task-card]')].find((el) => el.textContent?.includes(title))!;
  const open = [...cardEl.querySelectorAll('button')].find((b) => !b.hasAttribute('data-task-drag-handle'))!;
  await m.React.act(async () => { open.click(); });
  await m.React.act(async () => { await wait(20); });
}

test('the board\'s dialog waits for the card\'s pending drag save before saving (beforeSave -> waitForIdle)', async () => {
  seedBoard([card('a', 'Alpha', 'inbox')]);
  const patches: string[] = [];
  let releaseDrag!: (response: Response) => void;
  stubFetch(async (url, init) => {
    if (init?.method !== 'PATCH' || !url.endsWith('/api/tasks/a')) return undefined;
    const body = JSON.parse(String(init.body));
    if (Object.keys(body).length === 1 && body.status) {
      patches.push('drag');
      return new Promise<Response>((resolve) => { releaseDrag = resolve; });
    }
    patches.push('dialog');
    return json({ ...card('a', String(body.title), 'assigned'), updated_at: '2026-11-15T10:00:06.000Z' });
  });
  const view = await mount(m.React.createElement(m.MissionQueue, { workspaceId: WS }));
  const controller = m.registry.getBoardMoveController(WS);
  await m.React.act(async () => { void controller.start(m.store.useMissionControl.getState().tasks[0], 'assigned'); });
  await openCardDialog(view.container, 'Alpha');
  setValue(document.querySelector('[role="dialog"] input') as HTMLInputElement, 'Alpha renamed');
  const form = document.querySelector('[role="dialog"] form') as HTMLFormElement;
  await m.React.act(async () => { form.requestSubmit(); });
  await m.React.act(async () => { await wait(50); });
  assert.deepEqual(patches, ['drag'], 'the dialog save waits while the drag save is pending');
  await m.React.act(async () => {
    releaseDrag(json({ ...card('a', 'Alpha', 'assigned'), updated_at: '2026-11-15T10:00:05.000Z' }));
    await controller.waitForIdle('a');
    await wait(50);
  });
  assert.deepEqual(patches, ['drag', 'dialog']);
  await view.unmount();
});

test('a dialog-save response is reported to the move controller (it becomes the confirmed lane if the drag save is lost)', async () => {
  seedBoard([card('a', 'Alpha', 'inbox')]);
  let rejectDrag!: (error: unknown) => void;
  stubFetch(async (url, init) => {
    if (!url.endsWith('/api/tasks/a')) return undefined;
    if (init?.method !== 'PATCH') return Promise.reject(new TypeError('Failed to fetch')); // re-reads fail
    const body = JSON.parse(String(init.body));
    if (Object.keys(body).length === 1 && body.status) return new Promise<Response>((_, reject) => { rejectDrag = reject; });
    // The dialog's save answers with the server copy: Review, newer than the move's origin.
    return json({ ...card('a', String(body.title), 'review'), updated_at: '2026-11-15T10:00:06.000Z' });
  });
  const controller = m.registry.getBoardMoveController(WS);
  let run!: Promise<void>;
  await m.React.act(async () => { run = controller.start(m.store.useMissionControl.getState().tasks[0], 'assigned'); });
  // A standalone dialog (no beforeSave) saves while the drag save is still pending.
  const view = await mount(m.React.createElement(m.TaskModal, { task: card('a', 'Alpha', 'assigned'), onClose: () => {}, workspaceId: WS }));
  setValue(document.querySelector('[role="dialog"] input') as HTMLInputElement, 'Alpha renamed');
  await submitDialog();
  await m.React.act(async () => { rejectDrag(new TypeError('Failed to fetch')); await run; });
  assert.equal(statusOf('a'), 'review');
  await view.unmount();
});

test('a move that saved and was then moved on by the board is announced politely, with no failure alert', async () => {
  seedBoard([card('a', 'Alpha', 'inbox')]);
  let answer!: (response: Response) => void;
  stubFetch(async (url, init) => {
    if (init?.method === 'PATCH') return new Promise<Response>((resolve) => { answer = resolve; });
    if (url.endsWith('/api/tasks/a')) return json(card('a', 'Alpha', 'in_progress', { updated_at: '2026-11-15T10:00:02.000Z' }));
    return undefined;
  });
  const view = await mount(m.React.createElement(m.MissionQueue, { workspaceId: WS }));
  const controller = m.registry.getBoardMoveController(WS);
  await m.React.act(async () => { void controller.start(m.store.useMissionControl.getState().tasks[0], 'assigned'); });
  // Another client moves the card to In progress (10:00:02) before this PATCH's answer (Assigned, 10:00:01) arrives.
  await m.React.act(async () => {
    m.registry.taskStreamHandlers().onTaskUpdated(card('a', 'Alpha', 'in_progress', { updated_at: '2026-11-15T10:00:02.000Z' }));
    answer(json({ ...card('a', 'Alpha', 'assigned'), updated_at: '2026-11-15T10:00:01.000Z' }));
    await controller.waitForIdle('a');
  });
  assert.equal(statusOf('a'), 'in_progress');
  assert.equal(alerts(view.container).length, 0, 'no "Move not saved" alert for a move that saved');
  const spoken = [...view.container.querySelectorAll('[data-move-announcements] > *')].map((node) => node.textContent);
  assert.deepEqual(spoken, ['Moved Alpha to Assigned, then the board moved it to In progress.']);
  await view.unmount();
});

test('each alert\'s buttons are named for their card (WCAG 2.4.6), keeping the visible words first (2.5.3)', async () => {
  seedBoard([card('a', 'Alpha', 'inbox'), card('b', 'Beta', 'inbox')]);
  failingFetch(['a', 'b']);
  const view = await mount(m.React.createElement(m.MissionQueue, { workspaceId: WS }));
  await m.React.act(async () => { await moveCard('a', 'assigned'); await moveCard('b', 'assigned'); });
  const names = alerts(view.container).map((alert) => [...alert.querySelectorAll('button')].map((b) => b.getAttribute('aria-label') ?? b.textContent?.trim()));
  assert.deepEqual(names, [
    ['Retry move of Alpha', 'Dismiss alert for Alpha'],
    ['Retry move of Beta', 'Dismiss alert for Beta'],
  ]);
  for (const b of view.container.querySelectorAll<HTMLButtonElement>('[data-save-failure] button')) {
    assert.ok((b.getAttribute('aria-label') ?? '').startsWith(b.textContent!.trim()), 'the visible label starts the accessible name');
  }
  await view.unmount();
});
