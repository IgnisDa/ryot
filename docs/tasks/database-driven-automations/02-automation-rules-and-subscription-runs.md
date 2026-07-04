# Automation Rules and Subscription Runs

**Parent Plan:** [Database-Driven Automations, Signals, and Subscriptions](./README.md)

**Type:** AFK

**Status:** done

## What to build

The rule and run persistence plus the automation service around them. Implement the
`automation_rule` and `subscription_run` tables exactly as specified in the PRD's Persistence
section, including the database checks (exactly one target FK, target/operation compatibility),
the per-target partial unique indexes, the optional server-owned rule metadata, and idempotent
built-in rule seeding. The automation service enforces cross-table ownership and visibility (a
user rule may reference that user's or built-in schemas/scripts) transactionally, and exposes
rule resolution for an occurrence: given a target schema, operation, and row ownership, return
the active rules that must run, applying the PRD's delivery rules (user-owned rows match the
owner's subscriptions plus applicable built-in rules; global rows match built-in rules only).

Run insertion linearizes rule matching: the insertion transaction re-reads the live rule and
rechecks that it is active, deterministic run IDs derive from occurrence and rule IDs, and rule
deletion nulls the FK while the scalar original-rule ID and denormalized name keep history
attributable. No workflow execution yet — runs are inserted and asserted through service tests;
execution arrives in the next slice.

Builds on task 01 (signal schemas exist as one rule target kind). Follow the PRD's Persistence,
Lifecycle Occurrences (delivery rules), and Security sections.

## Acceptance criteria

- [x] Database checks enforce exactly one target, signal targets requiring subscription kind and
      signal operation, lifecycle targets rejecting the signal operation, and policies never
      targeting signal schemas
- [x] Partial unique indexes deduplicate user rules and global rules per the PRD definition
- [x] Service tests cover every allowed and forbidden ownership/visibility combination for rules
      referencing schemas and scripts
- [x] Rule resolution never matches a global row to user subscriptions and never lets a user rule
      see another user's rows
- [x] Run IDs are deterministic from occurrence and rule IDs; duplicate insertion is a no-op
- [x] A rule deactivated or deleted before run insertion produces no run; once a run exists,
      later rule changes cannot affect it
- [x] Deleting a rule preserves its runs, findable through the original-rule ID and rule name
- [x] Built-in rule seeding is idempotent and rule metadata is Effect Schema-validated

## User stories addressed

- User story 28
- User story 30
- User story 33
