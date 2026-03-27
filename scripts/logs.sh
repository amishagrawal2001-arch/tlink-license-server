#!/usr/bin/env bash
# View Tlink License Server logs

DIR="$(cd "$(dirname "$0")/.." && pwd)"
LOGFILE="$DIR/data/server.log"

if [ ! -f "$LOGFILE" ]; then
  echo "  No log file found at $LOGFILE"
  echo "  Start the server first: ./scripts/start.sh"
  exit 1
fi

# Parse args
LINES=50
FOLLOW=false

while [ $# -gt 0 ]; do
  case "$1" in
    -f|--follow) FOLLOW=true ;;
    -n|--lines) LINES="$2"; shift ;;
    --errors) grep -i 'error\|fail\|exception' "$LOGFILE" | tail -"$LINES"; exit 0 ;;
    --clear) > "$LOGFILE"; echo "  ✓ Logs cleared"; exit 0 ;;
    -h|--help)
      echo "Usage: ./scripts/logs.sh [options]"
      echo "  -f, --follow     Follow log output (like tail -f)"
      echo "  -n, --lines N    Show last N lines (default: 50)"
      echo "  --errors         Show only error lines"
      echo "  --clear          Clear the log file"
      exit 0 ;;
  esac
  shift
done

echo "  Tlink License Server Logs ($LOGFILE)"
echo "  ─────────────────────────────────────"

if [ "$FOLLOW" = true ]; then
  tail -f "$LOGFILE"
else
  tail -"$LINES" "$LOGFILE"
fi
