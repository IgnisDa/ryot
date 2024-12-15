#!/usr/bin/env bash
set -euxo pipefail

apt-get update
apt-get --assume-yes install patch

if [[ "$CROSS_TARGET" == "aarch64-unknown-linux-gnu" ]]; then
  dpkg --add-architecture "$CROSS_DEB_ARCH"
  apt-get --assume-yes install libssl-dev:$CROSS_DEB_ARCH
fi
