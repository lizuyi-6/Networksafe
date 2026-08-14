#!/bin/bash

# AetherGuard Production Deployment Script
# Usage: ./deploy.sh [command]
# Commands: start, stop, restart, status, logs, build, clean
#
# DP-014 fix (audit 2026-08): this script previously bootstrapped a LOCAL
# .env with `cp .env.example .env` (weak change_me* values that production
# runtime validation hard-rejects), invoked the legacy docker-compose v1
# binary (cannot parse the include/env_file long syntax the prod entrypoint
# needs), and printed stale ports 8888/3010. The prod entrypoint includes
# the repository-root Compose file and reads the ROOT .env — generate it with
# deployment/production/setup-env.sh, never by copying .env.example.

set -e
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_ENV="$SCRIPT_DIR/../../.env"

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

# Compose v2.24+ is REQUIRED (include/env_file long syntax); legacy
# docker-compose v1 cannot parse the prod entrypoint.
compose() {
    docker compose -f "$SCRIPT_DIR/docker-compose.prod.yml" "$@"
}

check_docker() {
    if ! command -v docker &> /dev/null; then
        echo -e "${RED}Error: Docker is not installed${NC}"
        exit 1
    fi
    if ! docker compose version &> /dev/null; then
        echo -e "${RED}Error: Docker Compose v2 is required (legacy docker-compose v1 cannot parse this stack)${NC}"
        exit 1
    fi
}

check_root_env() {
    if [ ! -f "$ROOT_ENV" ]; then
        echo -e "${RED}Error: repository root .env not found ($ROOT_ENV)${NC}"
        echo -e "${YELLOW}Generate it first:  bash deployment/production/setup-env.sh${NC}"
        echo -e "${YELLOW}(copying .env.example produces weak change_me* values that production validation rejects)${NC}"
        exit 1
    fi
}

start_deployment() {
    print_header "Starting AetherGuard Production Deployment"

    check_root_env

    echo -e "${GREEN}Building and starting containers...${NC}"
    compose up -d --build

    echo ""
    echo -e "${YELLOW}Waiting for services to become healthy...${NC}"
    sleep 10

    show_status

    echo ""
    echo -e "${GREEN}Deployment complete!${NC}"
    echo -e "${CYAN}Dashboard/API entrypoint (nginx reverse proxy): http://localhost:8080${NC}"
    echo -e "${CYAN}Backend health is reported by: docker compose -f docker-compose.prod.yml ps${NC}"
}

stop_deployment() {
    print_header "Stopping AetherGuard Production Deployment"
    compose down
    echo -e "${GREEN}Deployment stopped.${NC}"
}

restart_deployment() {
    stop_deployment
    sleep 3
    start_deployment
}

show_status() {
    print_header "AetherGuard Deployment Status"
    compose ps
}

show_logs() {
    local service="${1:-}"
    if [ -n "$service" ]; then
        compose logs -f "$service"
    else
        compose logs -f
    fi
}

build_images() {
    print_header "Building AetherGuard Docker Images"
    check_root_env
    compose build --no-cache
    echo -e "${GREEN}Images built successfully.${NC}"
}

clean_deployment() {
    print_header "Cleaning Up AetherGuard Deployment"
    compose down -v --rmi local
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
