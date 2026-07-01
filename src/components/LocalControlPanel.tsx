'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  ArrowUpRight,
  Bot,
  CheckCircle2,
  Database,
  Github,
  Info,
  Loader2,
  Monitor,
  RadioTower,
  RefreshCw,
  Server,
  Workflow,
} from 'lucide-react';
import {
  LOCAL_CONTROL_GROUP_LABELS,
  LOCAL_CONTROL_SURFACES,
  getDefaultHealthForSurface,
  mapHealthPayload,
  type LocalControlGroup,
  type LocalControlHealth,
  type LocalControlHealthState,
  type LocalControlSurface,
} from '@/lib/local-control-panel';

type HealthBySurface = Record<string, LocalControlHealth>;

const GROUPS: LocalControlGroup[] = ['work-cockpits', 'memory-agents', 'automation-health', 'readiness'];

function buildInitialHealth(): HealthBySurface {
  return Object.fromEntries(
    LOCAL_CONTROL_SURFACES.map((surface) => [surface.id, getDefaultHealthForSurface(surface)])
  );
}

function healthClasses(state: LocalControlHealthState): string {
  switch (state) {
    case 'ok':
      return 'border-emerald-400/30 bg-emerald-500/10 text-emerald-100';
    case 'limited':
      return 'border-amber-400/30 bg-amber-500/10 text-amber-100';
    case 'attention':
      return 'border-rose-400/30 bg-rose-500/10 text-rose-100';
    default:
      return 'border-mc-border bg-mc-bg-tertiary text-mc-text-secondary';
  }
}

function HealthIcon({ state }: { state: LocalControlHealthState }) {
  if (state === 'ok') {
    return <CheckCircle2 className="size-3.5" />;
  }

  if (state === 'attention' || state === 'limited') {
    return <AlertTriangle className="size-3.5" />;
  }

  return <Info className="size-3.5" />;
}

function SurfaceIcon({ surface }: { surface: LocalControlSurface }) {
  if (surface.id.includes('github')) return <Github className="size-4" />;
  if (surface.id.includes('openclaw')) return <Bot className="size-4" />;
  if (surface.id.includes('n8n')) return <Workflow className="size-4" />;
  if (surface.id.includes('memsys')) return <Database className="size-4" />;
  if (surface.id.includes('hermes')) return <RadioTower className="size-4" />;
  if (surface.id.includes('mission-control') || surface.id.includes('command-center')) return <Monitor className="size-4" />;
  if (surface.id.includes('runtime-regression')) return <Activity className="size-4" />;
  if (surface.id.includes('sync')) return <RefreshCw className="size-4" />;
  return <Server className="size-4" />;
}

async function fetchJson(path: string, signal: AbortSignal): Promise<unknown> {
  const response = await fetch(path, { cache: 'no-store', signal });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(typeof payload.error === 'string' ? payload.error : `HTTP ${response.status}`);
  }

  return payload;
}

export function LocalControlPanel() {
  const [health, setHealth] = useState<HealthBySurface>(() => buildInitialHealth());
  const [refreshing, setRefreshing] = useState(true);

  const groupedSurfaces = useMemo(() => {
    return GROUPS.map((group) => ({
      group,
      surfaces: LOCAL_CONTROL_SURFACES.filter((surface) => surface.group === group),
    }));
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    let active = true;

    async function refreshHealth() {
      setRefreshing(true);
      const checks = LOCAL_CONTROL_SURFACES.filter((surface) => (
        surface.healthSource === 'github' ||
        surface.healthSource === 'openclaw' ||
        surface.healthSource === 'n8n-sync' ||
        surface.healthSource === 'runtime-regression'
      ));

      const updates = await Promise.all(checks.map(async (surface) => {
        try {
          const payload = await fetchJson(surface.detailHref ?? surface.href, controller.signal);
          return [surface.id, mapHealthPayload(surface.healthSource, payload)] as const;
        } catch (error) {
          if (controller.signal.aborted) {
            return null;
          }

          return [surface.id, {
            state: 'attention',
            label: 'Check failed',
            detail: error instanceof Error ? error.message : 'Local diagnostic endpoint failed.',
          } satisfies LocalControlHealth] as const;
        }
      }));

      if (!active || controller.signal.aborted) {
        return;
      }

      setHealth((current) => ({
        ...current,
        ...Object.fromEntries(updates.filter((update): update is NonNullable<typeof update> => Boolean(update))),
      }));
      setRefreshing(false);
    }

    void refreshHealth();

    return () => {
      active = false;
      controller.abort();
    };
  }, []);

  return (
    <section className="mb-6 border-y border-mc-border bg-mc-bg-secondary px-4 py-4 md:px-5">
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div>
          <div className="flex items-center gap-2 text-sm font-semibold uppercase text-mc-text-secondary">
            <Activity className="size-4 text-mc-accent-cyan" />
            Local Control
          </div>
          <h2 className="mt-1 text-lg font-semibold text-mc-text">Workspace surfaces and health</h2>
        </div>
        <div className="flex items-center gap-2 rounded border border-mc-border bg-mc-bg px-3 py-2 text-xs text-mc-text-secondary">
          {refreshing ? <Loader2 className="size-3.5 animate-spin text-mc-accent-cyan" /> : <CheckCircle2 className="size-3.5 text-emerald-300" />}
          {refreshing ? 'Checking diagnostics' : 'Diagnostics refreshed'}
        </div>
      </div>

      <div className="mt-3 grid gap-3 xl:grid-cols-4">
        {groupedSurfaces.map(({ group, surfaces }) => (
          <article key={group} className="min-w-0 rounded-lg border border-mc-border bg-mc-bg">
            <h3 className="border-b border-mc-border px-3 py-2 text-xs font-semibold uppercase text-mc-text-secondary">
              {LOCAL_CONTROL_GROUP_LABELS[group]}
            </h3>
            <div className="divide-y divide-mc-border">
              {surfaces.map((surface) => {
                const surfaceHealth = health[surface.id] ?? getDefaultHealthForSurface(surface);
                return (
                  <div
                    key={surface.id}
                    title={surface.description}
                    className="grid min-h-[48px] grid-cols-[1fr_auto] gap-2 px-3 py-1.5 transition-colors hover:bg-mc-bg-secondary/60"
                  >
                    <div className="min-w-0">
                      <div className="flex min-w-0 items-center gap-2">
                        <span className="rounded-md border border-mc-border bg-mc-bg-tertiary p-1 text-mc-accent-cyan">
                          <SurfaceIcon surface={surface} />
                        </span>
                        <h4 className="truncate text-sm font-semibold text-mc-text">{surface.name}</h4>
                      </div>
                      <div className="mt-1 flex min-w-0 items-center gap-2">
                        <span className={`inline-flex max-w-[44%] items-center gap-1.5 rounded border px-2 py-0.5 text-[11px] ${healthClasses(surfaceHealth.state)}`}>
                          <HealthIcon state={surfaceHealth.state} />
                          <span className="font-medium">{surfaceHealth.label}</span>
                          <span className="sr-only">{surfaceHealth.detail}</span>
                        </span>
                        <span className="min-w-0 truncate text-[11px] text-mc-text-secondary">{surface.displayUrl}</span>
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-1 self-center">
                      {surface.detailHref && surface.detailHref !== surface.href ? (
                        <a
                          href={surface.detailHref}
                          target={surface.detailHref.startsWith('http') ? '_blank' : undefined}
                          rel={surface.detailHref.startsWith('http') ? 'noreferrer' : undefined}
                          aria-label={`Open ${surface.name} details`}
                          title={`Open ${surface.name} details`}
                          className="inline-flex size-8 items-center justify-center rounded border border-mc-border text-mc-text-secondary hover:bg-mc-bg-tertiary hover:text-mc-text"
                        >
                          <Info className="size-3.5" />
                        </a>
                      ) : null}
                      <a
                        href={surface.href}
                        target={surface.href.startsWith('http') ? '_blank' : undefined}
                        rel={surface.href.startsWith('http') ? 'noreferrer' : undefined}
                        aria-label={`Open ${surface.name}`}
                        title={`Open ${surface.name}`}
                        className="inline-flex size-8 items-center justify-center rounded border border-mc-border text-mc-text hover:border-mc-accent/60 hover:bg-mc-bg-tertiary"
                      >
                        <ArrowUpRight className="size-3.5" />
                      </a>
                    </div>
                  </div>
                );
              })}
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
