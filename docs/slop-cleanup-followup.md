# Fresh-agent implementation handoff: Ryot DRY consolidation

## 1. Objective and baseline

Implement every remaining opportunity in the updated DRY report. This is a consolidation task against the current implementation, not a repeat of the earlier lifecycle cutover.

**Verified remote preflight baseline (2026-10-01)**

- Branch: `slop-cleanup`
- HEAD: `33471355e5cca7b95ac5fb2eba439162aef8d66c` (`chore: [slop cleanup] add followup plan`). This adds only this handoff after the implementation at `b71ba8a1c8`.
- Worktree was clean before preflight. The completed preflight repairs are listed in section 3; workstreams A–H have not started.
- Acceptance checkout: `/root/ryot-preflight` on the user-provisioned `root@89.167.108.138`, detached at the same HEAD with the local modified/new files overlaid and SHA-256 verified.
- Current Drizzle baseline: `kernel/backend/src/drizzle/20260930060306_exotic_xorn/`

The preceding commits already implemented:

- Canonical atomic preferences and owned reset capture.
- Shared artifact identity and parser-based executable reference inspection.
- Instance-owned client bootstrap and centralized bridge outcomes.
- Mutation receipts, pinned batch decisions, receipt-based progress, account-generation admission, and workflow retirement before reset.
- Fitness recipe ownership and mapped/unmapped recipe contracts.

**Do not reimplement those systems.** Consolidate their remaining duplication.

When resuming, record:

```bash
git branch --show-current
git rev-parse HEAD
git status --short
```

If HEAD has moved, reconcile this plan with the current code. Do not reset or overwrite intervening work.

Read root and affected child `AGENTS.md` files. `docs/slop-cleanup.md` is historical context for the earlier implementation; this handoff defines the new task.

## 2. Approved decisions and fixed boundaries

### Approved

- Ryot is greenfield. Substantial refactors are acceptable.
- Remove obsolete internal APIs, result fields, and files directly.
- No compatibility aliases, old/new selectors, or fallback decoders.
- Simplify `EntitySaveResult`, `EntityMutationOutcome`, and prepared-mutation APIs where their consumers permit it.

### Preserve

- HTTP, plugin, bridge, query-result, and archive behavior.
- Valid artifact bytes, golden identities, hash algorithms, and version constants.
- Command IDs, fingerprint inputs, timestamps bound by command owners, and causation.
- Exact replay, including no-ops, replay after deletion, and original dispatch references.
- Atomic source mutation, receipt, and matching after-hook persistence.
- Pinned batch decisions, conditional evidence capture, sealing, and pin release.
- Policy order, accepted transformations, rejection behavior, and once-per-subject rules.
- Account-generation checks on replay and writes; retirement before receipt deletion.
- Cancellation versus suspension semantics.
- Existing timeouts, pool sizes, concurrency, and resource limits.

### Architecture boundaries

- No new workspace package, worker, queue, or universal mutation framework.
- `MutationReceipts` remains a persistence/admission primitive.
- Concrete domain workflows must not become dependencies of that primitive.
- Feature Layers own their composition; boot code assembles application-wide dependencies.
- Imports come from defining modules. Retain only documented package entry points/barrels.
- Do not add type-checker bypasses or lint suppressions without asking.

No SQL schema change is expected. Internal JSON result-codec changes do not by themselves require a new table or migration. If a schema change becomes necessary, explain why and ask before proceeding.

## 3. Preflight and baseline evidence

### Status

**Preflight passes on the provisioned Linux server.** The final post-cleanup operational gate completed all 2,002 items and passed every projection, concurrency, sandbox-execution, and zero-lock-wait/deadlock assertion within its unchanged 900,000 ms deadline. The overlap gate, five affected standard E2E files, repository checks, and full non-E2E command also pass. All selected E2E tests executed; none were skipped.

The earlier macOS/Docker capacity failures are not the acceptance environment for this handoff. No claim is made that the final version passes that local environment. Do not repeat passing gates on unchanged code; rerun affected validation after implementation changes.

### Environment

| Setting                                | Verified remote value                                                                              |
| -------------------------------------- | -------------------------------------------------------------------------------------------------- |
| Platform                               | Ubuntu 26.04.1 LTS, Linux x86_64                                                                   |
| Host / Docker capacity                 | 8 CPUs; host memory 15,977,660 KiB; Docker memory 16,361,123,840 bytes                             |
| Bun / Vitest / Deno / Node             | 1.4.2 / 4.1.9 / 2.8.1 / 22.22.1                                                                    |
| Docker server                          | 29.8.2, native Unix socket                                                                         |
| E2E services                           | PostgreSQL `18-alpine`, Redis `alpine`, RustFS; fresh Testcontainers infrastructure per invocation |
| Vitest                                 | `maxWorkers=6`, `isolate=false`, ordinary test/hook timeout 180,000 ms                             |
| Backend                                | `NODE_ENV=test`, `TZ=Etc/GMT`, `SERVER_LOG_LEVEL=all`, notifications enabled                       |
| API pool / PostgreSQL connection limit | 100 / 400                                                                                          |
| Sandbox                                | Worker concurrency 5, default on-demand process mode, unchanged process isolation and heap limit   |
| Operational gate                       | Two concurrent 1,001-item imports; 900,000 ms internal deadline; 930,000 ms test timeout           |
| Opt-in                                 | `RUN_OPERATIONAL_GATES=1`                                                                          |

Provisioning and detached-run helpers were adapted from the scripts removed by `351b4292a309d12c612fe4f4108547858faacac5`, using their contents from that commit's parent. The checkout contains the actual local worktree, including the Effect patch and new tests. `bun install --frozen-lockfile` succeeded. Local `.env` secrets, Docker socket overrides, dependency directories, and diagnostic caches were not copied. Whole-suite/stress scenarios and old debug patches were not restored.

Provisioning evidence: `/root/ryot-preflight-logs/{metadata.json,provision.log,overlay-checksums.json}`; the final synchronized worktree hashes are in `final-source-checksums.json`. The same directory contains `driver.sh`, which accepts only targeted `operational`, `overlap`, `check`, and non-E2E `unit` scenarios. Its shell exports the Bun path; population gates invoke Vitest directly to avoid cached or skipped opt-in runs.

### Final gate commands and results

These commands ran separately from `/root/ryot-preflight/e2e`:

```bash
RUN_OPERATIONAL_GATES=1 bun --bun run vitest run \
  src/api/plugins/media/imports/media-population-overlap-gate.test.ts
```

```bash
RUN_OPERATIONAL_GATES=1 bun --bun run vitest run \
  src/api/plugins/media/imports/media-population-operational-gate.test.ts
```

| Gate, final production version | Executed / skipped | Test duration | Vitest duration | Result                                                              |
| ------------------------------ | ------------------ | ------------- | --------------- | ------------------------------------------------------------------- |
| Operational                    | 1 / 0              | 818.87 s      | 853.63 s        | Passed; all 2,002 results completed and every gate assertion passed |
| Overlap                        | 1 / 0              | 70.38 s       | 91.22 s         | Passed; 5/20-import overlap cases completed without new deadlocks   |

No item count, assertion, gate budget, pool size, worker concurrency, or process mode was changed. An earlier remote run of the pre-cleanup version also passed: operational 821.62 s and overlap 72.41 s. These durations are acceptance observations, not a controlled before/after speedup claim.

Final retained logs:

| Gate        | Runner log under `/root/ryot-preflight-logs/` | API log                                     | PostgreSQL log                      |
| ----------- | --------------------------------------------- | ------------------------------------------- | ----------------------------------- |
| Operational | `20261001T102232Z-operational-175553.log`     | `/tmp/ryot-e2e-api-1790850180517-41111.log` | `/tmp/ryot-e2e-postgres-175576.log` |
| Overlap     | `20261001T103703Z-overlap-328640.log`         | `/tmp/ryot-e2e-api-1790851037486-34889.log` | `/tmp/ryot-e2e-postgres-328648.log` |

Runner summaries and exit-code files are adjacent to these logs. Matching API `.stdout`, `.stderr`, and rotated `.log.gz` files are retained under `/tmp` on the server.

### Completed preflight repairs to preserve

1. `modules/test-support/operational-gate-service.ts` reads canonical Redis journal keys instead of scanning the keyspace per execution; it retains projection counts, missing/corrupt entry checks, and high-water validation. Failed workflow results are logged through the existing typed test-support surface.
2. `e2e/src/support/provisioning.ts` bounds graceful API shutdown to 20 seconds, then kills and reaps only the tracked child. Regressions cover graceful exit, an ignoring child, and preservation of an unrelated child. This changes teardown, not the gate budget.
3. `modules/sandbox/sandbox-script-workflow.ts` records successfully returned JSON request results in existing durable deferreds. Replay validates index, kind, name, argument identity, pinned target, and the complete current envelope before reuse. Dispatch retains the original `WorkflowInstance`; interruptions remain unsettled, journal order/limits and account admission remain intact. Partial-batch, crash, delayed-visibility, divergence, cancellation, retirement, and SQL-backed recovery tests cover the boundary.
4. Replay bootstrap uses the existing stdin/stdout control channel and the same authenticated bridge handler, expiry, capabilities, arguments, and shared budgets. Trusted dependency payload builds omit source maps; authored script maps remain enabled. Executable URL leases and process isolation were not changed.
5. `MutationReceipts.registerWorkflow` checks account admission, then reads recorded ownership before attempting an insert. Fingerprint validation and concurrent-insert handling remain. The test admission fixture keys fingerprints by receipt ID and honors lookups rather than sharing one fingerprint across executions.
6. Scheduled script GC defers while durable sandbox references exist or the ingestion fence is busy, rechecking references under the fence. Boot/explicit collection, liveness rules, TTLs, and tick cadence remain unchanged. Delayed collection during sustained work is an approved tradeoff.
7. The pinned Effect runtime has a Bun-native workaround for [Effect-TS/effect#8646](https://github.com/Effect-TS/effect/issues/8646). Ordinary deferred completions cache their result without waking a current run that did not await them; interrupts, awaited names, recovery, child replies, and clocks retain their wake paths. The issue includes a self-contained reproduction against the verified published package. `patches/effect@4.0.0-rc.117.patch`, root `patchedDependencies`, and `bun.lock` retain the same version and a linked removal TODO. Source-map precision is preserved outside the changed guard.
8. The SQL activation regression uses an explicit test-owned readiness barrier before sibling suspension. Its exact 1-before/2-after activation assertions and existing 5/10-second limits are unchanged. Five consecutive focused SQL runs and the full backend/workspace runs passed.

Independent review approved these changes after correcting lost bootstrap arguments and overly broad source-map degradation. The main-session cleanup removed temporary timing observers, their diagnostic-only test, and per-request/batch debug logs: **182 net lines removed**. Core metrics, returned timing data, security/budget tests, and checkpoint coverage remain.

The required-hook polling/clock experiments, executable-URL cache probes, and other temporary performance trials were not adopted. Do not reintroduce them or redo completed preflight.

### Check and non-E2E evidence

These commands ran from `/root/ryot-preflight`:

```bash
bun run check
bun turbo --output-logs=full check
bun turbo --filter='!@ryot-app/e2e' --output-logs=full test
git diff --check
```

| Final command           | Result                                     | Cache / duration                                                                                                      | Runner log under `/root/ryot-preflight-logs/` |
| ----------------------- | ------------------------------------------ | --------------------------------------------------------------------------------------------------------------------- | --------------------------------------------- |
| `bun run check`         | Passed; 29 lint-rule tests, 37 Turbo tasks | 26 cached; 52.171 s Turbo duration                                                                                    | `20261001T111916Z-check-430786.log`           |
| Full-output Turbo check | Passed; 37 tasks, zero warnings/errors     | 37 cached; 0.092 s Turbo duration                                                                                     | `20261001-final-turbo-check.log`              |
| Full non-E2E command    | Passed; 49 tasks                           | 46 cached; 123.229 s Turbo duration. Backend freshly executed: 243 files, 1,633 tests passed, 95.36 s Vitest duration | `20261001T112016Z-unit-432422.log`            |
| `git diff --check`      | Passed locally and remotely                | No whitespace errors                                                                                                  | Command output                                |

Do not describe replayed cached package results as fresh executions. The full backend also passed independently before the final workspace run. Local/remote formatter differences in test files were retained and synchronized; production code did not change after the final gates.

### Additional affected E2E

Each file ran separately from `e2e/` with `bun --bun run vitest run '<file>'`. All 17 tests passed, with zero failures or skips. No whole-E2E invocation was used.

| File under `src/api/kernel/`             | Tests passed | Vitest duration | Runner log under `/root/ryot-preflight-logs/` |
| ---------------------------------------- | ------------ | --------------- | --------------------------------------------- |
| `sandbox/durable-tracer.test.ts`         | 1            | 36.27 s         | `20261001-final-sandbox-durable-tracer.log`   |
| `imports/durability.test.ts`             | 1            | 81.70 s         | `20261001-final-imports-durability.log`       |
| `automations/lifecycle-triggers.test.ts` | 6            | 65.90 s         | `20261001-final-lifecycle-triggers.log`       |
| `auth/god-mode-reset-user.test.ts`       | 7            | 31.59 s         | `20261001-final-god-mode-reset-user.log`      |
| `system/process-teardown.test.ts`        | 2            | 40.38 s         | `20261001-final-process-teardown.log`         |

These runner logs contain exact API and PostgreSQL log paths, including the restarted import-durability APIs. Final inspection found no remaining test API processes or containers. The checkout and evidence remain available on the server.

**No capacity prework blocker remains for this remote acceptance environment.** Preserve the implemented repairs and upstream-linked workaround while performing workstreams A–H. Source-operation SQL counts and result-byte measurements for the future DRY changes still need comparable fixtures; whole-run trace totals are not source-write counts. Workstreams A–H remain unimplemented.

## 4. Implementation workstreams

### A. Canonical lifecycle schemas and command derivation

**Owners**

- `packages/contract/src/modules/automations/lifecycle.ts`
- `kernel/backend/src/lib/domain/lifecycle-command.ts`

#### A1. Named lifecycle payload groups

`mutationPayloads` currently returns an ordinal tuple. Request/change groups and projected variants repeatedly reconstruct its positions.

Refactor it to return named groups or variants. Derive ordinary, population-bearing, and projected schemas from those definitions.

Preserve:

- Strict decoding.
- Wire fields and optionality.
- `changedProperties` participation.
- Event planning fields.
- Existing union inference.

Remove obsolete positional assembly; do not replace it with manually duplicated schemas or a general schema framework.

#### A2. Canonical hook identity

The following still mirror `hookSlug` and nullable `pluginId`:

- Contract `AutomationOmittedHook`.
- Event policy engine `PolicyIdentity`.

Define one neutrally named hook-identity schema/type in the lifecycle contract. Update omission, exclusion, and processed-policy consumers directly. Preserve boundary strictness and wire field names; remove old aliases.

#### A3. Command derivation

Consolidate:

- Identical `commandFor` functions in:
  - `provider-entities/population.ts`
  - `provider-entities/relationship-population.ts`
  - `provider-entities/provider-entity-population-workflow.ts`
- Identical `childCommand` functions in:
  - `collections/service.ts`
  - `collections/add-entity-to-collection-workflow-live.ts`
  - `test-support/service.ts`
- Shared causation/account construction in:
  - `lib/infrastructure/sandbox-runtime/shared.ts`
  - `boot/kernel-workflow-references.ts`

Use focused pure helpers. Preserve the **exact existing identity encodings**. Import-item indexes and provider batch identities have distinct meanings.

Keep sandbox context validation, trusted host-call checks, and execution-ID derivation at their existing boundaries.

**Verification:** contract lifecycle/projection tests, command/host tests, recipe inference checks, and causation/replay regressions.

---

### B. Transaction, deadline, and event identity helpers

#### B1. Transaction helpers

Repeated root-transaction handling exists in:

- `entities/service.ts`
- `events/service.ts`
- `events/event-create-workflow-live.ts`
- `relationships/mutation-support.ts`

Consolidate feature-local helpers first. Use a focused database helper only for genuinely identical root-boundary/deadlock-retry behavior.

Callers retain domain error conversion.

**Critical distinction:** root-only transactions, active-transaction requirements, and receipt admission’s “join active or open a transaction” behavior are different contracts. Do not merge them.

Never put sandbox execution, dispatch, network calls, waits, or workflow suspension inside a transaction.

#### B2. Deadline observer

Share the repeated observation loop in:

- `lib/infrastructure/workflow-deadline.ts`
- `modules/automations/execution.ts` → `observeAttempt`

Use an explicit polling interval. Preserve:

- Existing 500 ms and 1,000 ms intervals.
- Absolute cutoff and completion-time comparison.
- Interruption.
- Journaled deadline creation.
- In-memory polling waits—do not restore a durable activity for every clock read.

#### B3. Event identities and result codecs

Create event-owned definitions for:

- Event-create batch input.
- Event-create item receipt identity.
- Receipt result schemas.
- Receipt-conflict classification.

Replace repeated construction in:

- `prepareItem`
- `writeEvent`
- `planEventBatch`
- `hasPreparedEventBatch`
- `EventsService.verifyCreateBatchInput`
- Locked/unlocked update/delete lookup branches.

Use the submitted item as fingerprint input, not its policy-transformed draft. Keep locking and account admission intact.

The inline no-policy path currently repeats some batch preparation and lookup within one transaction. Remove redundant work where the same transaction already owns the decision. Recheck durable state when crossing transaction boundaries.

**Verification:** event creation/update/delete, no-op replay, non-user cancellation, invalid-first-item sealing, suspension/resume, and progress after history pruning.

---

### C. One relationship mutation implementation

**Primary files**

- `relationships/mutation-pipeline.ts`
- `relationships/prepared-mutations.ts`
- `relationships/planned-reconciliation.ts`
- `relationships/mutation-support.ts`
- `relationships/service.ts`

The current implementations duplicate:

- Request construction and policy loops.
- Patch acceptance and property validation.
- Schema fingerprint/source-state checks.
- Locks and source-write selection.
- Receipt conflict mapping.
- Hook evidence and population count decoration.

Create relationship-owned transaction-scoped preparation/persistence primitives and one policy-execution implementation. Let batch, prepared-user, and reconciliation APIs compose them.

Internal APIs may change. Keep opaque prepared handles where callers need to prepare outside a transaction and commit within a larger transaction.

**Important consumers**

- `modules/user-state/service.ts`: prepares relationship moves, then commits event/relationship work atomically.
- `modules/provider-entities/relationship-synchronization.ts`: reconciliation inside the caller’s active transaction.
- `lib/infrastructure/sandbox-runtime/host-functions.ts`: durable reconciliation.
- `RelationshipsService`: ordinary single and batch mutations.

**Important behavior to retain**

- Prepared persistence returns item dispatch references; the multi-item owner seals resource batches.
- Active-transaction reconciliation currently rejects matching before-policies with `before-policy-requires-owner`. Do not execute those policies inside that transaction.
- Deterministic entity/relationship lock ordering.
- User/global scope and schema provenance.
- Additive/authoritative synchronization and preserve/replace conflict semantics.
- Replay-stable counts, no-ops, ordering, and population leader assignment.
- Existing partial-success boundaries.

Thin distinct orchestration APIs are acceptable. Duplicate policy or persistence algorithms are not.

**Verification:** ordinary/prepared/reconciliation behavior, user-state atomicity, concurrent source/schema changes, policy failure/rejection, receipt conflicts, and batch-only hooks.

---

### D. Minimal entity replay results

**Primary files**

- `entities/mutation-outcomes.ts`
- `entities/mutation-persistence.ts`
- `entities/service.ts`
- Provider workflow result codecs and consumers.
- Collection consumers of prepared entity results.

Enumerate every consumer of `EntitySaveResult`, `EntityMutationOutcome`, `outcome`, and `wasInserted` before removal.

Replace overlapping `entity`/`before`/`after` storage with the smallest command-specific result:

- Keep the returned entity snapshot when needed for exact replay.
- Keep insertion/operation information only where consumers require it.
- Build hook evidence within the write transaction.
- Do not journal universal before/after snapshots as command results.
- Give delete/no-op commands appropriate result codecs rather than forcing them through oversized save results.

`ProcessedChildEntity.entityOutcome` is already removed. Do not recreate it.

Preserve external responses, including `wasInserted` where exposed. Update internal codecs directly with no old-result decoder.

**Verification:** replay after newer updates/deletion, no-op replay, provider/collection behavior, and unchanged dispatch references.

Measure encoded receipt/activity-result bytes for representative create, update, and no-op fixtures before and after.

---

### E. Typed workflow admission and retirement composition

**Current primitive**

- `modules/mutations/receipts.ts` → `registerWorkflow(account, workflowName, executionId)`.

It already persists actual workflow ownership. Consolidate its call-site wiring.

#### Target structure

- A typed admitted-dispatch operation accepts the actual workflow definition, account identity, and execution options.
- It derives or receives the actual execution ID once.
- It records ownership before dispatch.
- It delegates to the existing workflow engine.
- Boundary-specific failure mapping remains with callers.
- An immutable catalogue of admitted workflow definitions is assembled at boot and injected into retirement.
- Retirement no longer maintains a separate handwritten list in `user-lifecycle/workflow.ts`.

Keep concrete workflow imports out of the generic receipt/admission primitive. Use defining workflow modules and boot composition; avoid circular imports and mutable global registration.

Enumerate **all** `registerWorkflow` sites, including:

- Events, collections, imports, integrations.
- Provider admission/population.
- Sandbox execution and durable host dispatch.
- Automation runs, plugin cron, bootstrap.
- Kernel workflow references.

Preserve replay-body admission checks. They are not redundant with pre-dispatch registration.

Preserve:

- Derived versus explicit workflow IDs.
- Explicit `null` account for system work.
- Admission/reset lock coordination.
- Fail-closed handling of unknown retained workflow owners.
- Retirement before receipt deletion.
- No new durable ownership table.

**Verification:** registration-before-dispatch, mismatched generation, failure/retry, workflows suspended before their first write, reset-and-resume, and new-generation success.

---

### F. Compiler byte and reference primitives

#### F1. Executable-text codec

Use a focused module in an existing neutral owner, such as `packages/ts-utils`.

It must implement:

- Fatal UTF-8 decoding.
- BOM preservation.
- Exact string encoding with round-trip rejection of replacement.
- No newline or Unicode normalization.

`ts-utils` currently has no Effect dependency; do not introduce one merely for this pure codec. Callers map failures into their existing error vocabulary.

Replace duplicate implementations in archive, ingestion, client-module, and runtime paths. Keep each trust-boundary validation.

Do not apply these semantics to JSON manifests or authored source.

#### F2. Reference classification/resolution

Share common primitives between:

- `client-plugin-compiler/src/module.ts`
- `client-plugin-compiler/src/runtime.ts`

Preserve their policy differences:

- Plugin modules permit declared trusted/plugin dependencies.
- Shared runtime modules have stricter external import rules.
- Their current local-path rules differ.

Characterize query/fragment handling, absolute paths, traversal, nested-file references, data URLs, and URL schemes before refactoring. Do not silently broaden either acceptance policy.

Keep existing AST/PostCSS extraction.

#### F3. AST literal extraction

Share `literalString` between:

- `typescript-compiler/src/javascript-references.ts`
- `vite-compiler/src/deno.ts`

Export it only through the dedicated `javascript-references` subpath.

**Known trap:** eagerly exporting parser code from the TypeScript compiler’s core entry bundled Rolldown’s native loader into the standalone sandbox worker and broke startup. Keep that boundary isolated.

**Verification:** golden hashes, BOM archive-to-ingestion, invalid UTF-8/unpaired surrogates, JS/CSS reference regressions, separate Deno policy, and the standalone compiler-worker test.

---

### G. Preference reads and plugin repository Layer ownership

#### G1. Preferences

Add one auth-owned preference-only read/decode operation.

Replace repeated standalone reads in:

- `entity-translation/repository.ts`
- `integrations/repository.ts`
- `sandbox-runtime/host-functions.ts`

Preserve:

- Missing-user behavior at each caller.
- Strict malformed-storage reporting.
- Full-row reads where another query would be wasteful.
- PostgreSQL authority and absence of session preference copies.

Use constructor/Layer injection. `AuthRepository` currently captures only `DatabaseSession`; do not pull the full auth runtime into preference-only consumers.

#### G2. Repository composition

Automations repeats:

```ts
PluginRepository.layer.pipe(Layer.provide(ClientArtifactsRepository.layer));
```

Define one canonical plugins-owned repository Layer in a focused module. Avoid importing the broad plugins Layer module if that creates a dependency cycle.

Update consumers of that composition and preserve shared resources. Repeated composition alone is not evidence of duplicate runtime instances.

**Verification:** preference consumers and malformed storage, constructor replacement, planner/retention/signal tests, and boot composition.

---

### H. SDK, bridge, and fitness cleanup

#### H1. Plugin runtime construction

Consolidate repeated client/navigation/schedule Layer assembly in:

- `client-sdk/src/schedule.ts`
- `client-sdk/src/testing.ts`

Provide schedule dependencies explicitly.

Preserve:

- Fresh page-owned runtime/schedule scopes.
- Harness-owned clock surviving page disposal.
- Synchronous Layer construction.
- Separate React screen contexts.

Retain the simultaneous A/B harness, disposal, navigation, and failed-bootstrap regressions.

#### H2. Bridge transport fallback

Construct the common transport-failure outcome inside `runRequest`, instead of passing six identical values.

Keep producer classification, inbound validation, outgoing validation, diagnostics, cancellation, and stale-reply suppression.

#### H3. Fitness query helpers

- Reuse shared property expressions in `workout-presentation-query.ts`.
- Rename entity-specific helper parameters if the expression is table-neutral.
- Share common list-recipe inputs in `shared/query-recipes.ts`; derive pagination fields from existing query input types where practical.
- Preserve nullable codecs, aliases, sorting, filtering, projections, and pagination.
- Keep list/detail/presentation queries distinct.
- Preserve the neutral `shared/**` compiler import policy.

No universal domain renderer or recipe builder.

## 5. Execution and delegation

Use one coordinating agent.

Suggested order:

1. Preflight and baseline evidence.
2. A/B foundational contracts and helpers.
3. C relationship consolidation.
4. D entity result minimization.
5. E workflow admission/retirement.
6. G backend ownership cleanup.
7. F and H can run independently when file ownership is explicit.
8. Integration, cleanup, review, final verification.

Do not parallelize overlapping backend transaction/replay edits.

Implementation agents should fix TypeScript and behavior. Assign lint fixes to a **mechanical agent** with explicit file ownership. Package `check` scripts run `oxfmt --write` and `oxlint --fix`; avoid concurrent global checks while agents are editing.

Each handoff must include files changed, tests run, failures, and remaining work. Do not commit.

## 6. Verification

Use existing behavior-owned tests. Add tests for meaningful branches and invariants, not helper passthroughs or library behavior. Inject dependencies; do not use mocks, spies, or fake timers.

### Required final commands

```bash
bun run check
bun turbo --output-logs=full check
bun turbo --filter='!@ryot-app/e2e' --output-logs=full test
git diff --check
```

### Affected E2E

Select actual affected files from the final diff. Expected coverage includes:

- Entity, event, and relationship mutation suites.
- User-state and collection membership/event suites.
- Lifecycle trigger and recursion/causation suites.
- Reset and user deletion.
- Import durability.
- Compiled-package and client semantic compilation.
- Preferences/localization/integration consumers.
- Client-plugin/client-page browser behavior.
- Fitness workout behavior where presentation queries change.

Run standard files separately using the documented targeted invocation. Never run the entire E2E suite.

Repeat both opt-in population gates separately after integration using the direct commands from preflight. Confirm tests executed.

### Measurements

Use the same deterministic fixtures/configuration before and after:

- Entity receipt/activity-result encoded bytes.
- Event no-policy source-operation transaction/SQL counts.
- Comparable population-gate duration and results.

Whole-harness SQL totals include setup, polling, and automation. Do not label them source-write counts or claim an unmeasured speedup.

## 7. Cleanup and review

After implementation:

1. The main agent performs the requested extensive `codebase-cleanup` pass itself.
2. Limit it to this task’s leftovers: obsolete algorithms, forwarding files, aliases, unused result plumbing, duplicated schemas/helpers, and stale documentation.
3. Do not redo an unrelated repository audit.
4. Update current ownership/invariant documentation alongside changes.

Then:

- Ask an independent subagent to review the completed work.
- Fix valid, scoped findings.
- Ask the **same reviewer** to re-review those fixes.
- Do not indefinitely expand scope.
- Repeat affected checks after fixes.

## 8. Completion and final report

Completion requires:

- All workstreams above addressed.
- One relationship policy/persistence implementation.
- Canonical event and command identity construction.
- Minimal exact-replay entity results.
- Shared admitted dispatch and retirement definitions.
- Shared byte/reference primitives with distinct policies intact.
- No old/new compatibility paths, duplicated obsolete implementations, or weakened boundaries.
- Clean required checks and genuinely executed affected E2E tests.

The final report must state:

- What changed and how ownership now works.
- Removed duplication, files, APIs, and result fields.
- Tests and gates actually run, including executed/skipped counts.
- Baseline/final measurements and unavailable evidence.
- Review findings and fixes.
- Blockers or deviations.
- Logical staging/commit commands with verbose messages.

**Do not git commit.**

### Stop-and-ask conditions

Ask before:

- Changing external results, wire schemas, valid artifact bytes, or acceptance policies.
- Adding schema fields/tables, packages, queues, workers, compatibility, or global registries.
- Changing cancellation, policy ownership, transaction boundaries, or replay identity semantics.
- Raising limits or widening into performance work after a baseline gate failure.
- Adding a cast or suppression that bypasses checking.
