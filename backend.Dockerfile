# ============================================================
# Stage 1: Builder
# ============================================================
FROM node:20-alpine@sha256:b88333c42c23fbd91596ebd7fd10de239cedab9617de04142dde7315e3bc0afa AS builder

WORKDIR /app/backend

# Install build-time native deps
RUN apk add --no-cache python3 make g++

# Copy manifests first for layer caching
COPY backend/package*.json ./
RUN mkdir -p /root/.cache/node-gyp && \
    npm config set registry https://registry.npmmirror.com/ && \
    if [ -f package-lock.json ]; then npm ci; else npm install; fi

# Copy source and build
COPY backend/ ./
# Prevent stale local build artifacts from leaking into image
RUN rm -rf dist
# Force copy tsconfig to ensure latest version
COPY backend/tsconfig.build.json ./tsconfig.build.json
# Run strict TypeScript build; fail fast on compile errors
RUN npx tsc --project tsconfig.build.json --skipLibCheck
# Sanity check compiled output
RUN mkdir -p dist && ls -la dist/

# ============================================================
# Stage 2: Production Runner
# ============================================================
FROM node:20-alpine@sha256:b88333c42c23fbd91596ebd7fd10de239cedab9617de04142dde7315e3bc0afa AS runner

# Install runtime system deps
RUN apk add --no-cache \
    wget \
    tar \
    ca-certificates \
    git \
    python3 \
    make \
    g++ \
    dumb-init

# Install Nuclei (ProjectDiscovery) — skip gracefully if download fails
ENV NUCLEI_VERSION=3.1.8
RUN wget -q -O nuclei.tar.gz \
    "https://github.com/projectdiscovery/nuclei/releases/download/v${NUCLEI_VERSION}/nuclei_${NUCLEI_VERSION}_linux_amd64.tar.gz" \
    && tar -xzf nuclei.tar.gz nuclei \
    && mv nuclei /usr/local/bin/ \
    && chmod +x /usr/local/bin/nuclei \
    && rm nuclei.tar.gz \
    || echo "Nuclei download failed — skipping"

WORKDIR /app/backend

# Install ONLY production dependencies
COPY backend/package*.json ./
RUN mkdir -p /root/.cache/node-gyp && \
    npm config set registry https://registry.npmmirror.com/ && \
    if [ -f package-lock.json ]; then npm ci --omit=dev; else npm install --omit=dev; fi

# Copy compiled output from builder
COPY --from=builder /app/backend/dist ./dist

# Persistent data directories (mount as volumes in production)
RUN mkdir -p /app/data /app/scan-results /app/artifacts /app/backend/data

# Drop root — run as non-privileged user
RUN addgroup -S appgroup && adduser -S appuser -G appgroup
RUN chown -R appuser:appgroup /app
USER appuser

EXPOSE 3005

# Give the app plenty of time to start (DB init + WASM load can be slow)
HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=5 \
    CMD wget --no-verbose --tries=1 --spider http://localhost:3005/api/health || exit 1

# Use dumb-init to handle PID 1 signals correctly
ENTRYPOINT ["/usr/bin/dumb-init", "--"]
CMD ["node", "dist/index.js"]
