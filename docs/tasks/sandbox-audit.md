# Sandbox audit

Isolation model solid. Deno flags, content-addressed modules, per-execution token, budgets — all good and genuinely defensive. The weakness is not security posture, it is **layering**: permission decisions are spread across five places with three different mechanisms, and the execution path has one hop too many. Not over-engineered overall, but two specific subsystems remain (bridge error messages, Redis session store).

This is a greenfield project so breaking changes are fine.

---

## 1. Structure

**Good.** `lib/infrastructure/sandbox-runtime` (mechanism) vs `modules/sandbox` (durable orchestration) vs `app/*-host-functions.ts` (domain binding) is the right cut. `SandboxHostImplementations` as an injected Context service is the right inversion.

**Problem A — the runtime/app split is arbitrary.** Runtime-owned cache and HTTP host functions now live beside the other injected host implementations. `SandboxService` owns orchestration only.

Host functions are assembled through `SandboxHostImplementations`, so orchestration no longer builds and consumes its own map through late binding.

- [x] Move cache and HTTP implementations into `runtime-host-functions.ts`, merge them into `SandboxHostImplementations`, and keep `SandboxService` focused on orchestration.

**Problem B — three-hop dispatch.** Workflow-owned callers previously used `processSandboxExecution` → resolution `Activity` → `RunSandboxWorkflow` → `DurableQueue.process(SandboxExecutionQueue)` → worker → `executeSandboxExecution` → `SandboxService.run`.

`RunSandboxWorkflow` and `SandboxExecutionQueue` carried **the same** `idempotencyKey: ({executionId}) => executionId`, payload schema, error type, and success type. Workflow-owned callers now use a shared queue-processing helper directly. Top-level HTTP enqueue, plugin boot, and direct cron dispatch retain a narrowly scoped `SandboxSubmissionWorkflow` because `DurableQueue.process` requires a parent `WorkflowInstance` for durable result polling.

- [x] Remove `RunSandboxWorkflow` from workflow-owned callers, centralize queue timeout/retry behavior, and narrow the remaining top-level adapter to `SandboxSubmissionWorkflow`. Concurrency bounding remains the queue worker's job.

---

## 2. Host functions

21 functions remain after entity/event data reads moved to the query engine. Cohesive, with batch-first migration complete for config and metadata reads.

**Per-item designs that Decision 8(a) forbids, with completed migration retained:**

| Function                    | Fix                             |
| --------------------------- | ------------------------------- |
| `getEntitySchemas(slugs[])` | - [x] batch entity schema reads |
| `listEventSchemas(slugs[])` | - [x] accept `slugs[]`          |
| `getPluginConfig(keys[])`   | - [x] batch plugin config reads |
| `getSystemConfig(keys[])`   | - [x] batch system config reads |

The config migration is not just stylistic. Batch reads resolve and parse the entire plugin config schema once, then return requested values by key. A script reading 6 config keys now uses one host call and one config resolution pass.

**Read-surface overlap.** `executeQueryEngine` is the entity and event data read surface. Schema functions remain for metadata introspection, while Decision 8(b) mandates query pushdown for data reads.

- [x] Keep `executeQueryEngine` as the entity/event data read surface and retain schema functions only as _metadata_ introspection. Net: 23 → 21 functions with no capability loss.

**Naming lies.** `getCurrentIntegration()` takes no arguments and returns the integration from the execution's authority (sandbox-host-functions.ts:466-489).

- [x] Use `getCurrentIntegration` for execution-scoped integration access.

**Cache trio asymmetry.** `getCachedValue`/`setCachedValue` write `redisKeys.sandboxRunCache(serverRun.id, …)` — wiped on restart. `claimPersistentValue` writes `redisKeys.sandboxCache(…)` — persistent. Three same-shaped functions, two different lifetimes, discoverable only from README:108.

- [x] Use `claimPersistentValue` for persistent atomic cache claims.

**Inconsistent validation.** Every host function decodes its args through an SDK contract in `bridge-adapter.ts` — except `listIntegrations`, which re-validates by hand inside the implementation (sandbox-host-functions.ts:583-598) _after_ already passing `domainSandboxHostContracts.listIntegrations`. Dead double-validation.

- [x] Remove duplicate `listIntegrations` validation.

---

## 3. Permission system

Layers currently in play:

1. Manifest `capabilities` declared at authoring, schema-constrained by `sandboxHostCapabilitySchema` (sdk/core.ts:608)
2. Persisted metadata capabilities
3. `allowedHostFunctions` on the run input (durable-queues.ts:111)
4. `selectSandboxHostFunctions` — authority rules (service.ts:101-145)
5. `manifestsMatch` — compiled manifest vs persisted metadata before host creation (runner-source.sandbox.ts:455)
6. Per-implementation `require*SandboxRunInput` (shared.ts:128-171)
7. Deno process flags
8. Bridge token + TTL + budget

The runner treats `payload.apiFunctions` as the approved host surface. `manifestsMatch` runs before host creation, so persisted metadata validation completes before API stubs exist. Authority remains kernel-side in `selectSandboxHostFunctions`.

- [x] Build the host from `payload.apiFunctions` and move `manifestsMatch` before `createHost`.

**The real problem is layers 4 and 6 splitting one decision.** Some capabilities are gated at selection time by set membership:

```ts
userAuthorityHostFunctions   = { ensureUserEntities }        // service.ts:95
systemActivityHostFunctions  = { executeQueryEngine }        // :96
userBoundHostFunctions       = { changeUserRelationships }   // :97
automationHostFunctions      = AUTOMATION_…                  // :98
systemCronHostFunctions      = SYSTEM_CRON_…                 // :99
```

…and others (`createEvents`, `getUserPreferences`, `listIntegrations`, `getCurrentIntegration`, `listEventSchemas`, `getEntitySchemas`) are gated **only** at call time by `requireUserSandboxRunInput`. And `ensureUserEntities` is gated in _both_ places plus a third DB lookup (`resolveTrustedUserBootstrapCaller`, sandbox-host-functions.ts:211).

The selection predicate itself is a five-clause negated boolean (service.ts:129-140):

```ts
if (fn &&
  (!automationHostFunctions.has(key) || authority.type === "subscription" ||
   (authority.type === "system" && key === "emitSignal")) &&
  (!systemCronHostFunctions.has(key) || isSystemScript) &&
  (authority.type !== "system" || !systemActivityHostFunctions.has(key) || isSystemActivity) &&
  (!userAuthorityHostFunctions.has(key) || authority.type === "user") &&
  (!userBoundHostFunctions.has(key) || authority.type !== "system"))
```

This is the single most security-critical expression in the subsystem and it is the hardest thing in the file to read. Adding a sixth rule means adding a sixth negated clause and hoping the interaction is right.

→ **Recommendation.** One declarative table, colocated with the capability list in the SDK:

```ts
const CAPABILITY_REQUIREMENTS = {
	ensureUserEntities: { authority: ["user"], caller: "trusted-user-bootstrap" },
	changeUserRelationships: { authority: ["user", "subscription"] },
	executeQueryEngine: { authority: ["user", "subscription"], systemKinds: ["activity"] },
	upsertGlobalEntities: { authority: ["system"], systemKinds: ["script"] },
	emitSignal: { authority: ["subscription", "system"] },
	sendNotification: { authority: ["subscription"] },
	// …
} satisfies Record<SandboxHostCapability, CapabilityRequirement>;
```

- [x] Adopt the declarative capability table. `selectSandboxHostFunctions` filters it and `requireSandboxCapabilityInput` derives runtime narrowing from the same table. `emitSignal` is subscription-only.

`selectSandboxHostFunctions` becomes a filter over the table (~10 lines). `require*SandboxRunInput` derives its narrowing from the same table instead of restating it. `satisfies Record<SandboxHostCapability, …>` makes a missing entry a compile error, so a new host function _cannot_ ship ungated — which today it silently can, since anything absent from all five sets defaults to allowed.

**Is it over-engineered?** The _count_ of layers is justified (defense in depth across a trust boundary is correct). The _expression_ of layers 4 and 6 is not. Unifying those layers loses no security and removes about 120 lines.

**Doc drift:** README:106 says automation functions require "the server-only subscription-run marker", but service.ts:133 grants `emitSignal` to `system` authority too.

- [x] Align README automation capability documentation with actual `emitSignal` authority rules.

---

## 4. Bugs

**B1 — unbounded retry. High.** `sandbox-workflow-live.ts:55-58`:

```ts
DurableQueue.process(SandboxExecutionQueue, executionPayload).pipe(
  Effect.timeout("1 minute"),
  Effect.retry(Schedule.spaced("1 second")),   // ← no bound
```

`Schedule.spaced` recurs forever. Every `SandboxRunError` — timeout, scratch-quota overrun, grant-path rejection, invalid runner response — retries at 1/s indefinitely, spawning a Deno process each attempt and holding a worker slot forever. A deterministically-failing script is a permanent capacity leak.

- [x] Bound retries with exponential backoff composed with `Schedule.recurs(n)`. Implemented with three total attempts and exponential delays of 1s and 2s.

**B2 — scratch symlinks. High.** `filesystem-grants.ts`:

- `measureSandboxScratchBytes` (:81-104) recurses using `fs.stat`, which **follows symlinks**. A symlinked directory cycle inside scratch → unbounded recursion. This runs _after_ the timeout race in service.ts:387-394, so nothing bounds it. Hang, not crash.
- `harvestSandboxScratchChunks` (:114-147) validates containment with `path.resolve` (lexical only), then `fs.copyFile`, which **follows symlinks**. The kernel process has no Deno restrictions, so a symlink named as a manifest chunk causes the kernel to copy whatever it points at into harvest storage.

The runner-side name validation (runner-source.sandbox.ts:120-132) does not help — it is inside the untrusted process.

- [x] Add an `lstat`-equivalent check, reject anything that is not a regular file, and cap depth and entry count. Scratch traversal now rejects symlinks and special entries, with 32 directory levels and 4,096 entries maximum.

**B3 — `emitSignal` origin under system authority. Verify.** automation-sandbox-host-functions.ts:33-49: for non-subscription authority the origin is decoded from `rawInput.context`. For a plugin workflow's `activity()` call, the context _is_ `request.args.input` (sandbox-script-workflow.ts:310) — script-controlled. If any system-authority script can hold `emitSignal`, it can forge signal origin attribution.

- [x] Restrict `emitSignal` to subscription executions and derive origin from trusted subscription execution state.

**B4 — `httpCall` discards non-2xx bodies. Medium.** runtime-host-functions.ts:204-219 skipped the body read for non-2xx and failed with bare `HTTP ${status}`. Every provider script lost API error detail (rate-limit reasons, validation messages) — exactly the payload a provider script needs to react correctly.

- [x] Read the body up to the limit regardless; non-2xx failures now carry `{ status, body }` for scripts to inspect.

**B5 — child execution IDs embed unsanitized names.** `sandboxWorkflowChildExecutionId` (sandbox-script-workflow.ts:138) interpolates `request.name` raw into a durable execution key. Not exploitable that I can see, but it is the one place a script string reaches an engine primary key unfiltered.

- [x] Apply `sanitizeSandboxExecutionSegment`, which already exists in filesystem-grants.ts:12 for exactly this purpose.

**B6 — harvest paths leak into scripts.** `completedValue` (sandbox-script-workflow.ts:128-131) merges `chunkFiles: result.harvest.chunkPaths` — absolute host paths under `config.tmpDir` — into the activity result handed back to a sandbox script.

- [ ] Return opaque handles the kernel resolves when granting the next execution.

**B7 — `removedCount` is fabricated.** compiled-modules.ts:135 returns `removedCount: candidates.length` regardless of whether `fs.remove` succeeded.

- [ ] Report `removedCount` based on successful `fs.remove` operations.

**B8 — quadratic chunk accumulation.** `[...state.chunks, chunk]` per chunk in service.ts:155 and runtime.ts:118. 10 MiB at 64 KiB chunks ≈ 160 array reallocations.

- [ ] Mutate the chunk array in the fold instead of reallocating it per chunk.

**B9 — `httpCall` timeout is an orphan constant.** service.ts:87 hardcodes 8s while `SANDBOX_TIMEOUT_MS` is configurable. Lower the config below 8s and the process dies mid-call.

- [ ] Move timeout to `limits.ts` and derive it from the execution timeout.

**B10 — stderr is black-holed.** runtime.ts:253-258 drains Deno stderr into `Effect.void`. Permission denials, V8 OOM, and module-resolution failures all vanish; the operator sees only "Sandbox timed out".

- [ ] Ring-buffer the last N stderr lines and attach them to timeout and kill failures.

---

## 5. Performance

**P1 — Redis round-trip per host call.** runtime.ts:319 reads `redisKeys.sandboxSession` on **every** RPC. I grepped: that key is written and read only inside runtime.ts. The bridge binds `127.0.0.1:0` in-process, so only this process's children can reach it, and `activeSessions` (an in-process `Map`) already holds everything needed. A 200-host-call execution pays 200 unnecessary Redis GETs.

- [ ] Move `token`/`expiresAt` into `ActiveExecutionSession` and delete the Redis key entirely.

**P2 — per-execution module re-hashing.** `materializeSandboxCompiledModule` (compiled-modules.ts:43-51) does `exists` + `readFile` + SHA-256 of up to 1 MiB on every execution of an immutable, chmod-444, content-addressed file.

- [ ] Memoize verified hashes for the process lifetime; GC already coordinates via the ingestion lock.

**P3 — workflow replay is O(N) subprocess spawns.** This is the big one. Each durable step ends the replay and re-runs the whole script in a **fresh Deno process** (sandbox-script-workflow.ts:393-427). A 200-chunk media import = 201 spawns, 201 module materializations, 201 bridge sessions, 201 durable workflow records.

But the envelope already carries `requests` as an **array**, and the kernel deliberately rejects more than one unrecorded call (`:185-191`). So a script doing `Effect.all([activity(a), activity(b), activity(c)])` is forced into three sequential replays instead of one.

- [ ] Allow a replay to emit multiple pending requests when they are independent, execute them as parallel durable steps, and append all results to the journal in one pass. Preserve determinism with index ordering and hash checks.

**P4 — journal projection is O(N²).** `projectWorkflowJournal` (sandbox-script-workflow.ts:394) is called at the top of every step and re-writes the entire prefix via `hsetnx` (workflow-journal.ts:71-82). Step _k_ writes _k_ fields → ~500k commands at the 1000-step ceiling.

- [ ] Write only journal entries beyond the stored high-water mark.

---

## 6. Dead code

Confirmed by grep, non-test usage only:

| Item                                          | Location                                   | Note                                                                                                                                       |
| --------------------------------------------- | ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------ |
| - [ ] `scriptIsBuiltin`                       | shared.ts:21, written durable-queues.ts:99 | **Never read** outside tests. Costs a DB query per execution (`repository.isPluginScript`) whose result is discarded.                      |
| - [x] `RunSandboxWorkflowPayload`             | sandbox-submission-workflow.ts             | Removed redundant alias; `SandboxSubmissionWorkflow` uses `SandboxExecutionPayload` directly.                                              |
| - [ ] runner `for(;;)` + console save/restore | runner-source.sandbox.ts:509-602           | Processes are strictly single-use (pool invalidated service.ts:340-343; dedicated killed by scope). Multi-payload handling is unreachable. |
| - [ ] `Object.hasOwn` + null check            | runtime.ts:353-360                         | Two guards for one condition.                                                                                                              |
| - [ ] `parseSandboxSession`                   | runtime.ts:100                             | Wrapper that only calls `decodeSandboxSession`. Moot if P1 lands.                                                                          |
| - [ ] `killProcess`                           | runtime.ts:173                             | Wrapper over `killProcessHandle`.                                                                                                          |
| - [ ] `hashBytes`                             | compiled-modules.ts:12                     | Alias for `sha256Hex`.                                                                                                                     |
| - [ ] `SandboxScratchManifest`                | filesystem-grants.ts:106                   | Alias for `sandboxScratchManifestSchema`.                                                                                                  |
| - [ ] `makeInvalidResponse`                   | service.ts:210                             | Single call site.                                                                                                                          |
| - [ ] `providerId` + `cacheNamespace`         | shared.ts:19,25                            | `cacheNamespace = providerId ?? scriptId` (durable-queues.ts:108). Both shipped on the input; derive one.                                  |

- [ ] Remove confirmed dead code and redundant fields listed above.

## 7. Duplication

- [x] **Metadata-kind checks.** Replace duplicated checks with one `sandboxMetadataKind(metadata)` returning the kind.
- [ ] **Byte-limited stream readers.** Consolidate `readSandboxHttpResponseText` and `readSandboxBridgeRequestBody` into one helper.
- [ ] **Budget accounting, twice.** Generate budget messages from one shared source while keeping both counters.
- [ ] **Grant path helpers.** Replace `sandboxArtifactGrantPath` and `sandboxNamedArtifactGrantPaths` with one generic.
- [ ] **Cache guard preludes.** Consolidate the shared key/TTL/value validation ladder into one guard combinator.
- [ ] **`apiFailure`.** Consider sourcing the cross-runtime error shape from the SDK wire package.
- [ ] **Result-to-status mapping.** Consolidate the shared `Match`/`Exit`/`Cause.pretty(...).slice(0,500)` pipeline used by `toSandboxRunResult` and `toPluginWorkflowResult`.
- [ ] **Brand re-mapping loops.** Consolidate the near-identical relationship batch mapping loops.
- [ ] **`bridge-adapter.ts` error reconstruction (~100 lines).** Emit the formatted schema issue and keep only the argument-count special case.

---

## 8. Decision points — my recommendations

You asked for recommendations rather than questions, so:

1. [ ] **Capability table vs. current sets.** Adopt the table first.
2. [x] **Narrow sandbox submission.** Remove the redundant workflow hop from workflow-owned callers before touching replay performance; retain only top-level submission bridge.
3. [ ] **Batched durable calls (P3).** Allow independent pending requests to execute as parallel durable steps.
4. [ ] **Drop the Redis session store (P1).** The data is process-local by construction.
5. [x] **Host-function batching.** Batch config and metadata functions now.
6. [x] **Collapse reads into `executeQueryEngine`.** Entity/event data reads use query documents; schema functions remain metadata-only.
7. [x] **Fix B1 and B2.** Bound retry and harden symlink handling regardless of larger refactor sequencing.

---

`emitSignal` no longer accepts system-authority execution context. It uses the trusted subscription
run origin, so script-controlled system context cannot forge signal attribution. B2 still rejects
symlink entries in kernel-owned measurement and harvest paths regardless of Deno's `Deno.symlink`
permission behavior.
