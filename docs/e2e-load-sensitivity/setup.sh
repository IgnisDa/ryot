#!/usr/bin/env bash
# Provisions a fresh Ubuntu box as root@$SERVER_IP with the local `ultra-rewrite` commit, its
# toolchain, and the local .env files, ready for repro.sh.
set -euo pipefail

: "${SERVER_IP:?set SERVER_IP}"
BRANCH=ultra-rewrite
BUN_VERSION=1.4.2
DENO_VERSION=2.8.1
REPO_URL=https://github.com/IgnisDa/ryot.git
ENV_FILES=(.env apps/server/.env apps/website/.env kernel/backend/.env e2e/.env)

root=$(git -C "$(dirname "$0")" rev-parse --show-toplevel)
remote="root@$SERVER_IP"
ssh_() { ssh -o StrictHostKeyChecking=accept-new "$remote" "$@"; }

commit=$(git -C "$root" rev-parse "$BRANCH")
git -C "$root" diff --quiet "$BRANCH" -- docs/e2e-load-sensitivity ||
	echo "warning: docs/e2e-load-sensitivity has uncommitted changes; the box gets $BRANCH as committed" >&2

ssh_ bash -s -- "$BUN_VERSION" "$DENO_VERSION" <<'EOF'
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq curl git unzip ca-certificates python3 >/dev/null
command -v docker >/dev/null || curl -fsSL https://get.docker.com | sh >/dev/null
systemctl enable --now docker >/dev/null
[ "$(~/.bun/bin/bun --version 2>/dev/null)" = "$1" ] || curl -fsSL https://bun.sh/install | bash -s "bun-v$1" >/dev/null
grep -q BUN_INSTALL ~/.bashrc || printf 'export BUN_INSTALL="$HOME/.bun"\nexport PATH="$BUN_INSTALL/bin:$PATH"\n' >> ~/.bashrc
[ "$(deno --version 2>/dev/null | head -1 | cut -d' ' -f2)" = "$2" ] ||
	curl -fsSL https://deno.land/install.sh | DENO_INSTALL=/usr/local sh -s -- -y "v$2" >/dev/null
EOF

ssh_ "[ -d /root/ryot/.git ] || git clone -q $REPO_URL /root/ryot; git -C /root/ryot fetch -q origin $BRANCH"
# Unpushed local commits travel as a bundle on top of the published branch.
git -C "$root" fetch -q origin "$BRANCH"
if [ "$(git -C "$root" rev-list --count "origin/$BRANCH..$BRANCH")" -gt 0 ]; then
	bundle=$(mktemp -t ryot-bundle)
	git -C "$root" bundle create -q "$bundle" "$BRANCH" "^origin/$BRANCH"
	scp -q "$bundle" "$remote:/root/ryot.bundle"
	rm -f "$bundle"
	ssh_ "git -C /root/ryot fetch -q /root/ryot.bundle $BRANCH:refs/remotes/local/$BRANCH && rm /root/ryot.bundle"
fi
ssh_ "git -C /root/ryot checkout -q -B $BRANCH $commit"

# Local files point Docker and Testcontainers at Colima's socket; the box uses the native daemon.
for file in "${ENV_FILES[@]}"; do
	[ -f "$root/$file" ] || continue
	grep -vE '^(DOCKER_HOST|TESTCONTAINERS_DOCKER_SOCKET_OVERRIDE)=' "$root/$file" | ssh_ "cat > /root/ryot/$file"
done

ssh_ 'export PATH="$HOME/.bun/bin:$PATH" && cd /root/ryot && bun install --frozen-lockfile >/dev/null &&
	cd e2e && bun x playwright install --with-deps --only-shell chromium >/dev/null'
ssh_ 'export PATH="$HOME/.bun/bin:$PATH"; echo "bun $(bun --version), $(deno --version | head -1), $(docker --version)"; git -C /root/ryot log --oneline -1'
