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

## Checkpoint API: viable direction, not replaced in this change

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

A narrower replacement should let an import plugin return a normalized batch and its next cursor;
the kernel should own capture, apply, checkpoint advancement, and cleanup. The plugin should not
perform arbitrary mutations between returning batches. External confirmation is a separate phase
with its own recorded outcome and provider retry policy: a cursor cannot resolve whether a remote
write succeeded before the connection failed. Notification/reminder ambiguity is already documented
in `../work-reduction/durability-requirements.md`.

I did not add this API alongside the existing one. That would create two execution models without
removing the journal, projection, host-call, and recovery machinery still used by shipped workflows.
Replacing the public replay API requires migrating the complete collection → capture → apply →
confirmation path for both imports and integrations, then removing its old SDK/compiler/runtime
surface together. This remains the strongest next simplification, but a lone `saveCheckpoint(offset)`
would discard product guarantees, and a second optional runtime would increase complexity. The
current change therefore retains transparent replay explicitly; it does not claim to replace it.

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
