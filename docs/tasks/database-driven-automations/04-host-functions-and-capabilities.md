# Host Functions and Capabilities

**Parent Plan:** [Database-Driven Automations, Signals, and Subscriptions](./README.md)

**Type:** AFK

**Status:** done

## What to build

The two automation host functions and the capability model gating them, per the PRD's Host
Functions and Capabilities sections.

**Emit-signal** exposes the task-01 emission service to sandbox scripts: schema load, property
validation, actor derivation from the hidden principal, subject authorization (with the trusted
built-in exception for global signals), audience resolution, atomic insert, and post-commit
signal dispatch. Author workflows call the same underlying service directly, constructing the
principal from records they have authoritatively loaded. A system-principal execution cannot emit
an actor-audience signal.

**Send-notification** accepts a schema-validated message and enqueues the existing message-kind
delivery request for the hidden current user, with a deterministic delivery execution ID derived
from the run, returning success once durable delivery is accepted. It rejects arbitrary user IDs;
zero enabled channels succeeds with zero results; per-channel outcomes never retroactively fail
the run.

Script metadata allowlists are the capability source of truth: both host functions are provided
only to rule-bound subscription executions (never policies or direct sandbox enqueue runs,
regardless of allowlists), public script creation rejects both capabilities, and seeding rejects
a global built-in rule whose script requests send-notification.

Builds on task 03. Verify end-to-end with built-in test scripts: a detector-style script that
emits a signal, and a notifier-style script that sends a notification observed at the delivery
workflow boundary.

## Acceptance criteria

- [x] A subscription-run script with the emit-signal allowlist can emit; the same script invoked
      via direct sandbox enqueue or as a policy cannot
- [x] Emit-signal validates payloads, derives actors from the hidden principal, rejects
      unauthorized subjects, and never accepts recipient IDs
- [x] Send-notification enqueues the message-kind delivery request with a run-derived
      deterministic execution ID and never passes a notification event type
- [x] Replayed runs do not duplicate signals or delivery executions
- [x] Public script creation rejects both capabilities; seeding rejects a global built-in rule
      whose script requests send-notification
- [x] A detector script cannot send notifications and the notifier script cannot emit signals,
      enforced by their allowlists

## Implementation notes

- The SDK exposes strict `emitSignal` and `sendNotification` contracts. The signal request has no
  recipient, actor, origin, occurrence-time, or execution-ID fields.
- Sandbox executions carry a server-only subscription-run marker containing the run ID, origin,
  and occurrence time. The runtime intersects script allowlists with this marker, so direct
  enqueue and policy executions never receive either automation capability.
- Emit-signal delegates validation, subject authorization, audience resolution, recipient
  snapshotting, replay handling, and dispatch to `SignalEmissionService`. Send-notification
  delegates to the message-kind `NotificationsService.sendMessage` path with a run-derived ID.
- Public script creation rejects both capabilities. Built-in rule seeding loads the referenced
  script capabilities and rejects global rules that request `sendNotification`.
- The hidden automation tracer now acts as an emitter and targets a second hidden test signal.
  A separate built-in notifier test script carries only `sendNotification`; it is intentionally
  not attached to a global rule.
- Automation context now includes the server-owned occurrence time required by detector
  emissions. This completes the PRD's occurrence-envelope contract ahead of lifecycle dispatch.

## User stories addressed

- User story 20
- User story 26
- User story 31
