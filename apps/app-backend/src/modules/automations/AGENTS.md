# Automations Module

This module owns database-defined policies, subscriptions, signals, execution history, correlation budgets, and effect idempotency. Built-in behavior is installed as database rows and sandbox scripts by `modules/builtins`; the runtime must not branch on built-in rule IDs, script IDs, signal slugs, or schema slugs.

## Rule Model

- Every rule has one target schema, one operation, one sandbox script, a kind (`policy` or `subscription`), and stored metadata/configuration.
- Event-create policies run before persistence in ascending effective position. A null position means `1000`; ordering uses the same effective value in SQL and in returned rule snapshots, with rule ID as the deterministic tie-breaker.
- Subscriptions run after the owning write commits. The dispatcher resolves live rules, and `SubscriptionExecutionWorkflow` creates the immutable run snapshot before sandbox execution.
- Rule capability ceilings are intersected with the script allowlist and execution-kind allowlist. Policies cannot invoke effectful automation host functions. A global built-in rule never receives `sendNotification`; user-owned rules keep both `sendNotification` and `emitSignal`, and emission-time authorization decides which signal schema each run may target.

## Generic Rule And Custom Signal Surface (Phase 5)

`service.ts` exposes user-facing generic rule and custom-signal-schema management on the same persisted model; `repository-rules.ts` owns their persistence.

- The generic rule API (`createRule`/`updateRule`/`deleteRule`/`listRules`/`getRule`) creates **subscription** rules only. Permitted targets: an active built-in signal schema, the owner's custom signal schema, or a `create` lifecycle on a built-in or owner-visible entity/event/relationship schema. Operation is derived from the target (`signal` for signal targets, `create` for lifecycle targets); public update/delete lifecycle rules and policy creation stay out of scope.
- A generic rule may reference only the owner's own sandbox script. The shared built-in notification script is bound exclusively through catalog installation (`installNotificationRule`), so a user rule cannot pull in a built-in detector script. This keeps `scriptIsBuiltin` a reliable trust signal at emission time.
- `updateRule` mutates only name, metadata, and active state. Kind, target, operation, and script are immutable (delete-and-recreate), so the per-target unique indexes never change. `listRules`/`getRule`/`updateRule`/`deleteRule` are the single surface for every user-owned rule, including catalog-installed notification rules (`isBuiltin = true`, `operation = signal`). `installNotificationRule` is the one notification-specific endpoint: it creates the rule and returns the same `AutomationRuleView`, so there are no separate notification list/get/activate/deactivate/delete endpoints.
- Custom signal schemas (`createCustomSignalSchema`/`list`/`get`/`archive`) are always `catalog_state = hidden` and actor-audience, so a user script can only ever notify the emitting user. Archival sets `archived_at`, deactivates the owner's rules targeting the schema, retains historical signals, and blocks new rules/emissions. The built-in catalog list/get surface is unchanged and never exposes user schemas.
- Quotas are enforced inside the creation transaction under the owner-row lock via the shared `lockUserAndCountOwnedRows` helper (`lib/infrastructure/db/service.ts`): 256 rules, 64 signal schemas including archived, and 256 sandbox scripts.

## Lifecycle Dispatch

`lifecycle-dispatch.ts` is the shared subscription dispatcher for entity, event, and relationship occurrences. Source modules construct schema-neutral lifecycle snapshots and pass a server-derived origin, root correlation ID, operation, target schema ID, and occurrence ID. The dispatcher derives only per-rule execution and run IDs; sibling rules retain the occurrence's correlation ID so they share one breadth budget.

Dispatcher call sites must be workflow-body-only. Starting subscription children from a service method, repository, or an Activity `execute` body breaks the one-durable-owner model and risks duplicate runs on replay. Write Activities return the mutation envelope (`mutation-envelope.ts`); the owning workflow body dispatches from it. The full write-path owner map, occurrence-free carve-outs, and the standard shape are in "Write-path ownership" below.

Public inputs never provide lifecycle origins. Nested workflows propagate the root origin unchanged. The supported origins are API, bootstrap, collection, provider refresh, automation, import, and integration. Import and integration origins retain their run/integration identifiers where available.

Provider population supplies generic before/after snapshots plus trusted population context. The accepted automation plan explicitly requires `scopeEntity`, `rootPreviouslyPopulated`, relationship batch summaries, and the episode-only `owningSeason` reference used by sandbox detectors for Specials suppression. These are workflow-owned context fields, not public input. Do not add further domain-specific runtime branching without changing the plan.

## Write-path ownership

Every automation-producing business operation (entity, relationship, event, signal) has exactly one durable owner: one workflow definition or one durable-queue worker. The shared shape:

- An `Activity.make` persists the mutation transactionally and returns the typed mutation envelope (`mutation-envelope.ts`: `MutationOutcome`, `MutationContext`). Activities are memoization boundaries; they never start child workflows.
- The owning workflow/worker body resolves lifecycle rules through an Activity, then dispatches deterministic subscription children. Execution IDs derive from the parent execution ID plus stable item indices and business identity (never random, never DB return order): lifecycle children are `lifecycle-subscription-<occurrenceId>-<ruleId>`, signal children `signal-subscription-<signalId>-<ruleId>`.
- Every material mutation returns `create`/`update`/`delete`; an unchanged write returns `noop` and produces no occurrence.
- Repositories persist and normalize rows only; services validate and persist. Neither starts durable work or resolves automation rules. The one sanctioned service shape is a thin route/cron adapter whose only durable action is starting or awaiting the operation's own owning workflow (surfaced under route/task/worker contexts in `sandbox/workflow-dispatch-boundaries.test.ts`, intentionally not pinned as a violation).
- No second durability system: no outbox, occurrence table, or polling dispatcher. `@effect/workflow` replay + Activity memoization + deterministic IDs are the durability story.

Owner map (owner per operation):

- Public entity create → `EntityCreateWorkflow`. The one canonical entity write is `EntitiesService.save` (→ `EntitiesRepository.saveEntity`), returning the entity mutation outcome; `EntitiesService.create` layers API normalization/idempotency (`prepareApiCreate`) over it without being a second persistence path. This core stays persistence-only; callers own occurrences.
- Builtin bootstrap library entity → `BootstrapUserWorkflow` (started by `auth` and `god-mode` `resetUser`; legacy migration calls `bootstrapNewUser` directly, suppressed).
- Provider graph entities (root/child/related) → `ProviderEntityPopulationWorkflow`: its write Activity returns the full envelope (root → related → child) and the body dispatches one child per committed occurrence.
- Import entities (workout/measurement/media) → the import workflow's write Activity writes, its body dispatches `entity-create-<id>` (`import` origin) via `imports/runtime/import-entity-lifecycle-workflow.ts`.
- Media-trending refresh entity saves + self-relationship sync → `MediaTrendingRefreshWorkflow` (occurrence-free bulk).
- Public relationship create → `RelationshipCreateWorkflow`. The one canonical single-relationship write is `RelationshipsService.save` (typed `validation: "schema" | "prevalidated"` mode, returning `SaveRelationshipOutcome`). Global bulk synchronization is a separate operation family with one canonical `RelationshipsService.syncGlobal` (returns the sync outcome; occurrence-free bulk callers ignore it). Both stay persistence-only; producers own occurrences.
- Collection membership add/delete → `AddEntityToCollectionWorkflow` / `RemoveEntityFromCollectionWorkflow` (Activity writes the relationship, body composes `EventCreateWorkflow`).
- Media-monitoring enable/disable → `EnableMediaMonitoringWorkflow` / `DisableMediaMonitoringWorkflow`.
- Event create → `EventCreateWorkflow`: ordered before-create policies and replacement validation run before the memoized write Activity; after-create subscriptions resolve in an Activity and dispatch from the body. The sandbox `createEvents` host fn composes it at depth zero; collection/import events are composed by their owning workflows.
- Signals → `AutomationsService.emitSignal` is persistence-only (audience authorization, trusted-principal check, recipient snapshot, deterministic id, dedup). Producers call `emitAndDispatchSignal` (`signal-dispatch.ts`) from a workflow/queue-worker body: the sandbox `emitSignal` host fn (queue-worker body) and `integration.disabled` (`ProcessIntegrationRunWorkflow` body). `dispatchSignalSubscriptions` starts children workflow-body/worker-body-only.
- Subscription execution (downstream) → `SubscriptionExecutionWorkflow` owns run rows + sandbox dispatch; `RunSandboxWorkflow` + `SandboxExecutionQueue` own execution; `NotificationDeliveryWorkflow` owns delivery.

Intentionally occurrence-free carve-outs (each deliberate; anything not listed must produce one occurrence per committed material mutation):

- Legacy bootstrap / V1 migration writes: trusted `suppressAutomation` path; historical data must not fire subscriptions.
- Entity/relationship `noop` outcomes: not material mutations (identical replacements, preserved conflicts, timestamp-only).
- User-state merge/clear bulk event + relationship mutations (`user-state/service.ts`): documented occurrence-free bulk mutation; no before/after capture on bulk SQL.
- Media-trending refresh bulk entity saves + self-relationship sync.
- Translation overlay writes (`entity_translation`): not canonical `entity` rows, cannot wake canonical entity detectors.
- Collection membership relationship writes (member-of + in-library edges): membership signals travel through the collection added/removed events, not relationship detectors.
- Monitoring-relationship deletion (`DisableMediaMonitoringWorkflow`): delete rules are built-in-only and none target this schema.
- `bootstrapNewUser` account defaults (views, rules, state): not automation-producing writes.

Cross-module repository writes are forbidden except the atomicity carve-out (see `apps/app-backend/AGENTS.md`, "Cross-Module Infrastructure"); the sanctioned set (`entity-schemas` → `TrackersRepository.linkEntitySchema`, and the user-state bulk deletes/moves above) is pinned in `sandbox/repository-write-boundaries.test.ts`.

The entity-interest reconcile path drives `ProviderEntityPopulationWorkflow` from an entity's stored `externalId`/`sandboxScriptId` and may carry user-owned provenance into global population. This is intended behavior (per product decision), not an occurrence-ownership concern; the library-import entry point separately rejects custom user-owned entity schemas and non-built-in sandbox scripts.

Both boundary tests (`sandbox/workflow-dispatch-boundaries.test.ts` and `sandbox/repository-write-boundaries.test.ts`) statically analyze the source and fail the build on a new service/Activity workflow dispatch or a new cross-module repository write.

## Signals And Audiences

- Signal schemas and their audience policies are database rows.
- `AutomationsService.emitSignal` validates properties, derives the actor from trusted execution context, resolves the database-owned audience policy, persists the signal and recipient snapshot, then dispatches signal subscriptions.
- `emitSignal` carries a `trusted` flag (the sandbox passes `scriptIsBuiltin`; authoritative workflows pass `true`). Under a user principal, an untrusted (user-authored) script may raise only that user's own actor-only schemas; only trusted built-in detectors/workflows emit shared built-in signals under a user principal. System principals emit built-in signals only.
- User scripts never choose recipients. User-owned signals are actor-audience only.
- Sandbox detectors emit signals through `emitSignal`; notification rules consume signals through `sendNotification`.
- `integration.disabled` is the plan-defined authoritative workflow producer exception. The integration workflow loads the owning user and emits through `AutomationsService`; it does not hardcode recipients or delivery behavior.

## Correlation And Effects

- A root occurrence owns one correlation ID. All descendant effects and sibling subscription runs retain it.
- A run may reserve at most 32 host calls. The correlation budget caps the whole tree at 256 units.
- `automation_effect` is the durable idempotency ledger. Reusing an effect key with the same validated input resumes or returns the stored result without consuming capacity again; a different input is a conflict.
- Signal emission consumes one correlation unit per signal; recipient fan-out consumes no additional breadth units. Notification delivery consumes no breadth units but is still ledgered.

## Persistence Ownership

- `repository-source.ts` owns rule matching, schema/audience reads, and signal insertion.
- `repository-runs.ts` owns run, effect, and correlation-budget writes.
- `repository-history.ts` owns private run/signal history queries.
- `repository-notifications.ts` owns the shared notification-script lookup and catalog signal-schema reads.
- `repository.ts` composes these repository facets; callers should use `AutomationsRepository` rather than importing a facet directly.

Keep route handlers thin. Rule validation, access control, capability checks, signal audience semantics, and effect reservation belong in `service.ts`; repositories perform persistence and normalization only.
