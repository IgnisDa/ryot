#!/usr/bin/env bash
# Mirror the local worktree's non-ignored files to the VM checkout, then install dependencies.
#   docs/work-reduction/scripts/vm-sync.sh [DEST]   (DEST defaults to /opt/ryot/src)
# Ignored paths (node_modules, dist, target, .turbo) are neither sent nor deleted remotely.
set -euo pipefail
root="$(git -C "$(dirname "$0")" rev-parse --show-toplevel)"
host="$(cat "$root/tmp/server.ip")"
dest="${1:-/opt/ryot/src}"
cd "$root"
rsync -a --delete --exclude=/.git --exclude=/tmp --filter=':- .gitignore' \
	--exclude='.env' --exclude='*/.env' -e ssh ./ "$host:$dest/"
rev="$(git rev-parse --short HEAD)$(git diff --quiet HEAD || echo +dirty)"
ssh "$host" "echo $rev > $dest/.synced-revision && chown -R 1001:1001 $dest && sudo -u ryot-backend -H bash -lc 'cd $dest && bun install --frozen-lockfile >/dev/null' && echo synced $rev"
