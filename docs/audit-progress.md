# Audit implementation progress

## Scope and workflow

- Audited base: `7abcabc1695e5f5b6f762c9433ac46ca784417e1`.
- Source reports: `~/Documents/audit/Ryot ultra-rewrite — audit and implementation order.md` and `~/Documents/audit/ryot-audit-0a8e4220e26c408daef7f93e85060d45.md`.
- **`apps/website/` and `apps/browser-extension/` are out of scope.** Exclude A05-R1, A05-R2, and A03-R1. The backlog is **83 findings**, not 86. Repository-wide validation can include their existing checks; implementation must not change those apps.
- Include T05-R1's bounded refactor of `e2e/src/scripts/seed.ts`.
- Continue without approval pauses for ordinary in-scope work. Ask before widening scope or performing destructive operations with unconfirmed targets.
- Use separate logical commits with the `audit:` prefix. Update this tracker with each completed finding; the implementation commit is identified by its finding ID in Git history.
- Run affected checks before affected tests, review, and perform the main-session cleanup. At the end of each batch, run `bun run check`, then `bun turbo --filter='!@ryot-app/e2e' test`. Run only affected e2e files, not the whole suite.
- Keep artifact, backup, manifest, protocol, compiler, and API versions unchanged. Add no compatibility paths.

## Status

**18 implemented, 0 in progress, 65 pending; 3 excluded.**

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
| P02-R1 | Pending | Validate activity inventory before lifecycle decisions. |
| M06-R2 | Pending | Use the current query for backfill eligibility. |
| C11-R1 | Pending | Authenticated UI owns and disposes its SDK runtime. |
| M07-R1 | Pending | Distinguish count failure from an empty library. |
| P01-R2 | Pending | Notification specifics owns the creation discriminator. |
| C06-R2 | Pending | Provider subtree owns options, form, and submitted-search lifetime. |
| B16-R1 | Pending | One execution/retention pin model. |
| B16-R2 | Pending | Insert candidates as a set or bounded chunks. |
| B06-R1 | Pending | Materialize distinct pins and accepted automation runs as sets. |
| P01-R1 | Pending | Generated provider metadata owns script/operation bindings. |
| B09-R1 | Pending | Persist collection fields in authored order. |
| F04-R2 | Pending | Address complete measurement entries for edits and deletes. |
| B28-R1 | Pending | Derive ingestion identity projections from JSON. |
| B05-R1 | Pending | Model upload intent states without contradictory fields. |
| B13-R2 | Pending | Remove the non-durable preparing state. |
| B07-R1 | Pending | Use portable package keys in backups. |
| B30-R2 | Pending | Preserve parsed configuration and complete credential invariants. |
| A05-R2 | Excluded | Website pricing/checkout offer model. |
| A05-R1 | Excluded | Website payment agreement and rights transitions. |
| A03-R1 | Excluded | Browser-extension frame/navigation ownership. |
| S03-R1 | Pending | One sandbox stop cause and first timestamp. |
| B03-R1 | Pending | Prepared HTTP hops and explicit phases. |
| P04-R2 | Pending | One automatic query-refresh owner. |
| B15-R1 | Pending | One durable paged integration worklist. |
| B05-R2 | Pending | Query asset-reference existence in PostgreSQL. |
| B22-R1 | Pending | Reuse locked reorder facts for set-wise persistence. |
| B20-R1 | Pending | Return aggregate replay counts without fabricated outcomes. |
| B21-R1 | Pending | Validate and expand a query document once. |
| P10-R1 | Pending | Decode presentation rows without fabricated pages. |
| P12-R1 | Pending | Pass typed local renderer query values. |
| P05-R1 | Pending | Render flat tables without the unused table engine. |
| P05-R2 | Pending | Derive reorder preview from one destination. |
| B30-R1 | Pending | Fill one bounded S3 response buffer. |
| S03-R2 | Pending | Borrow result/console data during done serialization. |
| S02-R2 | Pending | The writer owns physical chunk creation. |
| S02-R1 | Pending | One reservation/buffer per inbound assembly. |
| S01-R1 | Pending | Store harvested bytes without an intermediate temp copy. |
| P09-R1 | Pending | Validate archives without a compress/decompress round trip. |
| M03-R1 | Pending | Explicit Plex current-item continuation. |
| M04-R1 | Pending | Use the sorted-run accumulator for collection workflows. |
| M02-R1 | Pending | Remove the synthetic ZIP round trip for decoded Trakt records. |
| F02-R1 | Pending | Normalize the already-selected workout group once. |
| F04-R1 | Pending | Read numeric template plans directly. |
| A02-R1 | Pending | One event-ID migration scan. |
| T02-R1 | Pending | Register test resource finalizers during acquisition. |
| T02-R2 | Pending | Bind sessions and admin authority to one server target. |
| T05-R1 | Pending | Three complete seed installs replace seven updates and catalog rereads. |
| B01-R1 | Pending | Replace watch deltas with complete membership/foreground sets. |
| B01-R2 | Pending | Persistence owns lock sorting. |
| B02-R1 | Pending | Delete the test-only live-environment runtime mode. |
| B02-R2 | Pending | Readiness uses configured-key metadata, not decrypted values. |
| B10-R2 | Pending | Delete unused definition-reader modes. |
| B11-R1 | Pending | Remove the obsolete projection-worker invalidation exemption. |
| B19-R2 | Pending | Store the selected composition module directly. |
| B24-R1 | Pending | Delete unused signal service/repository/layer. |
| C03-R1 | Pending | One presentation-lifecycle owner. |
| C06-R1 | Pending | Delete the obsolete entity/provenance facade. |
| C07-R1 | Pending | Delete the unused saved-view facade. |
| C07-R2 | Pending | Use shared collection-editor mutation ownership. |
| C08-R1 | Pending | Return ordinary Effects from admin operations. |
| P03-R1 | Pending | Normalize existing Request headers/body once. |
| M01-R1 | Pending | Use the canonical Metron role accumulator. |
| M04-R2 | Pending | Select only consumed episodic-completion fields. |
| M05-R1 | Pending | Delete the unreachable import-admission shadow union. |
| M06-R1 | Pending | Delete dormant hero configuration. |
| B11-R2 | Pending | Return the locked event revision once. |
| B22-R2 | Pending | Remove unreachable custom-renderer publication. |
| P08-R1 | Pending | Acquire a complete private workspace before exposing its handle. |

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

### Batch 6: B07-R2, F03-R2, F03-R1, C04-R1, C05-R1, F05-R1, M05-R2 — active

- Resumed at the user's request with one implementation subagent per finding. Independent backup, expiry, device, readiness, and home-activity work runs in parallel; F03-R1 follows F03-R2 because they share the workout controller.
- Each finding retains its own review and `audit:` commit. Affected validation, main-session cleanup, and final repository-wide acceptance are pending.
- F03-R2: removed the fallback auto-confirm path. Added combined invalid-input, prompt, late-observation, replacement, and independent-rest regressions. Fitness check passed before 16 editor files / 163 tests. Read-only review reported no findings. No persisted shapes, suppressions, or bypass casts changed.
- B07-R2: historical writes and `completeRun` use the captured database transaction. Completed status replaces progress-90 replay logic; ambiguous failures reread completion before retry/failure. Cleanup only deletes the temporary upload best-effort. Backend check passed before 11 backup files / 130 tests, including real PostgreSQL commit/rollback, lost acknowledgement, postcommit cancellation, replay, unavailable cleanup, and deadlock retry. Read-only review reported no findings. Drain active restores before deployment; no compatibility path was added.
- F05-R1: one ID-keyed aggregate retains visibility, effective-link deduplication, bounds, never-trained targets, and sorting. Set weights remain primary/untyped 1, secondary 0.5, stabilizer 0; recency includes every role. Fitness check passed before all 85 files / 537 tests. E2E check and the new `home-recipes.test.ts` API regression passed against PostgreSQL, covering equal-name targets and generated SQL. Read-only review reported no findings.
- C04-R1: each DOM/native listener is acquired with an immediate scoped finalizer; partial failure, interruption, stop, and disposal close registration scopes and release late handles. Scoped device type/format/lint checks passed before four files / 33 tests. Read-only review reported no findings. Full client type checking passed; full lint initially encountered concurrent C05-R1 edits and must be rerun for batch acceptance. Physical-device behavior was not tested. Native promises that never settle can still delay cleanup; removal remains best-effort.
- M05-R2: shared images require one of the seven manifest purposes. Removed gallery Other and the optional badge branch; locator-only presentation assets and artwork order are unchanged. Providers, seed data, and legacy mappings already emit tags; malformed fixtures were corrected directly. Media check passed before 15 focused files / 179 tests, then all 218 files / 1,546 tests passed. Read-only review reported no findings. Existing untagged images now fail decoding as intended; no compatibility decoder was added.
- C05-R1: input-free catalogs supply synchronous exact-declaration readiness. Removed both settings-keyed scans; OAuth success, catalog events, visibility, mutations, and manual retry refresh the snapshot. Removal/failure preserves edits while readiness blocks submission. Recipes check passed before 126 tests; full client check passed before all 136 files / 1,052 tests, also clearing C04-R1's transient full-lint blocker. Read-only review reported no findings. Updated the authoring README to the item-evaluator API.
- F03-R1: shared controller save admits before any await and declines concurrent callers. It retains busy/acknowledgement through cleanup; failed cleanup retries locally without repeating an acknowledged backend call. Durable submission identity/input/time and persist-before-invoke are unchanged; only definite business rejection unlocks edits. Save remains uninterruptible across consumer teardown. Review found one coverage gap, resolved with Deferred-controlled interruption/unmount tests during persistence, invocation, and acknowledged cleanup; no extra review round. Fitness check passed before all 16 editor files / 169 tests. After main-session cleanup, fitness check and all 85 files / 543 tests passed. Full runtime reload still relies on the durable frozen submission and backend idempotency.
