# ============================================================
# Stage 1: Builder
# ============================================================
# vite 8 requires Node 20.19+ — keep in sync with the toolchain in package.json
FROM node:22-alpine@sha256:16e22a550f3863206a3f701448c45f7912c6896a62de43add43bb9c86130c3e2 AS builder

# FE-001 (audit 2026-08): demo mode is a build-time opt-in (canUseDemoMode()).
# Default OFF for production builds; release-verify passes true so the e2e
# walkthrough can exercise demo pages. Vite bakes import.meta.env at build time.
ARG VITE_ENABLE_DEMO_MODE
ENV VITE_ENABLE_DEMO_MODE=$VITE_ENABLE_DEMO_MODE

WORKDIR /app

# Copy manifests first for layer caching
COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build

# ============================================================
# Stage 2: Production (Nginx)
# ============================================================
# DP-008 (audit 2026-08): digest-pinned; DP-013: nginx official image ships
# an unprivileged 'nginx' user — run as it (master drops to it anyway for
# workers; the master now also runs non-root, port 80 is fine because the
# image's default.conf listens 80 via kernel CAP_NET_BIND_SERVICE given to
# the uid by the image's entrypoint... plain nginx binary binds 80 as
# non-root only with the documented 'user nginx;' + capabilities approach;
# safest non-root form here is listening unprivileged via the copied conf).
FROM nginx:1.27-alpine@sha256:65645c7bb6a0661892a8b03b89d0743208a18dd2f3f17a54ef4b76fb8e2f2a10

# Remove default config and assets
RUN rm -rf /usr/share/nginx/html/* /etc/nginx/conf.d/default.conf

# Copy built assets
COPY --from=builder /app/dist /usr/share/nginx/html

# Copy custom nginx config
COPY nginx.conf /etc/nginx/conf.d/default.conf

# Note: nginx -t skipped because 'backend' host only exists at runtime in Docker network

# DP-013: unprivileged runtime. nginx:alpine's default conf (we replace it)
# listens on 80; the official image grants cap_net_bind_service to the nginx
# user's binaries via file capabilities on nginx, so non-root binding works.
# /run must be chowned directly: in alpine /var/run is a symlink to /run, so
# chowning /var/run does not reach the default pid path /run/nginx.pid —
# without this the unprivileged nginx exits emerg ("open() /run/nginx.pid
# failed (13: Permission denied)") and the container crash-loops.
RUN chown -R nginx:nginx /usr/share/nginx/html /etc/nginx/conf.d /var/cache/nginx /run
USER nginx

EXPOSE 8080

HEALTHCHECK --interval=15s --timeout=5s --start-period=10s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider http://127.0.0.1:8080/index.html || exit 1

CMD ["nginx", "-g", "daemon off;"]
