# Sandbox Resource Follow-Up 2026-09-22T11-45-22Z

## What was measured

- Image `ghcr.io/ignisda/ryot@sha256:3df726ccc208b3ae18bb68cd0fa1fd063d91e158e0d703a9dd1ef7c3844d1605` (sha256:3df726ccc208b3ae18bb68cd0fa1fd063d91e158e0d703a9dd1ef7c3844d1605).
- Bun 1.4.0, Deno 2.8.1, Effect 4.0.0-rc.117.
- Invocations: 4. Constituent runs: 2026-09-22T11-45-22Z.

| Series | Interval (ms) | Gate |
| --- | --- | --- |
| application | 200 | {"p50MinMs":0,"p50MaxMs":300,"p95MaxMs":500,"maxIntervalMs":2000,"maxMissedSlotRatio":0.01} |
| host | 1000 | {"p50MinMs":900,"p50MaxMs":1100,"p95MaxMs":1250,"maxIntervalMs":2000,"maxMissedSlotRatio":0.01} |

## Idle baselines

| Scenario | Concurrency | Reps (ok/req) | Throughput/min | Request p95 (ms) | Peak Bun RSS Δ (MiB) | Peak Deno RSS Δ (MiB) | Scenario cgroup peak (MiB) | Worker peak (MiB) | Drain (s) |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |

## Hermetic concurrency matrix

| Scenario | Concurrency | Reps (ok/req) | Throughput/min | Request p95 (ms) | Peak Bun RSS Δ (MiB) | Peak Deno RSS Δ (MiB) | Scenario cgroup peak (MiB) | Worker peak (MiB) | Drain (s) |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |

| Scenario | Ryot CPU (s) | CPU PSI some avg10 max | Memory PSI full avg10 max | MemAvailable min (MiB) | Major faults | Disk sectors read | Health p95 (ms) | DB active max |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |

| Scenario | Executions | Processes spawned | Replays started | Durable requests | Journal bytes |
| --- | --- | --- | --- | --- | --- |

## Live YouTube Music concurrency matrix

| Scenario | Concurrency | Reps (ok/req) | Throughput/min | Request p95 (ms) | Peak Bun RSS Δ (MiB) | Peak Deno RSS Δ (MiB) | Scenario cgroup peak (MiB) | Worker peak (MiB) | Drain (s) |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| live-c1 | 1 | 3/3 | 2.9 | 438104 | 232.3 | 427.0 | 991.7 | 431.6 | 0.2 |
| live-c2 | 2 | 3/3 | 4.0 | 313851 | 261.7 | 803.8 | 1300.9 | 421.0 | 0.1 |
| live-c3 | 3 | 3/3 | 3.9 | 324313 | 306.8 | 1167.0 | 1554.4 | 420.4 | 0.1 |
| live-c5 | 5 | 3/3 | 4.1 | 305640 | 290.1 | 1864.9 | 2192.9 | 410.6 | 0.1 |

| Scenario | Ryot CPU (s) | CPU PSI some avg10 max | Memory PSI full avg10 max | MemAvailable min (MiB) | Major faults | Disk sectors read | Health p95 (ms) | DB active max |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| live-c1 | 638.6 | 70.1 | 0.00 | 1823.8 | 13 | 2312 | 78 | — |
| live-c2 | 554.8 | 85.2 | 0.00 | 1446.9 | 41 | 5408 | 452 | — |
| live-c3 | 579.8 | 93.6 | 0.00 | 1270.3 | 17 | 2048 | 954 | — |
| live-c5 | 554.1 | 98.7 | 0.57 | 673.1 | 698 | 73696 | 1298 | — |

## Scaling ratios

| Metric | Baseline | Compared | Baseline median | Compared median | Ratio |
| --- | --- | --- | --- | --- | --- |
| requests.throughputPerMinute | hermetic-c1 | hermetic-c2 | — | — | fewer than the required repetitions completed for hermetic-c1 |
| requests.latencyMs.p95 | hermetic-c1 | hermetic-c2 | — | — | fewer than the required repetitions completed for hermetic-c1 |
| peakDelta.bunRssBytes | hermetic-c1 | hermetic-c2 | — | — | fewer than the required repetitions completed for hermetic-c1 |
| peakDelta.denoAggregateRssBytes | hermetic-c1 | hermetic-c2 | — | — | fewer than the required repetitions completed for hermetic-c1 |
| ryot.cgroupScenarioPeakBytes | hermetic-c1 | hermetic-c2 | — | — | fewer than the required repetitions completed for hermetic-c1 |
| ryot.cgroupCpuMs | hermetic-c1 | hermetic-c2 | — | — | fewer than the required repetitions completed for hermetic-c1 |
| host.cpuPsiSomeAvg10Max | hermetic-c1 | hermetic-c2 | — | — | fewer than the required repetitions completed for hermetic-c1 |
| health.latencyMs.p95 | hermetic-c1 | hermetic-c2 | — | — | fewer than the required repetitions completed for hermetic-c1 |
| counters.processesSpawned | hermetic-c1 | hermetic-c2 | — | — | fewer than the required repetitions completed for hermetic-c1 |
| counters.replayJournalBytes | hermetic-c1 | hermetic-c2 | — | — | fewer than the required repetitions completed for hermetic-c1 |
| requests.throughputPerMinute | hermetic-c1 | hermetic-c3 | — | — | fewer than the required repetitions completed for hermetic-c1 |
| requests.latencyMs.p95 | hermetic-c1 | hermetic-c3 | — | — | fewer than the required repetitions completed for hermetic-c1 |
| peakDelta.bunRssBytes | hermetic-c1 | hermetic-c3 | — | — | fewer than the required repetitions completed for hermetic-c1 |
| peakDelta.denoAggregateRssBytes | hermetic-c1 | hermetic-c3 | — | — | fewer than the required repetitions completed for hermetic-c1 |
| ryot.cgroupScenarioPeakBytes | hermetic-c1 | hermetic-c3 | — | — | fewer than the required repetitions completed for hermetic-c1 |
| ryot.cgroupCpuMs | hermetic-c1 | hermetic-c3 | — | — | fewer than the required repetitions completed for hermetic-c1 |
| host.cpuPsiSomeAvg10Max | hermetic-c1 | hermetic-c3 | — | — | fewer than the required repetitions completed for hermetic-c1 |
| health.latencyMs.p95 | hermetic-c1 | hermetic-c3 | — | — | fewer than the required repetitions completed for hermetic-c1 |
| counters.processesSpawned | hermetic-c1 | hermetic-c3 | — | — | fewer than the required repetitions completed for hermetic-c1 |
| counters.replayJournalBytes | hermetic-c1 | hermetic-c3 | — | — | fewer than the required repetitions completed for hermetic-c1 |
| requests.throughputPerMinute | hermetic-c1 | hermetic-c5 | — | — | fewer than the required repetitions completed for hermetic-c1 |
| requests.latencyMs.p95 | hermetic-c1 | hermetic-c5 | — | — | fewer than the required repetitions completed for hermetic-c1 |
| peakDelta.bunRssBytes | hermetic-c1 | hermetic-c5 | — | — | fewer than the required repetitions completed for hermetic-c1 |
| peakDelta.denoAggregateRssBytes | hermetic-c1 | hermetic-c5 | — | — | fewer than the required repetitions completed for hermetic-c1 |
| ryot.cgroupScenarioPeakBytes | hermetic-c1 | hermetic-c5 | — | — | fewer than the required repetitions completed for hermetic-c1 |
| ryot.cgroupCpuMs | hermetic-c1 | hermetic-c5 | — | — | fewer than the required repetitions completed for hermetic-c1 |
| host.cpuPsiSomeAvg10Max | hermetic-c1 | hermetic-c5 | — | — | fewer than the required repetitions completed for hermetic-c1 |
| health.latencyMs.p95 | hermetic-c1 | hermetic-c5 | — | — | fewer than the required repetitions completed for hermetic-c1 |
| counters.processesSpawned | hermetic-c1 | hermetic-c5 | — | — | fewer than the required repetitions completed for hermetic-c1 |
| counters.replayJournalBytes | hermetic-c1 | hermetic-c5 | — | — | fewer than the required repetitions completed for hermetic-c1 |
| requests.throughputPerMinute | live-c1 | live-c2 | 3 | 4 | 1.40 |
| requests.latencyMs.p95 | live-c1 | live-c2 | 438104 | 313851 | 0.72 |
| peakDelta.bunRssBytes | live-c1 | live-c2 | 243589120 | 274374656 | 1.13 |
| peakDelta.denoAggregateRssBytes | live-c1 | live-c2 | 447729664 | 842870784 | 1.88 |
| ryot.cgroupScenarioPeakBytes | live-c1 | live-c2 | 1039839232 | 1364078592 | 1.31 |
| ryot.cgroupCpuMs | live-c1 | live-c2 | 638583 | 554829 | 0.87 |
| host.cpuPsiSomeAvg10Max | live-c1 | live-c2 | 70 | 85 | 1.22 |
| health.latencyMs.p95 | live-c1 | live-c2 | 78 | 452 | 5.77 |
| counters.processesSpawned | live-c1 | live-c2 | 343 | 345 | 1.01 |
| counters.replayJournalBytes | live-c1 | live-c2 | 339240476 | 339242399 | 1.00 |
| requests.throughputPerMinute | live-c1 | live-c3 | 3 | 4 | 1.35 |
| requests.latencyMs.p95 | live-c1 | live-c3 | 438104 | 324313 | 0.74 |
| peakDelta.bunRssBytes | live-c1 | live-c3 | 243589120 | 321662976 | 1.32 |
| peakDelta.denoAggregateRssBytes | live-c1 | live-c3 | 447729664 | 1223692288 | 2.73 |
| ryot.cgroupScenarioPeakBytes | live-c1 | live-c3 | 1039839232 | 1629945856 | 1.57 |
| ryot.cgroupCpuMs | live-c1 | live-c3 | 638583 | 579783 | 0.91 |
| host.cpuPsiSomeAvg10Max | live-c1 | live-c3 | 70 | 94 | 1.34 |
| health.latencyMs.p95 | live-c1 | live-c3 | 78 | 954 | 12.19 |
| counters.processesSpawned | live-c1 | live-c3 | 343 | 343 | 1.00 |
| counters.replayJournalBytes | live-c1 | live-c3 | 339240476 | 339277681 | 1.00 |
| requests.throughputPerMinute | live-c1 | live-c5 | 3 | 4 | 1.42 |
| requests.latencyMs.p95 | live-c1 | live-c5 | 438104 | 305640 | 0.70 |
| peakDelta.bunRssBytes | live-c1 | live-c5 | 243589120 | 304168960 | 1.25 |
| peakDelta.denoAggregateRssBytes | live-c1 | live-c5 | 447729664 | 1955532800 | 4.37 |
| ryot.cgroupScenarioPeakBytes | live-c1 | live-c5 | 1039839232 | 2299400192 | 2.21 |
| ryot.cgroupCpuMs | live-c1 | live-c5 | 638583 | 554102 | 0.87 |
| host.cpuPsiSomeAvg10Max | live-c1 | live-c5 | 70 | 99 | 1.41 |
| health.latencyMs.p95 | live-c1 | live-c5 | 78 | 1298 | 16.58 |
| counters.processesSpawned | live-c1 | live-c5 | 343 | 351 | 1.02 |
| counters.replayJournalBytes | live-c1 | live-c5 | 339240476 | 339451492 | 1.00 |
| requests.throughputPerMinute | hermetic-c2 | live-c2 | — | 4 | fewer than the required repetitions completed for hermetic-c2 |
| requests.latencyMs.p95 | hermetic-c2 | live-c2 | — | 313851 | fewer than the required repetitions completed for hermetic-c2 |
| peakDelta.bunRssBytes | hermetic-c2 | live-c2 | — | 274374656 | fewer than the required repetitions completed for hermetic-c2 |
| peakDelta.denoAggregateRssBytes | hermetic-c2 | live-c2 | — | 842870784 | fewer than the required repetitions completed for hermetic-c2 |
| ryot.cgroupScenarioPeakBytes | hermetic-c2 | live-c2 | — | 1364078592 | fewer than the required repetitions completed for hermetic-c2 |
| ryot.cgroupCpuMs | hermetic-c2 | live-c2 | — | 554829 | fewer than the required repetitions completed for hermetic-c2 |
| host.cpuPsiSomeAvg10Max | hermetic-c2 | live-c2 | — | 85 | fewer than the required repetitions completed for hermetic-c2 |
| health.latencyMs.p95 | hermetic-c2 | live-c2 | — | 452 | fewer than the required repetitions completed for hermetic-c2 |
| counters.processesSpawned | hermetic-c2 | live-c2 | — | 345 | fewer than the required repetitions completed for hermetic-c2 |
| counters.replayJournalBytes | hermetic-c2 | live-c2 | — | 339242399 | fewer than the required repetitions completed for hermetic-c2 |

## Retention soaks

| Scenario | Concurrency | Reps (ok/req) | Throughput/min | Request p95 (ms) | Peak Bun RSS Δ (MiB) | Peak Deno RSS Δ (MiB) | Scenario cgroup peak (MiB) | Worker peak (MiB) | Drain (s) |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |

## Profile attribution

_Fill from `profiles/summary.json`._

## Conclusions

_Correctness, resource, profiling attribution, retention classification, and unresolved hypotheses._
