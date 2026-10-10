#!/usr/bin/env bash
# S3-D benchmark orchestrator. Runs under the ryot-s3-benchmark systemd unit on the Linux host.
#
#   s3-benchmark.sh --source DIR [--results DIR] [--pairs 6] [--steps a,b,...] [--no-summary]
#
# DIR is a checkout of the pinned revision with dependencies installed. Every step is a separate
# vitest run that provisions fresh PostgreSQL, Redis and S3 containers and a fresh server.
# Steps are unloaded-N, loaded-N (N = 1..pairs, interleaved) and then fairness; --steps selects a subset.
#
# Optional environment:
#   S3_INSTALL=1          run `bun install --frozen-lockfile` in DIR first
#   S3_PROVISION_CMD      command run once in DIR before the steps (confined sidecar provisioning)
#   S3_BENCHMARK_*        workload knobs passed through unchanged (see e2e/src/fixtures/kernel/s3-benchmark.ts):
#                         CPU_ITERATIONS, BACKGROUND_GATES, WARMUP, MEASURED, FAIRNESS_*, SATURATION_TIMEOUT_MS
set -u

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source_dir=""
results=""
pairs=6
steps=""
summarize=1

while [ $# -gt 0 ]; do
	case "$1" in
	--source) source_dir="$2"; shift 2 ;;
	--results) results="$2"; shift 2 ;;
	--pairs) pairs="$2"; shift 2 ;;
	--steps) steps="$2"; shift 2 ;;
	--no-summary) summarize=0; shift ;;
	*) echo "unknown argument: $1" >&2; exit 64 ;;
	esac
done

if [ -z "$source_dir" ] || [ ! -d "$source_dir/e2e" ]; then
	echo "--source must name a repository checkout containing e2e/" >&2
	exit 64
fi
source_dir="$(cd "$source_dir" && pwd)"
[ -n "$results" ] || results="/opt/ryot-s3/results/s3-benchmark-$(date -u +%Y%m%dT%H%M%SZ)"
mkdir -p "$results/host-facts"
results="$(cd "$results" && pwd)"
codes="$results/exit-codes.tsv"
: > "$codes"

record() { printf '%s\t%s\n' "$1" "$2" >> "$codes"; }

write_exit_codes() {
	bun -e '
		const rows = (await Bun.file(process.argv[1]).text()).split("\n").filter(Boolean).map((line) => line.split("\t"));
		await Bun.write(process.argv[2], JSON.stringify(Object.fromEntries(rows.map(([name, code]) => [name, Number(code)])), null, 2) + "\n");
	' "$codes" "$results/exit-codes.json"
}

finish() {
	write_exit_codes
	if [ "$summarize" = 1 ]; then
		bun "$here/s3-summarize.ts" "$results" --pairs "$pairs" > "$results/summarize.log" 2>&1
		summary_code=$?
		record summarize "$summary_code"
		write_exit_codes
		cat "$results/summarize.log"
		echo "summarizer exit code: $summary_code"
		exit "$summary_code"
	fi
	exit "$1"
}

facts() {
	local dir="$results/host-facts"
	date -u +%Y-%m-%dT%H:%M:%SZ > "$dir/date.txt"
	uname -a > "$dir/uname.txt"
	grep -m1 'model name' /proc/cpuinfo > "$dir/cpu-model.txt" 2>&1
	nproc > "$dir/nproc.txt" 2>&1
	grep -E 'MemTotal|MemAvailable|SwapTotal' /proc/meminfo > "$dir/meminfo.txt" 2>&1
	{ cat /proc/self/cgroup; for f in memory.max memory.high cpu.max cpu.weight; do
		cg="/sys/fs/cgroup$(sed -n 's/^0:://p' /proc/self/cgroup)"
		[ -r "$cg/$f" ] && echo "$f $(cat "$cg/$f")"
	done; } > "$dir/cgroup.txt" 2>&1
	git -C "$source_dir" rev-parse HEAD > "$dir/revision.txt" 2>&1
	git -C "$source_dir" status --porcelain > "$dir/git-status.txt" 2>&1
	{ bun --version; docker --version; node --version; } > "$dir/toolchain.txt" 2>&1
	systemctl list-units --type=service --state=running --no-pager > "$dir/running-services.txt" 2>&1
	docker ps --format '{{.Names}} {{.Image}}' > "$dir/containers.txt" 2>&1
	env | grep -E '^S3_' | sort > "$dir/benchmark-environment.txt"
	cat /proc/loadavg > "$dir/loadavg-start.txt"
	bun -e '
		import { readdirSync } from "node:fs";
		const dir = process.argv[1];
		const facts = {};
		for (const name of readdirSync(dir)) facts[name.replace(/\.txt$/, "")] = (await Bun.file(`${dir}/${name}`).text()).trim();
		await Bun.write(`${process.argv[2]}/host-facts.json`, JSON.stringify(facts, null, 2) + "\n");
	' "$dir" "$results"
}

wait_for_idle() {
	local waited=0
	while [ "$waited" -lt 120 ]; do
		leftover="$(docker ps -q --filter label=org.testcontainers=true | wc -l)"
		loadavg="$(cut -d' ' -f1 /proc/loadavg)"
		if [ "$leftover" = 0 ] && awk -v loadavg="$loadavg" 'BEGIN { exit !(loadavg < 0.5) }'; then
			return 0
		fi
		sleep 5
		waited=$((waited + 5))
	done
	echo "host did not become idle (containers=$leftover load=$loadavg); continuing" | tee -a "$results/idle-wait.log"
}

run_step() {
	local name="$1" file="$2" mode="${3:-unloaded}" pair="${4:-1}"
	wait_for_idle
	echo "=== $name $(date -u +%H:%M:%S) ==="
	(
		cd "$source_dir/e2e" || exit 70
		S3_BENCHMARK=1 \
			S3_BENCHMARK_OUT_DIR="$results" \
			S3_BENCHMARK_RUN_NAME="$name" \
			S3_BENCHMARK_MODE="$mode" \
			S3_BENCHMARK_PAIR="$pair" \
			bun --bun run vitest run --config vitest.s3-benchmark.config.ts "src/api/kernel/sandbox/$file"
	) > "$results/$name.log" 2>&1
	local code=$?
	record "$name" "$code"
	echo "$name exited with $code"
	return "$code"
}

facts

if [ "${S3_INSTALL:-0}" = 1 ]; then
	(cd "$source_dir" && bun install --frozen-lockfile) > "$results/install.log" 2>&1
	code=$?
	record install "$code"
	[ "$code" = 0 ] || finish "$code"
fi

if [ -n "${S3_PROVISION_CMD:-}" ]; then
	(cd "$source_dir" && bash -c "$S3_PROVISION_CMD") > "$results/provision.log" 2>&1
	code=$?
	record provision "$code"
	[ "$code" = 0 ] || finish "$code"
fi

selected() { [ -z "$steps" ] || case ",$steps," in *",$1,"*) return 0 ;; *) return 1 ;; esac; }

for pair in $(seq 1 "$pairs"); do
	for mode in unloaded loaded; do
		if selected "$mode-$pair"; then
			run_step "$mode-$pair" s3-benchmark-latency.test.ts "$mode" "$pair" || finish 1
		fi
	done
done

if selected fairness; then
	run_step fairness s3-benchmark-fairness.test.ts || finish 1
fi

finish 0
