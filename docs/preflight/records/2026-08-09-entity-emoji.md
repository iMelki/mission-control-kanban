# Component-Sourcing Preflight — EntityEmoji

- Target app/surface and component job: mission-control-kanban - shared emoji-identity primitive rendering operator-chosen agent avatars and workspace icons (rubric 2.6 data-emoji clause)
- Target-app component checked: searched src/components and src/components/ui — avatar_emoji/workspace.icon render as raw interpolated spans in 8 sites (ActivityLog, AgentsSidebar, MissionQueue, PlanningTab, SessionsList, Header, WorkspaceDashboard, TaskModal); no emoji-identity primitive exists
- Component Marketplace primitive checked: operator-primitives barrel (OperatorBadge, OperatorSourceCard, OperatorCollapsibleSection, OperatorFilterBar, HelpBubble) reviewed via the reuse baseline — no emoji-identity primitive exists in the marketplace
- External pools checked or skipped: shadcn/ui and Radix have Avatar primitives (image/initials-oriented, no emoji+aria-label identity contract); Lucide supplies the empty-value fallback icon; no pool ships the fleet's data-emoji identity contract because it was ruled 2026-08-09 (agent-settings#586)
- Chosen source lane and why: target-app custom (~30 lines) on top of the repo's existing Lucide icon lane — the component IS the repo's implementation of the fleet's shared emoji-identity contract: role="img" + aria-label naming the entity, aria-hidden when the text name is adjacent, Lucide fallback for empty values
- Custom missing capability or local constraint: no local or external pool implements the 2026-08-09 emoji-boundary ruling's identity contract (role="img"/aria-hidden switching + entity-typed Lucide fallback); shadcn/Radix Avatar solves a different job (image avatars) and would add an unneeded dependency surface
- License/access/dependency result: local repo code only; lucide-react ^0.468.0 already a dependency; no new dependencies
- Proof expected before closeout: npm run lint + tsc --noEmit + npm run build green; gate script passes with this record covering the new file; Test-FrontendComponentSourcingPreflight.ps1 -RequireKnownPoolMention passes on this record

Covers: src/components/ui/EntityEmoji.tsx
