# Ingestion improvements: implementation plan

## Goal

Give imports and integrations one reliable execution foundation. Show source work and committed results while a run is active, collect source data once, recover active runs after restart, and compute setup requirements from the executable pipeline.

Keep Imports and Integrations as separate user-facing features. An import is a one-time transfer; an integration is a persistent connection that creates scheduled or webhook runs. Both use the shared ingestion execution model.

## Agreed scope and product decisions

- Manual imports remain append-only. A separate import can create duplicate history, even when its input overlaps an earlier import or an integration.
- Prevent duplication during replay of the same run through stable run-local identities and committed mutation receipts.
- Preserve each integration's existing source-specific duplicate and debounce rules. Do not add a universal cross-run source-identity ledger or heuristic matching between services.
- Do not add import reversal or a user-triggered selective retry action.
- Recover active runs automatically. Keep captured inputs while a run needs them; release them when the run becomes terminal. Retain lightweight summaries and diagnostics until the run report is deleted.
- Accept authenticated webhook deliveries durably when known configuration prerequisites are missing. Show a blocked state and resume after setup is fixed.
- Blocked deliveries expire seven days after acceptance. Expiry releases their payloads, has an explicit setup-related reason, and does not count toward continuous-error auto-disable. The deadline does not extend when readiness is rechecked.
- Scheduled integrations wait for readiness before admitting another run. Do not create a new failed or blocked run on every scheduler tick.
- Report source-specific units and actual committed outcomes. Unknown totals do not imply preparation, and progress is not an estimated finish time.
- Generate configuration/dependency metadata from constrained SDK usage. Do not maintain duplicated feature-level configuration requirement lists.
- Reuse the existing workflow engine, domain write owners, object storage, receipt infrastructure, and scheduler. Do not add another job queue or a configurable general-purpose pipeline engine.
- Replace old paths directly. Keep existing artifact, backup, manifest, compiler, protocol, and API version constants unchanged.

## Research basis

The implementation was researched at `e04ce622ee`. The target worktree was checked at `6a9cf8bcda`; the difference between those revisions contains only removal of two planning documents under `docs/`, with no changes to the researched implementation paths.

### Current behavior and constraints

| Finding | Relevant locations | Implementation consequence |
| --- | --- | --- |
| Shared persisted state consists of an import run and failure rows | `kernel/backend/src/lib/infrastructure/db/schema/tables/imports.ts`, `modules/imports/repository.ts` | Add durable activities, captured batches, and outcome state rather than overloading the existing counters. |
| Media invokes its parser inside every 25-item iteration, with up to 100 iterations per segment | `plugins/media/backend/workflows/media-import-segment.sandbox.ts`, `backend/imports/helpers.ts` | Many adapters refetch or reparse their full input per batch. Separate collection from application. |
| Media groups source records by entity reference and sorts their events | `plugins/media/backend/imports/groups.ts`, `helpers.ts`, `batch.ts` | Group position is not an event count or stable logical identity. Preserve record attribution and ordering through grouping. |
| Generic chunk processing writes and finalizes the whole run | `kernel/backend/src/modules/imports/generic-import-workflow.ts` | Split batch application from root completion before introducing incremental batches. |
| Source admission uses Redis state with a 24-hour TTL | `modules/imports/runtime/source-state-store.ts`, `lib/infrastructure/redis.ts` | Expiring Redis data must not be the authority for admitted, recoverable input. |
| Sandbox artifacts use the local temporary directory | `lib/infrastructure/sandbox-runtime/artifacts.ts`, `modules/uploads/AGENTS.md` | Store recoverable captures in permanent object storage. Temporary working directories may disappear. |
| Permanent object storage already supports S3 or persistent local storage | `modules/uploads/object-storage/service.ts` | Use existing storage selection, bounded writes, and deletion rather than a new storage backend. |
| Sandbox limits include 50 HTTP calls, 5 MiB scratch, 4 MiB results, 64 KiB context, and bounded journals/execution | `lib/infrastructure/sandbox-runtime/limits.ts` | Collect in bounded steps and pass payload references, not complete datasets, through workflow results and inputs. |
| `requiredPluginConfigKeys` is a runtime config-read allowlist as well as manifest metadata | `lib/infrastructure/sandbox-runtime/app-config.ts`, SDK/contract manifests | Coordinate compiler generation with runtime authorization and runner metadata validation. |
| SDK executable references contain schemas but currently use plain string targets | `packages/sandbox-sdk/src/workflow.ts` | Introduce statically resolvable references and bounded selectors for dependency analysis. |
| Event creation returns written and policy-skipped outcomes, and can stop after a partial write | `modules/events/event-create-workflow-live.ts`, `packages/contract/src/modules/events/schemas.ts` | Consume outcomes and the failure index; do not count all requested events as saved or failed. |
| Relationship primitives retain create/update/no-op information, but single-result projections discard it | `modules/relationships/mutation-pipeline.ts`, `mutation-support.ts`, `modules/collections/service.ts` | Preserve the required internal result facts for truthful membership and ownership summaries. |
| Receipts include execution identity, input fingerprints, and account generation | `modules/mutations/receipts.ts`, `workflow-dispatch.ts` | Keep stable identities within a run and integrate new owners with account reset/deletion retirement. |
| OAuth credential access requires a running integration run | `modules/oauth-connections/repository.ts` | Keep lifecycle separate from activity; do not finish a run when one batch completes. |
| Spotify and YouTube Music claim incoming updates before downstream writes | `plugins/media/backend/integrations/yanks/spotify.sandbox.ts`, `youtube-music.sandbox.ts` | Preserve integration-specific semantics while distinguishing provisional admission from confirmed application. |
| Legacy bootstrap maps integration cache state into script-scoped namespaces | `apps/server/src/migrations/migrate-data.ts`, cache mapping modules | Update bootstrap mappings if those namespaces or execution locations change; validate using its separate runbook. |

### Complete shipped-source inventory

- Media imports: AniList, Audiobookshelf, Goodreads, Grouvee, Hardcover, IMDb, IGDB, Jellyfin, MediaTracker, Movary, MyAnimeList, Netflix, Plex, Spotify, StoryGraph, Trakt, Watcharr.
- Fitness imports: Hevy, Strong App, OpenScale.
- Media webhook integrations: Plex, Jellyfin, Emby, Kodi, browser extension.
- Media scheduled integrations: Komga, Plex, Audiobookshelf, YouTube Music, Spotify.
- Kernel-native paths: manual Data JSON and Data webhook ingestion.
- Private plugin import/integration fixtures and installed third-party plugin contracts use the same SDK and must migrate with it.

The inventory is 17 media sources, 3 fitness sources, and 10 media integration providers. Trakt has user, public-list, and export modes within one source. Historical Jellyfin/Plex imports and their webhook integrations are distinct collection paths.

## Execution design

### Ownership and boundaries

Keep one canonical shared run repository and service. Put the common execution core in the existing backend imports feature, separating capture, batch application, progress, and finalization into focused modules. Keep public import admission and integration-specific admission/finalization in their current owners. A wholesale rename of IDs, causation fields, routes, or modules is not required for this work.

The kernel stays domain-agnostic. Plugins own source parsing, normalization, provider strategy, record-kind labels, and source-specific integration behavior. Domain services continue owning entity, event, relationship, collection, and provider writes.

The root execution owns:

1. Admitted input and execution plan.
2. Revision/configuration pins and captured payload references.
3. Source collection and batch dispatch.
4. Outcome aggregation and terminal status arbitration.
5. Descendant cancellation and resource cleanup.

Batch application never marks the root complete. Integration roots retain integration health/finalization responsibilities. Register all new durable owners through existing workflow admission and account-generation mechanisms.

### Durable state

Use schema-derived records for these concerns:

- Run: owner, source/integration identity, execution kind, lifecycle, accepted/started/finished timestamps, selected plan, pins, block reasons, optional fixed block deadline, collection sealing, and summary projection.
- Activity: stable activity identity, parent/batch identity where relevant, activity kind, unit, completed count, optional exact total, state, last advancement time, and known wait information.
- Capture/batch: stable run-local identity and ordinal, payload locator/checksum/size, collection checkpoint, preparation/application state, and references needed for recovery.
- Outcomes/issues: stable logical operation identity, record kind, committed/skipped/unsuccessful result, structured reason, source label, and source record attribution.

Store batch-level aggregates where possible. Persist individual facts needed for replay correctness and diagnostics, without constructing an unbounded full execution log or a cross-run deduplication registry.

An accepted operation is not necessarily a newly inserted record. Distinguish created, updated/refreshed, unchanged, skipped, and unsuccessful when the owning service exposes those facts. Provider preparation counts are supporting progress, not saved user history.

### Lifecycle and cancellation

Extend the ingestion lifecycle with `blocked` and `expired`. The intended transitions are:

```text
pending -> running -> completed | failed
blocked -> pending -> running
blocked -> expired
pending | blocked | running -> cancelling -> cancelled
```

Use conditional repository transitions. Readiness release, expiry, cancellation, and start must choose one winner. Include blocked runs in ownership, deletion, cancellation, and terminal-presentation rules. Keep activities such as reading, resolving, writing, and finishing separate from lifecycle status.

After cancellation wins, stop future application and interrupt descendants. Reconcile already committed write outcomes before finalizing cancellation, so a late committed receipt is not lost because ordinary progress updates reject `cancelling`. Preserve saved data and accurate partial summaries.

Seven-day expiry applies only while a delivery is blocked. Once it is released for execution, ordinary active-run recovery rules apply. Terminal expiry releases payloads and pins through idempotent cleanup. It is not an attempted-source failure for integration health.

### Storage and recovery

- Persist admitted uploads/deliveries and captured results using permanent object storage before depending on them for restart recovery.
- Store opaque locators/checksums in business state. Keep sandbox handles, temporary paths, and host authority internal.
- Materialize temporary inputs from durable locators under existing grants when a worker needs them.
- Publish a captured batch/checkpoint only after its bytes are durable. Handle object-written/DB-not-committed and DB-committed/dispatch-not-started gaps idempotently.
- Use deterministic object and batch identities, collision checks, and cleanup ownership. Do not hold a database transaction across storage, network, sandbox, or workflow operations.
- Retain needed inputs for running/suspended/blocked work. Release payloads on completion, failure, cancellation, or expiry; keep only summaries/issues afterward.
- Reuse current secret-storage conventions for admitted credentials. Never expose secrets, raw webhook bodies, payload paths, or OAuth tokens in progress, diagnostics, or client-safe plans.

### Collection and ordering

Collect once per run using bounded, replayable steps. Persist progress after real boundaries such as a source page, archive file, or completed details group. Completed source work must not be repeated merely because the writer advances to another batch.

Sources needing whole-dataset grouping/sorting seal their normalized capture before application. Sources that can safely produce independent batches may apply earlier. Do not force a streaming rewrite of every source.

Preserve entity-local chronology, stable equal-time ordering, and source attribution. Generic Data retains graph dependency ordering, cycle handling, failed-dependency propagation, and document-local ID resolution. Concurrency must not change event-policy or lifecycle behavior.

### Readiness and executable planning

Generate config-access and executable-dependency metadata from constrained SDK operations, not authored readiness lists or arbitrary control-flow inference.

- Required reads fail when unavailable; optional/defaulted reads do not block readiness.
- Keys must be literals or statically resolvable finite values.
- Executable references and alternatives must be typed and bounded to registered operations.
- Follow relevant shared helper usage and linked executable references. Do not treat every file in an imported module as an unconditional requirement.
- Split materially different operations where required, including Trakt API versus export collection.
- Resolve settings-dependent choices through a side-effect-free source plan. It must not fetch source data or mutate application state.
- Derive OAuth client prerequisites from existing OAuth provider definitions and account-connection requirements from the selected settings schema.
- Evaluate availability against the exact system/private installation and config revision. Defaults, `false`, and `0` are valid configured values when allowed by the schema.
- Reject unsupported key/target expressions with compiler diagnostics rather than silently claiming complete analysis.
- Keep generated metadata canonical through compiler output, plugin manifest/script records, archive validation, installation, and runtime read authorization. Production assembly must continue shipping prebuilt artifacts without compiler workers.

The picker shows unconditional requirements; the settings step evaluates selected branches; backend admission rechecks the plan. Execution consumes the accepted plan. Data-dependent provider requirements are refined after collection and produce attributed record issues without blocking unrelated supported records.

Presence checks are not credential validity checks. Remote rejection remains a runtime diagnostic.

### Integration behavior

- Scheduled runs are readiness-gated before admission while retaining current idle gating.
- Plugin webhook bodies remain unparsed in kernel ingress. Persist the accepted `{ rawBody, contentType }` envelope and resolve its configured integration authority.
- Known missing setup creates a durable blocked delivery, not a failed provider execution. Show its reasons and fixed expiry.
- Reuse existing scheduler/workflow infrastructure to re-evaluate blocked delivery readiness and dispatch ready work once. No per-tick replacement runs.
- Select and pin execution configuration when a blocked delivery is released. Once started, ordinary replay uses those pins; it does not silently pick up later configuration changes.
- Missing provider configuration discovered for an individual collected record becomes a record issue. Do not replan already-started runs against new configuration.
- Preserve successful no-op syncs, username/event filtering, minimum-progress skips, duplicate progress suppression, ownership sync, and source-specific daily-window behavior.
- Do not label a provisional Spotify/YouTube Music claim as saved. Advance source-specific completion state from confirmed outcomes, using the existing single-active-yank guard and replay mechanisms. Keep completion debounce linked to actual history, including concurrent sink deliveries.
- Update `lastFinishedAt` and continuous-error handling from the correct run outcome. Expected skips, blocked waiting, and blocked expiry are not source failures. Preserve cancellation behavior.
- Keep Data webhook submission-key idempotency: the same key/document reuses its original run; a changed document conflicts; a new key is a new append-only submission.

## Ordered implementation work

Each step includes its focused verification. The sequence is dependency-ordered; do not ship a partially migrated SDK/runtime protocol or maintain compatibility paths between steps.

### 1. Shared contract and persistence foundation

Locations: `packages/contract/src/modules/imports`, `packages/sandbox-sdk/src/imports.ts`, backend DB schema, `modules/imports/repository.ts`, service and lifecycle helpers.

- Define run/activity/capture/batch/outcome/issue schemas and derive types from them.
- Replace ambiguous whole-run percentage/item semantics with explicit projections.
- Add blocked/expired lifecycle, reasons, fixed deadline, and guarded transitions.
- Add database constraints, indexes, migration, ownership checks, and deterministic run-local identities.
- Preserve current source/integration ownership, execution kind, account generation, and terminal report deletion behavior.

Done when transitions and races are tested, schema-backed persistence agrees with contracts, and capture/outcome identity cannot drift with batch partitioning.

### 2. Compiler and SDK dependency generation

Locations: `packages/sandbox-sdk`, `packages/sandbox-compiler/src/compiler-*`, `packages/contract/src/modules/plugins`, `packages/cli`, `packages/plugin-archive`, definition registry, sandbox runner/config dispatcher.

- Add required versus optional configuration access semantics.
- Replace authored config-key lists with generated access metadata and readiness dependencies.
- Add analyzable executable references and finite selection.
- Link per-operation dependency facts and existing OAuth metadata.
- Update source/compiled metadata comparison, archive validation, registry persistence, runtime allowlists, durable host dispatch, and all shipped readers/fixtures together.
- Preserve explicitly authored capabilities unless changing one is required for the new SDK operation; capability inference is not a separate goal.

Done when shared-helper reads are found, optional defaults do not block, unsupported dynamics fail clearly, Trakt export avoids API requirements, and undeclared config access is still denied at runtime.

### 3. Plan evaluation and standardized readiness

Locations: import/integration catalogs, config revisions, source metadata, OAuth service, RyotQL catalog/recipes, client selection/settings forms.

- Introduce the pure source-owned plan selection surface and compiler-linked validation.
- Return structured readiness reasons, not a boolean with guessed explanatory text.
- Share evaluation and presentation across import and integration setup.
- Recheck and pin the accepted execution plan at admission/start as applicable.
- Keep private configuration scoped to its exact installation; never fall back to system environment values.

Done when the picker, selected settings, backend admission, and executed operation agree; setup can show multiple missing prerequisites without exposing secrets.

### 4. Durable capture and admission

Locations: imports admission/service/source state, object storage, sandbox artifact/grant bridge, workflow pinning, cleanup, integration webhook admission.

- Persist original recoverable input and capture chunks through permanent storage.
- Replace Redis TTL and temporary-path authority with durable references.
- Add bounded capture/checkpoint registration and checksum validation.
- Add blocked-delivery storage with accepted time and seven-day deadline.
- Extend user reset/deletion and integration/run deletion to retire owners and clean payload locators.

Done when capture publication is replay-safe and a worker can recover after its temporary directory is deleted.

### 5. Batch application and root finalization

Locations: `generic-import-workflow.ts`, `data-workflow.ts`, parent import/integration workflows, `boot/kernel-workflow-references.ts`, SDK kernel references, owning domain services and their receipt result projections.

- Make batch application return outcomes without finalizing the run.
- Derive commands from stable captured record/sub-operation identity, not a reset per-batch index alone.
- Reuse committed mutation receipts and preserve input fingerprints.
- Consume per-event written/skipped results, partial failure index, and unapplied remainder correctly.
- Preserve created/updated/no-op facts from relationship and membership operations where summaries need them.
- Aggregate outcomes idempotently, including recovery after commit but before projection.
- Give roots sole terminal arbitration, descendant interruption, and cleanup responsibility.

Done when the first batch cannot finish the run, replay cannot duplicate/count writes twice, and cancellation summaries include all confirmed partial results.

### 6. Migrate all source families

Locations: media/fitness `backend/imports`, media workflows/integrations, host declarations, source-local contracts and tests.

- Convert file adapters to one collection pass with durable output references.
- Convert credentialed adapters to bounded page/list/detail steps with visible advancement.
- Extract ZIP/file handling into bounded steps without putting complete archives or datasets into workflow context/results.
- Preserve normalization, grouping, source index attribution, and equal-time ordering.
- Retain run-local deduplication already performed by adapters, including Spotify's exact play-key handling within one export.
- Move Netflix TMDB title matching out of collection into the provider-resolution path.
- Keep provider population and episode resolution as domain-owned operations and supporting activities.
- Preserve Fitness workout/set order and exercise resolution; report workouts/measurements rather than internal chunks.
- Adapt Data JSON execution to shared outcomes and completion while preserving its specialized graph planner.

Done when every source in the inventory uses the new path, collection does not repeat per application batch, and semantic counts match actual writes.

### 7. Integrations, blocked resumption, and health

Locations: `modules/integrations`, `modules/oauth-connections`, shared lifecycle/pinning, scheduled tasks, media integration admission and source-specific state.

- Readiness-gate scheduled admission without creating repeated failure reports.
- Re-evaluate blocked deliveries using the existing scheduler and dispatch admitted owners exactly once.
- Arbitrate readiness release against fixed expiry and cancellation.
- Preserve raw-body ingress, Data submission keys, yank idle gating, and independent sink deliveries.
- Make source-specific integration completion state agree with committed outcomes; preserve existing duplicate/debounce semantics and daily windows.
- Exclude blocked/expired setup work from continuous-error disabling and show successful no-op runs accurately.
- Keep OAuth access, integration deletion, and account-generation retirement consistent with lifecycle.

Done when a stored blocked delivery runs after setup is fixed, expires cleanly after seven days if not fixed, and cannot execute after cancellation, integration deletion, or account reset.

### 8. UI, issue exports, and documentation

Locations: `packages/ryotql-recipes`, backend RyotQL catalog, client imports/integrations/shared run presentation, failure export/download-ticket handling, `apps/docs`, plugin READMEs, plugin-kit authoring documentation.

- Display activity, real counts, last advancement, known waits, block reasons, expiry, and partial outcomes.
- Use source-owned unit labels through a structured contract; never call six-play groups tracks or listening events.
- Permit multiple active activities and avoid a single mutable stage that concurrent work overwrites.
- Use determinate bars only for an exact denominator with the matching unit.
- Remove the null-total-to-Preparing assumption and unsupported estimated-finish copy.
- Update issue paging/export so users can identify record failures separately from run failures and expected skips.
- Preserve append-only and non-reversible import documentation; state that independent imports can duplicate activity.
- Document active recovery, configuration pinning, terminal cleanup, and seven-day blocked delivery expiry.
- Build shipped plugin bundles before running `bun run generate` from `apps/docs` if manifest/configuration references change.

Done when both setup flows show the same actionable prerequisites and import/integration run screens tell the same outcome story.

### 9. Remove replaced paths and integrate assembly/legacy behavior

- Delete the parser-per-write-batch orchestration, duplicated manual requirement lists, whole-run chunk finalization, and obsolete counter presentation.
- Update fixture/private plugin sources and generated artifacts for direct SDK replacement.
- Keep shipped archive assembly and production compiler-worker exclusion intact.
- Update legacy bootstrap's script-scoped claim mapping if the integration admission script location/namespace changes. Read its README and follow the prescribed restored-dump validation; normal E2E is not a substitute.
- Do not add capture/run history to user backups as a new feature. Preserve existing domain backup/restore behavior and account-generation retirement; no cross-run dedup ledger requires backup portability.
- Update current architecture/authoring docs without retaining superseded designs in production documentation.

Done when there is one execution/readiness path and no compatibility exports or stale generated requirement consumers.

## Validation matrix

Use deterministic injected Layers, recording functions, TestClock where supported, and the package's assertion helpers. No module mocks, spies, fake timers, or tautological schema tests.

| Area | Required behavior tests |
| --- | --- |
| Compiler/SDK | Shared-helper reads, optional defaults, literal/finite references, rejected unbounded targets, selected alternatives, mode-specific requirements, unknown config keys, source diagnostics. |
| Archive/install/runtime | Generated metadata round-trip and validation, runtime config allowlists, exact private installation, system config revisions, runner-source matching, OAuth dependencies, prebuilt production assembly. |
| Admission | Durable input before dispatch, readiness changes before start, rollback/orphan cleanup, account generation, ownership isolation, Data submission-key reuse/conflict. |
| Collection | More than one source page/file/details group, progress before providers, no repeated full collection per write batch, grouping/order preservation, bounded payloads and existing sandbox limits. |
| Writes/outcomes | Multiple events per group, partial event failure, policy skips, independent record success, membership/ownership no-ops, warnings separate from failures, outcome reconciliation from receipts. |
| Recovery | Restart after capture, commit-before-outcome gap, dispatch gap, deleted temporary directory, unchanged execution pins, missing/corrupt captured bytes reported explicitly. |
| Cancellation | Before start, while blocked, during collection/provider/application, concurrent completion, cleanup replay, preserved partial outcomes. |
| Integrations | No-op sync, username/event filtering, minimum progress, duplicate/debounce behavior, Spotify overlap, YouTube Music local-day windows, source completion state after confirmed writes, health classification. |
| Blocked delivery | Durable raw envelope, readiness release once, seven-day fixed deadline, expiry/readiness/cancel races, expiry cleanup, no auto-disable contribution, deletion/reset retirement. |
| Data graph | Duplicate keys, unavailable schemas, cycles, failed dependencies, nested reference rewriting, ordered segments, partial writes. |
| Client | Setup reasons in both pickers, settings-dependent readiness, ongoing source activity, unknown total, meaningful outcome units, blocked/expired display, cancellation/terminal actions, issue paging/export. |

Relevant existing tests include:

- `packages/sandbox-compiler/src/compiler-plugins.test.ts` and compiler bundle tests.
- Sandbox SDK workflow/provider/config-related tests and compile-time contract tests.
- `packages/cli/src/index.test.ts`, `packages/plugin-archive/src/index.test.ts`, contract manifest tests.
- Backend sandbox config, host dispatcher, checkpoint, workflow reference, and runner tests.
- Backend imports repository/service/graph/generic workflow/root/cancellation tests.
- Backend integrations service/workflow/worker/sync/disable-claim tests.
- Media adapter, chunks, integration-progress, workflow, and host source tests; Fitness adapter/workout/shared/workflow tests.
- Client import and integration route/presentation tests and shared recipe tests.

Run affected E2E files individually using:

```sh
bun turbo --filter=@ryot-app/e2e test --only -- '<file>'
```

Select affected files from these existing suites and add focused missing scenarios in the matching ownership directory:

- `e2e/src/api/kernel/imports/{imports,data-json,durability,private-import-sources}.test.ts`
- `e2e/src/api/kernel/integrations/{integrations,data-webhook,private-integration-providers,continuous-error-disable,pro-gated-providers,plugin-provider-redaction}.test.ts`
- `e2e/src/api/plugins/media/imports/imports.test.ts`
- `e2e/src/api/plugins/media/integrations/integrations.test.ts`
- `e2e/src/api/plugins/fitness/imports/imports.test.ts`
- `e2e/src/browser/import-data.test.ts`
- `e2e/src/browser/integrations.test.ts`
- Backup round-trip or user lifecycle suites only where those consumers change.

Use existing operational gates only when changed execution behavior warrants their load/overlap validation. Do not change worker/pool settings without fresh evidence, run live provider smoke without its opt-in prerequisites, or run the entire E2E suite.

Final acceptance:

```sh
bun run check
bun turbo --filter='!@ryot-app/e2e' test
```

After implementation is complete, execute `.agents/skills/codebase-cleanup` once in the main session and run the checks needed for any cleanup changes. Review the final diff for obsolete paths, config leaks, generated artifacts, and ownership consistency.

## Completion criteria

- Source and provider work is visible before user-history writes begin.
- Source collection happens once per run in bounded recoverable steps.
- Confirmed results appear incrementally with correct units and partial-write accounting.
- Active-run replay survives restart and loss of ephemeral working files without duplicate writes or counts.
- Only roots finish runs; cancellation preserves committed work and reconciled summaries.
- Imports and integrations use generated, operation-specific readiness with consistent UI and backend checks.
- Blocked webhooks are durable, resume once, expire after seven days, and do not damage integration health merely for waiting on setup.
- Manual imports remain append-only; no reversal, cross-import deduplication, or selective retry feature has been added.
- All shipped sources, private-plugin fixtures, contracts, archive/runtime consumers, affected documentation, and required tests agree with the new execution model.
