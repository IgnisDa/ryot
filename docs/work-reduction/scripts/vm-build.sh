#!/usr/bin/env bash
# Runs on the VM as root: build e2e artifacts as UID 1001, then install the native sandbox launcher.
#   systemd-run --unit=ryot-build --collect bash /opt/ryot/src/docs/work-reduction/scripts/vm-build.sh [SRC]
set -euo pipefail
src="${1:-/opt/ryot/src}"
cd "$src"
sudo -u ryot-backend -H bash -lc "cd $src && bun turbo build --filter=@ryot-app/media-plugin --filter=@ryot-app/kernel-client --filter=@ryot-app/fitness-plugin --filter=@ryot-app/fixture-plugin --filter=@ryot-app/sandbox && cd apps/server && bun run assemble"
dist="$src/kernel/sandbox/dist"
bash kernel/sandbox/native/provision.sh "$dist/ryot-sandbox-launcher" "$dist/ryot-sandboxd" "$dist/snapshots"
sudo -u ryot-backend -H bash -lc "cd $src/e2e && bunx playwright install chromium >/dev/null"
[ -f /var/lib/ryot-backend/.cache/ms-playwright/.deps-installed ] || { (cd "$src/e2e" && /opt/bun/bin/bunx playwright install-deps chromium) && touch /var/lib/ryot-backend/.cache/ms-playwright/.deps-installed; }
echo built
