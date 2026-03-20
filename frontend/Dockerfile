# ============================================================
# Stage 1: Builder
# ============================================================
FROM node:18-alpine@sha256:8d6421d663b4c28fd3ebc498332f249011d118945588d0a35cb9bc4b8ca09d9e AS builder

WORKDIR /app

# Copy manifests first for layer caching
COPY package*.json ./
RUN npm config set registry https://registry.npmmirror.com/ && \
    if [ -f package-lock.json ]; then npm ci; else npm install; fi

COPY . .
RUN npm run build

# ============================================================
# Stage 2: Production (Nginx)
# ============================================================
FROM nginx:1.27-alpine@sha256:65645c7bb6a0661892a8b03b89d0743208a18dd2f3f17a54ef4b76fb8e2f2a10

# Remove default config and assets
RUN rm -rf /usr/share/nginx/html/* /etc/nginx/conf.d/default.conf

# Copy built assets
COPY --from=builder /app/dist /usr/share/nginx/html

# Copy custom nginx config
COPY nginx.conf /etc/nginx/conf.d/default.conf

# Note: nginx -t skipped because 'backend' host only exists at runtime in Docker network

EXPOSE 80

HEALTHCHECK --interval=15s --timeout=5s --start-period=10s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider http://127.0.0.1/index.html || exit 1

CMD ["nginx", "-g", "daemon off;"]
