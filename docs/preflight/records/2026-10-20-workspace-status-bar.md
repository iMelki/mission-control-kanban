# Component-Sourcing Preflight — WorkspaceStatusBar

- Target app/surface and component job: mission-control-kanban `/workspace/[slug]` - one compact status line (sync state, drift, n8n freshness, Inbox gate) plus a side drawer that holds the full detail, replacing five stacked banners and panels that pushed the Kanban board to the bottom third of the screen
- Target-app component checked: src/components/ui/dialog.tsx (vendored shadcn/Radix Dialog, already used by six surfaces) gives the focus trap, Escape, aria-modal, portal and focus return; GitHubConnectionStatus and GitHubReadinessCard are reused unchanged inside the new surface; no Popover, Sheet or Drawer exists in src/components
- Component Marketplace primitive checked: component-marketplace src/components/ui has dropdown-menu, navigation-menu and select but no sheet, drawer or popover primitive; nothing there fits a side panel that holds long, mixed content
- External pools checked or deliberately skipped: shadcn/ui Sheet is the same Radix Dialog with side positioning, so the existing vendored Dialog covers it by class override; Radix Popover and React Aria Popover were skipped because a popover is the wrong shape for five sections of text and would add a dependency
- Chosen source lane and why: target-app vendored Dialog (shadcn lane the repo declares in components.json), positioned as a right-edge sheet with `mc-*` tokens and one new `slide-in-right` keyframe on the existing motion tokens; chips are plain buttons in the house style
- License/access/dependency result: no new dependency; Radix Dialog and Lucide are already installed (MIT); shadcn/ui is MIT
- Proof expected before closeout: npm run lint + tsc --noEmit + npm run build green; scripts/verify-component-sourcing-preflight.mjs passes with this record; tests/workspace-sync-summary.test.ts pins the stale-run and drift-gloss rules; before and after screenshots at 1920, 1440 and 390 px show the board height gain and a keyboard open/close of the drawer

Covers: src/components/workspace/WorkspaceStatusBar.tsx
