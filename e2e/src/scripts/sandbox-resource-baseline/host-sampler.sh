#!/bin/sh
# POSIX host sampler for the sandbox resource baseline. Emits one JSON object per line using only
# procfs, cgroup v2, Docker and journald, so nothing has to be installed on the benchmark VM.
#
#   ./host-sampler.sh sample [output-file]        one sample per second until SIGTERM/SIGINT
#   ./host-sampler.sh metadata                    one container-metadata record
#   ./host-sampler.sh journal <since> [until]     kernel warnings/OOM records for a window
#
# Environment:
#   BENCHMARK_BLOCK_DEVICE   block device under /sys/block (default: first non-loop device)
#   BENCHMARK_CONTAINERS     space separated container name filters (default: the benchmark stack)
set -eu

CONTAINERS="${BENCHMARK_CONTAINERS:-ryot postgres redis otel}"

block_device() {
	if [ -n "${BENCHMARK_BLOCK_DEVICE:-}" ]; then
		printf '%s' "$BENCHMARK_BLOCK_DEVICE"
		return
	fi
	for candidate in /sys/block/*; do
		name=$(basename "$candidate")
		case "$name" in
		loop* | ram* | dm-*) continue ;;
		esac
		printf '%s' "$name"
		return
	done
	printf '%s' "sda"
}

DEVICE=$(block_device)

json_string() {
	printf '%s' "$1" | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g' -e 's/\t/\\t/g' | tr -d '\r\n'
}

meminfo_json() {
	awk '
		BEGIN { printf "{" ; first = 1 }
		/^(MemTotal|MemAvailable|Cached|SReclaimable|Dirty|Writeback):/ {
			key = $1; sub(":", "", key)
			if (!first) printf ","
			printf "\"%s\":%s", key, $2
			first = 0
		}
		END { printf "}" }
	' /proc/meminfo
}

vmstat_json() {
	awk '
		BEGIN { printf "{" ; first = 1 }
		/^(pgfault|pgmajfault|oom_kill)( |$)/ || /^pgscan_/ || /^pgsteal_/ {
			if (!first) printf ","
			printf "\"%s\":%s", $1, $2
			first = 0
		}
		END { printf "}" }
	' /proc/vmstat
}

pressure_json() {
	printf '{'
	separator=""
	for resource in cpu memory io; do
		path="/proc/pressure/$resource"
		[ -r "$path" ] || continue
		some=$(awk '/^some/ { $1=""; sub(/^ /, ""); print }' "$path")
		full=$(awk '/^full/ { $1=""; sub(/^ /, ""); print }' "$path")
		printf '%s"%s":{"some":"%s","full":"%s"}' "$separator" "$resource" "$(json_string "$some")" "$(json_string "$full")"
		separator=","
	done
	printf '}'
}

diskstat_json() {
	path="/sys/block/$DEVICE/stat"
	if [ ! -r "$path" ]; then
		printf 'null'
		return
	fi
	awk '{ printf "["; for (i = 1; i <= NF; i += 1) { if (i > 1) printf ","; printf "%s", $i } printf "]" }' "$path"
}

container_filters() {
	for name in $CONTAINERS; do
		printf -- '--filter name=%s ' "$name"
	done
}

docker_stats_json() {
	# shellcheck disable=SC2046
	ids=$(docker ps --quiet $(container_filters) 2>/dev/null || true)
	if [ -z "$ids" ]; then
		printf '[]'
		return
	fi
	printf '['
	separator=""
	for id in $ids; do
		line=$(docker stats --no-stream --no-trunc --format '{{json .}}' "$id" 2>/dev/null || true)
		[ -n "$line" ] || continue
		printf '%s%s' "$separator" "$line"
		separator=","
	done
	printf ']'
}

docker_metadata_json() {
	# shellcheck disable=SC2046
	ids=$(docker ps --all --quiet $(container_filters) 2>/dev/null || true)
	if [ -z "$ids" ]; then
		printf '[]'
		return
	fi
	printf '['
	separator=""
	for id in $ids; do
		record=$(docker inspect --format '{"id":"{{.Id}}","name":"{{.Name}}","image":"{{.Image}}","startedAt":"{{.State.StartedAt}}","restartCount":{{.RestartCount}},"oomKilled":{{.State.OOMKilled}},"cgroupParent":"{{.HostConfig.CgroupParent}}"}' "$id" 2>/dev/null || true)
		[ -n "$record" ] || continue
		printf '%s%s' "$separator" "$record"
		separator=","
	done
	printf ']'
}

emit_sample() {
	timestamp_ms=$(date +%s)000
	printf '{"kind":"sample","timestampMs":%s,"device":"%s","meminfo":%s,"pressure":%s,"vmstat":%s,"diskstat":%s,"dockerStats":%s}\n' \
		"$timestamp_ms" "$(json_string "$DEVICE")" "$(meminfo_json)" "$(pressure_json)" "$(vmstat_json)" "$(diskstat_json)" "$(docker_stats_json)"
}

emit_metadata() {
	timestamp_ms=$(date +%s)000
	printf '{"kind":"metadata","timestampMs":%s,"containers":%s}\n' "$timestamp_ms" "$(docker_metadata_json)"
}

emit_journal() {
	since="$1"
	until_value="${2:-now}"
	timestamp_ms=$(date +%s)000
	entries=$(journalctl --no-pager --priority=warning --since "$since" --until "$until_value" --output=short-iso 2>/dev/null | head -c 65536 || true)
	printf '{"kind":"journal","timestampMs":%s,"since":"%s","until":"%s","entries":"%s"}\n' \
		"$timestamp_ms" "$(json_string "$since")" "$(json_string "$until_value")" "$(json_string "$entries")"
}

command_name="${1:-sample}"

case "$command_name" in
metadata)
	emit_metadata
	;;
journal)
	shift
	emit_journal "${1:?journal requires a --since value}" "${2:-now}"
	;;
sample)
	output="${2:-}"
	if [ -n "$output" ]; then
		exec >>"$output"
	fi
	emit_metadata
	while true; do
		emit_sample
		sleep 1
	done
	;;
*)
	echo "unknown command: $command_name" >&2
	exit 64
	;;
esac
