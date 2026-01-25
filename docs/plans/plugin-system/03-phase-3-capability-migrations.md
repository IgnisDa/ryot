# Phase 3 — Capability migrations

Status: in progress. Steps 0-3 are complete; resume with Step 4, whose design is fully settled
(owner, 2026-07-27) in §4 below and which spans tasks 07-10. Do not recreate the removed
multi-entrypoint driver model while implementing later steps.

Goal: move the remaining native domain code into the plugins, one capability at a time. Step 0's
two prerequisites establish the authoring and observability foundations. Each capability step
(a) adds a small generic slice of kernel capability (manifest section + host functions), (b)
rewrites the domain logic as plugin scripts, (c) deletes the native module, and (d) re-points the
corresponding e2e suites with assertions preserved. Tasks are strictly ordered; a prerequisite is
done only when its explicit criteria and gates pass, and a capability step is done only when its
native code is deleted and the suite is green.

Standing rules for every host function added in this phase (Decision 8): batch-first
signatures; query pushdown via `executeQueryEngine` rather than new list-and-filter
functions; coarse atomic writes; generic naming and semantics (never explicable only by
media). Every new host function follows the existing contract pattern
(`libs/sandbox-sdk` contract + `bridge-adapter.ts` validation + `host-functions.ts`
implementation + limits entry) and gets observability: a span per host call already exists
via the bridge; add structured log/span host functions in step 0 so plugin code is debuggable.

## Step 0 — Sandbox authoring upgrades (two ordered prerequisites)

Status: complete.

### Step 0a — Effect-native sandbox cutover

- **[DECIDED] Effect is the sole script authoring and typed host-function API.** Vendor `effect`
  (host-pinned version) as an approved sandbox dependency by extending `libs/sandbox-sdk` and the
  import map / `PackageCacheManager` in `sandbox-runtime/dependencies.ts`. It is runtime-provided
  and never bundled per script.
- Change every script-facing host function to return an `Effect` with a typed error. Change
  generic, provider, and automation `run` functions to return `Effect` values, and have
  the Deno runner execute them through the vendored runtime. Remove the raw Promise authoring API;
  do not retain wrappers, aliases, or a second script contract for compatibility.
- Replace the sandbox SDK's Zod schema surface with Effect Schema for manifests, script
  input/output, and host-function wire contracts. The compiler and runner decode these contracts
  with Effect Schema, and Zod is removed from the approved sandbox dependencies. Declarative
  `AppSchema` property metadata remains unchanged under Decision 6.
- Make backend host-function implementations, `bridge-adapter.ts` validation/dispatch, and the
  typed bridge handler Effect-native. Promise-based platform operations such as the Deno
  runner's loopback `fetch` remain private transport details and are wrapped into Effect at that
  boundary; they are not exposed in SDK or backend host-function contracts.
- Migrate every existing media-plugin, fitness-plugin, kernel source-zero script, compiler
  fixture, SDK test helper, and sandbox execution test in this cutover. The task is complete only
  when no Promise-based script entrypoint or host-function contract remains and all existing scripts
  execute with behavior unchanged.
- Approved-dependency additions later in this phase (e.g. `fflate` in step 4) follow the same
  vendoring mechanism established here.

Rationale: cutting over before any capability migration gives every Phase 3 host function and
script one authoring model. A gradual per-capability migration would preserve two public APIs,
duplicate contracts and tests, and make their eventual removal a second cross-cutting migration.
The branch has no deployment or persisted-script compatibility constraint, so the existing
scripts can migrate atomically with the runtime.

### Step 0b — Structured sandbox observability

- Add batch-first `log`/`span` host functions (structured, threaded into the execution's OTLP
  trace and `subscription_run`-style bookkeeping) using the Effect-native contract established
  in Step 0a. Scripts writing substantial logic need better than `console.log` collection.
- Follow the existing full host-function pattern and limits: SDK contract, bridge validation,
  implementation, capability gating, bounded artifacts, and focused tests.

Step 0a and Step 0b are separate tasks and strictly ordered. Step 1 cannot begin until both are
done and the full gates pass.

## Step 1 — Crons: `media-trending` + `exercises`

Status: complete.

Kernel capability:

- Manifest section `crons: [{ slug, schedule, scriptSlug, description }]` (cron expression
  format = whatever the existing scheduler module consumes; the kernel owns the tick).
- Scheduler dispatches each due cron as a sandbox execution of the referenced script and awaits
  its terminal workflow result before advancing the scheduler loop; idempotency stays with the
  script.
- New host functions (shapes **[IMPLEMENTER-DECIDES]**, semantics fixed):
  - `upsertGlobalEntities(items[])` — batch, coarse-atomic per item (entity + provenance),
    preserve-existing semantics matching today's trending refresh writes.
  - `upsertGlobalRelationships(items[])` — same for relationship edges.
  - Both are global-scope (no user) and must be capability-gated so a standard provider script
    cannot write global data. These capabilities are selected from trusted system authority plus
    generic script metadata, never from an executable name.

**Implementation choice (2026-07-24, owner-approved):** `upsertGlobalEntities(items)` accepts
`{ entitySchemaSlug, externalId, name, properties, populatedAt }` items, injects provenance from
the executing script, preserves an existing global entity, and returns aligned upsert results
(refined by the amendment below). `upsertGlobalRelationships(items)` accepts atomic
reconciliation groups shaped as `{ relationshipSchemaSlug, selector, relationships[] }`; each
group validates and upserts its listed edges and deletes absent global edges matching the generic
selector in one transaction, returning mutation counts. Treating a relationship item as a set
rather than a single edge preserves the native trending refresh's stale-edge deletion without a
media-specific syscall or a separate list-and-filter host function.

**Implementation choice amendment (2026-07-24, owner-approved):**
`upsertGlobalEntities(items, options?)` additionally accepts a generic
`{ maximumTotal?: number }` bound. When supplied, the kernel counts existing global entities for
each affected `(entitySchemaSlug, executing-script provenance)` scope and atomically skips absent
items after that scope reaches the maximum; aligned results are discriminated as upserted
`{ status: "upserted", entityId, wasInserted }` or `{ status: "skipped" }`. This preserves the
exercise preload cap when an upstream catalog reorder leaves previously imported entities outside
the current prefix, without adding a list/count syscall or moving persistence knowledge into the
plugin.

**Implementation choice amendment (2026-07-26, owner-approved):** exercise preload is
one-time catalog seeding, not periodic refresh work, and the `crons` scheduler only fires on
its wall-clock schedule — a server that restarts before the next tick (or a fresh install)
never seeds any exercises, regressing the native preloader's per-boot behavior. A sibling
manifest section `boot: [{ slug, scriptSlug, description }]` (no `schedule`) declares scripts
the kernel dispatches exactly once per server start, immediately after plugin ingestion, and
server startup awaits every terminal boot-script result; dispatch is skipped when
`scheduler.disableDispatchers` is set, matching the other schedulers. Boot scripts expose a
direct generic entrypoint, and the `upsertGlobalEntities`/`upsertGlobalRelationships` gate uses
server-created system authority. Scheduler-owned cron and boot executions receive that authority;
standard provider scripts do not, including when called by scheduler-driven population. The fitness
`preload-exercises` entry moves from `crons` to `boot`; `media-trending` stays a `crons` entry
because it is genuinely periodic. Boot dispatch uses a per-boot execution id, so the already
idempotent preload script (preserve-existing upserts + `maximumTotal`) absorbs re-runs exactly
as it did as a cron.

**Implementation choice amendment (2026-07-28, owner-approved):** cron and boot dispatch use one
awaited path in every environment. Each `RunSandboxWorkflow` is awaited to a terminal result;
production no longer passes `discard: true`, and boot dispatch is no longer forked from server
startup. There are no dependent clients or rollout constraints requiring early readiness, and one
path avoids leaving durable work behind after the caller has reported completion. Failures remain
isolated per manifest entry and are logged so later entries still run.

Migrate: `modules/media-trending` (poll providers → write trending global entities +
refresh workflow + infrequent task) becomes a cron-driven plugin script, and
`modules/exercises` (free-exercise-db preload) becomes a boot-driven plugin script. The
trending _read_ path (whatever serves trending to clients) should already be
query-engine-based; if any native read code remains, it moves to a saved view / recipe or
waits for step 2's operations.

Delete: `modules/media-trending`, `modules/exercises` (and their contract surface if any —
check `libs/contract`). E2e: `tests/src/tests/exercises/` re-pointed to rely on boot dispatch
(no manual trigger needed) + trending coverage re-pointed (cron trigger fixture already
exists: `triggerInfrequentCron`).

Done: both modules deleted; exercises + trending e2e green; `crons` and `boot` manifest
sections documented in `libs/plugin-kit`.

## Step 2 — Operations (invoke): `metadata-lookup` + `episode-resolver`

Status: complete.

Kernel capability:

- Manifest section `operations: [{ slug, scriptSlug, auth, description }]`, where `auth` is
  `user` or `integration`. Input/output Effect Schemas live on the direct operation definition.
- One new contract endpoint: `plugins.invoke(pluginSlug, operationSlug, payload)` —
  validates against the declared schemas, dispatches to the direct script, returns the result.
  Batch-first: an operation's payload is naturally a batch (e.g., resolve N episode refs in
  one call).
- First-party client typing ("recipes"): plugin package exports its operation input/output
  types; clients import them and call `invoke` through a small typed wrapper in
  `libs/plugin-kit` **[RECOMMENDED]**.

Migrate:

- `modules/metadata-lookup` → media plugin operations. The **browser extension**
  (`apps/browser-extension`) migrates in the same step to the invoke endpoint — it is the
  only external consumer (verified; `app-client` has no metadata-lookup usage).
- `modules/episode-resolver` → media plugin. Note its consumers are mostly _internal_
  (import/integration flows). Until those flows themselves migrate (steps 3–4), the interim
  wiring is: kernel code that still needs episode resolution calls the plugin operation
  through the same dispatch path the invoke endpoint uses (an internal `invokeOperation`
  service function — same code path, no HTTP). This is temporary scaffolding that
  disappears as steps 3–4 move the callers into the plugin, where they can import the
  resolver logic directly as shared package code.

Delete: both modules + the `metadata-lookup` contract group (`media-monitoring`'s group
survives until step 5). E2e: metadata-lookup/browser-extension integration tests re-pointed
to invoke.

Done: modules deleted; invoke endpoint covered by kernel tests (schema validation, auth,
unknown operation) + migrated suites green; extension works against invoke.

**Implementation choices (2026-07-25, owner-approved):**

1. **Operation `auth` supports `user` and `integration`; the proposed `admin` mode was removed
   (owner-approved during the single-entrypoint rewrite).** The browser extension — the sole
   external `metadata-lookup` consumer, which task 04 requires migrating onto `plugins.invoke` — is
   **public, holds no user session, and runs its lookup as the integration's owning user** (the
   native `MetadataLookupService.lookup` loads the integration via `getByIdAnyUser` and searches as
   `integration.userId` so the owner's NSFW preference applies). A two-value enum cannot express
   this, so `auth` is `"user" | "integration"`. No current plugin operation requires admin
   invocation; trusted scheduler work uses system execution authority and is not exposed through
   the public invoke endpoint. For an `integration` operation,
   `plugins.invoke` carries an integration id; the **kernel integrations framework** (which stays in
   the kernel under Decision 14, so this is generic, not media-specific) resolves it to the owning
   user, verifies the integration is enabled, and dispatches the operation with that user's context
   and **no session required**. The integration id remains the credential exactly as today, so
   behavior (including owner-scoped preferences) is preserved. The generic invoke endpoint has no
   group middleware; the handler reads the operation's declared `auth` from the registry and
   enforces it conditionally (resolving `CurrentUser` from request headers itself for `user` and
   the integration for `integration`), keeping the single generic
   endpoint intact (Decision 9). `metadata-lookup` = `integration`; `resolve-episodes` = `user`.
2. **Operation input/output Effect Schemas live on the script definition, not serialized into the manifest
   entry.** The manifest section is `operations: [{ slug, scriptSlug, auth, description }]`. Effect
   Schemas cannot round-trip through `PluginManifest`'s own `Schema.decodeUnknown` (manifests are
   plain data), and provider/cron scripts already carry their `input`/`output` schemas in
   the `.sandbox.ts` module. `plugins.invoke` validates against the declared schemas the same way
   every script already does: the sandbox runner decodes the payload against the definition's
   `input` and the result against its `output`. This realizes the plan's "validates against the declared
   input/output schemas" within the existing architecture rather than duplicating schema data.

   **Operation scripts use a dedicated `operation` sandbox-script kind** (owner-approved
   2026-07-25). `libs/plugin-kit`'s `PluginScript` union deliberately rejects the generic
   `kind: "script"` catch-all (pinned by `manifest.test.ts`), so rather than open it, a first-class
   `kind: "operation"` is added across `@ryot/sandbox-sdk` (manifest-schema union + a
   `defineOperation` authoring helper), the compiler, and `PluginScript`. Operation scripts expose
   one direct `input`/`output`/`run` entrypoint; the kernel resolves `operations[].scriptSlug`
   before enqueueing the script ID. Keeping the generic catch-all closed and giving typed
   capabilities their own kinds remains the pattern Step 3's workflow scripts should follow where
   determinism requires a distinct host surface. Operations reuse only existing host
   capabilities (metadata-lookup: `httpCall`/`getAppConfigValue`/`getUserPreferences`/`getIntegration`
   composed with the in-repo TMDB provider search implementations; resolve-episodes: `executeQueryEngine`),
   so no new host functions or capability scopes are added this step.

3. **`episode-resolver` becomes a single batch-first `resolve-episodes` operation.** Input is
   `{ refs: [...] }` where each ref is discriminated `show` (showEntityId, seasonNumber,
   episodeNumber) or `podcast` (podcastEntityId, episodeNumber); output is aligned
   `{ entityId | null }[]` (unique-match-wins, matching the native ambiguity rule). It is
   implemented with `executeQueryEngine` (multi-hop relationship traversal `show→season→episode`
   via `EntitySource.via` plus JSONB property equality on `seasonNumber`/`episodeNumber`, run as the
   caller's user), keeping provider-catalog/resolution knowledge in sandbox scripts per
   `apps/app-backend/AGENTS.md`. The interim internal callers (import writing/event-target
   workflows) reach it through the temporary `invokeOperation` service path with single-element
   `refs` arrays until steps 3–4 move those callers into the plugin. `auth: "user"`.
4. **First-party recipe typing = a generic typed invoker in `libs/plugin-kit` plus
   plugin-exported operation types.** `plugins/media` exports its operation input/output types
   (derived from the operation schemas); `libs/plugin-kit` exports a small generic typed `invoke`
   wrapper over the `plugins.invoke` contract call. The browser extension imports the media
   operation type and the plugin-kit invoker, so no plugin-specific contract endpoint is added
   (Decision 9).
5. **The title parse/match helpers are transitionally duplicated into the media plugin; step 4
   deletes the kernel copy.** `lib/shared/title-parsing.ts` and `lib/shared/title-matching.ts`
   (`extractMetadataLookupBaseTitle`, `extractMetadataLookupSeasonEpisode`,
   `chooseBestMetadataLookupTitleMatch`) had two kernel consumers: the deleted
   `modules/metadata-lookup`, and the **Netflix import source adapter**
   (`modules/imports/sources/netflix/{adapter,processor}.ts`), which is media-specific and moves
   into the plugin in step 4. The kernel must not import plugin code (Decision 2) and sandbox
   scripts cannot import kernel code, so the logic is copied into `plugins/media/shared/` for the
   metadata-lookup operation while the kernel copy stays **solely** for the Netflix adapter.
   **Step 4 action:** when the Netflix adapter moves into the plugin, delete
   `apps/app-backend/src/lib/shared/title-parsing.ts`, `title-matching.ts`, and their tests, and
   point the migrated adapter at the plugin-side copy — leaving one owner. This is the only
   duplication step 2 introduces; task 09's cleanup pass must not "resolve" it earlier by making
   the kernel depend on the plugin.

## Step 3 — Durable workflows: media import population/resolution **(spike first)**

Status: complete.

**Spike status: complete (2026-07-26), owner-approved.** The mandatory spike ran twice — first
the journal-in-context design ("A"), then the owner-selected journal-via-host-calls design
("A-prime") — each as throwaway code exercised through suspend/resume, a SIGINT process
restart, an induced timeout, a hot swap, and a concurrency smoke test. The spike code was
discarded; its findings and the resulting design are recorded below and supersede any earlier
wording in this section. **Task 06 implements the A-prime design.**

Kernel capability:

- Manifest section `workflows: [{ slug, scriptSlug }]`.
- Workflow scripts are replay-deterministic. The kernel's durable engine (existing Effect
  workflow machinery) runs a _workflow shell_ whose body repeatedly executes the script as an
  ordinary sandbox execution; the script is a **pure function of its input plus the journal**.
  All IO is performed by the shell, never by the script:
  - `activity(name, scriptRef, input)` — the shell runs the referenced direct activity script
    once and journals the result; replays return the journaled result without re-execution.
  - `sleep(name, duration)` — durable timer via the engine.
  - `child(name, workflowRef, input)` — composes another manifest workflow with a
    **deterministic execution id** derived from parent id + name (this preserves the
    existing hard rule in `apps/app-backend/AGENTS.md` §Queues about deterministic child
    ids).
  - The journal is keyed by call sequence + name; a replay that diverges fails the execution
    with a structured nondeterminism error.
- Version pinning: an execution records the script row's `contentHash` and resolved `scriptId`
  at start; every replay loads exactly that module (Phase 2's immutable-per-hash script rows
  make this a lookup). A hot swap never changes a running execution's code.
- Determinism guard rails: workflow scripts get **no IO capabilities at all** — the journal
  read is their only host function — so the guard rail is structural rather than a matter of
  scoping a large capability set.
- Limits: the workflow and activity script kinds get their own budget profile — add
  per-script-kind limit selection now, kernel-owned ceilings (numbers below).

### Spike findings and the A-prime design **[DECIDED]** (2026-07-26, owner-approved)

**A host call cannot suspend a durable execution — suspension is expressed by the replay
ending.** `BridgeService` serves every `/rpc/<executionId>/<fn>` call in its own
`Runtime.runPromise` (`sandbox-runtime/runtime.ts`), outside the workflow execution's Effect
scope, and the Deno runner blocks on `fetch` while the backend is parked on
`worker.responseQueue.take`. A host call can therefore only return a value. This is not a
limitation of the bridge: a Deno process's JS continuation cannot be persisted, so any design
whose control flow spans a durable boundary must either re-execute the script from the top
(Temporal/Cadence/Restate/DBOS model) or degrade into a long blocking call that holds a pool
slot and loses all state on process death. Do not "fix" this by rearchitecting the bridge; the
re-execution model is the intended architecture. Decision 7 stands as written — `activity`,
`sleep`, and `child` are host functions that return recorded results — with the single
clarification that the *pending* case ends the replay instead of returning.

**The shell loop.** The workflow body, bounded by a kernel-owned max-step constant:

1. An `Activity.make` at the start pins the workflow script's `scriptId` + `contentHash`.
2. Rebuild the journal from the body's own memoized durable calls, and project it into Redis
   (below) for the upcoming replay.
3. Dispatch the pinned workflow script as a sandbox execution with a deterministic execution id
   (`${executionId}-replay-${n}`). Its context carries only the workflow input — never the
   journal (measured constant at 99–136 bytes regardless of journal size).
4. The script replays. Each `activity`/`sleep`/`child` call is a host call that returns the
   recorded result on a hit; on a miss the kernel records the pending request and the script's
   primitive short-circuits, ending the replay.
5. Read the recorded pending request **inside an `Activity.make`** so the observation is
   durably memoized, then perform it **from the workflow body** (never inside an activity —
   the `AGENTS.md` rule that activities must not start durable work still holds), append to the
   journal, and loop. `done` returns the script's output.

**Journal storage: memoized durable calls, no journal table.** Durability rests entirely on
`@effect/workflow` memoization (`SandboxExecutionQueue.idempotencyKey` is the execution id, and
`cluster_messages` holds the replies). The Redis projection — a hash keyed by the parent
workflow execution id, one write-once (`HSETNX`) field per journal index, TTL'd — exists only so
the bridge handler can read entries from its separate fiber. **Redis is never the source of
truth**: the projection was deliberately deleted mid-flight during the spike and the execution
still completed correctly, because the next body pass rebuilt it from the durable memos. Use a
high-water-mark field rather than an `HLEN`-equality guard when deciding whether to re-project;
the projection legitimately runs ahead of a partially rebuilt journal.

**Journal transport is O(n) bytes per replay, and that is inherent.** A-prime removes the hard
*cap* and all context pressure, not the transfer: the script re-reads its prefix on every
replay, exactly as a Temporal worker re-reads history. Under A the accumulated journal rode in
the script context and hit `sandboxContextError` (256 KiB, `sandbox-runtime/limits.ts`), which
killed a workflow whose activity output totalled 528 KB — mid-flight, with a message that reads
like a sandbox bug. Under A-prime the same workflow completes, a ~830 KB accumulated journal
completes, and a single replay carried 3.99 MB of recorded values without complaint. The new
binding limit is `execution.resultBytes` on the script's own **output**, which is a legitimate
limit on what a workflow returns.

**Ship the journal read as a bulk, batch-first host call.** Per-entry reads cost ~23 ms fixed
for the first call in a replay plus ~5 ms marginal per additional call, and grow O(n) calls per
replay (measured: 65 host calls total for a 10-activity workflow, 10 in its final replay). A
200-step workflow would pay ~1 s of pure host-call latency on its last replay. The shape to
implement is a single prefix read the SDK primitive issues once per replay and caches
in-process, with per-call validation preserved server-side:
`durableCalls(requests: ReadonlyArray<{ index, kind, name, args }>) => ReadonlyArray<{ status: "recorded", value } | { status: "pending" }>`.
The bulk variant was recommended by the spike but **not measured** — task 06 owns validating it.

**Implementation choice amendment (2026-07-26, owner-approved):** validating the proposed
aligned request/response shape exposed a contradiction for value-dependent calls: a script cannot
construct call `n + 1` until it receives call `n`'s recorded value, so submitting the growing
request prefix necessarily makes multiple bridge calls per replay. Task 06 therefore uses one
argument-free `durableCalls()` bootstrap call that bulk-reads the complete recorded projection and
caches it in the workflow SDK. The SDK consumes recorded values locally and returns the complete
encountered call trace in the sandbox result envelope when the replay completes or reaches the first
missing entry. Before accepting completion or performing pending work, the trusted kernel validates
every encountered `(index, kind, name, argsHash)` against the durable journal and requires exactly
one additional request for the pending case. This preserves one journal-read bridge call per replay,
kernel-side nondeterminism detection, journal-via-host-call transport, and Redis's projection-only
role; it supersedes only the aligned `durableCalls(requests) => responses` wire shape above.

**Replay ordering is validated kernel-side on `(index, kind, name, argsHash)`.** The kernel sees
each call live and rejects divergence with a structured nondeterminism error before returning
anything, e.g. `journal[0] recorded activity:alpha args#<hash> but the script requested
activity:beta args#<hash>`. Hashing the args (`stableStringify` + sha256) is required, not
optional: without it a script that calls `activity("fetch", A)` and on replay calls
`activity("fetch", B)` silently receives A's result. Validation must live in the kernel rather
than in the SDK, because the kernel is trusted and the script is not. Check the divergence
outcome **before** the generic script-error branch, or a divergence surfaces as an opaque script
failure and loses its detail.

**Serialization.** Values cross as JSON, so `undefined` properties are dropped, `-0` becomes
`0`, and integers beyond `Number.MAX_SAFE_INTEGER` lose precision — pass those as strings.
Everything else survived: `null`, empty objects/arrays, float artifacts
(`0.1 + 0.2 → 0.30000000000000004`), ISO date strings, unicode, deep nesting, and even NUL
bytes through the runner line protocol, `cluster_messages`, and Redis. Effect Schema is
transparent here (`Schema.Unknown`); the losses are the JSON layer's.

**Timeouts.** An activity exceeding `config.sandbox.timeoutMs` surfaces as a **typed failure**
(`Sandbox timed out after 6000ms`) from `DurableQueue.process` via the `Effect.raceFirst` in
`sandbox-runtime/service.ts` — not as a `SandboxCompletedResult` with `error` set. It is not
retried, the failure itself is memoized (so a 60 s busy loop costs one 6 s timeout, not one per
replay), the journal is not corrupted, and the workflow makes progress afterwards. Task 06 owns
the explicit retry policy decision.

**Implementation choice (2026-07-26): no automatic application-level retries.** Activity
timeouts, queue failures, child failures, and completed activity errors fail the workflow; the
durable engine memoizes the failure rather than re-executing the side effect during replay. A
workflow-script failure without a pending durable request also fails immediately. This preserves
at-most-once activity execution under replay and leaves any future retry policy explicit at the
workflow-authoring layer rather than hidden in the kernel shell.

**Process restart mid-execution.** SIGINT during a durable sleep followed by a respawn against
the same Postgres/Redis resumed and completed with **zero re-execution** of prior steps —
proven three ways: a pre-restart activity's timestamp appeared verbatim in the post-restart
output, replay `executionMs` floats were byte-identical across passes, and distinct activity
executions stayed at 2 despite 8 `activity-done` records. `sleep` only suspends durably if
`inMemoryThreshold` is set explicitly and small; with the 60 s default a 15 s sleep never
suspends.

**The workflow body re-runs from the top once per durable call.** 4 durable steps produced 8
body passes and 28 memoized-reply reads for 7 real sandbox executions — roughly O(n²/2) reads.
This is cheap (local `cluster_messages` reads) but it is the reason to prefer **batch
activities**: one journal entry holding an array of results, per Decision 8's batch-first rule.
A concurrency smoke test (10 simultaneous executions × 3 activities) completed 10/10 in 4021 ms
against 2082 ms for a single execution, with no lock or pool errors.

**Pinning requires bypassing active-version re-resolution.** Pinning works because the resolved
`scriptId` lives in the immutable workflow payload and the shell dispatches the sandbox queue
directly. `processSandboxExecution` must **not** be used inside a replay loop:
`resolveSandboxExecutionPayload` (`modules/sandbox/durable-queues.ts`) unconditionally calls
`findActiveScriptById`, which resolves the stored row's `pluginSlug`+`slug` to the *currently
active* script (`modules/plugins/runtime-resolver.ts`) — after a hot swap that is the new
version, which would silently switch a running execution's code. Task 06 gives that function an
explicit mode: re-resolve for entry-point dispatch, pin inside durable replay loops. A hot swap
performed while an execution was suspended was confirmed to resume on the original module.

**Capability gating needs a kernel-side check, not just a manifest string.**
`selectSandboxHostFunctions` (`sandbox-runtime/service.ts`) only restricts capabilities that
appear in `automationHostFunctions` or `systemCronHostFunctions`; anything outside those sets is
granted to any script that declares it in its manifest, since
`allowedHostFunctions` is `script.metadata.capabilities` passed straight through
(`modules/sandbox/durable-queues.ts`). The journal capability must therefore be gated
kernel-side on the workflow script kind, following the `systemCronHostFunctions` precedent
(which gates on trusted authority plus `metadata.kind`).

**A distinct `workflow` script kind is still required — justified by determinism, not by
capabilities.** Since the script needs no IO capabilities, a capability-restricted kind buys
nothing that `capabilities: []` does not. The kind earns its place by enforcing the replay
contract: force the empty IO capability set at ingestion, reject or shim the nondeterministic
globals (`Date.now`, `Math.random`) that would make a replay diverge invisibly, and carry the
limit profile below. Follow the `kind: "operation"` precedent from step 2 rather than opening
the generic `kind: "script"` catch-all.

**Implementation choice (2026-07-26): workflow activities use a distinct `activity` script kind.**
The shell resolves activity references only within the owning plugin and rejects generic,
operation, provider, automation, and workflow scripts. Activities retain the standard execution
profile and their declared capabilities; workflow scripts receive only the journal bootstrap
host call. The workflow SDK exposes a deterministic Effect subset, compiler validation rejects
unrestricted Effect imports and direct ambient time/random usage in reachable modules, and the
runner keeps time/random guards active through Effect callbacks while preserving deterministic
date parsing.

**Per-script-kind limit profile (kernel-owned ceilings):**

| Limit | Workflow kind | Rationale |
| ------------------------ | ------------- | --------------------------------------------------------------------- |
| `execution.contextBytes` | 64 KiB | measured 99–136 B, constant regardless of journal size |
| `execution.resultBytes` | 4 MiB | the actual binding limit; 1 MiB broke a 5-step workflow's own output |
| `hostCalls.total` | 1000 | budget is **per execution**, so it caps workflow length, not lifetime |
| `bridge.responseBytes` | 10 MiB (keep) | carried 3.99 MB in one replay without issue |
| timeout | ≥ 30 s | a pure replay took 4–9 ms (A) / 23–42 ms (A-prime) at 3–10 entries |

Activity script kinds keep the current profile.

**Task 06 closure:** the implementation covers deterministic `child` dispatch, divergence beyond
`journal[0]`, the bulk journal read, fail-mid-replay validation, and exact workflow pinning. Media
imports split resolution and population into deterministic children bounded by both the 64 KiB
context ceiling and the 1,000-step ceiling, with bounded chunk fan-out. Unit coverage proves the
packing and orchestration behavior at 400 three-candidate resolution items and 1,001 population
items. Production pool and lock pressure under several simultaneous full-size imports remains an
operational load-test risk and must be measured before the Phase 3 gate; the in-process plugin tests
are alignment tests and do not claim that coverage.

**`EventCreateWorkflow` composition [IMPLEMENTER-DECIDES] → resolved: `child`.** It is a
kernel-owned `Workflow`, not a sandbox script, so exposing it as an activity host op would mean
faking it as one. The shell dispatches it as a child from the workflow body with a deterministic
id, which preserves single durable ownership.

Migrate: `imports/media/population-workflow.ts` and `resolution-workflow.ts` (and the
population trigger path in `entities/population-trigger.ts` + `entity-import` where
media-specific) become media-plugin workflows + activities. The kernel `imports` framework
(run tracking, file handling) and `entity-import`'s generic surface stay. Preserve the
documented keying/idempotency semantics (ensure-mode, preserve-existing upserts, `EventCreateWorkflow` composition
— which remains a kernel-owned workflow callable as an activity host op or composed via
`child` against kernel workflows, keeping single durable ownership intact).

Delete: the media-specific workflow definitions from `imports/`. E2e:
`entity-import`/`imports` suites re-pointed; add kernel tests for replay determinism
(induced suspend/replay, nondeterminism detection, pinning across a hot swap — the latter is
one of the most important tests in the repo).

Done: media import population/resolution run as plugin workflows end-to-end; import e2e
suites green; spike findings recorded (done — see the spike findings subsection above).

## Step 4 — Integration adapters, import sources, and filesystem grants

Status: not started. Every design question in this step was settled with the project owner on
2026-07-27; the subsections below are the authoritative record and there is nothing left open.

This step is larger than the others: it lands one kernel capability slice, then migrates every
integration adapter and every import source into the two plugins, and ends with
`modules/integrations` and `modules/imports` holding frameworks only. It is split across tasks
07–10 in `docs/tasks/plugin-system-phase-3/`, each with its own gates. Ordering inside the step is
fixed: kernel capability → integration adapters → import framework collapse + fitness sources →
media sources. Fitness comes before media deliberately — three simple CSV adapters prove the
generic import dispatch path before the sixteen-adapter media migration lands on it.

### Kernel capability

**Manifest section `integrationProviders`, lot-discriminated** [DECIDED]. A plugin declares:

```txt
{ slug, lot: "yank" | "sink", name, description, scriptSlug, settingsSchema }
{ slug, lot: "push",          name, description,             settingsSchema }
```

Push targets (radarr, sonarr, jellyfin_push) are already `kind: "automation"` scripts dispatched
through `bindings.eventAutomations` (moved in Phase 2); the kernel never routes them through an
adapter path. A `scriptSlug` on a push entry would therefore be a field that means nothing for a
third of the values, so the section is lot-discriminated rather than carrying an optional
`scriptSlug`. Push entries exist in the registry so the kernel can list the provider and validate
its settings — nothing more.

The kernel integrations framework (credential storage, enable/disable, auto-disable, webhook
endpoint, run bookkeeping) serves these generically and lists available providers from the
registry. This deletes the hardcoded `IntegrationProviderSpecifics` union in
`libs/contract/src/modules/integrations/schemas.ts` along with the `integrationProviders` and
`providerLotByProvider` tables in that module's `types.ts`; the switch dispatch in
`integrations/sinks/sink-adapters.ts` and `integrations/worker.ts` becomes a registry lookup plus
script resolution.

**`settingsSchema` is a declarative `AppSchema`** [DECIDED], validated by the existing
property-schema runtime (`apps/app-backend/src/lib/property-schema/`). This follows Decision 6 for
the same reason: Effect Schema cannot round-trip through `PluginManifest` (established in step 2),
and the client needs introspectable property metadata to render integration forms.

**Secret properties** [DECIDED]. Add `secret?: true` to `AppPropertyBase`
(`libs/contract/src/schema/property-schema.ts`), beside the existing `translatable?: true`. It sits
on the base type so every property kind inherits it, and it is validation-neutral —
`property-schema-runtime.ts` needs no change. It does two jobs: the client renders a password input,
and the kernel redacts marked fields when returning an integration.

The redaction is a **deliberate behavioral change with owner sign-off**, not a quiet test edit
(cross-phase invariant 2). Today `integrations/repository.ts` returns `providerSpecifics` verbatim,
so every read of an integration hands the client the stored API keys, passwords, and auth cookies
in plaintext. Redaction composes correctly with the existing merge-preserve on update
(`service.ts` spreads existing specifics then the request body), which is the behavior asserted by
`tests/src/tests/integrations/integrations.test.ts` and stays intact. Credentials remain plaintext
`jsonb` at rest; encryption at rest is explicitly out of scope for this plan.

**Manifest section `importSources`, and one import dispatch path** [DECIDED]. A plugin declares:

```txt
{ slug, name, description, workflowSlug, input: "file" | "payload",
  allowedFileExtensions, requiredAppConfigKeys }
```

`runtime/source-definitions.ts` currently hardcodes all nineteen sources with their allowed
extensions and required config; that table moves into the two manifests. More importantly, the
kernel's media-versus-non-media branch (`imports/media-workflow.ts` and
`imports/non-media-workflow.ts`, selected by knowing which sources are media) is itself a purity
violation and **collapses into one path**: the kernel looks the run's `source` slug up in the
registry and dispatches the owning plugin's workflow with
`{ runId, userId, artifactPath?, sourcePayloadRef? }`. Media's workflow fans out to
resolution/population children; fitness's parses a CSV and writes directly. The kernel sees no
difference.

**Implementation choice (2026-07-27, owner-approved): the collapse spans tasks 07, 09, and 10.**
Task 07's original acceptance bullet claimed the branch was gone at the end of 07, which
contradicts task 09 ("complete the kernel-side collapse task 07 **started**") and 07's own
"lands before any consumer" framing. It is unsatisfiable there: the dispatch resolves a source slug
to `{ pluginSlug, workflowSlug }`, and no plugin owns a top-level import workflow until 09/10 —
`plugins/fitness` has no import surface and `plugins/media` has only the task-06
resolution/population children. Deleting the native branch in 07 would break all nineteen imports
and violate cross-phase invariant 1. The split mirrors the integrations side, where 07 adds the
`integrationProviders` section and **08** deletes the hardcoded provider union once the adapters
move: **07** adds the `importSources` section, serves source metadata from the registry, and builds
the dispatch path (declared sources route through it; the native orchestration is the fallback for
undeclared ones); **09** moves the three fitness sources and deletes the non-media orchestration;
**10** moves the sixteen media sources and deletes the branch and the hardcoded source table. The
end state in §Delete is unchanged — only which task performs each deletion is pinned here.

**Filesystem grants** (Decision 10, deny-by-default) [DECIDED]. The kernel materializes an
uploaded or fetched artifact to a path and spawns the execution with `--allow-read` extended to
that path plus `--allow-write` on a per-execution scratch directory, replacing the blanket
`--deny-write` for grant-carrying executions only. Implementation lives next to the existing flag
assembly in `sandbox-runtime/runtime.ts` (`makeSpawnDenoProcess`). Grants are requested per script
through `capabilities: ["artifact-read", "scratch"]`.

Grant-carrying executions run on a **dedicated, non-pooled process**: `ProcessPool` pre-warms
processes before the execution is known, so per-execution grants leave no alternative
**[RECOMMENDED]** — measure before optimizing.

The scratch quota is **5 MiB**, enforced **post-execution**: Deno provides no preventive
filesystem quota, so the kernel measures the directory after the run completes and fails the
execution when it exceeds the cap. Cleanup is unconditional and kernel-owned. The number is a
starting point and may be raised without revisiting this design.

**Adapter output crosses via scratch-dir chunk files** [DECIDED]. An adapter's normalized output is
far larger than `execution.resultBytes` (1 MiB) — a full Netflix or Trakt export is tens of
thousands of entity groups — so it cannot be a script return value, and raising `resultBytes` to
fit would re-introduce the context-pressure failure mode the step 3 spike hit. Instead the adapter
**writes chunk files into its granted scratch directory** and returns only a small manifest (chunk
file names, counts, failure summary). The kernel harvests those files at execution end into
run-scoped kernel-owned storage, then cleans the scratch directory, then feeds the chunks into the
resolution/population/writing pipeline. The reader is always the **kernel**, never a second sandbox
execution, so the grant stays per-execution exactly as specified above.

**Withdrawn host functions** [DECIDED]. Earlier drafts of this step proposed run-scoped blob
syscalls (`putRunBlobs` / `getRunBlobs`) to move an opaque payload between two sandbox executions,
plus `recordImportFailures` and `reportImportProgress`. **None of the four are built.** The
chunk-harvest transport removes the need for blobs, and because the kernel still owns entity, event,
and relationship writes, it still owns the counters and failure rows exactly as it does today. Do
not add them.

**Approved sandbox dependencies** [DECIDED]. Add `fflate` (zip and gunzip), `papaparse` (CSV — the
same parser the kernel uses today at `imports/runtime/csv.ts`, so adapter parsing parity is exact),
and `fast-xml-parser` (MyAnimeList exports) through the Step 0a vendoring mechanism. Plex sink
payloads are multipart/form-data and are parsed in-script without a dependency. The approved-
dependency set is open: later steps may vendor more through the same mechanism.

**Credential scoping** [DECIDED]. `getIntegration` must resolve the integration from trusted
execution state — the integration the execution belongs to — rather than from an arbitrary id
supplied by the script.

### Task 07 implementation record and constraints it leaves for 08–10 (2026-07-27)

Task 07 landed the capability slice with no consumers. Five findings bind the later tasks.

1. **`getIntegration` takes no arguments; the integration id lives on `ExecutionAuthority`.** The
   `user` variant gained an optional `integrationId`, set only by the `auth: "integration"`
   operation dispatch — where the same id already authenticated the call — so a script cannot
   substitute another. The subscription path reads the existing
   `authority.subscriptionRun.origin.integrationId` rather than duplicating the value, because two
   copies of one fact can disagree. Authority was chosen over a payload sibling field because every
   durable re-dispatch site forwards `authority` wholesale, while sites that rebuild the payload
   field-by-field would silently drop a new sibling. Executions with no integration in scope fail
   the call rather than falling back to "any integration this user owns".
   `metadata-lookup`'s `integrationId` operation input **stays** — it is the credential
   `plugins.invoke` authenticates against, not a redundant argument, and the browser extension
   needed no change.
2. **Task 08 must delete the contract provider union in the same change that declares the first
   `secret` field.** `ListedIntegration.providerSpecifics` is still the closed union with required
   credential fields, so once a manifest marks e.g. `token` secret, `Schema.encode` rejects the
   redacted object and `integrations.get`/`list` fail at the response boundary. Nothing triggers it
   today because no plugin declares a provider. This is a hard ordering constraint, not a soft one.
3. **The filesystem grant is inert until a script can reach it.** The Deno runner sets `Deno` to
   `undefined` in `disableCodeGeneration()`, and neither the artifact path nor the scratch path is
   passed into the runner payload. Before any adapter can use `artifact-read` / `scratch`, task 09
   must add a script-facing filesystem primitive and the path handoff. Harvested output lands in a
   kernel-owned run-scoped directory and is not garbage-collected — whoever consumes it owns
   deleting it.
4. **`importSources` cannot express a multi-artifact source.** `input: "file"` plus a flat
   `allowedFileExtensions` carries exactly one artifact, and the dispatch payload carries one
   `artifactPath`. `movary` needs three named upload fields and `myanimelist` two optional ones.
   Task 10 decides: either the section gains a multi-artifact shape, or those sources accept one
   archive and split it inside the script. Not retrofitted speculatively.
5. **`CreateImportRunBody["source"]` is still a closed literal union in `@ryot/contract`.** The
   dispatch path works for all nineteen existing slugs, but a genuinely new plugin-declared source
   cannot reach `startImportRun` over HTTP until that union opens. No client-facing source-listing
   endpoint exists today; `ImportSourceCatalog.list()` is what one would read from.

### Task 08 implementation record (2026-07-28, owner-approved)

The e2e runner now executes files in parallel against one shared backend. Migrating integration
adapters added a sandbox queue stage before normalized import workflows; with the previous
50-connection workflow pool, full-suite runs developed nondeterministic 180-second timeouts across
otherwise unrelated workflow-backed suites while every affected suite passed in isolation. The
owner chose to preserve file parallelism and raise test-only capacity rather than run the gate
serially: the app and workflow pools are both 100 for 32 sandbox workers, and the test Postgres
`max_connections` ceiling is 400. Measurement after that increase peaked at 120 connections with
only four active, disproving connection exhaustion; unrestricted Vitest workers instead consumed
all ten logical cores alongside the backend, containers, and Deno workers. File parallelism is
therefore retained with `maxWorkers: 3`; six workers still allowed accumulated durable work to
produce late-suite timeouts even though the timed-out query suites completed in 13 seconds when run
together in isolation. Integration e2e cases also await every run they create before exiting, so
tests do not deliberately leave adapter/import work for other files. The owner subsequently chose
one awaited cron/boot dispatch path for production and tests; the Step 1 amendment above owns that
runtime change. Production pool defaults and adapter semantics remain unchanged.

### Event subject selection: `episodeLocator` becomes `subjectEntityId` [DECIDED]

`imports/media/event-target-workflow.ts` imports `@ryot/plugin-media` directly and branches on
`episodeLocator.type === "show" | "podcast"`, reading `seasonNumber` / `episodeNumber` and looking
up the `show-episode` / `podcast-episode` schema slugs. That is a kernel-to-plugin import plus six
media strings, and it is why `modules/imports/media/` cannot stay in the kernel.

Replace `ImportMediaEvent.episodeLocator` with an optional, already-resolved `subjectEntityId` on
the import event envelope. The plugin's import workflow resolves subjects itself, between
population and writing — it has owned import orchestration since step 3 and owns the
`resolve-episodes` operation since step 2 — so the kernel's writing path collapses to
`subjectEntityId ?? group.entityId`. `event-target-workflow.ts` and the episode branches of
`writing-failures-workflow.ts` are deleted with **no kernel replacement**.

`subjectEntityId` is generic on its face ("the event's subject may be a sub-entity of the imported
item"); that only the media plugin populates it is acceptable for an envelope field, since Decision
8(d) constrains host functions rather than payload shape.

The considered alternative — an opaque `subjectSelector` blob that the kernel forwards to a
manifest-declared resolver script — was **rejected**. It reaches the same purity but costs a new
manifest field, a new kernel dispatch path, and an extra round trip per writing chunk.

### Migration

Adapters and sources split by owning plugin. Adapter outputs that identify catalog providers use
logical `providerSlug` / `providerId`, never executable script identity.

| Target           | Sinks                                                          | Yanks                                        | Import sources                                                                                                                                    |
| ---------------- | -------------------------------------------------------------- | -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `plugins/media`  | plex, jellyfin, emby, kodi, browser-extension, generic_json    | komga, plex, audiobookshelf, youtube-music   | netflix, goodreads, storygraph, hardcover, anilist, trakt, imdb, igdb, grouvee, movary, myanimelist, watcharr, jellyfin, plex, audiobookshelf, media-tracker |
| `plugins/fitness`| —                                                              | —                                            | hevy, strong-app, open-scale                                                                                                                       |

Network access from adapter scripts is bounded through `httpCall` with integration credentials from
the scoped `getIntegration`. Preserve `createProgressResult` semantics (`integrations/sinks/shared.ts`)
— `occurredAt` is always set, and the progress-policy automation depends on it.

Netflix is the one adapter that gets structurally simpler by moving. It needs TMDB searches
mid-parse, which the kernel cannot do inline, hence today's two-phase `"netflix-search-planned"`
dance across `imports/sources/netflix/processor.ts` and `imports/media/load-workflow.ts`. A plugin
script calls provider search in-process (as `metadata-lookup.sandbox.ts` already does) and that
entire phase disappears. Moving it also retires the last kernel consumer of
`lib/shared/title-parsing.ts` and `title-matching.ts`, which step 2 explicitly scheduled for
deletion here.

### Delete

- Native sink and yank adapter code from `modules/integrations`, leaving the framework.
- All media and fitness import source adapters from `modules/imports/sources/`, plus
  `imports/media-workflow.ts`, `imports/non-media-workflow.ts`, `imports/workout/`,
  `imports/measurement/`, and the media orchestration under `imports/media/`.
- `imports/runtime/{import-files,csv,source-definitions}.ts` in whole or in large part — file
  parsing moves into the sandbox and the source table moves into the manifests.
- `apps/app-backend/src/lib/shared/title-parsing.ts`, `title-matching.ts`, and their tests.

What survives as the kernel `imports` framework: the run row with its status, progress, and
counters; failure rows and the `ImportRunFailureStage` enum (`provider_resolution`,
`provider_details`, `event_policy` are kernel vocabulary — providers, events, and policies are
kernel concepts); artifact upload, materialization, and cleanup; source listing from the registry;
dispatch of the owning plugin's workflow; and the entity/event/relationship writes themselves.

### Tests

The `integrations/` and `imports/` e2e suites are re-pointed with assertions preserved. Those
twenty-five tests cover only a fraction of the adapters; the rest are covered by
`apps/app-backend` unit tests, which **move into the plugin packages** alongside their adapters with
assertions intact. New e2e tests are welcome where the migration exposes a coverage gap.

### Done

Kernel `modules/integrations` and `modules/imports` contain zero provider-specific and zero
domain-specific code; both plugins own their adapters and import workflows; `integrations/` and
`imports/` suites green; the full gate passes after each of tasks 07–10.

## Step 5 — `media-monitoring` + remaining media logic

Step 4 absorbs all of the imports and integrations work, so this step is what remains:
`media-monitoring` plus residual media branches. It is composition — it adds no kernel capability.
Monitoring sweeps are cron + `executeQueryEngine` pushdown + signals; refresh flows compose the
step-3 workflows; notification fan-out uses the existing signal/subscription machinery. The
`media-monitoring` contract group's user-facing surface (status/enable/disable) becomes plugin
operations (step 2 capability), using `user` or `integration` auth.

Migrate & delete: `modules/media-monitoring`, and any leftover media references in `signals`,
`events`, and `entity-interest` (the interest/translation machinery itself is kernel — only
media-specific branches move). Move the media resolution provider-to-activity-script map into
manifest/registry metadata and remove the kernel import of `@ryot/plugin-media/workflows/schemas`.

E2e: the `media-monitoring/` suites (4 files, including association detectors and cron-refresh
coverage) re-pointed — these are the acceptance test that the syscall surface is sufficient, since
they exercise nearly every capability at once.

Done: **no module under `apps/app-backend/src/modules/` is media- or fitness-specific**;
full e2e suite green; the media-monitoring suites pass with assertions unchanged.

## Phase gate

All step gates plus: grep the kernel for media/fitness vocabulary (informal preview of
Phase 4's enforced check) and triage every hit — each is either deleted, generalized, or
explicitly justified in this file. Task 06 also left one open operational risk that must close
here: run concurrent full-size media imports through the real workflow pool, Redis projection, and
sandbox processes, and record pool and lock pressure alongside completion results.
