#!/bin/zsh
set -u

wordrush_directory="${0:A:h}"
wordrush_address="http://127.0.0.1:4321"

if /usr/bin/curl --silent --fail --max-time 1 "${wordrush_address}/api/health" >/dev/null 2>&1; then
  /usr/bin/open "$wordrush_address"
  exit 0
fi

cd "$wordrush_directory" || exit 1
wordrush_node="$(command -v node 2>/dev/null || true)"
if [[ -z "$wordrush_node" && -x /usr/local/bin/node ]]; then
  wordrush_node="/usr/local/bin/node"
elif [[ -z "$wordrush_node" && -x /opt/homebrew/bin/node ]]; then
  wordrush_node="/opt/homebrew/bin/node"
fi
if [[ -z "$wordrush_node" ]]; then
  print 'Wordrush needs Node.js to start. Node.js could not be found.'
  read '?Press Return to close.'
  exit 1
fi

print 'Starting Wordrush. Keep this window open while making videos.'
WORD_STUDIO_PORT=4321 "$wordrush_node" server.mjs &
wordrush_pid=$!
trap 'kill "$wordrush_pid" 2>/dev/null || true' EXIT INT TERM
for wordrush_attempt in {1..80}; do
  if /usr/bin/curl --silent --fail --max-time 1 "${wordrush_address}/api/health" >/dev/null 2>&1; then
    /usr/bin/open "$wordrush_address"
    break
  fi
  if ! kill -0 "$wordrush_pid" 2>/dev/null; then
    print 'Wordrush could not start. Read the message above for details.'
    read '?Press Return to close.'
    exit 1
  fi
  /bin/sleep 0.25
done
wait "$wordrush_pid"
