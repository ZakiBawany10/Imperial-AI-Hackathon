#!/bin/sh
# Renders each slide of extra.html to extra-N.png at 1920x1080 with headless Chrome.
cd "$(dirname "$0")"
CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
for n in 1 2 3 4 5 6 7 8 9 10; do
  "$CHROME" --headless=new --disable-gpu --hide-scrollbars --window-size=1920,1080 \
    --virtual-time-budget=6000 --screenshot="$PWD/extra-$(printf %02d $n).png" \
    "file://$PWD/extra.html?slide=$n" >/dev/null 2>&1
done
ls extra-*.png
