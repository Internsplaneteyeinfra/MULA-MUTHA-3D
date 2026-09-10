#!/bin/bash
# Build and run script for NadiTwin Docker containers

set -e

echo "=== NadiTwin Docker Build Script ==="

# Function to show usage
usage() {
    echo "Usage: $0 [production|dev|dev-tools] [--run] [--port PORT]"
    echo ""
    echo "Targets:"
    echo "  production  - Build production image (default)"
    echo "  dev         - Build with development profile"
    echo "  dev-tools   - Build development tools stage"
    echo ""
    echo "Options:"
    echo "  --run       - Run the container after building"
    echo "  --port PORT - Specify port (default: 8080)"
    exit 1
}

# Default values
TARGET="production"
RUN_CONTAINER=false
PORT=8080

# Parse arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        production|dev|dev-tools)
            TARGET="$1"
            shift
            ;;
        --run)
            RUN_CONTAINER=true
            shift
            ;;
        --port)
            PORT="$2"
            shift 2
            ;;
        -h|--help)
            usage
            ;;
        *)
            echo "Unknown option: $1"
            usage
            ;;
    esac
done

echo "Building NadiTwin with target: $TARGET"

if [ "$TARGET" = "dev" ]; then
    echo "Building development environment with docker-compose..."
    docker-compose --profile dev build naditwin-dev
    
    if [ "$RUN_CONTAINER" = true ]; then
        echo "Running development container on port $PORT..."
        PORT=$PORT docker-compose --profile dev up naditwin-dev
    fi
elif [ "$TARGET" = "dev-tools" ]; then
    echo "Building development tools stage..."
    docker build --target dev-tools -t naditwin:dev-tools .
    
    if [ "$RUN_CONTAINER" = true ]; then
        echo "Running development tools container..."
        docker run -it --rm -v "$(pwd):/app" -p "$PORT:8080" naditwin:dev-tools
    fi
else
    echo "Building production image..."
    docker build --target production -t naditwin:latest .
    
    if [ "$RUN_CONTAINER" = true ]; then
        echo "Running production container on port $PORT..."
        docker run -d --name naditwin-app -p "$PORT:8080" naditwin:latest
        echo "Container started. Access at http://localhost:$PORT"
        echo "To stop: docker stop naditwin-app"
        echo "To remove: docker rm naditwin-app"
    fi
fi

echo "Build completed successfully!"
echo ""
echo "Quick start commands:"
echo "  Production: ./docker-build.sh production --run"
echo "  Development: ./docker-build.sh dev --run"
echo "  Tools: ./docker-build.sh dev-tools --run"