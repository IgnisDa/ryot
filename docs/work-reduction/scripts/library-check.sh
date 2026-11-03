#!/usr/bin/env bash
# Real-library reads, on the owner's machine only: dumps hold real user data and stay local.
#   library-check.sh setup DUMP        Restore DUMP into disposable containers and migrate it.
#   library-check.sh serve             Start the server and wait for stored summaries to settle.
#   library-check.sh run ID [ROUNDS] [PAGES]
#                                      ROUNDS and PAGES are comma lists of jit modes: on, off or
#                                      server (leave the setting alone). Writes tmp/library-check/ID.jsonl.
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
	docker run -d --name wr-legacy-redis --memory=128m --oom-score-adj=1000 -p 127.0.0.1:56379:6379 redis:alpine >/dev/null
	docker run -d --name wr-legacy-s3 --memory=256m --oom-score-adj=1000 -p 127.0.0.1:59000:9000 \
		-v wr-legacy-s3-data:/data rustfs/rustfs >/dev/null
}

wait_for_postgres() {
	until docker exec wr-legacy-pg pg_isready -U postgres -d postgres >/dev/null 2>&1; do sleep 1; done
	sleep 3
}

load_env() { set -a; . "$state/env.sh"; set +a; }

case "${1:-}" in
setup)
	dump="$2"
	docker rm -fv wr-legacy-pg wr-legacy-redis wr-legacy-s3 >/dev/null 2>&1
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
REDIS_URL=redis://127.0.0.1:56379
DATABASE_URL=postgres://postgres:postgres@127.0.0.1:55432/postgres
SERVER_DISABLE_NOTIFICATIONS=true
FRONTEND_URL=http://127.0.0.1:3999
SERVER_ADMIN_ACCESS_TOKEN=$(openssl rand -hex 24)
FILE_STORAGE_S3_BUCKET_NAME=ryot
FILE_STORAGE_S3_URL=http://127.0.0.1:59000
FILE_STORAGE_S3_ACCESS_KEY_ID=rustfsadmin
FILE_STORAGE_S3_SECRET_ACCESS_KEY=rustfsadmin
ENV
	cd "$root"
	bun turbo build --filter=@ryot-app/media-plugin --filter=@ryot-app/kernel-client --filter=@ryot-app/fitness-plugin \
		--filter=@ryot-app/fixture-plugin --filter=@ryot-app/sandbox 2>&1 | tail -1
	(cd apps/server && bun --no-env-file run assemble 2>&1 | tail -1)
	bun turbo --filter=@ryot-app/kernel-backend --filter=@ryot-app/kernel-renderers build 2>&1 | tail -1
	load_env
	(cd apps/server && RUN_MIGRATION_ONLY=true bun --no-env-file run src/main.ts > "$state/migration.log" 2>&1)
	echo "migration exit $?"
	;;
serve)
	docker start wr-legacy-pg wr-legacy-redis wr-legacy-s3 >/dev/null
	wait_for_postgres
	load_env
	(cd "$root/apps/server" && exec nohup bun --no-env-file run src/main.ts) > "$state/server.log" 2>&1 < /dev/null &
	echo $! > "$state/server.pid"
	until grep -q 'app backend listening' "$state/server.log" 2>/dev/null; do sleep 2; done
	for i in $(seq 1 720); do
		r=$(pg "select count(*), count(*) filter (where revision = projected_revision) from relationship_projection" 2>/dev/null)
		total=${r%%|*}; settled=${r#*|}
		if [ "${total:-0}" -gt 0 ] && [ "$total" = "$settled" ]; then echo "settled $r"; break; fi
		sleep 5
	done
	pg analyze >/dev/null
	;;
run)
	id="$2"; rounds="${3:-server,server,server}"; pages="${4:-server,server,server}"
	out="$state/$id.jsonl"; rm -f "$out"
	load_env
	(while sleep 10; do echo "$(date -u +%T) $(docker stats --no-stream --format '{{.MemUsage}} {{.CPUPerc}}' wr-legacy-pg)"; done) > "$state/$id.stats" & stats=$!
	since="$(date -u +%FT%TZ)"
	(cd "$root/e2e" && RUN_LIBRARY_CHECK=1 LIBRARY_CHECK_OUT="$out" LIBRARY_CHECK_ROUNDS="$rounds" LIBRARY_CHECK_PAGES="$pages" \
		E2E_DATABASE_URL="$DATABASE_URL" E2E_API_URL=http://127.0.0.1:3999/api E2E_FRONTEND_URL=http://127.0.0.1:3999 \
		E2E_ADMIN_ACCESS_TOKEN="$SERVER_ADMIN_ACCESS_TOKEN" bun --no-env-file --bun run vitest run \
		--config vitest.library-check.config.ts > "$state/$id.out" 2>&1)
	echo "exit $?"
	kill "$stats" 2>/dev/null
	python3 -I "$here/library-report.py" "$out"
	echo "peak memory: $(awk '{print $2}' "$state/$id.stats" | sort -n | tail -1)"
	echo "backends killed:"; docker logs --since "$since" wr-legacy-pg 2>&1 | grep 'terminated by signal' | cut -c1-90
	;;
stop)
	[ -f "$state/server.pid" ] && kill "$(cat "$state/server.pid")" 2>/dev/null
	rm -f "$state/server.pid"
	docker stop wr-legacy-pg wr-legacy-redis wr-legacy-s3 >/dev/null
	;;
destroy)
	[ -f "$state/server.pid" ] && kill "$(cat "$state/server.pid")" 2>/dev/null
	docker rm -fv wr-legacy-pg wr-legacy-redis wr-legacy-s3 >/dev/null 2>&1
	docker volume rm wr-legacy-pg-data wr-legacy-s3-data >/dev/null 2>&1
	rm -rf "$state"
	;;
*) sed -n 2,8p "$0"; exit 64 ;;
esac
