#!/bin/bash
# Put the whole app online from this laptop, in one command:
#   1. the backend (run.sh) on port 8010, unless it is already running;
#   2. a Cloudflare tunnel, which gives the backend a public https address;
#   3. the frontend built against that address and uploaded to Vercel.
#
# Usage:  cd backend && ./go_live.sh        (Ctrl-C takes the backend's public address down)
# Needs:  brew install cloudflared;  npx vercel login (once)
# The tunnel address changes every run, so every run rebuilds and re-uploads the frontend.
# Keep the laptop awake and on power while it is live (this script runs caffeinate).
set -e
HERE="$(cd "$(dirname "$0")" && pwd)"
FRONT="$HERE/../frontend"
LOG="$(mktemp -t tunnel)"

if ! curl -s -m 2 http://localhost:8010/health > /dev/null; then
  echo "Starting the backend..."
  (cd "$HERE" && ./run.sh > "$(mktemp -t betacrux-server)" 2>&1 &)
  until curl -s -m 2 http://localhost:8010/health > /dev/null; do sleep 1; done
fi

echo "Opening the tunnel..."
cloudflared tunnel --url http://localhost:8010 --no-autoupdate > "$LOG" 2>&1 &
TUNNEL=$!
trap 'kill $TUNNEL 2>/dev/null' EXIT
until API=$(grep -o "https://[a-z0-9-]*\.trycloudflare\.com" "$LOG" | head -1) && [ -n "$API" ]; do sleep 1; done
until curl -s -m 5 "$API/health" > /dev/null; do sleep 2; done
echo "Backend is public at $API"

echo "Building and uploading the frontend..."
cd "$FRONT"
[ -d node_modules ] || npx -y pnpm@9 install --frozen-lockfile
VITE_API_URL="$API" VITE_ELEVENLABS_AGENT_ID="${VITE_ELEVENLABS_AGENT_ID:-agent_0401m7dsq9z7ef7spt1qqdmca2n0}" npx vite build > /dev/null
[ -d .vercel ] && cp -r .vercel dist/          # keep deploying to the same Vercel project
SITE=$(cd dist && npx -y vercel deploy --prod --yes | tail -1)
[ -d dist/.vercel ] && cp -r dist/.vercel .
echo
echo "Live:     $SITE"
echo "Backend:  $API   (3D demo: $API/demo/3d.html)"
echo "Ctrl-C to stop."
caffeinate -dis -w $TUNNEL
