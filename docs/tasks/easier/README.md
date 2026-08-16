# Backend Simplification Audit

Audit complete. The canonical coverage contract contains **76 explicit subsystem rows**:

- **21 recommend**
- **55 skip**
- **24 accepted recommendations**
- **13-workspace dependency closure**
- **1,197 tracked closure files**
- **516 backend files**
- **174 backend test files**

No files were changed. Initial and final `git status --short`, final `git diff --stat`, and final `git diff --name-only` were empty. No tests, builds, commits, or pushes were performed.

## Final Priorities

| Rank | Recommendation                                  | Impact | Confidence | Effort | Blast radius | Prerequisite                                |
| ---: | ----------------------------------------------- | :----: | :--------: | :----: | :----------: | ------------------------------------------- |
|    1 | Atomic integration-run admission                |   H    |     H      |   M    |      M       | Resolve duplicate active rows; DB migration |
|    2 | Preserve raw webhook transport                  |   H    |     H      |   M    |      W       | Contract and durable-payload versioning     |
|    3 | Deterministic frequent-cron IDs                 |   H    |     H      |   S    |      M       | Prefer after rank 1                         |
|    4 | Remove incorrect entity provenance pre-read     |   H    |     H      |   S    |      M       | None                                        |
|    5 | Correct Pro-key expiry representation           |   H    |     H      |   S    |      N       | None                                        |
|    6 | Atomic translation-overlay upsert               |   H    |     H      |   S    |      N       | None                                        |
|    7 | Atomic saved-view reorder                       |   M    |     H      |  S-M   |      M       | None                                        |
|    8 | Simplify upload cleanup state                   |   M    |     H      |   M    |      M       | Drain/dual-decode Redis records             |
|    9 | Scope-own sandbox bridge sessions               |   H    |     H      |   M    |      M       | None                                        |
|   10 | Reuse backup event export context               |   M    |     H      |   M    |      M       | None                                        |
|   11 | Scope-own backup archive spool                  |   M    |     H      |   S    |      M       | Caller scope must cover restore             |
|   12 | Centralize import dispatch and rollback         |   M    |     H      |   M    |      M       | None                                        |
|   13 | Single-own RyotQL kind inference                |   M    |     H      |   M    |      M       | None                                        |
|   14 | Make SDK provider codecs canonical              |   M    |     H      |   M    |      W       | SDK first, backend second                   |
|   15 | Return structured saved-view validation issues  |   M    |     H      |  S-M   |      M       | Preserve text diagnostics                   |
|   16 | Discriminate lifecycle mutations                |   M    |     H      |   M    |      M       | Keep durable wire shape compatible          |
|   17 | Discriminate user-lifecycle preparation         |   M    |     H      |   S    |      N       | None                                        |
|   18 | Remove unreachable local-storage states         |   M    |     H      |   M    |      M       | Confirm validated config is mandatory       |
|   19 | Use one durable request index                   |   M    |     H      |   S    |      M       | Preserve generated names                    |
|   20 | Reuse provider search resolution                |   M    |     H      |   S    |      N       | None                                        |
|   21 | Single-own legacy episodic fallback SQL         |   M    |     H      |   S    |      M       | Legacy dump runbook                         |
|   22 | Remove obsolete transactional template pipeline |   M    |     H      |   M    |      W       | Coordinate Rust workflow                    |
|   23 | Make checks verification-only                   |   M    |     H      |   S    |      W       | Add separate fix command if wanted          |
|   24 | Remove website-local admin result protocol      |   M    |     H      |   S    |      M       | Accept formerly ignored failures            |

Best first slices: ranks 4-7 are narrow and migration-free. Then implement rank 1 before rank 3 so mixed scheduler deployments remain protected.

## Accepted Findings

### 1. Atomic Integration-Run Admission

**Owner:** D15 Integrations

**Evidence:** `apps/app-backend/src/modules/integrations/service.ts:475-488` checks `hasActiveRunForIntegration` and then separately calls `createRunForIntegration`. The repository operations are independent at `apps/app-backend/src/modules/imports/repository.ts:36-60,79-95`. No uniqueness constraint prevents multiple active integration runs at `apps/app-backend/src/lib/infrastructure/db/schema/tables/imports.ts:95-102`.

**Current complexity:** Concurrent scheduler or manual triggers can both pass the check and create distinct active runs.

**Proposal and scope:** Add an Imports-owned `createRunForIntegrationIfIdle` operation backed by a partial unique index for `pending` and `running`. Update integration admission and focused service/repository tests.

**Risks and migration:** Resolve existing duplicate active rows before adding the index. Map only that index conflict to “not admitted.”

**Validation:** Concurrent same-integration admission, different integrations, terminal-run replacement, scheduler loss of admission, integration service tests.

**Implemented.** Exclusivity is scoped to yank admission: `import_run.integration_lot` records how a run was admitted, and `import_run_integration_active_unique` covers `integration_id` only where `integration_lot = 'yank'` and the status is `pending` or `running`. Sink runs stay unconstrained because `handleWebhook` legitimately creates one run per webhook delivery, which a blanket index would reject. `hasActiveRunForIntegration` is removed.

### 2. Preserve Raw Webhook Transport

**Owner:** D15 Integrations

**Evidence:** The contract accepts JSON at `packages/contract/src/modules/integrations/schemas.ts:132-153`. The backend re-encodes it and forces `application/json` at `apps/app-backend/src/modules/integrations/service.ts:354-424`. Plex requires the original multipart body and boundary at `plugins/media/scripts/integrations/sinks/plex.sandbox.ts:27-66`.

**Current complexity:** Ingress decodes provider-specific transport into JSON, then recreates a different transport. Production Plex input cannot satisfy its adapter despite tests injecting multipart directly.

**Proposal and scope:** Carry a bounded `{ rawBody, contentType }` envelope from HTTP ingress through the integration workflow. Keep provider parsing inside scripts. Preserve existing JSON callers.

**Risks and migration:** Version the durable workflow payload. Do not forward cookies, authorization, or arbitrary headers.

**Validation:** Real multipart Plex request through `/_i/:id`, JSON Kodi and extension callers, malformed boundary cases, payload-size limits, workflow replay.

**Implemented.** The webhook endpoint declares one text payload per entry in `integrationWebhookContentTypes` (`application/json` and `multipart/form-data`, the only transports the shipped sinks receive); anything else is rejected with `415` before the module runs. The route forwards the unparsed body together with the request's own `content-type` header, and `IntegrationRunJobData.webhook` replaces the independently optional `rawBody`/`contentType` pair with one envelope that is present exactly for sink deliveries. `IntegrationWebhookPayload` and the JSON re-encode in `handleWebhook` are removed, so Plex multipart boundaries reach `integration.plex-sink` intact. No header other than `content-type` is forwarded.

### 3. Deterministic Frequent-Cron IDs

**Owner:** D26 Scheduler

**Evidence:** Every process creates `frequent-cron-${generateId()}` at `apps/app-backend/src/modules/scheduler/frequent-cron.ts:29-41`.

**Current complexity:** Replicas and same-interval restarts enqueue distinct durable workflows for the same occurrence.

**Proposal and scope:** Derive the ID from the configured schedule and current interval bucket.

**Risks:** Restarting inside a bucket no longer forces an extra run. That is the intended ownership model.

**Validation:** Two scheduler layers produce one ID in the same bucket, distinct IDs in later buckets, unchanged disabled/fallback behavior.

**Implemented.** The dispatcher no longer fires on process start and then drifts by `Schedule.spaced`. It sleeps to the next interval boundary the way `PluginCronSchedulerLive` does, and `frequentCronExecutionId` derives the ID from the resolved interval and that boundary, so every replica and every restart maps one occurrence to one `frequent-cron-${intervalMs}-${scheduledAt}` execution. Because `integrationsFrequentTask` derives its sync execution ID from the same payload, the integration sync fan-out is deduplicated too. The unsupported-schedule warning and its 5-minute fallback, plus `disableDispatchers`, are unchanged; the fallback interval is now part of the ID, so replicas configured with different phrases that resolve to the same interval still share one occurrence.

### 4. Remove Incorrect Entity Provenance Pre-Read

**Owner:** D08 Entities

**Evidence:** User-scoped creation pre-reads at `apps/app-backend/src/modules/entities/service.ts:148-163`. The lookup uses visibility semantics that include global entities, while `insertEntity` already owns exact conflict handling at `repository.ts:752-789`. The pre-read also occurs before name/property validation at `service.ts:165-175`.

**Current complexity:** A user-scoped create can incorrectly return a matching global entity and skip validation.

**Proposal and scope:** Validate first, then use `insertEntity` and `{ entity, wasInserted }` as the only provenance-conflict primitive. Remove the pre-read method if no callers remain.

**Risks:** Invalid repeated-create payloads will fail instead of silently returning an existing entity.

**Validation:** Matching global row does not satisfy user creation, same-user conflict reuse, invalid replacement input, concurrent conflict handling.

**Implemented.** `createEntity` no longer pre-reads provenance. It resolves the schema scope, validates the name and properties, and then calls `insertEntity`, which owns exact conflict handling through the scope-specific partial unique indexes and returns `{ entity, wasInserted }`. A user-scoped create can no longer return a global row that merely happens to share `externalId`/`providerId`, and invalid payloads now fail instead of short-circuiting to an existing entity. `findEntityByExternalIdForUser` had no other caller and is removed.

### 5. Correct Pro-Key Expiry Representation

**Owner:** I01 Configuration and operations

**Evidence:** Expiry is any string at `apps/app-backend/src/lib/infrastructure/pro-key.ts:20`. Invalid dates become `Option.none` at lines 64-65 and are accepted. Expiry is compared with process startup time captured at line 25 rather than verification time at lines 66-75.

**Current complexity:** Malformed expiry means “no expiry,” and a key that expires after startup can remain valid through later cached verifications.

**Proposal and scope:** Decode expiry directly to a validated `DateTime`. Compare it with `DateTime.now` inside each uncached verification.

**Risks:** Malformed provider metadata changes from accepted to fail-safe false.

**Validation:** Future, expired, malformed, and just-expired metadata; cached verification after advancing the clock.

**Implemented.** `ProKeyMeta` decodes `expiry` with `Schema.DateTimeUtcFromString`, so a malformed or non-string expiry now fails the existing decode branch and verification fails safe to `false` instead of being read as "no expiry". `serverStartTime` is gone: `verify` compares the decoded `DateTime` against `DateTime.now` in its own body, so each uncached verification re-evaluates expiry. `isValidated` keeps its one-hour `Effect.cachedWithTTL`, which now bounds how long a key that expires while the process runs stays accepted, rather than letting it stay accepted for the life of the process.

### 6. Atomic Translation Upsert

**Owner:** D11 Entity translation

**Evidence:** `TranslationsService.upsert` reads then chooses update/create at `service.ts:73-80`. The workflow repeats that decision and conflict recovery at `entity-translation-workflow-live.ts:40-55`. Repository methods span `repository.ts:61-133`.

**Current complexity:** Two read-then-write state machines and race-specific recovery paths represent one database operation.

**Proposal and scope:** One repository `INSERT ... ON CONFLICT (entity_id, language) DO UPDATE RETURNING`, one service method, one workflow call.

**Risks:** Confirm intended last-writer behavior and `updatedAt` handling.

**Validation:** Insert, update, concurrent upsert, notification publication, service and workflow tests.

**Implemented.** `TranslationsRepository.upsertOverlay` is the only overlay write: one `INSERT ... ON CONFLICT (entity_id, language) DO UPDATE ... RETURNING` that takes `name`, `properties`, and `populatedAt` from `excluded` and sets `updated_at` to `now()`, because Drizzle's `$onUpdate` applies only to `UPDATE` statements. Last writer wins. `findOverlay`, `createOverlay`, and `updateOverlay` are removed along with the service's `create` and `update` methods, so `TranslationsService.upsert` is the single service entry point and `writeTranslationOverlay` calls it once instead of pre-reading and recovering from a `Conflict`. The overlay write can no longer produce `Conflict` or `NotFound`, leaving a died `DbError` as its only failure mode; the `translated` notification still publishes after the write. A kernel e2e case asserts that concurrent and repeated upserts keep exactly one row and end at the last written values.

### 7. Atomic Saved-View Reorder

**Owner:** D25 Saved views

**Evidence:** `apps/app-backend/src/modules/saved-views/service.ts:240-286` validates order, then calls the complete update path once per view.

**Current complexity:** Repeated reads and definition validation are unnecessary for sort-order changes. A later failure leaves earlier rows reordered.

**Proposal and scope:** Validate scope once, then call one repository `reorderBySlugs` operation in one transaction or set-based statement.

**Risks:** Preserve partial-order semantics, built-in ordering, plugin scope, and affected-row checks.

**Validation:** Atomic failure, user/plugin isolation, partial lists, concurrent reorder, existing saved-view lifecycle tests.

**Implemented.** `reorder` resolves the plugin scope once, validates the requested slugs against that scope, and then issues a single `SavedViewsRepository.reorderBySlugs` statement: one `UPDATE ... SET sort_order = case slug when ... then ... end` filtered by user, scope, and slug list, returning the affected slugs. The per-view `update` loop is gone, so a reorder no longer re-reads each row, re-validates layouts and entity schemas, or rewrites definition columns, and it can no longer leave earlier rows reordered when a later row fails. Built-in and custom views take the same path because only `sort_order` changes. The affected-row count is still checked and still maps to `invalid-reorder`/`update-failed`, which now means a scoped view disappeared between validation and the write. The service's private `list` helper had no other caller and is removed.

### 8. Remove Redundant Upload Cleaning State

**Owner:** D30 Uploads

**Evidence:** Metadata permits loosely combined optional fields and four states at `uploads/intents/service.ts:35-55`. Cleanup acquires two locks, writes `cleaning`, and restores the prior record on failure at lines 418-488. All other mutations already use `uploadIntentLock`.

**Current complexity:** The second lock, `cleaning` state, `cleaningAt`, redundant decoded-state check, and rollback encoding add another state machine without additional exclusion.

**Proposal and scope:** Use only the intent lock, reread expiry, and remove the intent directly. Stop writing `cleaning`; leave failed records indexed for retry.

**Risks and migration:** Existing Redis `cleaning` records have no key TTL and must remain decodable until drained or rewritten. Preserve renewed expiry indexes instead of deleting them.

**Validation:** Cleanup racing completion/claim, renewed expiry, failed deletion retry, corrupt/missing records, existing cleaning-record migration.

**Implemented.** `cleanupPendingIntents` acquires only `uploadIntentLock`, which every other intent mutation already holds, so `uploadIntentCleanupLock` is gone along with the second lease and its manual release on the contended path. Inside that one lock the pass rereads the record, and either drops a vanished record's index entry, reindexes a record whose expiry was renewed between selection and the lock, or removes the intent directly. `cleaning`, `cleaningAt`, the redundant decoded-state check, and the rollback re-encode are removed: `UploadIntentMetadata.state` is now exactly `pending`, `completed`, or `claimed`. A failed deletion writes nothing, so the record keeps its existing expiry index entry and the next cron tick retries it. Renewed expiries are reindexed at `metadata.expiresAt` through a new `RedisService.zadd` instead of being deleted from the index, which previously stranded a claimed intent whose 24-hour lease was granted just after cleanup selected it. `removeUploadIntent` keeps its read-then-delete shape for `deleteTemporaryUpload`, and both paths share one `removeIntentRecord` so cleanup no longer reads and decodes the same record twice. No `cleaning` records are drained because the project has no production Redis state.

### 9. Scope-Own Sandbox Bridge Sessions

**Owner:** I07 Sandbox runtime

**Evidence:** `BridgeService.addSession` replaces map entries without closing the previous session at `runtime.ts:319-352`. Cleanup is registered separately after insertion at `service.ts:305-314`. Either finalizer can remove a newer replacement.

**Current complexity:** Registration and cleanup are separate ownership operations, with an interruption window and identity-blind deletion.

**Proposal and scope:** Make registration scoped. Close a replaced session, and remove only the exact session instance installed by that scope.

**Risks:** Preserve finalizer ordering so bridge closure still precedes process and scratch cleanup.

**Validation:** Duplicate registration, old finalizer after replacement, interruption after registration, old session receives `410`, runtime concurrency tests.

**Implemented.** `BridgeService.addSession` is now one scoped acquisition: `Effect.acquireRelease` installs the session and its removal finalizer together, so an interruption immediately after registration can no longer leave a session in the map. Acquisition closes the session it replaces, which ends that session's active and queued calls with `410` instead of orphaning them behind a live map entry. Release is identity-aware — it deletes the entry only when the map still holds the exact instance that scope installed — so a late finalizer cannot evict a newer replacement, and the same `evictSession` helper backs the in-request expiry path. `removeSession` is gone from the service surface: `SandboxService.runSandbox` no longer registers a separate `Effect.addFinalizer` after insertion, and because the scoped acquisition happens exactly where that pair used to sit, LIFO teardown still closes the bridge session before the worker, process, and scratch-directory finalizers. The bridge layer finalizer now closes and clears remaining sessions directly. `runtime-concurrency.test.ts` covers replacement (`410` for the replaced session, the replacement surviving the old scope's close, `404` after its own scope closes), interruption of the registering fiber, and scope-close teardown of queued calls.

### 10. Reuse Backup Event Export Context

**Owner:** D03 Backup export

**Evidence:** `readEventPage` reloads system plugins, private plugins, historical definitions, plugin-key maps, and referenced entities on every page at `backups/export/snapshot.ts:594-623`. Export setup already obtains equivalent context at lines 297-354 and 692-723.

**Current complexity:** Each event page repeats three repository reads and rebuilds maps during both event scans.

**Proposal and scope:** Build plugin/schema/entity context once and pass it into page processing. Keep the two streaming scans.

**Risks:** Preserve historical private-plugin provenance and O(page-size), not O(total-events), event memory.

**Validation:** Multi-page export with repository call counters, unchanged redaction/assets/event bytes, archive round trip.

**Implemented.** `readExportContext` reads the system and private plugin lists once per export and derives the archive-key maps, the historical private-definition snapshots, and one lookup per definition kind from them. `readExportData` and both event scans consume that context, so `readEventPage` now performs exactly one repository read per page — the event rows themselves. The per-page `listPortablePluginMetadata`, `listPrivateForUser`, and `getByIdsForUser` calls are gone, together with the per-page rebuild of the plugin-key map and the historical snapshots; `EntitiesRepository.getByIdsForUser` had no other caller and is removed. The four hand-written copies of the current-versus-historical definition resolution collapse into `definitionLookups`, and both scans now resolve an event's property schema through one `eventPropertiesSchema` helper backed by an entity map built once from the exported entities and dependencies. Previously the two scans resolved event schemas by different paths, so the assets collected in the first scan did not have to match the schemas the second scan transformed, and the per-page entity read also fetched `sessionEntityId` rows it never consulted. Both streaming scans and O(page-size) event memory are unchanged. A multi-page export test asserts that each plugin repository method is called exactly once regardless of page count, that both scans walk the same page cursors, and that event asset collection, redaction paths, and written event bytes are unchanged.

Exporting a dependency also emitted `origin`, which `V2EntityDependency` does not declare, so every export containing a global dependency failed archive encoding with an excess-property error. `toV2Entity` now returns the fields both records share and the user-entity path adds `origin` itself. This was a pre-existing break from the preceding commit rather than part of this finding, but it blocked the archive round trip this finding is validated against.

### 11. Scope-Own Backup Archive Spool

**Owner:** D03 Backup archive

**Evidence:** `ValidatedV2Archive` exposes manual cleanup at `archive-v2/archive.ts:604-610`; validation creates an unscoped directory at lines 1286-1305 and returns cleanup at lines 905-913.

**Current complexity:** Every success caller must remember cleanup after consuming event and asset streams.

**Proposal and scope:** Acquire the spool directory with scoped resource ownership. Remove `ValidatedV2Archive.cleanup`; keep restore consumption inside the scope.

**Risks:** The scope must remain alive through every event read and asset stream. Cleanup failure must not turn a committed restore into failure.

**Validation:** Success, validation failure, interruption, malformed events, count mismatch, committed restore with cleanup failure.

### 12. Centralize Import Dispatch and Rollback

**Owner:** D14 Imports

**Evidence:** File and payload dispatch independently perform pin registration, Redis state storage, workflow enqueue, and rollback at `imports/service.ts:110-250` and `253-330`.

**Current complexity:** Two copies already differ in upload cleanup and ordering. Each must coordinate workflow pins, Redis, uploads, run status, and enqueue failure.

**Proposal and scope:** Keep file claiming and summary updates file-specific, then call one private post-admission dispatch operation that owns pinning, state storage, enqueue, and rollback.

**Risks:** Preserve the distinction between deleting pre-dispatch failed runs and retaining failed runs after durable admission starts.

**Validation:** Both paths under pin, state-store, and enqueue failures; registration-status-specific release; upload cleanup.

### 13. Single-Own RyotQL Kind Inference

**Owner:** D22 Backend RyotQL

**Evidence:** Validator inference is at `ryotql/validator.ts:49-56,202-260`. Executor independently implements the same recursive semantics at `ryotql/executor.ts:92-176`.

**Current complexity:** New expression variants require synchronized edits; validator/executor disagreement can validate one kind and compile another.

**Proposal and scope:** One resolver-neutral kind function parameterized by alias/table resolution. Validator can return `undefined`; executor converts unresolved values to its existing invariant error.

**Risks:** Preserve correlated alias shadowing and mixed `coalesce`/conditional behavior.

**Validation:** Table-driven parity across every expression variant, correlated `first`, null branches, unknown aliases, existing validator/executor tests.

### 14. Make SDK Provider Codecs Canonical

**Owner:** W14 Sandbox SDK

**Evidence:** Backend duplicates SDK schemas at `sandbox/provider-contracts.ts:16-106`. SDK definitions already exist at `packages/sandbox-sdk/src/provider.ts:75-168`. Search pagination differs: backend uses finite numbers; SDK uses `Schema.Number`.

**Current complexity:** A parity-only test protects two sources of truth.

**Proposal and scope:** Tighten SDK pagination to finite numbers, then alias backend decoders to SDK schemas. Remove unused decoders and parity-only tests.

**Risks:** Preserve strict excess-property rejection, trimming, recursive children, and schema identifiers required by durable activities.

**Validation:** SDK and backend checks, non-finite rejection, recursive details, provider search/population/translation tests.

### 15. Return Structured Saved-View Validation Issues

**Owner:** D06 Definition registry

**Evidence:** Registry validation constructs sentence strings at `definition-registry/service.ts:177-273`. `saved-views/definition-validation.ts:14-64` parses those strings with prefixes, regex, slicing, and exact message matching.

**Current complexity:** Structured facts are converted to prose and reconstructed. Wording drift silently changes classifications.

**Proposal and scope:** Return `{ layout, issue, field?, diagnostic }`. Keep one formatter for startup and backup text consumers.

**Risks:** Preserve exact diagnostics consumed by registry admission and backup restore.

**Validation:** Every issue/layout/field branch, semantic RyotQL fallback, registry invalid definitions, backup rejection.

### 16. Discriminate Lifecycle Mutations

**Owner:** D08 Entities lifecycle boundary

**Evidence:** Each source independently permits absent `before` and `after` at `entities/lifecycle-dispatch.ts:51-58`. Operation is separately optional at lines 88-97. The consumer throws when both snapshots are absent at `automations/lifecycle-dispatch.ts:24-29`.

**Current complexity:** Create/update/delete snapshot requirements are conventions; contradictory operation/snapshot combinations are representable.

**Proposal and scope:** Use an in-memory operation union requiring `after` for create, both for update, and `before` for delete. Keep durable automation payload encoding compatible.

**Risks:** Compile-time changes across entity, event, relationship, and provider-population producers.

**Validation:** Existing lifecycle dispatch tests plus explicit create/update/delete routing and provider population batches.

### 17. Discriminate User-Lifecycle Preparation

**Owner:** D31 User lifecycle

**Evidence:** Repository results contain nullable `active`, nullable `retryable`, and duplicated `metadata` at `user-lifecycle/repository.ts:112-154`. Service interprets this cross-product sequentially at `service.ts:128-172`.

**Current complexity:** Contradictory combinations are representable; metadata exists for branches that do not consume it.

**Proposal and scope:** Return tagged `active`, `retryable`, `new`, or `missing` cases. Preserve active-before-retry precedence.

**Risks:** Internal type migration only. Do not change persisted operation states.

**Validation:** Active operation, kind-specific failed retry, missing user, fresh preparation, concurrent request tests.

### 18. Remove Unreachable Local-Storage States

**Owner:** I06 Storage

**Evidence:** `local-storage.ts:63-123` models `permanentConfigured`, nullable `permanentRoot`, `requireConfigured`, and runtime unavailable errors. Application configuration already requires absolute non-empty local paths and supplies defaults.

**Current complexity:** Production configuration rejects the state that storage continues to model.

**Proposal and scope:** Treat both local roots as required resolved strings. Permanent object selection remains S3 when configured, otherwise local.

**Risks:** Tests or alternate layers that bypass `AppConfig` validation may currently create empty roots.

**Validation:** Config empty-path rejection, startup probes, S3 preference, local fallback, path containment.

### 19. Use `request.index` as Sole Durable Identity

**Owner:** D24 Durable sandbox orchestration

**Evidence:** Dispatcher accepts both `request.index` and `requestIndex` at `sandbox/durable-host-dispatcher.ts:254-260`. The workflow passes the same value twice at `sandbox-script-workflow.ts:520-529`. Runtime dispatch names use both at `lib/infrastructure/sandbox-runtime/durable-host-dispatcher.ts:512-539`.

**Current complexity:** One request can produce activity names from one index and child execution IDs from another. A test deliberately demonstrates the mismatch.

**Proposal and scope:** Remove `requestIndex`; derive all names and IDs from `request.index`.

**Risks:** Valid production calls retain identical names. Investigate any persisted test or operational payload that intentionally supplied different indexes.

**Validation:** Replay, HTTP retry, activity naming, child-ID and dispatcher tests.

### 20. Reuse Provider Search Resolution

**Owner:** D20 Provider entities

**Evidence:** Search resolves provider/script at `provider-entities/search-service.ts:51-74`. Filtered search calls `resolveSearchOptionsSchema`, which resolves them again at lines 76-100 and is invoked at lines 159-181.

**Current complexity:** Filtered searches repeat provider availability and script resolution and can observe different plugin snapshots inside one request.

**Proposal and scope:** Extract option-schema materialization to accept the already-resolved provider/script context.

**Risks:** Keep auxiliary search-options script resolution separate and preserve current unsupported-operation mappings.

**Validation:** Resolution call counts, static/dynamic/cached options, inactive and unsupported provider cases.

### 21. Single-Own Legacy Episodic Fallback SQL

**Owner:** D16 Legacy bootstrap

**Evidence:** `legacy-bootstrap/review-mapping.ts:23-116` and `seen-mapping.ts:31-124` contain the same fallback temporary-table SQL.

**Current complexity:** A 94-line exceptional path has two owners and can drift.

**Proposal and scope:** Export one controlled SQL fragment from `episodic-sub-entity-mapping.ts` and interpolate it into both builders.

**Risks:** Preserve statement boundaries, `ON COMMIT DROP`, indexes, uniqueness filtering, and reserved-connection lifetime.

**Validation:** No local unit tests. Follow `legacy-bootstrap/README.md` with normal and large dumps, plus standalone fallback execution.

### 22. Remove Obsolete Transactional Template Pipeline

**Owner:** W18 Transactional email

**Evidence:** `packages/transactional/package.json:5-8` exports static HTML and copies it into Rust. The active backend renders `GenericEmail` directly at `notifications/delivery.ts:98-123`. The Rust service requires `{{ generic_message }}` semantics at `crates/services/notification/src/lib.rs:151-161`, while React export defaults to an empty message.

**Current complexity:** Two template paths appear synchronized but are not compatible.

**Proposal and scope:** Remove the static build/copy pipeline and associated CI artifact plumbing. Keep the committed Rust template while that backend remains.

**Risks:** Rust styling no longer appears coupled to React styling; that coupling is already broken.

**Validation:** Transactional check, backend type check, Rust notification compile, CI workflow inspection.

### 23. Make Checks Verification-Only

**Owner:** W19 Test and monorepo orchestration

**Evidence:** Backend `check` runs `oxfmt --write` and `oxlint --fix` at `apps/app-backend/package.json:12`. Shared testing does the same at `packages/testing/package.json:12`.

**Current complexity:** A verification command mutates source, mixing validation and repair and making clean-tree assertions unreliable.

**Proposal and scope:** Use `oxfmt --check` and non-fixing lint flags. Add a separate fix command only if needed.

**Risks:** Developers relying on implicit repair need an explicit command.

**Validation:** Run both checks and assert `git status --short` remains empty on a clean tree.

### 24. Remove Website-Local Admin Result Protocol

**Owner:** C02 Website bridge

**Evidence:** `apps/website/app/lib/api.server.ts:8-36` converts every failure into successful `{ error }` data. Callers reconstruct throwing behavior at `provisioning.server.ts:42-45,74-77`, while disable results are ignored at lines 62, 212, and 242.

**Current complexity:** A second result protocol duplicates the contract runner and permits failures to be silently ignored.

**Proposal and scope:** Use the shared rejecting contract runner and contract-owned provision body. Let provisioning and disable failures reject normally.

**Risks:** Renewal, reactivation, or revocation can now fail instead of continuing after an ignored backend error.

**Validation:** Provision, reset-link, renewal, reactivation, revocation, and unavailable-backend flows.

## Coverage Contract

Path aliases: `B = apps/app-backend`, `C = packages/contract`, `M = plugins/media`, `F = plugins/fitness`.

Colocated tests are included unless the boundary explicitly assigns them elsewhere.

### Application And Infrastructure

| ID  | Subsystem and exact boundary                                                                                                   | Interfaces, callers, tests                                                         | Status                                        |
| --- | ------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------- | --------------------------------------------- |
| A01 | Bootstrap/server: `B/src/main.ts`, `src/boot/{layers,server,cron-workflow-definitions,kernel-workflow-references}.ts`                        | `AppLive`, `MigrationOnlyLive`, `ServerLive`; all route/workflow layers; boot tests | skip                    |
| A02 | Sandbox runtime wiring: `B/src/lib/infrastructure/sandbox-runtime/{automation-host-functions,host-functions,durable-host-dispatcher}.ts` | SDK hosts; sandbox workflows; matching tests                                        | skip, D24 authoritative |
| I01 | Config/process: `B/src/lib/infrastructure/config/**`, `observability.ts`, `pro-key.ts`, `unkey.ts`, `server-run.ts`            | `AppConfig`, Pro key, telemetry; main/system/server; tests                         | **recommend**                                 |
| I02 | DB runtime: `db/{service,advisory-locks,user-write-lock,migrate}.ts`                                                           | `Database`, `PgClientLive`, migrations; repositories; tests                        | skip                                          |
| I03 | DB schema/generated migration: `db/schema/**`, `B/src/drizzle/**`, `drizzle.config.ts`                                         | Drizzle tables; repositories; generated SQL                                        | skip, index removal needs production evidence |
| I04 | Redis: `B/src/lib/infrastructure/redis.ts`                                                                                     | `RedisService`, keys/codecs; imports/uploads/interest/sandbox; test                | skip                                          |
| I05 | Workflow engine: `B/src/lib/infrastructure/workflow.ts`                                                                        | workflow and persisted queue layers; durable callers; test                         | skip                                          |
| I06 | Storage/admission: `local-storage.ts`, `s3.ts`, `provider-http-admission.ts`                                                   | local/S3/admission services; uploads/plugins; tests                                | **recommend**                                 |
| I07 | Sandbox process runtime: `sandbox-runtime/**` excluding generated/source runner files                                          | process, bridge, journal, artifacts, grants; sandbox callers/tests                 | **recommend**                                 |
| I08 | Generated runner: runner source/utilities/generated plus compile/prepare/smoke scripts                                         | generator, Deno runtime, integration test                                          | skip                                          |
| I09 | Property validation: `B/src/lib/property-schema/**`                                                                            | parsers/issues; domain/plugin callers; tests                                       | skip, no demonstrated material gain           |
| I10 | Shared/test primitives: `B/src/lib/{shared,test-utils}/**`                                                                     | IDs, ordering, assertions, test layers                                             | skip                                          |
| T01 | Backend tooling: remaining `B/scripts/**`                                                                                      | purity, layer wiring, runtime analysis, development; tests                         | skip                                          |

### Backend Domains

| ID  | Subsystem and exact boundary                                                    | Interfaces, callers, tests                                                        | Status                                     |
| --- | ------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- | ------------------------------------------ |
| D01 | `B/src/modules/auth/**`                                                         | Auth service/repository, Better Auth, middleware; server/lifecycle; 3 tests       | skip                                       |
| D02 | `automations/**`                                                                | rules, lifecycle/signal dispatch, subscriptions/workflow; events/signals; 7 tests | skip                                       |
| D03 | `backups/{export,archive-v2}/**`                                                | export snapshot/archive/workflow; storage/plugins; tests                          | **recommend, 2 findings**                  |
| D04 | `backups/{restore,runs}/**`, `service.ts`, `routes.ts`, `installation-state.ts` | restore/service/repository/routes; tests                                          | skip                                       |
| D05 | `collections/**`                                                                | service/repository/add workflow/routes; entities/imports; test                    | skip                                       |
| D06 | `definition-registry/**`                                                        | immutable registry/kernel source; plugins/schemas/views; 4 tests                  | **recommend**                              |
| D07 | `definitions/**`                                                                | definitions service/routes; registry/plugins; test                                | skip, public migration outweighs reduction |
| D08 | `entities/**`                                                                   | service/repository/lifecycle/outcomes/routes; domain callers; 3 tests             | **recommend, 2 findings**                  |
| D09 | `{entity,event,relationship}-schemas/**`                                        | schema repositories; registry/provider callers                                    | skip                                       |
| D10 | `entity-interest/**`                                                            | sessions/store/socket/reconciliation; Redis/RyotQL/client; 8 tests                | skip                                       |
| D11 | `entity-translation/**`                                                         | service/repository/overlay/workflows; providers/interest; 5 tests                 | **recommend**                              |
| D12 | `events/**`                                                                     | service/repository/policy/create workflow; automations; 4 tests                   | skip, broad bulk rewrite rejected          |
| D13 | `god-mode/**`                                                                   | admin service/repository/routes; website/lifecycle; test                          | skip                                       |
| D14 | `imports/**`                                                                    | run service/repository/state/failures/workflows; plugins/uploads; 8 tests         | **recommend**                              |
| D15 | `integrations/**`                                                               | service/repository/run/sync/webhook; plugins/imports; 7 tests                     | **recommend, 2 findings**                  |
| D16 | `legacy-bootstrap/**`                                                           | migration mappings/orchestration; migration runtime; runbook                      | **recommend**                              |
| D17 | `notifications/**`                                                              | service/repository/delivery/workflow/routes; automation/sandbox; 3 tests          | skip                                       |
| D18 | Listed plugin boot/loader/pipeline/install/route files and focused tests        | ingestion and installation lifecycle                                              | skip                                       |
| D19 | Remaining `plugins/**` files                                                    | resolver/catalogs/operations/materializer/rate limits/backup/GC                   | skip                                       |
| D20 | `provider-entities/**`                                                          | search/import/population/relationships/routes; plugins/entities; 6 tests          | **recommend**                              |
| D21 | `relationships/**`                                                              | service/repository/outcomes/routes; providers/events; 2 tests                     | skip                                       |
| D22 | `ryotql/**`                                                                     | catalog/validator/executor/service/routes; recipes/views; 2 tests                 | **recommend**                              |
| D23 | Sandbox compiler/direct execution file set defined in scratchpad                | compiler/execution/repository/provider contracts                                  | skip, W14 authoritative                    |
| D24 | Remaining `sandbox/**` durable workflow/queue/dispatcher files                  | durable sandbox orchestration; app bridge; tests                                  | **recommend**                              |
| D25 | `saved-views/**`                                                                | service/repository/validation/materializer/routes; 4 tests                        | **recommend**                              |
| D26 | `scheduler/**`                                                                  | frequent/plugin cron and boot dispatch; 5 tests                                   | **recommend**                              |
| D27 | `signals/**`                                                                    | signal schema/repository/emission; automations/sandbox; 2 tests                   | skip                                       |
| D28 | `system/**`                                                                     | health/config routes; server/client                                               | skip                                       |
| D29 | `test-support/**`                                                               | test service/gates/routes; integration fixtures; 2 tests                          | skip                                       |
| D30 | `uploads/**`                                                                    | intents/object storage/assets/routes/task; imports/backups; 3 tests               | **recommend**                              |
| D31 | `{user-bootstrap,user-lifecycle}/**`                                            | bootstrap, lifecycle repository/service/workflow; auth/god mode; 6 tests          | **recommend**                              |
| D32 | `{user-settings,user-state}/**`                                                 | services/routes; content/plugin/client callers; 2 tests                           | skip                                       |

### Workspace Dependencies

| ID  | Subsystem and exact boundary                                                                 | Interfaces, callers, tests                                         | Status                         |
| --- | -------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ | ------------------------------ |
| W01 | `C/src/{contract,client,errors,auth-middleware}.ts`                                          | `AppContract`, client helpers/errors; all servers/clients          | skip                           |
| W02 | `C/src/modules/{collections,definitions,entities,events,provider-entities,relationships}/**` | content contracts/schemas; matching routes/clients                 | skip                           |
| W03 | `C/src/modules/{automations,imports,integrations,notifications}/**`                          | operation contracts/run states; backend/plugins/clients            | skip, raw webhook assigned D15 |
| W04 | `C/src/modules/{god-mode,system,test-support,user-settings,user-state}/**`                   | user/operational contracts; website/client/tests                   | skip                           |
| W05 | `C/src/modules/plugins/**`                                                                   | manifest/config/API schemas; loader/plugins/SDK                    | skip                           |
| W06 | `C/src/modules/sandbox/**`                                                                   | sandbox wire/authority/execution schemas                           | skip                           |
| W07 | `C/src/modules/{backups,uploads,saved-views}/**`                                             | archive/upload/view contracts and fixtures                         | skip                           |
| W08 | `C/src/modules/{ryotql,entity-interest}/**`                                                  | query and WebSocket contracts                                      | skip, D22 authoritative        |
| W09 | `C/src/schema/**`                                                                            | brands, JSON, property schemas, run status                         | skip                           |
| W10 | `packages/config/**`                                                                         | config definitions/env/redaction/reference; backend/plugins; tests | skip                           |
| W11 | `packages/ryotql/**`                                                                         | query builders and decoders; backend/recipes; tests                | skip, proposed API too broad   |
| W12 | `packages/ryotql-recipes/**`                                                                 | named recipes/decoders; backend/plugins; tests                     | skip                           |
| W13 | `packages/sandbox-compiler/**`                                                               | compiler/protocol/worker/limits; backend/tooling                   | skip, worker removal disproven |
| W14 | SDK core/provider/automation/import/operation files                                          | public sandbox/provider contracts; backend/plugins                 | **recommend**                  |
| W15 | Remaining `packages/sandbox-sdk/**`                                                          | wire/workflow/filesystem/adapters                                  | skip                           |
| W16 | `packages/ts-utils/**`                                                                       | crypto/JSON/predicates/lodash and package exports                  | skip                           |
| W17 | `packages/plugin-kit/**`                                                                     | operation recipes/invocation; media/extension                      | skip                           |
| W18 | `packages/transactional/**`                                                                  | React email templates; backend mailer/tooling                      | **recommend**                  |
| W19 | `packages/testing/**`, root/package Turbo config, backend package/Vitest config              | test/check orchestration                                           | **recommend**                  |

### Plugins And Platform Bridges

| ID  | Subsystem and exact boundary                                                 | Interfaces, callers, tests                                  | Status                             |
| --- | ---------------------------------------------------------------------------- | ----------------------------------------------------------- | ---------------------------------- |
| P01 | Fitness manifest/domain/views/automations file set                           | backend boot/registry; SDK/contracts; tests                 | skip                               |
| P02 | Fitness adapters/import/provider scripts                                     | backend import/provider runtime; tests                      | skip                               |
| P03 | Media root manifest/domain/views/catalog and `schemas/**`                    | backend boot/registry; tests                                | skip                               |
| P04 | `M/imports/**`, `M/scripts/imports/**`                                       | import adapters/workflow; tests                             | skip, pagination redesign rejected |
| P05 | `M/scripts/providers/{company,person}/**`                                    | provider search/details; tests                              | skip                               |
| P06 | Media/media-group provider trees and shared provider files                   | provider population/translation; tests                      | skip                               |
| P07 | `M/scripts/integrations/**`                                                  | webhook/sync adapters; backend integration runtime          | skip, evidence absorbed by D15     |
| P08 | `M/scripts/automations/**`                                                   | policies/lifecycle automation; tests                        | skip                               |
| P09 | Media operations/workflows/bootstrap/helpers/shared boundary                 | recipes/workflows/crons/helpers; tests                      | skip                               |
| C01 | `apps/app-client/src/api/**`                                                 | authenticated/public/admin transport, uploads/socket; tests | skip                               |
| C02 | Browser-extension contract bridge and website admin API/callers              | plugin invoke, webhooks, god-mode API                       | **recommend**                      |
| C03 | `tests/src/fixtures/**` and contract client call shapes in integration tests | typed fixtures, sockets, operational gates                  | skip                               |

## Explicit Exclusions

- `packages/graphql` and `apps/frontend`: separate GraphQL stack, outside the backend dependency closure.
- `crates/app-client-backup`: outside workspaces and explicitly reference-only.
- Generated docs output: consumer artifact; generator ownership is covered.
- `node_modules`, `dist`, `build`, `.turbo`, and `tsbuildinfo`: derived artifacts.
- SDK dependency adapters remain covered by W15 even where backend TypeScript does not import them directly.

## Rejected, Duplicate, And Superseded Findings

- One-key import source claims: rejected because it relocates atomic claim/replay complexity and requires rollout compatibility.
- Property-rule precomputation: rejected without demonstrated material impact.
- Auth-handler privacy: rejected as minor interface cleanup.
- Broad user-state set operations: rejected because lifecycle, provenance, and per-item behavior could be bypassed.
- Workflow-reference column normalization: narrowed out because all existing pins have independent liveness meaning.
- Built-in saved-view overlays: rejected due migration and read-merge complexity.
- Removing import failure reasons: rejected because stage and reason are persisted, queried, and user-visible.
- Persisted manifest revalidation: retained as hardening concern, not accepted as a simplification.
- Compiler-worker removal: disproven by active production, Docker, and smoke-check wiring.
- Provider script ownership derivation: rejected because explicit script ownership has independent runtime use.
- Adapter-owned media pagination: rejected because it multiplies adapter and durable protocol complexity.
- Operational-gate server persistence: rejected as disproportionate for test-only infrastructure.
- Frontend admin registry replacement: rejected because the current module already owns credentials.
- Saved-view structured errors from D25: assigned to D06.
- RyotQL kind inference from W08: assigned to D22.
- Provider codec findings from D23/P05/P06: assigned to W14.
- Webhook transport from P07: assigned to D15.
- Provider search resolution from P05: assigned to D20.
- Request-index finding from A02: assigned to D24.

## Cross-Cutting Patterns

- Parallel identities and nullable fields permit contradictory states.
- Check-then-write control flow creates avoidable races.
- Manual finalizers and cleanup effects obscure resource ownership.
- Wire or validation structures have multiple semantic owners.
- Page/request loops repeatedly reconstruct stable lookup context.
- Platform bridges lose typed failures or original transport information.
- Verification commands and generated pipelines have stale or mixed ownership.

## Audit Log

1. Captured an empty initial Git status.
2. Inventoried the backend, workspace closure, platform consumers, contracts, tests, generated artifacts, and tooling.
3. Established 76 exact, non-overlapping review rows.
4. Ran 13 bounded review batches with fresh read-only workers.
5. Independently verified surviving findings against current files.
6. Ran fresh coverage, overlap, materiality, schema, and dependency-priority passes.
7. Corrected the initial scratchpad’s erroneous “67 rows” count to **76**.
8. Deduplicated findings and assigned one authoritative owner to each.
9. Confirmed the final Git status and diff were empty.
