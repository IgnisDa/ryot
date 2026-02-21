#!/bin/sh
set -eu

proxy_command="caddy run --config /etc/caddy/Caddyfile"
backend_command="BACKEND_PORT=5000 /usr/local/bin/backend"
frontend_command="PORT=3000 node ./server.mjs"

exec concurrently --names frontend,backend,proxy --kill-others \
  "$proxy_command" \
  "$backend_command" \
  "$frontend_command"
