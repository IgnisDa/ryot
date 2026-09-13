-- Business rows produced by one variant's scenario list, compared across variants.
select 'entities' as metric, count(*) as value from entity
union all select 'relationships', count(*) from relationship
union all select 'events', count(*) from event
union all select 'automation_runs:' || status, count(*) from automation_run group by status
union all select 'automation_attempts:' || status, count(*) from automation_run_attempt group by status
union all select 'automation_runs_retried', count(*) from automation_run where attempt_count > 1
order by metric;
