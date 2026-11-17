# Component-Sourcing Preflight — board lane and task card (mission-control-kanban)

Record for the board primitives extracted from `MissionQueue.tsx` for the
2026-10 studio pilot, direction B "Evolve" variant (branch
`claude/project-thread-606xun-mck-b`), closing the hand-rolled board/card
finding in #48.

- Target app/surface and component job: mission-control-kanban workspace board
  (`/workspace/[slug]`) — `BoardLane` is a dnd-kit droppable lane (neutral
  header with label and count, accent insertion bar and ring while a card is
  over it); `TaskCard` is the card body with a 3 px status rail, runtime and
  dispatch pills, blocker box and footer, used both in the lane and inside
  dnd-kit's `DragOverlay`.
- Target-app component checked: yes — `src/components/ui/card.tsx` (shadcn
  Card) and `Panel.tsx` were inspected first. They are static containers with a
  border-only edge and no slot for a status rail, drag handle or overlay state,
  and the card's interactive structure (two sibling buttons, never a clickable
  wrapper) is board-specific. The markup was MOVED out of `MissionQueue.tsx`
  rather than written fresh, keeping the existing behaviour and accessibility
  structure (#150 focus rings, the nested-control fix).
- Component marketplace primitive checked: yes — the local Component
  Marketplace and the shadcn registry carry Card, Badge and Kanban examples;
  the shadcn/Dice UI kanban examples bring their own drag layer, which would
  replace dnd-kit (the brief requires dnd-kit to stay) and add a dependency.
- External pools checked or deliberately skipped: Magic UI, Aceternity and
  Origin UI were deliberately skipped: they offer decorative cards, not a
  dnd-kit-bound board lane, and the brief's JS budget (+10% max on
  `/workspace/[slug]`) argues against new UI packages for a move of existing
  markup.
- Chosen source lane and why: owned primitive extracted from the existing
  in-repo board code — same dnd-kit hooks, same dispatch-contract data, new
  direction B tokens only. Zero new dependencies.
- License/access/dependency result: first-party code in this MIT repository;
  uses the already-installed `@dnd-kit/*` (MIT), `lucide-react` (ISC) and
  `date-fns` (MIT); no new dependency added.
- Proof expected before closeout: `npm run lint`, `npx tsc --noEmit`,
  `npm run build`, `npm run test:contrast-tokens`, this preflight gate, and
  Playwright screenshots of the board at 390 and 1440 px with a 160-card
  long-title fixture (scrollWidth <= innerWidth), recorded in
  `docs/studio/2026-10-mck-studio/variants/mck-b.md`.
- Covers: src/components/board/*.tsx
