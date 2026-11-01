#!/usr/bin/env bash
# Mirror the local worktree's non-ignored files to the VM checkout, then install dependencies.
#   docs/work-reduction/scripts/vm-sync.sh [DEST]   (DEST defaults to /opt/ryot/src)
# Streams `git ls-files` as tar (macOS openrsync hangs intermittently). Files listed in the previous
# sync's manifest but absent now are deleted; ignored build outputs on the VM are left alone.
set -euo pipefail
root="$(git -C "$(dirname "$0")" rev-parse --show-toplevel)"
host="$(cat "$root/tmp/server.ip")"
dest="${1:-/opt/ryot/src}"
case "$dest" in /*) ;; *) echo "DEST must be absolute" >&2; exit 64 ;; esac
cd "$root"
rev="$(git rev-parse --short HEAD)$(git diff --quiet HEAD || echo +dirty)"
list="$(mktemp)"
git ls-files -co --exclude-standard | grep -vE '(^|/)\.env$|^tmp/' | while IFS= read -r f; do [ -e "$f" ] && printf '%s\n' "$f"; done > "$list"
{ COPYFILE_DISABLE=1 tar --no-xattrs -czf - -T "$list" 2>/dev/null || COPYFILE_DISABLE=1 tar -czf - -T "$list"; } |
	ssh -o ConnectTimeout=15 -o ServerAliveInterval=15 "$host" "mkdir -p $dest && tar -xzf - -C $dest --warning=no-unknown-keyword"
scp -q "$list" "$host:$dest/.synced-files.new"
rm -f "$list"
ssh -o ConnectTimeout=15 "$host" bash -s -- "$dest" "$rev" <<'EOF'
set -euo pipefail
dest="$1"; rev="$2"; cd "$dest"; export LC_ALL=C
if [ -f .synced-files ]; then
	comm -23 <(sort .synced-files) <(sort .synced-files.new) | while IFS= read -r f; do rm -f -- "$f"; done
fi
mv .synced-files.new .synced-files
echo "$rev" > .synced-revision
chown -R 1001:1001 "$dest"
sudo -u ryot-backend -H bash -lc "cd $dest && bun install --frozen-lockfile >/dev/null"
echo "synced $rev"
EOF
