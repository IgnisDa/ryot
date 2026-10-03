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
    it installs Bun and the pinned Rust toolchain, caches the Cargo registry and compiled dependencies
    per runner and Rust dependency/toolchain inputs, runs `bun install` and
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
- **Status:** approved contract.
- **Prerequisites:** S1 and approval of this contract. The three open S1 follow-ups below are part of S2.
- **Scope:** backend transport, supervision, admission, host-call and file policy, runner bootstrap,
  compiler-derived snapshot routing, single-architecture builds, crash recovery, metrics, and Deno
  removal. Existing workflows, capability policy, host implementations, artifact ownership, and
  database/Redis replay persistence remain the authorities.
- **Non-goals:** S3 lane classification, fairness or HTTP scheduling; S4 multi-architecture images and
  deployment/cgroup sizing; S5 new short-wait settlement; S6 source-built V8; fan-out reduction. S2
  sends runs on the `interactive` lane and enforces admission for both protocol lanes. It preserves
  today's activity-only inline settlement, including HTTP policy deferral.

#### Completion requirements for runtime bindings and limits

S2 cannot be marked complete until these requirements hold in the integrated execution path:

- **Database connection binding:** `db/session.ts` must use supported connection/driver APIs for
  physical connection reservation and nested reuse. Do not fabricate a `PgClient` with
  `Object.assign`, copy its identity onto a generic `SqlClient`, or supply stubbed methods. Prove
  pool headroom through `sandbox_dispatch_preserves_database_pool_headroom`.
- **Dependency bootstrap:** `sandbox-sdk/src/dependency-runtime.ts` must fail closed when its trusted
  binding is missing. Remove the direct-operation fallback. Ordinary execution retains OS-backed
  randomness through the configured non-workflow binding. Verify missing initialization and the
  existing determinism behavior.
- **Filesystem binding:** replace `isolate-invocation.ts`'s configurable
  `globalThis[Symbol.for("@ryot-app/sandbox-sdk/filesystem")]` bridge with a sealed, execution-scoped
  SDK binding. Keep artifact/scratch authority in the backend gate and preserve the approved global
  surface. Verify binding replacement rejection and execution isolation through real definitions.
- **Memory ceilings:** use allocation accounting and boundary tests for journal replay and artifact
  assembly. Fixed per-entry, cache, or artifact-size ceilings cannot substitute for that proof.
  Preserve the existing journal/response
  contracts; reject an individual value only when it cannot fit its reserved memory. Cover split
  entries, escaped/multibyte values, concurrent reassembly, and cleanup under the approved budgets.
- **Deno removal:** complete the deletion inventory, including duplicate runner/payload generation,
  runtime materialization, configuration, tooling and tests. No Deno execution fallback or retained
  compatibility path may remain.

#### Module and ownership contract

All backend modules below live in `kernel/backend/src/lib/infrastructure/sandbox-runtime/`.
Services use Effect constructors and feature-owned Layers; platform socket/process callbacks are
the native Promise boundary. `layer.ts` composes them; server boot only supplies installation paths.

| Module                  | Responsibility and replacement                                                                                                                                                                                                                                                  |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `sidecar-protocol.ts`   | Sole wire schema, strict codecs, bounded bootstrap/control payloads and fixtures; Rust consumes matching fixtures. No protocol or artifact version bump.                                                                                                                        |
| `sidecar-client.ts`     | One socketpair connection per generation; incremental framing, chunk assembly, bounded fair writes, partial-write remainder and `drain`, handle/sequence demultiplexing and cancellation. Replaces stdin/stdout and localhost HTTP transport in `runtime.ts`.                   |
| `sidecar-supervisor.ts` | `SandboxSidecarSupervisor`: trust × snapshot processes, generation ownership, lazy start, idle stop, drain/recycle, deadlines, crash probes, restart backoff and quarantine. Replaces `SandboxProcessManager` and its single-use/warm pools.                                    |
| `sidecar-admission.ts`  | Global execution and byte reservations, plus per-instance/per-lane outstanding counters. No second durable job queue.                                                                                                                                                           |
| `host-call-gate.ts`     | `SandboxHostCallGate`: trusted execution registrations, function selection, budgets, expiry, four concurrent calls, inline validation/settlement and host-owned inline records. Replaces `BridgeService`, bearer tokens and HTTP status handling.                               |
| `file-service.ts`       | `SandboxFileService`: execution-scoped artifact descriptors, bounded range reads, quota-reserved scratch writes and named harvest. Uses `filesystem-grants.ts`, `artifacts.ts` and `artifact-staging.ts`; replaces captured Deno file APIs and post-run-only quota enforcement. |
| `snapshot-tier.ts`      | Maps audited per-script runtime imports onto the smallest covering kernel snapshot; no capability or trust elevation.                                                                                                                                                           |
| `service.ts`            | Keeps `SandboxService.run` and its structured result, diagnostics and timing surface; prepares a trusted registration, admits and invokes the supervisor, validates results and harvests files.                                                                                 |

`PackageCacheManager`, `RunnerFile`, runtime dependency materialization/repair and execution module
hard links disappear. Module bytes come from the pinned database artifact and are hash-checked before
send and inside Rust. Garbage collection keeps database script/reference liveness but deletes its
compiled-file cache dependency and file sweep. Snapshot verification belongs to sidecar startup;
there is no replacement runtime package cache. Generic process sampling and bounded stream helpers
stay only where the new runtime or compiler uses them.

#### Execution and runner contract

1. `SandboxService` validates the pinned principal, context and compiled format, verifies module SHA-256,
   selects the tier, and prepares grants without opening a transaction across execution. The backend
   creates a fresh opaque handle, scoped to one sidecar generation and replay attempt. JavaScript
   never chooses that handle, grants, trust tier, limits, uploader or plugin identity.
2. A run carries the existing module, tier, lane and limits plus a schema-validated invocation in
   `input`: context, script ID, persisted manifest/execution metadata, compiled format, pinned start
   time, optional workflow ID, selected function names, inline-capability hints and journal length.
   It contains no token, API URL, filesystem path, credential or full journal. Keep the invocation
   at 2 MiB, the complete context at 64 KiB and module source at 1 MiB; the encoded run must also fit
   S1's 4 MiB message cap. Wire/chunk/base64 overhead is counted separately in admission.
3. Port reusable runner logic into `kernel/backend/src/lib/infrastructure/sandbox-runtime/isolate-bootstrap.ts`
   and `isolate-utilities.ts`; tooling bundles it into generated `kernel/sandboxd/payload/runner.mjs`.
   `kernel/sandboxd/build.rs` includes that trusted bootstrap in each snapshot. Capture trusted
   intrinsics at snapshot build, but configure all mutable state per isolate at run time. Preserve
   the `Error.stackTraceLimit` deletion before snapshot creation. Do not snapshot execution data or
   native resources. S1's function-default fixture entry point stays confined to standalone tests;
   production requires a format-1 `ryot:sandbox-script` definition.
4. Before importing the plugin, install the workflow determinism guard and the approved-dependency
   deterministic wrapper. Keep today's rejection of ambient `Date()`/`new Date()`, random APIs,
   `performance.now` and `Temporal.Now` where present, `Date.now()` returning zero, the Effect Clock
    pinned to `startedAt`, and the wrapper's execution-seeded randomness and fixed time. Do not weaken
    the guard to accommodate a library. Ordinary non-workflow execution retains OS-backed randomness.
    The SDK dependency wrapper and trusted runner share the sealed
    `@ryot-app/sandbox-sdk/dependency-runtime` module in every snapshot. The compiler externalizes this
    binding; snapshot bootstrap configures it once before any plugin can execute. Scripts cannot replace
    it. It adds no global property, Symbol bridge, native op or ambient authority.
5. Import only the inline module and covering snapshot modules. Check the default definition shape,
   authored manifest against persisted metadata, and execution metadata. Decode input with its
   Effect Schema, call `definition.run(input, host, execution)`, require an Effect, distinguish typed
   failure from defects, decode output and require JSON. Preserve `load`, `input`, `execute` and
   `output` diagnostics and durable `completed`/`failed`/`pending` envelopes, request prefixes,
   detached-work rejection, journal-length checks and child input/output validation. S1 infrastructure
   failures remain separate from runner failures; the backend maps them to structured existing error
   surfaces and never trusts a sidecar's proposed authority.
6. Keep stable request identity and argument hashing, recorded successes and failures, pinned child
   targets, deferred completion slots, projection-missing repair and exactly the enqueued journal
   prefix. Recorded calls never repeat dispatch. PostgreSQL remains authoritative; Redis remains
   reconstructible. Preserve at-least-once external mutation semantics across the uncommitted crash
   window rather than claiming exactly-once delivery.
7. Serve the validated, already-loaded replay prefix through internal `journalRead` requests for
   bounded UTF-8 byte slices (at most 1 MiB decoded per response), with total length and entry offsets
   pinned by the host. The bootstrap reads entries on demand; an individual large entry may span
   requests. Keep the 100 MiB journal ceiling without enlarging the 12 MiB host-result cap. Requests
   cannot name another journal or read a suffix. Bound this internal channel to 2,048 reads and
   200 MiB decoded bytes per replay; reject repeated-read abuse without dispatching a script call.
   Account for the retained backend prefix, encoded
   copies and isolate reassembly; inability to fit one legal entry in its reserved heap fails that
   execution before dispatch. Internal journal reads have bounded sequences/bytes, not a new SDK
   capability or another charge against the script's 1,000 durable-step budget.
8. Add an allowlisted synchronous `inlineBatch` host op, backed by the existing framed call/result
   channel. It blocks the isolate's OS thread without running JavaScript, microtasks, timers or
   Effect fibers; Rust releases its CPU-active slot and script-time meter while parked. The socket
   reader and host dispatcher remain independent of that thread, and cancellation wakes it. The
   backend validates indices, identities, argument hashes, bytes, allowlist, budgets and activity-only
   dispatch with the existing `dispatchSandboxHostActivity` path. Matched or unresolved HTTP policy,
   non-activity work, over-limit batches and dispatch failure defer the whole batch as today.
   Grants no longer disable inline settlement. Eligibility hints from the isolate never authorize it.
9. The backend records inline entries itself and returns only settlement values/defer to the isolate.
   The final sidecar value cannot supply or overwrite inline evidence. The workflow validates the
   host-recorded entries against the returned requests before journaling them. A crash discards
   uncommitted inline records and replays from durable state; committed entries are not redispatched.
10. Keep the 30 s script-time budget and pause it during validated inline settlement. S1 currently
    excludes all host waits: S2 narrows this to inline settlement only, so ordinary host calls,
    journal reads and timers still use today's wall/script-time budget. CPU metering continues to
    exclude parked time. Both Rust and backend enforce the same remaining script-time budget;
    cancellation is followed by a 2 s termination grace and process kill if disposal is not confirmed.
    Inline batches have a separate 30 s settlement ceiling and the run a finite 5 minute absolute
    backstop that never pauses. Gate expiry moves only by actual validated inline settlement time.
11. Keep bounded console/log/span collection, the truncation marker, output size checks before native
    serialization, source-mapped authored paths and stack sanitization. Strip inline module URLs,
    runtime/bootstrap paths, handles, IDs and secrets. Success, pending, failure, timeout and cancel
    all retire the handle, interrupt host calls, discard late frames and dispose the isolate before
    releasing admission; uncertain disposal kills the generation.

The registered-op inventory and protocol fixtures must include synchronous settlement and journal
reads. No arbitrary synchronous RPC, path access, network API or native buffer bypass is added.

#### Host-call and file contract

- The gate binds `(instance, generation, handle)` to the trusted principal, selected functions,
  grants, deadlines, diagnostic collector and inline records. Unknown, foreign, expired, retired or
  cancelled handles never dispatch. A replaced registration's finalizer cannot close its successor.
  At most one result is accepted per issued sequence; duplicate/reordered calls cannot repeat a
  dispatch. All pending work is interrupted when registration closes.
- Carry forward `selectSandboxHostFunctions`, trusted-subject overrides, script-kind and before-policy
  ceilings, plugin/provider/schema ownership, pinned config keys, OAuth fields and executable facts.
  Keep 1,000 calls, 50 HTTP calls, four concurrent dispatches per execution, 1 MiB ordinary host
  request, 10 MiB ordinary host response and existing HTTP/observability limits. Charge inline
  requests using the same budgets; internal control calls cannot be used to smuggle ordinary calls.
  Excess parallel calls wait in bounded queues; limit violations do not allocate oversized buffers.
- `artifactReadRange` takes only a granted logical key, safe nonnegative offset and length in
  `1..1048576`, and returns bytes plus size; bytes are encoded in bounded frames. `readArtifact` and
  `readNamedArtifact` in the SDK assemble these ranges under isolate memory limits. An absent
  capability/resource returns `missing-artifact-grant`. Backend paths must be absolute, normalized,
  under the real temp root, and free of symlink traversal; open pinned regular-file descriptors with
  no-follow checks, so path replacement cannot redirect later reads. No script-selected path reaches
  an open call. Validate trusted named grants as strictly as the unnamed artifact.
- `scratchWrite` takes a plain name, upload-local offset/final marker and at most 256 KiB decoded
  bytes. The SDK splits `writeScratchChunks`; partial files are not harvestable. Reject slash,
  backslash, NUL, dot names, duplicate names within a call, symlinks and non-regular files. Serialize
  per-execution reservations: committed plus pending bytes never exceed 5 MiB, including concurrent
  writes and replacement growth. Reserve before decoding/writing the chunk, refund failed/removed
  bytes, and atomically expose a completed file. Retain 4,096-entry/depth-32 traversal limits for
  backend inspection; script-created files are flat. No write can temporarily exceed the quota.
- Harvest only unique names in the validated completed-output manifest, after all file calls stop.
  Copy only completed regular files to workflow storage, retain parent-execution ownership, expose
  only opaque handles, omit harvest metadata from public results and clean scratch/partial/harvest
  directories on every exit path. A new replay gets new scratch state; grants never select a dedicated
  sidecar or widen its OS permissions.

#### Routing, admission and lifecycle contract

- Add required, sorted, unique `runtimeImports` to the canonical `SandboxExecutionMetadata` schema.
  Derive it from the final emitted JavaScript audit, including re-exports and literal dynamic imports,
  not authored source declarations or capabilities. Reject nonliteral dynamic imports in plugin
  output. Plugin archives, kernel generation and stored pins carry the facts without changing format
  constants. Ingestion audits the archived module bytes and requires exact agreement; this is output
  validation, not recompilation or a claim of source provenance. No absent-metadata/full-tier fallback.
- Effect and RyotQL aliases map to `core`; fflate, papaparse, fast-xml-parser and cheerio require `data`;
  youtubei requires `full`. Include the kernel bootstrap's imports in every covering tier. Empty
  runtime imports select `core`; unknown imports fail closed. Rust independently rejects imports
  outside its process snapshot. Archives can narrow capabilities but cannot choose trust or snapshots.
- Use `system` only for a validated pinned system-scope plugin revision or a verified source-zero
  kernel script. A null plugin revision alone is not proof of source zero. User-scope revisions and
  uploaded standalone code always use `user`, even when invoked by an administrator or system job.
  First-party scripts acting for a user still use system trust; their executing-user attribution stays.
- Standalone uploads persist the authenticated uploader on the script row and carry that identity in
  execution pins. Kernel scripts and plugin revisions do not carry a standalone uploader fact.
  Uploaders are never inferred from the executing subject; identical standalone content has separate
  uploader-owned rows and a shared content quarantine key. Kernel persistence cannot adopt an uploaded
  row or change its uploader.
- One process per trust × snapshot key by default; the supervisor key includes a user shard so an
  explicit per-user sharding setting can partition the user tier without changing grants. Both `core`
  keys stay resident. Start `data`/`full` only on demand, share one pending startup per key, await a
  validated `ready` within 10 s, and stop after 60 s with no running, queued, control or recovery work.
  Idle/start/drain races never send a run to a closing generation. No script-controlled argv or env.
- `SANDBOX_WORKER_CONCURRENCY` remains the global bound `G`, default 2, across every tier, grant,
  recovery probe and shard. No sidecar gets an independent multiplication of it. Excess jobs stay in
  the existing durable queue; ephemeral waiters and transport queues are bounded by `G`. Do not hold
  a transaction while waiting. Each instance starts with `threads=G`, `queue=G` per lane, an explicit
  CPU-active cap of `min(G, available cores)`, and S1's platform-pool cap.
- For each instance/lane, count a run from reservation before its first byte through `done`/confirmed
  disposal, including queued, CPU-parked and host-parked isolates. Never send more than `threads + queue`
  outstanding runs. Control traffic has reserved queue space and priority over new runs; round-robin
  chunk writes, reads and partial-write flushing cannot block host results or cancels behind run
  admission. Counters are generation-owned and cannot underflow during crash/late-done races.
- Boot rejects `G > DATABASE_POOL_MAX - 4`: reserve one cluster SQL-runner connection, two always-on
  durable queue-worker connections and at least one application connection. In addition, cap sandbox
  host database dispatch globally at `DATABASE_POOL_MAX - 4 - G`; require this number to be at least
  one. Reuse the existing DatabaseSession connection when present; calls needing another connection
  take this shared permit, including inline dispatch, so four calls per execution do not multiply
  pool occupancy. Never acquire a second permit while holding one. Test the actual queue/host paths,
  not only the arithmetic; an unbounded or nested connection path is a Stop.
- The configured database ceiling covers both pools: the primary pool has `4 + G` connections and
  sandbox dispatch has at most `DATABASE_POOL_MAX - 4 - G` leased native single-connection clients.
  Nested queries and transactions reuse the leased client. Idle host clients expire after 60 s;
  there is no fabricated driver facade, extra pool capacity, or transaction used merely to pin a
  non-transactional operation.
- Add `SANDBOX_MEMORY_BUDGET_MIB`, default 1536, as an aggregate reservation ceiling across backend
  sandbox buffers and all sidecars; validate it against effective host/cgroup memory with at least
  half that memory reserved for the backend, database and other work. Per run use a 256 MiB heap,
  64 MiB external cap and 30 s CPU cap. Reserve the full heap/external caps, encoded module/invocation
  and chunk copies, retained backend journal and its encoding, maximum in-flight host response and
  result buffers, bounded diagnostics, scratch staging buffers and worker stacks. Lazy journal
  reassembly consumes the reserved isolate heap rather than an unmetered native store. Reserve the
  maximum prefix allowance before the queue worker loads/decodes Redis entries, then reduce it to
  actual retained bytes; moving allocation ahead of admission is not permitted.
- Reserve each started process's snapshot/RSS baseline and thread/platform stacks, at least 128 MiB
  per process, against that same budget; use the larger measured baseline when necessary. Pass Rust
  its assigned isolate-memory budget including run-frame storage, and separately account for
  transport reassembly/control buffers on both sides. Atomically reserve a lazy process and its first
  run; concurrent startups cannot oversubscribe. Release only after disposal/exit and buffer cleanup.
  Fits-later work waits durably; work that cannot fit an otherwise idle required topology fails with a
  structured execution-limit reason before dispatch. Validate resident core capacity at boot.
- Preserve recycling at 10,000 runs or 1,536 MiB process RSS (bounded further by its assigned budget).
  Drain before replacement; do not overlap generations without reserving both baselines. Sample
  aggregate RSS and budget pressure; budget reservations are admission bounds, not claims of hard
  OS enforcement. S4 adds deployment cgroup enforcement.

#### Crash and quarantine contract

- A validated `fatal` handle attributes the culprit; unexpected exit, socket desync, missed backstop
  or abort without that evidence is unattributed. Close the generation and interrupt all its calls
  before restart. Normal idle stops and recycling are not crash strikes. Snapshot/confinement/usage
  startup failures fail closed instead of restarting forever.
- Restart with exponential backoff `1, 2, 4, 8, 16, 30` seconds, capped at 30 s; reset only after 60 s
  healthy service, not on `ready`. At most one startup/recovery loop owns a key. Cancelled workflows
  are never resurrected, and shutdown cancels recovery and reaps every child.
- For an unattributed crash, freeze fresh admissions on that key and rerun its surviving candidates
  in stable handle order, one at a time, with no unrelated work in the probe generation. Reload the
  same pinned input and committed replay prefix, with a new handle/generation and fresh grants.
  A second unattributed execution crash in this exclusive probe attributes that candidate; a survivor
  returns its result normally. After one probe per candidate, release healthy work. Known administrative
  kills, startup failures and proven host-wide OOM do not blame a script. Repeated unclassifiable
  failures that cannot yield attribution reach the Stop instead of unbounded probing.
- Recovery is supervisor-owned infrastructure retry: collateral executions do not consume script,
  host HTTP, durable-step or job retry budgets merely because their neighbour died. An attributed
  culprit is not immediately rerun as collateral. Cap each logical replay at three collateral crash
  recoveries; after that suspend it in the durable queue under the quarantined/recovering key until
  the key is healthy, without charging its ordinary retry count. Keep recovery state durable across
  backend restart. No in-memory retry bypass can loop indefinitely or duplicate committed host work.
- Persist crash windows/quarantine in Redis infrastructure with atomic updates and TTL; restoration
  fails closed for user execution if the quarantine store is unavailable. Three attributed crashes
  within 10 minutes quarantine for 1 hour. Increment both the trusted uploader-user key and the
  canonical plugin-content key, not just a revision or uploader/plugin pair. The content key is the
  digest of sorted backend module hashes and applies across accounts, archive repacking, revisions
  and slug changes with the same executable set. Standalone uploads use their module hash.
  Uploader-wide quarantine blocks rotation through different plugins; content-wide quarantine blocks
  the same plugin uploaded by different accounts. Upload/install does not erase these keys.
- Quarantine fails affected new/pending executions with a structured reason before sidecar admission;
  healthy users and plugins continue. User-less system crashes quarantine the pinned job/script key;
  user-attributed system work also charges that triggering user's system-job key, never globally
  disables a first-party plugin. System and user quarantine namespaces are separate. Expiry allows
  one exclusive probation run; failure renews quarantine and success clears probation atomically.
- Metrics cover trust/snapshot key, live processes, starts/stops, admission waits/bytes, outstanding
  runs, host calls, disposal, limits, restart reason/backoff, probes, collateral recoveries and
  quarantine. Keep script/user IDs out of metric labels and module bytes, tokens and host arguments
  out of lifecycle logs. Bound process-level startup diagnostics separately from execution console.

#### Build and confinement contract

- `kernel/sandboxd` gains a release build task emitting `dist/ryot-sandboxd`, snapshots and digest
  manifest. Split payload generation from Rust-dependent backend checks/tests so Turbo has no
  backend ↔ sidecar build cycle: payload/backend generation precedes Rust, then backend tests/server
  assembly depend explicitly on Rust artifacts. Cache keys include bootstrap, payload, protocol,
  crate and pinned toolchain; cached outputs restore the executable and every snapshot.
- The single-architecture Linux image builds the crate from source with the pinned toolchain and
  copies artifacts read-only into `/home/ryot/sandboxd/`. Create backend UID 1001 and sidecar UID/GID
  1002 with no sidecar home/login. The backend remains UID 1001. Use a small root-owned native
  setuid launcher built in `kernel/sandboxd`, installed outside backend-writable directories; its
  privileged prelude accepts only the configured backend UID, fixed installed executable/snapshot
  paths and a connected inherited socket, clears supplementary groups and sets real/effective/saved
  UID/GID to 1002 before executing the sidecar. It closes every other descriptor and clears the env.
   It reads no protocol/module data and performs no privileged V8 work. Validate descriptor type,
   peer and argument limits; no arbitrary executable, path or UID option is exposed.
- The launcher also provides a fixed `SIGKILL` termination operation for the backend's disposal
  backstop. It accepts only the configured backend UID and a direct child of that caller whose
  real/effective/saved UID/GID are 1002 and whose executable is the fixed installed sidecar. Open
  a Linux `pidfd` before checking the target, then signal through that descriptor so PID reuse cannot
  redirect termination. Root-owned launch attestations bind the fixed executable, caller and child
  process start times; runtime confinement prevents executable replacement. This identity proof must
  work with Docker's default capabilities, which deny executable-link inspection of non-dumpable
  processes. Unknown targets, other parents, identities or executables fail closed.
  Termination grants no general signal or process-management authority, reads no protocol/module
  data and leaves no privileged resident process. Backend shutdown uses this path to reap children
  when closing the socket or cancellation does not confirm disposal.
- The sidecar loads/verifies its snapshot, sets non-dumpable/no-core/`no_new_privs`, applies Landlock
  and seccomp before runtime workers, then emits `ready`. Set high `oom_score_adj` (1000) through
  the launcher before dropping privilege. Do not share backend UID, inherit secrets or relax Docker
  seccomp. Linux startup fails when the launcher, identity drop, limits or confinement is unavailable.
  A deployment with `nosuid` or `no-new-privileges` preventing launch is a Stop, not an unconfined mode.
- Backend tests, plugin-load checks, server dev assembly and e2e global setup all build and locate the
  same release executable/snapshots. Linux test setup provisions the same separate UID and trusted
  launcher via an explicit privileged setup step; absence fails with a setup error. macOS uses a
  directly spawned unprivileged executable and explicitly reports unconfined development. Local
  builds never silently switch to Deno or skip runtime tests.
- Replace `apps/server/tooling/prepare-sandbox-runtime.ts` with a sidecar smoke check through the real
  supervisor and gate. Docker smoke/confinement runs start all six trust × snapshot keys under the
  default seccomp profile, verify UID/env/FDs, in-process Landlock denial and filter installation, and
  run real definitions and host calls. Test the native launcher's rejection paths separately.
  `.github/workflows/sandboxd.yml` includes changed bootstrap/compiler inputs; a Linux image job
  covers the release launch and default-Docker-confinement path. macOS S1 and backend tests still run.

#### Deno deletion inventory

Delete the following runtime code and update their callers/tests in the same slice:

- `runtime.ts`: `BridgeService`, `RunnerFile`, `PackageCacheManager`, `SandboxProcessManager`, Deno
  spawn/permission flags, warm/dedicated pool, bearer-token HTTP listener, stdin/stdout line queues,
  stderr-tail transport and Deno-only process metrics. Delete `runtime-flags.test.ts` and
  `runtime-stderr.test.ts`; port behavioral coverage in runtime concurrency/limits/host tests.
- `runner-source.sandbox.ts`, `runner-utilities.sandbox.ts`, `runner.generated.ts` and `deno.json`,
  after porting owned runner behavior and utility tests. Remove `sandbox:check-runner` from
  `kernel/backend/package.json`; type-check the bootstrap through the normal build/check surface.
- `dependencies.ts` and Deno runtime materialize/repair/cache tests; `compiled-modules.ts` and its
  file-cache tests; generated runtime-payload TypeScript byte embeds and their runtime-only metadata
  reader. Keep build-time trusted payload assembly, digest verification and kernel-script generation;
  update `tooling/sandbox-runtime.ts` and watcher inputs/outputs accordingly.
- Deno-only branches of `service.ts`, `filesystem-grants.ts`, runner/plugin-load test harnesses and
  server runtime smoke preparation. Remove module URL/path plumbing, dedicated-grant launching and
  post-execution-only scratch measurement. Keep descriptor/grant/harvest validation in the file service.
- `SANDBOX_DENO_DIR`, `sandboxDenoDirConfig`, `sandbox.denoDir`, `SANDBOX_PROCESS_MODE`,
  `sandbox.processMode`, `denoHeapMiB` and their config/limit/test-support defaults and tests.
  Keep `SANDBOX_WORKER_CONCURRENCY` and import concurrency with updated descriptions/validation.
- `PackageCacheManager` wiring in automations and garbage collection, compiled-file liveness/sweep
  code, and all remaining imports of deleted services. Update sandbox e2e stderr expectations to
  structured sidecar failure plus bounded diagnostics.
- Deno tool/version requirements in `.prototools` and maintained setup/contributing documentation;
  `SANDBOX_DENO_VERSION` and `denoVersion` payload metadata. Keep format and other version constants
  unchanged. Rename the Deno-named ESM profile/API in `packages/vite-compiler/src/deno.ts`, exports,
  compiler/tooling callers, input fingerprints and tests to sandbox ESM. Replace its Deno resolution
  condition with the explicit supported worker/browser module conditions and verify payload imports.
  Move youtubei's registry mapping from `platform/deno.js` to its supported web/browser entry;
  required library behavior must pass on the full surface, not retain a Deno platform adapter.
- Docker's `DENO_VERSION`, architecture/checksum selection, Deno release download, unzip/install,
  cache/materialization and Deno smoke steps. Remove download-only image packages where no longer
  needed; preserve backend TLS certificates. Build, copy and smoke-check native artifacts instead.

Acceptance audits tracked runtime, tooling, config, image and maintained docs for stale Deno paths.
`deno_core`, Rust crate dependencies, rejected-import fixtures and the retained reference spike are
not the Deno executable path; they are not deleted by this inventory.

#### Acceptance

Every item below must have its named passing test. Backend tests use injected Layers/recording
functions and TestClock for policy branches; real sidecar tests cover transport/disposal/runner
semantics. No module mocks, spies, fake timers or assertions that only mirror schemas.

**One test per Carried Protections row:**

| Carried protection                                                | Named test and required proof                                                                                                                                                                                                                                |
| ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| One process per replay, killed on every exit path                 | `replay_exit_paths_dispose_isolates_and_retire_handles`: success, pending, failure, timeout, cancellation and interrupted inline/file calls leave no isolate, host work or scratch state; a later isolate cannot observe prior globals.                      |
| Deno denies run, env, FFI, write, npm, remote, config             | `integrated_isolate_has_no_ambient_authority`: real definitions probe absent globals, string generation, forbidden imports and native escapes in the confined image; inventory has only approved ops.                                                        |
| Read and network limited to grants and bridge                     | `files_and_http_require_execution_bound_grants`: forged keys/paths/handles fail; only pinned artifact reads and allowed `httpCall` dispatch succeed, including full-tier fetch.                                                                              |
| Environment limited to PATH and DENO_DIR                          | `sidecar_identity_environment_and_descriptors_are_confined`: all six image processes use UID/GID 1002, empty env, expected descriptors only, with no backend-secret access.                                                                                  |
| Bridge token, expiry, budget, concurrency, caps, allowlist, close | `host_call_gate_preserves_session_protections`: foreign/retired generations, expiry, 1,000/50 budgets, four concurrent calls, request/response caps, forbidden functions, duplicates and replacement-finalizer races fail safely; close interrupts dispatch. |
| 30 s script-time timeout pausing during inline settlement         | `inline_settlement_freezes_fibers_and_pauses_only_script_time`: timers/fibers cannot run during settlement; ordinary host waits count, inline waits pause, expiry extends equally, absolute/settlement ceilings and kill backstop still fire.                |
| Grant validation, scratch quota, symlinks, named harvest          | `file_service_enforces_write_time_quota_and_named_harvest`: concurrent/replacement/partial writes cannot exceed 5 MiB at any instant; traversal, symlink races and unlisted/incomplete/duplicate harvest fail; cleanup and parent ownership hold.            |
| Bounded stderr tail, OOM-victim preference                        | `sidecar_diagnostics_are_bounded_and_oom_preferred`: console and startup/crash diagnostics stay bounded and sanitized; truncation marker survives; Linux process has oom_score_adj 1000.                                                                     |
| Request 2 MiB, context 64 KiB, result 4 MiB                       | `integration_enforces_invocation_context_and_result_caps`: exact boundaries and excess multibyte/escaped payloads fail before oversized allocation or partial output, including chunked transport.                                                           |
| Module SHA-256 and runtime payload verification                   | `integration_rejects_module_and_snapshot_tampering`: altered pinned bytes fail before invocation; modified snapshot/manifest fails startup, including restored build artifacts.                                                                              |

**Remaining acceptance:**

| Area                        | Named tests and required proof                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Runner port                 | `definitions_preserve_validation_manifests_and_failure_phases`; `workflow_guard_and_dependency_wrapper_preserve_determinism`; `durable_replay_preserves_requests_failures_children_and_detached_work`: port current runner fixtures through actual isolates; all definition kinds, input/output errors, manifest mismatch, typed failure/defect, pinned Clock, guarded top-level code, replay identity mismatch and detached work behave as specified.                                                                                                                                                                                      |
| Journal and inline evidence | `journal_reads_preserve_large_pinned_prefixes_with_bounded_frames`; `inline_records_are_host_owned_and_survive_committed_replay`; `granted_executions_settle_inline_without_permission_elevation`: include a prefix above the run/host-result caps, split large entries, forged offsets/lengths/evidence, missing/corrupt projection repair, HTTP/non-activity deferral and replay after commit.                                                                                                                                                                                                                                            |
| Compiler/tier facts         | `runtime_import_facts_match_emitted_module_audit`; `snapshot_routing_uses_smallest_covering_import_set`: aliases, re-exports, literal dynamic imports, tree-shaken imports, nonliteral/unknown imports, archive mismatch and all built media/fitness modules.                                                                                                                                                                                                                                                                                                                                                                               |
| Trust routing               | `user_revisions_and_unverified_null_principals_cannot_reach_system_sidecars`: forged archive scope, admin invocations, user uploads, source-zero proof and pinned first-party-on-user-behalf execution.                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| Startup/lifecycle           | `lazy_tiers_start_once_and_stop_only_when_idle`; `drain_and_recycle_respect_generation_and_memory_reservations`: startup/idle/new-run/cancel races, healthy drain, shutdown, pending control/recovery and non-overlapping replacement.                                                                                                                                                                                                                                                                                                                                                                                                      |
| Admission/headroom          | `global_admission_bounds_all_tiers_grants_and_recovery`; `memory_admission_counts_journals_frames_startups_and_buffers`; `sandbox_dispatch_preserves_database_pool_headroom`: exercise real queue/host dispatch with four calls per execution, multiple keys, large journal, exhausted memory and incompatible boot settings.                                                                                                                                                                                                                                                                                                               |
| S1 lane follow-up           | `lane_outstanding_bound_keeps_host_results_and_cancels_flowing`: saturate both lanes through threads plus queue; further runs stay in backend admission while parked workers still receive results/cancels; include partial writes and late/crash releases.                                                                                                                                                                                                                                                                                                                                                                                 |
| S1 import-phase follow-up   | `caught_dynamic_import_does_not_poison_later_error_phase`: caught rejected import followed by evaluation and execution errors reports the actual later phase; an uncaught resolution error still reports resolution. Associate resolution failure with its error, not an isolate-global sticky flag.                                                                                                                                                                                                                                                                                                                                        |
| S1 name-length follow-up    | `host_call_name_length_matches_utf16_on_both_sides`: Rust uses `encode_utf16().count()` to match TypeScript's 128 UTF-16-code-unit limit; shared fixtures cover ASCII, BMP, astral pairs and limits. No numeric cap change.                                                                                                                                                                                                                                                                                                                                                                                                                 |
| Integrated protocol         | `client_handles_partial_writes_chunk_interleaving_and_desync`: bounded buffers, `drain`, multibyte fragmentation, fair chunks, isolated invalid payload, unknown handles, duplicate/late results, reserved control space and generation restart.                                                                                                                                                                                                                                                                                                                                                                                            |
| Crash recovery              | `restart_backoff_survives_short_lived_generations`; `unattributed_crash_candidates_probe_one_at_a_time`; `collateral_recovery_preserves_retry_budgets_and_committed_work`: kill a sidecar mid-import, then verify pinned replay, cancellation, stable exclusive probes, durable collateral suspension and no repeat of committed dispatch.                                                                                                                                                                                                                                                                                                  |
| Quarantine/rotation         | `crash_quarantine_blocks_uploader_plugin_rotation`; `crash_quarantine_blocks_identical_plugins_across_accounts`; `quarantine_probation_and_system_jobs_preserve_healthy_work`: real attributed-crash fixtures plus atomic policy tests cover three crashes, repacking/renaming, different plugins/accounts, backend restart, store failure, TTL and exclusive probation. Unrelated executions finish without exhausted retries.                                                                                                                                                                                                             |
| Privileged launch           | `launcher_rejects_untrusted_callers_paths_and_descriptors`: no arbitrary setuid execution, inherited secrets/FDs or retained saved-root IDs; UID-drop and no-core failures fail closed. `launcher_termination_is_bound_to_caller_child_identity_and_pidfd`: only the caller's fixed UID-1002 sidecar can be killed; foreign parents, executables and identities fail, and PID reuse cannot redirect the signal. |
| Docker confinement          | `docker_default_seccomp_runs_all_confined_tiers`: release image, Docker default profile, all six keys, native file/socket/syscall denial, in-process Landlock verification, installed filter and real definition/host calls; no privileged container or seccomp override.                                                                                                                                                                                                                                                                                                                                                                   |
| Build/cache/removal         | `local_test_and_e2e_build_restore_native_runtime`; `runtime_build_has_no_deno_executable_dependency`: delete outputs and restore from cache, run backend/e2e setup without Deno installed, audit the deletion inventory and run smoke preparation.                                                                                                                                                                                                                                                                                                                                                                                          |
| Affected e2e                | `sandbox_sidecar_recovers_mid_import`; `youtube_music_provider_runs_on_full_sidecar`: add focused kernel recovery/provider tests and run affected existing kernel sandbox, media provider/import and fitness import files. Record the exact file list and results; never run the entire e2e suite.                                                                                                                                                                                                                                                                                                                                          |
| Fresh-host benchmark        | `standard_provider_import_matches_rows_and_improves_time_and_memory`: on a fresh 2 vCPU / 4 GB x86_64 Linux host, capture today's complete Deno import baseline before replacement, then run the same pinned provider/dataset under S2 against fresh equivalent DB/Redis state. Require identical normalized business rows, lower median wall time and lower peak combined backend/child-process RSS across at least three runs of each; also report database/container peak memory, replay count and admitted concurrency. Compare at the same concurrency/config, without retuning pools. S1's no-op numbers are not the import baseline. |

`bun run check`, `bun turbo --filter='!@ryot-app/e2e' test`, affected e2e files and the slice's CI
jobs must be clean. Run `.agents/skills/codebase-cleanup` in the main session after implementation.
Record **S2 results** here only after Phase 2: map every acceptance item to test/file and result,
include Docker confinement and both crash-rotation scenarios, baseline/S2 fresh-host numbers and
business-row comparison, exact build/CI commands, all unproved items and every deviation. The host
must be fresh and match the benchmark specification; confirm that before measuring.

#### Rollback and Stops

- **Rollback:** revert the complete slice as one source change, including bootstrap/protocol fixtures,
  compiler metadata, build graph, launcher/image/config and Deno deletion. Rebuild binary/snapshots,
  plugin archives and image together; do not mix S1/S2 artifacts or keep a runtime Deno fallback.
  Greenfield state needs no compatibility migration. Preserve the separately approved S1 changes.
- **Stops:** stop and report, without a workaround or scope expansion, if:
  - a required sandbox capability/library behavior needs an op/global outside the approved metered
    surface, including youtubei's browser entry;
  - synchronous settlement cannot freeze every script fiber, wake on cancel, and keep the socket
    reader/control path live;
  - legal journal/response handling cannot stay within wire, heap and aggregate memory budgets without
    lowering an existing contract limit or introducing unmetered native storage;
  - execution trust/uploader/content identity cannot be established from trusted pins, or crash
    attribution/quarantine cannot protect collateral retries under either rotation scenario;
  - real queue/host database paths cannot meet the stated headroom without changing workflow/pool
    ownership or e2e sizing;
  - lane bounds cannot prevent the S1 reader from blocking host results/cancels;
  - the native UID launcher or Linux confinement cannot run with Docker's default seccomp profile,
    or privileged Linux test provisioning is unavailable; never share backend UID or disable confinement;
  - a required target lacks the prebuilt V8/toolchain support, or bootstrap snapshot restore requires
    workarounds beyond S1's documented ones;
  - the supplied benchmark host is unavailable/not fresh/not the reference size, or the standard import
    baseline/dataset cannot be reproduced; request the missing input before proceeding;
  - any acceptance test or fresh-host performance threshold remains unmet and satisfying it would
    require work outside this contract. Report evidence and request a revised contract.

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

## Open Risks

- **V8 termination:** depends on `--no-turbofan` until upstream fixes the hole; the backstop covers
  unknown cases. Re-run the termination, escape, and crash suites on every `deno_core` or V8 upgrade.
- **Memory at high concurrency:** 6–14 MiB per live isolate depending on snapshot tier until S6 adds
  pointer compression.
- **Uninterruptible builtins:** a builtin that never checks for termination exits the whole sidecar,
  taking its neighbours' executions with it; S2's supervisor re-runs them.
- **Fairness gaming:** per-user fairness can be gamed with many accounts where signup is open.
