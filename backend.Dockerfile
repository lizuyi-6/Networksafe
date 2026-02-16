FROM node:18-alpine

WORKDIR /app/backend

# Install system dependencies
# Nuclei needs ca-certificates
# python3, make, g++ are often needed for native node modules
RUN apk add --no-cache \
    wget \
    tar \
    ca-certificates \
    git \
    python3 \
    make \
    g++

# Install Nuclei (ProjectDiscovery)
ENV NUCLEI_VERSION=3.1.8
RUN if wget -q -O nuclei.tar.gz https://github.com/projectdiscovery/nuclei/releases/download/v${NUCLEI_VERSION}/nuclei_${NUCLEI_VERSION}_linux_amd64.tar.gz; then \
    tar -xzvf nuclei.tar.gz && \
    mv nuclei /usr/local/bin/ && \
    rm nuclei.tar.gz && \
    chmod +x /usr/local/bin/nuclei; \
    else \
    echo "Skipping Nuclei install: download failed"; \
    fi

# Copy backend dependency manifest first for layer caching
COPY backend/package*.json ./

# Install backend dependencies
RUN npm config set registry https://registry.npmmirror.com/
RUN npm install

# Copy backend source code
COPY backend ./

# Create data directory for persistence
RUN mkdir -p /app/data /app/scan-results /app/backend/data

# Expose port
EXPOSE 3005

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider http://localhost:3005/api/health || exit 1

# Run server using tsx directly from backend workspace
CMD ["npx", "tsx", "src/index.ts"]
