#!/usr/bin/env bash
# Stop Tlink License Server

DIR="$(cd "$(dirname "$0")/.." && pwd)"
PORT=$(grep '^PORT=' "$DIR/.env" 2>/dev/null | cut -d= -f2 || echo 4000)
PIDFILE="$DIR/data/.server.pid"

stopped=false

# Try PID file first
if [ -f "$PIDFILE" ]; then
  PID=$(cat "$PIDFILE")
  if kill -0 "$PID" 2>/dev/null; then
    kill "$PID" 2>/dev/null
    sleep 1
    # Force kill if still running
    if kill -0 "$PID" 2>/dev/null; then
      kill -9 "$PID" 2>/dev/null
    fi
    echo "  ✓ License server stopped (PID $PID)"
    stopped=true
  fi
  rm -f "$PIDFILE"
fi

# Also check by port
PIDS=$(lsof -ti:"$PORT" 2>/dev/null)
if [ -n "$PIDS" ]; then
  echo "$PIDS" | xargs kill 2>/dev/null
  sleep 1
  echo "$PIDS" | xargs kill -9 2>/dev/null
  if [ "$stopped" = false ]; then
    echo "  ✓ License server stopped (port $PORT)"
  fi
  stopped=true
fi

if [ "$stopped" = false ]; then
  echo "  → License server is not running"
fi
