# Changelog

All notable changes to Mission Control will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [Unreleased]

### Added

- Beginner-facing GitHub import flow in the Mission Queue UI with an
  **Import GitHub** modal for loading a GitHub issue URL before creating a
  linked local task
- `POST /api/github/load-issue` for resolving issue data plus linked GitHub
  Project item field values through `gh api`
- First-run operator documentation for the GitHub-native flow in
  `docs/GITHUB_IMPORT_PREVIEW.md`

### Changed

- GitHub import preview now normalizes required dispatch-contract fields from
  GitHub Project fields as well as issue-body sections
- Imported GitHub tasks are blocked from entering active work statuses until
  `Allowed File Scope`, `Acceptance Criteria`, `Test Requirements`, `Review
  Mode`, `Impact`, and `Rollback / Fallback Plan` are present
- GitHub write-back continues to fall back to `gh api` when direct Node fetches
  are unavailable in the local environment

---

## [1.0.2] - 2026-02-04

### Fixed

- Removed broken `db:migrate` script from package.json (referenced non-existent file)
- Migrations run automatically on app startup — no manual step needed

---

## [1.0.1] - 2026-02-04

### Changed

- **Clickable Deliverables** - URL deliverables now have clickable titles and paths that open in new tabs
- Improved visual feedback on deliverable links (hover states, external link icons)

---

## [1.0.0] - 2026-02-04

### 🎉 First Official Release

This is the first stable, tested, and working release of Mission Control.

### Added

- **Task Management**
  - Create, edit, and delete tasks
  - Drag-and-drop Kanban board with 7 status columns
  - Task priority levels (low, normal, high, urgent)
  - Due date support

- **AI Planning Mode**
  - Interactive Q&A planning flow with AI
  - Multiple choice questions with "Other" option for custom answers
  - Automatic spec generation from planning answers
  - Planning session persistence (resume interrupted planning)

- **Agent System**
  - Automatic agent creation based on task requirements
  - Agent avatars with emoji support
  - Agent status tracking (standby, working, idle)
  - Custom SOUL.md personality for each agent

- **Task Dispatch**
  - Automatic dispatch after planning completes
  - Task instructions sent to agent with full context
  - Project directory creation for deliverables
  - Activity logging and deliverable tracking

- **OpenClaw Integration**
  - WebSocket connection to OpenClaw Gateway
  - Session management for planning and agent sessions
  - Chat history synchronization
  - Multi-machine support (local and remote gateways)

- **Dashboard UI**
  - Clean, dark-themed interface
  - Real-time task updates
  - Event feed showing system activity
  - Agent status panel
  - Responsive design

- **API Endpoints**
  - Full REST API for tasks, agents, and events
  - File upload endpoint for deliverables
  - OpenClaw proxy endpoints for session management
  - Activity and deliverable tracking endpoints

### Technical Details

- Built with Next.js 15 (App Router)
- SQLite database with automatic migrations
- Tailwind CSS for styling
- TypeScript throughout
- WebSocket client for OpenClaw communication

---

## [0.1.0] - 2026-02-03

### Added

- Initial project setup
- Basic task CRUD
- Kanban board prototype
- OpenClaw connection proof of concept

---

## Future Plans

- [ ] Multiple workspaces
- [ ] Team collaboration
- [ ] Task dependencies
- [ ] Agent performance metrics
- [ ] Webhook integrations
- [ ] Mobile-responsive improvements
- [ ] Dark/light theme toggle

---

[1.0.1]: https://github.com/crshdn/mission-control/releases/tag/v1.0.1
[1.0.0]: https://github.com/crshdn/mission-control/releases/tag/v1.0.0
[0.1.0]: https://github.com/crshdn/mission-control/releases/tag/v0.1.0
