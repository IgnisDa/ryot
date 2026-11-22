# Signal schedules

Plugins declare signal schedules to emit an actor-audience signal of their own when a dated row
becomes due. Each schedule is a RyotQL row query over an entity subject; there is no materialized
schedule table. Calendar sources are display-only and do not notify.

## Declaration

A schedule names its `signal`, a date `dueAt` field with `date` or `instant` precision, a text
`occurrence` field, signal `properties` mapped to projected fields, an optional positive
`delayDays`, optional `freshness` (a date `confirmedAt` field and `maxAgeHours`), and an optional
`entitlement`. Manifest validation checks projected fields, the subject alias, that the
signal is an actor-audience signal of the same plugin, and that the query reads only `entity`,
`relationship` and `event` tables and never the clock. Installation validates the query with
plugin-audience access and the field kinds; `self` references bind to the installed plugin. The query
owns eligibility through its `where` clause.

## Delivery

The frequent cron evaluates effective schedules for users with an active subscription to the declared
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
planned again, even if its date later moves, until retention deletes the row after 30 days. A failing
target is logged and retried on the next run.

## Evaluation

A run evaluates only targets that may hold a new due occurrence. Between evaluations the window's
start and the freshness boundary only move forward, which removes rows, so a new one appears only
when the window's end passes a known `dueAt` or when the data the query reads changes.

`signal_schedule_evaluation` keeps, per target, the PostgreSQL snapshot taken at the start of the
run that evaluated it or last advanced it, the time zone and content language it used, and `next_due_at`: when the
earliest fresh row at or after that window's end enters the window (`signalScheduleDueFrom`), null
when there is none, or the evaluation time when the occurrence page limit cut it short. One recipe
request returns the first page of due occurrences and that row. An evaluation is saved only when
every occurrence it found was delivered or already recorded.

Statement triggers (`platform/db/data-changes.ts`) record each transaction that writes entities,
relationships, events, derived values, translations, enrichment requests, plugins or installations
in `data_change`, as `(user, schema slug, transaction ID)`. A user's change has no schema slug. A
global change (a null user) to an entity or relationship, or to an entity's translation or provider
check, carries the changed row's schema slug; a global plugin change has none and reaches every
target. Rows are only inserted, so concurrent writers never wait for each other.

A schedule's `read_schema_slugs`, computed at ingestion by `signalScheduleReadSchemaSlugs`, bounds
the global rows its two recipe queries can read. Each entity or relationship table must be bounded by
its schema slug in its query set's `where` or inner join conditions, or in its own left join
condition, through `eq` and `in` with text literals, `and` and `or`; the declared subject schemas
bound the subject. A table without such a condition, or a read of `relatedPopulationStatus`, which
reads every relationship of an entity, leaves the schedule unbounded (null). Event rows are never
global. A global row of another schema joins no row the query returns, and translations and provider
checks are read only through their own entity, so a change to it cannot add a due occurrence.

A data change is one that the evaluation's snapshot does not see: an indexed probe of the user's
rows and the global rows of its schemas (or every global row, when unbounded) at or above the
snapshot's `xmin`. A transaction still running when the snapshot was taken is not visible to it, so
its change is found once it commits, whatever its ID order.

One query per page of 50 targets (ten pages per run) lists the targets to evaluate: those without
an evaluation, in another time zone or content language, or with a data change, and those whose
`next_due_at` has passed. There is no periodic refresh. Nothing else moves a target's result: its
queries cannot read the clock, a local-day boundary or a date-precision `dueAt` enters the window
at `next_due_at`, a row's freshness only expires, and a new plugin revision or catalog change
writes a plugin or installation row.

`evaluated_at` is when the evaluation's snapshot was taken. Each run first deletes evaluations older
than two days and the `data_change` rows below every remaining snapshot's `xmin` and the current one,
then takes its snapshot and moves to it every current target's evaluation taken over an hour earlier
that has no unseen data change and no `next_due_at` by now, since evaluating it would find nothing
new; that keeps an hour of data changes. A current target has an active user, an active subscription
and a schedule in its plugin's active revision; evaluations of others age out. No evaluation the
run saves can need a deleted row; runs are serial because the frequent cron job runs one at a time.
Evaluations of a page are saved together. Occurrences come in pages of 100, five per target.
