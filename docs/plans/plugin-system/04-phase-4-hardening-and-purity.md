# Phase 4 — Hardening, purity enforcement, cleanup

Goal: make the kernel/plugin boundary mechanically enforced, pay down the performance and
limits items deliberately deferred from earlier phases, and reorganize tests and docs to
match the final architecture. The purity gate comes first. Library ownership precedes its
acceptance tests and docs; uninstall pin semantics precede script GC; measurements bracket the
performance changes. Other workstreams may proceed independently when those dependencies hold.

Phase 5's user-level installation model is deliberately separate. Phase 4 continues to operate
on trusted, globally loaded plugin packages and must not add per-user installation state,
namespacing, capability-consent UX, marketplace behavior, or plugin versioning.

## 1. Purity gate (do this first — it locks in Phase 3's outcome)

A local check, wired into the app-backend `check`/test flow (there is no CI): a unit test or
small script that fails when kernel source (`apps/app-backend/src`, `libs/contract/src`,
`libs/query-engine/src` core — not `recipes/media.ts` if any media recipes survive there,
which should instead move into the media plugin's package **[RECOMMENDED]**) contains
domain vocabulary. Start the banned list from the plugin manifests themselves (schema slugs,
script slugs, provider names: `movie`, `anime`, `workout`, `tmdb`, `plex`, …) so it can't
drift from reality; keep an explicit allowlist file for justified exceptions (each with a
reason). The gate failing must name the offending file/line.

The first gate run is expected to identify known Phase 3 residue. Phase 4 must burn down, not
permanently allowlist, the following production-domain ownership leaks:

- `library` and `in-library` are media-owned by the Phase 2 owner decision. Remove media library
  policy from native collection, event, import, user-bootstrap, user-state, test-support, contract,
  and workflow code. Preserve externally observable outcomes and awaited ordering; shared database
  transaction boundaries may change where sandbox isolation requires it. Automatic membership is
  for media-owned schemas only, not fitness or unrelated plugin schemas.

  **Implementation choice (2026-07-30):** media event membership runs as an awaited event policy
  using its declared `changeUserRelationships` capability under user-bound subscription authority.
  This remains user-safe because the backend supplies the subscription's user identity and the
  mutation payload cannot select another user. Subscription relationship writes remain user-bound,
  and endpoints owned by another user or otherwise invisible to that user are rejected. Undeclared
  capability calls and system-authority calls remain unavailable.

  **Implementation choice (2026-07-30, owner-approved behavioral change):** a generic direct
  `/entity-import` provider import populates the entity without automatically creating media
  `in-library` membership. The endpoint remains domain-neutral: no entity-import manifest hook or
  general entity policy is added for plugin-specific post-import semantics. Media import-source
  workflows may still emit generic relationship mutations, while event and collection membership
  remain plugin-owned.

  **Implementation choice (2026-07-30):** entity schemas may declare a compact nested `userState`
  policy whose `deniedOperations` list contains `clear` and/or `merge`; absent policy permits both.
  These restrictions are exceptional policy for protected singleton entities. A denied list avoids
  top-level booleans and speculative per-operation policy objects while keeping ordinary schemas
  permissive by default. Kernel enforcement reports generic operation-specific errors and checks
  both source and destination schemas for merges.

- Add a separate `userBootstrap` manifest section for the trusted boot-configured plugins that
  Phase 4 loads globally. It targets sandbox scripts running with user authority. Add the smallest
  batch-first, schema-owner-restricted host capability needed for the media plugin to idempotently
  create its per-user library. General user-installed-plugin lifecycle is Phase 5.
- Open the import-run request envelope so a manifest-declared source that was not known when the
  contract package was compiled can reach the active import-source catalog. Source discovery is
  not part of Phase 4.
- Move media and fitness query recipes into their owning plugin packages. Keep only generic query
  construction in the query-engine package; the current optional `library` / `in-library` saved-view
  filter becomes a media-owned wrapper.
- Generalize or relocate the media-specific operational-gate test-support contract and service.
  Test-only routing is not permission to keep media workflow and source names in production kernel
  source.

`legacy-bootstrap` remains the documented V1-adoption quarantine. Generated sandbox output is not
authored kernel source. Boot-source package wiring and the retained backup client may receive narrow,
line- or file-specific allowlist entries with reasons; do not grant broad directory exemptions.

Module dependency purity **[DECIDED]**: Task 17 promotes the runtime-cycle analysis currently embedded
in `apps/app-backend/scripts/module-dag.ts` into the ordinary `purity:check` gate. Refactor the analysis
so the check can fail with the exact cycle paths without generating HTML; retain HTML generation as an
optional diagnostic view over the same analysis. The Task 01 baseline has 13 runtime cycles across 32
modules. They may remain while Tasks 2-16 change module ownership, but Task 17 must resolve all of them
and enable the gate with no cycle allowlist or grandfathered baseline.

Registry-provided definitions remain trusted and immutable in Phase 4, whether they come from source
zero or a trusted plugin. `pluginSlug` owns source attribution. Remove the never-populated non-builtin
provenance scaffold rather than changing existing first-party definition behavior. Phase 5 will
design user-package trust and visibility separately.

Task 08 implementation record (2026-07-31): removed the unused non-builtin provenance type, empty
sets, replacement parameters, and registry predicates. Entity, relationship, and event adapters keep
their existing `isBuiltin: true` meaning for trusted registry definitions; saved views retain the
same distinction between immutable definitions and per-user state. Signal scopes no longer carry a
synthetic builtin flag: signal and related-relationship authorization is based on active registry
lookup. Kernel/plugin ownership remains source attribution (`pluginSlug` where exposed), and no
Phase 5 package-trust state was introduced.

Task 01 implementation record: the first gate run found `mediaBaseFields` and
`mediaWithCreatorsBaseFields` authored in `libs/contract/src/schema/core.ts` and consumed by the media
plugin. No later purity task owned that production-domain leak, and permanently excepting it would
contradict kernel purity. With owner approval, Task 01 moved those field definitions verbatim into
`plugins/media`; the contract retains only generic property-field constructors. This narrow ownership
correction changes no schema or behavior and is the only domain move included in the gate task.

## 2. Performance

- **Compiled modules on disk.** Execution currently imports compiled code via a `data:` URL
  per single-use process (`runner-source.sandbox.ts`). Materialize compiled modules into the
  sandbox runtime directory keyed by content hash (already covered by the existing
  `--allow-read=<runtime-dir>` grant) and import by path — after Phase 2 §8 every executable
  module is definition-source-owned and content-addressed, so no legacy per-user fallback path is
  needed. Measure
  before/after on a provider-heavy e2e run.

  Task 10 implementation record (2026-07-31): compiled JavaScript now materializes under the
  approved runtime directory as `modules/<compiled-hash>.mjs`. The backend verifies exact UTF-8
  bytes against the persisted SHA-256 hash, publishes through a verified temporary file and atomic
  non-overwriting link, and reuses only a matching immutable destination. Concurrent executions
  converge on one read-only file. Runner requests carry only the local module path and compiled
  format; Deno imports that file with the existing runtime-directory read grant, and returned load
  errors redact module paths. The exposed module directory is the Task 14 disk-liveness boundary;
  Task 10 adds no GC.

  The pre-change operational run used the unchanged two-concurrent-1,001-item gate and took 911.20s
  overall; its test body timed out after 902.16s at the unchanged 900,000ms deadline. Backend logs
  showed no execution error or deadlock before timeout. The owner directed Task 10 completion without
  rerunning that operational gate so its post-change measurement is deferred to the separate gate
  diagnosis. Non-operational verification used the hermetic provider search/import suite, which
  passed all 11 tests in 18.48s after the change.

- **In-flight host-call cap** per execution (the bridge has total-count budgets but no
  concurrency cap): a simple kernel-side semaphore per `executionId` in
  `BridgeService.handleRequest`. Pick the limit from observed batch-activity behavior.

  Task 11 implementation record (2026-07-31): each active bridge session now owns an independent
  four-permit semaphore and a close signal. Four preserves the largest intentional fan-out observed
  in current workloads: media metadata and Netflix searches use concurrency two, Movary reads three
  artifacts concurrently, and existing backend fan-out reaches four; import and monitoring batches
  otherwise dispatch sequentially. Calls beyond four wait without changing the independent total or
  HTTP call-count budgets. Effect's interruption-safe permit wrapper releases on every exit, while
  session removal completes the close signal and races both active and queued requests so execution
  timeout, failure, cancellation, expiry, and teardown cannot strand waiters. Focused bridge tests
  cover the bound, queued progress, execution-id isolation, removal, and permit release. The backend
  suite passed 137 files and 952 tests; representative media/fitness imports passed 19 tests and
  provider search/import passed 11. The owner waived rerunning the standalone 1,001-item operational
  gate for this task.

- **Pool/limits retuning** for the heavier post-migration sandbox load: revisit
  `SANDBOX_WORKER_CONCURRENCY`, `DATABASE_WORKFLOW_POOL_MAX`, and the Postgres
  `max_connections` arithmetic documented in `tests/AGENTS.md` (Timeouts & Pool Sizing), and
  the per-script-kind budget profiles introduced in Phase 3 step 3. Re-baseline the e2e
  suite wall-clock and record it here.

  Task 12 implementation record (2026-07-31): the existing limits remain unchanged because no fresh
  load evidence supports changing them. Production defaults are 5 sandbox workers with 10 app-pool
  and 10 workflow-pool connections; after the cluster `SingleRunner` reservation and two always-on
  durable-queue workers, the workflow pool has `10 - 1 - 5 - 2 = 2` spare connections. The shared
  e2e harness retains 32 sandbox workers, 100 app-pool connections, and 100 workflow-pool
  connections, leaving
  `100 - 1 - 32 - 2 = 65` workflow connections for file-parallel durable work. Its two configured
  pool maxima total 200 against Postgres `max_connections=400`. The prior full-suite measurement
  peaked at 120 total and 4 active database connections, and the separate successful unchanged
  two-concurrent-1,001-item operational run recorded peak sandbox overlap 8, zero app-pool waits,
  zero advisory-lock waits, zero deadlocks, and zero Redis projection errors. Standard scripts keep
  the 10-second default timeout, 256 KiB context, 1 MiB result, 200 host-call, and 50 HTTP-call
  ceilings; workflows alone keep the measured 30-second floor, 64 KiB context, 4 MiB result, and
  1,000 durable-step/host-call ceilings. The sandbox runtime reference owns the rationale and
  mis-sizing symptoms for each profile.

  Task 10's later pre-materialization run timed out after 902.16 seconds without an execution error
  or deadlock; it did not isolate a worker, pool, database, or script-budget limit as the cause. The
  post-materialization, post-concurrency-cap operational state remains unmeasured.

  Measurements were reviewed on an Apple M4 with 10 logical CPUs and 16 GiB memory, macOS 26.3.1
  (25D2128), Bun 1.3.14, Docker client 29.7.0, and Docker server 29.5.2. The owner required e2e files
  to run individually and explicitly directed Task 12 not to rerun the standalone operational gate.
  Fresh standard-suite wall-clock and operational pressure results are therefore waived for this
  task, not claimed; changing resource values without those measurements would be speculative. The
  full-size workload, assertions, timeout, and opt-in command remain unchanged for a later run. The
  backend check passed, all 137 backend test files and 952 tests passed, the representative imports
  e2e file passed 19 tests, and the provider search/import e2e file passed 11 tests.

- **Superseded script-row GC**: delete script rows — plugin-owned and kernel source-zero
  alike — no longer referenced by any registry snapshot or in-flight workflow execution
  (pinning makes "referenced" precise). Source-zero rows resolve outside the loader snapshot,
  so their liveness rule is the running kernel's declared script set: only rows whose content
  hash the kernel no longer declares are candidates.

## 3. Correctness and final-boundary hardening

- Capture one loader snapshot per logical runtime-resolution operation. Concurrent hot swaps must
  resolve wholly against one complete snapshot rather than combining provider, manifest, and script
  information from different snapshots.
- Treat nonterminal plugin workflow pins as uninstall references. Fence new dispatch while checking
  references so uninstall cannot race with a newly starting execution. Uninstall returns conflict
  while any affected workflow is running or suspended. This liveness model is also the source of
  truth for script-row GC.

  Task 13 implementation record (2026-07-31): runtime resolution now captures one immutable loader
  snapshot per logical operation, including provider operations, automations, public plugin
  operations, boot/user-bootstrap/cron entries, integration adapters, and import-source workflows.
  New dispatch therefore observes one complete old or new package while durable replay continues to
  use its exact recorded script ID.

  Active plugin sandbox workflows are represented by app-owned `sandbox_workflow_reference` rows
  containing execution, plugin, script, and content-hash identity. The durable pin activity inserts
  the row idempotently under a shared transaction-scoped plugin-ingestion advisory lock after
  confirming the plugin is still active; terminal success or failure removes it through a durable,
  idempotent release activity, while suspension retains it. Uninstall takes the matching exclusive
  advisory lock before reference inspection, so an older dispatch registers first and blocks
  uninstall, or deactivation wins and the queued registration fails. Refusal rolls back without
  changing database activation or the loader snapshot; successful invalidation remains after durable
  deactivation. Task 14 consumes the repository's reference listing as its workflow-pin liveness
  source instead of depending on private workflow-engine storage.
- Complete the third-party-style e2e fixture. One hot-installed plugin must exercise search, import,
  event creation, automation, uninstall refusal while referenced, cleanup, and successful uninstall
  without a server restart.
- Effect-only means the public authoring boundary: sandbox definitions, SDK methods, backend host
  contracts, and typed bridge dispatch expose Effect. Private adapters may bridge Promise-returning
  Deno, filesystem, fetch, or third-party APIs behind that boundary.

  Task 09 implementation record (2026-07-31): the boundary audit found the rewrite already enforces
  Effect-only sandbox definitions, SDK host methods, backend host implementations, and typed bridge
  dispatch. Existing type checks reject Promise-returning scripts, providers, and test hosts, while a
  focused backend test rejects Promise host implementations and verifies bound bridge calls remain
  Effects at runtime. Remaining Promise interop is private to compiler, runner, filesystem, Redis, and
  test execution adapters and is wrapped at the Effect boundary. No compatibility API or authoring
  path was removed because none remained.

- Resolve migration residue in directly affected modules while preserving useful negative tests and
  private helpers. Do not turn Phase 4 into unrelated stylistic refactoring.

## 4. Test tree and docs reorganization

- Reorganize `tests/src/tests/` into `kernel/` and `plugins/media/` + `plugins/fitness/`
  suites (pure moves; no assertion changes). Update `tests/AGENTS.md` conventions:
  the install-test-plugin fixture, the kernel/plugin split, retuned budgets.
- Documentation sweep under the single-owner rule (`apps/app-backend/AGENTS.md` Documentation
  Layout): rewrite the sections that describe seeding, builtins, schema tables, automation
  rules; add plugin authoring docs (`libs/plugin-kit` README: manifest reference, script
  kinds, logical providers, direct entrypoints, execution authority, provider-scoped caches,
  capabilities, determinism rules for workflow scripts, and batch-first guidance);
  update `sandbox-runtime/README.md` (new host functions, grants, workflow primitives);
  module `AGENTS.md` files for deleted/added modules.
- Retain `apps/app-client-backup`. The owner explicitly deferred deletion. Add a deletion TODO in
  every affected backup or dependent file during the documentation/cleanup pass. Its required
  contract media types receive a narrow, documented purity exception until the backup is removed.

## 5. Deliberately deferred (record here, do not build)

- **User-level plugin installation and arbitrary source upload** — Phase 5 owns package versus
  installation identity, per-user visibility and state, system-assigned namespacing, capability
  approval, quotas, SSRF hardening, scheduler scope, shared global data, and package garbage
  collection. See `05-phase-5-user-level-plugins.md`.
- **Per-user lightweight extension** — removed with the standalone script feature
  (Decision 19); Phase 5 returns it only through user-level plugin installations, never as a
  second script-authoring mechanism.
- **Third-party namespacing** (`acme/movie`) — `/` is already reserved in slugs; activating
  namespaces is additive.
- **Plugin uninstall data policies** beyond refuse-while-referenced.
- **Inter-plugin dependencies, signing/attestation, marketplace.** The
  source-hash → compiled-hash provenance recorded at ingestion is the hook attestation will
  use later.

## Final acceptance (whole plan)

1. Purity gate passes with an empty (or fully justified) allowlist.
2. Full e2e suite green; media lifecycle, imports, integrations, monitoring, exercises
   behavior identical to pre-rewrite assertions (the suites prove it — assertions were never
   weakened, only re-plumbed).
3. `apps/app-backend` contains no media/fitness code; `plugins/media` and `plugins/fitness`
   contain no kernel bypasses (all effects flow through host functions and manifest
   declarations).
4. A fake third-party-style plugin (the e2e fixture) can be hot-installed, exercise search →
   import → events → automation, and be uninstalled, without server restart.
5. Docs updated per §4; this plan set's deviations and decisions recorded inline.
6. Sandbox scripts, SDK host contracts, backend host-function implementations, and typed bridge
   dispatch are Effect-only; no raw Promise authoring or host-function compatibility API remains.
7. A manifest-declared import source absent from the central contract can be invoked through the
   generic import envelope and is validated by the active source catalog.
8. Trusted media `userBootstrap` creates the per-user library idempotently, and automatic
   `in-library` membership applies to media schemas only.
9. Uninstall refuses while plugin workflows are nonterminal; after references clear, uninstall and
   script/module GC complete without breaking pinned replay or source-zero scripts.
10. The app-backend runtime module graph is acyclic, and `purity:check` mechanically rejects any new
    runtime cycle while the optional HTML DAG remains available for diagnosis.
