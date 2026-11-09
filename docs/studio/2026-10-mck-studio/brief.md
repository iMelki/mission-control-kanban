# Brief — Mission Control Kanban (MCK) 2026-10 studio pilot
Gate: G1 · Status: draft (waiting on checkers)
Makers: cpo, product-discovery · Checkers: creative-director, CTO seat

Integration branch read: `dev` at `56f4042` (origin/dev, 2026-10-18; `main` is
`c65ef14`, one docs commit behind). Rubric: v1.3 operator-app rubric
(`agent-settings/shared/catalog/uiux-awwwards-audit-rubric-2026-08-09.md`), not
the public-site rubric, because MCK is an operator console. Evidence for every
number below is in `baseline.md`.

- **Audience:**
  - **Captain** (the one human operator): triages incoming work, decides what
    agents may start, approves or sends back finished work.
  - **Agents posting work** (OpenClaw, webhook runtimes, Paperclip bridge,
    GitHub Projects sync): create and move cards via the API and need their
    state shown truthfully. They are writers, not readers, so their "UX" is
    that the board reflects what they did, at once and correctly.
- **Daily jobs:**
  1. **Triage** the Inbox: imported GitHub Project items and agent-created
     tasks, decide which can be dispatched (the dispatch-contract gate).
  2. **See agent work**: which agent holds what, what is running, what is
     stuck, what is waiting for Captain in Review.
  3. **Move cards**: drag (dnd-kit, pointer and keyboard) between seven
     columns; the move is persisted and mirrored to GitHub Projects
     Inbox/Done.
- **Problem (from measured rubric findings, round 2026-10-05, `c65ef14`):**
  - Composite **5.77/10**, gauntlet **14/21**: 0.73 below the 6.5 bar.
  - **1.8 Delight 4.0**: "no signature moment on 9 of 9 views"; the move
    (the board's core act) has no designed feedback beyond a ring.
  - **1.1 Visual craft 6.0**: "six accent hues compete"; one monospace family
    for every role (no distinct heading/body/data roles, round-5 proof);
    per-route h1 scale 16/20/24/30 px; the palette is a near-verbatim GitHub
    dark clone (`#0d1117`, `#58a6ff`), noted in `docs/uiux-awwwards-lift-2026-08-27.md`.
  - **1.3 IA 6.5 / 1.7 Content 6.3**: error paths answer wrongly — a timed-out
    workspace says "Workspace Not Found", a timed-out diagnostics call prints
    raw `AbortError` text and "no token" next to a board fetched with that
    token (#189). `document.title` identical on 9 of 9 routes. No command
    palette.
  - **Scale**: the assistants board grew from 795 to 977 tasks during one
    scoring run. Seven flat columns do not answer "what needs me now?".
  - **1.4 7.3**: board and cards remain hand-rolled (`MissionQueue.tsx`, #48).
- **Success metric (event, target, window):** MCK's rubric v1.3 **composite
  rises from 5.77 to at least 6.5**, with at least 7 of 8 dimensions MEASURED,
  in the first fleet UI/UX scoring round after the pilot is merged to `dev`
  (event: the MCK row in the next `shared/catalog/fleet-score-board-*.md`;
  window: by 2026-11-15). Measurable with the existing scoring harness; no new
  analytics needed. (Composite is the gate number; 1.8 and 1.1 are where the
  lift has to come from.)
- **Appetite:** small batch, 2 weeks, ending **2026-11-01**. Scope shrinks to
  fit.
- **Must-haves (max 7):**
  1. Captain's G2 pick applied as tokens (one accent, semantic status tones
     separate from the accent; no off-token colours on the board).
  2. Board, column and card rebuilt on owned primitives (closes #48), dnd-kit
     kept.
  3. One designed move moment (pickup, carry, drop, settle) on transform and
     opacity only, with a reduced-motion path that keeps the information.
  4. A "needs Captain" answer in one glance (count and filter for Review plus
     dispatch-blocked Inbox).
  5. Error paths tell the truth (#189): timeout reads as timeout, not as
     not-found or no-token.
  6. Per-route `document.title` and one h1 scale across routes.
  7. Contrast AA kept (today 99.5% resolved, 0 real fails); 2.5.8 AA kept.
- **Out of scope:** "launch" means **merged to `dev` and running locally** on
  the canonical port 3021; **no public release**, no hosted copy, no Railway,
  no Asimtop demo skin (#105 stays parked), no light theme, no new data model
  for tasks, no changes to GitHub sync semantics, no new icon set (Lucide
  stays), no Awwwards submission, no paid fonts, kits or tools.
- **JS budget per route:** operator app, so the 200 KB marketing default does
  not apply. Rule: the pilot may not grow first-load JS of `/workspace/[slug]`
  by more than **10% over the baseline measured at G5** from `next build`
  output; no new animation library unless the motion spec at G4 proves CSS
  plus dnd-kit cannot do it.
- **Cost cap (design + jury):** included subscriptions only, **$0 external
  spend**. G2-G4 within this session family; G6 jury at most 3 judges, one
  pass plus one re-check.
- **PRD:** inline above (problem, goals, non-goals, actors, must-haves). No
  separate PRD: the release is a visual and IA pass on an existing product.

## Overlap with sibling pilots

- **Command Center** (launch deck, port 3088): Geist Sans/Mono, teal accent
  `#2dd4bf`, bg `#111315`.
- **Mission Control** (port 3001): Geist Sans, coral accent `#E0584C`, bg
  `#0C0C0C`.
- MCK shares the operator, the fleet motion primitive, Lucide and the v1.3
  rubric with both. A direction that reused teal or coral would make the three
  consoles hard to tell apart in tabs; G2 directions avoid both hues.

## Open questions for Captain

1. Is the composite (gate number) the right single metric, or do you want a
   task metric (for example "time to find what needs me" timed on the
   assistants board) instead? Changing it before G2 is cheap.
2. Is a 2-week appetite right while #164 (dev server dies under capture) is
   open? G5 measurement depends on a surviving served build.

Sign-off: creative-director ____ · CTO seat ____
