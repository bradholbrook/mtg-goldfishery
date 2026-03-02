#!/bin/bash
# Double-click this file in Finder to run all tests in macOS Terminal.
# First-time setup: chmod +x run-tests.command
cd "$(dirname "$0")"
echo "MTG Goldfishery — Test Suite"
echo "============================="
node --test tests/simulator.test.js tests/effects.test.js tests/criteria.test.js
echo ""
echo "Press any key to close..."
read -n 1 -s
