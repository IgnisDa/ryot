#!/usr/bin/env bash

set -euxo pipefail

concurrently --names "frontend,backend,proxy" --kill-others \
  "PORT=3000 npx remix-serve ./build/server/index.js" \
  "BACKEND_PORT=5000 /usr/local/bin/ryot" \
  "caddy run --config /etc/caddy/Caddyfile"
