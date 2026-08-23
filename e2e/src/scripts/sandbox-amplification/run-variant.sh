#!/bin/sh
# Runs the matched scenario list for one deployed variant on the benchmark host. Each scenario is
# wrapped with PostgreSQL cgroup CPU and pg_stat_database commit counters, which the in-container
# probe cannot read. Usage (on the host): run-variant.sh <label> [<scenario> <repetitions>]...
set -eu
LABEL="$1"
SERVICE=a2dt5g6dbmpwqwllnzsho8jc
APP="ryot-$SERVICE"
DB="ryot-db-$SERVICE"
OUT="/root/ryot-benchmark-tools/amp-$LABEL-postgres.jsonl"
CPU_STAT="/sys/fs/cgroup/system.slice/docker-$(docker inspect "$DB" --format '{{.Id}}').scope/cpu.stat"

postgres_counters() {
	usage=$(awk '$1 == "usage_usec" { print $2 }' "$CPU_STAT")
	commits=$(docker exec "$DB" sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -tAc "select xact_commit from pg_stat_database where datname = current_database()"')
	echo "$usage $commits"
}

run() {
	scenario="$1"
	repetitions="$2"
	set -- $(postgres_counters)
	docker exec "$APP" bun /tmp/remote-probe.mjs /tmp/amp-state.json "$LABEL" "$scenario" "$repetitions"
	before_usage="$1"
	before_commits="$2"
	set -- $(postgres_counters)
	printf '{"label":"%s","scenario":"%s","repetitions":%s,"postgresCpuSeconds":%s,"postgresCommits":%s}\n' \
		"$LABEL" "$scenario" "$repetitions" \
		"$(awk "BEGIN { print ($1 - $before_usage) / 1000000 }")" "$(($2 - before_commits))" >>"$OUT"
}

shift
if [ "$#" -gt 0 ]; then
	# Explicit "<scenario> <repetitions>" pairs append to an existing variant run.
	while [ "$#" -gt 1 ]; do
		run "$1" "$2"
		shift 2
	done
else
	run direct:0 1
	run import 1
	: >"$OUT"
	docker exec "$APP" sh -c "rm -f /tmp/$LABEL.jsonl"
	run direct:0 5
	run direct:1 5
	run direct:5 5
	run direct:10 5
	run import 3
	run batch:5 2
fi
docker cp "$APP:/tmp/$LABEL.jsonl" "/root/ryot-benchmark-tools/amp-$LABEL-probe.jsonl"
