#!/usr/bin/env bash
# Runs on the VM as root: build e2e artifacts as UID 1001, then install the native sandbox launcher.
#   systemd-run --unit=ryot-build --collect bash /opt/ryot/src/docs/work-reduction/scripts/vm-build.sh [SRC]
# The e2e global setup repeats the same turbo build; the installed sandbox must match what that
# replay leaves in dist/, so the build runs twice and fails if the daemon digest moves.
set -euo pipefail
src="${1:-/opt/ryot/src}"
cd "$src"
build="cd $src && bun turbo build --filter=@ryot-app/media-plugin --filter=@ryot-app/kernel-client --filter=@ryot-app/fitness-plugin --filter=@ryot-app/fixture-plugin --filter=@ryot-app/sandbox"
dist="$src/kernel/sandbox/dist"
sudo -u ryot-backend -H bash -lc "$build && cd apps/server && bun run assemble"
first=$(sha256sum "$dist/ryot-sandboxd" | cut -d' ' -f1)
sudo -u ryot-backend -H bash -lc "$build" >/dev/null
second=$(sha256sum "$dist/ryot-sandboxd" | cut -d' ' -f1)
if [ "$first" != "$second" ]; then
	echo "sandbox dist changed between identical builds ($first -> $second); clear .turbo/cache" >&2
	exit 1
fi
bash kernel/sandbox/native/provision.sh "$dist/ryot-sandbox-launcher" "$dist/ryot-sandboxd" "$dist/snapshots"
# effect-playwright resolves its own playwright-core (newer than e2e's pinned playwright); install
# browsers for every playwright-core in the tree.
for cli in "$src"/node_modules/.bun/playwright-core@*/node_modules/playwright-core/cli.js; do
	sudo -u ryot-backend -H bash -lc "cd $src && node $cli install chromium chromium-headless-shell >/dev/null"
done
[ -f /var/lib/ryot-backend/.cache/ms-playwright/.deps-installed ] || { (cd "$src/e2e" && ./node_modules/.bin/playwright install-deps chromium) && touch /var/lib/ryot-backend/.cache/ms-playwright/.deps-installed; }
echo built
