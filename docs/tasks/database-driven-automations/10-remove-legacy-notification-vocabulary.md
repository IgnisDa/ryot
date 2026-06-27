# Remove Legacy Notification Vocabulary

**Parent Plan:** [Database-Driven Automations, Signals, and Subscriptions](./README.md)

**Type:** AFK

**Status:** todo

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

- [ ] `configuredEvents` and `NotificationEventType` no longer exist in code, contracts, or
      schema; migrations are regenerated
- [ ] The delivery workflow accepts only test-kind and message-kind requests
- [ ] Media monitoring delivers through message-kind requests with unchanged message content
- [ ] Channel create/update contracts no longer carry configured events; channel CRUD never
      touches subscriptions
- [ ] Notifications reach every enabled channel and no disabled channel; zero enabled channels
      completes successfully with zero deliveries

## User stories addressed

- User story 20
- User story 31
