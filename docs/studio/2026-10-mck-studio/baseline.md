# Baseline — Mission Control Kanban, 2026-10 studio pilot
Gate: G1 input · Written 2026-10-18 · Subject: `dev` at `56f4042` (origin/dev)

No server was started for this baseline. Scores are copied from the last
measured round; nothing here was re-measured in a browser.

## Scores (rubric v1.3, round 2026-10-05, subject `c65ef14`)

Source: `agent-settings/shared/catalog/fleet-score-board-2026-10-05.md` and
`fleet-score-run-2026-10-05/mission-control-kanban/report.md`. `dev` differs
from `c65ef14` only by a docs/test commit (`56f4042`: AGENTS.md block,
CHANGELOG, one test), so the scores still describe the shipped UI.

| Dimension | Score | Provenance | Key finding |
|---|---|---|---|
| 1.1 Visual craft | 6.0 | MEASURED | one mono family; six accent hues compete; h1 16/20/24/30 px by route |
| 1.2 Motion & interaction | 6.5 | MEASURED | busy indicators only; reduced-motion swap works on 6 of 6 animating routes |
| 1.3 IA & user flows | 6.5 | MEASURED | "Showing N/M" on 5 of 5 cockpits; no command palette; `document.title` identical on 9 of 9 routes |
| 1.4 Design-system consistency | 7.3 | MEASURED | one `<table>` (the DataTable primitive); board and cards hand-rolled (#48) |
| 1.5 Accessibility | 6.0 | MEASURED | contrast 99.5% resolved, 0 real fails; focus indicator 130 of 130; 2.5.8 AA met; 2.5.5 AAA not met; axe not run |
| 1.6 Perceived performance | 4.5 | CARRIED | host-load gate failed (CPU 77-82%) |
| 1.7 Content & microcopy | 6.3 | MEASURED | false "Workspace Not Found" and raw abort text on timeouts (#189) |
| 1.8 Delight / signature | 4.0 | MEASURED | no signature moment on 9 of 9 views |

**Composite 5.77** (0.4 x 6.60 + 0.3 x 5.667 + 0.2 x 4.0 + 0.1 x 6.3).
**Gauntlet 14/21.** Honorable Mention bar 6.5: gap 0.73.

Earlier proof (round 5, 2026-08-13, `087c8b8`): `/workspace/frontend-revenue`
did not reflow at 390 px; that was fixed by #142 (overflow 0 on 27 of 27 units
in the 10-05 round).

## Stack

Next 16.3.6 (webpack build), React 19.2.7, Tailwind 3.4 (tokens on `:root`,
not `@theme`), Radix dialog/slot/tabs, TanStack Table 8.21.3, **dnd-kit**
(`@dnd-kit/core` 6.3, `sortable` 10, `utilities` 3.2) with Pointer (8 px
activation) and Keyboard sensors, `closestCorners`, `DragOverlay`. Lucide
icons. Zustand store. SQLite (better-sqlite3).

## Tokens (`src/app/globals.css`, mirrored in `tailwind.config.ts`)

| Token | Hex | On `mc-bg` |
|---|---|---|
| `--mc-bg` | `#0d1117` | — |
| `--mc-bg-secondary` | `#161b22` | — |
| `--mc-bg-tertiary` | `#21262d` | — |
| `--mc-border` | `#30363d` | 1.55:1 (borders alone do not meet 3:1 non-text) |
| `--mc-text` | `#c9d1d9` | 12.26:1 |
| `--mc-text-secondary` / `--mc-text-muted` | `#8b949e` | 6.15:1 (4.95:1 on tertiary) |
| `--mc-accent` | `#58a6ff` | 7.49:1 |
| `--mc-accent-green` / `--mc-success` | `#3fb950` | 7.45:1 |
| `--mc-accent-yellow` / `--mc-warn` | `#d29922` | 7.50:1 |
| `--mc-accent-red` / `--mc-danger` | `#f85149` | 5.65:1 (4.54:1 on tertiary) |
| `--mc-accent-purple` | `#a371f7` | column marker |
| `--mc-accent-pink` | `#db61a2` | column marker |
| `--mc-accent-cyan` | `#39d353` | column marker (named cyan, is green) |

Motion: fleet-motion-primitive v1.1.0 (`--duration-instant/fast/slow/slower`
80/140/240/360 ms, `--ease-standard cubic-bezier(0.2,0,0,1)`), three-layer
reduced-motion block; essential busy loop slowed to 1600 ms and swapped to a
pulse. #143: 481 hardcoded transitions, few token call sites.

Heading role: `--mc-heading-weight: 700`, `--mc-heading-tracking: -0.02em`
(#142, chosen on the existing font's axes on purpose).

## Type

**JetBrains Mono** only (via `next/font/google`, variable, `--font-jetbrains-mono`;
licence SIL OFL 1.1). Body 400, headings 700. Monospace, so figures are
already tabular. Round-5 proof: `document.fonts` holds exactly JetBrains Mono
and its metric fallback; there is no distinct heading/body/data role (rubric
1.1 anchor 6 asks for one). Build note: `next/font/google` fetched the font at
build time; this succeeded here.

## Accent

`#58a6ff` (HSL 212°, **100% saturation**, 67% lightness). Two v1.3 §2.6 flags,
recorded, not decided: "Max 1 Accent Color. Saturation < 80%" (fails on
saturation, and seven hues are in use as column tops: purple, pink, yellow,
blue, green, purple again, green), and the Lila ban risk from blue plus purple
together. Palette is a near-verbatim GitHub dark clone. Changing the accent is
an operator decision (v1.3 §2.9); this file only records the gap.

## Board, column and card (`src/components/MissionQueue.tsx`, 607 lines)

- Seven columns: Planning, Inbox, Assigned, In progress, Testing, Review,
  Done; each `min-w-[220px] max-w-[300px]`, `border-t-2` in its own hue.
- Board is a focusable `role="region"` with `overflow-x-auto`.
- Card: `bg-mc-bg-secondary`, rounded-lg, grip row (hover reveal), title
  (line-clamp 2), agent row with data-emoji via `EntityEmoji`, runtime pill,
  dispatch pills (ready/warn/risk), blocker box (rose), footer with priority
  dot and relative time.
- Drop feedback: `ring-2 ring-mc-accent/50` on the column; overlay card on
  drag. No designed pickup or settle.
- Header: "Mission Queue", GitHub status, Import GitHub (outline), New Task
  (filled, the single primary since 2026-08-27). Runtime filter chips. The
  "Inbox is acting as a safety gate" banner for dispatch-blocked items.
- Some raw Tailwind literals remain on the board (`amber-*`, `rose-*`,
  `purple-*`), outside the token set.

## Open UI issues (GitHub, open on 2026-10-18)

- #189 cockpit error paths give false answers (timeout shown as not-found /
  no token).
- #48 board and cards hand-rolled (referenced in the score report).
- #143 481 transitions not on motion tokens.
- #150 four `/settings` inputs lack visible focus; #151 contrast pairs (fixed
  per 10-05 round, issue still open); #152 axe findings in 6 components.
- #164 capture harness: dev server dies under on-demand compile.
- #165 two workspace routes invisible to captured-surface gates.
- #169 runtime UI smoke red on dev pushes (nav lookups use `role=tab`).
- #175 Turbopack production build fails (webpack build is the path used).
- #148 no `typecheck` script; `tsc --noEmit` failing at root.
- #192 (PR, another thread) Dembrandt token drift check — not touched here.

## Install and build (this session, 2026-10-18, Linux container, Node 22.22.0, npm 10.9.4)

- `npm ci`: **exit 0**, 520 packages added in 46 s; npm audit reports
  19 vulnerabilities (3 moderate, 16 high). Not investigated here.
- `npm run build` (`next build --webpack`): **exit 0**. Compiled in 23.1 s,
  TypeScript step finished (15.1 s), 19 static pages generated. Note: the
  build's TypeScript step passed, which is narrower than #148's root
  `tsc --noEmit`.
- First-load JS, approximate (method: `rootMainFiles` plus non-async chunk
  lists from each route's client-reference manifest, re-gzipped at level 9;
  not Next's own printed number): `/workspace/[slug]` ≈ **212 KB gz**
  (14 files), `/` ≈ 162 KB, `/settings` ≈ 189 KB. This is the G5 budget
  baseline in `brief.md`.
- No server was started; lint and tests were not run.

## Sibling overlap

| App | Type | Accent | Background |
|---|---|---|---|
| MCK | JetBrains Mono | `#58a6ff` blue | `#0d1117` |
| Command Center | Geist Sans + Geist Mono | `#2dd4bf` teal | `#111315` |
| Mission Control | Geist Sans | `#E0584C` coral | `#0C0C0C` |

Shared: fleet motion primitive, Lucide, v1.3 rubric, dark-first. MCK is
already the odd one out on type; teal and coral are taken.
