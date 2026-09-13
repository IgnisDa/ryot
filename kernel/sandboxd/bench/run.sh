#!/usr/bin/env bash
# Runs the S1 acceptance benchmark. Thresholds are only meaningful on the reference host:
# a fresh 2 vCPU / 4 GB x86_64 Linux machine with the runtime payload already built.
set -euo pipefail
cd "$(dirname "$0")/.."
exec cargo bench --bench noop
