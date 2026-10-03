# ryot-sandboxd

`ryot-sandboxd` runs sandbox scripts in V8 isolates restored from a kernel-built startup snapshot.

## Process

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

| Allowed syscalls | Runtime requirement |
| --- | --- |
| `read`, `write`, `close`, `pread64`, `recvfrom`, `sendto` | Descriptor I/O, framed protocol traffic, diagnostics, and RSS reads from the descriptor opened before lockdown |
| `brk`, `mmap`, `mprotect`, `mremap`, `munmap`, `madvise` | Rust/glibc allocation, V8 heaps and JIT pages, thread stacks, reclamation, and isolate disposal |
| `futex`, `set_robust_list`, `rseq` | Thread synchronization and glibc thread registration |
| `clock_gettime`, `clock_nanosleep` | Worker CPU clocks, deadlines, timers, and watchdog sleeps |
| `getpid`, `gettid`, `getrandom` | Process/thread identity, OS-backed entropy, and per-isolate reseeding |
| `rt_sigaction`, `rt_sigprocmask`, `rt_sigreturn`, `sigaltstack`, `exit`, `exit_group` | Signal handling, thread startup/disposal, crash handling, and process termination |
| `sched_getaffinity`, `sched_getparam`, `sched_getscheduler` | Pool sizing and glibc thread attributes |
| `epoll_ctl`; x86_64 `epoll_wait`; aarch64 `epoll_pwait` | Tokio/Mio reactors for both execution lanes and per-isolate event loops |
| x86_64 `pkey_alloc`, `pkey_mprotect`, `uname` | V8's existing protection-key/JIT mapping support and platform detection |

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

`provision.sh <launcher> <sidecar> <snapshots>` installs the release artifacts at the fixed paths and
creates the 1001/1002 accounts; the image and the `sandbox-test` stage run it as root.
Build the stage with `docker buildx build --target sandbox-test --load -t ryot-sandbox-test .`, then run
the launcher suite as root under Docker's default seccomp profile and capabilities, without extra
`docker run` flags: `docker run --rm --user 0 -w /app/kernel/sandboxd ryot-sandbox-test cargo test
--test launcher -- --ignored --test-threads=1`. The root-only launcher tests are `#[ignore]`d, so
plain `cargo test` skips them.

## Protocol

Frames are a 4-byte big-endian length and a JSON payload of at most 256 KiB. The schema source of
truth is `kernel/backend/src/lib/infrastructure/sandbox-runtime/sidecar-protocol.ts`; messages larger
than 64 KiB travel as base64 `part` frames, and the sidecar writes one part per execution in turn.
The sidecar stops reading while a lane queue is full, so the backend must keep each lane's
outstanding runs within its threads plus queue: a blocked reader also holds back host results.

`bun run protocol:fixtures` regenerates `protocol-fixtures/` from the schema; `check` fails when they
are stale, and both the Rust and TypeScript tests decode and re-encode every fixture.

## Build

`bun turbo build --filter=@ryot-app/kernel-backend` writes the runtime payload to `payload/`. The
crate's build script builds the `core`, `data`, and `full` snapshots from it, checks the registered
ops against `ops.inventory`, and writes the digest manifest. The isolate surface is `js/bootstrap.js`,
plus `js/full.js` on the `full` tier.
