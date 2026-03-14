# Shared Notification Script and First Producers

**Parent Plan:** [Database-Driven Automations, Signals, and Subscriptions](./README.md)

**Type:** AFK

**Status:** todo

## What to build

The first three real signal producers and the shared notification script that formats their
notifications, per the PRD's Built-In Signal Catalog, Detection Behavior, and Host Functions
sections.

Seed the `review.created`, `workout.created`, and `integration.disabled` signal schemas with the
property contracts and audience policies from the PRD's catalog table (all three are
actor-audience). Implement:

- **`review.created`**: built-in detector rules on the applicable built-in review event schemas,
  emitting only for `api` origin, with the reviewed entity's ID, name, and schema slug drawn from
  the event snapshot's embedded subject reference. Only the review author is eligible.
- **`workout.created`**: a built-in detector rule on workout entity creation, emitting only for
  `api` origin.
- **`integration.disabled`**: authored by the workflow that performs the disable, calling the
  emission service directly with the principal constructed from the owning integration's user.
- **The shared notification script**: one built-in script, allowlisting only send-notification,
  that formats a human-readable message exclusively from the signal snapshot (schema slug,
  validated properties, occurrence time) and branches on slugs freely. Every user notification
  subscription will bind to this script.

Mark these three schemas active in the catalog only once their producers are enabled, per the
phase-gating rule. Verifiable end-to-end in tests: create a review or workout through the public
API (or disable an integration) with a manually inserted user rule, and observe the formatted
notification at the delivery workflow boundary.

Builds on tasks 04 and 05.

## Acceptance criteria

- [ ] The three schemas seed idempotently with the PRD's exact property contracts, rejecting
      unknown fields
- [ ] `review.created` and `workout.created` emit exactly once for direct API creation and never
      for any other origin or legacy-bootstrap writes; `review.created` reaches only the review
      author
- [ ] `integration.disabled` derives its actor from the integration owner loaded by the workflow,
      never from a request or sandbox argument
- [ ] The shared notification script formats correct messages for all three signals from the
      snapshot alone and performs no entity queries
- [ ] Tests prove no second producer emits any of these signals for the same scope
- [ ] End-to-end: producing action → signal → subscription run → formatted message accepted by
      the delivery workflow

## User stories addressed

- User story 11
- User story 12
- User story 13
