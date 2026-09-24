# Component-Sourcing Preflight — CockpitLoadingShell

- Target app/surface and component job: mission-control-kanban workspace cockpit — layout-matched pending shell so a load that has not settled cannot paint a confident empty board
- Target-app component checked: yes — `WorkspaceDashboard` already owns the skeleton-card pending pattern (`src/components/WorkspaceDashboard.tsx`); the cockpit page previously painted a fake complete workspace instead
- Component Marketplace primitive checked: OperatorCollapsibleSection / OperatorSourceCard are the wrong job (content, not route pending); no marketplace cockpit-shell primitive
- External pools checked or skipped: shadcn Skeleton was considered; this repo has no Skeleton primitive and the dashboard already uses static token blocks without a new dependency. No pool added.
- Chosen source lane and why: target-app composition of the existing Header plus the dashboard's static skeleton blocks — same tokens, no new package, matches the landed #139 dashboard pending pattern
- Custom missing capability or local constraint: the pending shell must keep `data-workspace-ready=false` and avoid the false pre-data copy; a generic Skeleton package would not encode that contract
- License/access/dependency result: local repo code only; lucide-react already present via Header; no new dependencies
- Proof expected before closeout: `npm run test:cockpit-load-state` plus production side-serve repeated loads; gate script covers this file

Covers: src/components/CockpitLoadingShell.tsx
