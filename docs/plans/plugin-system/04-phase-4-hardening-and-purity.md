# Phase 4 — Hardening, purity enforcement, cleanup

Goal: make the kernel/plugin boundary mechanically enforced, pay down the performance and
limits items deliberately deferred from earlier phases, and reorganize tests and docs to
match the final architecture. Items here are independent of each other; order within the
phase is free unless noted.

## 1. Purity gate (do this first — it locks in Phase 3's outcome)

A local check, wired into the app-backend `check`/test flow (there is no CI): a unit test or
small script that fails when kernel source (`apps/app-backend/src`, `libs/contract/src`,
`libs/query-engine/src` core — not `recipes/media.ts` if any media recipes survive there,
which should instead move into the media plugin's package **[RECOMMENDED]**) contains
domain vocabulary. Start the banned list from the plugin manifests themselves (schema slugs,
script slugs, provider names: `movie`, `anime`, `workout`, `tmdb`, `plex`, …) so it can't
drift from reality; keep an explicit allowlist file for justified exceptions (each with a
reason). The gate failing must name the offending file/line.

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
  the per-driver-kind budget profiles introduced in Phase 3 step 3. Re-baseline the e2e
  suite wall-clock and record it here.
- **Superseded script-row GC**: delete plugin script rows no longer referenced by any
  registry snapshot or in-flight workflow execution (pinning makes "referenced" precise).

## 3. Test tree and docs reorganization

- Reorganize `tests/src/tests/` into `kernel/` and `plugins/media/` + `plugins/fitness/`
  suites (pure moves; no assertion changes). Update `tests/AGENTS.md` conventions:
  the install-test-plugin fixture, the kernel/plugin split, retuned budgets.
- Documentation sweep under the single-owner rule (`apps/app-backend/AGENTS.md` Documentation
  Layout): rewrite the sections that describe seeding, builtins, schema tables, automation
  rules; add plugin authoring docs (`libs/plugin-kit` README: manifest reference, driver
  kinds, capabilities, determinism rules for workflow scripts, batch-first guidance);
  update `sandbox-runtime/README.md` (new host functions, grants, workflow primitives);
  module `AGENTS.md` files for deleted/added modules.
- Delete `apps/app-client-backup` if still present (owner said it is slated for removal —
  confirm before deleting).

## 4. Deliberately deferred (record here, do not build)

- **Public/runtime plugin install for end users** — the admin mechanism exists (Phase 2);
  exposing it involves trust UX, quotas, and capability review flows that belong with the
  user-authored-plugins milestone.
- **Per-user lightweight extension** — removed with the standalone script feature
  (Decision 19); it returns only in the form of user-authored plugins, never as a second
  script-authoring mechanism.
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
5. Docs updated per §3; this plan set's deviations and decisions recorded inline.
