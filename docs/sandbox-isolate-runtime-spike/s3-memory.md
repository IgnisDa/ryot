# S3 memory-admission design review

**Status:** investigation findings and proposed design; implementation requires approval.

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
loading reserves 300 MiB, then `retainJournal` reduces it to three times the actual serialized size.
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

1. `sidecar-admission.ts:reservePrefix` takes a global concurrency permit before waiting for memory.
   A memory waiter can therefore occupy a worker/permit without running an isolate.
2. `modules/sandbox/durable-queues.ts:executeSandboxExecution` reserves the maximum prefix before
   reading Redis, then loads the script and passes the decoded journal into runtime execution.
3. `workflow-journal.ts:readWorkflowJournal` fetches every prefix entry in one `HMGET`. It retains
   the returned strings while decoding the entries and checks total bytes after receiving the reply.
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

## Proposed design for approval

### 1. Size the pinned prefix before allocating it

Use a bounded Redis-side inspection of exactly the committed prefix to obtain lengths and validate
the total before a backend reply can contain its values. Missing entries retain projection-missing
behavior. Cap inspection output and work by the existing 1,000-entry limit.

Admission reserves the actual required prefix capacity before fetching or decoding values. It
atomically grants concurrency, process-start capacity, and memory only after all can fit. A waiter
does not hold a partial allocation or global execution permit. Redis changes between inspection
and reading must fail closed rather than allocate beyond the inspected reservation.

This removes the unconditional 300 MiB loading penalty for small journals. **It is insufficient
alone:** two runs with a lazy process still exceed the default budget.

### 2. Separate persistent execution memory from transient buffer ownership

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

### 3. Avoid retaining an entire decoded backend journal if required

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

**Recommendation:** approve bounded prefix inspection and atomic all-resource admission as the
first implementation step, then approve a transient-pool/lazy-prefix design only after its ownership
table establishes a feasible bound. Do not treat the first step as proof of S3 latency acceptance.
