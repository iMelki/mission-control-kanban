# Agent Communication Protocol

## Overview
Enables direct communication between OpenClaw sub-agents. Two approaches:

### Approach 1: Source Patch (Preferred)
Remove `sessions_send`/`sessions_list` from OpenClaw's `DEFAULT_SUBAGENT_TOOL_DENY`. See `PATCH.md`.

### Approach 2: File-Based Mailbox (Fallback)
Mailbox dir: `/tmp/openclaw-mailbox/`
Each agent gets: `/tmp/openclaw-mailbox/{label}.jsonl`
Format (JSONL): `{"from":"sender","to":"recipient","message":"...","ts":1738800000}`

**Send:** `./agent-send.sh <from> <to> "<message>"`
**Recv:** `./agent-recv.sh <label> [--wait 30]`

### Spawn Prompt Template
```
You can communicate with other agents:
- Send: mkdir -p /tmp/openclaw-mailbox && FROM="YOUR_LABEL" TO="PEER_LABEL" MSG="MSG" python3 -c 'import json, os, time; print(json.dumps({"from": os.environ["FROM"], "to": os.environ["TO"], "message": os.environ["MSG"], "ts": int(time.time())}, ensure_ascii=False))' >> /tmp/openclaw-mailbox/PEER_LABEL.jsonl
- Recv: cat /tmp/openclaw-mailbox/YOUR_LABEL.jsonl 2>/dev/null
- The send command uses Python JSON serialization so quotes/newlines in MSG are escaped correctly.
```
