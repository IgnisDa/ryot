#!/usr/bin/env bash
# Runs on the VM as root. Runs one package's tests (default @ryot-app/kernel-backend) through Turbo,
# or the given vitest files inside that package, and writes /opt/ryot/results/ID/.
#   systemd-run --unit=ryot-unit-ID --collect -p OOMPolicy=continue -E SRC=/opt/ryot/engine bash vm-unit.sh ID [files...]
# Fails fast: hard wall cap (MAX_WALL_S) and a stall watchdog (no output for STALL_S).
set -uo pipefail
id="$1"; shift
src="${SRC:-/opt/ryot/src}"
pkg="${PKG:-@ryot-app/kernel-backend}"
dir="${PKG_DIR:-kernel/backend}"
out="/opt/ryot/results/$id"; mkdir -p "$out"; chown -R 1001:1001 "$out"
cp "$src/.synced-revision" "$out/revision.txt" 2>/dev/null

if [ $# -eq 0 ]; then
	cmd="cd $src && bun turbo --filter=$pkg test"
else
	cmd="cd $src && bun turbo --filter=$pkg build >/dev/null && cd $dir && bun --bun run vitest run $*"
fi
start=$(date +%s)
timeout --kill-after=60 "${MAX_WALL_S:-2400}" sudo -u ryot-backend -H bash -lc "$cmd" > "$out/test.out" 2>&1 & t=$!
reason=""
while kill -0 $t 2>/dev/null; do
	sleep 15
	idle=$(( $(date +%s) - $(stat -c %Y "$out/test.out") ))
	if [ "$idle" -gt "${STALL_S:-600}" ]; then
		reason=" stalled ${idle}s"
		pkill -TERM -u ryot-backend -f vitest; sleep 20; pkill -KILL -u ryot-backend -f vitest
		break
	fi
done
wait $t; rc=$?
echo "exit $rc wall $(( $(date +%s) - start ))s$reason" > "$out/status.txt"
