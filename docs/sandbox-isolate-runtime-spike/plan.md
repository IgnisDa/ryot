# Sandbox Isolate Runtime Plan

**Status:** S1 and S2 are implemented (see [S1](s1.md) and [S2](s2.md)); S3–S6 are reviewed and
approved one at a time before they start.
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

A spike compared fresh `deno run` per execution with a `deno_core` sidecar that restores a startup
snapshot and creates one isolate per execution. The sidecar ran a no-op in 15 ms p50 against 80 ms,
used less memory under concurrency, and contained CPU, heap, and ArrayBuffer abuse that today's model
does not. Measurements and the pitfalls the spike found are in [evidence.md](evidence.md).

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

A pre-approval security review's findings, with the slice that owns each one, are in
[security-review.md](security-review.md).

## Implementation Brief

This section is for the agent implementing a slice. Implement **only the slice you were assigned**,
starting with S1; later slices are outlines and need their own review.

### Read first

1. The repository rules in `AGENTS.md` and every `AGENTS.md` under directories you touch. They govern
   comments, version constants, imports, Effect usage, tests, and the done criteria.
2. This document, your slice's document, and [security-review.md](security-review.md): every row owned
   by your slice is a requirement.
3. `kernel/backend/src/lib/infrastructure/sandbox-runtime/README.md` and `packages/sandbox-compiler/README.md`
   for today's runtime, limits, capabilities, and format-1 modules.
4. [`README.md`](README.md) for working `deno_core`
   0.412 API usage. It is throwaway code and omits the required hardening.

### Pitfalls found by the spike

See [evidence.md](evidence.md#pitfalls-found-by-the-spike).

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

- **Outcome:** `ryot-sandboxd` evaluates format-1 modules on three snapshot tiers with the surface,
  limits, lifecycle, confinement, and protocol above.
- **Status:** implemented. Contract, acceptance, and results: [s1.md](s1.md).

### S2 — Backend integration

- **Outcome:** every sandbox execution runs through `ryot-sandboxd`; the Deno path is deleted.
- **Status:** implemented. Contract, acceptance, and results: [s2.md](s2.md).

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

## Retained for S3–S5, eligible for cleanup

These scripts stay until the later slices no longer need them: `kernel/sandboxd/bench/import.py`,
`e2e/vitest.benchmark.config.ts`, `e2e/benchmark-global-setup.ts`,
`e2e/src/api/plugins/media/imports/media-population-benchmark.test.ts`,
`apps/server/tooling/prepare-sandbox-runtime.ts` with its smoke fixtures, and
`docs/sandbox-isolate-runtime-spike/{scripts,workloads,sidecar}`.

## Open Risks

- **V8 termination:** depends on `--no-turbofan` until upstream fixes the hole; the backstop covers
  unknown cases. Re-run the termination, escape, and crash suites on every `deno_core` or V8 upgrade.
- **Memory at high concurrency:** 6–14 MiB per live isolate depending on snapshot tier until S6 adds
  pointer compression.
- **Uninterruptible builtins:** a builtin that never checks for termination exits the whole sidecar,
  taking its neighbours' executions with it; S2's supervisor re-runs them.
- **Fairness gaming:** per-user fairness can be gamed with many accounts where signup is open.
