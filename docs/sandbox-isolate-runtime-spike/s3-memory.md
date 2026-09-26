# S3 memory-admission design review

**Status:** bounded prefix inspection and atomic resource admission are approved and implemented.
Transient pooling and lazy backend prefixes remain proposals requiring approval.

## Established constraints

The admission calculation in
`kernel/backend/src/lib/infrastructure/sandbox-runtime/sidecar-admission.ts` reserves these MiB per run:

| Ownership                                            | Reservation |
| ---------------------------------------------------- | ----------: |
| V8 heap and external memory                          |         320 |
| Other fixed execution allowances                     |          15 |
| Three run-message copies                             |          12 |
| Four execution requests                              |           8 |
| Three compiled-module copies                         |           3 |
| Host-result copies                                   |         144 |
| Buffer/reassembly allowances                         |          42 |
| Host response values/copies                          |          80 |
| Two done-message copies                              |          12 |
| **Run total, excluding journal and process startup** |     **636** |

The resident process reservation is 256 MiB. Each lazy process adds 128 MiB. Durable journal
loading reserves three copies of the inspected prefix size before fetching values.
The journal limit is 100 MiB; the default aggregate budget is 1,536 MiB.

| Two-run topology             | Minimum reservation, excluding journal contents |
| ---------------------------- | ----------------------------------------------: |
| Resident core processes only |                                       1,528 MiB |
| Core plus one lazy process   |                                       1,656 MiB |
| Core plus two lazy processes |                                       1,784 MiB |

These are reservation bounds, not observed resident memory. They exclude temporary journal loading
and assume zero journal content. The canonical host's half-memory ceiling is below the 2,128 MiB
needed for two maximum-journal runs even without a lazy process.

## Allocation and retention paths

1. `sidecar-admission.ts:reservePrefix` grants concurrency, memory, and process-start capacity
   atomically. A memory waiter owns no execution permit or partial reservation.
2. `modules/sandbox/durable-queues.ts:executeSandboxExecution` inspects the exact enqueued prefix,
   reserves its bytes, then loads values and the script.
3. `sandbox-journal-store.ts` checks presence and aggregate lengths before reading values in Redis.
   Inspection returns bounded length/fingerprint pins; the read atomically verifies them. Missing
   entries preserve projection-missing behavior, and changed entries fail without returning values.
   `workflow-journal.ts:readWorkflowJournal` retains returned strings while decoding entries; its
   native Redis reply remains reserved through cancellation.
4. `service.ts:run` serializes the decoded journal to calculate its retained reservation.
5. `host-call-gate.ts:encodeJournalPrefix` creates encoded copies of every entry. The run input
   also contains the decoded journal; the gate retains it for inline request indexing and dispatch.
6. `host-call-gate.ts:journalRead` serves bounded ranges from the complete encoded prefix. The
   isolate-side journal is lazy, but the backend-side journal is not.
7. Host results coexist as decoded values, serialized JSON, encoded logical frames, queued writer
   messages, and Rust reassembly. Inline settlement additionally retains host-owned journal evidence.
   The gate clears its encoded buffers on close; reservation release also depends on run disposal.

The existing `memory_admission_counts_journals_frames_startups_and_buffers` test covers the current
reservation lifecycle. It does not establish that smaller reservations cover the same allocations.

## Current admission

Bounded prefix inspection avoids the maximum loading allowance for small journals. **It is
insufficient alone:** two runs with a lazy process still exceed the default budget.

Passing coverage:

- `journal_inspection_pins_exact_prefix_bytes_without_returning_values`
- `journal_inspection_bounds_reply_before_loading_values`
- `journal_reads_reject_changed_inspected_prefix`
- `journal_inspection_preserves_missing_prefix_and_immutable_appends`
- `journal_inspection_rejects_invalid_lengths_and_unavailable_state`
- `durable_replay_reserves_inspected_journal_bytes_before_loading_values`
- `durable_replay_rejects_prefix_growth_during_admission_before_loading_or_running`
- `atomic_admission_keeps_memory_waiters_from_holding_execution_slots`
- `inspected_small_journals_can_reserve_two_replays_without_maximum_prefix_allowances`
- `journal_read_cancellation_retains_memory_until_the_native_reply_finishes`

## Remaining design for approval

### Separate persistent execution memory from transient buffer ownership

Keep heap, external-memory, stack, module, and retained evidence reservations tied to the execution.
Give journal decoding, host response construction, serialization, transport queues, and reassembly
explicit reservation owners. Transfer ownership with the buffer; release only after its last live
reference and native copy are gone.

A bounded shared transient pool can replace per-execution allowances only where allocation is
actually gated before it occurs. Ordinary host dispatch, inline settlement, journal reads, and both
transport directions must all participate. Fair, lane-aware acquisition must leave interactive
capacity; a background allocation cannot borrow it without an approved recall mechanism.

The pool capacity and concurrency policy are unresolved. A shared permit changes possible host-call
parallelism, even while preserving the existing per-execution maximum of four calls. It needs an
explicit decision and throughput/deadlock tests. Do not subtract any of the current allowances
until an allocation-lifetime proof identifies the replaced ownership.

### Avoid retaining an entire decoded backend journal if required

If the verified budget still cannot fit, use the committed Redis projection as the pinned backing
store and serve bounded ranges through the existing `journalRead` path. Retain bounded prefix
metadata and host-owned inline evidence, not a second full decoded prefix. Preserve schema
validation, exact request indices, immutable committed values, missing-entry behavior, and crash
replay evidence. Do not add an unmetered native store.

This is a larger change than preflight sizing. Its validation and buffer strategy, including a
single legal large entry, needs approval before implementation. Merely moving the current `HMGET`
behind a lazy callback does not make the allocation bounded.

## Required proof before adopting smaller bounds

- An ownership table for every reservation term, including maximum simultaneous copies, allocation
  sites, handoff sites, and release sites.
- A feasible budget for both interactive and background execution with the required snapshot
  processes, small journals, maximum journals, and legal maximum response sizes.
- Cancellation and crash tests showing that tickets, transport buffers, inline evidence, and native
  reassembly release their reservations once, after disposal.
- Tests showing interactive progress while background work waits on journal or response capacity,
  including synchronous inline settlement and independent socket control traffic.
- Fresh-host end-to-end latency and import progress measurements at the approved configuration.

Approve a transient-pool/lazy-prefix design only after its ownership table establishes a feasible
bound. Prefix inspection and atomic admission alone do not prove S3 latency acceptance.
