#!/bin/bash
# MTG Goldfishery — double-click to launch locally.
# Starts the dev server if not already running, then opens the browser.

PORT=8080
DIR="$(cd "$(dirname "$0")/.." && pwd)"

if lsof -i :$PORT -sTCP:LISTEN -t > /dev/null 2>&1; then
    echo "Server already running on port $PORT — restarting..."
    kill $(lsof -i :$PORT -sTCP:LISTEN -t)
    sleep 0.5
fi

echo "Starting dev server on port $PORT..."
cd "$DIR"
python3 dev-server.py $PORT &
# Wait up to 5s for the server to come up
for i in $(seq 1 10); do
    sleep 0.5
    lsof -i :$PORT -sTCP:LISTEN -t > /dev/null 2>&1 && break
done

echo "Opening http://localhost:$PORT"
open "http://localhost:$PORT"
