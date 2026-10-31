# Entity reminders

Reminders are independent, owner-scoped occurrences. Scheduling stores a fixed UTC instant and a
named timezone. A reminder never changes collection membership. Imported or restored unfinished
records use `needs-scheduling`; they cannot run until the user creates a replacement occurrence.

## Transactions and lock order

Commands admit the account generation and lock the mutation receipt before inspecting current
state. They then take the plugin ingestion lock in shared mode, entity user-data locks in sorted ID
order, and finally reminder rows. Due processing uses the same account, ingestion, entity, reminder
order. Signal planning takes its catalog/configuration and budget locks inside that transaction;
execution starts only after commit. No transaction spans sandbox execution or provider I/O.

Notification admission and send claims use a transaction-scoped source policy before locking the
notification. Cancellation locks the reminder before revoking queued notification work. Existing send
claims cannot be recalled. Removed records retain a minimal tombstone so delayed formatter retries
cannot restore authority. Authored content and public history are removed separately from that fence.

## Scheduling and settlement

The frequent cron scans overdue work with 50-row keyset pages and a ten-page limit per state.
Failures defer only the affected row for 60 seconds. Processing retains its immutable `reminder.due`
signal and selected formatter run in the source transaction; dispatch starts after commit. The worker
settles from the notification ledger, not formatter success. Missing/disabled subscriptions settle as
Not sent. Missing, failed or expired formatter evidence settles explicitly and revokes later admission.

Notification admission and channel claims recheck the reminder fence. Clearing user data erases the
authored content and revokes queued work atomically. A claimed request may still finish; it is never
represented as recalled. Merge preserves independent IDs and immutable admitted messages while
remapping targets and parent scopes, including detached children retained by reminders.

The backup owner restores unfinished history inactive with its original schedule evidence. V1
conversion belongs to server bootstrap and preserves date-only evidence without inventing a timezone.

## Reads and UI

`reminder` is an owner-only, kernel-audience RyotQL table. Shared recipes select safe authored data,
compact outcomes and replacement links. The account manager and the plugin host screen use the same
commands and editor. Server delivery/dispatcher configuration is a separate non-row HTTP read;
channel and subscription readiness use owner-scoped recipes. Subscription changes require explicit
user action. Terminal history removal hides content but retains replay and cancellation fences.
