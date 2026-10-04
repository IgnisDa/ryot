#!/usr/bin/env bash
set -euo pipefail

script_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
root=$(cd -- "$script_dir/../../../.." && pwd)
image=${RYOT_LAUNCHER_TEST_IMAGE:-rust:1.93.1-bookworm}

docker run --rm \
	--volume "$root:/workspace:ro" \
	--workdir /workspace/kernel/sandboxd \
	"$image" \
	bash -euo pipefail -c '
		export CARGO_TARGET_DIR=/tmp/ryot-sandboxd-launcher-target
		cargo build --release --bins
		cargo test --bin ryot-sandbox-launcher -- --test-threads=1
		artifacts=/tmp/ryot-sandboxd-launcher-dist
		cargo run --release --bin ryot-sandbox-artifacts -- "$artifacts"
		/workspace/kernel/sandboxd/provision.sh \
			"$artifacts/ryot-sandbox-launcher" \
			"$artifacts/ryot-sandboxd" \
			"$artifacts/snapshots"
		cargo test --test launcher -- --ignored --test-threads=1 --nocapture
	'
