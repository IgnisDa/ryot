# Sandbox Isolate Runtime Spike

The isolate runtime plan and its records:

- [`plan.md`](plan.md): outcome, decisions, architecture, and slices.
- [`s1.md`](s1.md) and [`s2.md`](s2.md): slice contracts, acceptance, and results.
- [`security-review.md`](security-review.md): pre-approval security findings and their owners.
- [`evidence.md`](evidence.md): spike measurements and pitfalls.

The rest of this directory is throwaway spike code behind that evidence. It is not production code: it skips the op allowlist, OS confinement, protocol framing, the backend
host-call gate, and every other hardening the plan requires. Use it to see working `deno_core` API
usage and to reproduce measurements, not as a starting point to copy.

| Path                      | Contents                                                                                                                                                                                                               |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `sidecar/Cargo.toml`      | Pinned `deno_core` 0.412, `deno_web` 0.290, `deno_webidl` 0.259 (the Deno 2.9.7 crate set)                                                                                                                             |
| `sidecar/src/main.rs`     | `snapshot`, `probe`, and `serve` modes: snapshot building, isolate-per-execution on pooled threads, async host-call op, heap-limit callback, counting ArrayBuffer allocator, thread-CPU watchdog, lane thread priority |
| `sidecar/js/bootstrap.js` | Snapshot-time global installation and per-execution lockdown (uses `deno_web`, which the plan rejects)                                                                                                                 |
| `workloads/`              | Benchmark workloads (`noop`, `host5`, `cpu`), containment probes (`loop`, `fillloop`, `heap*`, `arraybuffer`), `escape`, `leak-a`/`leak-b`, and `deno-harness.mjs` for the per-process Deno baseline                   |
| `scripts/driver.ts`       | Bun host driver: `sidecar` and `deno` modes, 25 ms host-call answers, latency, CPU, and RSS sampling                                                                                                                   |
| `scripts/fairness.ts`     | Interactive versus background lane probe over one connection                                                                                                                                                           |
| `scripts/extract.ts`      | Writes the runtime payload and runner from the generated TypeScript modules into a directory                                                                                                                           |
| `scripts/*.sh`            | Spike-host helpers for starting the sidecar, the concurrency sweep, and the soak; they assume the spike layout under `/root/spike`                                                                                     |
| `v8-termination-repro/`   | Pure `rusty_v8` repro filed as [denoland/rusty_v8#2088](https://github.com/denoland/rusty_v8/issues/2088)                                                                                                              |

Reproducing on a Linux host: build the sidecar with `cargo build --release`, extract the payload with
`bun scripts/extract.ts <dir>`, build a snapshot with `sidecar snapshot <dir> snap.bin <modules…>`
(Effect first), start `sidecar serve snap.bin <dir> <socket> <threads>`, and run
`bun scripts/driver.ts sidecar <workload> <n> <concurrency> [heapMiB cpuMs abMiB lane]`.
