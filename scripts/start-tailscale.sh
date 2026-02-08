#!/bin/bash

# Define socket path
SOCKET_DIR="/app/tailscale"
mkdir -p "$SOCKET_DIR"
SOCKET_PATH="$SOCKET_DIR/tailscaled.sock"
STATE_PATH="$SOCKET_DIR/tailscaled.state"

echo "Starting Tailscale (Userspace Mode)..."
# Start tailscaled in background
# --tun=userspace-networking: allows running without /dev/net/tun
# --socket: explicit socket path accessible by user
tailscaled \
  --tun=userspace-networking \
  --socket="$SOCKET_PATH" \
  --state="$STATE_PATH" \
  --socks5-server=localhost:1055 \
  --outbound-http-proxy-listen=localhost:1055 \
  > "$SOCKET_DIR/tailscaled.log" 2>&1 &

# Wait for socket
echo "Waiting for Tailscale socket..."
TIMEOUT=10
while [ ! -S "$SOCKET_PATH" ]; do
  sleep 0.5
  TIMEOUT=$((TIMEOUT-1))
  if [ $TIMEOUT -eq 0 ]; then
    echo "Timed out waiting for Tailscale socket"
    break
  fi
done

# Authenticate if key provided
if [ ! -z "$TS_AUTHKEY" ]; then
  echo "Authenticating Tailscale..."
  tailscale --socket="$SOCKET_PATH" up --authkey="$TS_AUTHKEY" --hostname="${TS_HOSTNAME:-mission-control}"
fi

# Export socket for subsequent commands
export TS_SOCKET="$SOCKET_PATH"

# Run the main command (Next.js standalone server)
echo "Starting Mission Control..."
exec "$@"
