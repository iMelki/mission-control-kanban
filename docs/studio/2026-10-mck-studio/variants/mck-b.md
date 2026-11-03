# Variant mck-b — Direction B "Evolve"

Branch `claude/project-thread-606xun-mck-b`, cut from `origin/dev` at `56f4042`
on 2026-10-18. One of the variants Captain asked for; not for merge until he
picks. Spec: `../direction.md` § Direction B, with `../brief.md` and
`../baseline.md`.

## What was built

- **Tokens** (`src/app/globals.css`, `tailwind.config.ts`). The direction B
  palette, hex for hex: bg `#111214`, lane `#18191c`, card `#202226`, border
  `#2e3136`, text `#e6e4df`, muted `#9d9a92`, accent `#e6be5a`, ink on accent
  `#1a1608`, success `#4cb782`, warn `#e0823d`, danger `#ef6461`. Each token
  also has an `-rgb` channel triple. Tailwind now resolves every `mc-*` colour
  through `rgb(var(--…-rgb) / <alpha-value>)`, so the CSS is the only source
  and opacity modifiers still work. The legacy hue tokens
  (`mc-accent-green/red/yellow/purple/pink/cyan`) are removed.
- **Type.** JetBrains Mono stays the only family. There is now one h1 scale on
  every route (`--mc-h1-size` 20 px): measured on 11 of 11 route states, where
  dev had 16, 20, 24 and 30 px.
- **Surfaces by fill.** bg, lane and card each step lighter. Lanes have no hue
  top border. A card is a fill one step above its lane, with a faint inset
  ring. Borders were never the only cue, because `#2e3136` is under 3:1 on
  every surface (WCAG 1.4.11).
- **Card primitive (#48).** The board card and lane are now owned primitives,
  `src/components/board/task-card.tsx` and `board-lane.tsx`. They were moved
  out of `MissionQueue.tsx`, and the card has a **3 px left status rail**:
  - neutral (muted) for Planning, Inbox and Assigned
  - bright text tone for In progress and Testing
  - **accent** for Review, which is the same "needs you" signal as the chip
  - **warn (orange)** for dispatch-blocked Inbox
  - success for Done

  The sourcing record is `docs/preflight/records/2026-10-18-board-lane-and-task-card.md`.
- **Accent budget.** The accent appears in four places only: the primary
  action (`bg-mc-accent` with ink text), focus rings, the drop target (lane
  ring and insertion bar), and the **"Needs you" chip**. Decorative accent
  icons, link colours, selected tabs and chips, and the outlined secondary
  buttons were moved to neutral tones (24 icon sites, plus the selected-state
  sites listed in the diff).
- **"Needs you" chip.** It sits in the board header. The count covers Review
  and dispatch-blocked Inbox. Pressing the chip filters the board to those
  cards (`aria-pressed`).
- **Warn is orange everywhere.** About 250 raw Tailwind palette literals
  (amber, yellow, rose, red, emerald, green, purple, blue, cyan, pink) were
  swept onto `mc-warn`, `mc-danger` and `mc-success`, or onto neutral tokens,
  across 35 files. Light tints that were near-white text on a tinted panel
  became body text (`text-mc-text`), so they clear 4.5:1 on every tinted fill.
  A new test fails if any raw palette literal comes back
  (`tests/contrast-tokens.test.ts`).
- **Signature moment, "pick up the note."** When a card is picked up, the
  `DragOverlay` card tilts -1.5° and lifts 2 px, and a shadow layer fades in by
  opacity. The lane under the card gets an accent ring, and an accent insertion
  bar grows from 0 to full width (scaleX). On drop the card settles (dnd-kit
  `dropAnimation`, 240 ms, `--ease-standard`). Its rail then cross-fades from
  accent to the new status tone over 360 ms ("ink drying"). Everything
  animates on transform or opacity only.
- **Reduced motion.**
  - The tilt and lift are removed (`transform: none` measured on the overlay).
  - The bar and the rail ink resolve at once (`animation-duration` measured at
    0.01 ms).
  - The drop animation is turned off from JS (`usePrefersReducedMotion`),
    because the stylesheet cannot reach WAAPI.
  - The live region still says "Moved <title> to Review." If the dispatch
    contract refuses the move, the live region says so instead of claiming the
    move. The drop-error banner is now `role="alert"`.
- **Per-route `document.title`.** Root template `%s · Mission Control`. Route
  layouts set "Settings", "n8n sync history", "Runtime regression", and
  "<workspace name> board". A slug with no row in the database gets
  "Workspace not found". On dev, all 9 routes shared one title.
- **Every route's chrome.** The token change reaches the header, section nav,
  home dashboard, settings, n8n history, runtime regression, modals and
  dialogs. The dialog overlay no longer uses `bg-black` (no `#000`).
  Destructive buttons now use `text-mc-bg` on danger (5.95:1). They used white
  on red, which was under 4.5:1 before this change too.

## 390 px overflow (Captain's PC, dev build)

I tested with a fixture of real-shaped data. The dev seed was loaded into a
scratch SQLite database, then 160 extra cards were added with long titles,
unbroken URLs and branch names, two long agent names, 32 GitHub-sourced cards
whose dispatch contract is incomplete, and dispatch metadata. Real `gh`
diagnostics output also came through, because this container answers GitHub
GraphQL with a long 403 text.

**Reproduced and fixed. All four appear only with real data:**

1. **GitHub readiness card.** A long, unbroken `project_probe_error` sized its
   flex item to the text and widened the Mission Queue to **501 px** at a
   390 px viewport. The ancestor's `overflow-hidden` clipped it. Fixed with
   `min-w-0` and `overflow-wrap:anywhere`.
2. **Project sync bar** (`/workspace/assistants`). A failed `gh api graphql`
   message (the whole command line) widened the cockpit root to **562 px**.
   Fixed by wrapping, clamping to 3 lines, and keeping the full text in
   `title`.
3. **Card titles.** Unbroken tokens overflowed the card text box (520 px of
   content in a 168 px box). Fixed with `overflow-wrap:anywhere` on the title
   and on blocker text.
4. **Board collapse.** With the readiness card and the blocked-Inbox banner
   showing, the lanes were squeezed to **24 px** tall at 390 px. The queue was
   a clipped `min-h-[60vh]` box. Below `lg` the queue no longer clips, and the
   board region has its own 75dvh height (the lanes scroll inside it). The
   lanes now measure 633 px tall at 390×844.

**Not reproduced:** a document-level horizontal scroll (`scrollWidth >
innerWidth`). It measured 390/390 on every route, before and after, on the
production build: `html, body { overflow-x: hidden }` clips the page, so the
four defects above showed as cut-off content, not as a scrollbar. I could not
run the dev build (`next dev` is outside this session's rules), so anything
specific to the dev build, such as the Next dev indicator or overlay, is
untested. The four fixes remove every element wider than the viewport that I
found. The only horizontal scroller left at 390 px is the board region itself,
which scrolls on purpose and is keyboard-focusable.

## Deviations from direction.md, and choices it left open

- **Accent `#e6be5a`.** I took the proposal as written. It is still Captain's
  call.
- **Rail tones for the seven statuses.** direction.md says "a semantic tone"
  without mapping the statuses. The mapping above is my proposal. Review uses
  the accent so the rail and the "Needs you" chip say the same thing.
- **Pills and tinted panels.** Tone text on a 10% tint of itself over the card
  drops danger to 4.43:1. Card pills are therefore opaque (`bg-mc-bg`, 5.95:1
  minimum). Light-tint text on tinted panels is body text, with the tone
  carried by the icon and the border. The direction's hexes are unchanged, and
  no derived "soft" tokens were added.
- **Hover feedback** went neutral. The direction lists no hover use for the
  accent, so hover borders and text use muted or text tones.
- **Selected states** (section nav, runtime filter, tabs) use a raised neutral
  fill, not the accent, for the same reason. The one exception is the answer
  picked in the planning Q&A (`PlanningTab`), which keeps the accent: it is
  the primary choice in that flow.
- **Not done here:**
  - **#189** (error paths). The direction's A-list does not include it. An
    API-down board still reads "Workspace Not Found" (see
    `api-down-board-*.jpg`).
  - **A command palette.** The direction puts it out of scope.

## Proof (2026-10-18, Linux container, Node 22.22.0)

| Check | Result |
|---|---|
| `npm run lint` | pass (exit 0); also exit 0 on origin/dev |
| `npx tsc --noEmit` | pass (exit 0); also exit 0 on origin/dev |
| `npm run build` (webpack) | pass |
| `node scripts/verify-component-sourcing-preflight.mjs` | pass (43 components, 13 record-covered) |
| `npm run test:contrast-tokens` | pass 12/12 (updated: legacy failure fixtures pinned to old hexes; new direction B pair, hex and no-raw-literal tests) |
| `npm run test:a11y-remediation` | pass 5/5 (updated for the moved card and the `mc-danger` rename) |
| other `npm test` parts (24 scripts) | pass |
| `npm run test:captured-surfaces`, `npm run surfaces:check` | **fail: 9 stale captures.** Expected for any visual change: the committed `docs/captured-surfaces.json` digests describe the old source. Passes 25/25 on origin/dev. Re-probing needs the canonical capture flow on port 3021, which this session may not use; it should be re-run once Captain picks a variant. |
| First-load JS `/workspace/[slug]` | 253.6 KB gz vs 252.7 KB on origin/dev (+0.9 KB, +0.36%; budget +10%). This method decodes the URL-encoded `%5Bslug%5D` page chunk. The 212 KB figure in `baseline.md` appears to have missed that chunk. |
| 390 px overflow, 11 route states (home, board, 4 workspace sections, project board, settings, n8n history, runtime regression, not-found) | scrollWidth = innerWidth on all 11 at 390 and at 1440 |
| axe-core 4.10.2 (WCAG 2.0, 2.1 and 2.2 A/AA tags), all 11 route states at 390 px | 0 violations |
| Drag, motion allowed | overlay transform `rotate(-1.5deg) translateY(-2px)`; insertion bar 240 ms; rail ink 360 ms; live region "Moved … to Review." |
| Drag, `prefers-reduced-motion: reduce` | overlay transform `none`; bar and ink 0.01 ms; live region still announces; a gated move says "cannot move … yet" |

The screenshots are not in this repo. They are in
`/mnt/project-files/design-pilots/variants/mck-b/` (dark theme only; the app
has no light theme, and the brief rules one out).
