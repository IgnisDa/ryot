# Cleanup benchmarks

Measurements taken after the `[v8-isolates-cleanup]` slices K1–K9 (split mode removed, single server process), on the reference host.

## Host

- AMD EPYC-Genoa, 2 vCPU, 3.9 GiB RAM, no swap, Linux 7.0.0-38-generic, Docker 29.1.3, Bun 1.4.3.
- `SANDBOX_WORKER_CONCURRENCY=2`, `SANDBOX_MEMORY_BUDGET_MIB=1904`, `DATABASE_POOL_MAX=10`.
- Revision: `54e4ac35ea` (K9) for latency at nice 10, import and replay; `611bb2f0f2` for latency at nice 19 and fairness.

## Latency (pooled p95, 2 pairs × 200 measured requests)

| Endpoint | Unloaded p95 | Loaded p95 | Ratio | Split mode ratio | Earlier single-process ratio |
| --- | --- | --- | --- | --- | --- |
| search (nice 10) | 286 ms | 947 ms | 3.31× | 1.31× | ~3.35× |
| details (nice 10) | 3133 ms | 11845 ms | 3.78× | 1.75× | ~4.0× |
| search (nice 19) | 286 ms | 988 ms | 3.45× | | |
| details (nice 19) | 3190 ms | 11787 ms | 3.70× | | |

Loaded CPU busy reached 97%. Nice 19 for background sidecar threads did not improve loaded p95, so background threads stay at nice 10.

## Fairness

Pass: admission difference 1 (tolerance 2), execution difference 1 (tolerance 4), no failures, background work progressed throughout the 180 s window.

## Import and replay

| Run | Wall time | Sandbox executions | Server RSS |
| --- | --- | --- | --- |
| K9 trial 1 | 1177 s | 5988 | ~810 MiB |
| K9 trial 2 | 1190 s | 6061 | ~810 MiB |
| K9 trial 3 | 1199 s | 6178 | ~810 MiB |
| pre-cleanup `652b560f28` | 1179 s | 5849 | 792 MiB |
| K1 `486fbb5cc9` | 1206 s | 5975 | 803 MiB |

All runs imported 1001 items with identical business rows. S5 measured ~1000 s on the same host; the pre-cleanup revision now measures the same as K9, so the difference is host drift, not a regression from the cleanup. Replay matched S5: HTTP spacing 65–86 ms, peak RSS 457–469 MiB.

## No-op execution

`cargo bench --bench noop` with the memory budget sized for its 50 parked isolates: core no-op p50 7.77 ms, 7.17 MiB per live isolate, sidecar RSS 51.8 MiB idle and 410.2 MiB with 50 live isolates.
