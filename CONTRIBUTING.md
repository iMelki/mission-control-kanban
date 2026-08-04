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

## React Doctor Commit Gate

The `react-doctor` pre-commit hook scans only matching frontend files in the staged Git index. Its pass/fail result comes from local warning-level diagnostics; remote score availability is deliberately excluded with `--no-score`.

Run `npm run test:react-doctor-hook` when changing the wrapper. `SKIP=react-doctor git commit ...` is an emergency-only bypass: record the reason in the linked issue or PR and run the staged gate plus focused tests before promotion. Never use the bypass to suppress a diagnostic in the staged change.
