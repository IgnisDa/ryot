#!/bin/sh
set -eu

frontend_command='PORT=3000 npx react-router-serve ./build/server/index.js'
backend_command='BACKEND_PORT=5000 /usr/local/bin/backend'
proxy_command='caddy run --config /etc/caddy/Caddyfile'

case "${RYOT_USE_JEMALLOC:-false}" in
  1 | true | TRUE | yes | YES | on | ON)
    backend_command='LD_PRELOAD=libjemalloc.so.2 BACKEND_PORT=5000 /usr/local/bin/backend'
    printf '%s\n' 'Ryot startup: enabling jemalloc for backend via LD_PRELOAD=libjemalloc.so.2'
    ;;
  *)
    printf '%s\n' 'Ryot startup: using system allocator for backend (set RYOT_USE_JEMALLOC=true to enable jemalloc)'
    ;;
esac

exec concurrently --names frontend,backend,proxy --kill-others \
  "$frontend_command" \
  "$backend_command" \
  "$proxy_command"
