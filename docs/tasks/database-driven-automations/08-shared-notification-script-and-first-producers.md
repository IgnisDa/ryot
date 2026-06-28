# Shared Notification Script and First Producers

**Parent Plan:** [Database-Driven Automations, Signals, and Subscriptions](./README.md)

**Type:** AFK

**Status:** done

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

- [x] The three schemas seed idempotently with the PRD's exact property contracts, rejecting
      unknown fields
- [x] `review.created` and `workout.created` emit exactly once for direct API creation and never
      for any other origin or legacy-bootstrap writes; `review.created` reaches only the review
      author
- [x] `integration.disabled` derives its actor from the integration owner loaded by the workflow,
      never from a request or sandbox argument
- [x] The shared notification script formats correct messages for all three signals from the
      snapshot alone and performs no entity queries
- [x] Tests prove no second producer emits any of these signals for the same scope
- [x] End-to-end: producing action → signal → subscription run → formatted message accepted by
      the delivery workflow

## Implementation notes

- Added active, strict actor-audience schemas for `review.created`, `workout.created`, and
  `integration.disabled`. Their contract tests accept the exact supported fields and reject
  unknown fields; existing signal-schema seeding tests retain the idempotency and drift checks.
- Added one built-in review event-create detector across all built-in review schemas and one
  workout entity-create detector. Both gate on API origin and emit exclusively from the lifecycle
  snapshot with stable record-based discriminators.
- Replaced the integration workflow's legacy event-kind delivery with authoritative
  `integration.disabled` emission after continuous-error disabling. The workflow uses the loaded
  integration owner as principal, atomically claims the enabled-to-disabled transition so
  concurrent runs cannot emit twice, and preserves the previous provider-facing notification copy.
- Added the shared `automation.notification` sandbox script with only the `sendNotification`
  capability. It formats all three messages from signal snapshots and has no query capabilities.
- Added registry ownership tests, colocated detector/notifier tests, integration workflow emission
  coverage, and an end-to-end continuous-error test covering action through accepted message
  delivery. Verification passed the backend and test-package Turbo checks, all 1,156 backend
  tests, and the focused end-to-end test.

## Problems and deviations

- The existing registry test initially treated every event automation link as one of the five
  migrated legacy triggers. It was narrowed to the `trigger.*` links, while a separate assertion
  now pins the review and workout producers. No production behavior changed to resolve this.
- The first check reported promise-callback and test-fixture narrowing warnings. Returning
  explicitly from the callbacks and removing the narrowing assertion resolved them without
  suppressions.
- There was no public catalog installation endpoint yet because that belongs to Task 09. The
  end-to-end test therefore installs its user-owned notification rule through a typed, admin-only
  test-support endpoint that composes the owning automation and schema services. This matches the
  task's planned manually inserted rule without bypassing application ownership boundaries.
- No substantive implementation deviation or blocker occurred. The integration workflow's direct
  legacy notification was removed in this task rather than retained in parallel, preserving the
  PRD's one-owner rule for side effects.
- A fresh verification pass found that concurrent qualifying integration runs could each update an
  already-disabled row and emit different signal IDs, then found the first compare-and-set fix
  could lose emission if an activity retried after committing. The disable claim now persists the
  owning run ID: the winning run recognizes its claim on retry, while a losing concurrent run emits
  nothing. Claims retain the scalar run ID rather than referencing deletable run history, so retry
  safety survives run deletion. This required one internal claim table and migration.

## User stories addressed

- User story 11
- User story 12
- User story 13
