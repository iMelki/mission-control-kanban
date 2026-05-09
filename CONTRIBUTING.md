# Contributing to mission-control-kanban

Thanks for taking the time to contribute.

## Development setup

- Create a feature branch
- Keep changes focused and well-scoped
- Add or update tests when applicable
- For agent work, use branch names like `agent/{agent-name}/{issue-number}-{slug}`

## Commit and PR expectations

- Prefer small, reviewable pull requests
- Link each PR to its issue
- Document test commands, risk level, and rollback plan
- Avoid committing secrets (use `git-toolkit` secret filtering + pre-commit scanning)
