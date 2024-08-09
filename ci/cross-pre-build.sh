#!/usr/bin/env bash
set -euxo pipefail

if [[ "$CROSS_TARGET" == "aarch64-unknown-linux-gnu" ]]; then
  sed 's/^deb http/deb [arch=amd64] http/' -i '/etc/apt/sources.list'
  echo 'deb [arch=arm64] http://ports.ubuntu.com/ jammy main restricted universe multiverse' >> /etc/apt/sources.list
  echo 'deb [arch=arm64] http://ports.ubuntu.com/ jammy-updates main restricted universe multiverse' >> /etc/apt/sources.list
  echo 'deb [arch=arm64] http://ports.ubuntu.com/ jammy-backports main restricted universe multiverse' >> /etc/apt/sources.list

  dpkg --add-architecture $CROSS_DEB_ARCH
  apt-get update && apt-get install --assume-yes libssl-dev:$CROSS_DEB_ARCH pkg-config:$CROSS_DEB_ARCH
fi
