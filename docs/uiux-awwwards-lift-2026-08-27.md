# UI/UX lift evidence — 2026-08-27

Parent: [mission-control-kanban#139](https://github.com/iMelki/mission-control-kanban/issues/139)
Audited commit at start of this pass: `833a44f` (local `dev`).
This note: code-inspection closeout only.

## Score

**UNMEASURED / still 5.7 carried.**

No new Awwwards composite is claimed. This pass did not run a production-build
capture with rubric §2.10 controls (`next build` + `next start` from a detached
worktree, then the scored probe). Capture was skipped as heavy/risky on this
host and because #164 still blocks a surviving scored `next dev` run. Do not
treat the visual/UX edits below as a movement from 5.7.

The 2026-08-09 code-only report remains `docs/uiux-awwwards-report-2026-08-09.md`
(historical 4.9 estimate). Later operator-facing carry is 5.7. The 2026-08-26
production-capture note recorded a measurement-only 5.8→5.9 movement with no
`src/` change; that is not this lift.

## What landed (highest-leverage remaining, not a rewrite)

1. **One accent for competing CTAs.** `Import GitHub` is now an outline
   `mc-accent` control; `New Task` is the single filled primary (`mc-accent`).
   Pink and cyan filled CTAs were removed from the board header, the GitHub
   import load button, and the write-back Dry Run control (Dry Run demoted to
   outline; Apply stays filled).
2. **Reduced motion.** Already present as fleet-motion-primitive Block 2 in
   `src/app/globals.css` (`@media (prefers-reduced-motion: reduce)`). Decorative
   tokens collapse; essential busy indicators keep a slowed opacity pulse.
   This pass did not add a second typeface and did not replace that contract.
3. **Sidebar width is an instant toggle.** `LiveFeed` and `AgentsSidebar` now
   carry `transition-none` on the width-changing `aside`. Collapse still swaps
   `lg:w-12` / `lg:w-80` or `lg:w-64`; it does not animate `width`.
4. **Skip link (WCAG 2.4.1).** First focusable control in `src/app/layout.tsx`
   is `Skip to main content` (`sr-only focus:not-sr-only`). `#main-content`
   exists on every served page (`/`, `/workspace/[slug]`, `/settings`,
   `/n8n-sync-history`, `/runtime-regression`), including the workspace
   not-found state and the dashboard loading skeleton.
5. **Semantic tone tokens (narrow).** Added `mc-success` / `mc-warn` /
   `mc-danger` in `globals.css` and `tailwind.config.ts`. Migrated the board
   `pillClass` map, GitHub readiness pills, and agent runtime-health pills.
   Did not sweep the remaining raw Tailwind palette literals.
6. **Spinner wall.** Dashboard workspace loading no longer uses a pulsing
   lobster glyph. It shows layout-matching skeleton cards plus an `sr-only`
   status.

## Not claimed / still open

- No 8.0+ composite. No gauntlet scorecard. No Frontend Proof Bundle.
- #164 (next-dev dies under capture) and #148 (next build) were not started.
- Raw palette drift beyond the three migrated pill maps.
- Focus-visible rings on the remaining `focus:outline-none` sites (#150).
- Contrast pairs below AA (#151).
- Nested-interactive / remaining axe findings (#152).
- Bespoke n8n-sync-history table.
- GitHub-dark clone identity and 7-accent chrome (column tops still use
  pink/yellow/purple as lane markers, not CTAs).

## Maintainability (policy v1, review-only)

Class and landmark edits only on already-oversized `MissionQueue.tsx` and
`AgentsSidebar.tsx`. No new functions extracted; pill maps stay next to their
cards. Dashboard loading grew by a skeleton block inside the existing
component. Tokens are declarative aliases of the existing green/yellow/red
hexes.
