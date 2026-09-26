# Ryot `ultra-rewrite` — executable cleanup and architecture implementation plan

**Baseline:** `ultra-rewrite` currently resolves to `0f8480aebb09ead60805e9dab063bda8e21c03ad`. Finding IDs below refer to the latest audit.

**Approved product decision:** Lifecycle persistence is **automation execution history**, not a complete mutation audit trail. Command replay and progress must remain correct without automation records. Tracked domain events, personal activity, and required-hook guarantees remain intact.

This is an implementation handoff. The repository has not been modified during this planning pass.

---

## 1. Scope and fixed decisions

Implement **F1–F12**, together with the concrete DRY opportunities from the audit. Treat the larger lifecycle change as a separate, final workstream rather than mixing it into the local cleanups.

The following decisions are fixed for implementation:

| Concern                       | Decision                                                                                                                                               |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Ordinary writes without hooks | Do not persist full automation request/change/batch snapshots merely to prove that a write occurred.                                                   |
| Replay and progress           | Use explicit mutation receipts and the existing workflow engine. Do not infer successful writes from automation history.                               |
| Domain activity               | Preserve normal `event` records and all domain behavior. They are not automation bookkeeping.                                                          |
| Plugin execution              | Keep one mechanism for system-owned and user-owned plugins. Selection may depend on declared hooks, capabilities, and scope—not first-party privilege. |
| Preferences                   | Keep the existing JSONB storage, establish one canonical schema, and apply partial updates atomically.                                                 |
| Preference authority          | PostgreSQL is authoritative. Authentication session copies must not become a second preference store.                                                  |
| Artifact identity             | Preserve existing valid artifact bytes, hash algorithms, and version constants. Consolidate their implementations.                                     |
| Compilers                     | Retain separate client and sandbox policies. Share parsing and generic compiler infrastructure where appropriate.                                      |
| SDK testing                   | Replace global bootstrap overrides with instance-owned dependencies.                                                                                   |
| Legacy migration              | Retain the explicitly designated V1 migration exception. Update it only where this work changes the current schema or shared contracts.                |
| Package structure             | Add no new workspace package. Use focused modules within existing owners.                                                                              |
| Compatibility                 | No old/new runtime switches, compatibility aliases, duplicate implementations, or migration adapters for disposable rewrite data.                      |

**Outside scope:** Publications, new fitness features, replacement of Better Auth or Effect, a new job queue, a universal mutation framework, and repository-wide module renaming.

---

## 2. Execution rules and baseline verification

Work on the current branch without resetting or overwriting unrelated work.

Before changing implementation, record:

```bash
git branch --show-current
git rev-parse HEAD
git status --short
```

A changed branch head is not permission to discard intervening changes. Reconcile the affected symbols with the current implementation.

Use repository-wide searches to enumerate consumers before moving or removing symbols. This is mechanical verification, not an invitation to reopen the design:

```bash
rg -n \
  'normalizeUserPreferences|CachedUserPreferences|updateUserPreferences|userFitnessLibraryRecipe' \
  kernel apps packages plugins e2e

rg -n \
  'setBootstrapRyotRuntimeFactory|createBootstrapRyotRuntime|createTestRyotClock' \
  kernel packages plugins e2e

rg -n \
  'clientArtifactMetadata|normalizePluginSource|normalizePluginPackage|outputReferenceIssue' \
  kernel apps packages plugins e2e

rg -n \
  'findLifecyclePayload|getCreateProgress|LifecyclePlan|planBatch|parentTriggerId' \
  kernel packages plugins e2e
```

Also inspect package exports, compiler dependency allowlists, manifests, and generated-entry construction. A normal import search alone does not prove that an exported entry is unused.

For each workstream, add the regression that demonstrates the problem before changing its implementation. **F5 specifically requires a compile-time reproducer.** When a claimed type hole cannot be reproduced with the pinned compiler, retain the regression coverage and record the finding as not reproduced rather than forcing an unnecessary redesign.

Do not upgrade dependencies to make this plan easier.

---

## 3. Workstream A — canonical and atomic preferences

**Addresses:** F1 and preference-related DRY.

### Files and ownership

Primary files:

- `packages/contract/src/auth-middleware.ts`
- `packages/contract/src/modules/user-settings/schemas.ts`
- `packages/ryotql-recipes/src/user-settings.ts`
- `kernel/backend/src/modules/user-settings/service.ts`
- `kernel/backend/src/modules/auth/service.ts`
- `kernel/backend/src/modules/auth/repository.ts`
- `kernel/backend/src/modules/auth/effect-postgres-adapter.ts`
- `kernel/backend/src/lib/infrastructure/db/schema/tables/auth.ts`

Also update preference consumers, backup/restore persistence, user creation fixtures, and the designated V1 migration.

The current update constructs a full preference object from `CurrentUser`, while the auth adapter later writes that object. The user table currently has a required JSONB column without a database default. Both facts must be addressed together.

### A1. Establish the canonical contract

Create `packages/contract/src/schema/user-preferences.ts` as the defining module.

It owns the complete stored schema, defaults, and preference-field schemas. The existing user-settings module owns the HTTP patch body, derived from those fields.

Use these semantics:

| Input                               | Meaning                                                                     |
| ----------------------------------- | --------------------------------------------------------------------------- |
| Omitted patch field                 | Leave the stored value unchanged.                                           |
| `false`                             | Store `false`; never interpret it as omission.                              |
| `language: null`                    | Clear the preference.                                                       |
| Empty or whitespace-only language   | Normalize to `null` at the write boundary.                                  |
| Nonempty language                   | Trim surrounding whitespace; preserve existing accepted language semantics. |
| Malformed boolean, array, or object | Reject.                                                                     |
| Unknown preference field            | Reject at the command boundary.                                             |
| Empty patch                         | Successful no-op.                                                           |

Stored preferences must already be canonical. Do not silently repair malformed stored JSON during reads.

Remove the handwritten `CachedUserPreferences` shape and derive the type from the canonical schema. Replace the `Schema.Unknown` preference selection in `userSettingsRecipe` with the canonical codec.

### A2. Separate preferences from authentication-session copies

Keep preferences as application data on the existing user row, not as authentication claims.

Remove their ownership from Better Auth’s additional-field input/output surface. Supply the database default for new users and ensure the auth adapter’s user projection does not accidentally keep exposing the application-only preference column through full-row selections.

`CurrentUser` must continue to receive canonical preferences from the authenticated database read. Existing Ryot responses that include preferences should continue doing so through that application-owned read.

Update any consumer that reads preferences from a Better Auth session object to use the existing application preference/current-user source.

This avoids introducing a second cache invalidation protocol. Better Auth’s current user-update implementation refreshes cached session user objects after its database update, so a second full-object write through that adapter is not an acceptable way to “refresh” an atomic preference patch.

Do not change authentication tokens, session lifetime, account linking, avatar updates, or credential handling.

### A3. Apply patches atomically

Add an auth-owned repository operation for patching preferences. It captures `DatabaseSession`; callers pass only the user ID and validated patch.

Use a single parameterized update equivalent to:

```sql
UPDATE "user"
SET
  preferences = preferences || $patch::jsonb,
  updated_at = CURRENT_TIMESTAMP
WHERE id = $user_id
RETURNING preferences;
```

A shallow merge is correct for the current flat preference object. PostgreSQL’s concurrent-update behavior operates on the updated row version after waiting for a competing updater, which is the property needed here. :chatgpt-content-reference{index="6"}

Decode the returned preferences using the canonical schema. Handle a missing user explicitly. Do not follow this operation with an adapter call that rewrites preferences.

Add the canonical database default and straightforward storage constraints for the existing fields. Update Drizzle typing from the generic record to the canonical preference type.

### Acceptance tests

Use separate database sessions and synchronization barriers, not sleeps:

- Concurrent patches to different fields preserve both changes.
- Concurrent patches to the same field produce a valid last-writer result without reverting other fields.
- `false`, `null`, omission, and blank-language normalization remain distinct.
- Invalid input is rejected; malformed persisted JSON is reported rather than repaired.
- Local registration, OIDC registration, administrator creation, and historical restore produce complete preferences.
- Warm authentication sessions do not cause subsequent application requests to see old preferences.
- Raw authentication endpoints cannot bypass the preference command contract.
- Empty patches do not change the row unnecessarily.

---

## 4. Workstream B — owned password-reset capture

**Addresses:** F2.

**Primary file:** `kernel/backend/src/modules/auth/service.ts`.

Extract a small auth-local helper only when necessary to make orchestration testable. Do not create a general callback-to-Effect framework.

### B1. Replace detached orchestration

The reset operation must own, in one scope:

1. The pending-request reservation.
2. The Redis subscriber and message listener.
3. Subscription readiness.
4. Reset initiation.
5. The response wait and timeout.
6. Cleanup.

Subscribe successfully before initiating the reset. Use an Effect-owned child fiber only where concurrent waiting is required; retain and interrupt it through the parent scope.

Remove the detached `runForkWith` launch and the `Effect.ignore` that currently turns initiation failures into apparent capture timeouts.

Keep the current bounded wait and Redis coordination semantics unless a regression requires a narrower correction.

### B2. Bind correlation to the originating request

A late, non-cancellable native Promise must not deliver its reset token to a newer request for the same email.

Carry the capture correlation ID through the originating internal auth request. A concrete implementation is an internal `Request` passed to `auth.handler`, with an `x-ryot-reset-capture-id` header. The reset callback must use that originating ID and verify that it still matches the email’s pending reservation.

Do not obtain a fresh correlation ID by looking up only the email when the callback eventually runs. Do not introduce module-global or AsyncLocalStorage-based capture state.

A request supplied from outside is not trusted merely because it contains this header: delivery requires the matching, cryptographically random server reservation.

Keep the existing `withoutAsyncContext` protection around calls into Better Auth.

### B3. Preserve failure distinctions

Distinguish reservation conflict, subscription failure, reset initiation failure, and capture timeout internally. Map them to appropriate existing public errors where possible.

Never log reset tokens, reset URLs, or correlation-bearing request headers.

Interrupting the Effect does not necessarily cancel the underlying Better Auth Promise. Cleanup must therefore make late completion harmless rather than claim that the native operation was cancelled.

### Acceptance tests

Cover success, immediate initiation failure, subscription failure, timeout, interruption, late completion, overlapping requests for one email, and independent requests for different emails.

Assert that listeners and subscribers are released and that cleanup deletes only the reservation owned by that invocation.

---

## 5. Workstream C — artifact invariants and compiler reference inspection

**Addresses:** F4 and F8.

### Files

- `packages/client-plugin-contract/src/index.ts`
- `packages/plugin-archive/src/index.ts`
- `packages/client-plugin-compiler/src/artifact.ts`
- `packages/client-plugin-compiler/src/artifact.test.ts`
- `packages/client-plugin-compiler/src/module.ts`
- `packages/vite-compiler/src/deno.ts`
- `kernel/backend/src/modules/plugins/pipeline.ts`
- `apps/server/assembly/assemble.ts`

### C1. Give artifact identity one implementation

Move the artifact model and identity implementation into a focused defining module within `client-plugin-contract`. Preserve its meaningful package entry-point exports.

Make the backend pipeline and server assembly call the same `clientArtifactMetadata` implementation. Remove the backend’s independent reconstruction of sorted file identities and metadata hashes.

Delete the private compiler `artifact.ts` forwarding module. Move or merge its identity tests with the defining implementation.

Do not update golden hashes merely because the implementation moved. The existing shared helper and the duplicated backend algorithm identify the exact consolidation target.

### C2. Establish one executable-text byte policy

For compiled JavaScript, preserve valid UTF-8 text exactly, including a leading byte-order mark.

Use fatal decoding with BOM preservation consistently. `ignoreBOM: true` preserves the mark in decoded output despite the counterintuitive name. :chatgpt-content-reference{index="10"}

Reject invalid UTF-8 and strings that cannot round-trip without replacement. Do not normalize newlines or Unicode composition, strip a BOM, or rewrite valid executable bytes.

Keep this policy separate from JSON-manifest parsing and authored-source behavior. Do not alter those formats accidentally while fixing compiled JavaScript.

Archive/container validation remains in `plugin-archive`; installation, ownership, and catalog policy remain in backend ingestion. Shared invariant implementations may be invoked at more than one genuine trust boundary.

### C3. Replace JavaScript regex inspection

Add shared JavaScript reference extraction to the existing compiler infrastructure using the parser already used by the Deno audit.

Extract actual syntax:

- Static imports and re-exports.
- Literal dynamic imports.
- Relevant `new URL(..., import.meta.url)` asset references.
- Nonliteral dynamic-import expressions where the caller’s policy needs to evaluate them.

Keep client and Deno allowlists and acceptance policies separate. Do not broaden the Deno policy to match the client policy or vice versa.

For CSS, use the existing PostCSS/value-parser dependencies to inspect actual declarations and import references. Do not replace one regex grammar with a larger one.

The current Deno audit already demonstrates the parser-based implementation direction.

### Acceptance tests

Preserve golden artifact identity, order independence, content-type participation, exact bytes, duplicate-file rejection, and size/path restrictions.

Add end-to-end compiler regressions for import-like text inside strings, comments, and template literals; real missing references; static and dynamic imports; and emitted CSS references.

Add an archive-to-ingestion regression for BOM-prefixed compiled JavaScript. A decoder-only test is insufficient.

---

## 6. Workstream D — recipe contracts, fitness ownership, and meaningful query tests

**Addresses:** F5, F10, F12.

### D1. Constrain `defineRecipe`

**Primary file:** `packages/ryotql/src/index.ts`.

Create compile-time regression coverage included by the package’s normal TypeScript check.

Test that:

- An unmapped recipe infers the query-result object.
- A mapped recipe infers the mapper’s success type.
- An unmapped recipe cannot claim an unrelated success type.
- Input-tuple inference and existing consumer inference remain intact.

When the type hole is reproduced, replace the unconstrained optional-mapper design with two forms: unmapped and mapped. An unrelated result type requires a mapper that constructs it.

Remove the `decoded as Success` escape made unnecessary by this distinction. Do not redesign the complete RyotQL type system or error model.

The relevant coupling is the independently generic `Success` together with optional `map`, not the mere existence of generic helper types.

### D2. Move fitness recipes to their domain owner

Create or populate:

- `plugins/fitness/shared/query-recipes.ts`
- `plugins/fitness/shared/entity-selections.ts`
- `plugins/fitness/shared/library-recipes.ts`

Move `userFitnessLibraryRecipe` out of `packages/ryotql-recipes`. Move the environment-neutral fitness recipes from `host/query-recipes.ts` to the shared owner.

Make the archived client presentation recipe reuse genuinely common selections where its projection overlaps. Preserve distinct list, detail, and presentation results; do not turn them into one oversized query.

Use only the allowed neutral shared-source imports. Add a narrowly necessary neutral export when required rather than allowing shared code to import arbitrary host contracts.

Update the fitness package export to point directly at the defining shared file. Delete obsolete forwarding files. Update all actual consumers, including tests and archived-source compiler resolution.

Media and fitness should share the **placement mechanism**, not a universal domain renderer.

### D3. Repair query assertions

Move the automation-history assertions out of `phase-five.test.ts` into behavior-owned tests.

Replace placeholder predicate assertions with checks for the actual table/column identity, operator, supplied value, and omitted-filter behavior. Add a small real-query integration test covering filters whose correctness cannot be established by document inspection alone.

Preserve useful result-projection and pagination tests. Replace the permissive old-preference test with the canonical behavior from Workstream A.

### Acceptance tests

All named recipe outputs and pagination behavior remain unchanged except the explicitly corrected preference contract.

Fitness archive compilation must succeed without imports into `host/`, and no generic application package should retain the fitness-library slug solely to implement that recipe.

---

## 7. Workstream E — instance-owned SDK bootstrap and one bridge-outcome boundary

**Addresses:** F7 and F9.

### E1. Remove the global bootstrap override

Primary files:

- `packages/client-sdk/src/schedule.ts`
- `packages/client-sdk/src/testing.ts`
- `packages/client-sdk/src/plugin.tsx`
- Bootstrap consumers and generated runtime entry construction.

Replace `bootstrapRuntimeFactory` and `setBootstrapRyotRuntimeFactory` with an instance-owned bootstrap implementation.

Production entry points supply the production runtime factory. Test harnesses construct the same implementation with their own runtime factory and schedule. Dependencies are provided at construction, not through a global setter.

The owner that constructs the runtime must dispose it exactly once. A bootstrap using an externally owned schedule must not dispose the schedule’s parent harness.

Keep React’s per-screen contexts separate from shared application services.

**Required regression:** Construct harness A and harness B simultaneously. Bootstrap a page through each. Advance only A’s clock and verify that B does not advance. Dispose A, then bootstrap another page through B and verify that B still uses its own clock.

Also cover disposal during pending work, independent navigation state, and cleanup after failed bootstrap. The current global setter/reset arrangement is the exact behavior being removed.

### E2. Normalize host outcomes once

Primary files:

- `kernel/client/src/modules/plugins/bridge.ts`
- `kernel/client/src/modules/plugins/operations.ts`
- `kernel/client/src/modules/plugins/storage.ts`
- Other actual capability producers.

Use this boundary:

**External input → producer-specific normalization → typed host outcome → bridge wire validation/encoding.**

Producer services classify expected failures. Bridge handlers add request identity and message type. One bridge-owned outgoing validation path handles malformed producer output consistently.

Remove per-handler repair branches made redundant by that boundary. Do not remove inbound iframe message validation.

Unexpected defects should produce a safe protocol failure and an internal diagnostic. Interruption and stale-document cancellation should not be logged as application defects or turned into late replies.

Preserve each capability’s current public error vocabulary unless a malformed-result case requires an explicit, consistent correction.

### Acceptance tests

Exercise every capability’s success, expected failure, malformed result, unexpected defect, and cancellation behavior.

Retain handshake, request-count limits, duplicate-request handling, document switching, stale completion suppression, and disposal tests. No credential, internal stack, or arbitrary exception text may cross the bridge.

---

## 8. Workstream F — local ownership cleanup and narrower enforcement

**Addresses:** F6, F11, event-reader duplication, and positional schema composition.

### F1. Give the planner one construction owner

Remove collaborator provision from the inner `LifecyclePlannerLive` implementation. Supply its resolver and repositories once in the automations feature composition.

Preserve the actual constructor requirements and shared resource instances. Test replacement of the planner resolver at that construction boundary.

Do not introduce more `ProvidedLive` wrappers to preserve the old graph shape. The current overlap is visible between the planner implementation and the automations Layer.

### F2. Consolidate the event snapshot reader

In `modules/events/repository.ts`, implement one private locked snapshot reader returning the snapshot and schema provenance.

Let `getEventSnapshot` and `getEventCreateReplay` project different results when useful. Preserve user filtering, row locking, missing-row behavior, and `eventSchemaPluginId`.

Do not generalize this into a reusable repository framework.

### F3. Replace ordinal schema dependencies

Export named entity request variants or a named entity-request union from the defining lifecycle contract. Compose the broader automation union from those named groups.

Replace `.members[0]`, `.members[1]`, and similar accesses in affected lifecycle code when they encode domain identity by ordinal position. Do not replace them with manually duplicated schemas.

### F4. Narrow lint enforcement

Remove the import-path heuristic behind `no-app-service-provide`. Retain the ownership convention and existing reliable Effect diagnostics.

Keep the prohibition on application-owned Promise chains as an engineering rule. Narrow automated detection to receivers/producers the implementation can identify reliably, with lexical binding resolution for aliases and shadowing. Unknown receivers should not be presented as proven Promises.

Replace the property-name-only `.toLayer` restriction with recognition of the intended workflow API where practical. Do not ban unrelated methods bearing the same name.

Add fixtures for imported aliases, namespace imports, shadowed identifiers, literal computed access, unrelated methods, and the recognized Effect exceptions.

Do not add a compiler integration or large service registry merely to preserve these heuristics.

---

## 9. Workstream G — separate command correctness from automation history

**Addresses:** F3. Begin after the preceding workstreams are integrated.

This is the structural cutover. It must not be reduced to adding `if (runs.length === 0) return`.

The existing event workflow explicitly treats a committed event without a persisted lifecycle plan as corruption. The workflow helpers also serialize full `LifecyclePlan` objects, and batch construction derives evidence from those plans. Those dependencies must be replaced, not bypassed.

### G1. Establish the responsibility split

Use four owners:

| Responsibility                                        | Owner                                                        |
| ----------------------------------------------------- | ------------------------------------------------------------ |
| Mutation validation, identity, and source writes      | Existing entity/event/relationship services and repositories |
| Atomic proof of a completed mutation step             | New small mutation-receipt persistence module                |
| Workflow scheduling, suspension, and replay           | Existing workflow engine                                     |
| Policies, matching after-hooks, delivery, and history | Existing automation modules                                  |

Create `kernel/backend/src/modules/mutations/receipts.ts` and its tests. Add a focused schema file under the existing database table directory.

This module is a persistence primitive. It must not execute commands, discover plugins, start workflows, or maintain its own worker.

### G2. Add atomic mutation receipts

Add one `mutation_receipt` table.

Its logical fields are:

| Field                                    | Purpose                                              |
| ---------------------------------------- | ---------------------------------------------------- |
| Receipt ID                               | Deterministic identity of the completed step         |
| Execution ID and root execution ID       | Existing execution ownership and grouping            |
| Trusted owner user ID and mutation scope | Authorization, deletion, and user/global distinction |
| Command kind and item identity           | Stable identity of the requested operation           |
| Input fingerprint                        | Detect reuse of one identity with different input    |
| Typed command result, encoded as JSONB   | Replay the committed result                          |
| Ordered dispatch references              | Refer only to actual persisted automation work       |
| Recorded timestamp                       | Operational bookkeeping                              |

Add indexes for execution-scoped progress and owner-scoped cleanup.

The identity must use the **requested command kind**, not an outcome discovered later. An upsert must not acquire a different identity depending on whether it ultimately inserted or updated.

Fingerprint canonical command inputs: trusted scope, target identity, relevant options, and timestamps bound once by the command owner. Do not include regenerated trace data or newly sampled retry timestamps.

The source mutation, receipt, and matching after-hook records must commit in the same transaction.

### G3. Define exact replay behavior

Under the existing transaction and locking primitives:

1. Look for an existing receipt.
2. When its fingerprint matches, return its recorded result and actual dispatch references.
3. When its fingerprint differs, fail with the owning module’s structured command-identity conflict.
4. When absent, validate and perform the mutation, then insert the receipt before commit.

Serialize concurrent attempts for the same receipt identity. Keep lock ordering deterministic and reconcile it with existing catalog, provider-identity, entity-reference, and relationship locks.

A replay must never:

- Reapply an update against newer state.
- Recreate a subsequently deleted entity.
- Convert a previous no-op into a mutation.
- Recompute hook membership from the current catalog.
- Manufacture a missing automation trigger.
- Count the same event twice.

Store only replay-required command results. Do not copy the input draft and full before/after snapshots into every receipt.

An existing public command that returns an entity may require its returned entity snapshot for exact replay. That is command-result data, not permission to retain a universal mutation audit. Remove internal before/after result plumbing where its only consumer was lifecycle construction; construct matching hook evidence within the owning write path.

### G4. Make absence of hooks an explicit result

Change lifecycle planning to distinguish an empty decision from persisted automation work.

Use a small discriminated result, such as `NoHooks` versus `Planned`, rather than manufacturing an `AutomationTrigger` that appears persisted.

For an ordinary no-policy/no-after-hook mutation:

- Resolve relevant catalog state under the appropriate existing catalog coordination.
- Validate and write in one mutation transaction.
- Record the mutation receipt.
- Return no automation dispatch references.
- Persist no request, item-change, or batch automation snapshots.

The empty dispatch set in a committed receipt is authoritative. A later plugin installation must not attach new hooks when the original command replays.

Do not skip tenant checks, schema validation, provenance validation, or mutation locking just because hook selection is empty.

### G5. Preserve policy semantics

When before-policies match:

- Persist their request evidence and pinned execution plan before running them.
- Execute policies outside the database transaction.
- Preserve policy order, accepted transformations, rejection behavior, and once-per-subject rules.
- Revalidate the accepted draft and schema ownership before commit.
- Detect concurrent source changes.
- Commit the source mutation, receipt, and actual after-hook work atomically.

Policy infrastructure failure or rejection must not create the source mutation. Preserve the current distinction between a new submitted command and replay of an existing policy attempt.

Do not hold a transaction across sandbox execution, waits, HTTP calls, or workflow suspension.

### G6. Handle batch hooks without relying on item-hook persistence

A batch hook can need evidence from items that have no item-frequency hook. Therefore, batch construction must consume **committed change evidence**, not only persisted item-hook plans.

Use the existing workflow owner plus receipt persistence for these deterministic steps:

**Batch decision.** Before the first write in a logical batch, capture the applicable batch-hook candidates, their revision/configuration identities, and the relevant chunk limits. Record this decision, including an empty decision, so replay does not adopt a newer catalog.

Selection must consider the batch’s possible create/update/delete outcomes. Do not perform later-item validation in a way that changes existing partial-success behavior.

**Conditional evidence capture.** When a batch has applicable candidates, retain the committed change evidence required to construct its batches. Write that evidence atomically with each affected source mutation. Attach it to the receipt-owned batch bookkeeping; do not create a second queue or use Redis as the sole durable copy.

A batch with no applicable candidates retains no full batch evidence.

**Batch sealing.** After the logical batch finishes—or terminates with an already committed prefix—build its deterministic chunks, create the actual batch triggers/runs, and record finalization atomically. Release the temporary evidence after the immutable batch trigger payload owns it.

The existing chunker observes both item-count and byte limits. Preserve those semantics and replay-stable boundaries. A batch hook continues receiving all changed items in its applicable scope/resource chunk, not merely the subset matching one target.

Distinguish interruption from terminal cancellation. Process interruption leaves the durable owner resumable; it must not prematurely seal an incomplete batch. Explicit cancellation must finalize the committed prefix according to the existing operation’s cancellation behavior.

Batch preparation/finalization are completed deterministic steps, not a new execution engine. Their pinned revisions must remain referenced until sealing or terminal cleanup.

### G7. Preserve causation without dummy ancestors

When no policy request trigger exists, do not create one merely to populate `parentTriggerId`.

Preserve the trusted command/execution identity independently. `parentTriggerId` should reference an actual retained trigger or remain absent/null according to the contract.

Keep root execution identity, initiator, depth, import/integration provenance, and nearest real automation parent intact. Recursion and run-budget accounting must not depend on the existence of no-hook ancestor rows.

Apply root-budget coordination when actual automation work is being admitted. Do not reserve an exclusive automation budget lock for a write that has no automation work.

### G8. Move event progress to receipts

Replace `EventsRepository.getCreateProgress`’s written-count calculation with receipt-based progress.

For event creation:

- Count unique successful event-item receipts.
- Do not count no-ops, policy skips, batch-decision receipts, or batch-finalization receipts as written events.
- Keep the existing operation ID ownership checks.
- Keep the workflow engine authoritative for running/completed/failed workflow state.
- Determine required-follow-up state from the actual dispatch references belonging to the command, including batch hooks.

It remains correct to consult automation runs to determine whether required automation has finished. It is no longer correct to count automation triggers to determine whether domain events were written.

Preserve existing HTTP operation-state shapes and bounded waiting behavior in this workstream. Polling transport redesign is not necessary to deliver the approved separation.

### G9. Preserve durable after-hook delivery

Continue using existing queued automation runs and reconciliation to recover committed-but-not-dispatched work.

A crash after the source transaction commits but before dispatch must not lose the hook. A replay must dispatch the existing pinned work, not create replacement runs.

Preserve required-hook warnings and the rule that an after-hook failure does not roll back committed source data.

When an actual matching automation is blocked by configured limits, retain the minimal execution diagnostic needed to explain that outcome. Do not generate blocked-history records for writes that had no matching automation.

### G10. Cut over every affected mutation path

Update these areas in the same structural workstream:

- `modules/entities/service.ts` and `mutation-persistence.ts`
- `modules/relationships/service.ts`, `mutation-pipeline.ts`, and prepared/reconciliation helpers
- `modules/events/service.ts`, `event-create-workflow-live.ts`, and `event-policy-engine.ts`
- `lib/domain/lifecycle.ts`, `lifecycle-command.ts`, and `lifecycle-batch.ts`
- `lib/infrastructure/lifecycle-workflow-step.ts`
- Automation planning, retention, reconciliation, and script/revision reference tracking
- Provider population, imports, collections, user bootstrap, and sandbox host functions consuming these results

Change durable activity result schemas so the no-hook route no longer journals a full empty `LifecyclePlan` containing snapshots.

Retain complete evidence only where a policy, item hook, or batch hook actually requires it.

No temporary old/new route selector may remain after integration.

### G11. Define retention and historical-data behavior

Automation-history retention must not delete replay correctness.

Keep receipts while their owning execution can still replay. Do not introduce an independent TTL that treats an expired receipt as permission to execute the write again.

For this pass, do not add autonomous receipt garbage collection without an authoritative execution-retirement signal. Existing explicit owner retirement or account deletion may remove receipts only after the corresponding durable work can no longer resume. Document this storage tradeoff.

Batch evidence is different: release it after durable batch sealing, and protect it from history pruning while sealing remains possible.

Exclude mutation receipts and pending execution bookkeeping from portable user backups. Historical restore and the V1 importer must not reconstruct current automation runs or replay receipts from old domain data.

Disposable pre-cutover rewrite databases and queued workflow state do not need a compatibility migration. Preserve the designated V1 import capability against the new target schema.

### Structural acceptance matrix

| Scenario                                             | Required result                                                                          |
| ---------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| No hooks                                             | Domain write and receipt exist; no full automation request/change/batch snapshots exist. |
| Only before-policy                                   | Policy history exists; no invented after-hook history.                                   |
| Only item after-hook                                 | Source, receipt, and pinned delivery records commit together.                            |
| Only batch after-hook                                | Complete batch evidence survives restart; no dependence on item-hook runs.               |
| Mixed-schema batch                                   | Existing scope and full-chunk semantics remain intact.                                   |
| Same identity, same input                            | Recorded result; no repeated write or new hooks.                                         |
| Same identity, different input                       | Structured conflict before another write.                                                |
| Replay after entity update/deletion                  | No stale write or resurrection.                                                          |
| Crash before commit                                  | Neither source mutation nor receipt is committed.                                        |
| Crash after commit, before activity journal/dispatch | Receipt recovers the result; existing hooks remain deliverable.                          |
| Plugin revision changes during execution             | Pinned decisions remain stable; new commands may use the new revision.                   |
| Partial event failure                                | Earlier committed items remain; counts and batch finalization are correct.               |
| Automation-history pruning                           | Write replay and progress remain correct.                                                |
| User deletion                                        | Existing lifecycle cancellation prevents later replay from recreating user data.         |

---

## 10. Documentation and guidance updates

Update documentation alongside the corresponding implementation, not as a final cosmetic sweep.

At minimum:

- Root `AGENTS.md`.
- Backend `AGENTS.md`.
- Automation/lifecycle documentation and plugin authoring documentation.
- Client SDK `AGENTS.md` and README.
- Compiler/artifact ownership documentation.
- Fitness recipe ownership documentation.
- E2E documentation for newly added targeted regressions.
- V1 migration documentation only where target-schema behavior changes.

Replace the unconditional “every write persists item and batch triggers” guidance with the approved contract: command correctness is independent; automation evidence exists for participating execution.

Explicitly allow type-level tests of Ryot-owned generic contracts. Do not describe those as testing TypeScript itself.

Document invariants and ownership, not implementation history, audit IDs, or completed-task narratives.

---

## 11. Verification commands and implementation gates

### Package and unit verification

Run the affected package checks and tests after each workstream. At integration completion:

```bash
bun run check
bun turbo --filter='!@ryot-app/e2e' --output-logs=full test
git diff --check
```

Review formatter/linter output for unrelated changes. Do not bundle those into this work.

### Targeted integration verification

Extend existing behavior-owned E2E files where possible. Add these focused files only when no existing file owns the regression:

- `e2e/src/api/kernel/user-preferences-concurrency.test.ts`
- `e2e/src/api/kernel/mutation-command-replay.test.ts`

Run each affected E2E file separately using the repository’s documented invocation:

```bash
bun turbo --filter=@ryot-app/e2e test --only -- \
  'src/api/kernel/user-preferences-concurrency.test.ts'

bun turbo --filter=@ryot-app/e2e test --only -- \
  'src/api/kernel/mutation-command-replay.test.ts'
```

The E2E harness builds artifacts and provisions its backing services; use its existing fixtures and ownership conventions. Do not add production endpoints solely to inspect receipts. Database-level receipt assertions belong in backend integration tests.

For the structural cutover, run the existing population gates independently:

```bash
RUN_OPERATIONAL_GATES=1 bun turbo --filter=@ryot-app/e2e test --only -- \
  'src/api/plugins/media/imports/media-population-operational-gate.test.ts'

RUN_OPERATIONAL_GATES=1 bun turbo --filter=@ryot-app/e2e test --only -- \
  'src/api/plugins/media/imports/media-population-overlap-gate.test.ts'
```

Do not run the entire E2E suite or substitute live-provider tests for deterministic regressions.

### Measure the structural result

Compare the baseline and final implementation with the same deterministic fixtures and configuration:

- Single no-hook mutation.
- Batch of no-hook event creates.
- Item-hook mutation.
- Batch-only-hook mutation.
- Overlapping provider population.

Record source-operation transaction counts, SQL work, automation row counts, retained payload bytes, receipt bytes, and end-to-end latency.

**Structural requirements are mandatory; an invented speedup target is not.** The no-hook route must remove unnecessary lifecycle snapshots and planning transactions. Report the measured latency result even when another subsystem dominates it.

Do not raise timeouts, pool sizes, concurrency, or resource limits to conceal regressions.

---

## 12. Implementation sequence and completion criteria

Use this order:

1. **Workstreams A and B:** preference correctness and reset ownership.
2. **Workstreams C and D:** artifact/codec ownership, compiler inspection, recipes, and query tests.
3. **Workstreams E and F:** SDK ownership, bridge outcomes, Layer cleanup, and enforcement.
4. **Workstream G:** the complete command/automation cutover.
5. **Integration verification, documentation review, and deletion sweep.**

A and B share auth files; C and D may share contract exports and compiler allowlists. Coordinate those edits rather than assigning overlapping ownership blindly. One implementer should own Workstream G’s transaction and replay invariants.

The final implementation report must identify:

- Each finding addressed, or disproved by a concrete regression check.
- Removed aliases, duplicate algorithms, global overrides, and obsolete lifecycle dependencies.
- Schema and command-contract changes.
- Commands actually run and their results.
- Measured before/after structural and performance data.
- Any failed or unavailable validation.

Completion requires no remaining dependence on automation-history rows as proof that a domain write committed, no no-hook lifecycle snapshot persistence, no old/new compatibility path, and no weakened plugin or authentication boundary.
