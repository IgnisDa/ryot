#!/usr/bin/env bash
# Runs one reproduction scenario on the box and writes <out>/<scenario>.log and .summary.
set -uo pipefail
export PATH="$HOME/.bun/bin:$PATH"

scenario=${1:?scenario}
here=$(cd "$(dirname "$0")" && pwd)
repo=$(git -C "$here" rev-parse --show-toplevel)
out=/root/e2e-repro
mkdir -p "$out"
log="$out/$scenario.log"
summary="$out/$scenario.summary"
: > "$log"
: > "$summary"

note() { echo "$*" | tee -a "$summary"; }

if ! (cd "$repo" && bun install --frozen-lockfile) >> "$log" 2>&1; then
	note "dependency installation failed"
	echo "DONE" >> "$summary"
	exit 1
fi

apply_debug() {
	git -C "$repo" apply --check "$here/debug.patch" 2>/dev/null && git -C "$repo" apply "$here/debug.patch"
	mkdir -p "$repo/e2e/src/api/kernel/debug"
	cp "$here"/debug-*.test.ts "$repo/e2e/src/api/kernel/debug/"
}

revert_debug() {
	git -C "$repo" apply -R "$here/debug.patch" 2>/dev/null
	rm -rf "$repo/e2e/src/api/kernel/debug"
}

e2e() {
	(cd "$repo/e2e" && timeout "${E2E_TIMEOUT:-3600}" bun run test "$@") >> "$log" 2>&1
	echo "EXIT=$?" >> "$log"
}

api_log() {
	local base
	base=$(grep -o 'api logs -> [^ ]*' "$log" | head -1 | cut -d' ' -f4)
	[ -n "$base" ] || return
	{
		for rotated in $(ls "$(dirname "$base")"/*-"$(basename "$base")".gz 2>/dev/null | sort); do zcat "$rotated"; done
		cat "$base"
	}
}

pg_activity() {
	local c u d
	c=$(docker ps --format '{{.ID}} {{.Image}}' | awk '/postgres/{print $1; exit}')
	u=$(docker exec "$c" printenv POSTGRES_USER)
	d=$(docker exec "$c" printenv POSTGRES_DB)
	docker exec "$c" psql -U "$u" -d "$d" -At -c "select state, count(*), max(date_trunc('second', now() - xact_start)) from pg_stat_activity where backend_type = 'client backend' and pid <> pg_backend_pid() group by state order by state"
}

plain() { sed 's/\x1b\[[0-9;]*m//g' "$log"; }

tests_line() { plain | grep -E 'Tests .*(passed|failed)' | tail -1 | xargs; }

case "$scenario" in
serial-chains)
	e2e src/api/plugins/media/events/automations.test.ts -t "more than 100 anime"
	note "alone: $(plain | grep -oE 'more than 100 anime.* [0-9]+ms' | tail -1 | xargs)"
	note "$(tests_line)"
	note "compare with the same test's duration in the full scenario"
	;;
workflow-timeouts)
	apply_debug
	DEBUG_SANDBOX_CONCURRENCY=1 DEBUG_SLEEP_MS=20000 DEBUG_CONCURRENT=6 e2e src/api/kernel/debug/debug-hook-deadline.test.ts
	grep -oE 'request [0-9]+ done in [0-9]+ms' "$log" | while read -r line; do note "$line"; done
	note "warnings: $(api_log | grep -cE 'required-hook-pending|timed out')"
	revert_debug
	;;
wall-clock)
	for burners in 0 16 32; do
		pids=()
		for _ in $(seq 1 "$burners"); do (while :; do :; done) & pids+=($!); done
		e2e src/api/kernel/automations/lifecycle-triggers.test.ts
		[ ${#pids[@]} -eq 0 ] || kill "${pids[@]}"
		note "$burners busy loops: $(plain | grep -oE 'lifecycle-triggers.test.ts \([^)]*\) [0-9]+ms' | tail -1) $(tests_line)"
	done
	;;
composed-views)
	# Delaying the entity browser query moves the Media artifact load past the request snapshot, as load does.
	apply_debug
	for seeded in "" 1; do
		start=$(wc -l < "$log")
		DEBUG_SEED_GLOBAL_BOOK=$seeded DEBUG_DELAY_ENTITY_QUERY=1000 DEBUG_POST_WAIT=1500 e2e src/browser/composed-views.test.ts -t "retains the document"
		run=$(tail -n +"$((start + 1))" "$log" | sed 's/\x1b\[[0-9;]*m//g')
		before=$(grep -oE 'DEBUG-BEFORE before=[0-9]+' <<< "$run" | head -1 | cut -d= -f2)
		late=$(grep -oE 'DEBUG-REQ idx=[0-9]+ [^ ]+' <<< "$run" | sort -u |
			awk -v b="${before:-0}" '{split($2, i, "="); if (i[2] >= b) print $3}' | tr '\n' ' ')
		note "global book=${seeded:-0}: $(grep -E 'Tests .*(passed|failed)' <<< "$run" | tail -1 | xargs) | assets after snapshot: ${late:-none}"
	done
	revert_debug
	;;
idle-timeout)
	(cd "$here" && bun idle-timeout.ts) 2>&1 | tee -a "$log" >> "$summary"
	;;
signup-deadlock)
	apply_debug
	(
		sleep 150
		echo "pg_stat_activity at 150s:"
		pg_activity
	) >> "$summary" 2>&1 &
	DEBUG_POOL_MAX=4 DEBUG_SANDBOX_CONCURRENCY=1 DEBUG_WORKERS=16 DEBUG_DURATION_MS=120000 E2E_TIMEOUT=600 e2e src/api/kernel/debug/debug-auth-stress.test.ts
	wait
	note "$(plain | grep -oE 'DEBUG-STRESS \{.*\}|Test timed out in [0-9]+ms' | tail -1)"
	note "$(tests_line)"
	revert_debug
	;;
full)
	E2E_TIMEOUT=7200 e2e
	note "$(tests_line)"
	note "slowest files:"
	plain | grep -oE 'src/[^ ]+\.test\.ts \([^)]*\) [0-9]+ms' | sort -u |
		awk '{print $NF, $1}' | sort -rn | head -10 | tee -a "$summary"
	api_log > "$out/full-api.log"
	note "ingestSystemPluginUnlocked (time durationMs), first and last 5:"
	grep 'spanName=PluginIngestionService.ingestSystemPluginUnlocked ' "$out/full-api.log" |
		sed -E 's/^timestamp=[0-9-]+T([0-9:]+).*durationMs=([0-9.]+).*/\1 \2/' | sed -n '1,5p;$p' | tee -a "$summary"
	note "sign-ups: $(grep 'Sent HTTP' "$out/full-api.log" | grep 'http.url=/api/auth/sign-up/email ' | grep -c 'http.status=200')"
	note "/api/test-support/cron/plugin per minute (n avg max):"
	grep 'Sent HTTP' "$out/full-api.log" | grep 'http.url=/api/test-support/cron/plugin ' |
		sed -E 's/^timestamp=[0-9-]+T([0-9]+:[0-9]+).*http.span=([0-9]+)ms.*/\1 \2/' |
		awk '{n[$1]++; s[$1]+=$2; if ($2 > x[$1]) x[$1] = $2} END {for (k in n) printf "%s %d %.0fms %.0fms\n", k, n[k], s[k]/n[k], x[k]}' |
		sort | tee -a "$summary"
	note "DELETE responses with status 499 (idle timeout):"
	grep 'http.status=499 http.method=DELETE' "$out/full-api.log" | grep -oE 'http.span=[0-9]+ms http.url=[^ ]+' | tee -a "$summary"
	note "PluginNotFoundError failures: $(grep -c PluginNotFoundError "$log")"
	;;
*)
	echo "unknown scenario: $scenario" >&2
	exit 2
	;;
esac
echo "DONE" >> "$summary"
