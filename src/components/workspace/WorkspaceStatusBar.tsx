'use client';

import { useCallback, useState, type ComponentType } from 'react';
import Link from 'next/link';
import { AlertTriangle, CheckCircle2, ChevronRight, ExternalLink, Info, Loader2, RefreshCw } from 'lucide-react';

import { GitHubConnectionStatus } from '@/components/GitHubConnectionStatus';
import { GitHubReadinessCard } from '@/components/GitHubReadinessCard';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { formatAgeHours, presentMckN8nSyncFreshness, presentMckN8nSyncRun } from '@/lib/n8n-sync-presentation';
import { cn } from '@/lib/utils';
import {
  explainSyncNote,
  formatReconciliationSuffix,
  formatSyncCadence,
  formatSyncCount,
  formatSyncTimestamp,
  readN8nScheduleTimes,
} from '@/lib/workspace-sync-summary';
import type { MckN8nSyncStatusResponse, Workspace } from '@/lib/types';

export type GitHubSyncState = {
  state: 'idle' | 'syncing' | 'success' | 'error';
  message?: string;
  statusNotes?: string[];
  counts?: { imported: number; updated: number; moved: number; statusReconciled: number; driftWarnings: number };
};

type Tone = 'ok' | 'warn' | 'danger' | 'muted';

const TONE_CLASSES: Record<Tone, string> = {
  ok: 'border-mc-success/35 bg-mc-success/10 text-mc-success',
  warn: 'border-mc-warn/40 bg-mc-warn/10 text-mc-warn',
  danger: 'border-mc-danger/40 bg-mc-danger/10 text-mc-danger',
  muted: 'border-mc-border bg-mc-bg-tertiary/40 text-mc-text-secondary',
};

const HEADING_TONE_CLASSES: Record<Tone, string> = {
  ok: 'text-mc-success',
  warn: 'text-mc-warn',
  danger: 'text-mc-danger',
  muted: 'text-mc-text',
};

type DrawerSection = 'github' | 'notes' | 'n8n' | 'gate' | 'readiness';

interface WorkspaceStatusBarProps {
  workspace: Workspace;
  githubSync: GitHubSyncState;
  n8nSync: MckN8nSyncStatusResponse | null;
  /** Inbox cards the dispatch contract keeps from moving into an active column. */
  gatedInboxCount: number;
  onSyncNow: () => void;
}

function StatusChip({
  tone,
  icon: Icon,
  spin,
  children,
  section,
  onOpen,
}: {
  tone: Tone;
  icon: ComponentType<{ className?: string }>;
  spin?: boolean;
  children: React.ReactNode;
  section: DrawerSection;
  onOpen: (section: DrawerSection) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onOpen(section)}
      className={cn(
        'inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition-colors duration-fast',
        'hover:brightness-125 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-mc-accent',
        TONE_CLASSES[tone],
      )}
    >
      <Icon className={cn('size-3.5', spin && 'animate-spin')} />
      {children}
    </button>
  );
}

function DrawerBlock({
  id,
  active,
  title,
  tone = 'muted',
  children,
}: {
  id: DrawerSection;
  active: boolean;
  title: string;
  tone?: Tone;
  children: React.ReactNode;
}) {
  return (
    <section
      id={`workspace-status-${id}`}
      aria-labelledby={`workspace-status-${id}-title`}
      data-active={active ? 'true' : undefined}
      className={cn(
        'scroll-mt-20 border-b border-mc-border px-5 py-4 text-sm text-mc-text-secondary',
        active && 'bg-mc-bg-tertiary/30',
      )}
    >
      <h3
        id={`workspace-status-${id}-title`}
        className={cn('mb-2 text-xs font-semibold uppercase tracking-wider', HEADING_TONE_CLASSES[tone])}
      >
        {title}
      </h3>
      <div className="space-y-2">{children}</div>
    </section>
  );
}

export function WorkspaceStatusBar({ workspace, githubSync, n8nSync, gatedInboxCount, onSyncNow }: WorkspaceStatusBarProps) {
  const [open, setOpen] = useState(false);
  const [section, setSection] = useState<DrawerSection>('github');

  const latest = n8nSync?.latest ?? null;
  const n8nSummary = (latest?.summary ?? {}) as Record<string, unknown>;
  const n8nRun = latest ? presentMckN8nSyncRun(latest) : null;
  const freshness = presentMckN8nSyncFreshness({
    receivedAt: latest?.received_at,
    schedule: readN8nScheduleTimes(latest),
  });
  const n8nStale = latest !== null && freshness.state === 'stale';
  const n8nAge = freshness.ageHours === null ? '' : formatAgeHours(freshness.ageHours);
  const n8nCounts = latest
    ? `${formatSyncCount(n8nSummary.scanned_items)} scanned, ${formatSyncCount(n8nSummary.updated)} updated, ${formatSyncCount(n8nSummary.errors)} errors${formatReconciliationSuffix(n8nSummary)}`
    : 'no recorded runs yet';

  const syncing = githubSync.state === 'syncing';
  const driftWarnings = githubSync.counts?.driftWarnings ?? 0;
  const notes = githubSync.statusNotes ?? [];

  const openAt = (next: DrawerSection) => {
    setSection(next);
    setOpen(true);
  };

  // Scroll after the drawer has mounted its content, so a chip lands on its own block.
  const scrollToSection = useCallback((node: HTMLDivElement | null) => {
    if (!node || section === 'github') return;
    node.ownerDocument.getElementById(`workspace-status-${section}`)?.scrollIntoView({ block: 'start' });
  }, [section]);

  const n8nTone: Tone = n8nStale || n8nRun?.state === 'warning' ? 'warn' : n8nRun?.state === 'error' ? 'danger' : n8nRun ? 'ok' : 'muted';
  const n8nChip = n8nStale
    ? `n8n stale · ${n8nAge}`
    : n8nRun
      ? `n8n ${n8nRun.label.toLowerCase()}`
      : 'n8n · no runs yet';

  const attention = [githubSync.state === 'error', driftWarnings > 0, n8nTone === 'warn' || n8nTone === 'danger', gatedInboxCount > 0].filter(Boolean).length;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <div
        role="region"
        aria-label="Sync and GitHub status"
        data-workspace-status-bar
        className="flex h-10 items-center gap-2 border-b border-mc-border bg-mc-bg-secondary px-4"
      >
        <span className="hidden shrink-0 items-center gap-2 text-xs text-mc-text-secondary md:inline-flex">
          GitHub Project #{workspace.github_project_number}
          {workspace.github_project_title ? <span className="text-mc-text">{workspace.github_project_title}</span> : null}
        </span>
        <div className="flex min-w-0 flex-1 items-center gap-2 md:hidden">
          <StatusChip
            tone={githubSync.state === 'error' ? 'danger' : attention > 0 ? 'warn' : syncing ? 'muted' : 'ok'}
            icon={syncing ? Loader2 : attention > 0 || githubSync.state === 'error' ? AlertTriangle : CheckCircle2}
            spin={syncing}
            section={githubSync.state === 'error' ? 'github' : driftWarnings > 0 ? 'notes' : n8nTone === 'warn' || n8nTone === 'danger' ? 'n8n' : gatedInboxCount > 0 ? 'gate' : 'github'}
            onOpen={openAt}
          >
            {syncing ? 'Syncing…' : githubSync.state === 'error' ? 'Sync failed' : attention > 0 ? `${attention} to review` : 'Synced'}
          </StatusChip>
        </div>
        <div className="hidden min-w-0 flex-1 items-center gap-2 overflow-x-auto py-1 [scrollbar-width:none] md:flex">
          {githubSync.state === 'error' ? (
            <StatusChip tone="danger" icon={AlertTriangle} section="github" onOpen={openAt}>Sync failed</StatusChip>
          ) : syncing ? (
            <StatusChip tone="muted" icon={Loader2} spin section="github" onOpen={openAt}>Syncing…</StatusChip>
          ) : githubSync.state === 'success' ? (
            <StatusChip tone="ok" icon={CheckCircle2} section="github" onOpen={openAt}>
              Synced · {githubSync.counts?.updated ?? 0} updated
            </StatusChip>
          ) : (
            <StatusChip tone="muted" icon={RefreshCw} section="github" onOpen={openAt}>Not synced yet</StatusChip>
          )}
          {driftWarnings > 0 ? (
            <StatusChip tone="warn" icon={AlertTriangle} section="notes" onOpen={openAt}>
              {driftWarnings} drift
            </StatusChip>
          ) : null}
          <StatusChip
            tone={n8nTone}
            icon={n8nTone === 'ok' ? CheckCircle2 : n8nTone === 'muted' ? RefreshCw : AlertTriangle}
            section="n8n"
            onOpen={openAt}
          >
            {n8nChip}
          </StatusChip>
          {gatedInboxCount > 0 ? (
            <StatusChip tone="warn" icon={AlertTriangle} section="gate" onOpen={openAt}>
              {gatedInboxCount} gated in Inbox
            </StatusChip>
          ) : null}
          {/* Pill-shaped to sit with the chips; the component keeps its own diagnostics fetch. */}
          <div className="shrink-0 [&>div]:rounded-full [&>div]:px-2.5 [&>div]:py-1">
            <GitHubConnectionStatus />
          </div>
        </div>
        <DialogTrigger asChild>
          <button
            type="button"
            onClick={() => setSection('github')}
            className="inline-flex shrink-0 items-center gap-1 rounded border border-mc-border px-2.5 py-1 text-xs text-mc-text-secondary hover:bg-mc-bg-tertiary hover:text-mc-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-mc-accent"
          >
            Details
            <ChevronRight className="size-3.5" />
          </button>
        </DialogTrigger>
        <button
          type="button"
          onClick={onSyncNow}
          disabled={syncing}
          aria-label="Sync workspace now from GitHub Project"
          title="Sync workspace now from GitHub Project"
          className="inline-flex shrink-0 items-center gap-1.5 rounded border border-mc-border px-2.5 py-1 text-xs hover:bg-mc-bg-tertiary disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-mc-accent"
        >
          {syncing ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />}
          Sync now
        </button>
      </div>

      <DialogContent
        ref={scrollToSection}
        showCloseButton={false}
        className="left-auto right-0 top-0 h-[100dvh] max-w-[34rem] translate-x-0 translate-y-0 content-start gap-0 overflow-y-auto rounded-none border-y-0 border-r-0 p-0 animate-slide-in-right"
      >
        <div className="sticky top-0 z-10 flex items-start justify-between gap-3 border-b border-mc-border bg-mc-bg-secondary px-5 py-4">
          <div>
            <DialogTitle className="text-base">Sync and GitHub status</DialogTitle>
            <DialogDescription className="sr-only sm:not-sr-only sm:mt-1.5">
              Everything the status line summarizes. Nothing here is hidden elsewhere.
            </DialogDescription>
          </div>
          <DialogClose
            aria-label="Close status details"
            className="rounded border border-mc-border px-2.5 py-1 text-xs text-mc-text-secondary hover:bg-mc-bg-tertiary hover:text-mc-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-mc-accent"
          >
            Close
          </DialogClose>
        </div>

        <DrawerBlock id="github" active={section === 'github'} title="GitHub Project source">
          <p>
            GitHub Project #{workspace.github_project_number}
            {workspace.github_project_title ? ` (${workspace.github_project_title})` : ''} is the source for this workspace.
          </p>
          {githubSync.message ? (
            <p className={githubSync.state === 'error' ? 'text-mc-danger' : undefined} role="status">{githubSync.message}</p>
          ) : (
            <p>No sync has run in this tab yet.</p>
          )}
          {workspace.github_project_url ? (
            <a
              href={workspace.github_project_url}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-mc-accent hover:underline"
            >
              Open the Project on GitHub <ExternalLink className="size-3" />
            </a>
          ) : null}
        </DrawerBlock>

        <DrawerBlock id="notes" active={section === 'notes'} title="Status notes from this sync" tone={notes.length > 0 ? 'warn' : 'muted'}>
          {notes.length === 0 ? (
            <p>No status reconciliation or drift notes in the last sync.</p>
          ) : (
            <>
              <p className="text-mc-text">GitHub and MCK disagree on {driftWarnings || notes.length} item{(driftWarnings || notes.length) === 1 ? '' : 's'}.</p>
              <ul className="space-y-3">
                {notes.map((note) => {
                  const gloss = explainSyncNote(note);
                  return (
                    <li key={note} className="rounded border border-mc-warn/30 bg-mc-warn/5 p-3">
                      <p className="text-mc-text">{note}</p>
                      {gloss ? <p className="mt-1.5 text-xs">{gloss}</p> : null}
                    </li>
                  );
                })}
              </ul>
              {driftWarnings > notes.length ? (
                <p className="text-xs">Showing the first {notes.length} of {driftWarnings}.</p>
              ) : null}
            </>
          )}
          {githubSync.counts ? (
            <p className="text-xs">
              {githubSync.counts.statusReconciled} status reconciled, {githubSync.counts.driftWarnings} upstream drift warning
              {githubSync.counts.driftWarnings === 1 ? '' : 's'} in this sync.
            </p>
          ) : null}
        </DrawerBlock>

        <DrawerBlock id="n8n" active={section === 'n8n'} title="n8n scheduled sync" tone={n8nTone === 'ok' || n8nTone === 'muted' ? 'muted' : n8nTone}>
          <p className="text-mc-text">
            n8n sync: {n8nRun?.label ?? 'waiting for first scheduled run'}
          </p>
          <p>
            Last run {formatSyncTimestamp(latest?.received_at)}
            {n8nAge ? ` (${n8nAge} ago)` : ''} · {n8nCounts} · {formatSyncCadence(latest)}
          </p>
          {n8nStale ? (
            <p className="flex items-start gap-2 rounded border border-mc-warn/30 bg-mc-warn/5 p-3 text-xs text-mc-text">
              <Info className="mt-0.5 size-3.5 shrink-0 text-mc-warn" />
              <span>
                No run has reported for {n8nAge}, and the schedule should report within {freshness.staleAfterHours} hours. The
                figures above describe that old run across all workspaces, not this sync.
              </span>
            </p>
          ) : null}
          {latest?.alert_message && n8nRun?.showMessage ? <p>{latest.alert_message}</p> : null}
          <Link href="/n8n-sync-history" className="inline-block text-mc-accent hover:underline">
            View history
          </Link>
        </DrawerBlock>

        {gatedInboxCount > 0 ? (
          <DrawerBlock id="gate" active={section === 'gate'} title="Inbox is a safety gate" tone="warn">
            <p>
              {gatedInboxCount} task{gatedInboxCount === 1 ? '' : 's'} cannot move into active columns yet because the dispatch
              contract is incomplete. Open the card and fill allowed file scope, acceptance criteria, test requirements, impact,
              and rollback details.
            </p>
          </DrawerBlock>
        ) : null}

        <DrawerBlock id="readiness" active={section === 'readiness'} title="GitHub import and write-back">
          {/* The card carries its own mx-3 mt-3 for the board column; cancel them inside the drawer. */}
          <div className="-mx-3 -mt-3">
            <GitHubReadinessCard />
          </div>
        </DrawerBlock>
      </DialogContent>
    </Dialog>
  );
}
