#!/usr/bin/env bash
set -euxo pipefail

apt-get update
apt-get --assume-yes install patch

if [[ $CROSS_TARGET == "x86_64-unknown-linux-gnu" ]]; then
  apt-get update && apt-get --assume-yes install libssl-dev clang
fi

if [[ "$CROSS_TARGET" == "aarch64-unknown-linux-gnu" ]]; then
  dpkg --add-architecture $CROSS_DEB_ARCH
  apt-get update && apt-get --assume-yes install libssl-dev:$CROSS_DEB_ARCH
fi
