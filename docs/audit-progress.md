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

**6 implemented, 2 in progress, 75 pending; 3 excluded.**

“Implemented” means affected checks and tests passed and the change is committed with this tracker. Batch-wide acceptance is recorded separately below. Rows follow the audit's ranked order; sequencing can change to respect dependencies and keep changes reviewable.

| Finding | Status | Change or intended outcome |
| --- | --- | --- |
| P04-R1 | Implemented | Typed presentation batches replace the internal tuple codec. `13bc2b3456`. |
| B18-R1 | Implemented | Expiry compare-and-set governs the OAuth result. `970188a7b5`. |
| B13-R1 | Implemented | Generation-fenced control reads omit report aggregation. `858b8a3762`; media fixture follow-up `ac5ecfa99a`. |
| F01-R1 | Implemented | Nullable override merge patches preserve omitted fields. `a9166361ae`. |
| B10-R1 | Implemented | Four shared typed pinned-definition projections include policy fields. `f0dfc38ce3`. |
| P07-R2 | Implemented | Top-level client/shared regions determine authority and traversal floors; nested region-name tests and real module compilation pass. See this finding's `audit:` commit. |
| P06-R1 | In progress | Share validated-entry facts between standalone and package compilation, including workflow policy. |
| P07-R1 | In progress | Use authored TypeScript ASTs for import and asset policy, not regex scans. |
| C01-R1 | Pending | Fence late authentication refresh completion. |
| B04-R1 | Pending | One account bootstrap identity owner. |
| B19-R1 | Pending | Agree on selected home/route targets during preparation and freshness checks. |
| B07-R2 | Pending | Commit restore data and completion bookkeeping together. |
| F03-R2 | Pending | One duration-expiry completion action. |
| F03-R1 | Pending | One workout-editor save owner. |
| C04-R1 | Pending | Release partially acquired native listeners. |
| C05-R1 | Pending | Keep form edits from reloading remote catalog pages. |
| F05-R1 | Pending | Preserve independent activity for equal-name targets and all roles. |
| M05-R2 | Pending | Require one purpose shape across manifests and readers. |
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

### Batch 2: P07-R2, P06-R1, P07-R1 — active

- P07-R2: client compiler check passed; all four test files and 64 tests passed. Covers nested `client/shared`, `client/client`, `shared/client`, and `shared/shared` paths, traversal rejection, assets, and real Vite compilation.
- P06-R1 and P07-R1: implementation in progress. Batch-wide validation pending.

Next after this batch: authenticated-state ownership (C01-R1), subject to the existing dependency order.
