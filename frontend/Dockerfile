# ============================================================
# Stage 1: Builder
# ============================================================
FROM node:18-alpine AS builder

WORKDIR /app

# Copy manifests first for layer caching
COPY package*.json ./
RUN npm config set registry https://registry.npmmirror.com/ && \
    npm ci

COPY . .
RUN npm run build

# ============================================================
# Stage 2: Production (Nginx)
# ============================================================
FROM nginx:1.27-alpine

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
