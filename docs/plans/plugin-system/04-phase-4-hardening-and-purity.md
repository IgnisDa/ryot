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

Registry-provided definitions remain trusted and immutable in Phase 4, whether they come from source
zero or a trusted plugin. `pluginSlug` owns source attribution. Remove the never-populated non-builtin
provenance scaffold rather than changing existing first-party definition behavior. Phase 5 will
design user-package trust and visibility separately.

## 2. Performance

- **Compiled modules on disk.** Execution currently imports compiled code via a `data:` URL
  per single-use process (`runner-source.sandbox.ts`). Materialize compiled modules into the
  sandbox runtime directory keyed by content hash (already covered by the existing
  `--allow-read=<runtime-dir>` grant) and import by path — after Phase 2 §8 every executable
  module is definition-source-owned and content-addressed, so no legacy per-user fallback path is
  needed. Measure
  before/after on a provider-heavy e2e run.
- **In-flight host-call cap** per execution (the bridge has total-count budgets but no
  concurrency cap): a simple kernel-side semaphore per `executionId` in
  `BridgeService.handleRequest`. Pick the limit from observed batch-activity behavior.
- **Pool/limits retuning** for the heavier post-migration sandbox load: revisit
  `SANDBOX_WORKER_CONCURRENCY`, `DATABASE_WORKFLOW_POOL_MAX`, and the Postgres
  `max_connections` arithmetic documented in `tests/AGENTS.md` (Timeouts & Pool Sizing), and
  the per-script-kind budget profiles introduced in Phase 3 step 3. Re-baseline the e2e
  suite wall-clock and record it here.
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
- Complete the third-party-style e2e fixture. One hot-installed plugin must exercise search, import,
  event creation, automation, uninstall refusal while referenced, cleanup, and successful uninstall
  without a server restart.
- Effect-only means the public authoring boundary: sandbox definitions, SDK methods, backend host
  contracts, and typed bridge dispatch expose Effect. Private adapters may bridge Promise-returning
  Deno, filesystem, fetch, or third-party APIs behind that boundary.
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
