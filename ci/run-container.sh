#!/bin/sh
set -eu

frontend_command='PORT=3000 npx react-router-serve ./build/server/index.js'
backend_command='BACKEND_PORT=5000 /usr/local/bin/backend'
proxy_command='caddy run --config /etc/caddy/Caddyfile'

printf '%s\n' 'Ryot startup: backend uses jemalloc as the default allocator'

exec concurrently --names frontend,backend,proxy --kill-others \
  "$frontend_command" \
  "$backend_command" \
  "$proxy_command"
