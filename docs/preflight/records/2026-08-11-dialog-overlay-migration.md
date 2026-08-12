# Component-Sourcing Preflight — modal overlay migration (mission-control-kanban)

Record for migrating the six remaining hand-rolled `fixed inset-0` overlays onto
the primitives this repository already owns, closing the largest finding in the
2026-08-09 UI/UX audit (#139): none of the six had `role="dialog"`,
`aria-modal`, Escape handling, a focus trap, or focus return. No new component
file is created by this slice — the work is entirely reuse of two existing
primitives, and five files leave the preflight baseline as a result.

- Target app/surface and component job: mission-control-kanban operator board —
  modal dialog shell and destructive/consequential action review for
  `AgentModal`, `TaskModal`, `GitHubImportModal`,
  `WorkspaceDashboard` (create-workspace form + delete-workspace confirm), and
  `task-modal/GitHubIssueDraftPanel` (live GitHub mutation confirm).
- Target-app component checked: `src/components/ui/dialog.tsx` — the vendored
  shadcn/Radix Dialog landed in `2710f96`, already restyled to the `mc-*`
  palette, already supplying focus trap, Escape, `aria-modal`, portal, and
  focus return; and `src/components/ui/action-review-dialog.tsx` +
  `action-review-contract.ts` — the copy-owned EUX-09 action-review primitive
  with the four-question consequence contract, typed-confirmation gate, pending
  state, and inline error surface. Both already in production use in this repo
  (AgentModal and TaskModal delete flows). Nothing else needed to be found.
- Component Marketplace primitive checked: `ActionReviewDialog` in this repo is
  the port of the Component Marketplace primitive
  (`src/components/ui/action-review-dialog.tsx` at `6a49e75`, recorded in
  `docs/preflight/records/2026-08-09-action-review-dialog.md`); the marketplace
  copy remains the upstream. No newer marketplace dialog primitive is required
  for this slice, and re-porting it would fork the copy this repo already owns.
- External pools checked or deliberately skipped: shadcn/ui Dialog and Radix
  Dialog are the upstream of the vendored primitive, so the external pool is
  already the source in use. ReUI/Origin UI/Base UI/React Aria were
  deliberately skipped — adopting a second dialog stack for overlays that a
  present, working, house-styled Radix dialog already covers would add a
  dependency and two competing focus-management models for zero capability
  gain.
- Chosen source lane and why: lane 1 (the target app's own components), because
  the required primitives already exist in-repo and are already the app's live
  convention. The delete-workspace confirm moves to `ActionReviewDialog` with
  `tone="destructive"`; the GitHub issue create/update confirm moves to
  `ActionReviewDialog` with `typedConfirmation`, preserving the exact
  server-issued confirmation phrase; the four remaining form/detail overlays
  move to the `Dialog` primitive with `DialogTitle`/`DialogClose`. No custom
  component is written, so no missing capability needs naming.
- License/access/dependency result: no new dependency —
  `@radix-ui/react-dialog@^1.1.23` is already a direct dependency and is the
  only package these primitives need. shadcn/ui is MIT and vendored by copy;
  Radix Dialog is MIT. Internal operator surface, not published or distributed.
- Proof expected before closeout: `npm run lint`, `npx tsc --noEmit`,
  `npm run build`, full `npm test`, `node scripts/verify-component-sourcing-preflight.mjs`
  green with the five migrated files removed from `component-baseline.json`;
  `grep "fixed inset-0" src` returns only `src/components/ui/dialog.tsx`;
  `npm run smoke:runtime-ui` asserts `[role="dialog"][aria-modal="true"]` and
  closes the agent and task modals with Escape; commit pushed to `dev`
  referencing #139.
- Covers: src/components/AgentModal.tsx
- Covers: src/components/TaskModal.tsx
- Covers: src/components/GitHubImportModal.tsx
- Covers: src/components/WorkspaceDashboard.tsx
- Covers: src/components/task-modal/GitHubIssueDraftPanel.tsx
