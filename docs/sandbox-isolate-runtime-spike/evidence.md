# Spike evidence

Measurements and pitfalls behind [the isolate runtime plan](plan.md).

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

## Pitfalls found by the spike

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
