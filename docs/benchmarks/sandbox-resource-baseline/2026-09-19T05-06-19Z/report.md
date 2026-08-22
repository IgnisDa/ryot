# Sandbox Resource Baseline 2026-09-19T05-06-19Z

## What was measured

- Image: ghcr.io/ignisda/ryot:pr-1832 (sha256:3276f63b5e584673cb42b6d7763c31d00fec4a85825aa19a2ceb75ce646709b1, revision 5079c342f60615c6d9c9173d3869d56c91339c22).
- Host: 2 vCPU, 4000043008 bytes RAM, swap 0 bytes, kernel 7.0.0-30-generic.
- Application sampling was configured for 200 ms and remained below the five-second integrity
  limit, with a maximum observed gap of 952 ms.
- OTLP and the watchdog remained healthy. The host sampler was not healthy for baseline analysis:
  sequential `docker stats` calls produced 8-9 second intervals instead of the configured 1 second,
  and the local SSH stream ended before the run completed.

## What was not measured

- This was a targeted correctness validation for Effect issue 8238. It did not rerun the idle,
  durable-host-call, concurrency, import, failure, restart, or live-provider scenarios.
- Host-level CPU, pressure, reclaim, fault, disk, and container-memory comparisons are invalid
  because the host sampler missed its required cadence.
- OTLP output was captured off-repository for teardown verification, but trace-derived analysis is
  outside this targeted run.

## Reproduction fidelity and known differences from the incident host

- The run used the canonical 2-vCPU, 4-GB, no-swap host and the deployed
  `ghcr.io/ignisda/ryot:pr-1832` image with Effect 4.0.0-rc.116.
- The sandbox remained in `on-demand` mode. Current worker concurrency defaults to two rather than
  the historical value of five; every selected scenario had concurrency one, so this did not alter
  the exercised path.
- Each workload used the remote test-support API to install and enqueue a deterministic private
  script, matching the discarded workflow execution path affected by issue 8238.
- The manifest records the implementation and CI-trigger commit IDs deployed for the run. Those
  historical IDs precede the authorized post-run message-only history rewrite.

## Scenario results

| Scenario | Outcome | Concurrency | Success | Peak Bun RSS | Peak Deno RSS | Peak workers | Recovered after (ms) |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 05a-direct-64kib-payload | completed | 1 | 5/5 | 846336000 | 0 | 0 | 109 |
| 05-direct-1mib-payload | completed | 1 | 5/5 | 870604800 | 83935232 | 1 | 141 |
| 06-direct-large-payload | completed | 1 | 5/5 | 925073408 | 258629632 | 1 | 340 |

All 15 accepted executions reached a terminal completed state. Encoded response lengths were
65,571 bytes, 1,048,613 bytes, and 3,900,037 bytes respectively. No request failed, timed out, or
reported a failure stage.

## Scaling ratios

| Metric | Baseline | Compared | Baseline value | Compared value | Ratio |
| --- | --- | --- | --- | --- | --- |

No scaling ratio is reported because each payload size is a distinct correctness boundary rather
than a comparable concurrency workload.

## Latency

| Payload | p50 (ms) | p95 (ms) |
| --- | ---: | ---: |
| 64 KiB | 1398 | 1455 |
| 1 MiB | 2342 | 2406 |
| 3,900,000 bytes | 3770 | 3981 |

The run observed prompt terminal completion at every payload boundary. The recovery values in the
scenario summary describe the application sampler, but resource conclusions must not be drawn from
this run because host sampling was invalid and the 64 KiB execution completed between worker
samples.

## OOM and watchdog events

- The watchdog did not trigger.
- Host `/proc/vmstat` reported zero OOM kills after the run.
- Application cgroup samples reported an OOM-kill delta of zero for every scenario.
- Ryot, PostgreSQL, Redis, and the OTLP collector remained running through completion.

## Evidence-backed conclusions

- Effect 4.0.0-rc.116 completed every accepted discarded sandbox execution at 64 KiB, 1 MiB, and
  just below the 4 MiB result limit.
- Five repetitions at each boundary completed without a lost durable-deferred wake, timeout,
  failure, OOM event, or watchdog stop.
- This satisfies the application correctness condition attached to Effect issue 8238. It does not
  constitute a replacement resource baseline because host telemetry cadence was invalid.

## Hypotheses supported, rejected, or unresolved

- Rejected for this run: accepted large-result executions remain durably suspended after the
  deferred result is persisted.
- Supported: terminal latency increases with encoded result size in this single-execution matrix.
- Unresolved: host CPU, memory-pressure, reclaim, disk, and complete memory-recovery behavior.
