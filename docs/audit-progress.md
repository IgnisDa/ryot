# Audit implementation progress

## Scope and workflow

- Audited base: `7abcabc1695e5f5b6f762c9433ac46ca784417e1`.
- Source reports: `~/Documents/audit/Ryot ultra-rewrite — audit and implementation order.md` and `~/Documents/audit/ryot-audit-0a8e4220e26c408daef7f93e85060d45.md`.
- **`apps/website/` and `apps/browser-extension/` are out of scope.** Exclude A05-R1, A05-R2, and A03-R1. The backlog is **83 findings**, not 86. Repository-wide validation can include their existing checks; implementation must not change those apps.
- Include T05-R1's bounded refactor of `e2e/src/scripts/seed.ts`.
- Continue without approval pauses for ordinary in-scope work. Ask before widening scope or performing destructive operations with unconfirmed targets.
- Continue all remaining in-scope findings without batch handoffs or next-item announcements.
- Use separate logical commits with the `audit:` prefix. Update this tracker with each completed finding; the implementation commit is identified by its finding ID in Git history.
- Run affected checks before affected tests, review, and perform the main-session cleanup. At the end of each batch, run `bun run check`, then `bun turbo --filter='!@ryot-app/e2e' test`. Run only affected e2e files, not the whole suite.
- Keep artifact, backup, manifest, protocol, compiler, and API versions unchanged. Add no compatibility paths.
- Larger refactors and breaking internal changes are allowed when they fix ownership directly; do not retain workarounds to preserve obsolete interfaces.

## Status

**73 implemented, 0 in progress, 10 pending; 3 excluded.**

“Implemented” means affected checks and tests passed and the change is committed with this tracker. Batch-wide acceptance is recorded separately below. Rows follow the audit's ranked order; sequencing can change to respect dependencies and keep changes reviewable.

| Finding | Status | Change or intended outcome |
| --- | --- | --- |
| P04-R1 | Implemented | Typed presentation batches replace the internal tuple codec. `13bc2b3456`. |
| B18-R1 | Implemented | Expiry compare-and-set governs the OAuth result. `970188a7b5`. |
| B13-R1 | Implemented | Generation-fenced control reads omit report aggregation. `858b8a3762`; media fixture follow-up `ac5ecfa99a`. |
| F01-R1 | Implemented | Nullable override merge patches preserve omitted fields. `a9166361ae`. |
| B10-R1 | Implemented | Four shared typed pinned-definition projections include policy fields. `f0dfc38ce3`. |
| P07-R2 | Implemented | Top-level client/shared regions determine authority and traversal floors. `30b575897a`. |
| P06-R1 | Implemented | Shared validated-entry stage enforces workflow policy through standalone and package paths while preserving adapter diagnostics and relative-import rules. `6c068ac196`. |
| P07-R1 | Implemented | Authored ASTs enforce import and asset policy without multiline bypasses or inert-text false positives. `123aa8be21`. |
| C01-R1 | Implemented | One per-server authorization owner fences token writes, profile publication, and detached work. Rotation retains identity; replacement and clear invalidate predecessor work. `628a6a0b55`. |
| B04-R1 | Implemented | Account generation is the sole bootstrap identity; reset joins the independent creation/reconciliation workflow root. See this finding's `audit:` commit. |
| B19-R1 | Implemented | One read-only selection snapshot governs preparation and freshness without materializing during freshness checks. See this finding's `audit:` commit. |
| B07-R2 | Implemented | Restored data and run completion share one transaction; completed status governs replay and ambiguous-commit recovery. See this finding's `audit:` commit. |
| F03-R2 | Implemented | One pure expiry reconciliation owns completion and feedback; invalid expiry clears execution without confirmation, rest, or progression. See this finding's `audit:` commit. |
| F03-R1 | Implemented | Controller save owns admission, busy state, durable retries, acknowledgement, and local cleanup across consumers. See this finding's `audit:` commit. |
| C04-R1 | Implemented | Registration scopes release each acquired listener on failure, interruption, stop, or disposal, including late handles. See this finding's `audit:` commit. |
| C05-R1 | Implemented | Input-free catalogs serve picker and local exact-declaration readiness; explicit catalog/OAuth refresh preserves form input. See this finding's `audit:` commit. |
| F05-R1 | Implemented | One target-ID aggregate preserves equal-name histories and all-role recency; tiles use IDs. See this finding's `audit:` commit. |
| M05-R2 | Implemented | Shared images require the canonical purpose; gallery Other and optional badges are removed. See this finding's `audit:` commit. |
| P02-R1 | Implemented | Require a complete activity inventory before lifecycle decisions; other statuses forbid; expose done/unsupported and make malformed inventory a zero-change result. See this finding's audit commit. |
| M06-R2 | Implemented | Stable activity form consumes enabled pagination directly; no delayed earlier-episode mirror or sentinel query remains. See this finding's `audit:` commit. |
| C11-R1 | Implemented | Authenticated UI owns SDK runtime disposal; loader retains only the scope client and host, and equivalent scope stays stable. See this finding's audit commit. |
| M07-R1 | Implemented | Successful count-zero owns first-run; failed counts show sections and retain stale data. See this finding's audit commit. |
| P01-R2 | Implemented | Notification specifics owns the creation discriminator; repository derives the scalar, while stored and listed delivery stay unchanged. See this finding's audit commit. |
| C06-R2 | Implemented | Provider-keyed options query owns the form and submitted-search snapshot; search waits for successful option loading, while no-options providers are immediate and active import stays outside. See this finding's audit commit. |
| B16-R1 | Implemented | Use relational execution and retention references with snapshot JSON; derive execution user from scope and preserve retention/replay. See this finding's audit commit. |
| B16-R2 | Implemented | Predecode candidate rows in bounded chunks of 1,000 before inserting them. See this finding's audit commit. |
| B06-R1 | Implemented | Materialize distinct pins and accepted automation runs set-wise, memoize distinct revision slugs, preserve ordering, and verify. See this finding's audit commit. |
| P01-R1 | Implemented | Generated provider tuples are the sole script/operation bindings, scoped to active or retained revisions. See this finding's audit commit. |
| B09-R1 | Implemented | Persist ordered collection fields canonically, compile them one way, and trim all 25 JavaScript whitespace characters in SQL. See this finding's audit commit. |
| F04-R2 | Implemented | Use stable measurement-entry IDs, preserve complete child pages and session-linked analytics, and update/delete by entry ID while retaining OpenScale legacy producers. See this finding's audit commit. |
| B28-R1 | Implemented | Derive generated identity projections for five ingestion tables from JSON, remove parallel writes, and retain constraints. See this finding's audit commit. |
| B05-R1 | Implemented | Model five strict upload-intent variants; require a local temp path, separate numeric completion expiry from the lease, preserve single-claim replay, and block cleanup of stale permanent objects. See this finding's audit commit. |
| B13-R2 | Implemented | Remove the non-durable preparing state; batches transition from pending directly to applying while preserving B13-R1 and B15 behavior. See this finding's audit commit. |
| B07-R1 | Implemented | Use package keys as the sole portable installation identity while preserving redaction, scope, null, and system-plugin reuse behavior; change no versions or compatibility paths. See this finding's audit commit. |
| B30-R2 | Implemented | Preserve parsed configuration and complete credential invariants; remove consumer reparse/reconstruction and keep partial-startup semantics unchanged. See this finding's audit commit. |
| A05-R2 | Excluded | Website pricing/checkout offer model. |
| A05-R1 | Excluded | Website payment agreement and rights transitions. |
| A03-R1 | Excluded | Browser-extension frame/navigation ownership. |
| S03-R1 | Implemented | One optional stopping cause and first timestamp own stop transitions; cleanup and wakeup happen once while cause priority is preserved. See this finding's audit commit. |
| B03-R1 | Implemented | Persist one prepared HTTP hop and explicit admission, rate-limit, and wait phases; preserve redirect, retry, headers, body, and ticket identity. See this finding's audit commit. |
| P04-R2 | Implemented | One automatic query-refresh owner manages entity and page refresh atoms. See this finding's audit commit. |
| B15-R1 | Implemented | Use only a persisted paged worklist, with the database cutoff after admission, creation-time/ID cursor, exact IDs, and release. See this finding's audit commit. |
| B05-R2 | Implemented | Query bounded `EXISTS` checks for owned asset references across all 13 sources, including schema-gated encrypted config locators; avoid loading candidate JSON. See this finding's audit commit. |
| B22-R1 | Implemented | Persist the validated reorder plan set-wise and atomically from the locked facts. See this finding's audit commit. |
| B20-R1 | Implemented | Persist and replay aggregate summaries and dispatch directly; keep actual item outcomes only in item receipts, without fabricating replay outcomes. See this finding's audit commit. |
| B21-R1 | Implemented | Validate and expand each query document once; return the expanded document with validation errors and retain bound aliases without re-expansion. See this finding's audit commit. |
| P10-R1 | Implemented | Decode presentation rows directly, including all selected fields, without fabricating pages. See this finding's audit commit. |
| P12-R1 | Implemented | Pass typed local query values directly without encode/decode; retain wire, URL-sort, clock, and cancellation behavior. See this finding's audit commit. |
| P05-R1 | Implemented | Render flat tables directly without table-engine boxing or scans; remove the unused engine dependency. See this finding's audit commit. |
| P05-R2 | Implemented | Derive the reorder preview from one destination while preserving pointer-cancel, commit, and preview behavior. See this finding's audit commit. |
| B30-R1 | Implemented | Fill one buffer sized to declared S3 content length; overflow stops consumption, while underflow and stream errors release resources. See this finding's audit commit. |
| S03-R2 | Implemented | Borrow result and console data while serializing the done payload. See this finding's audit commit. |
| S02-R2 | Pending | The writer owns physical chunk creation. |
| S02-R1 | Pending | One reservation/buffer per inbound assembly. |
| S01-R1 | Implemented | Store validated harvested bytes directly without intermediate temporary-file writes or reads. See this finding's audit commit. |
| P09-R1 | Implemented | Validate writer input once without self-decompression; retain exact manifest bounds and unchanged reader behavior. See this finding's audit commit. |
| M03-R1 | Implemented | Plex integration uses explicit current-item continuation. See this finding's audit commit. |
| M04-R1 | Implemented | Reuse existing sorted media runs for collection workflows and retain the checkpointed 64-item window. See this finding's audit commit. |
| M02-R1 | Implemented | Process already-decoded Trakt records directly without a synthetic ZIP round trip. See this finding's audit commit. |
| F02-R1 | Implemented | Normalize each selected workout group once, anchoring metadata to its first valid row while preserving failure and event ordering. See this finding's audit commit. |
| F04-R1 | Implemented | Read the persisted numeric template plan directly and enrich distinct choices without editor hydration; preserve validation, units, and pro-media behavior. See this finding's audit commit. |
| A02-R1 | Implemented | Scan event IDs once in 500-row C-collated pages across distinct streams, bulk processing normalized timestamps and warning multisets. See this finding's audit commit. |
| T02-R1 | Implemented | Register release finalizers at acquisition, including partial failure, interruption, and stop; close the API scope before infrastructure and keep capacity unchanged. See this finding's audit commit. |
| T02-R2 | Pending | Bind sessions and admin authority to one server target. |
| T05-R1 | Implemented | Install each of the three seed plugins once with complete definitions instead of seven updates and five definition reads. See this finding's audit commit. |
| B01-R1 | Implemented | Replace watch deltas with complete membership/foreground sets while preserving caps, coalescing, acknowledgements, and grace tokens. See this finding's audit commit. |
| B01-R2 | Pending | Persistence owns lock sorting. |
| B02-R1 | Implemented | Delete the test-only live-environment runtime mode; resolve only pinned installation configuration for the admitted execution. See this finding's audit commit. |
| B02-R2 | Pending | Readiness uses configured-key metadata, not decrypted values. |
| B10-R2 | Pending | Delete unused definition-reader modes. |
| B11-R1 | Implemented | Remove the projection-worker invalidation exemption and owner-work-ID threading while preserving event locks. See this finding's audit commit. |
| B19-R2 | Implemented | Store the selected tagged composition module directly without synthetic namespaces or reverse lookup; preserve selection and grants. See this finding's audit commit. |
| B24-R1 | Implemented | Delete the unused signal service, repository, layer, and test; preserve definition registration, invalidation, and publication because no semantic consumers remain. See this finding's audit commit. |
| C03-R1 | Implemented | One shell owner controls presentation activation and deactivation, with stale-entry guards and overlays. See this finding's audit commit. |
| C06-R1 | Implemented | Delete the unused entity/provenance facade while retaining the active watch recipe and route preparation. See this finding's audit commit. |
| C07-R1 | Implemented | Delete the unused saved-view client service and test, its boot layer, and its route-stub wiring; retain the managed-asset stub. See this finding's audit commit. |
| C07-R2 | Implemented | Shared collection-editor mutation ownership interrupts departure and suppresses late callbacks and refresh; it does not imply server rollback. See this finding's audit commit. |
| C08-R1 | Implemented | Admin operations return ordinary Effects instead of Exit; remove null busy markers, represent busy requests and skipped outcomes explicitly, and clear request state in finalizers. See this finding's audit commit. |
| P03-R1 | Pending | Normalize existing Request headers/body once. |
| M01-R1 | Implemented | Use the canonical Metron role accumulator without folding or a second set pass. See this finding's audit commit. |
| M04-R2 | Pending | Select only consumed episodic-completion fields. |
| M05-R1 | Implemented | Delete the import-admission shadow union; real manifest admission validates 17 sources. See this finding's audit commit. |
| M06-R1 | Implemented | Remove dead hero configuration, resolve locators once, and retain actual headers and the home backdrop. See this finding's audit commit. |
| B11-R2 | Pending | Return the locked event revision once. |
| B22-R2 | Pending | Remove unreachable custom-renderer publication. |
| P08-R1 | Implemented | Acquire a complete private mode-0700 workspace and expose its handle only after staging; clean up collisions and replacements across the workspace lifetime, with no incremental API. See this finding's audit commit. |

## Decisions to preserve

- B02-R2: readiness checks availability only; startup and execution still authenticate ciphertext.
- F03-R2: invalid expiry clears the expired timer but leaves the set unconfirmed, without rest or progression.
- B15-R1: cursor order is creation time, then ID.
- C06-R2: search waits for successful loading of declared options; providers without options remain immediate.
- C07-R2: editor departure interrupts local waiting and suppresses late callbacks/refresh. This does not imply server rollback.
- Greenfield changes and local reset/reseed are allowed, but confirm exact destructive targets first. No development data reset has been needed.

## Validation ledger

### Batch 1: P04-R1, B18-R1, B13-R1, F01-R1, B10-R1 — accepted

- Repository-wide `bun run check`: passed across 30 projects.
- Final `bun turbo --filter='!@ryot-app/e2e' test`: passed, 51/51 tasks. The first run exposed the omitted media control-read fixture; `ac5ecfa99a` fixed it before the successful rerun.
- Affected backend: 60 files, 515 tests passed. Client SDK: 22 files, 231 tests passed. Fitness: 85 files, 478 tests passed. Media follow-up: 218 files, 1,542 tests passed.
- Post-cleanup e2e: four files, 22 tests passed: `workout-editor.test.ts`, `workout-editor-reads.test.ts`, `fitness-workout-editor.test.ts`, and `fitness-workout-interactions.test.ts`.
- Shipped artifacts rebuilt; configuration documentation regenerated with no tracked changes. Excluded apps unchanged. No push performed.

### Batch 2: P07-R2, P06-R1, P07-R1 — accepted

- P07-R2: client compiler check passed; all four test files and 64 tests passed. Covers nested `client/shared`, `client/client`, `shared/client`, and `shared/shared` paths, traversal rejection, assets, and real Vite compilation.
- P06-R1: backend compiler check passed; seven files, 64 tests passed. Worker-facing compiler, worker, limits, and built-in suites passed: four files, 22 tests. Native runner integration passed: one file, 23 tests. Backend and sandbox checks passed. Native workflow fixtures now use the deterministic SDK entrypoint.
- P07-R1: client compiler check passed; all four files and 79 tests passed. Covers multiline imports/re-exports, type imports, SDK boundaries, dynamic imports/globs, static and invalid asset URLs, inert text, generated declarations, and deterministic artifacts.
- Cleanup from `ac5ecfa99a`: removed the repeated standalone type-error scan and a single-use type alias (net one line removed). Kept the standalone project adapter and diagnostic ordering because their behavior differs intentionally. No added suppressions or bypass casts.
- Final repository-wide `bun run check`: passed across 30 projects. Final `bun turbo --filter='!@ryot-app/e2e' test`: passed, 51/51 tasks.
- Affected e2e: `e2e/src/api/kernel/plugins/compiled-package.test.ts`, two tests passed. Shipped artifacts rebuilt. Excluded apps unchanged. No push performed.

### Batch 3: C01-R1 — accepted

- One authorization record per server owns the session snapshot and refresh/UserInfo flights. Only current handles can publish profiles or commit tokens. Per-server storage locks exclude HTTP work. Rotation retains identity; clear and replacement invalidate detached predecessor work.
- Clear also blocks stale stored credentials from being restored in memory after deletion failure. Code exchanges must retain their pending transaction and originating authority. Impersonation tokens remain until the hosted logout callback; wire and storage schemas are unchanged.
- Client check passed; all 135 client test files and 1,034 tests passed. The 19 auth files contain 121 passing tests, including Deferred-controlled clear, replacement, stale invalid-grant, forced-refresh isolation, late UserInfo, subscription order, rotation, and origin-isolation regressions.
- Repository-wide `bun run check` passed across 30 projects; `bun turbo --filter='!@ryot-app/e2e' test` passed, 51/51 tasks.
- Affected browser e2e: signup and desktop/mobile impersonation passed (two files, three tests). Corrected stale test assumptions: open the generated impersonation link, and use the plugin iframe's mobile navigation trigger. No impersonation product behavior changed.
- Main-session cleanup from `113ec24ff5` removed redundant single-flight wrapping and origin-keyed work; no new suppressions or bypass casts. Shipped client rebuilt; excluded apps unchanged. No push performed.

### Batch 4: B04-R1 — accepted

- Removed the reset-only workflow/script identity suffix and optional bootstrap generation. Reset waits for the ordinary account-generation bootstrap as an independent root, not a lifecycle child. Existing account-generation retirement fencing remains unchanged.
- Instrumented `bootstrap-identity.test.ts` with named stages, 45-second waits, marker/gate records, bounded failure-state queries, and the retained backend-log path. The SDK does not expose execution IDs: the script records a bootstrap-owned marker and its user instead; backend tests assert the exact workflow identity and absence of a parent.
- Debugging reproduced and fixed three failures: invalid script metadata access at compilation; reset attempting to reparent the creation-owned workflow (`Workflow execution belongs to another root`); and a shared system plugin surviving uninstall with references, then breaking other tests after its fake upstream closed. The regression uses the existing isolated backend fixture and strict plugin cleanup, with no capacity changes.
- Controlled HTTP overlap proves that each of two resets remains running with its recreated user disabled until bootstrap is released, then completes and enables that user. Exactly three distinct marker invocations remain: creation plus two account recreations.
- Backend and e2e checks passed. Affected backend tests passed: 24 files, 116 tests. Both affected e2e files pass together: `bootstrap-identity.test.ts` and `god-mode-reset-user.test.ts`, nine tests. They also passed separately during debugging.
- Final repository-wide `bun run check` passed across 30 projects; `bun turbo --filter='!@ryot-app/e2e' test` passed, 51/51 tasks.
- Main-session cleanup from `628a6a0b55` removed redundant stage-completion logging (net two lines removed), while retaining the requested failure diagnostics. No new suppressions or bypass casts. Excluded apps unchanged. No push performed.

### Batch 5: B19-R1 — accepted

- Preparation and freshness now consume one read-only selection snapshot containing the requested and resolved target, selected renderer or page, graph, view state, and operation targets. Preparation alone materializes compositions; freshness only looks up an existing composition and issues no artifact grants.
- Direct `/` routes become stale when a home view is selected, saved-view pages become stale when the selection changes or clears, and the original route becomes current again after clearing. View revision and renderer changes use the same selection path.
- Backend and e2e checks passed. All page-preparation tests passed: eight files, 31 tests. The affected uncached e2e file passed: `page-freshness.test.ts`, two tests.
- Repository-wide `bun run check` passed across 30 projects; `bun turbo --filter='!@ryot-app/e2e' test` passed, 51/51 tasks.
- Main-session cleanup removed duplicate operation-target construction and an unused direct-page snapshot field (net one line removed). No suppressions or bypass casts were added. Excluded apps unchanged. No push performed.

### Batch 6: B07-R2, F03-R2, F03-R1, C04-R1, C05-R1, F05-R1, M05-R2, M06-R2 — accepted

- Resumed at the user's request with one implementation subagent per finding. Independent backup, expiry, device, readiness, and home-activity work runs in parallel; F03-R1 follows F03-R2 because they share the workout controller.
- Each finding has a delegated implementation, read-only review, and separate `audit:` commit. Main-session cleanup and final acceptance are complete.
- F03-R2: removed the fallback auto-confirm path. Added combined invalid-input, prompt, late-observation, replacement, and independent-rest regressions. Fitness check passed before 16 editor files / 163 tests. Read-only review reported no findings. No persisted shapes, suppressions, or bypass casts changed.
- B07-R2: historical writes and `completeRun` use the captured database transaction. Completed status replaces progress-90 replay logic; ambiguous failures reread completion before retry/failure. Cleanup only deletes the temporary upload best-effort. Backend check passed before 11 backup files / 130 tests, including real PostgreSQL commit/rollback, lost acknowledgement, postcommit cancellation, replay, unavailable cleanup, and deadlock retry. Read-only review reported no findings. Drain active restores before deployment; no compatibility path was added.
- F05-R1: one ID-keyed aggregate retains visibility, effective-link deduplication, bounds, never-trained targets, and sorting. Set weights remain primary/untyped 1, secondary 0.5, stabilizer 0; recency includes every role. Fitness check passed before all 85 files / 537 tests. E2E check and the new `home-recipes.test.ts` API regression passed against PostgreSQL, covering equal-name targets and generated SQL. Read-only review reported no findings.
- C04-R1: each DOM/native listener is acquired with an immediate scoped finalizer; partial failure, interruption, stop, and disposal close registration scopes and release late handles. Scoped device type/format/lint checks passed before four files / 33 tests. Read-only review reported no findings. Full client type checking passed; full lint initially encountered concurrent C05-R1 edits, then passed with the full client suite. Physical-device behavior was not tested. Native promises that never settle can still delay cleanup; removal remains best-effort.
- M05-R2: shared images require one of the seven manifest purposes. Removed gallery Other and the optional badge branch; locator-only presentation assets and artwork order are unchanged. Providers, seed data, and legacy mappings already emit tags; malformed fixtures were corrected directly. Media check passed before 15 focused files / 179 tests, then all 218 files / 1,546 tests passed. Read-only review reported no findings. Existing untagged images now fail decoding as intended; no compatibility decoder was added.
- C05-R1: input-free catalogs supply synchronous exact-declaration readiness. Removed both settings-keyed scans; OAuth success, catalog events, visibility, mutations, and manual retry refresh the snapshot. Removal/failure preserves edits while readiness blocks submission. Recipes check passed before 126 tests; full client check passed before all 136 files / 1,052 tests, also clearing C04-R1's transient full-lint blocker. Read-only review reported no findings. Updated the authoring README to the item-evaluator API.
- F03-R1: shared controller save admits before any await and declines concurrent callers. It retains busy/acknowledgement through cleanup; failed cleanup retries locally without repeating an acknowledged backend call. Durable submission identity/input/time and persist-before-invoke are unchanged; only definite business rejection unlocks edits. Save remains uninterruptible across consumer teardown. Review found one coverage gap, resolved with Deferred-controlled interruption/unmount tests during persistence, invocation, and acknowledged cleanup; no extra review round. Fitness check passed before all 16 editor files / 169 tests. After main-session cleanup, fitness check and all 85 files / 543 tests passed. Full runtime reload still relies on the durable frozen submission and backend idempotency.
- Main-session cleanup from `591d806993` removed a redundant hook binding and deployment-history prose from the backup README (net three lines removed). Kept the restore drain requirement here, native cleanup limits, and behavioral regression tests. No new suppressions or bypass casts. Post-cleanup backend check and all 11 backup files / 130 tests passed; e2e check passed.
- Initial final repository-wide `bun run check` passed across 30 projects; `bun turbo --filter='!@ryot-app/e2e' test` passed, 51/51 tasks.
- Affected browser acceptance: `backups.test.ts` passed two tests. The initial `fitness-workout-editor.test.ts` run exposed a real post-save edit regression: a fresh request inherited the controller-wide saved acknowledgement, and the obsolete request guard blocked draft preparation. The guard now uses busy state; no fallback/reset/extra lock was added. Added same-session regression coverage. Fitness/e2e checks passed before 170 editor tests; the targeted reproduction and all six browser tests then passed in follow-up `3e73f4e5e7`.
- M06-R2: stable `ActivityLogForm` owns draft, backfill, and submission state and consumes enabled SDK pagination directly. Removed the report DTO, parent mirror, reporting effect/callback, ID guard, and obsolete query export. User greenfield guidance removed the initial sentinel-query approach before review. Deferred late-A/current-B, Status-to-Episode reload/retry, current-ID submission, focus/draft preservation, specials, pagination, and bounds are covered. Media check passed before three files / 66 tests; read-only review reported no findings. The main-session cleanup extension found no obsolete callers, suppressions, or bypass casts.
- Final affected e2e acceptance passed, each file run separately: browser `backups.test.ts` (2), `fitness-workout-editor.test.ts` (6), `fitness-workout-interactions.test.ts` (5), `import-data.test.ts` (4), `integrations.test.ts` (3), `plugin-device-drafts.test.ts` (1), `media-show.test.ts` (3); API Fitness `workout-editor.test.ts` (10) and `home-recipes.test.ts` (1). Total: nine files / 35 tests.
- After the post-save fix and final media refactor, repository-wide `bun run check` passed again across 30 projects, followed by `bun turbo --filter='!@ryot-app/e2e' test`, 51/51 tasks. Shipped artifacts rebuilt for e2e. Excluded apps unchanged; no push or development-data reset performed.


### Continuing implementation — active

- M07-R1: media check passed before 49 home tests across four files; read-only review reported no findings.
- M05-R1: media and backend checks passed before 41 admission tests and 14 backend tests; read-only review reported no findings.
- P02-R1: contract, SDK, and fitness checks plus scoped kernel type, format, and lint checks passed before 47 contract, 234 SDK, 12 fitness, and four kernel tests; read-only review reported no findings.
- C11-R1: client check passed before 130 tests across four files; read-only review reported no findings.
- P01-R2: contract, backend, client, and e2e checks passed before two contract, 10 backend, and 25 client tests; read-only review reported no findings.
- B16-R1: backend check passed before 69 tests across five files; read-only review reported no findings. Pending candidate JSON must be rewritten or drained before rollout; no reset was performed and no dual decoder was added.
- B30-R2: backend check passed before 170 tests across nine files; read-only review reported no findings. Parsed configuration retains complete optional OIDC, SMTP, and S3 values, CIDRs, and OTLP headers without consumer reparsing or reconstruction; partial-startup semantics are unchanged.
- C06-R2: client type check and scoped format/lint passed before 83 tests across eight files; read-only review reported no findings. Pagination uses a submitted snapshot.
- B24-R1: backend type, format, and lint checks passed before 57 tests across seven files; read-only review reported no findings. Definition registration, invalidation, and publication remain intact.
- M06-R1: media check passed before 222 tests across 25 files; read-only review reported no findings. All locators resolve once; actual headers and the home backdrop remain.
- F04-R1: fitness check passed before 11 tests; read-only review reported no findings. The persisted numeric plan is used directly, without editor hydration, and validation, units, and pro-media behavior are preserved.
- S03-R1: sandbox Bun check, including format and clippy, passed; 73 Cargo tests passed with one ignored, and generated-doc validation passed. Read-only review reported no findings. Linux-only confinement was not run on macOS.
- C08-R1: client type, format, and lint checks passed before 55 tests; read-only review reported no findings.
- B15-R1: scoped type, format, and lint checks passed before 98 tests across 12 files; read-only review reported no findings. The full check was blocked by concurrent B05 work, now fixed. Existing development histories are disposable; no production data or drain machinery is needed. No compatibility path was added and no reset was performed.
- B05-R1: backend type and scoped format/lint checks passed before 99 tests across five files; read-only review reported no findings. Redis shape changed without a dual decoder or compatibility path. No production data or drain machinery is involved; no reset was performed.
- B30-R1: scoped type, format, and lint checks passed before five S3 tests; read-only review reported no findings. The full backend check had temporary concurrent errors; final acceptance remains pending. Configuration changes from B30-R2 were not included.
- C06-R1: client and recipe type checks plus scoped format/lint passed before 229 client tests, 18 recipe tests, and three additional recipe tests; read-only review reported no findings. Active watch recipes and route preparation remain. Development data is disposable; no compatibility path or drain machinery is needed, and no reset was performed.
- P05-R1: UI check and consumer checks passed before 313 UI, 34 renderer, 35 admin, and one compiler test; read-only review reported no issues.
- C03-R1: client type, format, and lint checks passed before 124 tests; read-only review passed.
- B16-R2: scoped backend checks passed before 23 tests; read-only review passed.
- P04-R2: SDK check passed before 243 tests across 23 files; read-only review passed.
- C07-R2: client type, format, and lint checks passed before 65 tests across three files; read-only review passed. Departure interrupts local waiting and suppresses late callbacks/refresh, without promising server rollback.
- M03-R1: media check passed before 39 tests across six files; read-only review passed.
- M04-R1: scoped checks passed before 20 tests across seven files; read-only review passed. Existing sorted media runs are reused with the checkpointed 64-item window.
- M02-R1: media type, format, and lint checks passed before 28 tests across six files; read-only review passed. Decoded Trakt records are processed directly without a synthetic ZIP round trip.
- S03-R2: native format/clippy and fixture checks passed; 73 native tests passed with one ignored, plus seven TypeScript tests. Earlier timing-sensitive attempts were followed by a full pass without code changes; read-only review passed. Linux-only validation was not run on macOS.
- S01-R1: host and backend checks passed before 16 host and 14 backend tests; read-only review passed. Validated bytes are stored directly without temporary-file writes or reads.
- P01-R1: eight checks passed before 181 tests across 14 files; archives were rebuilt and read-only review passed. E2E source was not run. Only provider-operation hunks were staged from the shared Fitness manifest test; its F04 measurement assertion remains unstaged.
- P01-R1 follow-up: committed the remaining YouTube Music sidecar fixture provider-map removal; e2e source remains unrun.
- B09-R1: six package checks passed before 144 tests. Full backend/server checks passed, and the migration regression passed in the coordinator 31-file run; an unrelated B06 repository run failed. The review finding was fixed without an extra review round. Full restored-migration validation remains pending for coordinated follow-up.
- B19-R2: contract and scoped checks passed; full backend/server checks and all page-preparation tests passed in the coordinator 31-file run. The only failure was an unrelated B06 test; read-only review reported no findings.
- B07-R1: scoped package checks passed; full backend/server checks and all backup tests passed in the coordinator 31-file run; read-only review reported no findings. Package keys are the sole portable identity; no version or compatibility path changed.
- B13-R2: coordinated full checks passed, followed by all affected workflow tests and 33 ingestion tests; read-only review reported no findings. Pending transitions directly to applying; B13-R1 and B15 behavior are preserved. Development state is resettable; no production compatibility or drain machinery was added, and no reset was performed.
- F04-R2: fitness check passed before 73 tests across 12 files, e2e check passed, and the full server check passed; read-only review reported no findings. Stable entry IDs preserve complete child pages, session-linked events/analytics, and entry-ID update/delete; OpenScale legacy producers remain. F02 workout hunks in the shared import test were excluded. Restored normal/larger migration validation remains pending for coordinated follow-up; no reset or compatibility/drain path was needed.
- T02-R1: e2e type, format, and lint checks passed before eight harness tests; read-only review passed. Release finalizers are registered during acquisition, including partial failure/interruption/stop, with API scope closed before infrastructure and capacity unchanged. The T05 seed script was not staged.
- B11-R1: scoped checks passed before 79 tests across six files; read-only review passed. Removed projection-worker exemption and owner-work-ID threading while retaining locks.
- B22-R1: scoped checks passed before 50 tests across nine files; SQL validation covered six changed and four unchanged small/large cases; read-only review passed. Reorder persistence is set-wise and atomic from the locked validated plan.
- B21-R1: four package checks passed before 179 backend, 61 media, 18 contract, and three RyotQL tests; read-only review passed. Validation returns the expanded document and error/value; binding retains aliases without re-expansion. No compatibility/drain machinery or development reset was added.
- B06-R1: scoped checks passed before 46 tests across five files, after fixing the P2 review finding; no extra review round. Column-count-aware chunks stay below 32,767 parameters; 4,000 runs use three inserts in one transaction, and late conflicts roll back.
- P10-R1: RyotQL check passed before 37 tests; read-only review passed. Rows decode directly with selected fields and no fabricated pages.
- P12-R1: renderer check passed before 62 tests across four files; read-only review passed. Typed local queries retain wire, URL-sort, clock, and cancellation behavior. Ignored generated sources were regenerated and not staged.
- P05-R2: UI check passed before 21 focused tests and 325 full UI tests; read-only review passed. One destination drives the reorder preview; pointer cancellation and commit behavior remain.
- F02-R1: scoped checks passed before 52 tests; read-only review passed. Each selected workout group is normalized once, using first-valid-row metadata while preserving failures and ordering.
- A02-R1: server check passed before 15 harness tests; read-only review passed. Event IDs scan in 500-row C-collated pages across distinct streams, with bulk processing, normalized timestamps, and warning multisets. Combined restored normal/larger migration validation is running separately and remains pending.
- M01-R1: scoped checks passed before 12 tests; read-only review passed. Metron uses the canonical role accumulator without folding or a second set pass.
- P09-R1: archive check passed before 71 tests; read-only review passed. Writer input validates once without self-decompression; manifest bounds are exact and reader behavior is unchanged. CLI validation was blocked by P08 and is now unblocked; final acceptance remains pending.
- P08-R1: all three checks passed before serial runs of 64 Vite, 64 backend, and 79 client tests; read-only review passed. Acquire the complete private mode-0700 workspace before exposing its handle, with collision/replacement cleanup and no incremental API.
- B28-R1: backend type, all-format, lint, and database-generation checks passed before 38 tests, including three real-PostgreSQL tests; read-only review passed. Generated identity projections for five ingestion tables come from JSON; parallel writes are removed and constraints remain.
- T05-R1: e2e checks and offline comparison passed; 450 entity and 540 event writes, five entity and five event definitions, order and ownership were preserved; read-only review passed. Seed installs three complete plugins once instead of seven updates and five definition reads.
- B01-R1: scoped checks passed before 56 backend, 22 client, and eight contract tests; read-only review passed. Complete sets preserve caps/coalescing/acknowledgements/grace tokens. Validated 550 UUID entries, 21,513 JSON bytes, and 21,521 masked-frame bytes. T02-R2 base-URL binding hunks in the shared websocket fixture remain unstaged.

- C07-R1: client type, format, and lint checks passed before 44 navigation and 20 host tests; read-only review passed. Removed the unused saved-view client service and its wiring; canonical preparation and the managed-asset stub remain.
- B02-R1: backend type, format, and lint checks passed before 103 tests across seven files; read-only review passed. Deleted the test-only live-environment runtime mode and verified that late host reads retain the execution's exact config pin across environment reactivation. B02-R2 readiness changes were not included.
- B03-R1: scoped checks passed before 204 tests across 10 files, run serially; read-only review passed. Prepared hops and explicit phases retain retry, redirect, request headers/body, and provider ticket identity. No continuation compatibility or drain mechanism was added.
- B05-R2: scoped checks passed before 60 tests across four files, including real-PostgreSQL coverage; read-only review passed. Bounded `EXISTS` lookups cover 13 sources, ownership, encryption, nested locators, and schema-declared configuration paths.
- B20-R1: backend type, format, and lint checks passed before 245 tests across 13 files; read-only review passed. Aggregate replay returns persisted summaries and dispatch without fabricated per-item outcomes; real item receipts remain. The shared lifecycle fixture change adds after-hooks used by this finding's aggregate replay coverage.
