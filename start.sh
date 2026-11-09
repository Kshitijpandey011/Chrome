#!/usr/bin/env bash
set -e

export DISPLAY="${DISPLAY:-:99}"
PORT="${PORT:-10000}"

# Start a virtual desktop and window manager.
Xvfb "$DISPLAY" -screen 0 1365x850x24 -ac +extension GLX +render -noreset &
sleep 2
fluxbox >/tmp/fluxbox.log 2>&1 &

# Start the VNC server and the WebSocket bridge used by noVNC.
x11vnc -display "$DISPLAY" -forever -shared -nopw -rfbport 5900 -listen 127.0.0.1 >/tmp/x11vnc.log 2>&1 &
websockify --web=/usr/share/novnc 6080 127.0.0.1:5900 >/tmp/websockify.log 2>&1 &

# Start Chromium with remote debugging available only inside this container.
chromium \
  --no-sandbox \
  --disable-dev-shm-usage \
  --disable-gpu \
  --no-first-run \
  --no-default-browser-check \
  --remote-debugging-address=127.0.0.1 \
  --remote-debugging-port=9222 \
  --user-data-dir=/tmp/chrome-profile \
  --window-size=1365,850 \
  --start-maximized \
  about:blank >/tmp/chromium.log 2>&1 &

# Start the web app (which also proxies the noVNC WebSocket).
exec node server.js
