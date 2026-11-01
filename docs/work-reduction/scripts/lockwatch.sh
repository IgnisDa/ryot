#!/bin/sh
# usage: lockwatch.sh OUT  -- every 5 s, record lock waiters of the oldest postgres:18-alpine container (the shared e2e database)
# with the advisory key they wait on (named when it is a known global key) and their blockers' queries.
out="$1"; cid=""
while [ -z "$cid" ]; do cid=$(docker ps --filter ancestor=postgres:18-alpine --format "{{.ID}}" | tail -1); sleep 2; done
q="with w as (
  select a.pid, l.locktype, l.mode, l.objid, now() - a.query_start as waited, left(a.query, 90) as query, pg_blocking_pids(a.pid) as blockers
  from pg_stat_activity a join pg_locks l on l.pid = a.pid and not l.granted
  where a.datname = 'test_db')
select now()::time(0), w.pid, w.locktype, w.mode,
  case when w.locktype = 'advisory' and w.objid::int = hashtext('ryot-plugin-ingestion') then 'ryot-plugin-ingestion' else w.objid::text end,
  w.waited, w.query, b.pid, left(b.query, 120)
from w left join lateral unnest(w.blockers) as bp(pid) on true left join pg_stat_activity b on b.pid = bp.pid"
until port=$(docker port "$cid" 5432/tcp 2>/dev/null | head -1 | sed 's/.*://') && [ -n "$port" ]; do sleep 1; done
while docker inspect "$cid" >/dev/null 2>&1; do
  psql "postgresql://test_user:test_password@127.0.0.1:$port/test_db" -AtF '|' -c "$q" >> "$out" 2>/dev/null
  sleep 5
done
