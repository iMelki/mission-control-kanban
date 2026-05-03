#!/bin/bash

# Define socket path
ensure_owner() {
  local path="$1"
  local owner
  owner=$(stat -c '%U:%G' "$path")
  if [ "$owner" != "nextjs:nodejs" ]; then
    chown nextjs:nodejs "$path"
  fi
}

# Fix permissions on required directories only (since we start as root)
echo "Ensuring ownership on required data directories..."
mkdir -p /app/data
ensure_owner /app/data

# Define paths for persistent storage
SOCKET_DIR="/app/data/tailscale"
mkdir -p "$SOCKET_DIR"
ensure_owner "$SOCKET_DIR"
SOCKET_PATH="$SOCKET_DIR/tailscaled.sock"
STATE_PATH="$SOCKET_DIR/tailscaled.state"
PROXY_PORT=1055

echo "Starting Tailscale (Userspace Mode)..."
# Start tailscaled in background
# --tun=userspace-networking: allows running without /dev/net/tun
# --socket: explicit socket path accessible by user
# --state: persistent state file on volume
tailscaled \
  --tun=userspace-networking \
  --socket="$SOCKET_PATH" \
  --state="$STATE_PATH" \
  --outbound-http-proxy-listen=localhost:$PROXY_PORT \
  > "$SOCKET_DIR/tailscaled.log" 2>&1 &
TAILSCALED_PID=$!

# Wait for socket
echo "Waiting for Tailscale socket..."
TIMEOUT_SECONDS=10
TIMEOUT_TICKS=$((TIMEOUT_SECONDS * 2))
while [ ! -S "$SOCKET_PATH" ]; do
  if ! kill -0 "$TAILSCALED_PID" 2>/dev/null; then
    echo "tailscaled exited before creating socket"
    [ -f "$SOCKET_DIR/tailscaled.log" ] && tail -n 50 "$SOCKET_DIR/tailscaled.log"
    wait "$TAILSCALED_PID" 2>/dev/null
    exit 1
  fi

  sleep 0.5
  TIMEOUT_TICKS=$((TIMEOUT_TICKS-1))
  if [ "$TIMEOUT_TICKS" -le 0 ]; then
    echo "Timed out waiting for Tailscale socket"
    [ -f "$SOCKET_DIR/tailscaled.log" ] && tail -n 50 "$SOCKET_DIR/tailscaled.log"
    kill -SIGTERM "$TAILSCALED_PID" 2>/dev/null
    wait "$TAILSCALED_PID" 2>/dev/null
    exit 1
  fi
done

# Cleanup function (kill process but DO NOT logout to preserve identity)
cleanup() {
  echo "Stopping Tailscale..."
  kill -SIGTERM $TAILSCALED_PID
  wait $TAILSCALED_PID
}
# Trap exit signals to ensure cleanup runs
trap cleanup SIGINT SIGTERM EXIT

# Authenticate if key provided
if [ ! -z "$TS_AUTHKEY" ]; then
  if [ -f "$STATE_PATH" ]; then
    echo "Tailscale state exists, attempting to reuse..."
    # Try to up with existing state. Use timeout to avoid hanging.
    if ! timeout 10s tailscale --socket="$SOCKET_PATH" up --hostname="${TS_HOSTNAME:-mission-control}"; then
        echo "State reuse failed. Re-authenticating..."
        tailscale --socket="$SOCKET_PATH" up --authkey="$TS_AUTHKEY" --hostname="${TS_HOSTNAME:-mission-control}" --reset
    fi
  else
    echo "Authenticating Tailscale..."
    tailscale --socket="$SOCKET_PATH" up --authkey="$TS_AUTHKEY" --hostname="${TS_HOSTNAME:-mission-control}"
  fi

  echo "Configuring Tailscale Serve..."
  # Serve HTTP on port 80/443 via Tailscale, proxying to 127.0.0.1:${PORT:-3000}

  # Wait a bit for stabilization
  sleep 2

  # Try HTTPS first (for secure context/identity if needed mostly for browser clients)
  timeout 10s tailscale --socket="$SOCKET_PATH" serve --bg --https=443 "http://127.0.0.1:${PORT:-3000}" || echo "Failed to configure HTTPS serve"

  # Also serve HTTP on the app port
  timeout 10s tailscale --socket="$SOCKET_PATH" serve --bg --http=80 "http://127.0.0.1:${PORT:-3000}" || echo "Failed to configure HTTP serve"

  # Configure proxy variables for outbound connections
  export HTTP_PROXY=http://localhost:$PROXY_PORT
  export HTTPS_PROXY=http://localhost:$PROXY_PORT
  export NO_PROXY=localhost,127.0.0.1
fi

# Export socket for subsequent commands
export TS_SOCKET="$SOCKET_PATH"

# Run the main command as nextjs user
echo "Starting Mission Control as nextjs user..."
gosu nextjs "$@" &
APP_PID=$!
wait $APP_PID
