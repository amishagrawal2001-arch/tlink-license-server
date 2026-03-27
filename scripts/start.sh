#!/usr/bin/env bash
# Start Tlink License Server in background

DIR="$(cd "$(dirname "$0")/.." && pwd)"
PORT=$(grep '^PORT=' "$DIR/.env" 2>/dev/null | cut -d= -f2 || echo 4000)
PIDFILE="$DIR/data/.server.pid"
LOGFILE="$DIR/data/server.log"

# Check if already running
if [ -f "$PIDFILE" ] && kill -0 "$(cat "$PIDFILE")" 2>/dev/null; then
  echo "  ⚠ License server already running (PID $(cat "$PIDFILE"))"
  echo "  Use: ./scripts/stop.sh to stop it first"
  exit 1
fi

# Check port
if lsof -ti:"$PORT" >/dev/null 2>&1; then
  echo "  ✗ Port $PORT is already in use"
  echo "  Run: lsof -ti:$PORT | xargs kill"
  exit 1
fi

# Start
mkdir -p "$DIR/data"
cd "$DIR"
nohup node src/index.js > "$LOGFILE" 2>&1 &
echo $! > "$PIDFILE"

sleep 1
if kill -0 "$(cat "$PIDFILE")" 2>/dev/null; then
  echo ""
  echo "  ✓ Tlink License Server started"
  echo "  PID:       $(cat "$PIDFILE")"
  echo "  Port:      $PORT"
  echo "  Dashboard: http://localhost:$PORT/admin"
  echo "  Docs:      http://localhost:$PORT/docs"
  echo "  Logs:      ./scripts/logs.sh"
  echo "  Stop:      ./scripts/stop.sh"
  echo ""
else
  echo "  ✗ Failed to start. Check logs:"
  echo "  cat $LOGFILE"
  rm -f "$PIDFILE"
  exit 1
fi
