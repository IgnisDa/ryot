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

## Launcher

On Linux the backend never runs `ryot-sandboxd` directly. The root-owned setuid
`ryot-sandbox-launcher` accepts only the UID-1001 backend with one connected socket on descriptor 3,
clears the environment and other descriptors, sets `oom_score_adj` 1000, drops to UID/GID 1002, and
executes the fixed installed sidecar and snapshots. `ryot-sandbox-launcher terminate <pid>` kills
only a direct child of the caller that matches its root-owned launch attestation, through a pidfd.

`provision.sh <launcher> <sidecar> <snapshots>` installs the release artifacts at the fixed paths and
creates the 1001/1002 accounts; the image and Linux test setups run it as root.
`tests/launcher/test-default-docker.sh` builds and runs the launcher suite as root under Docker's
default seccomp profile. The root-only launcher tests are `#[ignore]`d, so plain `cargo test` skips
them and the script runs them with `--ignored`.

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

`bench/run.sh` measures `core` no-op latency and per-execution RSS; its thresholds apply only on the
reference 2 vCPU / 4 GB x86_64 host. `bench/import.py --runtime sidecar --output <dir>` runs the e2e
standard-import benchmark three times on that host, recording wall time, peak backend and child RSS,
container memory, and business rows; it fails a trial that stops making progress for five minutes.
