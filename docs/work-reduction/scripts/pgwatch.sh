#!/bin/sh
# usage: pgwatch.sh OUT_CSV  -- snapshots pg_stat_statements of the newest postgres:18-alpine container until it disappears
out="$1"; cid=""
pre=$(docker ps -q --filter ancestor=postgres:18-alpine)
while [ -z "$cid" ]; do cid=$(docker ps --filter ancestor=postgres:18-alpine --format '{{.ID}}' | grep -v -F "${pre:-__none__}" | head -1); sleep 2; done
echo "container $cid" >&2
# Host psql through the mapped port: docker exec costs a runc start per sample.
until port=$(docker port "$cid" 5432/tcp 2>/dev/null | head -1 | sed 's/.*://') && [ -n "$port" ]; do sleep 1; done
db="postgresql://test_user:test_password@127.0.0.1:$port/test_db"
until psql "$db" -Atc "create extension if not exists pg_stat_statements" >/dev/null 2>>"$out.err"; do docker inspect "$cid" >/dev/null 2>&1 || { echo "container $cid gone before extension" >&2; exec "$0" "$out"; }; sleep 1; done
while docker inspect "$cid" >/dev/null 2>&1; do
  psql "$db" -c "\copy (select s.queryid, d.datname, s.calls, s.total_exec_time, s.rows, s.shared_blks_hit, s.shared_blks_read, s.query from pg_stat_statements s left join pg_database d on d.oid=s.dbid) to stdout with csv header" > "$out.tmp" 2>/dev/null && [ -s "$out.tmp" ] && mv "$out.tmp" "$out"
  psql "$db" -Atc "select now(), pid, state, wait_event_type, wait_event, now()-xact_start, left(query,160) from pg_stat_activity where datname is not null and pid<>pg_backend_pid() and (wait_event_type='Lock' or (state like 'idle in transaction%' and now()-state_change > interval '20 seconds') or now()-query_start > interval '60 seconds' and state='active')" >> "$out.activity" 2>/dev/null
  sleep 60
done
echo "container gone" >&2
