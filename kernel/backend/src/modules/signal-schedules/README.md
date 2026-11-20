# Signal schedules

Plugins declare signal schedules to emit an actor-audience signal of their own when a dated row
becomes due. Each schedule is a RyotQL row query over an entity subject; there is no materialized
schedule table. Calendar sources are display-only and do not notify.

## Declaration

A schedule names its `signal`, a date `dueAt` field with `date` or `instant` precision, a text
`occurrence` field, signal `properties` mapped to projected fields, an optional positive
`delayDays`, optional `freshness` (a date `confirmedAt` field and `maxAgeHours`), and an optional
`entitlement`. Manifest validation checks projected fields, the subject alias, and that the
signal is an actor-audience signal of the same plugin. Installation validates the query with
plugin-audience access and the field kinds; `self` references bind to the installed plugin. The query
owns eligibility through its `where` clause.

## Delivery

The frequent cron scans effective schedules for users with an active subscription to the declared
signal, skipping schedules whose `entitlement` the account does not hold. Each user's
reporting timezone defines their day. A row is due when `dueAt` plus `delayDays`
falls in the local day or the two catch-up days before it; instants are bounded by now. Rows older
than the window are skipped, not sent late. A null `confirmedAt` has no freshness requirement; an
older value defers the row until the owner refreshes the data.

The worker queries as the recipient, so the query's own visibility rules decide the audience. Each
new occurrence commits the signal through `ChangeSets` with a deterministic execution ID. The
commit's precondition admits the account and takes the occurrence's delivery lock, writing nothing
when the occurrence is already recorded; its `written` step records
`(user, plugin, schedule, occurrence)` in `signal_schedule_delivery` with the signal's trigger in the
same transaction. Dispatch starts after commit. A recorded occurrence is never
planned again, even if its date later moves, until retention deletes the row after 30 days. Scans
use pages of 50 targets (ten pages per run) and 100 occurrences (five pages per target); a failing
target is logged and retried on the next run.
