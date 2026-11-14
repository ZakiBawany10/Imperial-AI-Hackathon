#!/bin/sh
# Start the BetaCrux API. Port 8010 by default: PORT=9000 ./run.sh to change.
cd "$(dirname "$0")" && exec .venv/bin/uvicorn server:app --host 0.0.0.0 --port "${PORT:-8010}"
