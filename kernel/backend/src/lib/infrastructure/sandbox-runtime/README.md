# Sandbox Runtime

The backend executes plugin and source-zero kernel scripts as untrusted TypeScript modules. `SandboxScriptWorkflow` owns every invocation: it pins code, replays the body from the start, and converts mutable host calls into durable requests. Plain activity calls settle inside the live replay; durable waits retain no Deno process, bridge session, transaction, or worker.

## Build And Execution

Plugin ingestion validates `.sandbox.ts` manifest entries, compiles format-1 JavaScript, and stores immutable rows keyed by script provenance and content hash. Kernel scripts use the same compiler and content-addressed rows under definition source zero. Root scripts are pinned before first execution; child targets resolve from the active pinned plugin revision when first observed and are then pinned to that durable step.

`bun run build` runs `scripts/generate-sandbox-runtime.ts` to generate the Deno runner,
embed kernel sandbox sources, and build the trusted runtime payload. Registry/package resolution is
in `scripts/sandbox-runtime-registry.ts`; registry-driven module builds, hashes, import-map generation,
and metadata assembly are in `scripts/sandbox-runtime-payload.ts`. Both runner and dependency modules
use `@ryot-app/vite-compiler`'s `buildDenoEsm` profile. Generation runs before normal `check`, `test`,
and `build` tasks; server development runs the same script in watch mode. The generated files are
`runner.generated.ts`, `kernel-scripts.generated.ts`, and `runtime-payload.generated.ts`.
`sandbox:check-runner` type-checks Deno globals separately.

Before execution, the backend verifies compiled bytes against SHA-256, atomically materializes a read-only `<hash>.mjs`, and hard-links it into an execution directory. A single-use Deno process imports it through a local approved-dependency map. The runner validates definition input and output and returns a completed, failed, or pending envelope. The Deno launcher, permissions, and execution grants remain unchanged.

`SANDBOX_WORKER_CONCURRENCY` bounds how many queued executions run at once and defaults to 2, sized for the canonical 2 vCPU / 4 GB self-hosted baseline where each live execution holds one Deno process and one shared application/workflow-pool connection. Excess work stays durably queued rather than rejected, so raising it trades queue latency for CPU contention and resident memory. Boot fails when the value exceeds `DATABASE_POOL_MAX - 1` and warns when it leaves the two always-on durable queue workers no connection headroom.

Automation contexts contain trusted trigger and run IDs, hook slug, causation, occurrence time, execution user, optional hook metadata, and a deterministic projection of the retained trigger payload. The workflow uses the exact input projection pinned in the script manifest; the complete immutable trigger remains evidence and is not passed through by default. Scripts cannot replace ownership or parentage. Plugin configuration is not copied into the context and remains available only through `getPluginConfig` against the exact retained revision.

After-hook projections declare any supported `entity`, `event`, `relationship`, `providerEntityImport`, and `signal` inputs. Mutation projections select nested properties; entity and relationship projections can separately select population parent-entity properties; update projections derive sorted `changedProperties` from declared JSON or unordered-array comparisons. Policy projections select request properties for entity, event, or relationship inputs. Before each policy, the workflow applies earlier accepted patches in order and then projects the resulting request, so each policy observes the accepted chain rather than another policy's unvalidated output. RyotQL remains a current-state query surface and cannot recover omitted trigger-time values.

The 64 KiB context limit is measured on the complete UTF-8 invocation after projection and trusted automation fields are added. Retained batch chunking is a separate item-count concern and does not guarantee that every hook's projected invocation fits. Missing retained evidence or script artifacts and missing, incompatible, non-JSON, oversized, or schema-invalid projections fail closed before sandbox execution with bounded preparation diagnostics.

An unrecorded mutable `host.*` call ends that replay unless the host settles it inline. The workflow dispatches ending calls through their owning activity, child workflow, artifact operation, or diagnostic path, journals the typed success or failure, then replays. Recorded calls return their journaled results and never repeat the backend dispatch.

### Inline durable calls

A replay's batch is every unrecorded request registered before its first unrecorded call runs, the same batch a pending replay would end with. When every request in it uses a capability whose dispatch strategy is `activity` (reads and idempotent writes that start no workflow and need no sandbox slot), the runner writes the batch to stdout and blocks on a synchronous stdin read. Blocking freezes every script fiber, so the script observes the results exactly as a later replay observes journal entries.

The queue worker settles the batch with the same `dispatchSandboxHostActivity` path the workflow activity uses, with bridge-call concurrency, and answers with one durable result per request. The results extend the runner's local journal and the script continues in the same process. The host records the entries it produced; the queue result carries them to the workflow, which validates them against the envelope's request identity and argument hashes and journals them before any request that ended the replay. Recovery replays load them like any other entry.

The host defers the whole batch, and the replay ends pending as before, when any request is not activity-dispatched, when an `httpCall` origin matches or cannot be resolved against an HTTP rate-limit policy, when indices do not continue the journal the workflow passed with the replay, when the batch or the inline journal exceeds its byte limit, or when dispatch fails. A deferred batch may already have run some calls; the workflow runs them again. Grant-carrying and profiled executions never settle inline.

The replay timeout covers script time only: it pauses while the host settles a batch, and the bridge session expiry moves by the same amount. A live replay therefore spends no more script time than a recovery replay of the same journal.

## Durable State

- PostgreSQL workflow persistence is authoritative for execution, request completion, child/activity results, and terminal output.
- Redis contains only a reconstructible replay projection: request identity, argument hashes, and encoded results. Loss or expiry may rebuild it from workflow persistence.
- Request identity and argument hashes detect replay nondeterminism.
- Idempotent service operations run as activities; workflow-owning services compose as deterministic children.
- Each bounded `httpCall` network attempt is durable. External mutation is at-least-once across the crash window before its result persists; for inline calls that window spans the replay, whose queue result persists them.
- Input artifacts are pinned through workflow completion or cancellation. Generated chunks use opaque workflow-scoped handles; TTL is leak cleanup, not normal lifetime.
- Logs, spans, and console diagnostics are replay-tagged operational data, not journal entries.

Workflow code cannot use ambient time or randomness. Expected workflow failure uses the SDK's deterministic `Effect.fail`; a throw is a defect and becomes an execute-phase error. Trusted subjects override script-supplied `userId`; relayed import, integration, and automation attribution is owner-validated before dispatch.

## Security Boundary

- Every replay uses a separate single-use Deno process that lives until the replay completes, fails, or ends at a call it cannot settle inline. Timeout, failure, cancellation, and success all kill it.
- Deno denies subprocesses, environment access, FFI, writes, prompts, npm, remote modules, ambient config, and lock files by default.
- Format 1 hides `Deno` and disables `eval`, string code generation, and workers before importing plugin code.
- Read access is limited to the runner, one execution-linked module, approved local dependencies, and explicit per-execution grants. Network access is limited to the authenticated localhost bridge; scripts use `httpCall` for external traffic.
- Bridge requests require a per-execution bearer token and fail after in-memory expiry.
- Processes receive only `PATH` and `DENO_DIR`; script code cannot read either because environment access is denied.
- Each Deno process has a 256 MiB V8 old-space limit.

`SANDBOX_PROCESS_MODE=on-demand` is the default. `warm` retains `SANDBOX_WORKER_CONCURRENCY + 2` prepared processes, but each is still checked out once and invalidated. Grant-carrying executions always spawn dedicated processes because permissions are execution-specific.

## Benchmark Profiling

`SANDBOX_BENCHMARK_PROFILE_DIR` is unset in production and every profiling control fails closed
while it is. When it is set, admin-gated test-support operations arm one opaque correlation token
against a script slug; the next matching logical execution and each of its replay attempts run in a
dedicated process with `--cpu-prof-dir` and, when heap snapshots are requested, an inspector bound to
localhost. The runner reports checkpoints (runner ready, module imported, journal loaded, dependency
settled, host call settled, result built, response encoded) over the authenticated bridge and exits
after responding so Deno flushes its CPU profile. The host records `smaps_rollup` and
`Deno.memoryUsage()` at each checkpoint and streams heap snapshots into mode-0600 files. A profiled
execution also gets a longer timeout, because snapshots pause the profiled process.

Backend profiling uses `bun:jsc`: a sampling CPU profile between start and stop, V8-format heap
snapshots, a heap census, and an explicit collection. Unprofiled executions keep their existing
process, flags, timeout, and session behaviour byte for byte.

## Filesystem And Dependencies

Filesystem access is capability-gated and deny-by-default:

| Capability      | Grant                                                 |
| --------------- | ----------------------------------------------------- |
| `artifact-read` | Read-only path to one kernel-materialized artifact.   |
| `scratch`       | Read/write execution directory under `config.tmpDir`. |

Grant paths must be absolute, normalized, and contained by `config.tmpDir`. These capabilities are Deno permissions, not bridge functions. Scratch is checked after execution; exceeding 5 MiB fails before harvest. Cleanup is kernel-owned and runs after process death on every exit path.

Oversized results may be chunked into named scratch files. The kernel, never another sandbox run, copies exactly those files to workflow storage and returns opaque handles. Consumers resolve a handle only against its trusted parent execution. Public results omit harvest metadata.

Format-1 modules may import compiler-bundled SDK entry points and the external specifiers derived from
`SANDBOX_RUNTIME_REGISTRY` in `@ryot-app/sandbox-sdk`. Preparation builds immutable,
content-addressed ESM files, an import map, a canonical payload content hash, and generated metadata
containing format, Deno/Vite versions, dependency versions, file sizes, and file hashes. Startup calls
`materializeShippedSandboxRuntime` to verify and materialize this payload; it never resolves packages
or rebundles them. `materializeSandboxRuntimePayload` remains the lower-level validator/materializer.
Deno runs cached-only with no npm, registry, remote URL, project config, or lock file. SDK and
plugin-kit Effect and RyotQL aliases point to the same runtime files and preserve module identity.
Backend and browser plugin compilers remain separate engines.

## Capabilities

The manifest declares an exact capability tuple. The backend intersects it with an exhaustive policy and implementation registry; domain services still enforce user, schema, provider, and integration ownership.

| Principal or role                   | Available bridge capabilities                                                                                                                                         |
| ----------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| All valid subjects                  | `log`, `span`, `httpCall`, `getCachedValue`, `setCachedValue`, `getPluginConfig`, `getSystemConfig`, `claimPersistentValue`                                           |
| User or user automation run         | `createEvents`, `getEntitySchemas`, `listEventSchemas`, `listIntegrations`, `getUserPreferences`, `getCurrentIntegration`, `changeUserRelationships`, `executeRyotql` |
| System-plugin user-bootstrap script | `ensureUserEntities` for that plugin's entity schemas                                                                                                                 |
| Pinned system-scope plugin script   | `executeRyotql`, `upsertGlobalEntities`, `upsertGlobalRelationships` within plugin ownership                                                                          |
| User or system automation run       | `emitSignal`; `sendNotification` is available only to user automation runs                                                                                            |

`scratch` and `artifact-read` are non-bridge permissions. System elevation requires a persisted pinned system-scope plugin principal. User capabilities require a trusted user subject. `getEntitySchemas` uses that user's effective ready, enabled plugin catalog. Entity and event data reads use RyotQL; schema calls expose metadata only.

`upsertGlobalEntities` additionally requires provider association. `ensureUserEntities` is available only to the declared user-bootstrap script and remains scoped to entity schemas owned by that plugin.

Plugin config reads are restricted to the owning plugin's declared `requiredPluginConfigKeys`; kernel fields require `requiredSystemConfigKeys`. Batches reject any undeclared, unreadable, or missing key. Normalized environment-key collisions reject plugin loading.

Cache keys are isolated by executing user and logical provider ID, falling back to script ID only when no provider exists. Ordinary cache values are refreshed after backend restart; `claimPersistentValue` survives restart and writes only if absent.

## Global HTTP Admission

Installed plugin `httpRateLimits` apply across all users, scripts, workflows, and backend instances in a deployment. Matching uses normalized HTTP(S) origin. Equal canonical declarations may coexist; conflicting declarations sharing a key or origin reject the entire proposed plugin state. Policies are live, so install, update, or uninstall affects the next reservation of an active workflow.

PostgreSQL active manifests are authoritative. Redis stores operational declaration hash, next eligible time, and blocked-until time. Lua uses Redis server time to reserve or confirm an evenly spaced GCRA slot and update blocks atomically. Idle state expires after `max(10 * intervalMs, 60 seconds)`, extended through an active block.

Each call re-resolves policy from PostgreSQL. Unmatched origins run one bounded durable attempt without Redis. Matched calls reserve a slot, durably sleep until eligible, re-resolve and confirm the unchanged policy, then run one attempt. A changed policy discards the old reservation.

Only a matched HTTP `429` retries automatically. `Retry-After` accepts delta seconds or an HTTP date; missing or invalid values use the full policy interval. The global block advances atomically before durable sleep and retry with a new deterministic attempt identity. Non-`429` failures and unmatched calls do not retry. Coordination failures retry with deterministic one-second exponential durable backoff capped at 30 seconds; matched calls fail closed while coordination is unavailable, but proven-unmatched calls continue.

Admission has no bursts, slot reclamation, tenant fairness, priority, or reserved capacity. Provider-specific quota headers are ignored. First-party policies are AniList, 90 requests/minute at `https://graphql.anilist.co`, and MusicBrainz, one request/second at `https://musicbrainz.org`; other origins are unmatched.

HTTP logs contain only workflow execution ID, policy key, normalized origin, stage, attempt, wait/duration, and status. URLs, query strings, headers, bodies, credentials, and user IDs are excluded.

## Failures

- Completed script failures identify `load`, `input`, `execute`, or `output` phase and may include source-mapped frames, each named by its authored path relative to the compiled module.
- Returned stacks remove data URLs, runner/dependency paths, bridge URLs, execution IDs, and tokens.
- Bridge validation uses 400 for invalid body, 401 for token failure, 404 for unknown function, and 410 for expired session.
- Timeout and unexpected process death are workflow job failures. Raw compiler/runtime diagnostics stay on explicit plugin-author, admin, and test surfaces; unexpected causes stay in logs.
- Console, `log`, and `span` output share bounded completed-result diagnostics. Oversized console logs append `[sandbox logs truncated]`; an oversized final value fails the output phase without partial data.
- Automation preparation reports missing artifacts separately from invalid projected input; neither condition falls back to the complete retained payload.
- Normal APIs and persisted workflows use structured module-owned kebab-case reasons, never diagnostic prose.

Completed results include `timing: { totalMs, executionMs }`.

## Limits

Limits are fixed in `limits.ts` and compiler-owned limits, not environment settings.

| Boundary                                                           |                                  Limit |
| ------------------------------------------------------------------ | -------------------------------------: |
| Source / manifest / compiled JavaScript                            |               256 KiB / 16 KiB / 1 MiB |
| Compiler concurrency / timeout / sampled Linux process-tree memory |                2 / 5 seconds / 256 MiB |
| Compiler diagnostics                                               |                  100 entries / 256 KiB |
| Local replay timeout / context / final result                      |            30 seconds / 64 KiB / 4 MiB |
| Runner request                                                     |                                  2 MiB |
| Host calls / HTTP subset / concurrent in-flight calls              |                         1,000 / 50 / 4 |
| Durable workflow steps / encoded journal                           |                        1,000 / 100 MiB |
| Bridge request / response / durable response                       |               1 MiB / 10 MiB / 101 MiB |
| HTTP request / streamed response / attempt timeout                 |             1 MiB / 10 MiB / 8 seconds |
| Deno stderr                                                        |                      20 lines / 64 KiB |
| Console logs                                                       | 500 entries, 8 KiB each, 256 KiB total |
| `log` and `span` observability                                     | 500 entries, 8 KiB each, 256 KiB total |
| Cache key / value / maximum TTL                                    |          256 bytes / 256 KiB / 30 days |
| Scratch                                                            |         5 MiB, depth 32, 4,096 entries |

Compiler memory is sampled proportional set size in the Linux production image, not a cgroup hard ceiling. Non-Linux development keeps process, timeout, and concurrency bounds without claiming portable memory enforcement. Calls beyond per-session concurrency wait; cumulative budgets still apply. Session registration and removal are identity-aware so replacement, expiry, interruption, or a late finalizer cannot evict a newer session.

## Liveness And Garbage Collection

Database rows and `<contentHash>.mjs` files share one liveness set: persisted current plugins, accepted automation runs inside their artifact window, source-zero kernel scripts referenced from `kernel_script`, and running or suspended workflow references. GC takes the plugin-ingestion lock, computes liveness from persisted state and deletes rows in one transaction, then removes only unreferenced hash-shaped files.

Execution hard links protect in-flight imports if canonical files are collected. Acquisition retries once if GC wins the materialize/link race. Missing memoized files are evicted and rebuilt. Persisted workflow references protect ordinary suspended work; retained automation runs independently protect their exact script, plugin, and configuration pins through retry and manual replay. Completion or cancellation releases workflow references.
