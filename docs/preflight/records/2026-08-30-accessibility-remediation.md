# Component-Sourcing Preflight — accessibility remediation

Record for the settings-input portion of issues #150–#152. The surrounding
workspace UI continues to use the repository's existing Radix Tabs, dnd-kit,
Card, and data-table primitives; only the missing shared Input primitive is
added.

- Target app/surface and component job: mission-control-kanban `/settings` —
  one accessible, reusable text Input with a visible focus indicator and
  invalid/disabled/file-input states.
- Target-app component checked: the app had no `src/components/ui/input.tsx`;
  the four affected settings fields repeated the same native input classes.
  Existing `ui/card.tsx`, `ui/tabs.tsx`, and `lib/utils.ts` establish the local
  copy-owned shadcn style and `cn` convention.
- Component Marketplace primitive checked: the private Component Marketplace
  was considered but not copied; the curator packet did not establish a
  redistributable Input there, while the public pinned shadcn source supplies
  the exact missing primitive.
- External pools checked or deliberately skipped: inspected shadcn-ui/ui Input
  at commit `b4a618b97e35f5dadf3a00d51f410c84a2567d4d`, specifically
  `apps/v4/registry/new-york-v4/ui/input.tsx`. Magic UI, KokonutUI, React Bits,
  Motion.dev, and Bklit were deliberately skipped because this is a form
  primitive already covered by the app's shadcn conventions, not a motion or
  decorative block.
- Chosen source lane and why: pinned public shadcn source, manually adapted.
  The structural baseline (typed native input props, `data-slot`, `cn`,
  visible-focus, invalid, disabled, and file-input states) is retained. Tailwind
  4 theme shorthands and unified-Radix assumptions are replaced with this
  Tailwind 3 app's existing `mc-*` tokens. No registry installer or new
  framework is used.
- License/access/dependency result: shadcn-ui/ui is MIT at the pinned commit
  ([LICENSE.md](https://github.com/shadcn-ui/ui/blob/b4a618b97e35f5dadf3a00d51f410c84a2567d4d/LICENSE.md)); the exact inspected
  [Input source](https://github.com/shadcn-ui/ui/blob/b4a618b97e35f5dadf3a00d51f410c84a2567d4d/apps/v4/registry/new-york-v4/ui/input.tsx)
  was checked 2026-08-30. Copy-owned internal app use is allowed and adds no
  dependency.
- Proof expected before closeout: component-sourcing preflight and its unit
  tests pass; TypeScript, ESLint, production build, runtime UI smoke, and the
  caller-faithful accessibility self-proof/sweep pass; the live sweep reports
  no settings-input focus misses. The changed source/diff remains limited to
  the pinned structural baseline plus local tokens.
- Covers: src/components/ui/input.tsx
