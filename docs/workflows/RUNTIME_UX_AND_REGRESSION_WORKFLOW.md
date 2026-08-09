# MCK Runtime UX + Regression Workflow

Updated: 2026-08-09

Use this workflow when adding runtime dispatch UI, dense workspace refinements, or regression automation to Mission Control Kanban.

## 1. Research + inventory

- Check the current GitHub issue and `OPEN_TASKS.md` before coding.
- Reuse local primitives first: `Panel`, `DataTable`, runtime settings cards, dispatch timeline, task modal section patterns.
- For dense UI, prefer shadcn/ReUI/TanStack/Radix patterns: wizard steps, compact cards, table bulk-selection, alerts, and responsive dialog/sheet behavior.

## 2. Safe runtime enablement ladder

1. Runtime config template selected or manually filled.
2. Endpoint resolves through an env-var pointer or safe URL.
3. Health wizard sends a signed non-task ping.
4. Treat `reachable=true` as transport evidence only; require `verified=true`
   from a signed 2xx response before allowing `dispatch_enabled=true`.
5. Dry-run dispatch must show rendered payload/prompt/callbacks before any external side effect.

Existing webhook agents with a URL but no resolved signing-secret env remain
unchanged in storage, but runtime audit reports `needs_config` and live dispatch
fails before any network request. Do not use audit migration to silently invent
or persist secret values.

## 3. Bulk migration plan/apply

- Show selected count and disabled-row reasons.
- Preview before/after runtime fields for each selected agent.
- Apply only after an explicit operator action; default API calls remain dry-run.
- Store no raw webhook secrets in config; use `*_env` pointers.

## 4. Task readiness and dependencies

- Use blocked-by edges for local MCK task dependencies.
- Keep the ready-for-agent checklist operator-editable and visible in the Task modal.
- GitHub issue create/update flows should start as generated drafts unless a user explicitly approves live GitHub mutation.
- Use a compact blockers → task → downstream graph before adding full DAG navigation. Escalate to React Flow/Dagre only when operators need multi-hop traversal.
- Add task-card dependency badges for local blocked-by/blocking edges so operators see blocked work without opening the modal.

## 5. Regression and artifact closeout

Run the validation bundle:

```bash
npm run lint
npm test
npm run build
npm run doctor:react
npm run smoke:runtime-ui
npm run comment:runtime-artifacts -- --dry-run
```

For CI evidence:

```bash
npm run comment:runtime-artifacts -- --dry-run
npm run comment:runtime-artifacts -- --issue <issue-or-pr-number>
```

`npm run check:runtime-regressions` builds the webpack production output,
stages `public` and `.next/static` into `.next/standalone`, and launches
`.next/standalone/server.js` with explicit `HOSTNAME` and `PORT` values before
creating smoke entities. This keeps the test away from `next dev`'s on-demand
manifest writes and exercises the same server entrypoint used by Docker. The
runner fails if port 3021 is already occupied, so it cannot silently test an unrelated server.
Use `MCK_REGRESSION_SERVER_MODE=dev` only for an explicitly local diagnostic;
that mode is not the CI contract.

Runtime Regression CI maintains one marker-based PR or requested-issue comment
after successful workflow completion, updates it on later runs, and reads the
exact body back. Local screenshot thumbnails and metadata live at
`/runtime-regression`.

The smoke treats fixture cleanup as a blocking validation step rather than a
best-effort `finally` callback. It records every temporary task and agent ID,
sends the matching `DELETE`, then performs an exact-path `GET` that must return
`404`. All entity results are written to
`artifacts/runtime-ui-smoke/<run>/cleanup-receipt.json`, logged with the
`RUNTIME_SMOKE_CLEANUP_RECEIPT` marker, and uploaded with the screenshots. A
delete error, readable entity, receipt-write error, or browser-close error
fails the smoke while preserving any earlier UI failure in an aggregate error.

Design basis:

- [RFC 9110 DELETE semantics](https://www.rfc-editor.org/rfc/rfc9110.html#name-delete)
  distinguishes a successful delete request from later resource visibility,
  so the smoke verifies absence separately.
- [Playwright fixture teardown](https://playwright.dev/docs/test-fixtures#execution-order)
  keeps cleanup paired with setup even when the test body fails.
- [GitHub Actions artifact guidance](https://docs.github.com/en/actions/tutorials/store-and-share-data)
  recommends storing test output as workflow artifacts and exposes a digest
  for upload/download validation.
- Playwright community reports about
  [manual setup/teardown scope](https://github.com/microsoft/playwright/issues/35234)
  and [dangling resources after process-group shutdown](https://github.com/microsoft/playwright/issues/33377)
  reinforce that process success or teardown intent is not proof that external
  state is gone.

## 6. Turbopack inventory policy

- `npm run build` remains webpack-backed and blocking.
- `npm run dev:n8n` remains available for ordinary local development and the
  explicit diagnostic override on port 3021; it is not the Runtime Regression
  server because `next dev` compiles routes on demand.
- `npm run build:turbo` remains non-blocking inventory until the `next.config.mjs` → `src/lib/db/index.ts` output-file-tracing path is resolved.
- Upload or inspect `mck-turbopack-inventory` artifacts for trace warnings rather than blocking operator work.
