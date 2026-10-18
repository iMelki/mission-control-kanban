/**
 * Fictional sample data for the static demo build (`npm run build:demo`).
 *
 * Every name, task and URL here is invented. Nothing refers to a real person,
 * machine, repository or service. Timestamps are relative to the moment the
 * demo is first opened so the board always looks recently active.
 */

import type { DispatchMetadata } from '@/lib/dispatch-contract';
import type {
  Agent,
  Event,
  TaskActivity,
  TaskDeliverable,
  TaskPriority,
  TaskStatus,
  Workspace,
} from '@/lib/types';

export interface DemoTaskRecord {
  id: string;
  title: string;
  description?: string;
  status: TaskStatus;
  priority: TaskPriority;
  assigned_agent_id?: string;
  created_by_agent_id?: string;
  workspace_id: string;
  business_id: string;
  due_date?: string;
  dispatch_metadata?: DispatchMetadata;
  created_at: string;
  updated_at: string;
}

export interface DemoDependencyRecord {
  id: string;
  task_id: string;
  blocked_by_task_id: string;
  note?: string | null;
  created_at: string;
}

export interface DemoState {
  version: number;
  workspaces: Workspace[];
  agents: Agent[];
  tasks: DemoTaskRecord[];
  events: Event[];
  activities: TaskActivity[];
  deliverables: TaskDeliverable[];
  dependencies: DemoDependencyRecord[];
}

export const DEMO_STATE_VERSION = 1;

/** Slugs prerendered by the static export. Workspace creation is disabled in the demo. */
export const DEMO_WORKSPACE_SLUGS = ['orbit-launch', 'help-center'] as const;

const MINUTE = 60_000;

function ago(now: number, minutes: number): string {
  return new Date(now - minutes * MINUTE).toISOString();
}

function inDays(now: number, days: number): string {
  return new Date(now + days * 24 * 60 * MINUTE).toISOString().slice(0, 10);
}

function readyContract(
  workstream: string,
  scope: string[],
  acceptance: string[],
  tests: string[],
  overrides: Partial<DispatchMetadata> = {},
): DispatchMetadata {
  return {
    target_repo: 'orbit/notes-app',
    project_workstream: workstream,
    allowed_file_scope: scope,
    acceptance_criteria: acceptance,
    test_requirements: tests,
    risk_level: 'low',
    readiness: 'ready_for_agent',
    review_mode: 'pair_review',
    impact: 'Visible to beta users after the next release build.',
    rollback_plan: 'Revert the change and ship the previous build from the release channel.',
    ...overrides,
  };
}

export function buildDemoState(now: number = Date.now()): DemoState {
  const workspaces: Workspace[] = [
    {
      id: 'ws-orbit',
      name: 'Orbit Notes 1.0',
      slug: 'orbit-launch',
      description: 'Launch board for Orbit Notes, a fictional note-taking app, run by a small team of AI agents.',
      icon: '🚀',
      default_runtime_type: 'manual',
      default_dispatch_enabled: false,
      created_at: ago(now, 60 * 24 * 21),
      updated_at: ago(now, 30),
    },
    {
      id: 'ws-help',
      name: 'Help Center Refresh',
      slug: 'help-center',
      description: 'Rewrite and reorganise the Orbit Notes help articles before launch.',
      icon: '📚',
      default_runtime_type: 'manual',
      default_dispatch_enabled: false,
      created_at: ago(now, 60 * 24 * 9),
      updated_at: ago(now, 180),
    },
  ];

  const agent = (
    id: string,
    name: string,
    role: string,
    avatar_emoji: string,
    status: Agent['status'],
    workspace_id: string,
    description: string,
    is_master = false,
    runtime_type: Agent['runtime_type'] = 'openclaw',
  ): Agent => ({
    id,
    name,
    role,
    description,
    avatar_emoji,
    status,
    is_master,
    // Labels only: the demo has no gateway, so nothing is ever dispatched.
    runtime_type,
    runtime_config: null,
    dispatch_enabled: runtime_type !== 'manual',
    workspace_id,
    created_at: ago(now, 60 * 24 * 20),
    updated_at: ago(now, 15),
  });

  const agents: Agent[] = [
    agent('ag-atlas', 'Atlas', 'Orchestrator', '🧭', 'working', 'ws-orbit', 'Breaks launch goals into tasks, assigns them and keeps the board moving.', true),
    agent('ag-pixel', 'Pixel', 'Frontend Engineer', '🎨', 'working', 'ws-orbit', 'Owns the editor, theming and the in-app onboarding.'),
    agent('ag-forge', 'Forge', 'Backend Engineer', '🔧', 'working', 'ws-orbit', 'Sync service, exports, sharing and rate limits.'),
    agent('ag-sentry', 'Sentry', 'QA Engineer', '🧪', 'standby', 'ws-orbit', 'End-to-end tests, accessibility checks and release sign-off.'),
    agent('ag-quill', 'Quill', 'Release Writer', '✍️', 'standby', 'ws-orbit', 'Release notes, store listing copy and launch emails.', false, 'manual'),
    agent('ag-scout', 'Scout', 'Research Analyst', '🔭', 'offline', 'ws-orbit', 'User research, survey analysis and pricing studies.'),
    agent('ag-lumen', 'Lumen', 'Docs Editor', '💡', 'working', 'ws-help', 'Edits help articles for clarity and tone.'),
    agent('ag-echo', 'Echo', 'Content Librarian', '🗂️', 'standby', 'ws-help', 'Keeps the help center structure, tags and links tidy.', false, 'manual'),
  ];

  const task = (
    id: string,
    title: string,
    status: TaskStatus,
    priority: TaskPriority,
    minutesAgo: number,
    extra: Partial<DemoTaskRecord> = {},
  ): DemoTaskRecord => ({
    id,
    title,
    status,
    priority,
    workspace_id: 'ws-orbit',
    business_id: 'default',
    created_by_agent_id: 'ag-atlas',
    created_at: ago(now, minutesAgo),
    updated_at: ago(now, Math.max(2, Math.round(minutesAgo / 6))),
    ...extra,
  });

  const tasks: DemoTaskRecord[] = [
    // Planning
    task('t-pricing', 'Decide pricing tiers for the Pro plan', 'planning', 'high', 60 * 26, {
      description: 'Compare three tier layouts against the beta survey and recommend one for launch.',
      assigned_agent_id: 'ag-scout',
    }),
    task('t-tour', 'Outline the first-run onboarding tour', 'planning', 'normal', 60 * 8, {
      description: 'Five steps at most. Cover capture, search and sharing.',
    }),

    // Inbox
    task('t-shortcuts', 'Add a keyboard shortcut cheat sheet', 'inbox', 'normal', 60 * 5, {
      description: 'A modal opened with ? that lists every shortcut, grouped by area.',
      dispatch_metadata: readyContract(
        'Editor',
        ['src/editor/shortcuts/**', 'src/components/ShortcutSheet.tsx'],
        ['Pressing ? opens the sheet', 'Every registered shortcut is listed', 'Esc closes it and returns focus'],
        ['Unit test for the shortcut registry', 'Playwright check for open and close'],
      ),
    }),
    task('t-search', 'Investigate slow search on large vaults', 'inbox', 'high', 60 * 3, {
      description: 'Beta testers with 10k+ notes report 2-3 s search latency. Profile and propose a fix.',
      dispatch_metadata: readyContract(
        'Search',
        ['src/search/**'],
        ['Profile captured on a 10k-note fixture', 'Root cause written up on the task'],
        ['Benchmark script committed with the fixture'],
        { readiness: 'needs_grooming', risk_level: 'medium', review_mode: 'human_required' },
      ),
    }),
    task('t-captions', 'Write app store screenshot captions', 'inbox', 'low', 50, {
      description: 'Six captions, under 30 characters each.',
    }),

    // Assigned
    task('t-conflict', 'Offline sync conflict banner', 'assigned', 'high', 60 * 30, {
      description: 'Show a calm banner when two devices edit the same note offline, with a one-click compare.',
      assigned_agent_id: 'ag-pixel',
      due_date: inDays(now, 3),
      dispatch_metadata: readyContract(
        'Sync',
        ['src/sync/conflicts/**', 'src/components/ConflictBanner.tsx'],
        ['Banner appears on conflicting edits', 'Compare view shows both versions side by side'],
        ['Unit tests for conflict detection', 'Visual check at 390 px and 1440 px'],
        { risk_level: 'medium' },
      ),
    }),
    task('t-ratelimit', 'Rate-limit the share-link endpoint', 'assigned', 'urgent', 60 * 20, {
      description: 'Cap link creation per account and return a friendly error when the limit is hit.',
      assigned_agent_id: 'ag-forge',
      due_date: inDays(now, 1),
      dispatch_metadata: readyContract(
        'Sharing',
        ['services/share/**'],
        ['At most 60 links per hour per account', 'Clients get a clear retry-after message'],
        ['Load test with 200 requests per minute'],
        { risk_level: 'high', review_mode: 'human_required' },
      ),
    }),
    task('t-notes', 'Draft the 1.0 release notes', 'assigned', 'normal', 60 * 12, {
      description: 'Lead with offline sync and sharing. Keep it under 300 words.',
      assigned_agent_id: 'ag-quill',
      due_date: inDays(now, 5),
    }),

    // In progress
    task('t-export', 'Markdown export with embedded images', 'in_progress', 'high', 60 * 50, {
      description: 'Export a notebook as a zip of Markdown files with images in an assets folder.',
      assigned_agent_id: 'ag-forge',
      dispatch_metadata: readyContract(
        'Export',
        ['services/export/**'],
        ['Images keep relative links', 'Export of a 500-note notebook finishes in under 10 s'],
        ['Round-trip test: export then import'],
      ),
    }),
    task('t-darkmode', 'Dark mode polish for the editor', 'in_progress', 'normal', 60 * 40, {
      description: 'Fix low-contrast code blocks and the selection colour in dark mode.',
      assigned_agent_id: 'ag-pixel',
    }),
    task('t-checklist', 'Plan the launch-week checklist', 'in_progress', 'high', 60 * 36, {
      description: 'Day-by-day plan from code freeze to launch, with an owner for every item.',
      assigned_agent_id: 'ag-atlas',
    }),
    task('t-tags', 'Tag autocomplete in the command palette', 'in_progress', 'normal', 60 * 18, {
      assigned_agent_id: 'ag-pixel',
      dispatch_metadata: readyContract(
        'Editor',
        ['src/components/CommandPalette/**'],
        ['Typing # suggests existing tags', 'Arrow keys and Enter pick a suggestion'],
        ['Unit tests for the suggestion ranking'],
      ),
    }),

    // Testing
    task('t-e2e', 'End-to-end tests for note sharing', 'testing', 'high', 60 * 70, {
      description: 'Cover create link, open as guest, revoke and expired links.',
      assigned_agent_id: 'ag-sentry',
    }),
    task('t-crash', 'Crash on empty attachment upload', 'testing', 'urgent', 60 * 9, {
      description: 'Uploading a zero-byte file crashes the desktop app. Fix is in; verifying on all platforms.',
      assigned_agent_id: 'ag-forge',
      dispatch_metadata: readyContract(
        'Attachments',
        ['src/attachments/upload.ts'],
        ['Zero-byte files are rejected with a message', 'No crash on any platform'],
        ['Regression test with a zero-byte fixture'],
        { review_mode: 'auto_checks_only' },
      ),
    }),
    task('t-a11y', 'Accessibility audit of the settings screens', 'testing', 'normal', 60 * 44, {
      description: 'Keyboard order, focus rings, labels and contrast on every settings tab.',
      assigned_agent_id: 'ag-sentry',
    }),

    // Review
    task('t-welcome', 'New welcome email copy', 'review', 'normal', 60 * 60, {
      description: 'Three short paragraphs and one call to action.',
      assigned_agent_id: 'ag-quill',
    }),
    task('t-pinned', 'Pinned notes on the home screen', 'review', 'normal', 60 * 80, {
      assigned_agent_id: 'ag-pixel',
      dispatch_metadata: readyContract(
        'Home',
        ['src/screens/Home/**'],
        ['Up to five pinned notes above recent notes', 'Pin and unpin from the note menu'],
        ['Unit tests for ordering', 'Visual check in light and dark mode'],
      ),
    }),
    task('t-backup', 'Backup export to a single archive', 'review', 'high', 60 * 96, {
      description: 'One-click backup of every notebook, settings included.',
      assigned_agent_id: 'ag-forge',
    }),

    // Done
    task('t-nightly', 'Set up the nightly build pipeline', 'done', 'normal', 60 * 24 * 6, {
      assigned_agent_id: 'ag-atlas',
    }),
    task('t-paste', 'Fix cursor jump when pasting lists', 'done', 'high', 60 * 24 * 4, {
      assigned_agent_id: 'ag-pixel',
    }),
    task('t-icon', 'Choose the 1.0 app icon', 'done', 'low', 60 * 24 * 5, {
      assigned_agent_id: 'ag-quill',
    }),
    task('t-survey', 'Summarise the beta usage survey', 'done', 'normal', 60 * 24 * 3, {
      assigned_agent_id: 'ag-scout',
    }),

    // Help Center Refresh workspace
    task('h-structure', 'Reorganise articles into five sections', 'in_progress', 'high', 60 * 30, {
      workspace_id: 'ws-help', assigned_agent_id: 'ag-echo', created_by_agent_id: 'ag-lumen',
    }),
    task('h-sync', 'Rewrite "How sync works"', 'review', 'normal', 60 * 20, {
      workspace_id: 'ws-help', assigned_agent_id: 'ag-lumen', created_by_agent_id: 'ag-lumen',
    }),
    task('h-glossary', 'Add a glossary page', 'inbox', 'low', 60 * 6, {
      workspace_id: 'ws-help', created_by_agent_id: 'ag-lumen',
    }),
    task('h-links', 'Fix broken links in the sharing guide', 'done', 'normal', 60 * 48, {
      workspace_id: 'ws-help', assigned_agent_id: 'ag-echo', created_by_agent_id: 'ag-lumen',
    }),
  ];

  const dependencies: DemoDependencyRecord[] = [
    { id: 'dep-1', task_id: 't-notes', blocked_by_task_id: 't-e2e', note: 'Notes describe sharing; wait for the sharing tests.', created_at: ago(now, 60 * 11) },
    { id: 'dep-2', task_id: 't-checklist', blocked_by_task_id: 't-ratelimit', note: null, created_at: ago(now, 60 * 10) },
    { id: 'dep-3', task_id: 't-captions', blocked_by_task_id: 't-icon', note: null, created_at: ago(now, 45) },
  ];

  const agentById = new Map(agents.map((item) => [item.id, item]));
  const event = (
    id: string,
    type: Event['type'],
    minutesAgo: number,
    message: string,
    agent_id?: string,
    task_id?: string,
  ): Event => ({
    id,
    type,
    agent_id,
    task_id,
    message,
    created_at: ago(now, minutesAgo),
    agent: agent_id ? agentById.get(agent_id) : undefined,
  });

  const events: Event[] = [
    event('ev-1', 'task_status_changed', 3, 'Task "Crash on empty attachment upload" moved to testing', 'ag-forge', 't-crash'),
    event('ev-2', 'task_created', 6, 'New task: Investigate slow search on large vaults', 'ag-atlas', 't-search'),
    event('ev-3', 'message_sent', 11, 'Sentry: 2 of 14 sharing scenarios fail on expired links. Logging details on the task.', 'ag-sentry', 't-e2e'),
    event('ev-4', 'task_assigned', 19, 'Atlas assigned "Rate-limit the share-link endpoint" to Forge', 'ag-atlas', 't-ratelimit'),
    event('ev-5', 'task_status_changed', 27, 'Task "Backup export to a single archive" moved to review', 'ag-forge', 't-backup'),
    event('ev-6', 'agent_status_changed', 34, 'Scout went offline after finishing the survey summary', 'ag-scout'),
    event('ev-7', 'task_status_changed', 41, 'Task "Tag autocomplete in the command palette" moved to in progress', 'ag-pixel', 't-tags'),
    event('ev-8', 'task_completed', 58, 'Task "Summarise the beta usage survey" moved to done', 'ag-scout', 't-survey'),
    event('ev-9', 'task_created', 75, 'New task: Draft the 1.0 release notes', 'ag-atlas', 't-notes'),
    event('ev-10', 'agent_joined', 90, 'Sentry joined the workspace', 'ag-sentry'),
    event('ev-11', 'task_status_changed', 20, 'Task \'Rewrite "How sync works"\' moved to review', 'ag-lumen', 'h-sync'),
  ];

  const activities: TaskActivity[] = [];
  const activityTemplates: Record<TaskStatus, string[]> = {
    planning: ['Task created'],
    inbox: ['Task created'],
    assigned: ['Task created', 'Assigned and queued'],
    in_progress: ['Task created', 'Assigned and queued', 'Work started'],
    testing: ['Task created', 'Work started', 'Implementation finished, moved to testing'],
    review: ['Task created', 'Work started', 'Checks passed, ready for review'],
    done: ['Task created', 'Work started', 'Reviewed and approved', 'Marked done'],
  };
  for (const item of tasks) {
    const steps = activityTemplates[item.status];
    steps.forEach((message, index) => {
      const minutesAgo = Math.max(1, Math.round(((steps.length - index) / steps.length) * ((now - Date.parse(item.created_at)) / MINUTE)));
      activities.push({
        id: `act-${item.id}-${index}`,
        task_id: item.id,
        agent_id: index === 0 ? item.created_by_agent_id : item.assigned_agent_id,
        activity_type: index === 0 ? 'spawned' : message === 'Marked done' ? 'completed' : 'status_changed',
        message,
        created_at: ago(now, minutesAgo),
      });
    });
  }
  activities.push(
    { id: 'act-e2e-note', task_id: 't-e2e', agent_id: 'ag-sentry', activity_type: 'updated', message: 'Expired links return 500 instead of the friendly page. Sent back to Forge.', created_at: ago(now, 11) },
    { id: 'act-export-file', task_id: 't-export', agent_id: 'ag-forge', activity_type: 'file_created', message: 'Added export format notes', created_at: ago(now, 95) },
  );

  const deliverables: TaskDeliverable[] = [
    { id: 'dl-1', task_id: 't-export', deliverable_type: 'file', title: 'Export format notes', path: 'docs/export-format.md', description: 'Folder layout and image link rules.', created_at: ago(now, 95) },
    { id: 'dl-2', task_id: 't-survey', deliverable_type: 'artifact', title: 'Beta survey summary', description: '412 responses. Top asks: offline sync, sharing, dark mode.', created_at: ago(now, 60 * 24 * 3) },
    { id: 'dl-3', task_id: 't-welcome', deliverable_type: 'artifact', title: 'Welcome email, draft 3', description: 'Shorter intro and a single call to action.', created_at: ago(now, 60 * 4) },
    { id: 'dl-4', task_id: 't-paste', deliverable_type: 'file', title: 'Paste handling fix', path: 'src/editor/paste.ts', created_at: ago(now, 60 * 24 * 4) },
  ];

  return {
    version: DEMO_STATE_VERSION,
    workspaces,
    agents,
    tasks,
    events,
    activities,
    deliverables,
    dependencies,
  };
}
