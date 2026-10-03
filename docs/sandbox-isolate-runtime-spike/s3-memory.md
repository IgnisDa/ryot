# S3 memory admission

**Status:** approved and implemented through slice M-S4: lane-mode memory plans, the interactive
headroom predicate, lazy reclaim, lane transient pools and the lane-fair writer. Durable fair
selection, CPU admission, HTTP tickets and benchmark statistics are separate S3 decisions
([s3.md](s3.md)). Units are MiB;
G = `SANDBOX_WORKER_CONCURRENCY` = 2 on the canonical host.

## Decisions

- Non-workflow executions bind no lifecycle-write capability; those run only through durable workflow
  dispatch (M9).
- The workflow body's decoded journal and inline entries stay outside the sandbox budget. This is an
  accepted residual: S3 bounds the sandbox path, not whole-backend memory.
- The canonical benchmark sets `SANDBOX_MEMORY_BUDGET_MIB` to half of effective memory (≈1,904 MiB on
  the measured 3,809 MiB host). The default stays the smaller of 1,536 MiB and half.
- The replay journal is served lazily from chunked Redis entries (M4).
- Per-script limits are 64 MiB heap and 16 MiB external for every kind. The measured maximum is
  19.7 MiB heap and 1.9 MiB external (system/full provider); a journal entry and its durable host
  response are capped at 12 MiB, and parsing very large HTTP or durable responses fails at the limit.
- Every run draws transient permits from the pool of the lane it was reserved with (§8); shared mode
  maps both lanes to one pool.
- Sandbox `executeRyotql` results are capped at 1 MiB of JSON across the document, measured by
  PostgreSQL before rows are returned (Vmax = k × 1 MiB = 27 MiB). Capabilities with no
  pre-materialization bound (`listIntegrations`, entity and event schemas, current integration, user
  settings, plugin config, OAuth token) neither bind live nor settle inline; the workflow body
  dispatches them.

## 1. Defects in the S2 accounting

| ID  | Gap                                                                                                                                                                                                                                                                                                                                                                                                                                                      | Evidence                                                                                                                                      |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| A1  | Near-heap-limit callback adds 2 × 32 MiB heap headroom; not in backend reservation, Rust `MemoryBudget`, or `maxRss`                                                                                                                                                                                                                                                                                                                                     | `sandboxd/src/execute.rs:38-39,474-484`; `server.rs:140-142`; `sidecar-admission.ts:15,363`; `sidecar-supervisor.ts:512-517`                  |
| A2  | Decoded untrusted JSON charged at byte size (≈10–25× real). Reader parses raw frames twice (`sidecar-framing.ts:244`, `:281`); prefix decoded twice (`workflow-journal.ts:120`, `host-call-gate.ts:141`) and serialized twice more (`service.ts:124,145-153`); args decoded, re-serialized and contract-decoded (`host-call-gate.ts:612,617`, `bridge-adapter.ts:83,96`)                                                                                 | as listed                                                                                                                                     |
| A3  | Strings 2 bytes/char; JSON escaping expands control chars 6× (`\u00XX`) and serialization happens before the size check (`host-call-gate.ts:167-176,206-214`)                                                                                                                                                                                                                                                                                            | as listed                                                                                                                                     |
| A4  | Inline evidence grows to ≤100 MiB unreserved; decoded again at done                                                                                                                                                                                                                                                                                                                                                                                      | `host-call-gate.ts:566-597`; `service.ts:131`; `sidecar-supervisor.ts:401`                                                                    |
| A5  | Host-result chain: value, two serializations, Schema.Json copy, logical JSON, payload, all base64 parts at enqueue, `.slice` per write; Rust preallocated assembly + `RawValue` + `String`                                                                                                                                                                                                                                                               | `host-call-gate.ts:206-238`; `sidecar-framing.ts:405-430,542,575-582`; `protocol.rs:817`; `execute.rs:284`                                    |
| A6  | Backend accepts 8 pending calls per run (4 active + 4 waiting); honest maximum is 4 slotted + 1 inline                                                                                                                                                                                                                                                                                                                                                   | `sidecar-supervisor.ts:404`; `host-call-gate.ts:358`; `execute.rs:36,311,323-345`                                                             |
| A7  | Retire purges only run frames; queued host results still written, then assembled/decoded by Rust                                                                                                                                                                                                                                                                                                                                                         | `sidecar-framing.ts:489-514`; `server.rs:237-286`                                                                                             |
| A8  | Before `drop(runtime)`, Rust filters the done string by UTF-16 length (≤ RESULT_BYTES + 1), converts it lossily to UTF-8 (≤3 bytes/unit, ≈18 MiB) and copies it again (`payload.to_owned()`); the byte check runs after the drop. Several more copies follow after the drop; backend done decode charged 2 × 6 only                                                                                                                                      | `execute.rs:536,550,610-620`; `server.rs:49-69`                                                                                               |
| A11 | An inline batch has no request-count cap and `settleInline` holds every settled result until the batch ends; the 10 MiB reply check runs after settlement (50 maximum `httpCall`s ≈ 1,000 MiB held)                                                                                                                                                                                                                                                      | `sidecar-protocol.ts:188-190`; `durable-host-dispatcher.ts:901-916`; `host-call-gate.ts:515,549-555`; `limits.ts:19`                          |
| A9  | A live lifecycle write would wait for a nested sandbox run while holding its slot and memory: `createEvents` → `EventCreateWorkflow` (awaited) → before-policy `executePolicy` → `AutomationRunWorkflow` → sandbox execution. Production never binds it live: the durable queue is the only runtime caller and always passes `workflowExecutionId`, so only `log` and `span` are live. The live path without a workflow ID exists only in test harnesses | `host-functions.ts:615-627`; `modules/events/event-create-workflow.ts:52-66`; `modules/sandbox/durable-queues.ts:150-158`; `service.ts:57-66` |
| A10 | Honest host-result assemblies can exceed Rust `ASSEMBLY_BYTES` (64 MiB/connection) under round-robin writes; failed non-run assemblies are dropped silently                                                                                                                                                                                                                                                                                              | `sidecar-framing.ts:552-562`; `sandboxd/src/server.rs:28,244-246,294-298`                                                                     |

Accepted residual: the workflow body keeps decoded journal and inline entries for the
workflow's lifetime (`sandbox-script-workflow.ts:747-779,850-852`), and queue results persist inline
entries (`durable-queues.ts:43-49`). Plugin-shaped values can make this large. It is outside the
sandbox budget; S3 does not claim whole-backend memory safety. Follow-up: workflow-body admission
or encoded retention.

## 2. Accounting basis (M1)

- Every term is a reachable-bytes upper bound for the worst legal input: strings at 2 bytes/char,
  byte arrays at length, JSON text at its escaped length, decoded untrusted graphs at a calibrated
  factor `k` per JSON byte covering the whole decode path (every copy from text to the host-function
  call or to the decoded done response), never JSON.parse alone. The backend runs on Bun, so `k` is
  measured in JavaScriptCore: `json_graph_factor_bounds_pathological_decode_paths` decodes 1 MiB
  pathological argument shapes in a fresh process and measures at most 26.7 (arrays of empty arrays
  or objects). The contract uses k = 27.
- Escaped length is computed by a non-allocating walk before any serialization, aborting at the cap.
  The existing caps keep their meaning (they are already measured on serialized UTF-8).
- Unreachable memory counts as released (GC timing not modelled). Reservations are admission bounds;
  S4 adds cgroups.
- A1 charged: isolate term 64 + 16 + 64 = 144. Rust reports its heap headroom in `ready`; the backend
  rejects a generation whose heap + external + headroom exceeds the reserved term. Rust `MemoryBudget`
  per isolate and `maxRss` include the headroom.

## 3. Capability exposure (M9)

- Every production execution runs through `SandboxExecutionQueue` with a `workflowExecutionId`
  (`modules/sandbox/durable-queues.ts:150-158`), binds only `log` and `span` live, and dispatches
  other capabilities durably after the replay ends; inline settlement accepts only `activity`
  capabilities, which neither start workflows nor need another sandbox slot.
- Executions without a workflow ID bind live only capabilities whose `SANDBOX_DURABLE_HOST_DISPATCH`
  strategy is `activity` or `diagnostic`, plus file grants. `selectSandboxHostFunctions` enforces this
  so a future live caller cannot hold resources while a workflow-dispatched capability waits.
- Script kind does not determine execution mode, so manifests are not restricted by kind.

## 4. Representation changes (M2)

1. Host-call args travel base64-encoded (UTF-8 JSON bytes) in the frame. Bound: 1 MiB args → 1.34 MiB,
   within the unchanged 2 MiB host-call cap. The reader holds bytes/base64 text only; args are decoded
   once, under the call's transient permit. Done values stay as raw JSON (decoded after isolate drop,
   §6) so the 6 MiB done cap and 4 MiB result limit are unchanged.
2. The reader parses each raw frame once.
3. Host results: escaped-length walk → reject over cap without allocating → serialize the result frame
   once to UTF-8 bytes (no Schema.Json copy, no re-serialization) → drop the value. The writer keeps
   payload bytes and base64-encodes one part at flush time; writes use `subarray`, not `slice`.
4. `retire(handle)` purges unstarted messages for the handle. A started host result completes; a
   started run stops after its current part, and the cancel that always precedes that retirement makes
   the sidecar discard the handle's partial assemblies, so no assembly is abandoned. The completion
   signal that releases a transient permit lands with the pool in M-S2.
5. Rust delivers a host result with one native copy: the assembled buffer becomes the V8-bound string
   (borrowed `RawValue` validation).
6. Rust measures the done string's UTF-8 length without allocating (V8 UTF-8 length) and rejects it above
   `RESULT_BYTES` before materializing; it materializes once (no `payload.to_owned()` copy).
7. Before `settle`, the gate computes Σ Vmax over the batch's requests; a batch whose sum exceeds the
   inline value allowance (80) defers before any activity runs. Legal larger batches take the durable
   path, which already handles every request.
8. Per-handle inbound bound: 5 outstanding host calls (4 slotted + 1 inline) and 1 done. The supervisor
   decrements `pending` before enqueueing the reply (fixes the send-before-decrement race at
   `sidecar-supervisor.ts:440-466`). Excess marks that run invalid and cancels it; only framing-level
   violations restart the generation.

## 5. Ownership table

### 5.1 Per-run execution reservation E = 298 (M3)

Acquired atomically with the execution slot and any process start (approved `reservePrefix`); held
until disposal is confirmed.

| Term                                           | MiB | Allocation                                                                                                                                        | Peak simultaneous copies                                                                                                                          | Handoff                                                                                                                                                                                                             | Release                         |
| ---------------------------------------------- | --: | ------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------- |
| Isolate heap + external + headroom             | 144 | Rust `execute.rs:434-484`                                                                                                                         | heap ≤ 128, ArrayBuffers ≤ 16                                                                                                                     | At done receipt (runtime dropped at `execute.rs:536` before `finish`): covers Rust post-drop done copies and backend done decode (done ≤ 6 MiB raw ×2 bytes/char + k × 4 MiB result ≈ 120, the floor for this term) | Run finalizer after disposal    |
| S2 fixed (stack, diagnostics, scratch staging) |  15 | S2                                                                                                                                                | as S2                                                                                                                                             | —                                                                                                                                                                                                                   | finalizer                       |
| Run start                                      |  28 | Backend invocation + module (≤2) + logical JSON (≤8) + payload (4) + queued frames (≤6); Rust `Box<Run>` (4) + input clone (2) + loader clone (1) | Backend ≤ 20 until the last frame is written; Rust ≤ 8 until `execute` returns                                                                    | —                                                                                                                                                                                                                   | finalizer                       |
| Inbound host-call frames                       |  20 | Frame bytes (≤2) + base64 args text (≤1.4) + envelope, per outstanding call                                                                       | 5 outstanding                                                                                                                                     | Args bytes → gate (decoded under the transient permit)                                                                                                                                                              | Per call, when dispatch returns |
| Rust host-call encode/outbox                   |  25 | `outbox.rs:135-156`                                                                                                                               | 4 slotted + 1 inline × ≈5                                                                                                                         | —                                                                                                                                                                                                                   | Chunk written                   |
| Rust host-result delivery                      |  60 | Assembly preallocated at part 0 (`protocol.rs:817`), moved into the V8-bound string                                                               | 4 slotted results parked in oneshots while the isolate blocks in `inlineBatch` (`execute.rs:323-345`, `server.rs:283-285`) + 1 inline reply, × 12 | —                                                                                                                                                                                                                   | Op returns (V8 copy made)       |
| Rust done text before drop                     |   6 | One UTF-8 copy after the non-allocating length check (M2.7)                                                                                       | 1 × 6                                                                                                                                             | —                                                                                                                                                                                                                   | `drop(runtime)` / finish        |

### 5.2 Lane transient pool

Acquired by the gate after sequence/budget checks and before args decode or host invocation, for the
whole amount at once, FIFO within the lane partition. Released only after the host function's native
work settles (non-abortable operations awaited uninterruptibly, like the approved ioredis read) and
after the result's last frame is written or purged.

| Unit                       |            MiB | Contents                                                                                                                                                                                                                                                                 |
| -------------------------- | -------------: | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| H (ordinary call, default) |             80 | Args graph k × 1 (24) + value ≤ Vmax (default 20) + one frame serialization ≤ 10.1 escaped MiB as string (21) + payload (11) + margin                                                                                                                                    |
| J (`journalRead`)          |              8 | One 1 MiB chunk string (2) + slice bytes (1) + base64 (1.4) + frame string/payload (≈3.4)                                                                                                                                                                                |
| I (`inlineBatch`)          |            170 | Batch args graph (24) + Σ Vmax ≤ 80 (enforced before settle, M2.8) + reply serialization (21) + payload (11) + evidence upper bound 3 × 11 (33), reserved before `settle`; afterwards it shrinks to 3 × actual evidence, which stays charged to the run's lane partition |
| Declared small units       | per capability | `log`, `span`, cache (≤256 KiB), scratch (≤256 KiB), artifact slice (≤1 MiB)                                                                                                                                                                                             |

Dependence on k (M1): E does not depend on k (args graphs are charged in permits). H(k) = k + 56 and
I(k) = k + 145 (H = 83, I = 172 at the measured k = 27). The approved contract allows k ≤ 40; §8 shows
the canonical arithmetic for that range. If calibration yields k > 40, M-S1 stops and returns recomputed
arithmetic for re-approval before M-S2 starts.

Vmax (M3): each live capability declares a retained-result bound enforced before materialization (for
example, `httpCall` reads ≤10 MiB raw, which decodes to ≤10 M chars, ≤20 MiB). A capability that cannot
bound its result before materialization cannot use the default H; implementation either adds a
pre-materialization bound with a test or stops and reports (`executeRyotql` with fan-out is the first
item to verify).

### 5.3 Inline evidence (M5)

I is reserved from the run's lane partition before `settle`. If it cannot be reserved, the batch
defers before any activity runs (no duplicated side effects). After validation, the reservation
shrinks to 3 × actual encoded evidence (retained bytes, done-time text, queue-result serialization),
which stays charged to the same lane partition until the queue result is returned. The handoff never
needs new capacity after side effects, so it cannot fail. Accumulated evidence reduces the room for the
next batch's I; once it does not fit, later batches defer before settlement. Legal inline evidence held
at once per run is therefore (P − I) / 3 for its lane's pool P; with k = 27 that is (232 − 172) / 3 ≈
20 MiB at 1,536 and above for the interactive pool, and 8 MiB for the background pool at 1,536. Both
pools are at least I in lane mode, so an interactive run's first batch settles inline. The queue result carries inline entries as encoded
JSON text; the workflow body decodes them as before (accepted residual).

### 5.4 Processes and per-connection transport

Resident core 2 × 128; lazy 128 each (values unchanged). Permits charge the call's actual argument
bytes. The lane pools together admit up to five maximum host results (60 MiB), which with journal or
artifact slices and run frames can exceed the sidecar's 64 MiB `ASSEMBLY_BYTES` on one connection.
The backend writer therefore starts a chunked message only while the chunked messages already in
flight on that connection fit `ASSEMBLY_BYTES`; socket order makes that count exact. Non-interactive
messages leave one maximum host result (12 MiB) free for interactive results.

## 6. Acquisition, handoff and release sequence

1. Durable worker: inspect pins (approved) → ticket {slot, E, process start} atomically; waiters hold
   nothing (approved) → script load → run.
2. Lazy processes: background-started processes never consume interactive headroom. At most one
   interactive-started lazy process holds the interactive headroom's process share; a second interactive tier waits for
   reclaim of an idle one (drained, exit confirmed, bounded by the 2 s disposal limit). Idle processes
   are reclaimed only when an admission cannot otherwise fit (M7).
3. Host call: permit → decode args → host function → escaped-length check → one serialization →
   enqueue → release on last frame written or purge, after native settlement.
4. Inline batch: reserve I → settle → validate → shrink to evidence → append.
5. Done: the isolate share is reused for done decode. E is released by the finalizer after done (or
   generation exit confirmation), gate close, writer completion for the handle, and release of every
   call permit of the run.
6. Journal: no per-run journal term (§7).

## 7. Lazy chunked journal (M4)

- Redis layout per execution key: metadata field `m:<i>` = byte length, chunk count, SHA-256 of the
  entry text (computed by the backend at append); chunk fields `c:<i>:<n>` of exactly 1 MiB except the
  last. Append Lua writes metadata and chunks atomically and never overwrites differing content
  (divergence error, as today). Keys, schemas and Lua stay in Redis infrastructure.
- Inspection reads metadata only (≤1,000 entries, approved bounds) and pins it. Each `journalRead`
  returns at most the remainder of one chunk; Lua re-checks the entry's pinned metadata and that
  chunk's length on every read. Missing metadata/chunk → `projectionMissing`; changed metadata →
  fail closed. The read budget charges fetched bytes.
- Authority: the backend validates entries at append (they are the workflow body's validated journal).
  The isolate bootstrap validates schema and index on read (`isolate-invocation.ts:533-551`). The
  workflow body stays authoritative by checking replay envelopes against its own journal
  (`sandbox-script-workflow.ts:352-385`). The pinned journal source records a run-level
  `missing`/`changed`/`failed` fault that the queue worker applies over the isolate's outcome, so these
  cannot be reported as plugin-catchable script failures.
- The backend never decodes or retains the prefix; `pinHash` uses the pins and inline `firstIndex` uses
  the pinned count. `SandboxRunInput.replayJournal` becomes a pinned journal source.
- Existing behaviour retained: entries are reassembled in the isolate through 1 MiB reads (2,048
  reads, 200 MiB). The reassembly buffer is external memory; entries are capped at 12 MiB so one
  always fits the 16 MiB external limit.

## 8. Admission predicate, modes and budget arithmetic (G = 2)

**Static carve-outs** (fixed at boot): resident core processes 256 and the transient pools. Lane mode
has P_int and P_bg, each at least I; shared mode has one pool P = I. Pools are caps on concurrent permit holdings
(including inline evidence), checked FIFO within each pool; they are never lent across lanes.

**Dynamic region** D = budget − 256 − pools. It holds every admitted run's E and every started lazy
process's 128 (charged at start, kept while running or idle, released after exit confirmation; idle
processes are reclaimed only when an admission cannot otherwise fit, M7). Let `usedD` be the current
sum of those holdings.

**Predicate** (one atomic check in `reservePrefix`, together with the execution slot):

- interactive request of size a (E, plus 128 if its process must start): `usedD + a ≤ D`;
- background request: `usedD + a ≤ D − max(0, (E + 128) − heldInt)`, where `heldInt` is the E of
  admitted interactive runs plus the bytes of lazy processes started for interactive work
  (lane mode only; in shared mode the subtracted term is 0).
  Because the pools are static and each pool is at least its largest unit, every admitted run can always
  obtain any permit eventually (§10).

**Modes (M10)**, selected at boot and recorded in metrics and startup logs:

- Lane mode when D ≥ 2 × (E + 128) with both pools ≥ I, that is budget ≥ 256 + 2I + 852. Then
  P_int = min(budget − 256 − 852 − I, I + 60), P_bg = min(budget − 256 − 852 − P_int, I + 60) and D
  takes the rest; the cap keeps at most two ordinary results per lane (§5.4) and 20 MiB of inline
  evidence.
- Shared mode when budget is below that and ≥ 256 + I + E + 128; P = I; no interactive reservation.
  The S3 latency guarantee is claimed only in lane mode.
- Typed boot failure below 256 + I + E + 128.

At k = 27 (I 172, E 298):

|            Budget | Mode                 |                           D | Outcomes (every admitted state ≤ budget)                                                               |
| ----------------: | -------------------- | --------------------------: | ------------------------------------------------------------------------------------------------------ |
|               800 | boot failure (< 854) |                           — | typed configuration error                                                                              |
|               964 | shared               |                         536 | one run on a resident core or with a lazy process; never two                                           |
|             1,094 | shared               |                         666 | two core runs (596); one lazy + one core run (724) waits                                               |
|             1,452 | lane                 |   852 (P_int 172, P_bg 172) | background run with lazy (426) plus interactive headroom (426) always held; inline evidence capacity 0 |
|   1,536 (default) | lane                 |   852 (P_int 232, P_bg 196) | as 1,452, with 20 MiB of interactive and 8 MiB of background concurrent inline evidence                |
| 1,904 (canonical) | lane                 | 1,184 (P_int 232, P_bg 232) | as 1,536, with 20 MiB of concurrent inline evidence per lane and 332 MiB of spare D                    |

As functions of k (k ≤ 40 allowed): lane threshold = 1,398 + 2k (1,452 at k = 27, 1,478 at k = 40);
capped P = k + 205; canonical D = 1,238 − 2k. Spare D beyond 2 × (E + 128) admits more runs only
when G is raised (scheduling decision).

Shared mode remains a lower-throughput configuration under honest accounting: at the 1,536 default, two
executions run concurrently only when both use resident core processes. Maximum legal journals do not
change any row. In lane mode with G = 2, background admits one run at a time; one tenant's long replay
then occupies background capacity until fair scheduling bounds it.

## 9. Cancellation and crash

| Event                                        | Behaviour                                                                                                                                                                                      |
| -------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Admission waiter interrupted                 | Holds nothing; counters released once (approved).                                                                                                                                              |
| Journal inspection/read interrupted          | Held until the ioredis reply settles (approved); per-read J the same.                                                                                                                          |
| Host call interrupted                        | Abortable work aborted; non-abortable native work awaited uninterruptibly; unstarted result messages purged and an in-progress message completed; permit released after both.                  |
| Inline batch interrupted before/after settle | I held until settlement finishes; evidence account released with the run.                                                                                                                      |
| Done / cancel / limit                        | Isolate share reused for done decode; E released by the finalizer once all conditions in §6.5 hold.                                                                                            |
| Sidecar crash or backstop                    | Generation close waits exit confirmation (existing); runs' E and the process reservation are released only after that; reader/writer cleared.                                                  |
| Per-handle bound exceeded                    | That run marked invalid and cancelled; framing desync restarts the generation (existing).                                                                                                      |
| Backend restart                              | In-memory reservations vanish with the process; Redis projection and durable queue unaffected.                                                                                                 |
| Compromised sidecar                          | Sidecar-process memory is unbounded until S4 cgroups. Backend-side memory per run stays within E + permits; an early done adds at most one done decode (≈110) while the run's E is still held. |

## 10. Deadlock prevention

Order: L0 durable worker slot → L1 admission ticket (slot + E + process) → L2 lane transient permit
→ L3 database dispatch permit (S2).

- No wait on a lower-numbered resource while holding a higher-numbered one.
- With M9, live L2 holders run only `activity`/`diagnostic`/file implementations, inventoried and
  tested not to await workflows or sandbox admission. Workflow-only writes run after the replay has
  ended and released L1/L2.
- Inline reservation is try-only and taken before side effects; deferral never waits.
- Each partition ≥ its largest single request (boot check); holders finish independently of same-lane
  waiters, so every waiter proceeds.
- Lazy reclaim stops only processes with no runs; admitted runs are never preempted.
- Not solved by memory admission (prerequisites for the S3 goal, owned by the scheduling decision):
  L0 capture by one tenant's durable backlog, and tenant fairness inside a lane (one user can hold
  the interactive headroom and the bounded waiter positions).

## 11. Acceptance tests (memory)

| Requirement                                                                                                                                                                                                                                                                                                                                    | Test                                                                                                    |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| Interactive run admitted while background holds E, its lazy process, a maximum response and a maximum journal                                                                                                                                                                                                                                  | `interactive_memory_headroom_preserves_existing_execution_limits`                                       |
| Non-workflow executions bind no workflow-only capability; workflow executions dispatch them durably                                                                                                                                                                                                                                            | `non_workflow_executions_expose_only_resource_free_capabilities`                                        |
| Permits cover maximum results and 4 concurrent calls; release after the last frame is written                                                                                                                                                                                                                                                  | `host_call_permits_cover_maximum_results_until_written`                                                 |
| Escape-heavy and invalid-UTF-8 `httpCall` bodies rejected or charged without exceeding H                                                                                                                                                                                                                                                       | `escaped_host_results_stay_within_transient_permits`                                                    |
| Cancelled calls keep permits until native completion; results purged or completed                                                                                                                                                                                                                                                              | `cancelled_host_calls_release_permits_after_native_completion`                                          |
| Inline reservation before settle; deferral causes no repeated external call                                                                                                                                                                                                                                                                    | `inline_batches_reserve_before_settlement_and_defer_without_side_effects`                               |
| Lazy journal: pinned chunks, single large entry, changed/missing chunk, ignored suffix, fetched-byte budget, gate override flag                                                                                                                                                                                                                | `lazy_journal_reads_serve_pinned_chunks_without_backend_prefix`                                         |
| Divergent chunk/metadata appends rejected                                                                                                                                                                                                                                                                                                      | `journal_projection_rejects_divergent_chunk_appends`                                                    |
| Args decoded only under permit; whole decode path within k                                                                                                                                                                                                                                                                                     | `host_call_args_decode_under_transient_permit`                                                          |
| `k` calibration over pathological shapes across the whole decode path (forced-GC heap measurement in a dedicated test); asserts calibrated k ≤ 40                                                                                                                                                                                              | `json_graph_factor_bounds_pathological_decode_paths`                                                    |
| Done decoded only after isolate drop; per-handle bounds; honest maximum concurrency under cancellation does not trip them                                                                                                                                                                                                                      | `done_decode_reuses_disposed_isolate_reservation`, `per_handle_bounds_admit_honest_maximum_concurrency` |
| Rust single-copy delivery; assemblies stay below `ASSEMBLY_BYTES` with lane pools                                                                                                                                                                                                                                                              | `host_result_delivery_keeps_one_native_copy`, `lane_pools_keep_rust_assemblies_within_connection_bound` |
| Writer purges unstarted results on retire; cancel discards partial run assemblies                                                                                                                                                                                                                                                              | `writer_retire_purges_unstarted_results`, `cancel_discards_partial_run_assemblies` (Rust)               |
| Heap headroom included in backend, Rust budget and `maxRss`; boot rejects mismatch                                                                                                                                                                                                                                                             | `isolate_reservation_includes_near_heap_limit_headroom`                                                 |
| Idle lazy reclaim; background starts never consume the interactive headroom                                                                                                                                                                                                                                                                    | `lazy_processes_preserve_interactive_headroom`                                                          |
| Lock order                                                                                                                                                                                                                                                                                                                                     | `memory_lock_order_prevents_admission_deadlock`                                                         |
| Exactly-once release across cancel/overload/startup/disposal/recovery                                                                                                                                                                                                                                                                          | `fair_admission_releases_tickets_and_reservations_exactly_once`                                         |
| Per-execution peak heap and external memory reported in done and recorded by kind/tier, including for limit, cancel and termination outcomes                                                                                                                                                                                                   | `execution_usage_reports_peak_heap_and_external_memory`                                                 |
| Oversized inline batches (50 maximum `httpCall`s; maximum `executeRyotql`) defer before any activity; accepted batches never exceed I                                                                                                                                                                                                          | `inline_batches_bound_held_results_before_settlement`                                                   |
| Evidence accumulates in the lane partition; the next batch defers before settlement once I no longer fits                                                                                                                                                                                                                                      | `inline_evidence_exhaustion_defers_before_settlement`                                                   |
| Rust done text: 6 Mi BMP 3-byte characters and lone surrogates rejected or held within the 6 MiB term before drop                                                                                                                                                                                                                              | `done_text_is_measured_before_materialization` (Rust)                                                   |
| Rust delivery with 4 parked slotted results plus an inline reply stays within the 60 MiB term                                                                                                                                                                                                                                                  | `parked_results_and_inline_reply_fit_delivery_term` (Rust)                                              |
| Boot mode and predicate at budgets 800, 964, 1,094, 1,452, 1,536, 1,904 match §8, including two core-process runs and a waiting lazy-plus-core pair at 1,094 and the P_bg cap at 1,904; background work is admitted and completes in shared mode                                                                                               | `admission_mode_follows_budget_and_admits_background_work`                                              |
| Interactive permit acquisition, host call, journal read and result delivery complete while background holds all of P_bg, an inline settlement is in progress and maximum background results are queued on the same connection; fails if interactive permits come from P_bg or wait behind background writer traffic beyond one frame per round | `interactive_host_calls_progress_while_background_transient_capacity_is_exhausted`                      |

Plus `bun run check`, `bun turbo --filter='!@ryot-app/e2e' test`, affected e2e files (`enqueue`,
`sidecar-recovery`, `async-flow`, and the inline/journal and lifecycle e2e files touched by M9), Rust
tests and the Linux launcher suite.

## 12. Implementation slices

Order: M-M, M-S0, M-S1, M-S2, M-S3, M-S4.

Each slice ends with check/test/affected e2e and a `[v8-isolates-s3]` commit. Every item is owned by
exactly one slice. The canonical budget configuration lands in M-S4.

| Slice | Owns                                                                                                                                                                                                                                                                                                                                            | Prerequisites                                                   | Stops                                                                 |
| ----- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- | --------------------------------------------------------------------- |
| M-M   | M11 usage measurement: Rust records per-execution peak V8 heap and peak external (ArrayBuffer high-water) memory and reports them in the done frame; backend histograms by script kind, trust tier and snapshot tier; a benchmark-host run of real workloads (media search/details per tier, import population, fixtures) reporting p50/p99/max | none                                                            | none                                                                  |
| M-S0  | M9 capability exposure guard                                                                                                                                                                                                                                                                                                                    | none                                                            | none                                                                  |
| M-S1  | M1 (basis, escaped-length walk, A1 headroom in backend/Rust budget/`maxRss`, k calibration); M2.1–M2.7 (args base64, single parse, single serialization and lazy base64, retire purge, Rust single-copy delivery, per-handle bounds and pending race, Rust done measurement)                                                                    | none                                                            | calibrated k > 40 (return recomputed arithmetic for re-approval)      |
| M-S2  | M3 (E = 298, lane pools H/J/I, Vmax inventory and enforcement); M2.8 (inline Σ Vmax cap); M5 (inline reserve before settle, evidence in the partition)                                                                                                                                                                                          | M-S0 (M9 must land before any L2 permit or E change, §10), M-S1 | a live capability cannot bound its result before materialization      |
| M-S3  | M4 (lazy chunked journal, fetched-byte budget, gate override flag)                                                                                                                                                                                                                                                                              | M-S2 (J permits)                                                | chunked reads cannot stay fail-closed and immutable                   |
| M-S4  | M7 (lazy reclaim), M8 (interactive headroom predicate), M10 (modes), canonical budget configuration, memory acceptance                                                                                                                                                                                                                          | M-S2, M-S3                                                      | lane mode cannot hold the canonical topology at the configured budget |

Scheduling (lanes, durable fair selection, CPU, HTTP tickets, benchmark statistics) follows with its own
approvals; the tenant-fairness prerequisites in §10 belong there.
