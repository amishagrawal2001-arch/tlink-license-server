#!/usr/bin/env bash
# Check Tlink License Server status

DIR="$(cd "$(dirname "$0")/.." && pwd)"
PORT=$(grep '^PORT=' "$DIR/.env" 2>/dev/null | cut -d= -f2 || echo 4000)
PIDFILE="$DIR/data/.server.pid"

echo ""
echo "  Tlink License Server Status"
echo "  ─────────────────────────────────"

# Check PID
if [ -f "$PIDFILE" ]; then
  PID=$(cat "$PIDFILE")
  if kill -0 "$PID" 2>/dev/null; then
    echo "  Process:    Running (PID $PID)"
  else
    echo "  Process:    Stale PID file (PID $PID not running)"
    rm -f "$PIDFILE"
  fi
else
  echo "  Process:    No PID file"
fi

# Check port
if lsof -ti:"$PORT" >/dev/null 2>&1; then
  echo "  Port $PORT:   In use"
else
  echo "  Port $PORT:   Free (server not listening)"
fi

# Health check
HEALTH=$(curl -s --connect-timeout 2 "http://localhost:$PORT/api/health" 2>/dev/null)
if [ -n "$HEALTH" ]; then
  UPTIME=$(echo "$HEALTH" | grep -o '"uptime":[0-9.]*' | cut -d: -f2 | cut -d. -f1)
  if [ -n "$UPTIME" ]; then
    HOURS=$((UPTIME / 3600))
    MINS=$(( (UPTIME % 3600) / 60 ))
    SECS=$((UPTIME % 60))
    echo "  Health:     ✓ OK (uptime: ${HOURS}h ${MINS}m ${SECS}s)"
  else
    echo "  Health:     ✓ OK"
  fi
  echo "  Dashboard:  http://localhost:$PORT/admin"
  echo "  Docs:       http://localhost:$PORT/docs"

  # Show network addresses
  echo "  ─────────────────────────────────"
  echo "  Network:"
  echo "    Local:    http://localhost:$PORT"
  for ip in $(ifconfig 2>/dev/null | grep 'inet ' | grep -v '127.0.0.1' | awk '{print $2}'); do
    echo "    Network:  http://$ip:$PORT"
  done
else
  echo "  Health:     ✗ Not responding"
fi

echo ""
