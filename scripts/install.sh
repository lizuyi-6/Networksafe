#!/bin/bash

# NewSecurity One-Click Installation Script

set -e

echo "🚀 NewSecurity Installation Script"
echo "=================================="

# Check if running as root
if [ "$EUID" -ne 0 ]; then
    echo "❌ Please run as root (use sudo)"
    exit 1
fi

# Check if Docker is installed
if ! command -v docker &> /dev/null; then
    echo "📦 Installing Docker..."
    curl -fsSL https://get.docker.com -o get-docker.sh
    sh get-docker.sh
    systemctl start docker
    systemctl enable docker
else
    echo "✅ Docker already installed"
fi

# Check if Docker Compose is installed
if ! command -v docker-compose &> /dev/null; then
    echo "📦 Installing Docker Compose..."
    curl -L "https://github.com/docker/compose/releases/latest/download/docker-compose-$(uname -s)-$(uname -m)" -o /usr/local/bin/docker-compose
    chmod +x /usr/local/bin/docker-compose
else
    echo "✅ Docker Compose already installed"
fi

# Create project directory
PROJECT_DIR="/opt/newsecurity"
echo "📁 Creating project directory at $PROJECT_DIR"
mkdir -p "$PROJECT_DIR"
cd "$PROJECT_DIR"

# Create necessary directories
mkdir -p data certs logs redis-data

# Get email for SSL
read -p "📧 Enter your email for Let's Encrypt SSL certificates: " SSL_EMAIL
export SSL_EMAIL

# Prompt for HTTP/HTTPS ports
read -p "🌐 HTTP port (default: 80): " HTTP_PORT
HTTP_PORT=${HTTP_PORT:-80}

read -p "🔒 HTTPS port (default: 443): " HTTPS_PORT
HTTPS_PORT=${HTTPS_PORT:-443}

# Create docker-compose.yml
cat > docker-compose.yml <<EOF
version: '3.8'

services:
  newsecurity:
    build:
      context: .
      dockerfile: docker/Dockerfile
    container_name: newsecurity
    restart: unless-stopped
    ports:
      - "${HTTP_PORT}:80"
      - "${HTTPS_PORT}:443"
    volumes:
      - ./data:/app/data
      - ./certs:/app/certs
      - ./logs:/app/logs
    environment:
      - NODE_ENV=production
      - HTTP_PORT=80
      - HTTPS_PORT=443
      - REDIS_URL=redis://redis:6379
      - SSL_EMAIL=${SSL_EMAIL}
    depends_on:
      - redis
    networks:
      - newsecurity-network
    privileged: true
    cap_add:
      - NET_ADMIN
      - NET_RAW

  redis:
    image: redis:7-alpine
    container_name: newsecurity-redis
    restart: unless-stopped
    command: redis-server --appendonly yes
    volumes:
      - ./redis-data:/data
    networks:
      - newsecurity-network

networks:
  newsecurity-network:
    driver: bridge
EOF

echo "🐳 Building Docker image..."
docker-compose build

echo "🚀 Starting NewSecurity..."
docker-compose up -d

echo ""
echo "✅ Installation Complete!"
echo "======================="
echo ""
echo "🎉 NewSecurity is now running!"
echo ""
echo "📍 Access points:"
echo "   - HTTP:  http://localhost:${HTTP_PORT}"
echo "   - HTTPS: https://localhost:${HTTPS_PORT}"
echo "   - API:   http://localhost:${HTTP_PORT}/api"
echo ""
echo "📊 View logs:"
echo "   docker-compose logs -f"
echo ""
echo "🛑 Stop NewSecurity:"
echo "   docker-compose down"
echo ""
echo "🔄 Restart NewSecurity:"
echo "   docker-compose restart"
echo ""
echo "📖 Documentation: https://github.com/your-org/NewSecurity"
echo ""
