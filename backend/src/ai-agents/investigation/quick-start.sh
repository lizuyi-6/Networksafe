#!/bin/bash

# Bug Investigation Agent Team - Quick Start Script

echo "🔍 Bug Investigation Agent Team - Quick Start"
echo "================================================"
echo ""

# Check if backend directory exists
if [ ! -d "backend" ]; then
    echo "❌ Error: backend directory not found"
    echo "Please run this script from the project root"
    exit 1
fi

cd backend

# Check Node.js version
echo "📦 Checking Node.js version..."
node_version=$(node -v 2>/dev/null)
if [ $? -ne 0 ]; then
    echo "❌ Error: Node.js not installed"
    exit 1
fi
echo "✅ Node.js version: $node_version"
echo ""

# Check if dependencies are installed
if [ ! -d "node_modules" ]; then
    echo "📥 Installing dependencies..."
    npm install
    if [ $? -ne 0 ]; then
        echo "❌ Error: Failed to install dependencies"
        exit 1
    fi
    echo "✅ Dependencies installed"
else
    echo "✅ Dependencies already installed"
fi
echo ""

# Check environment variables
echo "🔧 Checking environment configuration..."
if [ ! -f ".env" ]; then
    echo "⚠️  Warning: .env file not found"
    echo "Creating .env file with default values..."
    cat > .env << EOF
# AI Model Configuration
AI_MODEL_ENDPOINT=https://dashscope.aliyuncs.com/compatible-mode/v1
AI_MODEL_API_KEY=your-api-key-here
AI_MODEL_TYPE=qwen-max

# Database Configuration
INVESTIGATION_DB_PATH=./data/investigations.db

# Server Configuration
PORT=3000
NODE_ENV=development

# Security
JWT_SECRET=your-jwt-secret-here
EOF
    echo "✅ .env file created"
    echo "⚠️  Please update AI_MODEL_API_KEY and JWT_SECRET in .env"
else
    echo "✅ .env file found"
fi
echo ""

# Create data directory
if [ ! -d "data" ]; then
    echo "📁 Creating data directory..."
    mkdir -p data
    echo "✅ Data directory created"
else
    echo "✅ Data directory exists"
fi
echo ""

# Build TypeScript
echo "🔨 Building TypeScript..."
npm run build
if [ $? -ne 0 ]; then
    echo "❌ Error: TypeScript build failed"
    echo "Please check for compilation errors"
    exit 1
fi
echo "✅ TypeScript build successful"
echo ""

# Run tests
echo "🧪 Running tests..."
npm test -- --testPathPattern=investigation --passWithNoTests
if [ $? -eq 0 ]; then
    echo "✅ Tests passed"
else
    echo "⚠️  Some tests failed or were skipped"
fi
echo ""

# Start the server
echo "🚀 Starting server..."
echo "The Bug Investigation Agent Team will be available at:"
echo "  - http://localhost:3000/api/investigation"
echo ""
echo "API Endpoints:"
echo "  POST   /api/investigation/start         - Start investigation"
echo "  GET    /api/investigation/:id/status    - Get status"
echo "  GET    /api/investigation/:id/result    - Get result"
echo "  GET    /api/investigation/active        - List active"
echo "  GET    /api/investigation/capabilities  - Get capabilities"
echo "  GET    /api/investigation/history       - Get history"
echo ""
echo "Press Ctrl+C to stop the server"
echo ""

npm start
