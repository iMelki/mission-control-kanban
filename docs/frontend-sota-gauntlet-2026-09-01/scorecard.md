# Frontend SOTA Gauntlet — Scorecard (mission-control-kanban, production)

Subject: **mission-control-kanban** full app on an isolated production host
Date: 2026-09-01
Workflow: `frontend-sota-gauntlet` (`agent-settings/shared/prompts/frontend-sota-gauntlet.md`)
Scope label: **production `next start` first gauntlet** — not login-only, not `:3021`
Host: **`http://127.0.0.1:3121`** `next start`
Served SHA: **`74f671740019e26a540405bcfe52f1e6a83d900e`** (`74f6717`)
BUILD_ID: **`S8HgxCEJWRAGRBloUGmn1`**
Harness: Playwright `playwright` 1.58, isolated loopback, `waitUntil: domcontentloaded`, never `networkidle`, 1440×900 + 390×844, reduced-motion pair
Cost: **$0.00**. No new worktree. `:3021` was not fetched. `:3123` was down. `:3122` wave2 leftover was not scored.

---

## Total: **14 / 21** — usable prototype · **not** 19–21

First **production-host** 7×3 for this app. The 2026-08-31 card in
`docs/frontend-sota-gauntlet-2026-08-31/` was **`next dev` on `:3021`** and is
not this row. Same printed total, different host and server mode. Do not quote
19–21/21. Do not quote Awwwards 8+. Do not mix the 0–21 scale with the 0–10
ledger.

This SHA is **older than current `origin/dev` `5dff835`**. Wave 2 (`#166`,
`#151`) is not in the served tree. Recapture current HEAD later on a
production host; do not treat this print as the Wave 2 surface.

| # | Area | Score | Why |
|---|---|---:|---|
| 1 | Visual direction | **2** | Coherent dark mono ops chrome, lobster mark, one filled `mc-accent` CTA, real GitHub cards. Several accents still compete (ready green, warn amber, OFFLINE red, magenta feed). Polished, not memorable. |
| 2 | UX clarity | **2** | Home health + cockpit tabs + `Showing 595/595` + inbox safety-gate copy are scannable. Not 3: RM cell still painted `No token detected · 0/3 lanes ready` while the board already had 595 tasks; jargon (`post-migration`) stays. |
| 3 | Motion / interactivity | **2** | Busy `spin` (2) on the loaded cockpit; RM swaps to `fleet-busy-pulse` (4) with text-length parity (~123k). Supports status. No signature beat. |
| 4 | Technical quality | **2** | Production preflight `production_ok`. 7/7 HTTP 200. Overflow **0** with in-run 2200px control (`0 → 760/1810 → 0`). `pageErrors` []. Home console 503 is the honest OpenClaw probe. 2.5.8 AA 24×24 named: raw under-24 leftovers are skip-link 1×1 (sr-only until focus), `View history` 101×20, `Check` 51×22, icon 36×16, settings sort headers 16px tall — not adjudicated, **not** a 2.5.8 pass. 2.5.5 AAA 44×44 is unmet (622/1218 on the cockpit). This SHA still contains the `#151` / `#166` source leftovers. |
| 5 | Responsiveness | **2** | Overflow **0** at 1440 and 390. Mobile stacks tab pills and keeps the board usable. Two viewports only — stay at 2. |
| 6 | Verification | **2** | Browser shots, console, RM pair, overflow controls, production BUILD_ID preflight. No 15×4, no AT/manual. Stay at 2. |
| 7 | Complexity fit | **2** | Operator kanban is the right level — no cinematic overbuild. Not 3: this SHA still carries silent false-readiness (`#166` not served), so the level is not fully proved. |

### 7×3 print

`2 / 2 / 2 / 2 / 2 / 2 / 2` → **14/21**

---

## Identity

| Surface | Value |
|---|---|
| URL | `http://127.0.0.1:3121` isolated loopback |
| Server | `next start` (preflight `serverMode=production`, no next-dev HTML markers) |
| BUILD_ID | `S8HgxCEJWRAGRBloUGmn1` (flight `"b"` on first document + `assert-production-capture-target.mjs`) |
| Checkout SHA | `74f671740019e26a540405bcfe52f1e6a83d900e` |
| Settings field | Mission Control URL shows `http://127.0.0.1:3121` |
| Current `origin/dev` | `5dff835` — **not** this serve |
| `:3123` | refused (down). Disk BUILD_ID `FV4GCSEWeFK9di_tmIKhO` in `tmp/mck-prod-wave2` is leftover, not this score |
| `:3122` | live wave2 `next start` BUILD_ID `crFugjhxjk7cE1Ztoh-3N` — not scored |
| `:3021` | not fetched |

---

## Surfaces captured

| Shot | Route | Viewport | Overflow | ready | Console |
|---|---|---|---:|---|---|
| `shots/home-1440x900.png` | `/` | 1440×900 | 0 | n/a | OpenClaw 503 |
| `shots/home-390x844.png` | `/` | 390×844 | 0 | n/a | OpenClaw 503 |
| `shots/assistants-1440x900.png` | `/workspace/assistants` | 1440×900 | 0 | `true` · 123075 chars | none |
| `shots/assistants-390x844.png` | `/workspace/assistants` | 390×844 | 0 | `true` · 123007 chars | none |
| `shots/settings-1440x900.png` | `/settings` | 1440×900 | 0 | n/a | none |
| `shots/settings-390x844.png` | `/settings` | 390×844 | 0 | n/a | none |
| `shots/assistants-1440x900-rm.png` | `/workspace/assistants` | 1440×900 RM | 0 | `true` · 123125 chars · `fleet-busy-pulse` | none |

Receipt: `docs/frontend-sota-gauntlet-2026-09-01/receipt.json` (`capturedAt` `2026-09-01T04:39:14.639Z`).
Preflight: `identity.json`.

---

## What this does and does not unlock

**Unlocked.** A dated, browser-evidenced **production** 7×3 exists. Fleet
scoreboard can carry a first MCK row labelled `:3121` / `74f6717` /
`S8HgxCEJWRAGRBloUGmn1`.

**Not unlocked.** Wave 3, 15×4, `#90` pixels, G7 type-ramp, G12 memsys
rebuild, and supervised `:3088` / `:3001` / `:3021` / `:5111` work. Do not
close `#139`. Recapture on current `dev` when a production host serves
`5dff835` (or later).
