#!/bin/bash

# AetherGuardduction Deployment Script
# Usage: ./deploy.sh [command]
# Commands: start, stop, restart, status, logs, build, clean

set -e
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

print_header() {
    echo ""
    echo -e "${CYAN}========================================${NC}"
    echo -e "${CYAN} $1${NC}"
    echo -e "${CYAN}========================================${NC}"
    echo ""
}

check_docker() {
    if ! command -v docker &> /dev/null; then
        echo -e "${RED}Error: Docker is not installed${NC}"
        exit 1
    fi
    if ! command -v docker-compose &> /dev/null && ! docker compose version &> /dev/null; then
        echo -e "${RED}Error: docker-compose is not installed${NC}"
        exit 1
    fi
}

start_deployment() {
    print_header "Starting AetherGuardduction Deployment"
    
    if [ ! -f "$SCRIPT_DIR/.env" ]; then
        echo -e "${YELLOW}Creating .env file from .env.example...${NC}"
        cp "$SCRIPT_DIR/.env.example" "$SCRIPT_DIR/.env"
        echo -e "${YELLOW}Please edit $SCRIPT_DIR/.env with your configuration${NC}"
    fi
    
    echo -e "${GREEN}Building and starting containers...${NC}"
    cd "$SCRIPT_DIR"
    docker-compose -f docker-compose.prod.yml up -d --build
    
    echo ""
    echo -e "${YELLOW}Waiting for services to be healthy...${NC}"
    sleep 10
    
    show_status
    
    echo ""
    echo -e "${GREEN}Deployment complete!${NC}"
    echo -e "${CYAN}Dashboard: http://localhost:8888${NC}"
    echo -e "${CYAN}API:       http://localhost:3010/api${NC}"
    echo -e "${CYAN}Health:    http://localhost:3010/health/ready${NC}"
}

stop_deployment() {
    print_header "Stopping AetherGuardduction Deployment"
    cd "$SCRIPT_DIR"
    docker-compose -f docker-compose.prod.yml down
    echo -e "${GREEN}Deployment stopped.${NC}"
}

restart_deployment() {
    stop_deployment
    sleep 3
    start_deployment
}

show_status() {
    print_header "AetherGuard Deployment Status"
    cd "$SCRIPT_DIR"
    docker-compose -f docker-compose.prod.yml ps
    
    echo ""
    echo -e "${YELLOW}Service Health:${NC}"
    
    if curl -sf http://localhost:3010/health/ready > /dev/null 2>&1; then
        echo -e "  Backend:  ${GREEN}Healthy${NC}"
    else
        echo -e "  Backend:  ${RED}Unhealthy${NC}"
    fi
    
    if curl -sf http://localhost/health > /dev/null 2>&1; then
        echo -e "  Frontend: ${GREEN}Healthy${NC}"
    else
        echo -e "  Frontend: ${RED}Unhealthy${NC}"
    fi
}

show_logs() {
    local service="${1:-}"
    cd "$SCRIPT_DIR"
    if [ -n "$service" ]; then
        docker-compose -f docker-compose.prod.yml logs -f "$service"
    else
        docker-compose -f docker-compose.prod.yml logs -f
    fi
}

build_images() {
    print_header "Building AetherGuard Docker Images"
    cd "$SCRIPT_DIR"
    docker-compose -f docker-compose.prod.yml build --no-cache
    echo -e "${GREEN}Images built successfully.${NC}"
}

clean_deployment() {
    print_header "Cleaning Up AetherGuard Deployment"
    cd "$SCRIPT_DIR"
    docker-compose -f docker-compose.prod.yml down -v --rmi local
    echo -e "${GREEN}Deployment cleaned up.${NC}"
}

check_docker

case "${1:-start}" in
    start)   start_deployment ;;
    stop)    stop_deployment ;;
    restart) restart_deployment ;;
    status)  show_status ;;
    logs)    show_logs "${2:-}" ;;
    build)   build_images ;;
    clean)   clean_deployment ;;
    *)
        echo "Usage: $0 {start|stop|restart|status|logs|build|clean}"
        exit 1
        ;;
esac
