#!/usr/bin/env bash

set -euxo pipefail

export RUST_TARGET_TRIPLE=$(eval "echo \$RUST_TARGET_TRIPLE_$TARGETARCH")

rustup target add $RUST_TARGET_TRIPLE
cargo build --profile dist --bin ryot --target ${RUST_TARGET_TRIPLE}
cp -R /app/target/${RUST_TARGET_TRIPLE}/dist/ryot /app/ryot
