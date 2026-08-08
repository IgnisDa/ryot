#!/bin/sh
# Runs admission arms against the dedicated `ryot-benchmark` Coolify service. For every arm it sets
# the arm's settings, recreates the benchmark PostgreSQL database and flushes Redis, restarts the
# service, creates fresh benchmark users and plugins, then runs `run-arm.sh` on the host and copies
# the results back. Usage (from `e2e/`):
#   run-campaign.sh <output-dir> <label>:<admission-limit>:<interactive-lane>:<worker-priority>...
# Environment: COOLIFY_TOKEN, SERVER_IP, BENCHMARK_ADMIN_TOKEN_FILE (mode 0600), and optionally
# ARM_SCENARIOS (default "warmup 1 single 2 mixed 1 slow 1").
set -eu
OUTPUT="$1"
shift
SERVICE=a2dt5g6dbmpwqwllnzsho8jc
API="https://admin.ryot.io/api/v1/services/$SERVICE"
HOST="root@$SERVER_IP"
SCENARIOS="${ARM_SCENARIOS:-warmup 1 single 2 mixed 1 slow 1}"
HERE=$(dirname "$0")
mkdir -p "$OUTPUT"

coolify() {
	method="$1"
	path="$2"
	shift 2
	curl --fail-with-body --silent --show-error --request "$method" \
		--header "Authorization: Bearer $COOLIFY_TOKEN" --header "Accept: application/json" \
		--header "Content-Type: application/json" "$API$path" "$@"
}

set_env() {
	coolify PATCH /envs --data "{\"key\":\"$1\",\"value\":\"$2\"}" >/dev/null
}

wait_healthy() {
	for _ in $(seq 1 120); do
		if curl --silent --fail --max-time 5 https://ur-testing.ryot.io/api/system/health >/dev/null; then
			return 0
		fi
		sleep 5
	done
	echo "service did not become healthy" >&2
	return 1
}

for arm in "$@"; do
	label=${arm%%:*}
	rest=${arm#*:}
	limit=${rest%%:*}
	rest=${rest#*:}
	lane=${rest%%:*}
	priority=${rest#*:}
	echo "== $label (limit=$limit lane=$lane priority=$priority) $(date -u +%FT%TZ)"
	set_env EXPERIMENT_PROVIDER_IMPORT_ADMISSION_LIMIT "$limit"
	set_env EXPERIMENT_SANDBOX_INTERACTIVE_LANE "$lane"
	set_env EXPERIMENT_SANDBOX_WORKER_PRIORITY "$priority"
	coolify GET /stop >/dev/null
	sleep 20
	coolify GET /start >/dev/null
	wait_healthy
	# A fresh database per arm: every arm starts from the same empty state.
	ssh "$HOST" "set -e
		docker stop ryot-$SERVICE >/dev/null
		docker exec ryot-db-$SERVICE sh -c 'psql -U \"\$POSTGRES_USER\" -d template1 -qc \"drop database if exists postgres with (force)\" -c \"create database postgres\"'
		docker exec ryot-redis-$SERVICE redis-cli flushall >/dev/null
		docker start ryot-$SERVICE >/dev/null"
	wait_healthy
	ssh "$HOST" "docker exec ryot-$SERVICE printenv" |
		grep -E '^(EXPERIMENT_|SANDBOX_WORKER_CONCURRENCY|SCHEDULER_DISABLE)' >"$OUTPUT/$label.env"
	E2E_API_URL=https://ur-testing.ryot.io/api E2E_FRONTEND_URL=https://ur-testing.ryot.io \
		E2E_ADMIN_ACCESS_TOKEN=$(cat "$BENCHMARK_ADMIN_TOKEN_FILE") \
		bun run "$HERE/remote-setup.ts" "$OUTPUT/.state.json" >/dev/null
	ssh "$HOST" "mkdir -p /root/ryot-admission-tools && chmod 700 /root/ryot-admission-tools"
	scp -q "$OUTPUT/.state.json" "$HERE/remote-probe.mjs" "$HERE/run-arm.sh" "$HOST:/root/ryot-admission-tools/"
	ssh "$HOST" "set -e
		docker cp /root/ryot-admission-tools/.state.json ryot-$SERVICE:/tmp/adm-state.json
		docker cp /root/ryot-admission-tools/remote-probe.mjs ryot-$SERVICE:/tmp/remote-probe.mjs
		rm -rf /root/ryot-admission/$label
		sh /root/ryot-admission-tools/run-arm.sh $label $SCENARIOS"
	rm -f "$OUTPUT/.state.json"
	scp -q -r "$HOST:/root/ryot-admission/$label" "$OUTPUT/"
done
