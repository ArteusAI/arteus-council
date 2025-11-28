#!/bin/bash

# LLM Council - Start script

echo "Starting LLM Council..."
echo ""

BACKEND_PORT=${BACKEND_PORT:-8001}
FRONTEND_PORT=${FRONTEND_PORT:-5173}
VITE_API_BASE=${VITE_API_BASE:-http://localhost:${BACKEND_PORT}}
VITE_BASE_PATH=${VITE_BASE_PATH:-/}

# Start backend
echo "Starting backend on http://localhost:${BACKEND_PORT}..."
BACKEND_PORT=${BACKEND_PORT} uv run python -m backend.main &
BACKEND_PID=$!

# Wait a bit for backend to start
sleep 2

# Start frontend
echo "Starting frontend on http://localhost:${FRONTEND_PORT}..."
cd frontend
VITE_API_BASE=${VITE_API_BASE} VITE_BASE_PATH=${VITE_BASE_PATH} npm run dev -- --port ${FRONTEND_PORT} &
FRONTEND_PID=$!

echo ""
echo "✓ LLM Council is running!"
echo "  Backend:  http://localhost:${BACKEND_PORT}"
echo "  Frontend: http://localhost:${FRONTEND_PORT}"
echo ""
echo "Press Ctrl+C to stop both servers"

# Wait for Ctrl+C
trap "kill $BACKEND_PID $FRONTEND_PID 2>/dev/null; exit" SIGINT SIGTERM
wait
