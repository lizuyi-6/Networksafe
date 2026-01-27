FROM node:18-alpine

WORKDIR /app

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
RUN wget -q -O nuclei.tar.gz https://github.com/projectdiscovery/nuclei/releases/download/v${NUCLEI_VERSION}/nuclei_${NUCLEI_VERSION}_linux_amd64.tar.gz && \
    tar -xzvf nuclei.tar.gz && \
    mv nuclei /usr/local/bin/ && \
    rm nuclei.tar.gz && \
    chmod +x /usr/local/bin/nuclei

# Copy root config files
COPY package.json tsconfig.json ./

# Install root dependencies
RUN npm config set registry https://registry.npmmirror.com/
RUN npm install

# Copy source directory structure
# We copy specific directories to avoid copying irrelevant files
COPY backend ./backend
COPY installer ./installer

# Create data directory for persistence
RUN mkdir -p /app/data /app/scan-results

# Expose port
EXPOSE 3005

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider http://localhost:3005/api/health || exit 1

# Run server using tsx
CMD ["npx", "tsx", "backend/src/server.ts"]
