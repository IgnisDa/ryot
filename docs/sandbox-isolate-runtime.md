# Sandbox Isolate Runtime Plan

**Status:** S1 is implemented in `kernel/sandboxd` (see [S1 results](#s1-results)); S2–S6 are reviewed
and approved one at a time before they start.
Replaces the single-use Deno process per replay with V8 isolates hosted by long-lived, OS-confined
native sidecars.

## Outcome

Plugin and kernel sandbox scripts run in a fresh V8 isolate created from a kernel-built startup
snapshot inside `ryot-sandboxd`, a Rust process that holds no secrets and no filesystem, network, or
database access. Deno is removed from the image. Users keep uploading private plugins without
administrator involvement; first-party `media` and `fitness` plugins run through the same boundary.

Success means, on the canonical 2 vCPU / 4 GB host:

- no-op execution under 30 ms p50 and under 20 MiB per concurrent execution;
- every script is stopped at its CPU, wall-clock, heap, and external-memory limits without affecting
  neighbours, and no reachable API allocates memory outside those limits;
- interactive executions stay within 10% of their unloaded latency while background work saturates
  the CPU;
- the standard provider import completes faster and with lower peak memory than today, with identical
  business rows;
- every protection in [Carried Protections](#carried-protections) has a named test.

## Evidence

A spike compared today's model (fresh `deno run` per execution with production flags) against a
`deno_core` 0.412 sidecar that restores a startup snapshot of the runtime payload and creates one
isolate per execution. Both ran identical workloads on a fresh 2 vCPU / 4 GB host; host calls were
answered after 25 ms. 7,880 of 7,880 executions succeeded across two consistent repetitions.

| Workload / concurrency       | Sidecar runs/min, p50, RSS | Deno per process runs/min, p50, RSS |
| ---------------------------- | -------------------------- | ----------------------------------- |
| No-op / 1                    | 3,565, 15 ms, 101 MiB      | 751, 80 ms, 48 MiB                  |
| No-op / 20                   | 7,329, 154 ms, 330 MiB     | 1,630, 727 ms, 913 MiB              |
| 5 host calls / 20            | 5,383, 209 ms, 428 MiB     | 1,571, 764 ms, 971 MiB              |
| 5 host calls / 100           | 6,720, 807 ms, 1,399 MiB   | not runnable on the host            |
| CPU-heavy / 20               | 175, 7.1 s, 1,611 MiB      | 133, 9.3 s, 3,041 MiB               |
| Real 270 KB media script / 1 | 31 ms p50                  | 101 ms p50                          |

The Deno baseline omits the production runner, HTTP bridge, and schema validation, so it understates
today's cost; neither side includes Bun, the workflow engine, or PostgreSQL.

Snapshot contents dominate per-isolate cost (5 host calls, concurrency 100):

| Snapshot             | Size    | Heap per isolate | Peak RSS  | Runs/min |
| -------------------- | ------- | ---------------- | --------- | -------- |
| Full runtime payload | 12.6 MB | 12.7 MiB         | 1,411 MiB | 6,535    |
| Without youtubei     | 8.0 MB  | 8.1 MiB          | 998 MiB   | 9,515    |
| Effect only          | 5.6 MB  | 6.0 MiB          | 765 MiB   | 11,890   |

A soak of 10 waves of 500 executions at concurrency 20 held sidecar RSS at 216–225 MiB after each
wave with no upward trend; after 60 s idle it returned to 111–117 MiB in nine waves and stayed at
225 MiB in one, so idle release is not guaranteed.

The spike stopped infinite loops at a 2 s CPU budget, heap growth at a 64 MiB cap, and 750 MiB
ArrayBuffer allocation at its cap, all without affecting 20 concurrent neighbours; today's model has
no CPU limit, lets heap grow to ~382 MiB before V8 aborts, and lets the ArrayBuffer allocation succeed.
Lowering background-lane thread priority kept interactive latency at its unloaded level while
background CPU work saturated both cores, with no loss of background throughput.

The spike's `deno_web` surface is **not** the target: `Blob`, `MessagePort`, `BroadcastChannel`, and
object URLs reach ops that copy data into Rust memory outside every limit.

## Decisions

- **One isolate per execution.** Contexts sharing an isolate share one heap limit and leak state.
- **Trust tiers:** a system sidecar for first-party plugins and kernel scripts and a user sidecar for
  uploaded plugins. The tier comes from the validated execution principal, never from archive metadata.
  The supervisor supports several user-tier instances.
- **Shared user tier, residual risk accepted:** isolates of different users share one user-tier address
  space, so a V8 memory-safety bug or a Spectre-class leak can cross users, where today separate
  processes prevent it. OS confinement, coarse timers, no `SharedArrayBuffer` or `WebAssembly`, and
  periodic restarts reduce but do not remove this. Per-user sidecars remain a supervisor sharding
  setting for deployments where untrusted users share an instance.
- **Snapshot tiers:** the compiler already knows each script's runtime imports. Each script is paired
  with the smallest kernel-built snapshot covering them, so most scripts avoid youtubei and cheerio.
- **Snapshot tiers are separate processes.** The prebuilt V8 shares one read-only heap per process, so
  isolates restored from different snapshots cannot coexist in one process. S6's V8 sandbox also
  requires a shared read-only heap, so this stays.
- **TurboFan disabled** (`--no-turbofan`). `TerminateExecution` does not interrupt TurboFan-optimized
  loops that call builtins such as `Array.prototype.fill`; pure `rusty_v8` repro:
  [denoland/rusty_v8#2088](https://github.com/denoland/rusty_v8/issues/2088). Maglev remains enabled and
  was not slower on the measured CPU workload. The flag carries a TODO comment linking that issue.
- **Process backstop:** engine termination cannot be proven complete, so the sidecar exits when an
  isolate ignores termination past a grace period, and the backend kills a sidecar that misses a
  deadline.
- **Small, explicit web surface,** narrower than the Deno globals plugins see today. Globals that reach
  unmetered native memory are removed rather than reimplemented. External traffic stays on `httpCall`; only
  the `full` snapshot tier, which youtubei needs, adds heap-backed `fetch`, `Response`, `Request`,
  `Headers`, and `ReadableStream` whose requests become `httpCall` host calls.
- **File access stays in the backend.** Artifact range reads and scratch writes become host requests
  served per execution handle.
- **The compiler stays in the CLI.** Isolate boundary and backend policy enforce capabilities, so
  unverified archive metadata can only narrow grants.
- **Durable replay stays.** Replays cost milliseconds. S5 lets waits shorter than a threshold settle in
  the live isolate; longer waits end the replay as today.
- **Rust lives in `kernel/sandboxd`,** a Cargo crate built from source with a toolchain pinned by
  `rust-toolchain.toml`; `rusty_v8` prebuilt static libraries keep builds short.
- **V8's built-in sandbox is deferred to S6.** It needs V8 built from source and forbids the counting
  ArrayBuffer allocator. S1 ships the prebuilt V8 without it and measures whether V8's own accounting
  can enforce the off-heap cap.
- **Fairness unit is the human user.** System-plugin work on a user's behalf counts against that user;
  each plugin is capped within a user; user-less system work is its own capped tenant. Interactive
  work is admitted first, with a reserved background share.

## Architecture

### Process topology

One sidecar process runs per trust tier × snapshot tier, each with its own memory budget. A sidecar
loads exactly one snapshot and rejects runs for any other tier. `core` sidecars stay resident; `data`
and `full` sidecars start lazily and stop after an idle period.

### Sidecar isolate surface

An explicit allowlist defines every global and every op reachable from an isolate. The sidecar uses
`deno_core` with a minimal Ryot extension instead of `deno_web`; any web API it keeps is implemented
per isolate, holds no shared resource, and either lives on the V8 heap or is metered.

- **Globals:** language built-ins, `URL`, `URLSearchParams`, `TextEncoder`, `TextDecoder`, `atob`,
  `btoa`, `structuredClone`, `setTimeout`/`clearTimeout`, `queueMicrotask`, `AbortController`,
  `AbortSignal`, `performance.now` (coarsened in the user tier), `crypto.getRandomValues` and
  `crypto.randomUUID` (OS-backed), and `console` routed to a bounded per-execution collector. The `full`
  tier adds the youtubei surface described in S1.
- **Absent:** `Deno`, `fetch` and streams outside the `full` tier, `Blob`, `File`, `MessageChannel`, `BroadcastChannel`, object
  URLs, `SharedArrayBuffer`, `Atomics`, `WebAssembly`, and code generation from strings, disabled by
  V8 flags where V8 supports it rather than by deleting globals.
- **Ops:** S1 publishes the registered-op inventory; any op not on the allowlist fails the build.
- **Modules:** only the inline plugin module and snapshotted runtime modules resolve; `ext:`, `data:`,
  `file:`, and remote specifiers are rejected at resolution.

### Sidecar limits and lifecycle

- **Snapshot:** built at image build time from the trusted runtime payload, digest-verified at
  startup. Building it deletes `Error.stackTraceLimit` (V8 otherwise duplicates it on restore) and
  must not create objects backed by native `cppgc` resources. Each isolate reseeds randomness.
- **Execution:** each job gets a pooled OS thread and a fresh isolate; V8 requires isolates on a
  thread to be dropped in reverse creation order. Thread stack size exceeds V8's stack limit.
- **Limits:** V8 heap limit with a near-heap-limit callback that terminates; a counting ArrayBuffer
  allocator; a cap on V8-reported external memory; thread CPU metering; a script-time deadline
  enforced in the sidecar and backstopped by the backend. Termination is re-requested until the
  isolate stops, then escalates to process exit.
- **Admission inside the sidecar:** a CPU-active cap near the core count, a memory budget reserving
  each admitted isolate's heap, external-memory, and run-frame size, per-lane thread priority, and a
  capped V8 platform thread pool. Isolates parked on host calls do not count against the CPU cap.
- **Recycling:** sidecars drain and restart after an execution count or RSS threshold, which also
  re-randomizes memory layout.
- **Crash attribution:** the sidecar reports the execution that caused an escalation exit (S1). The
  backend supervisor re-runs a crashed sidecar's unattributed in-flight executions one at a time to find
  the culprit, keeps collateral executions' retry budgets, backs off restarts, and quarantines the
  uploader and plugin in the user tier or the triggering user or job in the system tier (S2).

### OS confinement

`ryot-sandboxd` runs as its own UID with an empty environment, inherits only a socketpair, sets
`no_new_privs`, is non-dumpable with core dumps disabled, and applies a seccomp filter denying internet
sockets, `execve` after startup, `ptrace`, `process_vm_*`, `userfaultfd`, `io_uring`, `bpf`,
`perf_event_open`, `mount`, `unshare`, namespace-creating `clone`, all `clone3`, and every x32-ABI
syscall on x86_64, plus a deny-all Landlock policy verified inside the sidecar after loading the snapshot.
Deployments add cgroup `memory.max`, `pids.max`, and CPU weight, and a high `oom_score_adj`. Linux
production fails closed when confinement cannot be applied; macOS development runs unconfined.

### Protocol

One inherited socketpair per sidecar with length-framed messages: run, host call, host result,
cancel, and done, plus ready, draining, and fatal lifecycle frames and part frames for chunking. Every frame carries the sidecar generation, an opaque execution handle assigned by
the backend, and a call sequence. Per-type size caps are checked before allocation on both sides;
large payloads are chunked so one execution cannot block the connection. Frames for unknown or retired
handles are dropped, results are delivered at most once, and late frames after cancel are discarded.
A well-framed invalid payload fails only its execution; a framing desync restarts the sidecar. Queues
are bounded with backpressure.

### Backend host-call gate

Everything a sidecar emits is untrusted. Rust binds each isolate to its handle, and no op accepts an
execution identity, grant, or limit from JavaScript. The backend gate keeps every check that
`BridgeService` performs today: handle lookup and expiry, the host-call budget, the per-execution
function allowlist from `selectSandboxHostFunctions`, request and response size caps, four concurrent
calls per execution, cancellation of in-flight calls when the execution ends, and generation-aware
replacement. Inline-batch validation and host-recorded inline entries stay in the backend and are never
echoed back by the sidecar.

### Backend changes

- `SandboxProcessManager`, `BridgeService`, `PackageCacheManager`, Deno flag construction, and the
  stdin/stdout transport are replaced by the sidecar client, supervisor, and host-call gate.
- The runner's semantics move into the isolate bootstrap: input and output validation, the durable
  host and journal replay, the workflow determinism guard, and bounded diagnostics. Inline batch
  settlement stays synchronous so script fibers freeze while the backend settles.
- Artifact range reads and scratch chunk writes are host requests; the scratch quota is enforced at
  write time. Grant-carrying executions no longer need a dedicated process and settle inline like any
  other execution.
- The replay journal is supplied lazily or counted against the memory budget.
- Stack sanitization and the context, result, log, and request limits stay.

## Carried Protections

| Today                                                                  | Plan                                                      |
| ---------------------------------------------------------------------- | --------------------------------------------------------- |
| One process per replay, killed on every exit path                      | Guaranteed isolate disposal, per-isolate state            |
| Deno denies run, env, FFI, write, npm, remote, config                  | Op allowlist plus OS confinement                          |
| Read and network limited to grants and the bridge                      | No sidecar filesystem or network; files served by backend |
| Environment limited to `PATH` and `DENO_DIR`                           | Empty environment                                         |
| Bridge token, expiry, budget, concurrency, size caps, allowlist, close | Backend host-call gate                                    |
| 30 s script-time timeout pausing during inline settlement              | Sidecar deadline with backend backstop                    |
| Grant path validation, scratch quota, symlink rejection, named harvest | Backend file service with write-time quota                |
| Bounded stderr tail, OOM-victim preference                             | Per-execution console collector, sidecar OOM preference   |
| Request 2 MiB, context 64 KiB, result 4 MiB                            | Protocol size caps                                        |
| Module SHA-256 and runtime payload verification                        | Module hash checks and snapshot digest                    |

## Security Review Dispositions

A pre-approval security review produced these findings.

| Finding                                                           | Disposition | Owner                                       |
| ----------------------------------------------------------------- | ----------- | ------------------------------------------- |
| `deno_web` globals reach unmetered native memory and shared state | FIX         | Sidecar isolate surface, S1                 |
| Execution identity and `BridgeService` checks unspecified         | FIX         | Backend host-call gate, S2                  |
| Granted-path file access unenforced                               | FIX         | File access in the backend, S2              |
| Sidecar OS confinement unspecified                                | FIX         | OS confinement, S1 and S2                   |
| Cross-user exposure in a shared user tier                         | FIX         | Residual risk accepted with mitigations, S1 |
| No wall-clock deadline                                            | FIX         | Sidecar limits, S1; backend backstop, S2    |
| Protocol framing, attribution, and backpressure                   | FIX         | Protocol, S1                                |
| Crash attribution and quarantine                                  | FIX         | Culprit reporting S1; supervisor S2         |
| S2 had no admission bound                                         | FIX         | S2                                          |
| Unrouted `console` methods reach shared stderr                    | FIX         | Sidecar isolate surface, S1                 |
| Crash-resistance probes                                           | FIX         | S1 acceptance                               |
| Tier routing must come from the execution principal               | FIX         | Trust tiers, S2                             |
| Snapshot digest, module hashes, stack sanitization                | FIX         | Sidecar limits and lifecycle, S1; S2        |
| OS-backed randomness and per-isolate reseeding                    | FIX         | Sidecar isolate surface, S1                 |
| Shared V8 platform threads escape CPU metering and priority       | FIX         | Admission inside the sidecar, S1            |
| Inline settlement must stay synchronous                           | FIX         | Backend changes, S2                         |
| Journal and run frame outside the memory budget                   | FIX         | Backend changes, S2                         |
| Rule for grant-carrying executions                                | FIX         | Backend changes, S2                         |
| Memory growth over time                                           | FIX         | Recycling, S1                               |
| Per-tenant fairness for global HTTP admission                     | FIX         | S3                                          |
| One connection's large frames block others                        | FIX         | Protocol chunking, S1                       |
| Fairness gaming with many accounts where signup is open           | DEFER       | Open Risks                                  |
| Repeated exploit attempts against one long-lived memory layout    | FIX         | Recycling, S1                               |
| Host-call latency as a cross-tenant timing signal                 | FIX         | Coarse timers, S1                           |
| macOS development has no seccomp or Landlock                      | DEFER       | OS confinement; production fails closed     |

## Implementation Brief

This section is for the agent implementing a slice. Implement **only the slice you were assigned**,
starting with S1; later slices are outlines and need their own review.

### Read first

1. The repository rules in `AGENTS.md` and every `AGENTS.md` under directories you touch. They govern
   comments, version constants, imports, Effect usage, tests, and the done criteria.
2. This document, in full, including [Security Review Dispositions](#security-review-dispositions): every
   row owned by your slice is a requirement.
3. `kernel/backend/src/lib/infrastructure/sandbox-runtime/README.md` and `packages/sandbox-compiler/README.md`
   for today's runtime, limits, capabilities, and format-1 modules.
4. [`sandbox-isolate-runtime-spike/`](sandbox-isolate-runtime-spike/README.md) for working `deno_core`
   0.412 API usage. It is throwaway code and omits the required hardening.

### Pitfalls found by the spike

- `deno_core` with `default-features = false` must enable `v8` explicitly, or `deno_v8` fails to build.
- `JsRuntime::new` must run inside a Tokio runtime context; V8 posts delayed tasks during restore.
- V8 enters an isolate when it is created and requires isolates on one thread to be dropped in reverse
  creation order, so a thread hosts one live isolate at a time.
- Writing `Error.stackTraceLimit` while building a snapshot corrupts it: restore aborts with
  `Check failed: LinearSearch(*desc->GetKey(), descriptor_number) == InternalIndex::NotFound()`. Effect
  writes it whenever `Effect.fn` or `Effect.withSpan` runs at module top level, which fflate's SDK
  wrapper does. Delete the property immediately before `snapshot()`.
- `TerminateExecution` is ignored by TurboFan-optimized loops calling builtins such as
  `Array.prototype.fill` ([denoland/rusty_v8#2088](https://github.com/denoland/rusty_v8/issues/2088));
  run V8 with `--no-turbofan` and keep the TODO linking that issue. `--no-maglev` does not help.
- `deno_core` cancels a pending termination when it converts an exception to an error, so the watchdog
  must keep re-requesting termination until the isolate stops.
- `--no-expose-wasm` is rejected by this V8 build; find the supported flag or remove `WebAssembly`
  during lockdown, and prove it with the surface test.
- The spike's snapshot was built from a context with `WebAssembly` present, so flags applied only at
  serve time do not remove globals already in the snapshot.
- Thread CPU time comes from `pthread_getcpuclockid` on the isolate's thread; time parked on host calls
  is not counted.
- V8 counts ArrayBuffer memory toward heap pressure: in the spike the heap limit, not the counting
  allocator, stopped the 750 MiB ArrayBuffer probe.
- `deno_core`'s snapshot builder runs V8 with `--predictable --random-seed=42`; verify isolates reseed.
- Bun's `socket.write` can write a large frame partially; the S2 client must queue the remainder and
  flush on `drain`.
- Benchmark scripts must never `pkill -f` or `pgrep -f` a pattern that also appears in their own command
  line.

### Constraints

- Ryot is greenfield: no compatibility paths, fallbacks, or kept Deno code once S2 removes it.
- No lint suppressions or type-bypassing casts without asking the user.
- Stop and report at any of your slice's **Stops** instead of working around them.
- Benchmark thresholds are measured on a fresh 2 vCPU / 4 GB x86_64 Linux host that the user provides;
  ask for it when you reach the benchmark.

### Done

A slice is done when every acceptance item has a named, passing test, `bun run check` and
`bun turbo --filter='!@ryot-app/e2e' test` are clean, the slice's CI jobs pass, and the
`.agents/skills/codebase-cleanup` skill has been run. Report each acceptance item with its test name and
result, any acceptance item you could not prove, and every deviation from this document.

## Slices

Each slice is approved separately. S3–S6 are outlines until their predecessor lands.

### S1 — Sidecar runtime

- **Outcome:** `ryot-sandboxd` evaluates format-1 modules and runs test entry points on three snapshot
  tiers with the surface, limits, lifecycle, confinement, and protocol above, tested standalone.
- **Execution contract:** a run frame carries the execution handle, tier, module source and SHA-256,
  JSON input, limits (heap, external memory, CPU, deadline), and lane. The sidecar verifies the hash,
  creates an isolate from the tier, and evaluates the module. When the default export is a function, it
  calls it with the input and a host object whose calls become host-call frames; the done frame carries
  the JSON result or a structured failure naming the phase or limit. Format-1 definitions such as
  `defineProvider` are evaluated but not invoked; runner semantics arrive in S2.
- **Tiers:** `core` holds Effect and ryotql; `data` adds fflate, papaparse, fast-xml-parser, and
  cheerio; `full` adds youtubei. The run frame names the tier, and any import outside it fails at
  resolution. Choosing a script's tier from compiler metadata is S2.
- **Payload input:** `kernel/backend/tooling/sandbox-runtime.ts` also writes the runtime payload files
  and import map to `kernel/sandboxd/payload/` (generated, ignored by Git). The crate's build reads them
  and emits `core`, `data`, and `full` snapshots plus a digest manifest.
- **youtubei surface:** the `full` tier installs heap-backed `Response`, `Request`, `Headers`, and
  `ReadableStream`, and a `fetch` whose requests become `httpCall` host calls, from
  `kernel/sandboxd/js/`.
- **Protocol source of truth:** an Effect Schema module at
  `kernel/backend/src/lib/infrastructure/sandbox-runtime/sidecar-protocol.ts`. Frames are a 4-byte
  big-endian length followed by JSON. A generator writes valid and invalid example frames from the schema
  to `kernel/sandboxd/protocol-fixtures/`; Rust tests and a TypeScript test both decode and re-encode
  every fixture, and `check` fails when the fixtures are stale against the schema.
- **Build and CI:** the crate joins the Bun workspace through `kernel/sandboxd/package.json`, whose
  `check` runs `cargo fmt --check` and `cargo clippy -D warnings` and whose `test` runs `cargo test`, so
  `bun run check` and `bun turbo --filter='!@ryot-app/e2e' test` cover it. Linux-only confinement tests
  are compiled only on Linux.
  - _Input ordering:_ the package declares workspace dependencies on `@ryot-app/kernel-backend`,
    `@ryot-app/media-plugin`, and `@ryot-app/fitness-plugin`, so turbo's `^build` produces the payload and
    both plugin archives first. `turbo.json` adds `$TURBO_ROOT$/kernel/sandboxd/payload/**` to the
    `@ryot-app/kernel-backend#build` outputs so a cache hit restores the payload.
  - _CI:_ `.github/workflows/sandboxd.yml` triggers on pushes and pull requests touching
    `kernel/sandboxd/**`, the protocol module, `kernel/backend/tooling/**`, `packages/sandbox-sdk/**`,
    `plugins/media/**`, or `plugins/fitness/**`. On `ubuntu-24.04`, `ubuntu-24.04-arm`, and `macos-14`
    it installs Bun and the pinned Rust toolchain, runs `bun install` and
    `bun turbo build --filter=@ryot-app/kernel-backend --filter=@ryot-app/media-plugin --filter=@ryot-app/fitness-plugin`,
    then runs `cargo test`, with confinement tests on the Linux runners only.
- **Benchmark:** a script in `kernel/sandboxd/bench/` runs on a fresh 2 vCPU / 4 GB x86_64 host. Its
  thresholds gate S1 acceptance; CI runners do not match the host and do not gate on them.
- **Non-goals:** runner semantics (definition invocation, validation, durable replay), backend
  integration, image changes, cross-user fairness.
- **Prerequisites:** approval of this plan.
- **Measurements for S6:** whether V8's heap and external-memory accounting alone stops ArrayBuffer and
  other off-heap abuse at the per-execution cap.
- **Acceptance:** each item is a named test.
  - _Execution:_ on each tier a fixture module returns its expected JSON, including one whose host calls
    a stub host answers; every compiled backend module in the built `media` and `fitness` archives
    evaluates on its covering tier; on `full`, a youtubei client is constructed against fixture
    responses served through stub `httpCall` results; a module importing outside its tier is rejected
    at resolution; a sidecar rejects runs for any tier other than its own.
  - _Surface:_ the op inventory matches the allowlist; every absent global is absent; every `console`
    method reaches the per-execution collector and nothing reaches stderr; `performance.now` is coarsened
    in user-tier mode; two isolates produce different random sequences.
  - _Limits:_ loops, `fill` loops, heap growth, ArrayBuffers, and external-memory abuse are contained;
    termination escalates and deadlines expire, with the culprit reported before exit; deep recursion,
    nested `JSON.parse` and `structuredClone`, catastrophic regular expressions, large single
    allocations, `Map`, `Set`, and string growth, and long `sort`, `join`, and `replaceAll` do not crash
    the process; `ext:`, `data:`, `file:`, and remote imports are rejected at resolution.
  - _Admission and lifecycle:_ the V8 platform pool is capped; the CPU-active cap and memory budget queue
    excess runs; background-lane threads run at lower priority; the sidecar drains and restarts at its
    execution-count and RSS thresholds.
  - _Integrity:_ startup rejects a snapshot whose digest does not match the manifest; a run whose module
    hash does not match fails.
  - _Protocol:_ fixtures conform on both sides; forged and retired handles, late frames after cancel, and
    duplicate results are dropped; oversize frames are rejected before allocation; a desync restarts the
    sidecar; a well-framed invalid payload fails only its execution; bounded queues apply backpressure; a
    chunked large payload does not delay another execution's frames; interleaved executions of different
    principals are attributed correctly.
  - _Confinement (Linux):_ file opens, internet sockets, `execve`, `ptrace`, `process_vm_readv`,
    `userfaultfd`, `io_uring_setup`, `bpf`, `perf_event_open`, `mount`, and `unshare` are denied;
    `no_new_privs` is set; the process is non-dumpable with an empty environment; Landlock is active after
    snapshot load; startup fails when confinement cannot be applied.
  - _Build caching:_ after `bun turbo build --filter=@ryot-app/kernel-backend`, deleting
    `kernel/sandboxd/payload/` and rerunning the same command replays it from the turbo cache, and a later
    `cargo test` builds the snapshots.
  - _Benchmark:_ on the reference host, `core` tier no-op p50 is under 30 ms and per-execution RSS under
    20 MiB.
- **Rollback:** delete `kernel/sandboxd`, `.github/workflows/sandboxd.yml`, `sidecar-protocol.ts` and its
  test, the payload output step in `tooling/sandbox-runtime.ts`, and the `$TURBO_ROOT$/kernel/sandboxd/payload/**` entry in `turbo.json`.
- **Stops:** prebuilt V8 unavailable for a required target; the runtime payload needs a global or op
  that cannot be metered; snapshot restore fails beyond the known workarounds.

#### S1 results

Every acceptance item has a named, passing test in `kernel/sandboxd` (and
`sidecar-protocol.test.ts` for the TypeScript side). `bun run check` and
`bun turbo --filter='!@ryot-app/e2e' test` are clean. [The `sandboxd.yml` CI run](https://github.com/IgnisDa/ryot/actions/runs/37474652008)
passes on `ubuntu-24.04` (x86_64), `ubuntu-24.04-arm`, and `macos-14`; both Linux confinement suites pass
all five tests, including x32 and namespace-clone denial and in-sidecar Landlock verification.

| Area                    | Tests                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Execution               | `each_tier_runs_its_fixture_module`, `host_calls_are_answered_by_the_stub_host`, `plugin_archive_modules_evaluate_on_their_covering_tier` (219 modules), `youtubei_client_is_constructed_through_http_call_host_calls`, `imports_outside_the_tier_are_rejected_at_resolution`, `runs_for_any_other_tier_are_rejected`                                                                                                                                                                                                                                                                                                                               |
| Surface                 | `op_inventory_matches_allowlist`, `absent_globals_are_absent`, `every_console_method_reaches_the_collector`, `console_output_never_reaches_stderr`, `performance_now_is_coarsened_in_the_user_tier`, `isolates_produce_different_random_sequences`                                                                                                                                                                                                                                                                                                                                                                                                  |
| Limits                  | `loops_and_fill_loops_are_stopped_at_the_cpu_limit`, `heap_growth_is_stopped_at_the_heap_limit`, `array_buffers_and_external_memory_are_contained`, `termination_escalates_with_the_culprit_reported_before_exit`, `uninterruptible_allocation_escalates_with_the_culprit_reported_before_exit`, `a_stopped_run_waiting_for_a_cpu_slot_is_not_escalated`, `deadlines_expire_while_host_call_waits_do_not_count`, `crash_probes_do_not_crash_the_process`, `oversized_results_and_host_arguments_fail_inside_the_heap`, `script_errors_and_results_stay_bounded_before_reaching_rust`, `ext_data_file_and_remote_imports_are_rejected_at_resolution` |
| Admission and lifecycle | `v8_platform_pool_is_capped`, `the_cpu_active_cap_queues_excess_runs_but_not_parked_ones`, `the_memory_budget_queues_excess_runs`, `background_lane_threads_run_at_lower_priority`, `the_sidecar_drains_and_restarts_at_its_execution_count`, `the_sidecar_drains_and_restarts_at_its_rss_threshold`                                                                                                                                                                                                                                                                                                                                                |
| Integrity               | `startup_rejects_a_snapshot_whose_digest_does_not_match`, `a_run_whose_module_hash_does_not_match_fails`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| Protocol                | `protocol_fixtures_conform`, `forged_retired_and_foreign_generation_frames_are_dropped`, `late_frames_after_cancel_are_discarded`, `duplicate_results_are_dropped`, `read_frame_rejects_oversize_lengths_before_reading_the_payload`, `oversize_frames_are_rejected_before_allocation_and_desync_restarts_the_sidecar`, `a_well_framed_invalid_payload_fails_only_its_execution`, `bounded_queues_apply_backpressure`, `a_chunked_large_payload_does_not_delay_another_executions_frames`, `interleaved_executions_are_attributed_correctly`                                                                                                        |
| Confinement (Linux)     | `confinement_denies_files_sockets_and_dangerous_syscalls`, `the_sidecar_serves_while_confined_with_an_empty_environment`, `startup_fails_when_confinement_cannot_be_applied`                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| Build caching           | the `sandboxd.yml` step that deletes the payload and replays it from the turbo cache                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |

- **Benchmark** on the reference host (x86_64, 2 vCPU, 3.8 GB, Ubuntu 26.04): `core` no-op p50 7.10 ms,
  6.36 MiB per execution across 50 live isolates; sidecar RSS 51.6 MiB idle, 369.7 MiB with 50 isolates.
- **S6 measurement:** with the counting allocator cap raised to its maximum, V8's heap and
  external-memory accounting still stopped retained ArrayBuffer growth
  (`v8_accounting_stops_array_buffer_growth_without_the_allocator_cap`).
- **Worker panics:** release and test profiles specify abort; because Cargo's test harness ignores
  that setting, the sidecar also installs a panic hook that exits the process and reports the active
  execution (`worker_panic_reports_the_execution_and_ends_the_process`).
- **Confinement:** `landlock_is_verified_inside_the_running_sidecar` checks native file-open denial
  during sidecar startup and rejects startup when enforcement is bypassed. Namespace `clone` calls
  and x32 syscalls return `EPERM`; `clone3` returns `ENOSYS` so glibc can create threads through `clone`.
- **Deviations from this plan:**
  - Snapshot tiers run as separate processes (see [Decisions](#decisions)).
  - The protocol adds `ready`, `draining`, `fatal` (naming the culprit), and `part` frames.
  - The deadline excludes time waiting on host calls.
  - The `full` tier also installs `EventTarget`, `Event`, `CustomEvent`, and `crypto.subtle.digest`,
    which youtubei needs while loading.
  - V8 runs with `--single-threaded`, so GC and compilation stay on the metered isolate thread; the
    platform pool keeps deno_core's cap of min(cores, 4).
  - Each lane has its own worker pool, because an unprivileged thread cannot raise its priority back.
  - V8 builtins that never check for termination, such as `fill` on a huge sparse array or one giant
    `replaceAll`, cannot be stopped in-process; they end in the attributed exit (fatal frame, exit 70).

### S2 — Backend integration

- **Outcome:** every sandbox execution runs through `ryot-sandboxd`; the Deno path is deleted.
- **Scope:**
  - sidecar client, host-call gate, and backend file service;
  - supervisor with restart backoff, one-at-a-time re-runs of unattributed crashes, collateral retry
    protection, and quarantine;
  - runner bootstrap port: definition invocation, input and output validation, durable replay;
  - per-script tier selection from compiler-derived runtime imports;
  - tier routing from the execution principal;
  - routing runs on trust tier × snapshot tier, with lazy start and idle stop of `data` and `full`
    sidecars;
  - a global execution bound and memory-budget admission preserving database pool headroom;
  - building `ryot-sandboxd` and its snapshots in the single-arch image and in the local build used by
    backend tests and e2e, with the sidecar UID so confinement applies;
  - metrics, and removal of Deno from the image along with Deno services, the generated runner, and limits.
- **Non-goals:** lanes, per-user fairness, short-wait settlement, multi-arch and deployment sizing,
  fan-out reduction.
- **Prerequisites:** S1.
- **Acceptance:** every row in [Carried Protections](#carried-protections) has a named test; a
  user-scope revision cannot reach the system sidecar; `bun run check` and
  `bun turbo --filter='!@ryot-app/e2e' test` are clean; affected sandbox, media, and fitness e2e files
  pass, including YouTube Music provider scripts; killing a sidecar mid-import recovers durably; a user
  plugin that repeatedly crashes the user sidecar is quarantined without exhausting other users'
  executions; the built image runs sandbox scripts with confinement applied; a fresh 2 vCPU / 4 GB host runs the standard
  provider import with identical business rows, lower wall time, and lower peak memory than today.
- **Rollback:** revert the slice.
- **Stops:** a sandbox capability that cannot be expressed within the surface allowlist.

### S3 — Scheduling and fairness

- **Outcome:** interactive and background lanes, and per-user and per-plugin fairness for all
  executions and for global HTTP admission slots.
- **Acceptance:** with background imports saturating the CPU, interactive search and details stay
  within 10% of their unloaded latency end to end; one user's saturating plugins do not delay another
  user's executions beyond their fair share.

### S4 — Image and deployment

- **Outcome:** multi-arch images, cgroup limits, and Compose, Helm, and Fly sizing from S2 and S3
  measurements.

### S5 — Replay tuning

- **Outcome:** waits shorter than a threshold, including matched HTTP rate-limit slots, settle in the
  live isolate.

### S6 — V8 sandbox hardening

- **Outcome:** the sidecar runs on a source-built V8 with its sandbox and pointer compression enabled,
  confining V8 memory corruption away from sidecar state and halving isolate memory.
- **Scope:** cached source builds of the pinned V8 for Linux amd64/arm64 in CI, replacing the counting
  ArrayBuffer allocator with V8 accounting, and convert the seccomp denylist to an allowlist.
- **Prerequisites:** S1's accounting measurement shows the off-heap cap holds without the allocator.
- **Acceptance:** the S1 containment, escape, and crash suites pass unchanged; per-isolate heap falls
  measurably.

Fan-out reduction, batching automation runs per plugin revision, is a separate track measured after
S2, when workflow-engine rows become the dominant per-import cost.

## Follow-ups

- Remove `--no-turbofan` and its TODO once
  [denoland/rusty_v8#2088](https://github.com/denoland/rusty_v8/issues/2088) is fixed upstream and the
  termination suite passes without it.
- S6: V8 sandbox and pointer compression on a source-built V8.
- Fan-out reduction track after S2.
- Switch the user tier to per-user sidecars if a deployment hosts mutually untrusted users.
- S2 must keep each lane's outstanding runs within its threads plus queue: the sidecar stops reading
  while a lane queue is full, which also holds back host results and cancels.
- A caught rejected dynamic import makes a later evaluation error report the `resolution` phase.
- Rust counts host-call name length in code points and TypeScript in UTF-16 units.

## Open Risks

- **V8 termination:** depends on `--no-turbofan` until upstream fixes the hole; the backstop covers
  unknown cases. Re-run the termination, escape, and crash suites on every `deno_core` or V8 upgrade.
- **Memory at high concurrency:** 6–14 MiB per live isolate depending on snapshot tier until S6 adds
  pointer compression.
- **Uninterruptible builtins:** a builtin that never checks for termination exits the whole sidecar,
  taking its neighbours' executions with it; S2's supervisor re-runs them.
- **Fairness gaming:** per-user fairness can be gamed with many accounts where signup is open.
