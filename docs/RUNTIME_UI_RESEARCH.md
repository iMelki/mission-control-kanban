# Runtime UI Research Notes

Last updated: 2026-07-01

This slice researched community/vendor guidance before implementation.

## Sources checked

- shadcn/ui official docs and blocks: Sidebar, Badge, Dialog, Drawer, Sheet, Command, Data Table, Resizable.
- ReUI docs/examples: filters, data grid, timeline, dashboard density patterns.
- Radix UI and Base UI primitive docs for accessible dialog/popover/toggle foundations.
- Free/open shadcn-compatible/admin examples: shadcn-admin-kit, shadcn-admin, Shadcn Space, TailAdmin, shadcn timeline examples.
- Playwright docs: emulation/projects/assertions/screenshots/CI guidance.
- Webhook/community guidance: Stripe webhook docs, GitHub webhook failed-delivery docs, MSW mock-server guidance, Next.js env-var docs, Svix/Invicti webhook security guidance, Ajv/JSON Schema guidance.

## Decisions applied

- Use visible runtime filter chips instead of hidden filter state; this follows shadcn/ReUI filter-chip patterns for dense operator dashboards.
- Use compact badge/health labels on agent rows and task cards. Color is paired with text so state is not color-only.
- Add a dispatch timeline rather than overloading the activity feed; operators need adapter outcome, attempt number, HTTP status, redacted webhook URL, and retry eligibility in one place.
- Keep retry row-level and disabled unless the latest attempt is a failed/timeout webhook dispatch. Bulk retry remains deferred.
- Add a small local `Panel` primitive instead of importing a new component package. MCK already has a mature Tailwind surface; the immediate gain is consistent panel anatomy, not a new dependency.
- For generic future primitives, prefer known pools first: shadcn Sheet/Dialog/Sidebar/Resizable, ReUI Frame/Timeline/DataGrid, Radix/Base UI for accessibility foundations, and TanStack Table for dense grids. Only extract MCK custom components when they encode runtime semantics, operator copy, or repeated app-specific layout.
- Split modal sections only where it reduces domain complexity; avoid creating generic wrappers that duplicate shadcn/ReUI components.
- Keep responsive smoke focused on shell usability: Mission Queue visible, runtime filter accessible, New Task reachable, and no document-level horizontal overflow on tablet/mobile.
- Keep `.hermes/plans` local. Durable content lives in source docs and shared workflow assets.

## Component-pool copying policy

- Safe to adapt: MIT/open official shadcn/ui, ReUI, Radix/Base UI, shadcn-admin-kit, shadcn-admin, Shadcn Space, TailAdmin, and MIT timeline examples.
- Concept-only: Tailwind Plus/Tailwind UI paid blocks and mixed free/pro component catalogs unless a specific block license is verified.
- Avoid adding a dependency when the desired pattern can be represented with existing Tailwind/lucide primitives and app-local components.
