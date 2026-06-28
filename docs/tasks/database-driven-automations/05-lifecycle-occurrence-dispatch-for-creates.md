# Lifecycle Occurrence Dispatch for Creates

**Parent Plan:** [Database-Driven Automations, Signals, and Subscriptions](./README.md)

**Type:** AFK

**Status:** done

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

- [x] Each dispatch root supplies its documented origin; nested write paths propagate the root
      origin end to end; public callers cannot supply origins
- [x] Public entity, event, and relationship creates dispatch one occurrence after commit with a
      complete snapshot; occurrence-free paths dispatch nothing
- [x] Occurrence IDs are deterministic across replay and distinct per mutation; replayed
      dispatch does not duplicate runs
- [x] Event snapshots embed the subject entity ID, name, and schema slug captured at write time
- [x] Durable-source dispatch happens from the workflow body via the bounded envelope, and
      dispatch failures are retried rather than swallowed
- [x] Legacy bootstrap and new-user bootstrap writes produce no runs for user subscriptions
      (bootstrap origin exists; legacy bootstrap produces no occurrences at all)
- [x] Disabled users are excluded from lifecycle matching

## Implementation notes

- A `LifecycleDispatch` seam (`#modules/entities/lifecycle-dispatch`, with a `LifecycleDispatchNoop`
  layer) is defined in the base entities module and implemented by `LifecycleDispatchLive`
  (`#modules/automations/lifecycle-dispatch`), mirroring the existing `SignalDispatch` inversion.
  It resolves active `create` rules for the source's target through `AutomationsService.resolveActive`
  and starts one `SubscriptionExecutionWorkflow` per rule; `resolveActive` already excludes disabled
  users. The `SubscriptionExecutionWorkflow` already accepted entity/event/relationship sources, so
  no workflow changes were needed.
- Origins are threaded per root: the entities route and relationships route inject `{ kind: "api" }`,
  new-user bootstrap injects `{ kind: "bootstrap" }`, and the events service derives the
  `AutomationOrigin` from its `EventCreateOrigin` source plus metadata (api/import/integration/sandbox;
  collection is occurrence-free). Origins are never accepted from public request payloads.
- Entity creates dispatch from `EntitiesService.create` after the insert commits (only when
  `origin` is supplied and a row was actually inserted). Relationship creates dispatch from the
  relationships route after the create/update transaction commits (only when a row was inserted).
  Event creates dispatch from the `EventCreateWorkflow` body, once per created item, so durable
  dispatch failures are retried by the owning workflow rather than swallowed.
- Occurrence IDs are deterministic on the durable event path (`${executionId}-lifecycle-${index}`)
  so replay collides into the same deterministic run and never duplicates; non-durable entity and
  relationship paths generate an opaque id once (`occ_${generateId()}`).
- The event subject snapshot (id, name, entity-schema slug) is captured at write time by extending
  `getEntityScopeForUser` to return the entity name and threading it through the prepared item.
- Occurrence-free write paths (collection membership, user-state, media trending, media-monitoring
  relationship writes, translation overlays, provider population) pass no origin and dispatch nothing;
  provider-population create/update/delete dispatch is deferred to tasks 11–12 as planned.

## User stories addressed

- User story 31
- User story 32
