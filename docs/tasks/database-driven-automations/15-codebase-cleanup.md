# Codebase Cleanup

**Parent Plan:** [Database-Driven Automations, Signals, and Subscriptions](./README.md)

**Type:** AFK

**Status:** done

## What to build

Review every file touched during this plan and remove anything that is no longer needed or was
introduced as scaffolding. Follow the `codebase-cleanup` skill, with special attention to
duplicate code, duplicate or alias-only types, dead code, unnecessary exports, shallow wrappers,
stale support artifacts, and speculative abstractions. The cleanup is scoped to touched files and
directly affected modules, not unrelated opportunistic refactors.

## Acceptance criteria

- [x] The task is executed using the `codebase-cleanup` skill
- [x] The cleanup pass covers all files touched by this plan and any directly affected modules
- [x] Any removals or simplifications are reflected in the changed code before the plan is
      considered complete

## Cleanup performed

The 220 files touched across tasks 1–14 were reviewed against the `codebase-cleanup` checklist and
every candidate removal was adversarially re-verified (grep for consumers across `apps/`, `libs/`,
`tests/`, the generated sandbox registry, layer wiring, and seed/slug data) before being applied.

### Dead code / superseded scaffolding

- `automations/service.ts`: removed `queueRun` (superseded by `prepareRun`, the live dispatch
  entry point — `queueRun` had no production caller) and `createUserRule` plus its
  `isVisibleReference` helper (generic user-rule creation is fully out of scope; the live path is
  catalog install via `NotificationSubscriptionsService` → `repository.insertRule`). Folded the
  now-single-use `QueueSubscriptionRunInput` into `PrepareSubscriptionRunInput`.
- `automations/service.test.ts`: dropped the `queueRun` id-format test and re-pointed the
  rule-deactivated branch test to `prepareRun` (identical live behavior); removed the
  `createUserRule` scope-matrix block and re-pointed the metadata-rejection tests to
  `ensureBuiltin` so `validateDefinition` coverage is preserved. Removed the orphaned
  `storedRuleFromInsert`/`InsertAutomationRuleInput` helpers.
- `media-monitoring/monitorable.ts`: removed `isMediaMonitoringAssociationTargetSchema` and its
  backing `mediaEntitySchemaSlugSet` — the only caller (`repository.getSnapshot`) was deleted in
  the task 14 notification cutover; association detection is now the sandbox script's job.
- `events/service.test.ts`: removed dead `entitiesRepository`/`eventSchemasRepository` mock
  overrides from the two create-path tests (the create path enqueues the workflow and never reads
  those scopes; the default mocks suffice).

### Duplicate code / types

- `automations`: consolidated the thrice-duplicated
  `Schema.Record({ key, value: AutomationRuleMetadata })` properties schema by exporting the
  existing `AutomationProperties` from `subscription-execution-workflow.ts` and reusing it in
  `lifecycle-dispatch.ts` and `signal-dispatch.ts` (dropping their now-unused
  `AutomationRuleMetadata` imports).
- `imports/media`: removed the `MediaImportWorkflowOptions` dual code path — `integrationId` was
  threaded both through `jobData` and a parallel `options` struct; `writeMediaEntityGroups` now
  reads it from `payload` like `populateMediaEntityGroups` does, and the redundant type + its
  `IntegrationId` import were deleted.

### Unnecessary exports / alias-only types

- Dropped `export` on module-local types with no external consumer:
  `AutomationScriptScope` (`automations/repository.ts`), `SignalDispatchValue`
  (`signals/dispatch.ts`), `AutomationPrincipal` (`signals/service.ts`).
- Deleted the rename-only alias `EnsureBuiltinAutomationRuleInput` (`automations/service.ts`);
  `ensureBuiltin` now takes `RuleDefinition` directly.

### Value-free / redundant tests

- `builtins/.../automations/notification.test.ts`: removed the assertion that compared a static
  manifest literal to a hardcoded copy of itself (capability allowlist is pinned by
  `registry.test.ts`).
- `tests/.../media-monitoring.test.ts`: removed two post-poll assertions that re-proved the exact
  condition the `pollUntil` predicate already guarantees (and dropped the now-unused binding).

### Stale docs / config

- `sandbox-runtime/README.md`: `triggers/` → `automations/`, "5 triggers" → "14 automations".
- `docs/effect-workflow-guide.md`: removed the non-existent `resolve-after-triggers` activity from
  the event-workflow description.
- `tests/AGENTS.md`: "Trigger and sandbox results" → "Automation and sandbox results".
- `libs/sandbox-sdk/tests/tsconfig.json`: removed the `include` entry for the deleted
  `trigger-types.ts`.

## Deliberately retained (judgment calls, verified in scope but kept)

- **`listRunsByOriginalRuleId`** (`automations` service + repository, its index, and its
  attribution test): unwired but intentional. The PRD defers run/signal history endpoints and
  states "the persisted rows support adding them later"; the purpose-built
  `subscription_run_original_rule_id_idx` and the "preserves attribution after rule deletion" test
  confirm the schema was shaped for it.
- **SDK snapshot type family** (`AutomationEntitySnapshot` / `AutomationRelationshipSnapshot` in
  `@ryot/sandbox-sdk/automation`): unused in-repo but exported to complete the public
  Entity/Event/Relationship/Signal family for external script authors, matching the two consumed
  siblings.
- **`registry.ts` `mediaUpdateEntitySchemaSlugs` dedup guard** and the module-local `decodeStored`
  helper duplication: kept per YAGNI / defensive-code and cross-module-scope considerations.

## Verification

- `bun turbo --filter=@ryot/app-backend check` — clean (0 warnings, 0 errors) across all packages.
- App-backend unit suite — 1166 tests passed.
- End-to-end suite (`tests/`) — green.
