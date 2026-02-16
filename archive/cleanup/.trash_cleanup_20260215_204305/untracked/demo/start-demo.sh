#!/bin/bash

# FluxGuard Demo - Linux/Mac Startup Script
# Starts the complete demo environment with real Multi-Agent System

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
GRAY='\033[0;90m'
WHITE='\033[1;37m'
NC='\033[0m'

MODEL="${MODEL:-llama3:8b}"

print_header() {
    echo ""
    echo -e "${CYAN}╔════════════════════════════════════════════════════════════════╗${NC}"
    echo -e "${CYAN}║        FluxGuard Multi-Agent Security Demo                     ║${NC}"
    echo -e "${CYAN}║           Real AI Agents + Traffic Interceptor                 ║${NC}"
    echo -e "${CYAN}╚════════════════════════════════════════════════════════════════╝${NC}"
    echo ""
}

check_docker() {
    if ! docker info > /dev/null 2>&1; then
        echo -e "${RED}❌ Docker is not running. Please start Docker.${NC}"
        exit 1
    fi
}

wait_for_service() {
    local url="$1"
    local service="$2"
    local timeout="${3:-60}"
    
    echo -n "   ⏳ Waiting for $service..."
    local start=$(date +%s)
    
    while true; do
        if curl -sf "$url" > /dev/null 2>&1; then
            echo -e " ${GREEN}✅${NC}"
            return 0
        fi
        
        local now=$(date +%s)
        if [ $((now - start)) -ge $timeout ]; then
            echo -e " ${RED}❌${NC}"
            return 1
        fi
        
        sleep 0.5
    done
}

start_demo() {
    print_header
    check_docker

    echo -e "${YELLOW}🚀 Starting FluxGuard Multi-Agent Demo Environment...${NC}"
    echo ""

    cd "$SCRIPT_DIR"

    echo -e "${BLUE}📦 Building containers...${NC}"
    docker-compose -f docker-compose.demo.yml build --parallel

    echo ""
    echo -e "${BLUE}🔧 Starting core services...${NC}"
    docker-compose -f docker-compose.demo.yml up -d redis ollama

    echo ""
    echo -e "${BLUE}⏳ Waiting for Ollama to be ready (this may take a minute)...${NC}"
    
    if wait_for_service "http://localhost:11434/api/tags" "Ollama" 120; then
        echo ""
        echo -e "${BLUE}🤖 Pulling AI model ($MODEL)...${NC}"
        echo -e "${GRAY}   This may take several minutes on first run...${NC}"
        
        docker exec demo-ollama-1 ollama pull "$MODEL" 2>&1 | while read line; do
            echo -e "${GRAY}   $line${NC}"
        done || {
            echo -e "${YELLOW}   ⚠️ Could not pull model automatically. Pull manually with:${NC}"
            echo -e "${YELLOW}   docker exec -it demo-ollama-1 ollama pull $MODEL${NC}"
        }
    fi

    echo ""
    echo -e "${BLUE}🔧 Starting application services...${NC}"
    docker-compose -f docker-compose.demo.yml up -d vulnerable-app backend dashboard

    echo ""
    echo -e "${BLUE}⏳ Waiting for services to be ready...${NC}"
    wait_for_service "http://localhost:8080/health" "Vulnerable App"
    wait_for_service "http://localhost:3005/api/health" "Backend API"

    echo ""
    echo -e "${GREEN}✅ Demo environment is ready!${NC}"
    echo ""
    echo -e "${GRAY}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo ""
    echo -e "${WHITE}🌐 Access Points:${NC}"
    echo -e "   • Dashboard:        ${CYAN}http://localhost:5173${NC}"
    echo -e "   • Vulnerable App:   ${CYAN}http://localhost:8080${NC}"
    echo -e "   • Backend API:      ${CYAN}http://localhost:3005${NC}"
    echo -e "   • Ollama API:       ${CYAN}http://localhost:11434${NC}"
    echo ""
    echo -e "${WHITE}📊 Dashboard Pages:${NC}"
    echo -e "   • Agent Monitor:    ${GREEN}http://localhost:5173/dashboard/agents${NC}"
    echo -e "   • Traffic Monitor:  ${GREEN}http://localhost:5173/dashboard/traffic${NC}"
    echo -e "   • Attack Simulator: ${GREEN}http://localhost:5173/dashboard/attack${NC}"
    echo ""
    echo -e "${WHITE}🔥 Attack Simulation:${NC}"
    echo -e "   Run: ${YELLOW}./start-demo.sh --attack${NC}"
    echo ""
    echo -e "${WHITE}📊 View Logs:${NC}"
    echo -e "   Run: ${YELLOW}./start-demo.sh --logs${NC}"
    echo ""
    echo -e "${WHITE}🤖 Pull Different Model:${NC}"
    echo -e "   Run: ${YELLOW}MODEL=llama3:70b ./start-demo.sh${NC}"
    echo ""
    echo -e "${WHITE}🛑 Stop Demo:${NC}"
    echo -e "   Run: ${YELLOW}./start-demo.sh --stop${NC}"
    echo ""
    echo -e "${GRAY}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo ""
    echo -e "${WHITE}💡 Multi-Agent System Features:${NC}"
    echo -e "${GRAY}   • L1: Multi-Agent Collaboration${NC}"
    echo -e "${GRAY}   • L2: Role Playing (Socrates/Plato/Aristotle)${NC}"
    echo -e "${GRAY}   • L3: Scene Traversal & Distributed Tracing${NC}"
    echo -e "${GRAY}   • L4: Capability Incarnation${NC}"
    echo -e "${GRAY}   • L5: Debate Protocol${NC}"
    echo -e "${GRAY}   • L6: Heterogeneous Model Collaboration${NC}"
    echo -e "${GRAY}   • L7: Synthesis & Self-Evolution${NC}"
    echo ""
}

run_attack() {
    print_header
    echo -e "${RED}🔥 Running Attack Simulation...${NC}"
    echo ""

    cd "$SCRIPT_DIR"
    docker-compose -f docker-compose.demo.yml --profile attack run --rm attack-simulator
}

stop_demo() {
    print_header
    echo -e "${YELLOW}🛑 Stopping Demo Environment...${NC}"

    cd "$SCRIPT_DIR"
    docker-compose -f docker-compose.demo.yml down -v

    echo ""
    echo -e "${GREEN}✅ Demo environment stopped.${NC}"
}

show_logs() {
    cd "$SCRIPT_DIR"
    docker-compose -f docker-compose.demo.yml logs -f
}

pull_model() {
    print_header
    echo -e "${BLUE}🤖 Pulling Ollama Model: $MODEL${NC}"
    echo ""
    
    cd "$SCRIPT_DIR"
    docker-compose -f docker-compose.demo.yml up -d ollama
    
    sleep 5
    
    echo -e "${YELLOW}Pulling model (this may take several minutes)...${NC}"
    docker exec demo-ollama-1 ollama pull "$MODEL"
    
    echo ""
    echo -e "${GREEN}✅ Model $MODEL pulled successfully!${NC}"
}

case "${1:-}" in
    --stop|-s)
        stop_demo
        ;;
    --attack|-a)
        run_attack
        ;;
    --logs|-l)
        show_logs
        ;;
    --pull|-p)
        pull_model
        ;;
    *)
        start_demo
        ;;
esac
