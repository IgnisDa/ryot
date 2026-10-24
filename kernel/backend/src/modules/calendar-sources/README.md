# Calendar sources

Plugins declare calendar sources as RyotQL row queries over an entity subject. Calendar display and
date-driven notifications read the same declaration; there is no materialized calendar table.

## Delivery

A source may declare `delivery`: an actor-audience signal of the same plugin, a text `occurrence`
field, a boolean `eligible` field, signal property fields, and optional `freshness` with a date
`confirmedAt` field and `maxAgeHours`. Installation validation checks the field kinds and signal.

The frequent cron scans effective delivery sources for users with an active subscription to the
declared signal. Each user's reporting timezone (UTC when unset) defines their day. Date sources match
the local day and two catch-up days; instant sources match from local midnight two days back until
now. Occurrences older than the window are skipped, not sent late. A null `confirmedAt` has no
freshness requirement; an older value defers the occurrence until the owner refreshes the data.

The worker queries as the recipient, so the source's own visibility rules and the `eligible` field
decide the audience. For each new occurrence it plans the signal with a deterministic execution ID
and records `(user, plugin, source, occurrence)` in `calendar_delivery` in the same transaction,
after admitting the account generation. Dispatch starts after commit. A recorded occurrence is never
planned again, even if its date later moves, until retention deletes the row after 30 days. Scans
use pages of 50 targets (ten pages per run) and 100 occurrences (five pages per target); a failing
target is logged and retried on the next run.

Display visibility (`isHidden`) does not affect delivery; the notification subscription does.
