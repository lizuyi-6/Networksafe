# NewSecurity Dockerfile

FROM node:20-alpine

# Install dependencies
RUN apk add --no-cache \
    openssl \
    nmap \
    nmap-nscript \
    bash \
    curl

WORKDIR /app

# Copy backend package files
COPY backend/package*.json ./backend/
COPY backend/tsconfig.json ./backend/

# Install backend dependencies
WORKDIR /app/backend
RUN npm install

# Copy backend source
COPY backend/src ./src

# Build backend
RUN npm run build

# Copy frontend (will be built separately)
# COPY frontend/build ./frontend/build

# Create data directory
RUN mkdir -p /app/data /app/certs

# Set environment variables
ENV NODE_ENV=production
HTTP_PORT=80
HTTPS_PORT=443
DATA_DIR=/app/data
CERTS_DIR=/app/certs

# Expose ports
EXPOSE 80 443

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD curl -f http://localhost/api/health || exit 1

# Start the application
CMD ["npm", "start"]
