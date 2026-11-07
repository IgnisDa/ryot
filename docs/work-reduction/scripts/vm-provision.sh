#!/usr/bin/env bash
# One-time provisioning of the benchmark VM (Ubuntu 26.04, as root). Idempotent.
#   scp vm-provision.sh root@VM: && ssh root@VM systemd-run --unit=ryot-provision --collect bash /root/vm-provision.sh
# Result: UID/GID 1001 `ryot-backend` (the e2e harness requires it on Linux) in the docker group, with
# Bun, Rust and Node under /opt and the checkout at /opt/ryot/src.
set -euxo pipefail
export DEBIAN_FRONTEND=noninteractive HOME=/root

apt-get update
apt-get install -y --no-install-recommends \
	ca-certificates curl git unzip xz-utils rsync jq build-essential python3 pkg-config sudo \
	docker.io sysstat htop postgresql-client
systemctl enable --now docker
# Unattended upgrades re-execute systemd, which restarts running measurement units.
systemctl disable --now apt-daily.timer apt-daily-upgrade.timer unattended-upgrades.service
systemctl mask apt-daily.service apt-daily-upgrade.service

getent group 1001 >/dev/null || groupadd --gid 1001 ryot-backend
getent passwd 1001 >/dev/null || useradd --uid 1001 --gid 1001 --create-home --home-dir /var/lib/ryot-backend --shell /bin/bash ryot-backend
usermod -aG docker ryot-backend
mkdir -p /opt/ryot/src /opt/ryot/results /opt/ryot/bin /opt/bun /opt/rust
chown -R 1001:1001 /opt/ryot /opt/bun /opt/rust

as_ryot() { sudo -u ryot-backend -H env BUN_INSTALL=/opt/bun RUSTUP_HOME=/opt/rust/rustup CARGO_HOME=/opt/rust/cargo PATH=/opt/bun/bin:/opt/rust/cargo/bin:/usr/local/bin:/usr/bin:/bin "$@"; }

if [ ! -x /opt/rust/cargo/bin/rustup ]; then
	as_ryot bash -c 'curl -fsSL https://sh.rustup.rs | sh -s -- -y --no-modify-path --profile default --default-toolchain 1.93.1'
fi
if [ ! -x /opt/bun/bin/bun ] || [ "$(/opt/bun/bin/bun --version)" != 1.4.4 ]; then
	as_ryot bash -c 'curl -fsSL https://bun.sh/install | bash -s bun-v1.4.4'
fi
if [ ! -x /opt/node-v24.22.1-linux-x64/bin/node ]; then
	curl -fsSL https://nodejs.org/dist/v24.22.1/node-v24.22.1-linux-x64.tar.xz | tar -xJ -C /opt
fi
for b in node npm npx; do ln -sf /opt/node-v24.22.1-linux-x64/bin/$b /usr/local/bin/$b; done
for b in bun bunx; do ln -sf /opt/bun/bin/$b /usr/local/bin/$b; done

cat > /etc/profile.d/ryot.sh <<'EOF'
export BUN_INSTALL=/opt/bun RUSTUP_HOME=/opt/rust/rustup CARGO_HOME=/opt/rust/cargo
export PATH=/opt/bun/bin:/opt/rust/cargo/bin:$PATH
EOF

# The harness spawns many containers and processes; raise limits and keep the clock stable.
cat > /etc/sysctl.d/90-ryot.conf <<'EOF'
fs.inotify.max_user_watches=524288
fs.inotify.max_user_instances=1024
vm.max_map_count=262144
EOF
sysctl --system >/dev/null

# The kernel backend's type-aware lint needs more than the VM's 7.6 GiB.
if [ ! -e /swap-check ]; then
	fallocate -l 6G /swap-check && chmod 600 /swap-check && mkswap -q /swap-check && swapon /swap-check
fi
grep -q '^/swap-check ' /etc/fstab || echo '/swap-check none swap sw 0 0' >> /etc/fstab
echo provisioned
