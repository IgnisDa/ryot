#!/usr/bin/env bash
# Runs on the VM as root. Runs one package's tests (default @ryot-app/kernel-backend) through Turbo,
# or the given test files inside that package through its `test` script, and writes /opt/ryot/results/ID/.
#   systemd-run --unit=ryot-unit-ID --collect -p OOMPolicy=continue -E SRC=/opt/ryot/engine bash vm-unit.sh ID [files...]
# Fails fast: hard wall cap (MAX_WALL_S), and for file runs a stall watchdog (no output for STALL_S) that
# first records each test database's active queries and lock waits in stall-db.txt. Turbo runs have no watchdog:
# Turbo holds a task's output until it exits, so silence there means nothing.
set -uo pipefail
id="$1"; shift
src="${SRC:-/opt/ryot/src}"
pkg="${PKG:-@ryot-app/kernel-backend}"
dir="${PKG_DIR:-kernel/backend}"
out="/opt/ryot/results/$id"; mkdir -p "$out"; chown -R 1001:1001 "$out"
cp "$src/.synced-revision" "$out/revision.txt" 2>/dev/null

stall="${STALL_S:-600}"
if [ $# -eq 0 ]; then
	cmd="cd $src && bun turbo --filter=$pkg test"
	stall=0
else
	cmd="cd $src && bun turbo --filter=$pkg build >/dev/null && cd $dir && bun run test $*"
fi
start=$(date +%s)
timeout --kill-after=60 "${MAX_WALL_S:-2400}" sudo -u ryot-backend -H bash -lc "$cmd" > "$out/test.out" 2>&1 & t=$!
reason=""
while kill -0 $t 2>/dev/null; do
	sleep 15
	idle=$(( $(date +%s) - $(stat -c %Y "$out/test.out") ))
	if [ "$stall" -gt 0 ] && [ "$idle" -gt "$stall" ]; then
		reason=" stalled ${idle}s"
		for c in $(docker ps -q --filter ancestor=postgres:18-alpine); do
			echo "== $c"
			docker exec "$c" psql -U test_user -d test_db -Atc "select pid, pg_blocking_pids(pid), state, wait_event_type, wait_event, now() - xact_start, left(query, 300) from pg_stat_activity where datname = 'test_db' and state <> 'idle' and pid <> pg_backend_pid()"
			docker logs --tail 40 "$c" 2>&1 | grep -E "still waiting|deadlock|ERROR" | tail -10
		done > "$out/stall-db.txt" 2>&1
		ps -o pid,etimes,args -u ryot-backend | grep -E "bun" > "$out/stall-ps.txt" 2>&1
		pkill -TERM -u ryot-backend -f "bun test"; sleep 20; pkill -KILL -u ryot-backend -f "bun test"
		break
	fi
done
wait $t; rc=$?
echo "exit $rc wall $(( $(date +%s) - start ))s$reason" > "$out/status.txt"
