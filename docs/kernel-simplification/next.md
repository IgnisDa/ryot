# Further simplification

Base: `ea14b5576b`. Work branch: `kernel-simplification-next`.

## Accepted constraints

- One backend process owns a database. Concurrent requests still need transactional protection.
- Third-party plugins and per-user revisions remain; first-party plugins remain sandboxed.
- Stored completion state, indexed dates, page-first queries, and fast large-library reads remain.
- Interactive saves must commit their required derived results together or fail without partial writes.
  Imports and provider updates may derive asynchronously.
- Checkpoint-based imports may repeat unfinished reads/parsing after restart, but committed records
  must not duplicate. Progress, cancellation, pinned code/config, and delivery-specific retry rules remain.
- V2 schema/plugin APIs may change; V1 migration and reports and existing backup compatibility remain.
  Local application data and source dumps are never reset.
- Changes are committed locally in logical groups, without pushing or deploying.

## Evidence and acceptance

`../work-reduction/redesign.md` rejects computing library state on read because filtering and sorting
need the whole library. `design-indexed-date.md` records the failed query alternatives and the indexed
date solution. `durability-requirements.md` distinguishes import recovery from ambiguous external
delivery, where automatic retries can duplicate a notification. These constraints survive this work.

The [originating T3 thread](t3-thread://v2/e9a23605-e8ca-4e83-8024-5c72e9818e28/84bed42c-4fe2-413d-b7eb-f4f04d8bfa6f)
and [follow-up thread](t3-thread://v2/e9a23605-e8ca-4e83-8024-5c72e9818e28/5b0047f5-a116-4651-a30d-e15f3699b152),
their prompts, and the related local Claude Code transcripts were read before this work. Earlier replica requirements are superseded by the single-process decision.

Each replacement must remove machinery and preserve the behavior that justified it. A proposal that
cannot meet those criteria is deferred with its evidence rather than implemented for a line-count goal.
Validation uses package checks before tests, affected e2e files, and isolated large-library measurements
on the existing VM when available. Existing measurements are historical evidence, not current baselines.

## Work

1. Replace unsafe prepared fold results with admission before locks. The key introduced by
   `c3580b0d63` covers fold state and code but omits the script's query reads.
2. Enforce one backend owner before removing distributed ownership/recovery machinery.
3. Evaluate explicit checkpoints using real import parsing, population, commit, and cancellation paths.
4. Evaluate stored completion records and explicit overrides against history ordering, editing,
   suppression, merge, backup/restore, and integration behavior.
5. Evaluate catalog representations against the measured query improvements before changing them.

Implementation and validation results follow.

## Implemented

The server acquires a dedicated PostgreSQL session advisory lock before migrations and keeps it
through runtime shutdown. A second owner fails startup. Losing that connection interrupts runtime
work. Jobs now recover interrupted rows once at startup; they have no renewable lease. A queued
successor under the same key supersedes an interrupted job. Workflow registrations recover their
active executions in pages, and deferred/child completions wake local activations directly. The
workflow runner table, execution owner column, heartbeat, takeover sweep, and cross-process workflow
notifications are removed. Persisted steps, clocks, account fences, and domain idempotency remain.

Fold jobs reserve sandbox admission before taking the writing transaction. A busy subject row makes
the job release its reservation and retry outside the transaction, without spending a job attempt.
This prevents a job from holding capacity while waiting on an interactive writer that needs it.
They no longer execute a fold speculatively and reuse its result after checking only the previous
fold value and code pin.
That check did not cover RyotQL inputs such as events, links, or provider inventory. Fold execution
now reads inside the writing transaction. Interactive folding no longer catches failure and commits
the source write anyway: failure rolls back the save. Background import/provider work still queues
fold jobs. Capacity retries roll back the entire transaction before waiting. A parked plugin caller
defers its host call so the parent releases capacity before retrying. Inline admission and request
retries remain bounded, so an overloaded server can still reject a save without partial writes.

This keeps the existing transactional fold model. It does not introduce optimistic validation of
arbitrary script reads or eliminate sandbox execution while the writing transaction is open. Doing
that while preserving atomic source-plus-derived writes requires a restricted input snapshot or a
complete read-dependency check; the former prepared-result key was neither.

## Checkpoint API: rationale

Consider a 1,000-record import in batches of 100. With transparent replay, the plugin restarts its
function, and the engine supplies saved results for completed calls until it reaches unfinished
work. With explicit checkpoints, the plugin receives a saved cursor, such as page 4, and computes
the next batch. The kernel commits the batch's records and durable results before advancing the
cursor. A crash after record 430 may repeat parsing of page 4, but committed record identities let
the kernel skip 401–430. A crash after the entire page commits but before the cursor advances must
also find the already applied batch instead of writing it again.

The current implementation already contains much of this domain checkpointing:

- `plugins/media/backend/imports/application-segment.ts` retains page, offset, batch, ordinal,
  deduplication key, and item index. It captures normalized source and application input before
  applying records, then confirms only the committed records to integrations.
- `kernel/backend/src/modules/imports/capture-service.ts` checks capture identity, fingerprints,
  and checkpoint equality; an arbitrary new page fetched after restart cannot replace admitted input.
- `batch-results.ts` reconstructs outcomes and confirmed records from committed item results.
  The import README explains incremental commits and cancellation. These receipts are needed even
  without a replay journal.
- `runtime/source-state-store.ts` preserves encrypted admitted settings and durable artifact
  references. Code/config pins and captured inputs must outlive process-local scratch files.

The kernel continues to own capture, apply, receipts, and cleanup. External confirmation remains a
separate phase with its own recorded outcome and provider retry policy: a cursor cannot resolve
whether a remote write succeeded before the connection failed. Notification/reminder ambiguity is
already documented in `../work-reduction/durability-requirements.md`.

The checkpoint migration below replaces the public orchestration contract across the collection →
capture → apply → confirmation paths for both imports and integrations. A private journal remains
inside each unfinished bounded step because it supplies the call receipts that cursors alone cannot
replace. There is one workflow API, with optional checkpoint state for long-running work.

## Completion representation: retain stored events and fold state

Commit `3dffea3892e14985b1960c6b2ea18129c1dcf24d` records a concrete regression: deleted completions
returned after merge/restore, and restored progress completed a second time. Fold state contains
suppressed occurrences and frozen inventories that events alone cannot reconstruct. Current backups
carry that state in `fold-values.ndjson` and remap IDs when absorbing it.

Moving automatic completions to a separate derived-record table while keeping explicit overrides
would still need this occurrence state. It would additionally require history, sorting, reports,
editing, integration consumers, and old backup import to reconcile two record sources. Keeping
automatic completions as ordinary stored events with a completion key already supports those
consumers. This pass preserves the representation and fixes its execution consistency. It does not
replace stored completion or library summaries with calculations on read.

## Catalog representation: retain immutable caching and per-read resolution

Commit `4fc8aac1606c1e05ae1e7728abb22870d88f3884` removed catalog views and mutable user-plugin-state
triggers in favor of immutable revision caching and a resolved catalog supplied to SQL as CTEs.
`kernel/backend/src/modules/definitions/AGENTS.md` records the ownership rule: precedence and
effectiveness are resolved per read, while only immutable revision and kernel definitions are cached.
Hidden, listed, effective, and executable definitions are different states; collapsing them or
persisting a new per-user catalog would require another invalidation protocol.

No read-query or catalog representation change is justified by the current evidence. The stored
summary, indexed date, page-first query, and query-local JIT choices from
`../work-reduction/redesign.md` and `design-indexed-date.md` remain. The flow probes measure the
execution changes here; they are not a new large-library benchmark and do not establish that a
catalog rewrite would be faster.

## Measured result

The existing VM ran the same flow-probe file at `ea14b5576b` (`next-baseline`) and this change
(`next-after`), with 68 observations across 23 flows in each run. Both passed. The table reports
medians; the larger fanout cases have only one observation. SQL counts subtract the probe's idle
baseline. These sequential runs are a regression check, not a controlled statistical speedup claim.
No query, stored summary, or sandbox-capacity tuning was changed.

| Flow | Samples per run | Caller ms, before → after | SQL statements, before → after |
| --- | ---: | ---: | ---: |
| `signup` | 5 | 286 → 257 | 192 → 190 |
| `media-movie-fixture` | 3 | 494 → 415 | 117 → 119 |
| `event-create-backlog` | 5 | 223 → 216 | 91 → 89 |
| `event-create-complete` | 5 | 387 → 346 | 277 → 273 |
| `collection-membership-add` | 3 | 176 → 152 | 336 → 338 |
| `plugin-upload-private` | 3 | 1754 → 1678 | 17 → 16 |
| `plugin-install-private` | 3 | 354 → 335 | 139 → 142 |
| `media-show-70-episodes` | 1 | 13054 → 12776 | 13268 → 13117 |
| `media-progress-fanout-20` | 1 | 5988 → 5524 | 4000 → 3917 |
| `event-create-no-hooks` | 5 | 96 → 87 | 40 → 39 |
| `event-create-no-hooks-50` | 3 | 140 → 142 | 234 → 235 |
| `read-entity-x50` | 3 | 563 → 555 | 203 → 203 |
| `read-media-list-x50` | 3 | 1522 → 1501 | 254 → 252 |
| `operation-review-create` | 3 | 701 → 659 | 511 → 505 |
| `workout-1-set` | 2 | 968.5 → 905 | 315.5 → 311 |
| `workout-10-sets` | 1 | 983 → 852 | 382 → 381 |
| `workout-25-sets` | 1 | 923 → 911 | 505 → 500 |
| `workout-editor-save-1x5` | 3 | 663 → 606 | 582 → 578 |
| `workout-editor-save-5x5` | 3 | 1108 → 1085 | 1014 → 999 |
| `workout-editor-save-10x15` | 3 | 2418 → 2261 | 2655 → 2632 |
| `plugin-system-install` | 3 | 437 → 390 | 122 → 123 |
| `plugin-system-reconcile` | 3 | 157 → 151 | 1497 → 1494 |
| `plugin-system-change` | 3 | 388 → 408 | 120 → 120 |

The main saves and large history writes show no observed latency regression in these probes.
The no-hook 50-event write increased from 140 to 142 ms, and system plugin change from 388 to
408 ms. Read-query work is effectively unchanged. Background-subtracted CPU measurements are noisy
(including a negative private-upload sample), and quiet-window settling varies by seconds; neither
is used to claim a performance improvement. The real 14,708-title dump's historical read optimizations
remain intact, but this run did not repeat that large-library benchmark.

## Validation and handoff

- `bun run check`: passed, including all 30 projects and 7,943 TypeScript files.
- `bun turbo test --filter=@ryot-app/kernel-backend --filter=@ryot-app/server`: passed;
  2,789 backend tests plus dependency tests. The server has no standalone unit-test script.
- VM run `next-final`: 49 tests passed across 12 affected API files. Coverage includes import and
  sidecar restart, cancellation, reminder delivery ambiguity, rate-limit recovery, backup/restore,
  history suppression and merge, large completion writes, workout records, and pagination.
- Flow probes `next-baseline` and `next-after`: passed; measurements are above.
- Read-only review found no blocking issues. The cleanup pass against `ea14b5576b` removed the unused
  `StepWrite` type export and redundant/stale comments: eight lines removed, none added. Capacity and
  account-fencing comments remain because they explain constraints. No type-checker bypass casts or
  lint suppressions were added; literal `as const` assertions remain.

The generated V2 baseline was rebuilt; this change does not include an incremental migration for an
existing V2 database. Existing local databases, source dumps, and production deployments were not
modified. V1 migration code and backup formats are retained. Changes are local; nothing was pushed.

Code commits: `e3b9d96001` (single-process execution) and `8bfb777d4a` (atomic fold results).

## Explicit plugin checkpoints

The next pass replaces the plugin-facing transparent replay API with `run(input, step, checkpoint,
execution)`. A workflow declares its checkpoint schema, performs a bounded step, and calls
`step.save(state)` to end it. The next invocation receives that state; returning a value finishes
the workflow. `step.activity` and `step.child` retain typed executable references. Workflows no
longer expose sleep or the runtime's journal protocol. Ordinary bounded workflows need no checkpoint.

Media and fitness imports save collection, sort, normalization, and application cursors. Media syncs
save collection and application state, and monitoring saves its page cursor. Sorted runs retain the
existing binary merge strategy and artifact captures: checkpoints store cursors and run references,
not whole imported datasets. The redundant media application wrapper and segment workflow are removed.

The runtime still journals calls inside the unfinished step. This is deliberate: an interrupted HTTP
request, partially completed batch, or child workflow still needs its original identity and delivery
result. Saving a checkpoint atomically updates `workflow_execution` and deletes that step's receipts
under the existing tree-expiry fence. The engine updates its cached checkpoint and evicts the same
receipts without interruption between the database commit and cache update. Each subsequent step gets
a fresh call namespace; cancellation and artifact ownership remain attached to the original execution.
Restart loads the saved state with the execution row. Bounded workflows do not incur a separate
checkpoint read or completion write. Completed checkpointed workflows retain their final output so a
restart during reference release cannot repeat the last step.

This narrows plugin orchestration; it does not remove the private unfinished-step recovery mechanism.
Pinned plugin revisions, admitted inputs and configuration, committed item identities, progress,
confirmation receipts, and external delivery ambiguity remain. Stored completion events, frozen
inventories, suppressed occurrences, indexed dates, page-first reads, and immutable catalog caches are
unchanged for the reasons recorded above. No artifact, backup, manifest, protocol, compiler, or API
version constant changes. The greenfield V2 baseline includes the checkpoint column; existing databases
and source dumps are not migrated or deleted by this work.

### Checkpoint performance probes

VM runs `checkpoints-probes` (checkpoint implementation) and `checkpoints-baseline` (fresh checkout of
`3dc229cc2a`) each passed with 68 observations across 23 flows. The baseline ran second, after the first
comparison with the older `next-after` run showed higher medians even for unchanged read paths. These
are sequential regression probes, not a controlled speedup experiment. SQL counts subtract idle work.

| Flow | Samples per run | Median caller ms, baseline → checkpoints | Median SQL statements, baseline → checkpoints |
| --- | ---: | ---: | ---: |
| `signup` | 5 | 263 → 284 | 190 → 190 |
| `media-movie-fixture` | 3 | 416 → 529 | 116 → 116 |
| `event-create-backlog` | 5 | 240 → 255 | 89 → 89 |
| `event-create-complete` | 5 | 369 → 423 | 273 → 275 |
| `collection-membership-add` | 3 | 176 → 162 | 341 → 340 |
| `plugin-upload-private` | 3 | 1721 → 1639 | 16 → 16 |
| `plugin-install-private` | 3 | 330 → 280 | 140 → 138 |
| `media-show-70-episodes` | 1 | 12595 → 13183 | 13118 → 13116 |
| `media-progress-fanout-20` | 1 | 5585 → 5432 | 3917 → 3917 |
| `event-create-no-hooks` | 5 | 111 → 88 | 39 → 40 |
| `event-create-no-hooks-50` | 3 | 152 → 136 | 235 → 235 |
| `read-entity-x50` | 3 | 480 → 555 | 203 → 203 |
| `read-media-list-x50` | 3 | 1739 → 1785 | 252 → 252 |
| `operation-review-create` | 3 | 736 → 751 | 507 → 504 |
| `workout-1-set` | 2 | 885 → 955.5 | 311 → 311 |
| `workout-10-sets` | 1 | 999 → 991 | 380 → 380 |
| `workout-25-sets` | 1 | 884 → 875 | 501 → 501 |
| `workout-editor-save-1x5` | 3 | 579 → 697 | 578 → 578 |
| `workout-editor-save-5x5` | 3 | 1089 → 1166 | 999 → 999 |
| `workout-editor-save-10x15` | 3 | 2264 → 2426 | 2632 → 2630 |
| `plugin-system-install` | 3 | 429 → 384 | 123 → 123 |
| `plugin-system-reconcile` | 3 | 132 → 144 | 1495 → 1495 |
| `plugin-system-change` | 3 | 403 → 390 | 120 → 120 |

SQL work is effectively unchanged. Several latency medians are higher, including movie creation and
the small workout editor save; others are lower. Individual CPU and latency samples overlap, and background subtraction is noisy. These measurements
do not establish latency neutrality or a reliable regression. They do not repeat the historical
14,708-title library benchmark. Stored summaries and read-query optimizations remain unchanged.

A focused follow-up (`checkpoints-focus`) passed with ten backlog creates and ten completion creates.
Its medians were 212 ms / 89 SQL statements for backlog and 389.5 ms / 273 statements for completion,
versus 240 ms / 89 and 369 ms / 273 in the fresh baseline's five samples. This reduced the completion
latency difference seen in the full run, while backlog became faster. There is no demonstrated growth
in query work or a consistent latency regression attributable to the checkpoint change; the samples
still do not justify claiming a speedup. The one-off signup and fixture observations in the focused
run are warm-up context, not comparable medians.

### Checkpoint validation and handoff

- `bun run check` passed: all 30 projects and 7,938 TypeScript files, plus repository lint,
  formatting, import-boundary checks, native formatting/clippy, and protocol fixtures.
- The final root Turbo test run filtered to `kernel-backend`, `plugin-backend-sdk`,
  `plugin-backend-compiler`, `sandbox`, `media-plugin`, and `fitness-plugin` passed all 48 tasks,
  with 43 cache hits. Results include 2,789 backend tests, 92 SDK tests, 109 compiler tests,
  230 TypeScript sandbox tests and the native suite, 2,001 media tests, and 652 fitness tests.
- PostgreSQL recovery coverage verifies that a new engine resumes from checkpoint 3 after completed
  step records are removed, without repeating any batch. Native coverage passes saved state to a
  fresh isolate. Import coverage preserves 1,601 unique measurement records across application steps.
  The compiler rejects authored imports of the private workflow protocol.
- VM run `checkpoints-final` passed 71 tests across 12 affected files. Coverage includes process and
  sidecar restart, pinned configuration, cancellation with partial commits, external integration
  confirmation, media/fitness imports, lifecycle hooks, HTTP spacing, and monitoring notifications.
- Both full performance runs and the focused follow-up passed; their limitations and measurements
  are recorded above.
- The main-session read-only review found no blocking correctness issues. Cleanup against
  `3dc229cc2a` removed 21 net lines: loops superseded by checkpoint returns, duplicate normalization
  progress, and duplicate monitoring-test bookkeeping. Private unfinished-step receipts and their
  test helpers remain because they protect recovery and external-delivery semantics. No type-checker
  bypass casts or lint suppressions were added; literal `as const` assertions remain.

Implementation commit: `a19c79c4ba`. Changes are local; nothing was pushed or deployed. The generated
V2 baseline replaces the previous greenfield baseline rather than providing an incremental migration
for existing V2 databases. Existing local application databases and source dumps remain untouched.

## Large-library and checkpoint scale validation

Validation base: `cf39940142`. This pass changes benchmark tooling, opt-in regression gates, and the
test-support journal inspector. It changes no product query, completion representation, execution
capacity, or schema. The workspace was clean when work started; the intervening baseline replacement
seen during the preceding status check was no longer present.

### Restored library

`tmp/file2.sql` was restored and migrated into separate local PostgreSQL/object-storage containers.
Real user data stayed on the owner's machine. The original application containers and all source
dumps were untouched. PostgreSQL retained the historical 1 GiB limit. Migration completed in 347 s.
The selected account had 14,708 library members; the separate fitness account had 113 workouts.

The library benchmark gained search and three-page traversal checks, plus five repetitions of
completion creation, source-date editing, deletion, and editing suppressed history. It verifies that
pages do not repeat entities, source edits preserve one completion, and deleting a completion keeps
it suppressed after another source edit. Each write run adds five synthetic fixture movies to the
restored account; subsequent runs include those additional fixtures.

The first complete run waited for the measured media account's folds, while other accounts were still
rebuilding. For the quiet runs, 50,069 queued fold jobs for unrelated accounts were temporarily
deferred in the disposable database, with their original schedules saved. The measured fitness
account's remaining folds were allowed to finish. All 50,069 schedules were restored afterward, the
temporary scheduling table was removed, and the benchmark server and containers were stopped with
their data retained. No production queue or application database was changed.

Both full runs passed 708 individual reads across 236 variants, three concurrent home-page loads,
and 20 write measurements. The busy-week run passed another 15 targeted reads and three home-page
loads. There were no failed reads, repeated page entities, or PostgreSQL backend kills.

Medians in milliseconds, three observations per read and five per write:

| Operation | Other accounts rebuilding, dump date | Quiet, dump date | Quiet, busy week |
| --- | ---: | ---: | ---: |
| Upcoming | 122 | 110 | 157 |
| Show calendar | 61 | 40 | 86 |
| Continue shows | 1869 | 1197 | 1044 |
| All Shows | 2781 | 1024 | 776 |
| All Shows, three pages combined | 7680 | 4617 | — |
| All Movies | 703 | 500 | — |
| Create progress and completion | 204 | 303 | — |
| Edit history date | 185 | 312 | — |
| Delete completion | 64 | 126 | — |
| Edit suppressed history | 124 | 206 | — |

Home-page loads were 5546/1714/1736 ms during rebuilds, 2050/2122/1712 ms at the quiet dump date,
and 1244/1228/1186 ms in the quiet busy week. Sampled PostgreSQL container memory peaked at
1003/967.7/781.6 MiB respectively. Dates were 2026-07-15 and 2025-10-15; overrides affect requested
windows, not the stored-state or PostgreSQL clock. These sequential samples are not a before/after
comparison of the checkpoint implementation: cache state, query plans, and
background work differ. In particular, the quiet write samples were slower than the loaded samples.
The historical date-index gains remain visible, but not every show-read or whole-page sample meets
the earlier one-second/two-second targets.

Read-only query plans on the quiet copy explain the remaining show cost. All Shows spent 91.8 ms
selecting 21 rows and 797.6 ms in total. Continue shows took 900.4 ms; its included episode rows
accounted for about 812 ms over 21 cards. These are repeated per-card reads, not evidence that stored
completion state or page-first selection should be removed. Plans and SQL remain local under
`tmp/library-check/checkpoint-show-plans-*`.

The benchmark itself needed repairs: its readiness check referenced the removed projection table;
the Effect test helper used its five-second default despite the CLI timeout; selecting the largest
library omitted the media-library entity constraint; and its result reporter did not distinguish
write samples from read samples. The updated tooling uses fold jobs, passes the helper's timeout,
constrains library selection, reports writes, and preserves the test exit status. The first short
run was interrupted by the helper timeout and is excluded from the measurements above.

### Import restart

VM run `checkpoint-scale` imported 3,201 synthetic OpenScale measurements, killed the API with
SIGKILL after an application checkpoint recorded 1,600 committed measurements, and restarted it
against the same database and object store. It passed all 678 assertions, including exactly 3,201
unique measurement IDs and timestamps and a final summary with no failures or duplicates.

The import took 353.7 s including the restart; the test took 366.9 s. The API became healthy 5.1 s
after the kill. The next saved application checkpoint was observed 178.3 s after the kill; that
measures another bounded batch of work, not the time to the first resumed write. Across 336 samples,
checkpoint payloads peaked at 416 bytes, workflow-step rows at 1,072, and journal projections at 129
rows. No sample retained a workflow-step scope older than its saved checkpoint. At completion there
were 277 workflow-step rows and zero journal projection rows: checkpoints do not eliminate all
committed-result receipts. The active API's sampled RSS peaked at 604 MiB before restart and 599 MiB
afterward. Sampling cannot establish a general memory bound or rule out leaks on larger inputs.

### Repeated sync

VM run `checkpoint-sync` passed 1,227 assertions across two 101-item Audiobookshelf syncs. Each item
requires its own source window. The runs took 435.9 s and 413.3 s; the whole test took 888.8 s.
The fake upstream saw exactly one snapshot fetch per sync and one progress fetch per item per sync.
After the second run every item still had exactly one progress event with its original ID.

Across 88 storage samples, checkpoint payloads peaked at 324 bytes, active executions at six, and
obsolete checkpoint scopes stayed at zero. The API's sampled RSS peaked at 689 MiB and finished at
529 MiB. Retained state nevertheless accumulated: the last sample had 765 execution rows, 13,298
workflow-step rows, and 2,277 journal projection rows occupying 2.98 MB of body data. These include
bounded child executions that do not save another checkpoint. Journal projections have a documented
24-hour retention policy; this test did not wait for that collection window. A small current
checkpoint is therefore not evidence that total persisted work is constant with import size.
RSS figures cover the API process, excluding native sidecars and PostgreSQL.

### Validation handoff

The existing population capacity gate also passed: two concurrent 1,001-item imports, 33 assertions,
and 408.9 s for the test body. Its initial run completed the work but failed its journal assertion
because the test-support inspector only matched the original execution IDs. Checkpoint journal IDs
include a checkpoint suffix. The inspector now includes those scopes; the unchanged gate assertions
passed on the final run. This correction changes test inspection, not execution or persistence.

Affected package checks passed before testing. Final `bun run check` passed across 7,940 TypeScript
files in 30 projects, with 38 successful Turbo tasks. The backend suite passed 2,789 tests; the final
`bun turbo test --filter=@ryot-app/kernel-backend` reused all 41 successful task caches. Only the
individual operational and library e2e files described above were run. Shell syntax and diff checks
passed. Raw synthetic workload logs and the comparison artifact are retained locally under
`tmp/checkpoint-validation`; real-library logs and query plans remain under `tmp/library-check`.

The main-session read-only review found no blocking issues. Cleanup against `cf39940142` removed the
18-line temporary sampling script and its VM copy after stopping both observers. The regression
gates, benchmark tools, and measured evidence remain useful. No type-checker bypass casts or lint
suppressions were introduced. The validation services are stopped, and the restored benchmark data
is retained. Changes are local; nothing was pushed or deployed.

### Follow-ups supported by this evidence

- Migration queues rebuild work for disabled accounts, while script resolution correctly rejects
  their execution. The restored copy had 36,437 queued fold jobs for disabled accounts, and observed
  unavailable-script failures belonged to disabled users. Admission should avoid that work and
  arrange a rebuild when an account is enabled, while preserving its data. This pass records the
  finding without changing migration or account lifecycle behavior.
- Show-card and continue-watching episode reads merit targeted profiling and batching. Page-first
  selection and stored completion state should remain.
- Private unfinished-step receipts remain justified by the successful restart. Any further removal
  should distinguish those receipts from reconstructible journal projections and already completed
  child executions; API simplification alone does not make all durable storage unnecessary.

## Targeted scheduling, show-read, and retention follow-ups

Base: `0723e28c37`, on `ultra-rewrite`. The scheduling and read changes preserve stored completions,
suppression, frozen inventories, and page-first selection. They add no schema, protocol, or execution
model changes.

### Disabled-account admission

Legacy migration queues Media/Fitness fold rebuilds only for enabled migrated users. Instance Admin
re-enablement locks the account and commits its status update together with one rebuild per effective
plugin that declares folds. Re-enabling an already enabled account does not enqueue another rebuild.
The status update uses the owning auth repository so it joins this transaction; disable still revokes
sessions through the auth service. The regression test rejects the second plugin's job at the database
boundary and verifies that both enablement and the first job roll back.

Fresh local databases `followups_small` and `followups_large` were restored from `tmp/file.sql` and
`tmp/file2.sql`. The small migration completed in 99 s with one enabled user and two rebuild jobs.
The large migration completed in 497 s with 69 enabled users, 230 disabled users, 138 rebuild jobs for
enabled users, and none for disabled users. Automation triggers, recipients, runs, and attempts stayed
empty. Migration-only restarts preserved event and rebuild-job counts; the large restart also preserved
ID fingerprints across 861,815 events and all 138 rebuild jobs. Original application databases and
source dumps were not changed. These timings include different local load and are not migration
speed comparisons.

### Episode reads

Episode display state is selected from the latest matching event in one scalar lookup instead of
fetching its slug again for each state branch. The next-up anchor avoids a redundant lookup. Aired
and upcoming episode predicates use the existing `occursAt` column maintained from `publishDate`,
following `docs/work-reduction/design-indexed-date.md`; they no longer parse the date JSON for each
candidate. Null and malformed dates retain their aired/unknown semantics.

The old and new SQL were run alternately against the same restored library, with JIT off and the
historical 1 GiB PostgreSQL limit. One warm-up pair was excluded, followed by five measured pairs.
Both statements returned byte-identical rows, 21 per query:

| Query | Before median | After median | Reduction |
| --- | ---: | ---: | ---: |
| Continue Shows | 873.431 ms | 765.603 ms | 12.3% |
| All Shows | 818.186 ms | 593.263 ms | 27.5% |

These are SQL execution times rather than complete page-load times. An earlier measurement that
overlapped repository checks is excluded. Raw SQL and plans remain local in `tmp/library-check`;
aggregate measurements and the comparison artifact are in `tmp/followups`.

The API-level follow-up passed 21 reads across seven variants (including search and three-page
traversal), three concurrent home-page loads, and 20 write measurements. It passed 200 assertions
in 72.1 s. Median Continue Shows was 845 ms, All Shows 594 ms, search 464 ms, and three pages combined
1,895 ms. Home-page loads took 1,583/1,065/1,045 ms. Completion creation, date edits, deletion, and
suppressed-history edits preserved their invariants. There were no failed reads, duplicate page
entities, or PostgreSQL backend kills. This write run added five synthetic fixture movies to the
restored benchmark account.

All 50,069 temporarily deferred job schedules in the benchmark copy were restored, the temporary
schedule table was removed, and its API and containers were stopped with data retained.

### Simulated retention validation

A real 24-hour wait is unnecessary to verify the cleanup rules. Existing `TestClock` database tests
cover the 23/24-hour boundary, seven-day failure retention, completed children whose parent remains
active, active children, pending durable clocks, and admission races with expiry. Workflow cleanup
clears steps, payloads, results, and checkpoints while retaining execution identities that fence late
writes and repeated admission.

The added journal-store test ages projection rows to 25 and 23 hours, runs the production pruning
function in bounded batches, verifies that recent rows survive, and reconstructs the removed
projections. Existing replay tests cover repairing missing projections from authoritative workflow
receipts. This validates retention and recoverability without fake timers; it does not establish a
long-running process memory bound or claim that retained execution identities disappear.

### Validation and handoff

`bun run check` passed across 7,941 TypeScript files and 30 projects. The subsequent root-level
`bun turbo test --filter=@ryot-app/kernel-backend --filter=@ryot-app/media-plugin` passed all 2,792
backend tests, 1,589 Media node tests, and 412 Media DOM tests. Affected package checks passed before
their tests. The VM run passed 57 cases across lifecycle recipes, activity logs, custom episodic
authoring, and God-mode recovery; after the indexed-date change, the three affected Media files
passed again with 35 cases. Both VM runs stopped their application services.

The read-only review found no blocking issues. The cleanup pass removed the completed 24-line
`tmp/followups/compare-queries.py` scratch script after verifying it had no callers or running
process. Regression tests and local measurement artifacts remain as validation evidence. Cleanup
added no lines and introduced no behavior changes; the task adds no bypass casts, suppressions,
non-null assertions, or TODOs. `git diff --check` passed. Changes are committed locally on
`ultra-rewrite`; nothing is pushed or deployed.
