#!/bin/sh
# Safety watchdog owned by the benchmark session. It is not a product resource limit: it stops only
# the `ryot-benchmark` compose project when any plan condition holds for five consecutive seconds.
#
#   ./watchdog.sh start <trigger-file> [pid-file]   run in the foreground until triggered
#   ./watchdog.sh stop [pid-file]                   remove the watchdog for this session
#
# Conditions (five consecutive seconds):
#   MemAvailable < 384 MiB
#   memory PSI full avg10 > 10
#   /proc/vmstat oom_kill increased
#   the Ryot container cgroup exceeds 2.5 GiB memory.current
set -eu

PROJECT="${BENCHMARK_COMPOSE_PROJECT:-ryot-benchmark}"
RYOT_CONTAINER="${BENCHMARK_RYOT_CONTAINER:-ryot}"
MEM_AVAILABLE_FLOOR_KB=393216
PSI_FULL_AVG10_CEILING=10
RYOT_CGROUP_CEILING_BYTES=2684354560
CONSECUTIVE_SECONDS=5

mem_available_kb() {
	awk '/^MemAvailable:/ { print $2; exit }' /proc/meminfo
}

memory_psi_full_avg10() {
	awk '/^full/ { for (i = 2; i <= NF; i += 1) { split($i, kv, "="); if (kv[1] == "avg10") { print kv[2]; exit } } }' \
		/proc/pressure/memory 2>/dev/null || printf '0'
}

vmstat_oom_kill() {
	awk '/^oom_kill / { print $2; exit }' /proc/vmstat 2>/dev/null || printf '0'
}

ryot_cgroup_bytes() {
	id=$(docker ps --quiet --filter "name=$RYOT_CONTAINER" 2>/dev/null | head -n 1 || true)
	if [ -z "$id" ]; then
		printf '0'
		return
	fi
	full_id=$(docker inspect --format '{{.Id}}' "$id" 2>/dev/null || true)
	for candidate in \
		"/sys/fs/cgroup/system.slice/docker-$full_id.scope/memory.current" \
		"/sys/fs/cgroup/docker/$full_id/memory.current"; do
		if [ -r "$candidate" ]; then
			cat "$candidate"
			return
		fi
	done
	printf '0'
}

exceeds() {
	awk -v left="$1" -v right="$2" 'BEGIN { exit !(left + 0 > right + 0) }'
}

below() {
	awk -v left="$1" -v right="$2" 'BEGIN { exit !(left + 0 < right + 0) }'
}

stop_project() {
	reason="$1"
	timestamp_ms=$(date +%s)000
	printf '{"kind":"watchdog-trigger","timestampMs":%s,"reason":"%s","project":"%s"}\n' \
		"$timestamp_ms" "$reason" "$PROJECT" >>"$TRIGGER_FILE"
	ids=$(docker ps --quiet --filter "label=com.docker.compose.project=$PROJECT" 2>/dev/null || true)
	if [ -n "$ids" ]; then
		# shellcheck disable=SC2086
		docker stop $ids >/dev/null 2>&1 || true
	fi
}

run_watchdog() {
	TRIGGER_FILE="$1"
	pid_file="${2:-}"
	[ -z "$pid_file" ] || printf '%s\n' "$$" >"$pid_file"
	baseline_oom_kill=$(vmstat_oom_kill)
	streak=0
	last_reason=""
	while true; do
		reason=""
		if below "$(mem_available_kb)" "$MEM_AVAILABLE_FLOOR_KB"; then
			reason="mem-available-below-384mib"
		elif exceeds "$(memory_psi_full_avg10)" "$PSI_FULL_AVG10_CEILING"; then
			reason="memory-psi-full-avg10-above-10"
		elif exceeds "$(vmstat_oom_kill)" "$baseline_oom_kill"; then
			reason="kernel-oom-kill-increased"
		elif exceeds "$(ryot_cgroup_bytes)" "$RYOT_CGROUP_CEILING_BYTES"; then
			reason="ryot-cgroup-above-2.5gib"
		fi
		if [ -z "$reason" ]; then
			streak=0
			last_reason=""
		else
			if [ "$reason" = "$last_reason" ]; then
				streak=$((streak + 1))
			else
				streak=1
				last_reason="$reason"
			fi
			if [ "$streak" -ge "$CONSECUTIVE_SECONDS" ]; then
				stop_project "$reason"
				exit 0
			fi
		fi
		sleep 1
	done
}

command_name="${1:-start}"

case "$command_name" in
start)
	shift
	run_watchdog "${1:?start requires a trigger file}" "${2:-}"
	;;
stop)
	pid_file="${2:-}"
	if [ -n "$pid_file" ] && [ -r "$pid_file" ]; then
		kill "$(cat "$pid_file")" 2>/dev/null || true
		rm -f "$pid_file"
	else
		pkill -f 'watchdog.sh start' 2>/dev/null || true
	fi
	;;
*)
	echo "unknown command: $command_name" >&2
	exit 64
	;;
esac
