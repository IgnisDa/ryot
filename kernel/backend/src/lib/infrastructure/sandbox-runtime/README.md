# Sandbox Runtime

The backend executes plugin and source-zero kernel scripts as untrusted TypeScript modules. `SandboxScriptWorkflow` owns each invocation: it pins code, replays the body from the start, and turns mutable host calls into durable requests. A durable wait ends the isolate; a later replay starts fresh.

## Build And Execution

Plugin ingestion validates precompiled format-1 JavaScript from plugin archives and stores immutable rows by script identity and content hash. It does not run compiler workers or prove source provenance. Local authoring and build checks compile `.sandbox.ts` entries from source. Build generation also compiles kernel-script sources for definition source zero. Root scripts are pinned before first execution; child targets resolve from the active pinned plugin revision when first observed and are then pinned to that durable step.

Build tooling emits the trusted isolate runner and runtime modules into `kernel/sandboxd/payload`, and generates the kernel-script sources and compiled files. Runner and dependency modules use `@ryot-app/vite-compiler`'s `buildSandboxEsm` profile. The release task emits the `dist` executable, launcher, three snapshots, and digest manifest.

Before each invocation, `SandboxService` reloads persisted authority and verifies the compiled script's SHA-256. It chooses the smallest audited isolate tier required. System authority is allowed only for a verified kernel script or verified system-scope plugin. User-scope plugin scripts run with user authority under their owning user.

## Isolation And Capacity

The Rust sidecar runs each invocation in a fresh isolate. The sidecar and backend use a duplex inherited socket with framed messages. An execution-scoped host-call gate validates each operation, and sealed SDK bindings expose only the approved host surface.

`G` is global sandbox concurrency and defaults to 2. Pool sizing reserves `4 + G` connections for primary database work. Native host-call leases are capped at `poolMax - 4 - G`, which configuration validation requires to be at least 1; nested calls reuse their parent lease.

Without `SANDBOX_MEMORY_BUDGET_MIB`, the sidecar memory budget is the smaller of 1536 MiB and half of effective memory; an explicit budget cannot exceed half of effective memory, and startup fails when effective memory is unknown. Admission grants concurrency, process-start capacity, and memory together; memory waiters hold no execution permit or partial reservation. Each isolate has a 64 MiB heap, 16 MiB external-memory limit, and 30-second CPU limit. Each admitted run reserves 298 MiB: the isolate with its near-heap-limit headroom, run start, frames for five outstanding host calls on both sides, Rust result delivery, and the done text Rust holds before disposal. Startup plans the budget once and logs the plan. From 1,363 MiB it runs in lane mode: an 83 MiB interactive and a background transient pool capped at 232 MiB, with the rest dynamic. A background run is admitted only while the dynamic region keeps room for one interactive run with a lazy process (426 MiB), counting what interactive runs and the lazy processes they started already hold. From 854 MiB it runs in shared mode with one 172 MiB pool and no interactive reservation, and below that startup fails. Host-call permits come from the run's lane pool, FIFO and never lent across lanes. The canonical benchmark sets `SANDBOX_MEMORY_BUDGET_MIB=1904`, half of the measured 3,809 MiB host. Two shared core sidecars stay resident; data and full tiers load lazily. A lazy sidecar holds 128 MiB from start until its exit is confirmed. When an admission cannot fit, the least recently active idle lazy sidecar (no runs, waiting attempts, recovery round or admission lease) is closed, one per failed check. With `SANDBOX_PER_USER_SIDECARS`, each owner's user-tier scripts run in that owner's own lazily started sidecars instead of the shared ones. Startup is limited to 10 seconds, idle time to 60 seconds, and an isolate drains and recycles at 10,000 executions or its assigned RSS limit.

Every execution carries a lane, `interactive` or `background`, chosen by its initiating backend path and never by script kind, context, archive data or host-call arguments. Provider search, plugin operations, HTTP writes and imports, and population or translation for an entity a live session is viewing are interactive; imports, integrations, cron, user bootstrap, plugin installation and event streams are background. Child and kernel-child workflows, durable host calls and lifecycle writes inherit their parent's lane; before-stage and required after-stage automation runs use the lane of the command that created their trigger, and async after-stage runs are background. The lane is part of every lifecycle command's causation (persisted on automation triggers) and of the sandbox workflow, queue and translation payloads, so replay, recovery and restart keep it. A missing lane fails decoding. The admission lease and the Rust run frame use the lane the run was reserved with; Rust runs background workers at lower thread priority. The backend frame writer sends control frames first, then alternates host-result frames between lanes, interactive first. Because the sidecar preallocates each chunked message at its first part, the writer starts a chunked message only while those still in flight fit the sidecar's 64 MiB per-connection cap. Non-interactive messages leave 12 MiB of that free for one maximum interactive host result.

On Linux, the launcher path is fixed at `/usr/local/libexec/ryot-sandbox-launcher`. The launcher, executable, and snapshots are fixed and root-owned; runtime UIDs are 1001/1002, with isolates running as UID 1002. Isolates are non-dumpable, have core dumps disabled and no environment, and inherit only the socket. Landlock and seccomp enforce deny-all policies. The launcher verifies pidfd identity and attestation before terminating a child; there is no fallback when a required control fails. On non-Linux systems, `runtimeDirectory` defaults to `./sandboxd` and execution is explicitly unconfined.

## Invocation Context And Replay

Automation contexts contain trusted trigger and run IDs, hook slug, causation, occurrence time, execution user, optional hook metadata, and a deterministic projection of the retained trigger payload. The workflow uses the exact input projection pinned in the script manifest; the complete immutable trigger remains evidence and is not passed through by default. Scripts cannot replace ownership or parentage. Plugin configuration is not copied into the context and remains available only through `getPluginConfig` against the exact retained revision.

After-hook projections declare supported `entity`, `event`, `relationship`, `providerEntityImport`, and `signal` inputs. Mutation projections select nested properties; entity and relationship projections can separately select population parent-entity properties; update projections derive sorted `changedProperties` from declared JSON or unordered-array comparisons. Policy projections select request properties for entity, event, or relationship inputs. Before each policy, the workflow applies earlier accepted patches in order and projects the resulting request, so each policy sees the accepted chain rather than another policy's unvalidated output. RyotQL remains a current-state query surface and cannot recover omitted trigger-time values.

The 64 KiB context limit is measured on the complete UTF-8 invocation after projection and trusted automation fields are added. Retained batch chunking is a separate item-count concern and does not guarantee that every hook's projected invocation fits. Missing retained evidence or script artifacts and missing, incompatible, non-JSON, oversized, or schema-invalid projections fail closed before sandbox execution with bounded preparation diagnostics.

An unrecorded mutable `host.*` call ends replay unless it settles inline under the rules below. The workflow dispatches ending calls through their owning activity, child workflow, artifact operation, or diagnostic path, journals the typed success or failure, then replays. Recorded calls return their journaled results and never repeat backend dispatch.

Each successfully returned ending request records its validated JSON result and pinned target in a durable deferred slot owned by the parent execution and request index. A resumed body validates the complete current envelope and request identity before reusing that result, including when target resolution is already recorded. This preserves completed requests inside a partially settled batch; journal entries append in order only after the batch returns. Dispatch uses the original workflow instance so child cancellation remains attached to its owner. Failures, defects, interruption, and suspension do not complete a slot. A delayed completion message or concurrent cache miss may repeat an idempotent dispatch; the slot is not a single-flight guarantee.

### Journal projection

The workflow's append-only Redis projection is a hash holding, per entry, metadata `m:<index>` (byte length, chunk count, SHA-256 of the encoded entry) and chunks `c:<index>:<n>` of 1 MiB, the last shorter. Each activation appends only the new suffix in one atomic script. Appending identical metadata is a no-op; differing metadata at an existing index fails the run as a non-retryable infrastructure error and writes nothing. Every append refreshes the key's TTL.

A journal holds up to 100 MiB and each entry up to 12 MiB. Before admission, the queue worker reads only the metadata of the enqueued length and pins it; later entries are ignored and the backend never loads or decodes the prefix. Each `journalRead` returns at most the rest of one chunk, fetched under a journal-read permit; a Redis script re-checks the entry's pinned metadata and the chunk's length on every read, and an in-flight reply holds its permit through cancellation. Reads are limited to 2,048 per run and 200 MiB fetched, charged by whole chunk. The isolate reassembles each entry in external memory and validates its schema and index. The replay envelope must report the same journal length.

When inspection finds an enqueued entry missing, the replay returns `projectionMissing` without starting the script. A chunk read that finds the projection lost or changed fails the read and records a run-level fault that overrides the script's outcome, so a script cannot catch it: a lost projection returns `projectionMissing` and a changed or unreadable one fails as an infrastructure error. The body re-appends the full journal from persistence and retries under the next step ID, at most twice before failing with `resource-unavailable`. The replay outcome metric records these replays as `missing`.

### Inline durable calls

A replay batch contains every unrecorded request registered before its first unrecorded call runs. After validation by the execution-scoped gate, the sidecar sends an eligible batch over the framed socket and waits synchronously for results. This freezes JavaScript execution, fibers, and timers while the host settles the batch. Inline settlement requires every call to be activity-dispatched with a result bounded before it materializes and all HTTP origins, including redirect hops, to be proven unmatched by policy. Grant-carrying executions may settle inline.

The host settles inline batches through the same durable dispatch path used by workflow activities and returns one durable result per request. The sidecar extends its local journal; the queue result carries the entries to the workflow, which validates request identities and argument hashes and journals them before any request that ended replay. Recovery replays load them like any other entry.

The host defers the whole batch when indices do not continue the supplied journal, the batch or inline journal exceeds its byte limit, the declared result bounds of its requests exceed 80 MiB, the run's lane pool cannot reserve the batch at once, or dispatch fails. A settled batch keeps three times its journal evidence charged to that pool until the run ends, so later batches defer once that evidence leaves no room. In lane mode the interactive pool is smaller than a batch, so interactive batches always defer. A deferred batch may already have run some calls; replay may run them again.

Only a validated inline batch pauses the 30-second script timeout and extends session expiry. Settlement is limited to 30 seconds and five minutes absolute. The isolate must be disposed within two seconds before its resource reservation is refunded.

## Durable Ownership

- PostgreSQL workflow persistence is authoritative for execution, request completion, child/activity results, and terminal output.
- Redis contains only a reconstructible replay projection: request identity, argument hashes, and encoded results. Loss or expiry rebuilds it from the workflow body's in-memory journal.
- Request identity and argument hashes detect replay nondeterminism.
- Idempotent service operations run as activities; workflow-owning services compose as deterministic children.
- Each bounded `httpCall` network attempt is durable. External mutation is at-least-once across the crash window before its result persists; for inline calls that window spans the replay, whose queue result persists them.
- Input artifacts are pinned through workflow completion or cancellation. Generated chunks use opaque workflow-scoped handles; TTL is leak cleanup, not normal lifetime.
- Logs, spans, and console diagnostics are replay-tagged operational data, not journal entries.

Workflow code cannot use ambient time or randomness. Expected workflow failure uses the SDK's deterministic `Effect.fail`; a throw is a defect and becomes an execute-phase error. Trusted subjects override script-supplied `userId`; relayed import, integration, and automation attribution is owner-validated before dispatch.

## Filesystem And Artifacts

Filesystem capabilities come from compiler-derived execution metadata, but metadata does not name or authorize paths. The kernel supplies trusted artifact resources separately; without an artifact resource grant, reads fail with `missing-artifact-grant`. Scripts address files by logical keys, not paths. Backend file opens use no-follow semantics.

| Capability      | Grant                                              |
| --------------- | -------------------------------------------------- |
| `artifact-read` | Read-only access to one kernel-owned artifact.     |
| `scratch`       | Read/write access to the execution's scratch area. |

Artifact reads use 1 MiB slices; scratch writes are limited to 256 KiB. Before decoding a write, the backend reserves the combined pending and committed scratch quota of 5 MiB. Cleanup runs on every exit. Harvest accepts only the exact named files reported as completed; the backend copies those files to workflow storage and returns opaque handles. Consumers resolve a handle only against its trusted parent execution. Public results omit harvest metadata.

## Capabilities

The compiler derives each entry's local capabilities from its used code and persists them with compiled script metadata. The runner, ordinary host dispatch, durable dispatch, and filesystem grant creation all use that pinned metadata; filesystem access also requires trusted resources. Revision replay does not analyze current source or merge capabilities from child executables. Build and ingestion compare source-authored manifest fields such as identity, kind, projections, and provider search options separately from execution metadata; those authored fields do not supply grants. Runtime policy further restricts each inferred operation by script kind, subject, plugin scope, provider association, and bootstrap designation; domain services still enforce user, schema, provider, and integration ownership.

The contract package owns the capability vocabulary. `SANDBOX_CAPABILITY_REQUIREMENTS` is exhaustive for runtime policy, and durable host dispatch has exhaustive coverage for every host contract. Before-stage policies use only the policy-safe capability subset. Adding an operation requires updates at those canonical extension points, not a source-authored grant list.

The role table is the runtime policy ceiling. A script receives only methods permitted for its trusted principal and present in its pinned compiled capability list.

| Principal or role                   | Available bridge capabilities                                                                                                                                                            |
| ----------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| All valid subjects                  | `log`, `span`, `httpCall`, `getCachedValue`, `setCachedValue`, `getPersistentValue`, `getPluginConfig`, `claimPersistentValue`                                                           |
| User or user automation run         | `createEvents`, `getEntitySchemas`, `listEventSchemas`, `listIntegrations`, `getUserPreferences`, `getUserSettings`, `getCurrentIntegration`, `changeUserRelationships`, `executeRyotql` |
| System-plugin user-bootstrap script | `ensureUserEntities` for that plugin's entity schemas                                                                                                                                    |
| Pinned system-scope plugin script   | `executeRyotql`, `upsertGlobalEntities`, `upsertGlobalRelationships` within plugin ownership                                                                                             |
| User or system automation run       | `emitSignal`; `sendNotification` is available only to user automation runs                                                                                                               |
| Integration run of its own plugin   | `getOAuthAccessToken` and `invalidateOAuthAccessToken` for OAuth fields its current settings schema declares                                                                             |

`scratch` and `artifact-read` are not host calls. System elevation requires persisted authority for a verified kernel or system-scope plugin. User capabilities require a trusted user subject. `getEntitySchemas` uses that user's effective ready, enabled plugin catalog. Entity and event data reads use RyotQL; schema calls expose metadata only.

`upsertGlobalEntities` additionally requires provider association. `ensureUserEntities` is available only to the declared user-bootstrap script and remains scoped to entity schemas owned by that plugin.

Plugin config reads use compiler-generated required and optional key allowlists against the pinned
revision. Required reads fail when missing; optional reads omit unavailable values. Undeclared reads
and promotion of an optional-only key to a required read are denied. Executable calls and OAuth
connection fields are restricted to generated dependency facts. Normalized environment-key collisions
reject plugin loading.

OAuth token invalidation is limited to the current integration run and expires a connection only when
the submitted token matches the current token under a connection, token-version, and integration
binding compare-and-set.

Cache keys are isolated by executing user and logical provider ID, falling back to script ID only when no provider exists. Ordinary cache values are refreshed after backend restart; `claimPersistentValue` survives restart and writes only if absent. `getPersistentValue` reads the value in that same persistent namespace without claiming it or extending its expiry.

## Global HTTP Admission

Installed plugin `httpRateLimits` apply across all users, scripts, workflows, and backend instances in a deployment. Matching uses the normalized HTTP(S) origin: lowercase host, default port removed, IP literals canonicalized, and a fully qualified host's trailing dots stripped. Equal canonical declarations may coexist; conflicting declarations sharing a key or origin reject the entire proposed plugin state. Policies are live, so install, update, or uninstall affects the next resolution of an active workflow. PostgreSQL active manifests are authoritative; each call re-resolves policy from them, including after every durable wait.

Matched requests are admitted through execution-bound tickets. A ticket's identity is the workflow execution, request index, redirect hop, and `429` attempt; registration binds it to the declaration hash, the execution's lane, and its scheduling tenant and plugin (the execution user or `system`, and the pinned plugin or `kernel`). Registering the same binding again is a no-op; a different binding for an existing ticket fails closed. Each operation (`register`, `poll`, `claim`, `cancel`, `block`) is one Lua script over keys that share the policy's hash tag, run only inside a deterministically named activity, and uses Redis time. Script arguments, stored numbers, and replies are parsed strictly; a corrupt ticket fails only that ticket, and corrupt policy state fails the policy closed without refreshing its TTL.

`poll` renews the ticket and, when the policy's slot is open (spacing since the last admitted claim has passed and no block is active) and no grant is live, grants the slot to the first eligible ticket by lane, tenant ring, plugin ring, and FIFO within a plugin, visiting at most 16 flows, or to the polling ticket when none is found within that bound. Interactive tickets go first, but after four interactive claims while background tickets wait, a background ticket is preferred. A ticket is eligible when it is polling or its next poll is due within the grant lease, `max(spacing, 1 second)`. Skipped tenants and plugins keep their ring positions; rings advance only on an admitted claim, so plugin fan-out cannot raise a tenant's share. An unclaimed grant expires after one lease and leaves its ticket ineligible until it polls again. Other tickets get a wake hint estimated from their place in the rings, at least `min(spacing, 60 seconds)` and at most 60 seconds beyond any active block.

Only `claim` returning `admitted` lets a matched hop reach the network. It re-checks the grant's ticket and nonce, the declaration hash, the block, and spacing, then records the claim time as the spacing anchor and leaves a 10-minute tombstone, so a claim retried after a lost reply is admitted again without spending another slot. `poll` and `claim` report `unknown` for a missing, expired, or stale-hash ticket, and the waiter re-registers under the same identity; blocks and the spacing anchor live in policy state, survive restarts and declaration changes, and are never reset at startup.

A ticket lease lasts 120 seconds from the later of its last poll and the policy's block end; cancelled tickets are removed when the workflow is interrupted, and abandoned ones expire. Each command removes at most 16 expired or stale tickets and returns `retry` when that bound stops it. A policy holds at most 1,024 pending tickets, a tenant at most 64 per lane, and the shared `system` tenant at most 256; at a limit, registration returns `overloaded` without writing and the waiter backs off durably from one second, doubling to 30 seconds. Keys expire after `max(10 * intervalMs, 10 minutes)`, extended through an active block.

Only a matched HTTP `429` retries automatically. `Retry-After` accepts delta seconds or an HTTP date; missing or invalid values use the policy interval. The delay, capped at one hour, is added to Redis time to advance the global block before durable sleep and a retry under a new ticket. Non-`429` failures and unmatched calls do not retry. Coordination failures retry with deterministic one-second exponential durable backoff capped at 30 seconds; matched calls fail closed while coordination is unavailable, but proven-unmatched calls continue.

Redirects are followed by hand, at most five per call, with fetch semantics: `303`, and `POST` under `301` or `302`, become `GET` without a body or its content headers, and `Authorization`, `Cookie`, and `Proxy-Authorization` are dropped across origins. Scripts may not set `Host`. A durable network attempt follows a hop only when policy proves it unmatched; a matched hop or a failed lookup ends the attempt before the hop is requested, and the workflow journals it, admits it under a ticket for that hop, and continues from it in the next attempt. Inline settlement uses the same check and fails the call instead. An IP literal or other alias that reaches a declared host is not matched.

Ticket metrics record wait from registration to grant, grants, expired grants, and overloads by lane, policy key, and outcome. HTTP logs contain only workflow execution ID, request index, hop, policy key, normalized origin, stage, attempt, wait/duration, and status; each admitted matched hop logs its ticket wait (registration to grant) and resume delay (grant to network start) at info level. URLs, query strings, headers, bodies, credentials, users, tenants, plugins, and ticket identities are excluded.

## Recovery

Redis stores sidecar recovery state with a failure count capped at three. Reaching the cap suspends the queue until a healthy epoch. Recovery uses stable, exclusive probes. An owner/content pair is quarantined for one hour after three failures in ten minutes; probation probes run exclusively. System recovery state has a separate namespace. User-store failures fail closed.

## Failures

- Completed script failures identify `load`, `input`, `execute`, or `output` phase and may include source-mapped frames, each named by its authored path relative to the compiled module.
- Returned stacks remove data URLs, runner/dependency paths, execution IDs, and tokens.
- Timeout and unexpected isolate termination are workflow job failures. Generation and handle failures use structured module-owned reasons. Raw compiler/runtime diagnostics stay on explicit plugin-author, admin, and test surfaces; unexpected causes stay in logs.
- Console, `log`, and `span` output share bounded completed-result diagnostics. Oversized console logs append `[sandbox logs truncated]`; an oversized final value fails the output phase without partial data.
- Automation preparation reports missing artifacts separately from invalid projected input; neither condition falls back to the complete retained payload.
- Normal APIs and persisted workflows use structured module-owned kebab-case reasons, never diagnostic prose.

Completed results include `timing: { totalMs, executionMs }`.

## Limits

Runtime and compiler limits are set by their owners, not environment settings.

| Boundary                                                           |                                      Limit |
| ------------------------------------------------------------------ | -----------------------------------------: |
| Source / manifest / compiled JavaScript                            |                   256 KiB / 16 KiB / 1 MiB |
| Compiler concurrency / timeout / sampled Linux process-tree memory |                    2 / 5 seconds / 384 MiB |
| Compiler diagnostics                                               |                      100 entries / 256 KiB |
| Local replay timeout / context / final result                      |                30 seconds / 64 KiB / 4 MiB |
| Runner request                                                     |                                      2 MiB |
| Host calls / HTTP subset / concurrent in-flight calls              |                             1,000 / 50 / 4 |
| Journal / entry / chunk / maximum reads / fetched data             | 100 MiB / 12 MiB / 1 MiB / 2,048 / 200 MiB |
| Host-call request / response / durable response                    |                    1 MiB / 10 MiB / 12 MiB |
| HTTP request / streamed response / attempt timeout                 |                 1 MiB / 10 MiB / 8 seconds |
| Startup diagnostics                                                |                                     64 KiB |
| Console logs                                                       |     500 entries, 8 KiB each, 256 KiB total |
| `log` and `span` observability                                     |     500 entries, 8 KiB each, 256 KiB total |
| Cache key / value / maximum TTL                                    |              256 bytes / 256 KiB / 30 days |
| Scratch quota / write                                              |                            5 MiB / 256 KiB |
| Isolate heap / external memory / CPU                               |               64 MiB / 16 MiB / 30 seconds |
| Sandbox `executeRyotql` result                                     |                                      1 MiB |

Compiler memory is sampled proportional set size in the Linux production image, not a cgroup hard ceiling. Non-Linux development keeps process, timeout, and concurrency bounds without claiming portable memory enforcement. Calls beyond per-session concurrency wait; cumulative budgets still apply. Each host call takes a FIFO transient-memory permit covering its decoded arguments and its result before decoding arguments, and holds it until the host work ends and the reply is written or purged. Capabilities whose results are unbounded before they materialize never bind live or settle inline; the workflow body dispatches them. Sandbox `executeRyotql` results are measured as JSON by PostgreSQL across the document's named queries and fail with `result-too-large` before any rows leave the database. Session registration and removal are identity-aware so replacement, expiry, interruption, or a late finalizer cannot evict a newer session.

## Liveness And Pruning

Database pruning uses persisted liveness under the plugin-ingestion fence. It retains current plugin rows, accepted automation runs inside their artifact window, source-zero kernel scripts referenced from `kernel_script`, and running or suspended workflow references. Pruning removes only unreferenced database rows in a transaction; it does not sweep compiled caches or files. Persisted workflow references protect suspended work, and retained automation runs protect their exact script, plugin, and configuration pins through retry and manual replay. Completion or cancellation releases workflow references.
