# Mission Control Kanban — Awwwards-Level UI/UX Audit

Date: 2026-08-09
Auditor: senior product designer + frontend architect (fleet design audit rubric v1.0)
App: `S:\source\CCAI\Assistants\tools\mission-control-kanban` — live at http://127.0.0.1:3021 (not exercised)
Audit mode: **CODE-ONLY.** No server was started and no browser evidence was captured. All scores below are **code-inspection estimates**, not browser-proven scores. Per rubric Section 2.8, no visible frontend work may be called complete from code inspection alone; any score of 8+ in this report would be marked "provisional pending browser proof" — none reached that bar. A Frontend Proof Bundle (desktop 1440x900 + mobile 390x844, dark, reduced-motion states) is required before any of these estimates are treated as verified.

---

## 1. Executive summary

Mission Control Kanban is the most sourcing-compliant kanban surface in the fleet on paper — it has a `components.json` (lucide, new-york, `components.json:1-21`), a real TanStack Table v8 grid primitive (`src/components/ui/DataTable.tsx:4-18`) with three consumers, Radix-backed tabs (`src/components/ui/tabs.tsx:4`), and a documented compatibility shim pointing at issue #48 (`src/components/ui/Panel.tsx:1-3`). Its microcopy around the dispatch-contract safety gate is genuinely operator-grade: banners explain what is blocked, why the gate exists, and what to fill in (`src/components/MissionQueue.tsx:296-303`, `src/components/TaskModal.tsx:433-436`). Underneath that, the visual layer is a GitHub-dark clone running on a single monospace font that is referenced but never loaded (`src/app/globals.css:31`, no `next/font` anywhere), two parallel color systems (13 `mc-*` tokens vs 156 raw Tailwind palette usages across 27 files), six hand-rolled modal overlays with no dialog semantics, focus trap, or Escape handling (grep: zero `role="dialog"`/`aria-modal` hits), and native `confirm()`/`alert()` for every destructive action. There is no `prefers-reduced-motion` handling anywhere in `src`, no skeleton loaders, no command palette, and no keyboard-first flow beyond what dnd-kit and Radix give for free. Composite estimate: **4.9/10** — below Honorable Mention grade; the fundamentals (dialogs, tokens, type, focus) are ~70% of the gap. The one change that matters most: **ship a single accessible Dialog/ConfirmDialog primitive and migrate all six overlays and all `confirm()`/`alert()` call sites onto it** — it fixes the largest accessibility failure, the EUX-09 failure, and the biggest design-system duplication in one move. House-rule violations were found: anti-slop breaches (`h-screen` at `src/app/workspace/[slug]/page.tsx:415`, width animation on both sidebars, >1 saturated CTA accent, emoji in markup, "Acme" filler placeholder) and no sourcing-preflight record anywhere in the repo.

## 2. Current-state assessment

**Stack and token audit.** Next 16.2.9 + React 19.2.7 + Tailwind **v3.4.17** (`package.json:52-71`) — stack-rule compliant, no Vite. Tokens are 13 hex values under a `mc-*` namespace defined twice, in `tailwind.config.ts:11-26` and as CSS custom properties in `src/app/globals.css:5-19`. They are literally the GitHub dark palette (`#0d1117`, `#161b22`, `#58a6ff`…), dark-only, hex-based (not LCH/OKLCH), with `cssVariables: false` in `components.json:10` — theming and high-contrast do not fall out for free. No pure `#000` backgrounds (pass); modal scrims use `bg-black/50` (acceptable as scrim). Seven accent colors are defined and several are used as competing CTA colors: "Import GitHub" is solid cyan and "New Task" is solid pink side by side (`src/components/MissionQueue.tsx:253,261`). The bigger drift: **156 raw Tailwind palette classes (`emerald-*`, `amber-*`, `rose-*`, `purple-*`…) across 27 files** bypass the token system entirely — e.g. the pill tone system in `src/components/MissionQueue.tsx:460-471`, readiness rows in `src/components/GitHubReadinessCard.tsx:26-35`, sync banners in `src/app/workspace/[slug]/page.tsx:428-467`. The app effectively has two color languages: `mc-*` for chrome, raw Tailwind for semantics (success/warn/danger), with no semantic tone tokens bridging them.

**Typography.** One font role for everything: `body { font-family: 'JetBrains Mono', 'Fira Code', ui-monospace, monospace }` (`src/app/globals.css:27-32`). JetBrains Mono is never loaded — no `next/font`, no `@font-face`, no `<link>` (grep across `src` returns only the CSS reference), so the app renders in whatever mono the host machine has. There is no heading/body/mono role separation (rubric 1.1 anchor 6 requires it); hierarchy is carried entirely by size/weight/uppercase-tracking utilities.

**Live conventions inventory (what sibling panels actually do).** Dark-only GitHub-dark surface stack `mc-bg → mc-bg-secondary → mc-bg-tertiary`; borders `mc-border`; uppercase-tracked section eyebrows (`src/components/MissionQueue.tsx:246`, `src/components/ui/card.tsx:32`); rounded `rounded`/`rounded-lg`; Lucide icons sized `size-4`/`w-4 h-4` paired with text labels; icon-only buttons carry `aria-label` + `title` (`src/components/LiveFeed.tsx:92-96`); collapsible side rails with width transition and localStorage persistence (`src/components/LiveFeed.tsx:11-52`, `AgentsSidebar.tsx:147-151`); tone pills built inline per component; `formatDistanceToNow` relative timestamps with `suppressHydrationWarning` (`src/components/MissionQueue.tsx:582-584`); status copy in flat operator sentences. Any new component must match these before reaching for a pool.

**States coverage.** Loading: full-screen emoji pulse (`src/components/WorkspaceDashboard.tsx:34-43`), a text-only "Loading history..." row in the history table (`src/app/n8n-sync-history/page.tsx:179-184`), `Loader2` spin on sync buttons — no skeletons matching final layout anywhere. Empty: consistently good — every list has an empty message with a next step (`WorkspaceDashboard.tsx:78-92`, `DataTable.tsx:403-406`, `n8n-sync-history/page.tsx:221-226`). Error: strong inline banner pattern with icon + headline + detail (`MissionQueue.tsx:308-318`, `TaskModal.tsx:405-415`). Optimistic UI: drag moves update the store first and revert on API failure (`src/components/MissionQueue.tsx:182-214`) — genuinely good. Focus states: Radix tabs have a proper `focus-visible` ring (`src/components/ui/tabs.tsx:35`); form inputs use `focus:outline-none focus:border-mc-accent` (`TaskModal.tsx:387`, `WorkspaceDashboard.tsx:343`) — a border-color-only change that is a weak visible-focus signal; many buttons have no focus style beyond browser default suppressed by hover-only styling.

**Preflight / proof-bundle record check.** No sourcing-preflight record exists anywhere in the repo (repo-wide grep for `preflight|sourcing` in `*.md` matched only an unrelated HTTP note in `integrations/paperclip-bridge/README.md:246`). No proof bundle or gauntlet scorecard found. Per rubric 2.3 this must be scored against Design-system consistency.

**Duplication vs fleet primitives.**
- Tables: exactly the state the fleet digest describes — 2 `<table>` tags total: the DataTable primitive (`src/components/ui/DataTable.tsx:369`) plus one bespoke leak in `src/app/n8n-sync-history/page.tsx:168-228` which hand-rolls headers, loading row, and empty row that DataTable already owns.
- Modals: six hand-rolled `fixed inset-0 bg-black/50` overlays (`TaskModal.tsx:336`, `AgentModal.tsx:110`, `GitHubImportModal.tsx:228`, `WorkspaceDashboard.tsx:220,305`, `task-modal/GitHubIssueDraftPanel.tsx:133`) duplicating a Dialog primitive the repo does not have; only `@radix-ui/react-slot` and `@radix-ui/react-tabs` are installed (`package.json:43-44`).
- Badges/pills: three parallel systems — dead `@apply` classes in `src/app/globals.css:59-107` (`.priority-*` and `.column-*` are defined but unreferenced; `.status-*` used only via `AgentsSidebar.tsx:534-536`), an inline `pillClass()` tone map in `MissionQueue.tsx:460-471`, and a `stateClassName()` map in `GitHubReadinessCard.tsx:26-35`. Same purpose, three implementations, three color vocabularies.
- Buttons: no Button primitive at all; every CTA re-writes its own class string. Notably **`class-variance-authority` is declared in `package.json:47` and never imported anywhere in `src`** — a declared-but-unwired dependency that exists precisely to solve this.
- Kanban board/cards/tabs duplication vs ReUI/shadcn patterns is already filed as mission-control-kanban#48; the `Panel.tsx` shim shows migration discipline exists.
- Dead CSS: `.online-glow` (`globals.css:135-137`), `.animate-pulse-soft` (`globals.css:115-117`), `.priority-*`, `.column-*` are all unreferenced by any component.

**Accessibility signals (three-pass audit not run — code signals only).** Positives: `aria-sort` + visually-hidden sort-state text and `sr-only` captions in DataTable (`DataTable.tsx:370,382,393`), `aria-live` row counts (`DataTable.tsx:327-333`), `fieldset`/`legend` on the icon picker (`WorkspaceDashboard.tsx:313-314`), labeled inputs throughout TaskModal, dnd-kit `KeyboardSensor` with sortable coordinates (`MissionQueue.tsx:136-139`), task cards operable via Enter/Space (`MissionQueue.tsx:474-483`), semantic `aside`/`nav`/`ul` landmarks with labels. Negatives: no dialog semantics/focus management on any overlay; native `confirm()` for four destructive flows (`AgentModal.tsx:92`, `SessionsList.tsx:126`, `TaskModal.tsx:300`, `settings/page.tsx:38`) and `window.confirm` for webhook retry (`DispatchTimeline.tsx:83`); `alert()` walls in `DeliverablesList.tsx:56-176` and `AgentsSidebar.tsx:130`; the drag handle is `opacity-0 group-hover:opacity-100` (`MissionQueue.tsx:492`) so it is invisible to keyboard users who tab onto it; decorative emoji glyphs used as event/status iconography without consistent `aria-hidden` (`LiveFeed.tsx:196-217`); 10px text below comfortable minimum (`text-[10px]` pills, `MissionQueue.tsx:523,582`); no reduced-motion handling for `animate-pulse`, `animate-slide-in`, or the sidebar width transitions.

**Perceived performance.** SSE with polling fallbacks is well-engineered (`src/app/workspace/[slug]/page.tsx:302-355`: events 5s, tasks 10s, connection 30s, n8n 60s, all cleaned up). But the header re-renders every second for a clock (`src/components/Header.tsx:22-25`), the homepage is fully client-fetched with no SSR/streaming (`src/app/page.tsx:1-7`), loading is spinner-walls not skeletons, and the unloaded webfont means an unpredictable first paint. `playwright` sits in production `dependencies` (`package.json:53`) rather than `devDependencies` — a bundle/image-size red flag for the standalone build even if never imported client-side.

**Content and microcopy.** The strongest dimension. The dispatch gate explains itself in plain language with the exact fields to fill (`MissionQueue.tsx:296-303`); GitHubReadinessCard rows name the exact env var and what each capability unlocks (`GitHubReadinessCard.tsx:45-63`); sync results report real counts ("3 imported, 2 updated, 0 moved" — `workspace/[slug]/page.tsx:185-189`); the webhook-retry confirm names the duplicate-work risk honestly (`DispatchTimeline.tsx:83`); the workspace card states "GitHub remains the task source of truth" (`WorkspaceDashboard.tsx:211`). Leaks: raw run UUIDs in the history table (`n8n-sync-history/page.tsx:198`), "e.g., Acme Corp" placeholder (`WorkspaceDashboard.tsx:342` — banned filler noun), `` ` - ` `` separators cramming three facts into one line in the sync strip (`workspace/[slug]/page.tsx:472-474`), and internal nouns ("dispatch", "runtime", "dry run") that are mostly, but not always, glossed.

## 3. Scorecard

All scores are code-inspection estimates (see header). None reach 8; any future 8+ requires a proof bundle.

| Dimension | Score (0-10) | Evidence |
|---|---|---|
| Visual craft | 5 | Coherent GitHub-dark token set (`tailwind.config.ts:11-26`); no pure #000; but single unloaded mono font for all roles (`globals.css:31`), 7 accents with 2 competing saturated CTAs (`MissionQueue.tsx:253,261`), 156 raw palette classes off-token (27 files), emoji-as-brand (`WorkspaceDashboard.tsx:38,52`) |
| Motion & interaction | 4 | Keyframes are transform/opacity-only (`globals.css:110-132`, good); dnd-kit transforms (`MissionQueue.tsx:406-409`); but zero `prefers-reduced-motion` hits in `src`; sidebars animate `width` (`LiveFeed.tsx:69`, `AgentsSidebar.tsx:148` — banned vector); no shared duration/easing tokens; no press feedback; infinite `animate-pulse` loops (`Header.tsx:119`) |
| IA & user flows | 6 | Dashboard → cockpit with section tabs (`workspace/[slug]/page.tsx:419`); sync strip answers "are we okay / what changed" (`:422-496`); "Showing N/M" (`MissionQueue.tsx:287-289`); "X of Y rows" (`DataTable.tsx:328`); but sections are ephemeral local state (not URL-addressable, `workspace/[slug]/page.tsx:104,138`), RuntimeAuditPanel renders under both `agents` and `settings` sections (`:506-519`), header stats vanish below `xl` (`Header.tsx:92`), no command palette |
| Design-system consistency | 5 | components.json present; DataTable on TanStack v8 with 3 consumers (`RuntimeAuditPanel`, `RuntimeOpsSettings`, `DispatchFailureQueue`); Panel→Card shim cites #48 (`Panel.tsx:1-9`); but 1 bespoke table leak (`n8n-sync-history/page.tsx:168`), 6 hand-rolled modals, 3 parallel pill systems, dead CSS (`globals.css:72-107,115,135`), CVA declared-never-imported (`package.json:47`), **no sourcing-preflight record in repo** |
| Accessibility | 4 | Strong ARIA in DataTable (`DataTable.tsx:370-393`) and labeled icon buttons; keyboard dnd sensor (`MissionQueue.tsx:136-139`); but no dialog role/focus-trap/Escape on 6 overlays (grep: 0 hits), native `confirm()`/`alert()` for destructive actions (5 confirm + 11 alert call sites), hover-only drag handle (`MissionQueue.tsx:492`), border-only focus on inputs (`TaskModal.tsx:387`), no reduced-motion |
| Perceived performance | 5 | Optimistic drag with revert (`MissionQueue.tsx:182-214`); SSE + tiered polling with cleanup (`workspace/[slug]/page.tsx:302-364`); but spinner walls not skeletons (`WorkspaceDashboard.tsx:34-43`), 1s header clock re-render (`Header.tsx:22-25`), unloaded webfont, `playwright` in prod deps (`package.json:53`) |
| Content & microcopy | 6 | Gate explainers with next step (`MissionQueue.tsx:296-303`, `TaskModal.tsx:433-436`); env-var-precise diagnostics (`GitHubReadinessCard.tsx:45-63`); honest consequence copy (`DispatchTimeline.tsx:83`); real counts everywhere; but raw UUIDs surfaced (`n8n-sync-history/page.tsx:198`), "Acme Corp" placeholder (`WorkspaceDashboard.tsx:342`), dense ` - ` fact-cramming (`workspace/[slug]/page.tsx:472-474`) |
| Delight / signature moments | 4 | Distinct terminal-cockpit identity (color-coded column tops, `MissionQueue.tsx:56-64`; live clock; lobster mascot) but no choreographed signature moment; dead `.online-glow` suggests an abandoned one (`globals.css:135`); nothing survives reduced-motion because reduced-motion is unhandled |

**Composite (unweighted mean): 4.9/10.** Under Awwwards weighting (Design 40 / Usability 30 / Creativity 20 / Content 10) it lands in the same band: ~4.8 — below the 6.5 Honorable Mention bar, held back by fundamentals rather than ambition.

## 4. Improvements

Ordered by leverage. Every "How" names its sourcing-ladder lane (rubric 2.2).

1. **Ship one accessible Dialog primitive; migrate all six overlays.**
   Where: `src/components/TaskModal.tsx:336`, `AgentModal.tsx:110`, `GitHubImportModal.tsx:228`, `WorkspaceDashboard.tsx:220,305`, `task-modal/GitHubIssueDraftPanel.tsx:133`.
   How: ladder rung 4 — `shadcn add dialog` (Radix Dialog under it, rung 6), restyled to `mc-*` tokens since `cssVariables:false` means shadcn's semantic tokens don't exist here (same portability caveat as component-marketplace's vendored set). Keeps the existing scrim/panel look; adds focus trap, Escape, `aria-modal`, scroll lock for free. Radix is already a dependency family (`package.json:43-44`).
   Impact: **medium** (highest total leverage in the audit).

2. **Replace `confirm()`/`alert()` with an action-review ConfirmDialog (EUX-09).**
   Where: `AgentModal.tsx:92`, `SessionsList.tsx:126`, `TaskModal.tsx:300`, `settings/page.tsx:38`, `DispatchTimeline.tsx:83`, `DeliverablesList.tsx:56-176`, `AgentsSidebar.tsx:130`, `WorkspaceDashboard.tsx:146-149`.
   How: rung 1 + rung 4 — the repo already owns the right pattern (the workspace delete-confirm modal, `WorkspaceDashboard.tsx:219-266`, with icon, consequence statement, and disabled-until-safe delete button); extract it onto the new Dialog primitive (or `shadcn add alert-dialog`) and route every native call through it. Keep `DispatchTimeline`'s honest duplicate-work copy verbatim.
   Impact: **quick-win** once item 1 lands.

3. **Fold the n8n history table into DataTable.**
   Where: `src/app/n8n-sync-history/page.tsx:167-229`.
   How: rung 1 — target-app `DataTable` (`src/components/ui/DataTable.tsx`), which already provides sorting, filtering, row counts, sr-only caption, and the empty row this page hand-rolls. Column defs for Run/Mode/Workspaces/Counts/Alert; keep the tone-colored alert cell via `render`. This is the known fleet debt item; no ratchet needed after (2 tags → 1).
   Impact: **quick-win**.

4. **Introduce semantic tone tokens; retire raw palette drift.**
   Where: `tailwind.config.ts:11-26` + the 27 files with 156 raw `emerald/amber/rose/purple-*` usages (worst: `MissionQueue.tsx` 17, `TaskModal.tsx` 14, `AgentsSidebar.tsx` 13, `GitHubWritebackPanel.tsx` 12).
   How: rung 1 — extend the target-app token set with `mc-success`, `mc-warn`, `mc-danger` (+ `/10 /20 /30` alpha usage as today), map them to the current emerald/amber/rose values so nothing visually changes, then sweep. Consolidate the three pill systems (`globals.css:59-86`, `MissionQueue.tsx:460-471`, `GitHubReadinessCard.tsx:26-35`) into one `Pill` component in `src/components/ui/`. Delete dead `.priority-*`, `.column-*`, `.online-glow`, `.animate-pulse-soft`.
   Impact: **medium**.

5. **Actually load the fonts; give headings a non-mono role.**
   Where: `src/app/layout.tsx:1-22`, `src/app/globals.css:27-32`, `tailwind.config.ts:27-29`.
   How: rung 1 / platform — `next/font/google` JetBrains Mono (subset, `display: swap`) wired into the body class; add Geist (taste-skill-sanctioned; Inter is banned) as `font-sans` for headings and long-form copy (modal body text, explainer paragraphs), keeping mono for data, timestamps, IDs, and the terminal identity. Two roles, deliberate contrast — this is the single cheapest visual-craft upgrade in the repo.
   Impact: **quick-win**.

6. **One saturated CTA accent (anti-slop: max 1 accent).**
   Where: `src/components/MissionQueue.tsx:250-266` (solid cyan "Import GitHub" beside solid pink "New Task"); echoed in `WorkspaceDashboard.tsx:58` (blue).
   How: rung 1 — primary action = `mc-accent` solid; secondary = the existing outline convention (`border-mc-border hover:bg-mc-bg-tertiary`, already used at `workspace/[slug]/page.tsx:489`). Pink/cyan stay as data colors (column tops, event highlights), not CTA colors.
   Impact: **quick-win**.

7. **Reduced-motion coverage.**
   Where: `globals.css:110-137`, `Header.tsx:119`, `MissionQueue.tsx:508`, `LiveFeed.tsx:69,174`, `AgentsSidebar.tsx:148`.
   How: rung 1 / Tailwind — `motion-reduce:animate-none` on every `animate-pulse`/`animate-slide-in`, and a `@media (prefers-reduced-motion: reduce)` block zeroing the keyframes and the sidebar `transition-[width]`. While there, the width transition itself violates the transform-only rule — acceptable fix at this size is `transition-none` under reduced motion now, and a transform-based slide when the board is next touched.
   Impact: **quick-win**.

8. **Skeletons that match final layout.**
   Where: `WorkspaceDashboard.tsx:34-43` (full-screen emoji pulse), `n8n-sync-history/page.tsx:179-184` (text-only loading row), kanban first load.
   How: rung 4 pattern, rung 1 skin — shadcn's skeleton recipe re-skinned as `bg-mc-bg-tertiary animate-pulse rounded` blocks shaped like the workspace card grid, the summary strip, and 5 table rows. Honest loading: returning views should render last-known counts, never restart from blank.
   Impact: **medium**.

9. **Make workspace sections URL-addressable.**
   Where: `src/app/workspace/[slug]/page.tsx:104-138,419` and `workspace/WorkspaceSectionTabs.tsx`.
   How: platform convention (rung 1) — `useSearchParams`/`router.replace` with `?section=dispatch` (or nested routes later). Enables deep links from n8n alerts and GitHub issues straight to Dispatch/Activity, fixes back-button behavior, and gives each section a shareable identity. Resolve the duplicate `RuntimeAuditPanel` rendering under both `agents` and `settings` (`:506-519`) while there — one owner per panel.
   Impact: **medium**.

10. **Button primitive on the already-declared CVA.**
    Where: every CTA (e.g. `MissionQueue.tsx:250-266`, `settings/page.tsx:69-86`, `WorkspaceDashboard.tsx:55-62`); `package.json:47` (cva unused).
    How: rung 4 — shadcn button recipe as the variant skeleton (`primary | outline | ghost | danger`, sizes `sm | md`), skinned entirely in `mc-*` tokens; wires the dead `class-variance-authority` dependency (or remove it if the primitive is declined). Include the tactile press convention (`active:scale-[0.98]`) and a real `focus-visible` ring copied from `ui/tabs.tsx:35`.
    Impact: **medium**.

11. **Visible focus everywhere; fix the invisible drag handle.**
    Where: inputs using `focus:outline-none focus:border-mc-accent` (`TaskModal.tsx:387,400`, `WorkspaceDashboard.tsx:343`, `DataTable.tsx:303,315`); drag handle `MissionQueue.tsx:489-496`.
    How: rung 1 — adopt the tabs' `focus-visible:ring-2 focus-visible:ring-mc-accent/60` convention repo-wide; on the drag handle add `focus-visible:opacity-100` alongside `group-hover:opacity-100` so keyboard users can see what they've focused.
    Impact: **quick-win**.

12. **De-jargon the history table; humanize IDs.**
    Where: `n8n-sync-history/page.tsx:196-216`.
    How: rung 1 conventions — relative dates via the existing `formatDistanceToNow` convention with absolute on `title`; truncate run UUIDs to 8 chars with copy-on-click; replace the "Acme Corp" placeholder (`WorkspaceDashboard.tsx:342`) with a real local example ("e.g., Assistants").
    Impact: **quick-win**.

13. **Stop re-rendering the header every second.**
    Where: `src/components/Header.tsx:19-25,107-109`.
    How: rung 1 — isolate the clock into a leaf `<Clock />` client component so the 1s interval re-renders ~30 bytes of DOM instead of the stats/status row; or drop seconds and tick per minute. (Rubric 1.6: continuous loops memoized in isolated leaf components.)
    Impact: **quick-win**.

14. **Command palette as the keyboard-first backbone.**
    Where: app shell (`src/app/workspace/[slug]/page.tsx`, `Header.tsx`).
    How: rung 6 shortlist — `cmdk` (already the fleet backbone in Command Center): jump to workspace/section, create task, run "Sync now", filter by runtime, open task by title. This is the IA 9-anchor move ("keyboard-first flow as a primary path").
    Impact: **flagship**, prerequisite-free after item 1.

## 5. Awwwards flagship concept — "Clearance"

**Concept (exactly one).** MCK's real job — the thing no other kanban does — is the dispatch-contract safety gate: imported GitHub work physically cannot leave Inbox until scope, tests, impact, and rollback are explicit (`src/lib/dispatch-contract.ts` via `MissionQueue.tsx:164-179`). Make the gate the signature moment instead of an error banner. While dragging a GitHub-imported card, columns it cannot legally enter dim and show a one-line inline reason at the column head ("Needs rollback plan") — the board itself becomes the explanation. On a legal drop, one choreographed ~450ms sequence: the card settles with a spring, the column's colored top border draws a single pulse of light across its width, and the runtime pill on the card ignites to its active tone — motion pointing the operator's eye at exactly the decision that just executed (dispatch is now live). On an illegal drop, the card returns with a short spring and the blocking field's row in the gate banner flashes once — the error state teaches instead of scolding.

**Complexity level (cinematic ladder).** Component-motion tier — the lowest level that can satisfy this audience; no hero canvas, no WebGL, no scroll choreography. Operator density stays 8-10.

**Asset/motion plan.** No assets. Motion library: **Motion (motion/react)** with `LazyMotion` (~4.6KB) for the card spring + `layout` settle; the border pulse is a CSS transform-only animation (scaleX on a gradient overlay) driven by a data attribute; dnd-kit remains the drag engine (already installed). All animation transform/opacity only — the current dnd transforms (`MissionQueue.tsx:406-409`) already comply. Add shared motion tokens first (duration 150/250/450ms, one ease curve) so this is the app's only choreographed moment, not a sprinkle.

**Reduced-motion fallback.** Under `prefers-reduced-motion`: no spring, no pulse — instant snap, and the column border + runtime pill switch color statically and hold for 2s. The dimming + inline reasons (the informative part) are static styling and survive untouched.

**Proof it needs.** Frontend-sota-gauntlet scorecard target **19/21** with browser evidence: desktop + mobile screenshots of drag-over dimming, legal-drop and illegal-drop states, reduced-motion capture, and a 60fps performance trace during drag with a realistic board (50+ tasks). Not claimable from code inspection — per house rule, the gauntlet is not passed without browser evidence.

## 6. Constraint compliance notes

| Constraint | Status | Notes |
|---|---|---|
| Stack rule (2.1) | **PASS** | React 19 + Next 16 + Tailwind 3.4 + shadcn-compatible `components.json`; no Vite anywhere (`package.json`). Tailwind v3 syntax — any copied component must be v3-compatible (no v4 `@theme`). |
| Sourcing ladder + preflight (2.2/2.3) | **FAIL (process), PARTIAL (practice)** | No `Test-FrontendComponentSourcingPreflight` record exists in the repo. Practice is mixed: DataTable/TanStack and Radix tabs are correct ladder outcomes; the six modals and the pill/button sprawl skipped the ladder. Every improvement above must run the preflight (`-RequireKnownPoolMention` — this is an operator dashboard) before implementation. |
| Paid tools & provenance (2.7) | **PASS** | All UI deps are MIT/free (dnd-kit, TanStack, Radix, lucide, date-fns, zustand). No paid pools, no license-unclear code found. |
| Ethical UX (2.5) | **FAIL on EUX-09; others pass or unverified** | EUX-09: destructive actions (delete agent/session/task, settings reset) go through native `confirm()` — not an accessible review surface (file refs in improvement 2). EUX-02 pass: progress messages report real counts, spinners never fake progress. EUX-04 pass: sync banners state source-of-truth honestly (`WorkspaceDashboard.tsx:211`). No fake urgency/scarcity/confirm-shaming found anywhere. Remaining EUX items unverified (code-only audit; missing proof ≠ pass). |
| Anti-slop bans (2.6) | **FAIL (5 breaches)** | (1) `h-screen` at `workspace/[slug]/page.tsx:415` (banned; `min-h-[100dvh]` + fixed shell equivalent). (2) Width animation on both side rails (`LiveFeed.tsx:69`, `AgentsSidebar.tsx:148`) — animate transform/opacity only. (3) Two saturated CTA accents side by side (`MissionQueue.tsx:253,261`) vs max-1-accent. (4) Emoji in markup/text content — 48 occurrences across 19 src files by emoji-plane grep (28 of them in UI components/pages across 12 files: brand 🦞, rail icons, event icons `LiveFeed.tsx:196-217`; the remainder in db seed/schema strings and API routes) vs the ANTI-EMOJI ban; note the doctrine tension below before sweeping. (5) "Acme Corp" filler placeholder (`WorkspaceDashboard.tsx:342`). Passes: no Inter, no serif, no pure-#000 surfaces, no neon glows in use (the one glow class is dead code), no scrolljacking, no custom cursors. |
| Proof requirements (2.8) | **NOT MET (by audit design)** | Code-only audit; no proof bundle, no gauntlet score. All scores are estimates; treat every visual claim as unverified until the Playwright bundle (content-factory harness; never `networkidle` — this app live-polls) is captured. |

## 7. Open questions for the operator

1. **Emoji identity vs the anti-emoji ban.** Agent avatars (`avatar_emoji` in the DB schema) and workspace icons are emoji *data* chosen by the operator; the LiveFeed/rail emoji are emoji *markup*. Proposed line: keep operator-chosen emoji as content, replace hardcoded UI emoji with Lucide (the repo's declared icon library). Confirm before any sweep — this changes the app's personality (the lobster).
2. **Program status.** The fleet digest lists MCK as one of four repos NOT frozen under the Frontend Revenue Program 2026 with an "uncertain — verify" flag. Confirm active-investment status before committing to the flagship concept.
3. **Dark-only or theme-capable?** Tokens are hex with `cssVariables:false`. If a light/high-contrast theme is ever wanted, the token migration (CSS variables, OKLCH) should ride along with improvement 4 — doing it later doubles the sweep. Decide now.
4. **Section deep-links (improvement 9):** query-param (`?section=`) or nested routes (`/workspace/[slug]/dispatch`)? Nested routes are the cleaner Next convention but change URLs that n8n/bookmarks may already use.
5. **mission-control-kanban#48 scope.** The kanban board/Card/Tabs duplication is filed report-only. Approve migration now (before Clearance builds on the board) or after? Building the flagship on the current hand-rolled board then migrating means paying for the motion work twice.
6. **Icon doctrine conflict (rubric 2.9).** Live convention is Lucide (`components.json:20`); taste-skill mandates Phosphor/Radix icons. Recorded here per rubric — needs a fleet-level ruling, not an app-level one.
7. **Port hygiene.** Canonical port is 3021, but only the `dev:n8n` script pins it (`package.json:8`); `dev`/`start` default to 3000, which is workstation-reserved per fleet notes. Should `dev`/`start` pin `-p 3021` so a habitual `npm run dev` can't squat the reserved port?
8. **Primitive-extraction candidates for Component Marketplace.** DataTable (the fleet's proven TanStack wrapper) and the eventual Pill/ConfirmDialog are candidates to normalize back to the marketplace instead of stranding them here — extract after they stabilize, or keep repo-local?
