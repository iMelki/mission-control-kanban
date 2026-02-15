#!/bin/bash

# Define socket path
SOCKET_DIR="/app/tailscale"
mkdir -p "$SOCKET_DIR"
SOCKET_PATH="$SOCKET_DIR/tailscaled.sock"
PROXY_PORT=1055

echo "Starting Tailscale (Userspace Mode)..."
# Start tailscaled in background
# --tun=userspace-networking: allows running without /dev/net/tun
# --socket: explicit socket path accessible by user
# --state=mem: ensures the node is ephemeral and removed on disconnect
tailscaled \
  --tun=userspace-networking \
  --socket="$SOCKET_PATH" \
  --state=mem: \
  --socks5-server=localhost:$PROXY_PORT \
  --outbound-http-proxy-listen=localhost:$PROXY_PORT \
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
  # Note: --ephemeral is implied by --state=mem: on the daemon
  tailscale --socket="$SOCKET_PATH" up --authkey="$TS_AUTHKEY" --hostname="${TS_HOSTNAME:-mission-control}"
  
  echo "Configuring Tailscale Serve..."
  # Serve HTTP on port 80 via Tailscale, proxying to localhost:3000
  tailscale --socket="$SOCKET_PATH" serve --bg --http=80 localhost:3000

  # Configure proxy variables for outbound connections (so mission-control can reach Claw)
  # Only set these when Tailscale is active to avoid breaking non-Tailscale deployments
  export HTTP_PROXY=http://localhost:$PROXY_PORT
  export HTTPS_PROXY=http://localhost:$PROXY_PORT
  export NO_PROXY=localhost,127.0.0.1
fi

# Export socket for subsequent commands
export TS_SOCKET="$SOCKET_PATH"

# Run the main command (Next.js standalone server)
echo "Starting Mission Control..."
exec "$@"
