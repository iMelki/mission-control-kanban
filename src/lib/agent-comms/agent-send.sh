#!/bin/bash
# Usage: agent-send.sh <from> <to> <message>
MAILBOX_DIR="/tmp/openclaw-mailbox"
if [ -z "$1" ] || [ -z "$2" ] || [ -z "$3" ]; then
    echo "Usage: agent-send.sh <from> <to> <message>"
    exit 1
fi
mkdir -p "$MAILBOX_DIR"
ts=$(date +%s)
json_line=$(python3 -c 'import json, sys; print(json.dumps({"from": sys.argv[1], "to": sys.argv[2], "message": sys.argv[3], "ts": int(sys.argv[4])}))' "$1" "$2" "$3" "$ts")
printf '%s\n' "$json_line" >> "$MAILBOX_DIR/$2.jsonl"
echo "Sent to $2"
