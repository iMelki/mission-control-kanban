# Direction — Mission Control Kanban, 2026-10 studio pilot
Gate: G2 (prep) · Decision: Captain (card) · Status: waiting-on-captain
Makers: creative-director, brand-designer · Inputs: `brief.md`, `baseline.md`
Visual board: `mck-directions.html` (published by the parent as an artifact; local
copy in the session scratchpad, not in this repo)

Operator-decision boundary (v1.3 §2.9): no direction below is chosen. The
typeface in A and B is the one MCK already declares (JetBrains Mono). The
accents in B and C, and the typeface in C, are **proposals for Captain**, not
decisions.

## Creative brief

- **The one idea:** the board answers "what needs me, and who has the rest?"
  before it shows anything else, and a move feels like handing work over.
- **How Captain should feel:** in control in one glance; calm at 977 cards.
- **Tone words (3):** calm, exact, accountable.
- **Reference category:** operator tools (Linear-quality bar), not Awwwards
  public categories; v1.3 rubric applies.
- **Constraints:** dark-first; Tailwind 3.4 tokens on `:root`; dnd-kit stays;
  fleet motion primitive stays (transform and opacity only, three-layer
  reduced-motion block); Lucide only; no Inter, no serif, no `#000000`, max one
  accent under 80% saturation, no AI purple/blue; data-emoji only through
  `EntityEmoji`; free or owned fonts only (Geist and JetBrains Mono are OFL
  1.1); must not reuse Command Center teal `#2dd4bf` or Mission Control coral
  `#E0584C`; JS budget +10% max on `/workspace/[slug]` (baseline ≈ 212 KB gz).
- **Each direction must answer:** (1) what carries column and status identity
  if not seven hues; (2) where the one accent is spent; (3) what the move
  feels like and what reduced motion keeps; (4) how "needs Captain" is shown.
- **G2 cost allowance:** included subscriptions only, $0.

---

## Direction A — "Refine"

- **Pitch:** same identity, done properly. Keep JetBrains Mono and `#58a6ff`;
  remove the noise around them.
- **What changes:** column tops go neutral (identity = label + count +
  order); the six extra hues leave the chrome and survive only as semantic
  status tones; one h1 scale on every route; per-route `document.title`;
  raw `amber-*`/`rose-*`/`purple-*` literals on the board move onto
  `mc-warn`/`mc-danger` tokens; card rebuilt as an owned primitive (#48);
  "Needs you" count chip in the board header (Review + dispatch-blocked
  Inbox).
- **Type:** JetBrains Mono (already chosen; SIL OFL 1.1; self-hosted by
  `next/font`). Roles on the existing axes: headings 700 / -0.02em, body 400,
  meta 400 at 12 px muted. Monospace figures are tabular already.
- **Palette (unchanged hexes, fewer of them in chrome):**

  | Token | Hex | on bg `#0d1117` | on card `#21262d` |
  |---|---|---|---|
  | bg | `#0d1117` | — | — |
  | surface | `#161b22` | — | — |
  | card | `#21262d` | — | — |
  | border | `#30363d` | 1.55:1 | 1.25:1 |
  | text | `#c9d1d9` | 12.26:1 | 9.86:1 |
  | muted | `#8b949e` | 6.15:1 | 4.95:1 |
  | accent | `#58a6ff` | 7.49:1 | 6.03:1 |
  | success | `#3fb950` | 7.45:1 | 5.99:1 |
  | warn | `#d29922` | 7.50:1 | 6.03:1 |
  | danger | `#f85149` | 5.65:1 | 4.54:1 |
  | text on accent | `#0d1117` on `#58a6ff` | 7.49:1 | |

- **Motion idea (drag/drop):** "lift and land": on pickup the overlay card
  rises (translateY -2 px, scale 1.02, a shadow layer fades in by opacity);
  the target column's header count ticks; on drop the dnd-kit
  `dropAnimation` settles the card in 240 ms `--ease-standard`.
  **Reduced motion:** no scale or travel (tokens collapse to 0.01 ms); the
  overlay still shows, the column outline changes instantly, and a polite
  live region says "Moved <title> to Review" (dnd-kit `announcements`).
- **References (all "verify": not re-visited this session, 2026-10-18):**
  - https://linear.app — 2026-10-18 (verify) — calm density, one accent.
  - https://github.com/features/issues (GitHub Projects board) — verify — the
    palette MCK already echoes; column header count pattern.
  - https://primer.style (GitHub Primer) — verify — the source of the current
    hexes; how Primer separates semantic tones from accent.
  - https://www.jetbrains.com/lp/mono/ — verify — the face's own specimen and
    weights.
  - https://docs.dndkit.com — verify — `DragOverlay`, `dropAnimation`,
    accessibility announcements.
- **Risks:** rubric 1.1 and 1.8 lift is small (likely 6.0→6.5 and 4.0→5.0);
  the accent stays at 100% saturation (a §2.6 flag A does not fix); still
  reads as a GitHub-dark clone; may not reach the 6.5 composite alone.

## Direction B — "Evolve"

- **Pitch:** keep the voice (JetBrains Mono), change the material: warm
  graphite surfaces and one sticky-note yellow, the colour of a physical
  kanban card.
- **What changes:** new surface ladder (bg → lane → card by fill, not by
  border); cards get a 3 px left status rail in a semantic tone and a raised
  fill; the accent is spent only on primary action, focus, drop target and the
  "Needs you" chip; columns neutral; warn moves to orange so yellow means only
  "accent". Everything in A's list is included.
- **Type:** JetBrains Mono (already chosen; OFL 1.1). Same roles as A.
- **Proposed accent (Captain's pick):** `#e6be5a` "card yellow", HSL 43° /
  74% / 63% (under the 80% cap). Distinct from Command Center teal and
  Mission Control coral.
- **Palette:**

  | Token | Hex | on bg `#111214` | on card `#202226` |
  |---|---|---|---|
  | bg | `#111214` | — | — |
  | lane (surface) | `#18191c` | — | — |
  | card | `#202226` | — | — |
  | border | `#2e3136` | 1.44:1 | 1.22:1 |
  | text | `#e6e4df` | 14.75:1 | 12.54:1 |
  | muted | `#9d9a92` | 6.67:1 | 5.67:1 |
  | accent | `#e6be5a` | 10.60:1 | 9.01:1 |
  | success | `#4cb782` | 7.50:1 | 6.37:1 |
  | warn | `#e0823d` | 6.63:1 | 5.64:1 |
  | danger | `#ef6461` | 5.95:1 | 5.06:1 |
  | ink on accent | `#1a1608` on `#e6be5a` | 10.22:1 | |

- **Motion idea (drag/drop):** "pick up the note": on pickup the overlay
  tilts -1.5° and lifts (rotate + translate + shadow opacity); the target lane
  shows an accent insertion bar (scaleX from 0); on drop the card settles and
  its status rail cross-fades from accent to the new status tone over
  360 ms ("ink drying"). **Reduced motion:** no tilt, lift or bar growth; the
  bar appears at full width instantly, the rail takes the new tone instantly,
  and the live region announces the move.
- **References (all "verify", 2026-10-18):**
  - https://trello.com — verify — card as an object you pick up; label rail.
  - https://linear.app — verify — fill-based elevation instead of borders.
  - https://height.app — verify (Height announced a shutdown in 2025; check
    whether the site still exists) — warm neutral surfaces in a task board.
  - https://www.notion.so (board view) — verify — neutral columns, colour
    only on properties.
  - https://www.raycast.com — verify — warm dark greys and a single bright
    accent in a dense tool.
- **Risks:** an accent change is a brand decision only Captain makes; yellow
  as accent can read as "warning" unless warn really moves to orange
  everywhere (sweep of raw `amber-*` literals needed); border-only edges stay
  below 3:1, so cards must stay distinguishable by fill (1.4.11); touches
  every route's chrome, not just the board.

## Direction C — "Rethink"

- **Pitch:** a board of people, not columns: swimlanes by agent, and a focus
  mode that shows only what needs Captain.
- **What changes:** rows = agents (plus "Captain" and "Unassigned"), columns
  collapse from seven to four visible groups (Inbox, Doing = assigned +
  in progress + testing, Review, Done; the seven statuses stay in data and in
  a card sub-label); lanes collapse with counts in headers; **focus mode**
  (key `f`) dims everything that does not need Captain (Review, blocked Inbox,
  failed dispatch) and pins it to the top; dragging a card across lanes
  reassigns the agent (behind the existing dispatch-contract gate). A command
  palette is a natural follow-on but out of this appetite.
- **Type (Captain's pick, limited to the ruling):** **Geist Sans** for UI and
  headings, **Geist Mono** for IDs, timestamps and counts (SIL OFL 1.1, no
  Reserved Font Name; already vendored in the fleet as `geist@1.7.2` in
  Command Center and Mission Control). Geist figures are proportional, so
  `font-variant-numeric: tabular-nums` goes on `:root` (typeface ruling §1a).
  Outfit is not proposed: the ruling calls it a brand face that is weak for
  dense data. Variant for Captain: keep JetBrains Mono as the mono role
  instead of Geist Mono.
- **Proposed accent (Captain's pick):** `#b8d35a` "signal lime", HSL 73° /
  58% / 59%. Success shifts to a teal-leaning green `#5bb98b` so the two do
  not merge.
- **Palette:**

  | Token | Hex | on bg `#0f1215` | on card `#1c2229` |
  |---|---|---|---|
  | bg | `#0f1215` | — | — |
  | lane (surface) | `#151a1f` | — | — |
  | card | `#1c2229` | — | — |
  | border | `#2a323b` | 1.45:1 | 1.23:1 |
  | text | `#dfe6ec` | 14.91:1 | 12.72:1 |
  | muted | `#93a1ad` | 7.11:1 | 6.06:1 |
  | accent | `#b8d35a` | 11.19:1 | 9.54:1 |
  | success | `#5bb98b` | 7.84:1 | 6.68:1 |
  | warn | `#e3a64a` | 8.79:1 | 7.49:1 |
  | danger | `#ef6767` | 6.09:1 | 5.19:1 |
  | ink on accent | `#12160a` on `#b8d35a` | 10.92:1 | |

- **Motion idea (drag/drop):** "hand-off": dragging into another lane slides
  the agent chip from the lane header onto the card (FLIP, transform only)
  so reassignment is visible; entering focus mode fades non-Captain cards to
  0.35 opacity over 240 ms and slides the pinned row down. **Reduced
  motion:** no slide; the chip swaps instantly, focus mode dims instantly,
  and the live region says "Reassigned <title> to <agent>" or "Focus mode:
  N items need you".
- **References (all "verify", 2026-10-18):**
  - https://linear.app (board grouped by assignee, "My issues") — verify —
    swimlanes by person; focus on what is mine.
  - https://github.com/features/issues (Projects board "group by") —
    verify — group-by field rows on the data MCK already mirrors.
  - https://www.atlassian.com/software/jira (board swimlanes by assignee) —
    verify — swimlane collapse and counts.
  - https://plane.so — verify — open-source board with swimlane views.
  - https://vercel.com/geist — verify — Geist type in dense UI.
  - https://businessmap.io (Kanbanize) — verify — WIP limits per lane.
- **Risks:** biggest scope: an IA change plus a typeface change plus an
  accent change, likely over the 2-week appetite; 977 cards across lanes need
  virtualisation; reassign-by-drag adds a write path that must respect the
  dispatch contract and GitHub mirroring; new `geist` dependency (or vendored
  woff2) adds bytes; three operator decisions in one card.

---

## Recommendation (not a pick)

**B "Evolve"** is recommended for this appetite. It answers all four
"must answer" questions, removes both §2.6 flags on the accent, gives MCK an
identity distinct from Command Center and Mission Control, and puts the
signature on the move itself, which is where 1.8 Delight (4.0) and 1.1 (6.0)
have the most room. It needs one operator decision (the accent), not three.
C has the larger upside on 1.3 IA and on the 977-card problem, and is a good
second release after B; A is the safe floor but probably does not reach a 6.5
composite alone.

## Draft card for Captain (for the parent to send)

Question: Which direction for Mission Control Kanban?
- A Refine — keep JetBrains Mono and blue, cut seven column hues to neutral;
  smallest change, may not reach 6.5.
- B Evolve (recommended) — keep JetBrains Mono, new yellow accent
  `#e6be5a` and warm card surfaces; one brand decision, fits 2 weeks.
- C Rethink — swimlanes by agent plus focus mode, Geist type, lime accent
  `#b8d35a`; biggest lift, likely over the 2-week appetite.

## Licence lines

- JetBrains Mono — SIL OFL 1.1 — self-hostable — $0 (already shipped).
- Geist Sans / Geist Mono — SIL OFL 1.1, no Reserved Font Name — self-hostable
  — $0 (verified at source 2026-08-25 per the typeface ruling).
- No images, icons or third-party assets proposed beyond Lucide (ISC).

## Captain's pick

- Direction: B Evolve · Date: 2026-10-22 · Card: decided by Ilan by voice, relayed via Chief · Notes: work proceeds from #194 (yellow).
