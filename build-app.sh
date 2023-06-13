#!/usr/bin/env bash

set -euxo pipefail

export LIBSQLITE3_FLAGS="-USQLITE_DISABLE_LFS -DSQLITE_DISABLE_LFS=1"

if [ "$TARGETARCH" = "arm64" ]; then
  export RUST_TARGETARCH="aarch64"
  export LIBSQLITE3_FLAGS="$LIBSQLITE3_FLAGS -USQLITE_THREADSAFE -DSQLITE_THREADSAFE=0"
elif [ "$TARGETARCH" = "amd64" ]; then
  export RUST_TARGETARCH="x86_64"
fi

export RUST_TARGETARCH_UPPER=$(echo $RUST_TARGETARCH | tr a-z A-Z)

export CC_${RUST_TARGETARCH}_unknown_linux_musl=clang
export AR_${RUST_TARGETARCH}_unknown_linux_musl=llvm-ar
export CARGO_TARGET_${RUST_TARGETARCH_UPPER}_UNKNOWN_LINUX_MUSL_RUSTFLAGS="-Clink-self-contained=yes -Clinker=rust-lld"

rustup target add ${RUST_TARGETARCH}-unknown-linux-musl
cargo build --profile dist --bin ryot --target ${RUST_TARGETARCH}-unknown-linux-musl
cp -R /app/target/${RUST_TARGETARCH}-unknown-linux-musl/dist/ryot /app/ryot
