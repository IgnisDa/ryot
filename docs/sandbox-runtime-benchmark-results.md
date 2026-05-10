# Sandbox Runtime Benchmark Results

These results cover the production Docker Compose image with configurable Deno process modes. The run
used the standard benchmark settings: 15 direct samples and three benchmark warm-ups per workload.

Environment: Docker Compose, Bun 1.3.14, Deno 2.8.1, macOS arm64 with Docker, Apple M4 host.

## Memory

| Metric                               | On-Demand |      Warm |
| ------------------------------------ | --------: | --------: |
| Idle Deno workers                    |         0 |         7 |
| Idle worker RSS                      |     0 MiB |  ~507 MiB |
| Stable idle `docker stats` memory    |   582 MiB |   918 MiB |
| Observed sampled `docker stats` peak | 752.3 MiB | 911.8 MiB |

Docker memory includes the Bun backend, Deno children, allocator overhead, and container-level
memory accounting. Worker RSS is the sum reported by the backend for tracked Deno processes.

## Latency

| Workload                 |    p50 |
| ------------------------ | -----: |
| No-host automation       | 184 ms |
| Full automation          | 405 ms |
| Controlled HTTP provider | 376 ms |
| Youtubei provider        | 643 ms |

These latency values are on-demand benchmark observations, not acceptance thresholds.
