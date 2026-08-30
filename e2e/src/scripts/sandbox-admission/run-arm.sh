#!/bin/sh
# Runs probe scenarios for one deployed arm on the benchmark host. Around each scenario it records
# PostgreSQL cgroup CPU and commit counters; throughout, it samples PostgreSQL connections and lock
# waits, the admission ledger, and both sandbox queue depths every 3 seconds, none of which the
# in-container probe can read. Usage (on the host): run-arm.sh <label> <scenario> <repetitions>...
set -eu
LABEL="$1"
shift
SERVICE=a2dt5g6dbmpwqwllnzsho8jc
APP="ryot-$SERVICE"
DB="ryot-db-$SERVICE"
REDIS="ryot-redis-$SERVICE"
OUT="/root/ryot-admission/$LABEL"
mkdir -p "$OUT"
CPU_STAT="/sys/fs/cgroup/system.slice/docker-$(docker inspect "$DB" --format '{{.Id}}').scope/cpu.stat"

psql_value() {
	docker exec "$DB" sh -c "psql -U \"\$POSTGRES_USER\" -d \"\$POSTGRES_DB\" -tAc \"$1\""
}

sample_pressure() {
	while :; do
		row=$(psql_value "select (select count(*) from pg_stat_activity where state = 'active'), (select count(*) from pg_stat_activity where backend_type = 'client backend'), (select count(*) from pg_locks where not granted), (select count(*) from provider_import_admission where status = 'queued'), (select count(*) from provider_import_admission where status = 'running')" 2>/dev/null | tr '|' ' ' || true)
		queue=$(docker exec "$REDIS" redis-cli LLEN 'ryot:pq:DurableQueue/SandboxExecutionQueue' 2>/dev/null || echo -)
		interactive=$(docker exec "$REDIS" redis-cli LLEN 'ryot:pq:DurableQueue/SandboxInteractiveExecutionQueue' 2>/dev/null || echo -)
		echo "$(date +%s%3N) $row $queue $interactive" >>"$OUT/pressure.txt"
		sleep 3
	done
}

postgres_counters() {
	usage=$(awk '$1 == "usage_usec" { print $2 }' "$CPU_STAT")
	commits=$(psql_value "select xact_commit from pg_stat_database where datname = current_database()")
	echo "$usage $commits"
}

sample_pressure &
SAMPLER=$!
# On any exit, keep whatever the probe wrote and name the scenario that stopped the arm.
scenario=setup
finish() {
	status=$?
	kill "$SAMPLER" 2>/dev/null || true
	docker cp "$APP:/tmp/$LABEL.jsonl" "$OUT/probe.jsonl" 2>/dev/null || true
	if [ "$status" -ne 0 ]; then
		echo "arm $LABEL failed during $scenario (exit $status)" >&2
	fi
}
trap finish EXIT

while [ "$#" -gt 1 ]; do
	scenario="$1"
	repetitions="$2"
	shift 2
	before=$(postgres_counters)
	started=$(date +%s%3N)
	docker exec "$APP" bun /tmp/remote-probe.mjs /tmp/adm-state.json "$LABEL" "$scenario" "$repetitions"
	after=$(postgres_counters)
	printf '{"label":"%s","scenario":"%s","repetitions":%s,"startedAtMs":%s,"finishedAtMs":%s,"postgresCpuSeconds":%s,"postgresCommits":%s}\n' \
		"$LABEL" "$scenario" "$repetitions" "$started" "$(date +%s%3N)" \
		"$(awk "BEGIN { print (${after% *} - ${before% *}) / 1000000 }")" \
		"$((${after#* } - ${before#* }))" >>"$OUT/postgres.jsonl"
done
