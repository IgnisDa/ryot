#!/usr/bin/env bash
# Real-library reads, on the owner's machine only: dumps hold real user data and stay local.
# A dump ages: set LIBRARY_CHECK_TODAY=YYYY-MM-DD to the dump's date, or date windows hold almost no rows.
#   library-check.sh setup DUMP        Restore DUMP into disposable containers and migrate it.
#   library-check.sh update            Rebuild the current code and migrate the restored dump, timed.
#   library-check.sh serve             Start the server and wait for stored summaries to settle.
#   library-check.sh run ID [ROUNDS] [PAGES]
#                                      ROUNDS and PAGES are comma lists of jit modes: on, off or
#                                      server (leave the setting alone). Writes tmp/library-check/ID.jsonl.
#   library-check.sh plans ID READS    EXPLAIN (ANALYZE, BUFFERS) the comma list of READS, without a time
#                                      limit, into tmp/library-check/ID-*.plan. Stop other work first.
#   library-check.sh stop              Stop the server and containers, keeping the data.
#   library-check.sh destroy           Remove the containers and their volumes.
set -uo pipefail
root="$(git -C "$(dirname "$0")" rev-parse --show-toplevel)"
here="$root/docs/work-reduction/scripts"
state="$root/tmp/library-check"
mkdir -p "$state"; chmod 700 "$state"
pg() { docker exec wr-legacy-pg psql -U postgres -d postgres -At -c "$1"; }

start_containers() {
	docker run -d --name wr-legacy-pg --memory=1g --oom-score-adj=1000 --shm-size=512m -p 127.0.0.1:55432:5432 \
		-v wr-legacy-pg-data:/var/lib/postgresql -e POSTGRES_DB=postgres -e POSTGRES_USER=postgres \
		-e POSTGRES_PASSWORD=postgres postgres:18-alpine \
		-c shared_preload_libraries=pg_stat_statements -c pg_stat_statements.track=top >/dev/null
	docker run -d --name wr-legacy-s3 --memory=256m --oom-score-adj=1000 -p 127.0.0.1:59000:9000 \
		-v wr-legacy-s3-data:/data rustfs/rustfs >/dev/null
}

wait_for_postgres() {
	until docker exec wr-legacy-pg pg_isready -U postgres -d postgres >/dev/null 2>&1; do sleep 1; done
	sleep 3
}

load_env() { set -a; . "$state/env.sh"; set +a; }

migrate_current() {
	cd "$root"
	bun turbo build --filter=@ryot-app/media-plugin --filter=@ryot-app/kernel-client --filter=@ryot-app/fitness-plugin \
		--filter=@ryot-app/fixture-plugin --filter=@ryot-app/sandbox 2>&1 | tail -1
	(cd apps/server && bun --no-env-file run assemble 2>&1 | tail -1)
	bun turbo --filter=@ryot-app/kernel-backend --filter=@ryot-app/kernel-renderers build 2>&1 | tail -1
	load_env
	started=$(date +%s)
	(cd apps/server && RUN_MIGRATION_ONLY=true bun --no-env-file run src/main.ts > "$state/migration.log" 2>&1)
	echo "migration exit $? in $(($(date +%s) - started)) s"
}

case "${1:-}" in
setup)
	dump="$2"
	docker rm -fv wr-legacy-pg wr-legacy-s3 >/dev/null 2>&1
	docker volume rm wr-legacy-pg-data wr-legacy-s3-data >/dev/null 2>&1
	start_containers
	wait_for_postgres
	docker exec -i wr-legacy-pg pg_restore -U postgres -d postgres < "$dump" 2>&1 | tail -3
	sleep 5
	docker run --rm --add-host host.docker.internal:host-gateway -e AWS_ACCESS_KEY_ID=rustfsadmin \
		-e AWS_SECRET_ACCESS_KEY=rustfsadmin amazon/aws-cli --endpoint-url http://host.docker.internal:59000 \
		s3 mb s3://ryot 2>&1 | tail -1
	umask 077
	cat > "$state/env.sh" <<ENV
PORT=3999
SERVER_LOG_LEVEL=Info
DATABASE_URL=postgres://postgres:postgres@127.0.0.1:55432/postgres
SERVER_DISABLE_NOTIFICATIONS=true
FRONTEND_URL=http://127.0.0.1:3999
SERVER_ADMIN_ACCESS_TOKEN=$(openssl rand -hex 24)
FILE_STORAGE_S3_BUCKET_NAME=ryot
FILE_STORAGE_S3_URL=http://127.0.0.1:59000
FILE_STORAGE_S3_ACCESS_KEY_ID=rustfsadmin
FILE_STORAGE_S3_SECRET_ACCESS_KEY=rustfsadmin
ENV
	migrate_current
	;;
update)
	docker start wr-legacy-pg wr-legacy-s3 >/dev/null
	wait_for_postgres
	migrate_current
	;;
serve)
	docker start wr-legacy-pg wr-legacy-s3 >/dev/null
	wait_for_postgres
	load_env
	(cd "$root/apps/server" && exec nohup bun --no-env-file run src/main.ts) > "$state/server.log" 2>&1 < /dev/null &
	echo $! > "$state/server.pid"
	until grep -q 'app backend listening' "$state/server.log" 2>/dev/null; do sleep 2; done
	settled=false
	for i in $(seq 1 720); do
		r=$(pg "select count(*) filter (where j.status != 'failed'), count(*) filter (where j.status = 'failed') from job j join \"user\" u on u.id = j.user_id where j.kind in ('fold', 'fold-rebuild') and u.disabled_at is null") || exit 1
		pending=${r%%|*}; failed=${r#*|}
		if [ "$failed" -gt 0 ]; then echo "failed fold jobs: $failed"; exit 1; fi
		if [ "$pending" = 0 ]; then echo "folds settled"; settled=true; break; fi
		sleep 5
	done
	if [ "$settled" != true ]; then echo "folds did not settle"; exit 1; fi
	pg analyze >/dev/null
	;;
run)
	id="$2"; rounds="${3:-server,server,server}"; pages="${4:-server,server,server}"
	out="$state/$id.jsonl"; rm -f "$out"
	load_env
	(while sleep 10; do echo "$(date -u +%T) $(docker stats --no-stream --format '{{.MemUsage}} {{.CPUPerc}}' wr-legacy-pg)"; done) > "$state/$id.stats" & stats=$!
	since="$(date -u +%FT%TZ)"
	(cd "$root/e2e" && RYOT_TEST_TIMEOUT=7200000 RUN_LIBRARY_CHECK=1 LIBRARY_CHECK_OUT="$out" LIBRARY_CHECK_ROUNDS="$rounds" LIBRARY_CHECK_PAGES="$pages" \
		E2E_DATABASE_URL="$DATABASE_URL" E2E_API_URL=http://127.0.0.1:3999/api E2E_FRONTEND_URL=http://127.0.0.1:3999 \
		E2E_ADMIN_ACCESS_TOKEN="$SERVER_ADMIN_ACCESS_TOKEN" bun --no-env-file test --timeout 7200000 \
		src/api/perf/library-check.test.ts > "$state/$id.out" 2>&1)
	rc=$?; echo "exit $rc"
	kill "$stats" 2>/dev/null
	python3 -I "$here/library-report.py" "$out"
	echo "peak memory: $(awk '{print $2}' "$state/$id.stats" | sort -n | tail -1)"
	echo "backends killed:"; docker logs --since "$since" wr-legacy-pg 2>&1 | grep 'terminated by signal' | cut -c1-90 || true
	exit "$rc"
	;;
plans)
	id="$2"; only="$3"
	load_env
	pg "alter system set log_statement = 'all'" >/dev/null; pg "alter system set log_parameter_max_length = -1" >/dev/null
	pg "select pg_reload_conf()" >/dev/null
	since="$(date -u +%FT%TZ)"
	(cd "$root/e2e" && RYOT_TEST_TIMEOUT=7200000 RUN_LIBRARY_CHECK=1 LIBRARY_CHECK_OUT="$state/$id.jsonl" LIBRARY_CHECK_ROUNDS=server LIBRARY_CHECK_PAGES= LIBRARY_CHECK_ONLY="$only" \
		E2E_DATABASE_URL="$DATABASE_URL" E2E_API_URL=http://127.0.0.1:3999/api E2E_FRONTEND_URL=http://127.0.0.1:3999 \
		E2E_ADMIN_ACCESS_TOKEN="$SERVER_ADMIN_ACCESS_TOKEN" bun --no-env-file test --timeout 7200000 \
		src/api/perf/library-check.test.ts > "$state/$id.out" 2>&1)
	rc=$?; echo "exit $rc"
	pg "alter system reset log_statement" >/dev/null; pg "alter system reset log_parameter_max_length" >/dev/null
	pg "select pg_reload_conf()" >/dev/null
	docker logs --since "$since" wr-legacy-pg > "$state/$id.log" 2>&1
	python3 -I "$here/library-explain.py" "$state" "$id"
	rm -f "$state/$id.log"
	exit "$rc"
	;;
stop)
	[ -f "$state/server.pid" ] && kill "$(cat "$state/server.pid")" 2>/dev/null
	rm -f "$state/server.pid"
	docker stop wr-legacy-pg wr-legacy-s3 >/dev/null
	;;
destroy)
	[ -f "$state/server.pid" ] && kill "$(cat "$state/server.pid")" 2>/dev/null
	docker rm -fv wr-legacy-pg wr-legacy-s3 >/dev/null 2>&1
	docker volume rm wr-legacy-pg-data wr-legacy-s3-data >/dev/null 2>&1
	rm -rf "$state"
	;;
*) sed -n 2,13p "$0"; exit 64 ;;
esac
