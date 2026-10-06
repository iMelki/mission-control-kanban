# mission-control-kanban Agent Instructions

## Scope

This repo is a Next.js Mission Control / OpenClaw kanban application. Treat it as a product repo under `S:\source\CCAI\Assistants\tools`.

## Branch And PR Policy

- Use short-lived feature branches from `main`.
- Keep `dev` aligned with `main` unless a specific release flow says otherwise.
- Open a pull request for reviewable work; do not push directly to protected branches.
- Link cross-repo governance work to the appropriate GitHub issue or Project board; GitHub Issues are enabled for this repo and the root `OPEN_TASKS.md` is the local index.

## Local Safety

- Do not commit `.env`, `.env.local`, `.git-secrets.json`, SQLite runtime databases, or generated credential caches.
- Treat Railway, Tailscale, OpenClaw gateway, provider keys, and deployment config as sensitive.
- Preserve existing hook behavior when installing or updating git hooks.
- Keep generated or downloaded dependencies out of commits.

## Validation

Run the narrowest relevant checks for the change:

```powershell
npm run lint
npm run build
pre-commit run --all-files
```

If a check cannot run locally, document the reason in the PR.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
