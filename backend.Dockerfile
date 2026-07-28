# ============================================================
# Stage 1: Builder
# ============================================================
FROM node:22-alpine@sha256:16e22a550f3863206a3f701448c45f7912c6896a62de43add43bb9c86130c3e2 AS builder

WORKDIR /app/backend

RUN apk add --no-cache python3 make g++

COPY backend/package.json backend/package-lock.json ./
RUN mkdir -p /root/.cache/node-gyp && \
    npm_config_build_from_source=true \
    npm_config_nodedir=/usr/local \
    npm ci --no-audit --no-fund

COPY backend/ ./
RUN rm -rf dist
COPY backend/tsconfig.build.json ./tsconfig.build.json
RUN npm run build
RUN test -f dist/index.js
# Compile native modules once against the Node headers already present in the
# pinned base image, then retain only production dependencies for the runner.
RUN npm prune --omit=dev --no-audit --no-fund && \
    node -e "require('better-sqlite3')"

# ============================================================
# Stage 2: Production Runner
# ============================================================
FROM node:22-alpine@sha256:16e22a550f3863206a3f701448c45f7912c6896a62de43add43bb9c86130c3e2 AS runner

RUN apk add --no-cache \
    wget \
    tar \
    ca-certificates \
    git \
    unzip \
    dumb-init

# Nuclei is a runtime scanner dependency. Verify the release archive and fail
# the image build when the binary is unavailable instead of silently omitting it.
ENV NUCLEI_VERSION=3.1.8
ARG TARGETARCH=amd64
RUN case "$TARGETARCH" in \
      amd64) NUCLEI_SHA256="b78a3a3892c64e5b5cc9155f5211e96d465c595db365298ea19f031822dfc6c0" ;; \
      arm64) NUCLEI_SHA256="c0ba62a3976f1d545808b7dd4dce97c0ad46d3d67ac1febcab661cb5d0ec312a" ;; \
      *) echo "Unsupported Nuclei architecture: $TARGETARCH" >&2; exit 1 ;; \
    esac && \
    NUCLEI_ARCHIVE="nuclei_${NUCLEI_VERSION}_linux_${TARGETARCH}.zip" && \
    wget -q -O "$NUCLEI_ARCHIVE" \
      "https://github.com/projectdiscovery/nuclei/releases/download/v${NUCLEI_VERSION}/${NUCLEI_ARCHIVE}" && \
    echo "$NUCLEI_SHA256  $NUCLEI_ARCHIVE" | sha256sum -c - && \
    unzip -q "$NUCLEI_ARCHIVE" nuclei && \
    install -m 0755 nuclei /usr/local/bin/nuclei && \
    rm -f "$NUCLEI_ARCHIVE" nuclei && \
    nuclei -version

WORKDIR /app/backend

COPY backend/package.json backend/package-lock.json ./
COPY --from=builder /app/backend/node_modules ./node_modules
COPY --from=builder /app/backend/dist ./dist

RUN mkdir -p /app/data /app/scan-results /app/artifacts /app/backend/data

RUN addgroup -S appgroup && adduser -S appuser -G appgroup
# Keep application code and dependencies root-owned. Only runtime data paths
# are writable by the unprivileged process.
RUN chown -R appuser:appgroup /app/data /app/scan-results /app/artifacts /app/backend/data
USER appuser

EXPOSE 3005

HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=5 \
    CMD wget --no-verbose --tries=1 --spider http://localhost:3005/health/ready || exit 1

ENTRYPOINT ["/usr/bin/dumb-init", "--"]
CMD ["node", "dist/index.js"]
