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
SSH_OPTIONS="-o BatchMode=yes -o ConnectTimeout=15 -o ServerAliveInterval=15 -o ServerAliveCountMax=4"

# Fail fast: every exit names the arm and step, and no step can wait without a bound.
arm=none
step=start
finish() {
	status=$?
	rm -f "$OUTPUT/.state.json"
	if [ "$status" -ne 0 ]; then
		echo "campaign failed: arm $arm during $step (exit $status) $(date -u +%FT%TZ)" >&2
	fi
}
trap finish EXIT

remote() {
	# shellcheck disable=SC2086
	ssh $SSH_OPTIONS "$HOST" "$@"
}

# Runs a command and kills it after the given number of seconds; macOS has no `timeout`.
with_deadline() {
	seconds="$1"
	shift
	"$@" &
	command_pid=$!
	(sleep "$seconds" && kill "$command_pid" 2>/dev/null) &
	watchdog_pid=$!
	command_status=0
	wait "$command_pid" || command_status=$?
	kill "$watchdog_pid" 2>/dev/null || true
	return "$command_status"
}

coolify() {
	method="$1"
	path="$2"
	shift 2
	curl --fail-with-body --silent --show-error --max-time 60 --request "$method" \
		--header "Authorization: Bearer $COOLIFY_TOKEN" --header "Accept: application/json" \
		--header "Content-Type: application/json" "$API$path" "$@"
}

set_env() {
	coolify PATCH /envs --data "{\"key\":\"$1\",\"value\":\"$2\"}" >/dev/null
}

wait_healthy() {
	for _ in $(seq 1 60); do
		if curl --silent --fail --max-time 5 https://ur-testing.ryot.io/api/system/health >/dev/null; then
			return 0
		fi
		sleep 5
	done
arm=none
echo "campaign complete $(date -u +%FT%TZ)"
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
	arm=$label
	echo "== $label (limit=$limit lane=$lane priority=$priority) $(date -u +%FT%TZ)"
	step="settings"
	set_env EXPERIMENT_PROVIDER_IMPORT_ADMISSION_LIMIT "$limit"
	set_env EXPERIMENT_SANDBOX_INTERACTIVE_LANE "$lane"
	set_env EXPERIMENT_SANDBOX_WORKER_PRIORITY "$priority"
	step="restart"
	coolify POST /stop >/dev/null
	sleep 20
	coolify POST /start >/dev/null
	wait_healthy
	# A fresh database per arm: every arm starts from the same empty state.
	step="database reset"
	remote "set -e
		docker stop ryot-$SERVICE >/dev/null
		docker exec ryot-db-$SERVICE sh -c 'psql -U \"\$POSTGRES_USER\" -d template1 -qc \"drop database if exists postgres with (force)\" -c \"create database postgres\"'
		docker exec ryot-redis-$SERVICE redis-cli flushall >/dev/null
		docker start ryot-$SERVICE >/dev/null"
	wait_healthy
	step="settings check"
	remote "docker exec ryot-$SERVICE printenv" |
		grep -E '^(EXPERIMENT_|SANDBOX_WORKER_CONCURRENCY|SCHEDULER_DISABLE)' >"$OUTPUT/$label.env"
	# An arm that silently ran with the previous arm's settings would corrupt the comparison.
	for expected in "EXPERIMENT_PROVIDER_IMPORT_ADMISSION_LIMIT=$limit" \
		"EXPERIMENT_SANDBOX_INTERACTIVE_LANE=$lane" "EXPERIMENT_SANDBOX_WORKER_PRIORITY=$priority" \
		"SANDBOX_WORKER_CONCURRENCY=2"; do
		grep -qx "$expected" "$OUTPUT/$label.env" || {
			echo "deployed settings do not include $expected" >&2
			exit 1
		}
	done
arm=none
echo "campaign complete $(date -u +%FT%TZ)"
	step="user and plugin setup"
	E2E_API_URL=https://ur-testing.ryot.io/api E2E_FRONTEND_URL=https://ur-testing.ryot.io \
		E2E_ADMIN_ACCESS_TOKEN=$(cat "$BENCHMARK_ADMIN_TOKEN_FILE") \
		with_deadline 600 bun run "$HERE/remote-setup.ts" "$OUTPUT/.state.json" >/dev/null
	step="tool upload"
	remote "mkdir -p /root/ryot-admission-tools && chmod 700 /root/ryot-admission-tools"
	# shellcheck disable=SC2086
	scp -q $SSH_OPTIONS "$OUTPUT/.state.json" "$HERE/remote-probe.mjs" "$HERE/run-arm.sh" "$HOST:/root/ryot-admission-tools/"
	step="scenarios"
	remote "set -e
		docker exec -u 0 ryot-$SERVICE rm -f /tmp/adm-state.json /tmp/remote-probe.mjs
		docker exec -i ryot-$SERVICE sh -c 'umask 077 && cat >/tmp/adm-state.json' </root/ryot-admission-tools/.state.json
		docker exec -i ryot-$SERVICE sh -c 'cat >/tmp/remote-probe.mjs' </root/ryot-admission-tools/remote-probe.mjs
		rm -rf /root/ryot-admission/$label
		sh /root/ryot-admission-tools/run-arm.sh $label $SCENARIOS"
	rm -f "$OUTPUT/.state.json"
	step="result download"
	# shellcheck disable=SC2086
	scp -q -r $SSH_OPTIONS "$HOST:/root/ryot-admission/$label" "$OUTPUT/"
done
arm=none
echo "campaign complete $(date -u +%FT%TZ)"
