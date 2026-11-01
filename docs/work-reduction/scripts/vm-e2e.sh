#!/usr/bin/env bash
# Runs on the VM as root. Measures one e2e run and writes /opt/ryot/results/ID/.
#   systemd-run --unit=ryot-e2e-ID --collect bash vm-e2e.sh ID [vitest args / files...]
# With no files, runs the whole standard suite (opt-in gates and live smoke stay disabled unless
# RUN_OPERATIONAL_GATES=1 is passed via `systemd-run -E`).
#
# Outputs: vitest.json (per-test durations), vitest.out, status.txt, pgss.csv (+ .activity lock/idle
# samples) for the shared PostgreSQL, metrics.prom (OTEL span metrics), vmstat.log, docker-stats.log,
# server.log, pg.log.
set -uo pipefail
id="$1"; shift
src="${SRC:-/opt/ryot/src}"; here="$src/docs/work-reduction/scripts"
out="/opt/ryot/results/$id"; mkdir -p "$out/tmp"; chown -R 1001:1001 "$out"
cp "$src/.synced-revision" "$out/revision.txt" 2>/dev/null

# pg_stat_statements in every test PostgreSQL (idempotent; vm-sync.sh restores the tracked file).
perl -0pi -e 's/("log_lock_waits=on",)(?!\n\t+"-c",\n\t+"shared_preload)/$1\n\t\t\t\t\t\t"-c",\n\t\t\t\t\t\t"shared_preload_libraries=pg_stat_statements",\n\t\t\t\t\t\t"-c",\n\t\t\t\t\t\t"pg_stat_statements.track=all",\n\t\t\t\t\t\t"-c",\n\t\t\t\t\t\t"pg_stat_statements.max=20000",/' \
	"$src/packages/testing/src/postgres-container.ts"

# Rebuild (turbo no-op when unchanged) and re-provision so the root-installed sandbox matches dist/.
bash "$here/vm-build.sh" "$src" > "$out/build.log" 2>&1 || { echo "build failed" > "$out/status.txt"; exit 1; }

docker rm -f ryot-otel >/dev/null 2>&1
docker run -d --name ryot-otel -p 127.0.0.1:4318:4318 -p 127.0.0.1:8889:8889 \
	-v "$here/otel/collector.yml:/etc/otelcol-contrib/config.yaml:ro" otel/opentelemetry-collector-contrib:0.155.0 >/dev/null
sleep 3

vmstat -t 5 > "$out/vmstat.log" & vm=$!
( while true; do docker stats --no-stream --format '{{.Name}} {{.CPUPerc}} {{.MemUsage}}' | sed "s/^/$(date +%T) /"; sleep 15; done ) > "$out/docker-stats.log" 2>/dev/null & ds=$!
( while true; do ps -eo pid,pcpu,rss,etime,args --sort=-pcpu | head -15 | sed "s/^/$(date +%T) /"; echo; sleep 15; done ) > "$out/ps.log" 2>/dev/null & pss=$!
bash "$here/pgwatch.sh" "$out/pgss.csv" 2> "$out/pgwatch.log" & pw=$!
sh "$here/lockwatch.sh" "$out/locks.log" & lw=$!

# PROFILE=1: every Bun process (API servers included) writes a CPU profile on exit.
prof=""
if [ "${PROFILE:-}" = 1 ]; then mkdir -p "$out/prof"; chown 1001:1001 "$out/prof"; prof="BUN_OPTIONS='--cpu-prof --cpu-prof-md --cpu-prof-dir=$out/prof'"; fi

# OTEL=1: export spans, logs and metrics to the local collector. Off by default because an OTLP
# endpoint also turns on per-span debug logging in the server, which normal e2e runs never pay.
otel=""
[ "${OTEL:-}" = 1 ] && otel="OTEL_EXPORTER_OTLP_ENDPOINT=http://127.0.0.1:4318"

start=$(date +%s)
# Fail fast: hard wall cap (MAX_WALL_S) and a stall watchdog (no vitest output for STALL_S).
timeout --kill-after=60 "${MAX_WALL_S:-5400}" sudo -u ryot-backend -H bash -lc "cd $src/e2e && env $prof $otel TMPDIR=$out/tmp \
	RUN_LIVE_PROVIDER_TESTS= RUN_OPERATIONAL_GATES=${RUN_OPERATIONAL_GATES:-} RUN_FLOW_PROBES=${RUN_FLOW_PROBES:-} FLOW_PROBE_OUT=$out/flow-probes.json \
	bun --bun run vitest run --reporter=default --reporter=json --outputFile.json=$out/vitest.json $*" \
	> "$out/vitest.out" 2>&1 & vt=$!
reason=""
while kill -0 $vt 2>/dev/null; do
	sleep 30
	idle=$(( $(date +%s) - $(stat -c %Y "$out/vitest.out") ))
	if [ "$idle" -gt "${STALL_S:-1200}" ]; then
		reason=" stalled ${idle}s"
		pkill -TERM -u ryot-backend -f vitest; sleep 30; pkill -KILL -u ryot-backend -f vitest
		break
	fi
done
wait $vt; rc=$?
echo "exit $rc wall $(( $(date +%s) - start ))s$reason" > "$out/status.txt"
sleep 12
curl -s http://127.0.0.1:8889/metrics > "$out/metrics.prom"
kill $vm $ds $pss 2>/dev/null
# pgwatch exits when its container disappears; stop it if vitest never started one.
for _ in $(seq 1 12); do kill -0 $pw 2>/dev/null || break; sleep 5; done
pkill -P $pw 2>/dev/null; kill $pw 2>/dev/null
pkill -P $lw 2>/dev/null; kill $lw 2>/dev/null
log=$(ls -d "$out"/tmp/ryot-e2e-server-logs-* 2>/dev/null | head -1)
[ -n "$log" ] && cp "$log/ryot.log" "$out/server.log"
pg=$(ls -S "$out"/tmp/ryot-*-postgres-*.log 2>/dev/null | head -1)
[ -n "$pg" ] && cp "$pg" "$out/pg.log"
cat "$out/status.txt"
