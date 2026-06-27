# Lifecycle Occurrence Dispatch for Creates

**Parent Plan:** [Database-Driven Automations, Signals, and Subscriptions](./README.md)

**Type:** AFK

**Status:** todo

## What to build

Origin threading and post-commit lifecycle dispatch for the initial occurrence scope, per the
PRD's Origins, Lifecycle Occurrences, Deterministic Identity, and Durable/Non-Durable Sources
sections.

Introduce the server-derived origin value and thread it from every dispatch root: public API
writes, new-user bootstrap, import runs, integration syncs, scheduled provider refreshes, and
sandbox-created writes carrying the creating execution's ID. Ensure-mode population threads the
requesting root's origin through the population trigger; a coalesced execution records the origin
of the request that started it. Public callers can never provide or override origins, and legacy
bootstrap suppresses dispatch entirely.

Wire dispatch into the owning services (never repositories) for public entity, event, and
relationship creates: after commit, enqueue lifecycle dispatch with the persisted record
snapshot, resolve active rules through the task-02 service, and start one task-03 execution per
rule. Every committed mutation gets an opaque occurrence ID that is stable across replay (durable
callers derive it from execution ID plus mutation/item index; non-durable paths generate it once
before persistence). Durable write paths dispatch as the next durable step from a bounded
occurrence envelope (occurrence IDs, operations, commit timestamp, snapshots); dispatch failures
there are retried by the owning workflow, never logged as success. Snapshot shapes follow the
PRD's Sandbox Scripts section — in particular the event snapshot embeds the subject entity
reference resolved by the writing service at capture time. Disabled users are excluded from
lifecycle matching.

Other service write paths (collection membership, user-state merge/clear, media trending) stay
occurrence-free. Update/delete dispatch from population envelopes arrives in task 11.

Builds on tasks 01–03. Verifiable end-to-end: a seeded built-in rule on an event schema runs when
a user creates a matching event through the public API.

## Acceptance criteria

- [ ] Each dispatch root supplies its documented origin; nested write paths propagate the root
      origin end to end; public callers cannot supply origins
- [ ] Public entity, event, and relationship creates dispatch one occurrence after commit with a
      complete snapshot; occurrence-free paths dispatch nothing
- [ ] Occurrence IDs are deterministic across replay and distinct per mutation; replayed
      dispatch does not duplicate runs
- [ ] Event snapshots embed the subject entity ID, name, and schema slug captured at write time
- [ ] Durable-source dispatch happens from the workflow body via the bounded envelope, and
      dispatch failures are retried rather than swallowed
- [ ] Legacy bootstrap and new-user bootstrap writes produce no runs for user subscriptions
      (bootstrap origin exists; legacy bootstrap produces no occurrences at all)
- [ ] Disabled users are excluded from lifecycle matching

## User stories addressed

- User story 31
- User story 32
