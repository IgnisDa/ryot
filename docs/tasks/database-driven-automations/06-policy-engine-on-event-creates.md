# Policy Engine on Event Creates

**Parent Plan:** [Database-Driven Automations, Signals, and Subscriptions](./README.md)

**Type:** AFK

**Status:** todo

## What to build

The synchronous pre-write policy chain and the per-item event batch contract, per the PRD's Model
(policies), Lifecycle Occurrences, and Event Create Batches sections.

Policies are automation rules of policy kind resolved for the target event schema and executed as
an ordered, sequential reducer over the canonical write draft before the write transaction opens.
Allow passes the draft through; skip stops the chain as a successful no-op; replace may change
only the fields the source contract permits — for the initial event create contract: properties,
occurrence time, and session entity. Every replacement is normalized, schema-validated, and
reauthorized; invalid output, an unauthorized reference, or script failure rejects that record's
write. Policies cannot replace actor, owner, schema, operation, origin, or relationship
endpoints, never hold a database transaction across sandbox execution, and never receive the
emit-signal or send-notification host functions.

An array submission to the public event create endpoint is an ordered sequence of independent
record creates: each item completes its policy chain, transaction, and dispatch initiation before
the next; the batch stops at the first failure, leaving earlier committed items and their runs in
place; the endpoint awaits the durable workflow and returns real per-item outcomes (written,
skipped-by-policy, and the failed index with a typed reason) as a success-status outcome, not a
transport-level 4xx. Internal durable callers compose the same workflow with deterministic
execution IDs.

Builds on tasks 02, 03, and 05. Verifiable end-to-end with a seeded test policy script that
skips and replaces drafts through the public endpoint.

## Acceptance criteria

- [ ] Policies execute in their configured order before the write transaction opens, and no
      transaction is held across sandbox execution
- [ ] Allow, skip, and replace behave per the PRD; replace is limited to the contract's
      replaceable fields and replacements are validated and reauthorized
- [ ] A failing or invalid policy rejects only that record's write with a typed reason
- [ ] Batch submissions return actual per-item outcomes and never report uncommitted items as
      created; earlier committed items survive a later item's failure
- [ ] Policy runs never receive emit-signal or send-notification
- [ ] Replay of the internal durable event-create path does not duplicate items or runs

## User stories addressed

- User story 31
- User story 32
