# Sandbox Resource Baseline — 2026-09-13T20-19-50Z

Evidence collected against the current architecture on the canonical self-hosted profile. This
report states measurements and which hypotheses they support. It does not recommend or evaluate
fixes.

Companion files in this directory:

- `manifest.json` — environment, image, deployment settings and the scenario definitions
- `summary.json` — per-scenario aggregates and declared scaling ratios
- `scenarios/` — one file per completed repetition, with the 200 ms application series and the host
  series
- `defects.md` — product defects and harness issues encountered, with evidence

All figures below are medians across repetitions unless stated. `MB` is MiB.

## What was measured

- Backend (Bun) RSS, heap, external memory and CPU; every Deno sandbox worker's RSS and CPU; the Ryot
  container cgroup's memory, memory events, pids and CPU — sampled every 200 ms through the
  admin-gated runtime snapshot.
- Process spawns, sandbox executions, workflow replays and cumulative journal bytes as monotonic
  process-lifetime counters, reported as per-repetition deltas.
- Host `MemAvailable`, CPU/memory/IO pressure, page faults, page reclaim, block-device reads and
  per-container Docker statistics from a host sampler.
- Import latency and terminal outcome per request, through the public provider import API.
- The production OTLP export of all 18 metrics in the plan, captured by a pinned collector.

## What was not measured

- **Payload-size scaling.** `05-direct-1mib-payload` aborted and `06-direct-large-payload` never ran:
  a large sandbox result leaves its workflow permanently suspended (`defects.md` §1). The
  `payload:peakBackendRssBytes` ratio in `summary.json` compares against that aborted repetition and
  carries no payload information.
- **Full-import phase overlap.** `ryot.provider_import.phase_duration` and
  `ryot.provider_import.active` were exported and captured, but the overlap between population,
  lifecycle dispatch and provider-import automation was not analysed for this report.
- **Trace-derived replay detail for Groups A, B and early C.** The collector's file exporter rotated
  out trace files older than 05:35 UTC. Metrics were retained in full.
- **Host series at 1 Hz.** See _Reproduction fidelity_.

## Environment

| item                  | value                                                           |
| --------------------- | --------------------------------------------------------------- |
| host                  | 2 vCPU AMD EPYC-Rome, 4 000 034 816 B RAM, no swap              |
| kernel / Docker       | 7.0.0-30-generic / 29.8.0, cgroup v2, ext4 on a 37.2 GiB disk   |
| image                 | `ghcr.io/ignisda/ryot:pr-1832` `sha256:e8fc6888…df0d`, amd64    |
| runtimes              | Bun 1.4.0, Deno 2.8.1                                           |
| sandbox process mode  | `on-demand`, worker concurrency 5                               |
| scheduler dispatchers | disabled for every scenario                                     |
| log level             | `info`                                                          |
| container limits      | none on Ryot, PostgreSQL or Redis; 128 MiB on the OTLP collector |

Commits: the image was built by workflow run 34778560802 from pull-request head `3ec544225b`, whose
implementation commit was `58d12dbbae`. The branch was later rewritten to retag commit messages, so
those commits now appear as `aea928bda6` and `b8c4818c0b`. The image's OCI revision label is GitHub's
ephemeral merge commit `34cbb9a4`, not the head (`defects.md` §5).

## Reproduction fidelity

Known differences from the incident host and from the plan:

- **Canonical profile, not the incident host.** 4.0 GB here against 3.7 GiB usable on the incident
  host. A 128 MiB-capped collector also ran on this host.
- **Host sampler resolution was about 8 s, not 1 s.** The sampler ran for the full 12.6 h without
  stopping, but calls `docker stats --no-stream` once per container, and each call blocks for about
  2 s. Its interval was p50 8 s, p95 9 s, so every gap exceeded the plan's 5 s limit. Host minima
  such as `MemAvailable` may therefore be higher than the true instantaneous minimum. Cgroup peaks
  come from `memory.peak` and are exact.
- **Watchdog.** Host-wide conditions were evaluated about every second and none was met. Two defects
  in the watchdog mean its ability to stop the stack is unverified: its Ryot-cgroup check resolves a
  container by substring and may have read another container, and its stop action filters on a
  compose project name that Coolify does not use (`defects.md` §4).
- **Recovery windows.** Groups A and B used a 60 s recovery window; every other group used 300 s.
- **Backend process age.** Every scenario before Group E ran on one long-lived backend process.
  Group E and the live runs ran on processes freshly started by a container restart or database
  reset. Idle RSS differs by about 300 MB between the two (see _Backend memory_).
- **Database state.** The database was reset before Group A, before Group B and before each live run.
  Groups B, C, D and E share one database.
- **Missing repetitions.** `16-import-concurrency-20` has four of five repetitions (connection reset
  during CPU saturation, `defects.md` §2).

## Idle baseline

`00-idle`, ten minutes after startup on the long-lived process: Bun RSS 887 MB with a 224 MB heap, no
Deno workers, Ryot cgroup 897 MB, host `MemAvailable` minimum 2244 MiB, CPU pressure 11.4.

A freshly started backend idles lower: 560–580 MB RSS immediately after the Group E restarts, and
735 MB immediately after a database reset.

## Deno worker memory

Per-worker peak RSS is close to constant within a workload class and independent of host-call count.
The ranges below are per-scenario medians; individual hermetic repetitions ranged from 86 MB to
132 MB when a short-lived worker was sampled only partway through its life:

| workload class       | per-worker peak | scenarios                          |
| -------------------- | --------------- | ---------------------------------- |
| hermetic direct      | 100–126 MB      | `02`–`04`, `07`–`10`, `17`–`19`    |
| hermetic import      | 126–131 MB      | `11`–`16`, `20`                    |
| live YouTube Music   | 396–409 MB      | `21`–`23`                          |

Aggregate Deno RSS is per-worker size multiplied by live workers, and the worker count never exceeded
the bound of five:

| scenario                       | peak workers | Deno aggregate |
| ------------------------------ | ------------ | -------------- |
| `07-concurrency-1`             | 1            | 122 MB         |
| `08-concurrency-2`             | 2            | 225 MB         |
| `09-concurrency-5`             | 5            | 489 MB         |
| `10-concurrency-20`            | 5            | 563 MB         |
| `16-import-concurrency-20`     | 5            | 613 MB         |
| `22-live-youtube-music-five`   | 5            | 1703 MB        |
| `23-live-youtube-music-twenty` | 5            | 1891 MB        |

Live workers are 3.0–3.3× the size of hermetic workers, so the same five-worker bound admits about
1.9 GB of Deno RSS under the live workload against about 0.6 GB under the hermetic workload.

## Backend memory

Peak Bun RSS rises with work in flight and with related-entity fan-out:

| scenario                       | Bun peak | heap peak |
| ------------------------------ | -------- | --------- |
| `11-import-no-related`         | 916 MB   | 235 MB    |
| `12-import-10-related`         | 973 MB   | 271 MB    |
| `13-import-100-related`        | 1112 MB  | 374 MB    |
| `14-import-concurrency-2`      | 1066 MB  | 314 MB    |
| `15-import-concurrency-5`      | 1156 MB  | 376 MB    |
| `16-import-concurrency-20`     | 1320 MB  | 418 MB    |
| `23-live-youtube-music-twenty` | 1074 MB  | 428 MB    |

Recovery to within 10 % of the pre-scenario Bun RSS:

- under 1 s for every direct scenario and for single imports without heavy fan-out;
- 2.2 s after one import with 100 related entities;
- medians of 1.6–7.1 s for concurrent hermetic imports, with individual repetitions ranging from
  under 0.1 s to 20.6 s;
- 19 s for twenty typed failures;
- 146 s after twenty live imports.

Between scenarios, the long-lived process did not return to its idle 887 MB after the heavier import
scenarios; spot readings between repetitions ranged from 908 MB to 1107 MB while Groups C and D ran.

## Replay scaling

Every durable host call re-runs the script. Process spawns follow 2N + 1 for N durable host calls,
and replays grow faster than linearly:

| durable host calls | spawns | replays | cumulative journal bytes |
| ------------------ | ------ | ------- | ------------------------ |
| 0                  | 1      | 2       | 0 KB                     |
| 1                  | 3      | 9       | 1 KB                     |
| 5                  | 11     | 77      | 45 KB                    |
| 10                 | 21     | 252     | 317 KB                   |

Concurrency multiplies this cost without adding to it: twenty concurrent five-call executions cost
exactly twenty times one (220 spawns, 1540 replays).

Related-entity fan-out dominates import cost. One import with 100 related entities and 100
suggestions took 64.9 s, 314 spawns and 1271 replays, against 7.6 s, 14 spawns and 86 replays with
none.

The cumulative journal counter sums the journal size observed at every replay, so it grows with both
replay count and result size. Hermetic imports stayed under 2.6 MB. Live imports reached 24.7 MB for
one import, 90.8 MB for five and 338.7 MB for twenty.

## CPU, reclaim, faults and disk

CPU pressure (`some avg10`) exceeded 85 in every heavy scenario: `10`, `13`, `15`, `16`, `19`, `20`,
`22` and `23`. It peaked at 97.9 during twenty live imports. Memory pressure (`full avg10`) never
exceeded 0.5 in any scenario.

Page reclaim and major faults stayed near zero across hermetic direct scenarios and appeared under
import and live load:

| scenario                       | major faults | pages scanned | sectors read |
| ------------------------------ | ------------ | ------------- | ------------ |
| `13-import-100-related`        | 24           | 16 233        | 18 240       |
| `16-import-concurrency-20`     | 98           | 19 108        | 16 952       |
| `22-live-youtube-music-five`   | 1 520        | 205 123       | 275 512      |
| `23-live-youtube-music-twenty` | 2 955        | 211 822       | 470 448      |

Host deltas are per repetition over the host sampler's roughly 8 s resolution.

## Concurrency and failure paths

- Five typed provider failures used 55 spawns and 385 replays, 11 spawns and 77 replays per import.
  A successful import without related entities cost 14 spawns and 86 replays, so a typed failure is
  slightly cheaper: it surfaces after the provider's durable calls and before the later import
  phases. Exactly one replay per import failed, so a typed failure was not retried.
- Sandbox timeouts fired at 33.8 s against the 30 s limit, cost one spawn per execution and were not
  retried. All five workers ran concurrently, and they drained within 186–332 ms of the timeout.

## Restart recovery

`20-restart-recovery` submitted twenty standard imports and restarted only the Ryot container once
five workers were live, 32.2 s after submission. PostgreSQL and Redis kept running.

- Durable work resumed automatically, and all twenty imports completed, at a p50 of 187.1 s against
  168.2 s without a restart.
- In the 300 s after the restart the new process performed 797 spawns and 3608 replays, about 90 % of
  the work of an entire uninterrupted twenty-import repetition (880 spawns, 3967 replays).
- Peaks were lower than the uninterrupted run: Bun 867 MB and cgroup 1093 MB. The restarted process
  started from about 570 MB.

The repetition's counter deltas in its scenario file are negative because the counters reset with the
process; the figures above come from the sample series either side of the reset. The restart was
performed with `docker restart` on the host, because a Coolify service restart would also have
restarted PostgreSQL and Redis.

## Live YouTube Music comparison

Search `furious` with `pageSize=20`, each run from a freshly reset database:

| scenario     | imports | completed | latency p50 | spawns | replays | Deno peak | cgroup peak | host `MemAvailable` min |
| ------------ | ------- | --------- | ----------- | ------ | ------- | --------- | ----------- | ----------------------- |
| single       | 1       | 1         | 11.2 s      | 17     | 68      | 396 MB    | 1187 MB     | 1926 MiB                |
| five         | 5       | 4         | 35.7 s      | 66     | 266     | 1703 MB   | 2275 MB     | 1385 MiB                |
| twenty, once | 20      | 16        | 141.8 s     | 263    | 1022    | 1891 MB   | 2501 MB     | 492 MiB                 |

Every failed live import failed in population with a PostgreSQL deadlock (`defects.md` §3). No
throttling or provider drift was observed.

A live import costs fewer spawns and replays than the hermetic standard import, but each worker is
three times larger and the durable journal carries far more data.

## OOM and watchdog events

- No kernel OOM kill, no cgroup `oom_kill` event and no container `OOMKilled` state in any scenario.
- No watchdog trigger.
- The closest approach was `23-live-youtube-music-twenty`: host `MemAvailable` reached 492 MiB, and
  the Ryot cgroup peaked at 2501 MB. The watchdog floors are 384 MiB and 2560 MB.

## Hypotheses

**Supported**

- Aggregate Deno RSS scales linearly with live workers and is bounded by the five-worker queue.
- Per-worker Deno RSS depends on the workload: live YouTube Music workers are about three times the
  size of hermetic workers.
- Durable host calls drive super-linear replay growth, and replay cost carries the accumulated
  journal, which grows with result size.
- A container restart resumes durable work and repeats most of the work that was in flight.
- Under live and high fan-out import load the host enters page reclaim with major faults and
  increased disk reads, while memory pressure stalls stay negligible.
- The heavy workloads in this matrix are CPU-bound on two vCPUs.

**Rejected on this build**

- Twenty concurrent imports of the incident's shape exhaust memory on the canonical profile. Neither
  the hermetic nor the live twenty-import runs caused an OOM kill.
- Sandbox timeouts or typed failures trigger retry storms or leave workers behind.
- Concurrency adds per-execution overhead beyond the work it multiplies.

**Unresolved**

- Whether the incident host's smaller usable memory, or a longer-lived backend process with more
  accumulated RSS, would turn the 492 MiB margin measured here into an OOM.
- How much of backend memory growth comes from queued workflows as opposed to related-entity
  population, since both rise together in these scenarios.
- Payload-size scaling and whether large results amplify backend memory.
- Overlap between import phases outside the sandbox queue.
- The cause and commit of the large-result workflow suspension, and of the concurrent population
  deadlock.
