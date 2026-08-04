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
