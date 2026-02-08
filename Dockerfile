# --- Stage 1: Build ---
FROM node:22-bookworm AS builder

WORKDIR /app

# Install build dependencies
RUN apt-get update && apt-get install -y python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

# Install dependencies based on the preferred package manager
COPY package.json package-lock.json* ./
RUN npm ci

# Rebuild better-sqlite3 for the current architecture
RUN npm install better-sqlite3

# Copy the rest of the source
COPY . .

# Run build
RUN npm run build

# --- Stage 2: Runtime ---
FROM node:22-bookworm

WORKDIR /app

# Install Tailscale dependencies
RUN apt-get update && apt-get install -y curl ca-certificates gnupg \
    && rm -rf /var/lib/apt/lists/*

# Install Tailscale
RUN curl -fsSL https://tailscale.com/install.sh | sh

ENV NODE_ENV production

# Create nextjs user
RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs

# Copy build artifacts from builder stage
COPY --from=builder /app/public ./public
COPY --from=builder /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

# Copy Tailscale startup script
COPY scripts/start-tailscale.sh /app/scripts/start-tailscale.sh
RUN chmod +x /app/scripts/start-tailscale.sh

# Ensure nextjs user owns the app directory
RUN chown -R nextjs:nodejs /app

USER nextjs

EXPOSE 3000

ENV PORT 3000
ENV HOSTNAME "0.0.0.0"

# Use the startup script
ENTRYPOINT ["/app/scripts/start-tailscale.sh"]
CMD ["node", "server.js"]
