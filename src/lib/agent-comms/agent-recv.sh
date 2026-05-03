#!/bin/bash
# Usage: agent-recv.sh <label> [--wait <seconds>]
MAILBOX_DIR="/tmp/openclaw-mailbox"
MAILBOX="$MAILBOX_DIR/$1.jsonl"
[ -z "$1" ] && echo "Usage: agent-recv.sh <label> [--wait <seconds>]" && exit 1
mkdir -p "$MAILBOX_DIR"
consume_mailbox() {
  if [ -f "$MAILBOX" ] && [ -s "$MAILBOX" ]; then
    tmp_mailbox=$(mktemp "$MAILBOX_DIR/${1}.XXXXXX") || exit 1
    mv "$MAILBOX" "$tmp_mailbox" || {
      rm -f "$tmp_mailbox"
      exit 1
    }
    touch "$MAILBOX" || {
      cat "$tmp_mailbox"
      rm -f "$tmp_mailbox"
      exit 1
    }
    cat "$tmp_mailbox"
    rm -f "$tmp_mailbox"
    return 0
  fi
  return 1
}

if [ "$2" = "--wait" ]; then
  timeout=${3:-30}
  case "$timeout" in
    ''|*[!0-9]*|0)
      echo "Invalid wait timeout: must be a positive integer" >&2
      exit 1
      ;;
  esac
  for i in $(seq 1 "$timeout"); do
    consume_mailbox "$1" && exit 0
    sleep 1
  done
  echo "TIMEOUT: No messages after ${timeout}s" && exit 1
else
  consume_mailbox "$1" || echo "NO_MESSAGES"
fi
