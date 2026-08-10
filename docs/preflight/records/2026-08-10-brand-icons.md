# Component-Sourcing Preflight — BrandIcons Github shim (mission-control-kanban)

Record for the local Github icon shim added during the fleet lucide-react
version-alignment pass (agent-settings#586 icon ruling, #139). Lucide 1.0
removed all brand icons (https://lucide.dev/guide/version-1); this shim keeps
the exact pre-1.0 GitHub glyph so bumping 0.468.0 -> 1.31.0 causes zero
visual drift across the eight GitHub-surface components.

- Target app/surface and component job: mission-control-kanban operator board
  — drop-in `Github` lucide-style icon component (identical props:
  size/color/strokeWidth/className) for GitHubConnectionStatus,
  GitHubImportModal, GitHubReadinessCard, GitHubWritebackPanel,
  LocalControlPanel, MissionQueue, WorkspaceDashboard, and
  task-modal/GitHubIssueDraftPanel, replacing the brand icon removed in
  lucide-react 1.0.
- Target-app component checked: searched src/components and src/components/ui
  — no existing icon-shim or brand-icon primitive; the only prior source of
  the glyph was the lucide-react package itself, which dropped it in 1.0.
- Component Marketplace primitive checked: the local Component Marketplace
  (S:\source\Component-Marketplace\component-marketplace) carries no
  brand-icon or lucide-shim primitive; it consumes lucide-react directly and
  uses no brand icons (verified during the same alignment pass).
- External pools checked or deliberately skipped: lucide 1.x itself removed
  the icons (trademark posture, see their brand-logo statement); upstream
  recommends Simple Icons, but adding a second icon dependency for one glyph
  in an internal, non-published operator board is disproportionate —
  deliberately skipped. Shim reuses lucide-react's own still-supported
  `createLucideIcon` factory with the ISC-licensed pre-1.0 icon node data.
- Chosen source lane and why: local shim over lucide-react's public
  `createLucideIcon` API — zero new dependencies, byte-identical glyph to
  what the board rendered before the bump, and the component remains fully
  lucide-prop-compatible for future swaps.
- License/access/dependency result: icon path data is from pre-1.0
  lucide-react, ISC license (permissive; removal upstream was
  trademark-driven, not copyright); no new dependency added; internal-only
  surface, not published or distributed.
- Proof expected before closeout: `npm run lint` and `npm run build` green on
  lucide-react ^1.31.0 (build fails on any missing icon export), component
  sourcing preflight pass, commit pushed to dev referencing
  agent-settings#586 and #139.
- Covers: src/components/icons/BrandIcons.tsx
