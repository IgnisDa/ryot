# Remove Legacy Notification Vocabulary

**Parent Plan:** [Database-Driven Automations, Signals, and Subscriptions](./README.md)

**Type:** AFK

**Status:** done

## What to build

Delete the enum-driven notification path, per the PRD's Notification Model section: remove
`configuredEvents` from the channel table, contracts, repositories, and delivery filtering,
remove the `NotificationEventType` union, and remove the legacy event-kind delivery request from
the delivery workflow, leaving the test kind and the message kind.

Any remaining caller of the event-kind request must first move to the message-kind request. The
media-monitoring module is the expected remaining caller at this point: convert its direct
delivery calls mechanically (same self-constructed messages, message-kind request, no event
type). Its full conversion to detectors happens in tasks 11–14; this slice only removes its
dependency on the enum. Channel CRUD manages delivery configuration only — creation and update
no longer accept or default configured events — and channel management never creates or changes
subscriptions. Regenerate migrations for the dropped column.

Builds on tasks 07–09 (all other event-kind producers are gone by then). Verifiable: every
notification reaches all enabled channels and no disabled channel, with no per-event filtering
anywhere.

## Acceptance criteria

- [x] `configuredEvents` and `NotificationEventType` no longer exist in code, contracts, or
      schema; migrations are regenerated
- [x] The delivery workflow accepts only test-kind and message-kind requests
- [x] Media monitoring delivers through message-kind requests with unchanged message content
- [x] Channel create/update contracts no longer carry configured events; channel CRUD never
      touches subscriptions
- [x] Notifications reach every enabled channel and no disabled channel; zero enabled channels
      completes successfully with zero deliveries

## Implementation notes

- Removed the legacy notification event schema and channel event-filter fields from the shared
  contract, database schema, repository, service, and delivery workflow. Enabled-channel lookup
  now depends only on user ownership and disabled state.
- Removed the event-kind request and the legacy `trigger` service operation. Test notifications
  retain their per-channel copy, while all caller-supplied notifications use message-kind
  requests.
- Converted media-monitoring delivery to message-kind requests without changing message copy.
  Its deterministic fingerprints now derive from message content, with entity/association kinds
  included for association changes so distinct facts with identical copy cannot collide.
- Removed legacy event-array validation and copying from V1 notification-platform migration.
  Migrated channels retain their platform specifics and disabled state; migrated users receive
  the active default topic subscriptions through the existing bootstrap path.
- Regenerated the unreleased Drizzle baseline. `notification_channel` now has seven columns and no
  event-filter column.
- Updated backend unit and end-to-end coverage to assert all-enabled-channel delivery,
  best-effort outcomes, unchanged media-monitoring messages, zero-channel success, disabled-channel
  exclusion, and channel CRUD without event configuration.
- Verification passed the backend and test-package Turbo checks with no warnings, all 1,161
  backend tests, and 14 affected end-to-end tests across notification channels, notification
  subscriptions, media monitoring, and integration auto-disable.
- Restored and migrated both `tmp/file.sql` and `tmp/file2.sql`. The first migrated one channel and
  one user; the larger dump migrated nine channels and 299 users. Database inspection confirmed
  the seven-column channel shape, matching platform/specifics kinds for every channel, and three
  default notification rules for every migrated user.

## Problems and deviations

- Drizzle generation initially failed because the retained empty `meta` directory prevented it
  from creating a fresh journal. Adding the standard empty journal allowed the baseline to be
  regenerated normally.
- The first larger-dump migration command hit its two-minute shell limit during episodic data
  migration. Rerunning with a longer limit completed successfully; the replay also exercised the
  migration's conflict-safe inserts and bootstrap completion gate without duplicates.
- Frontend and the legacy V1 Rust/GraphQL stack were excluded after scope clarification. This task
  updates the V2 shared contract and backend only; those separate surfaces are not consumers of
  this service contract.
- No blocker or substantive behavioral deviation occurred.

## User stories addressed

- User story 20
- User story 31
