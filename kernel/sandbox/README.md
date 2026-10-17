# Sandbox

The sandbox isolates script activations. It owns the `ryot-sandboxd` daemon and its launcher
(`native/`), the trusted guest runner evaluated inside each isolate (`src/guest`), the parent/daemon
messages and runtime limits (`src/protocol`), and the backend-side host that
supervises daemons, admits runs, validates host calls, and bounds execution files (`src/host`).

`SandboxExecutor.run` executes one validated activation for a `SandboxPrincipal`, the runtime-facing
part of the backend's execution principal. The host never loads plugins, resolves authority, decides
product eligibility, or implements product capabilities; the backend provides them through these ports:

| Port                        | Supplies                                                                                |
| --------------------------- | --------------------------------------------------------------------------------------- |
| `SandboxHostConfig`         | Run identity, temporary directory, worker concurrency, memory budget, per-user sidecars |
| `SandboxHostCallScope`      | The bound that host-call work runs under (the backend's database lease)                 |
| `SandboxHostFunctions`      | Per-run host functions, bound to the execution and limited to its eligible capabilities |
| `SandboxExecutionAuthority` | The trust tier of a principal, reloaded from persisted authority                        |
| `SandboxRedis`              | The client for recovery, quarantine, and crash state under `ryot:sandbox:*` keys        |

## Isolation And Capacity

The Rust sidecar runs each invocation in a fresh isolate. The sidecar and backend use a duplex inherited socket with framed messages. An execution-scoped host-call gate validates each operation, and sealed SDK bindings expose only the approved host surface.

`G` is global sandbox concurrency and defaults to 2. Pool sizing reserves `4 + G` connections for primary database work. Native host-call leases are capped at `poolMax - 4 - G`, which configuration validation requires to be at least 1; nested calls reuse their parent lease.

Without `SANDBOX_MEMORY_BUDGET_MIB`, the sidecar memory budget is the smaller of 1536 MiB and half of effective memory; an explicit budget cannot exceed half of effective memory, and startup fails when effective memory is unknown. Admission grants concurrency, process-start capacity, and memory together; memory waiters hold no execution permit or partial reservation. Each isolate has a 64 MiB heap, 16 MiB external-memory limit, and 30-second CPU limit. Each admitted run reserves `runBytes` (`memory-plan.ts`): the isolate with its near-heap-limit headroom, fixed stack and staging, run start, frames for five outstanding host calls on both sides, Rust result delivery, and the done text Rust holds before disposal. Startup plans the budget once and logs the plan. From two resident processes, two inline-batch permits and two interactive headrooms (a run plus a lazy process each) it runs in lane mode: an interactive and a background transient pool, the interactive one filled first, each at least one inline-batch permit and capped at that permit plus the inline evidence allowance (`transient-memory.ts`), with the rest dynamic. A background run is admitted only while the dynamic region keeps room for one interactive run with a lazy process (an interactive headroom), counting what interactive runs and the lazy processes they started already hold. From two resident processes, one inline-batch permit and one interactive headroom it runs in shared mode with one inline-permit pool and no interactive reservation, and below that startup fails. Host-call permits come from the run's lane pool, FIFO and never lent across lanes. The canonical benchmark sets `SANDBOX_MEMORY_BUDGET_MIB=1904`, half of the measured 3,809 MiB host. Two shared core sidecars stay resident; data and full tiers load lazily. A lazy sidecar holds 128 MiB from start until its exit is confirmed. When an admission cannot fit, the least recently active idle lazy sidecar (no runs, waiting attempts, recovery round or admission lease) is closed, one per failed check. With `SANDBOX_PER_USER_SIDECARS`, each owner's user-tier scripts run in that owner's own lazily started sidecars instead of the shared ones. Startup is limited to 10 seconds, idle time to 60 seconds, and an isolate drains and recycles at 10,000 executions or its assigned RSS limit.

Every execution carries a lane, `interactive` or `background`, chosen by its initiating backend path and never by script kind, context, archive data or host-call arguments. Provider search, plugin operations, HTTP writes and imports, and population or translation for an entity a live session is viewing are interactive; imports, integrations, cron, user bootstrap, plugin installation and event streams are background. Child and kernel-child workflows, durable host calls and lifecycle writes inherit their parent's lane; before-stage and required after-stage automation runs use the lane of the command that created their trigger, and async after-stage runs are background. The lane is part of every lifecycle command's causation (persisted on automation triggers) and of the sandbox workflow, queue and translation payloads, so replay, recovery and restart keep it. A missing lane fails decoding. The admission lease and the Rust run frame use the lane the run was reserved with; Rust runs background workers at lower thread priority, and background runs take at most half of `SANDBOX_WORKER_CONCURRENCY` (at least one). The backend frame writer sends control frames first, then alternates host-result frames between lanes, interactive first. Because the sidecar preallocates each chunked message at its first part, the writer starts a chunked message only while those still in flight fit the sidecar's 64 MiB per-connection cap. Non-interactive messages leave 12 MiB of that free for one maximum interactive host result.

On Linux, the launcher path is fixed at `/usr/local/libexec/ryot-sandbox-launcher`. The launcher, executable, and snapshots are fixed and root-owned; runtime UIDs are 1001/1002, with isolates running as UID 1002. Isolates are non-dumpable, have core dumps disabled and no environment, and inherit only the socket. Landlock and seccomp enforce deny-all policies. The launcher verifies pidfd identity and attestation before terminating a child; there is no fallback when a required control fails. On non-Linux systems, the sidecar runs from `dist/` and execution is explicitly unconfined.

## Capability Selection

A run binds only declared capabilities that the backend supplied for it, then drops filesystem grants,
workflow-dispatched and unbounded-result capabilities from live executions. Inline durable requests
are limited to the capabilities the backend lists for the run. Each bound call re-resolves authority
before it runs.

## Execution Files

Filesystem capabilities come from compiler-derived execution metadata, but metadata does not name or authorize paths. The kernel supplies trusted artifact resources separately; without an artifact resource grant, reads fail with `missing-artifact-grant`. Scripts address files by logical keys, not paths. Backend file opens use no-follow semantics.

| Capability      | Grant                                              |
| --------------- | -------------------------------------------------- |
| `artifact-read` | Read-only access to one kernel-owned artifact.     |
| `scratch`       | Read/write access to the execution's scratch area. |

Artifact reads use 1 MiB slices; scratch writes are limited to 256 KiB. Before decoding a write, the backend reserves the combined pending and committed scratch quota of 5 MiB. Cleanup runs on every exit. Harvest accepts only the exact named files reported as completed; the backend copies those files to workflow storage and returns opaque handles. Consumers resolve a handle only against its trusted parent execution. Public results omit harvest metadata.

## Recovery

Redis stores sidecar recovery state with a failure count capped at three. Reaching the cap suspends the queue until a healthy epoch. Recovery uses stable, exclusive probes. An owner/content pair is quarantined for one hour after three failures in ten minutes; probation probes run exclusively. System recovery state has a separate namespace. User-store failures fail closed.

## Limits

Runtime and compiler limits are set by their owners, not environment settings.

| Boundary                                                           |                                      Limit |
| ------------------------------------------------------------------ | -----------------------------------------: |
| Source / manifest / compiled JavaScript                            |                   256 KiB / 16 KiB / 1 MiB |
| Compiler concurrency / timeout / sampled Linux process-tree memory |                    2 / 5 seconds / 384 MiB |
| Compiler diagnostics                                               |                      100 entries / 256 KiB |
| Local replay timeout / context / final result                      |                30 seconds / 64 KiB / 4 MiB |
| Runner request                                                     |                                      2 MiB |
| Host calls / HTTP subset / concurrent in-flight calls              |                             1,000 / 50 / 4 |
| Journal / entry / chunk / maximum reads / fetched data             | 100 MiB / 12 MiB / 1 MiB / 2,048 / 200 MiB |
| Host-call request / response / durable response                    |                    1 MiB / 10 MiB / 12 MiB |
| HTTP request / streamed response / attempt timeout                 |                 1 MiB / 10 MiB / 8 seconds |
| Console logs                                                       |     500 entries, 8 KiB each, 256 KiB total |
| `log` and `span` observability                                     |     500 entries, 8 KiB each, 256 KiB total |
| Cache key / value / maximum TTL                                    |              256 bytes / 256 KiB / 30 days |
| Scratch quota / write                                              |                            5 MiB / 256 KiB |
| Isolate heap / external memory / CPU                               |               64 MiB / 16 MiB / 30 seconds |
| Sandbox `executeRyotql` result                                     |                                      1 MiB |

Compiler memory is sampled proportional set size in the Linux production image, not a cgroup hard ceiling. Non-Linux development keeps process, timeout, and concurrency bounds without claiming portable memory enforcement. Calls beyond per-session concurrency wait; cumulative budgets still apply. Each host call takes a FIFO transient-memory permit covering its decoded arguments and its result before decoding arguments, and holds it until the host work ends and the reply is written or purged. Capabilities whose results are unbounded before they materialize never bind live or settle inline; the workflow body dispatches them. Sandbox `executeRyotql` results are measured as JSON by PostgreSQL across the document's named queries and fail with `result-too-large` before any rows leave the database. Session registration and removal are identity-aware so replacement, expiry, interruption, or a late finalizer cannot evict a newer session.

## Daemon

The backend spawns one sidecar per trust tier × snapshot tier with an empty environment and the
protocol socket on descriptor 3:

```
ryot-sandboxd --generation <n> --snapshots <dir> --tier core|data|full [--trust user|system]
  [--threads <per lane>] [--queue <per lane>] [--max-active <n>] [--memory-budget <bytes>]
  [--max-executions <n>] [--max-rss <bytes>] [--grace-ms <ms>]
```

Startup verifies the tier snapshot against the digest manifest compiled into the binary, then on
Linux denies all filesystem and network access with Landlock and installs the seccomp filter before
V8 or any other thread starts; failure to confine exits with 71. Exit codes: 0 after the backend
closes the socket or a drain completes, 64 usage, 65 protocol desync, 66 snapshot integrity, 70 an
execution ignored termination (its handle is reported in a `fatal` frame first), 71 confinement.

Each lane has its own worker pool; background workers run at lower priority. Runs wait for a CPU-active
slot (released while an isolate waits on host calls or timers) and for a memory reservation of their
heap, external-memory, and run-frame bytes. After `--max-executions` runs or when RSS reaches
`--max-rss`, the sidecar sends `draining`, rejects new runs, finishes admitted ones, and exits.

### Linux syscall policy

Linux x86_64 and aarch64 use a default-deny seccomp allowlist. Unlisted numbers, rejected arguments,
and the x86_64 x32 ABI return `EPERM`; a mismatched architecture terminates the process. Newly
encountered syscalls are denied without a denylist update. The filter is inherited by every worker.

| Allowed syscalls                                                                      | Runtime requirement                                                                                            |
| ------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `read`, `write`, `close`, `pread64`, `recvfrom`, `sendto`                             | Descriptor I/O, framed protocol traffic, diagnostics, and RSS reads from the descriptor opened before lockdown |
| `brk`, `mmap`, `mprotect`, `mremap`, `munmap`, `madvise`                              | Rust/glibc allocation, V8 heaps and JIT pages, thread stacks, reclamation, and isolate disposal                |
| `futex`, `set_robust_list`, `rseq`                                                    | Thread synchronization and glibc thread registration                                                           |
| `clock_gettime`, `clock_nanosleep`                                                    | Worker CPU clocks, deadlines, timers, and watchdog sleeps                                                      |
| `getpid`, `gettid`, `getrandom`                                                       | Process/thread identity, OS-backed entropy, and per-isolate reseeding                                          |
| `rt_sigaction`, `rt_sigprocmask`, `rt_sigreturn`, `sigaltstack`, `exit`, `exit_group` | Signal handling, thread startup/disposal, crash handling, and process termination                              |
| `sched_getaffinity`, `sched_getparam`, `sched_getscheduler`                           | Pool sizing and glibc thread attributes                                                                        |
| `epoll_ctl`; x86_64 `epoll_wait`; aarch64 `epoll_pwait`                               | Tokio/Mio reactors for both execution lanes and per-isolate event loops                                        |
| x86_64 `pkey_alloc`, `pkey_mprotect`, `uname`                                         | V8's existing protection-key/JIT mapping support and platform detection                                        |

The remaining allowed operations have argument restrictions:

- `clone` flags must equal `CLONE_VM | CLONE_FS | CLONE_FILES | CLONE_SIGHAND | CLONE_THREAD |
CLONE_SYSVSEM | CLONE_SETTLS | CLONE_PARENT_SETTID | CLONE_CHILD_CLEARTID` across the full 64-bit
  argument. This is the glibc pthread path used by Rust, Tokio, and V8. Missing sharing flags, exit
  signals, namespace flags, `CLONE_PARENT`, `CLONE_VFORK`, and extra high bits are rejected.
- `clone3` always returns `ENOSYS`, so glibc retries with the restricted `clone`. Its errno filter is
  installed first; the allowlist then passes only this already-denied syscall through to that filter.
  This keeps the errno effective under Docker's default outer filter without permitting `clone3`
  execution or allowing another seccomp installation after lockdown.
- `socketpair` permits only `AF_UNIX`, `SOCK_STREAM | SOCK_CLOEXEC | SOCK_NONBLOCK`, protocol 0.
  These are internal runtime pairs; socket creation, connection, binding, and listening are denied.
- `epoll_create1` requires `EPOLL_CLOEXEC`; `eventfd2` requires initial value 0 and
  `EFD_CLOEXEC | EFD_NONBLOCK`; `fcntl` permits only `F_DUPFD_CLOEXEC`.
- `openat` permits only read-only flags, optionally `O_CLOEXEC`. Landlock still denies these opens
  with `EACCES`, including the mandatory post-lockdown `/` self-check. Write/create and `O_PATH`
  opens are rejected by seccomp. No new filesystem descriptor is obtained.
- `prctl` permits only `PR_SET_NAME` for worker names; changing dumpability, privilege settings, or
  VMA annotations is denied. `setpriority` permits only `PRIO_PROCESS` with nice value 10 for the
  background lane. `tgkill` permits only this sidecar's process ID for crash termination.

Trace presence alone does not grant access: optional VMA naming and executable-path lookups remain denied.

This tightens OS confinement. Source-built V8, its memory-corruption sandbox, pointer compression, and
allocator replacement are not used; the syscall policy does not prevent every V8 exploit or
guarantee isolation between users sharing one sidecar address space.

## Launcher

On Linux the backend never runs `ryot-sandboxd` directly. The root-owned setuid
`ryot-sandbox-launcher` accepts only the UID-1001 backend with one connected socket on descriptor 3,
clears the environment and other descriptors, sets `oom_score_adj` 1000, drops to UID/GID 1002, and
executes the fixed installed sidecar and snapshots. `ryot-sandbox-launcher terminate <pid>` kills
only a direct child of the caller that matches its root-owned launch attestation, through a pidfd.

`native/provision.sh <launcher> <sidecar> <snapshots>` installs the release artifacts at the fixed paths and
creates the 1001/1002 accounts; the image and the `sandbox-test` stage run it as root.
Build the stage with `docker buildx build --target sandbox-test --load -t ryot-sandbox-test .`, then run
the launcher suite as root under Docker's default seccomp profile and capabilities, without extra
`docker run` flags: `docker run --rm --user 0 -w /app/kernel/sandbox/native ryot-sandbox-test cargo test
--test launcher -- --ignored --test-threads=1`. The root-only launcher tests are `#[ignore]`d, so
plain `cargo test` skips them.

## Protocol

Frames are a 4-byte big-endian length and a JSON payload of at most 256 KiB. The schema source of
truth is `src/protocol/messages.ts`; messages larger
than 64 KiB travel as base64 `part` frames, and the sidecar writes one part per execution in turn.
The sidecar stops reading while a lane queue is full, so the backend must keep each lane's
outstanding runs within its threads plus queue: a blocked reader also holds back host results.

`bun run protocol:fixtures` regenerates `protocol-fixtures/` from the schema; `check` fails when they
are stale, and both the Rust and TypeScript tests decode and re-encode every fixture.

## Build

`bun turbo build --filter=@ryot-app/sandbox` runs `tooling/runtime.ts`, which bundles the trusted
guest runner from `src/guest` and `src/protocol` and the runtime modules into `native/payload/`. The
crate's build script builds the `core`, `data`, and `full` snapshots from it, checks the registered
ops against `native/ops.inventory`, and writes the digest manifest. The isolate surface is `native/js/bootstrap.js`,
plus `native/js/full.js` on the `full` tier.
