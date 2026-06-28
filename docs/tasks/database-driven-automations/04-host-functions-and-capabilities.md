# Host Functions and Capabilities

**Parent Plan:** [Database-Driven Automations, Signals, and Subscriptions](./README.md)

**Type:** AFK

**Status:** todo

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

- [ ] A subscription-run script with the emit-signal allowlist can emit; the same script invoked
      via direct sandbox enqueue or as a policy cannot
- [ ] Emit-signal validates payloads, derives actors from the hidden principal, rejects
      unauthorized subjects, and never accepts recipient IDs
- [ ] Send-notification enqueues the message-kind delivery request with a run-derived
      deterministic execution ID and never passes a notification event type
- [ ] Replayed runs do not duplicate signals or delivery executions
- [ ] Public script creation rejects both capabilities; seeding rejects a global built-in rule
      whose script requests send-notification
- [ ] A detector script cannot send notifications and the notifier script cannot emit signals,
      enforced by their allowlists

## User stories addressed

- User story 20
- User story 26
- User story 31
