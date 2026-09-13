# YouTube Music initialization resource comparison

## Status

**Complete.** Disabling unnecessary player and configuration retrieval reduced unprofiled worker
peak RSS and CPU-seconds in every candidate repetition, with equivalent provider output in the
fixed-response tests and passing live stable-field checks. All 370 measured requests succeeded.
The benchmark service, collectors, and watchdog are stopped.

## Primary results

Each cell is the median of three runs of 30 operations at worker concurrency one. Worker memory
is the maximum lifetime RSS high-water mark among the run's workers, expressed in MiB. CPU is
Ryot container CPU-seconds, including the same five-minute recovery window in every run.

| Operation     | Baseline worker peak | Candidate worker peak | Reduction | Baseline CPU-seconds | Candidate CPU-seconds | Reduction |
| ------------- | -------------------: | --------------------: | --------: | -------------------: | --------------------: | --------: |
| Track search  |           436.34 MiB |            194.11 MiB | **55.5%** |               421.94 |                109.22 | **74.1%** |
| Track details |           432.44 MiB |            194.24 MiB | **55.1%** |               544.67 |                141.65 | **74.0%** |

CPU-seconds per completed operation fell from **14.06 to 3.64** for search and **18.16 to 4.72**
for details. Median request latency also fell, from 10.85 to 2.64 seconds for search and from
14.79 to 4.39 seconds for details; resource acceptance is based on RSS and CPU, not latency.

| Scenario | Variant   | Worker peak RSS across three runs (MiB) | CPU-seconds across three runs |
| -------- | --------- | --------------------------------------- | ----------------------------- |
| Search   | Baseline  | 430.92, 436.34, 437.46                  | 434.91, 421.94, 421.74        |
| Search   | Candidate | 192.92, 194.11, 198.39                  | 110.13, 109.22, 107.89        |
| Details  | Baseline  | 432.44, 432.57, 430.85                  | 562.66, 544.67, 542.18        |
| Details  | Candidate | 198.25, 194.24, 193.74                  | 141.66, 140.95, 141.65        |

The paired supporting check submitted five fixed-result imports together at worker concurrency
two. All five completed in each variant. Worker peak fell from **416.80 to 194.50 MiB (53.3%)**;
CPU fell from **171.55 to 107.09 seconds (37.6%)**. This was one supporting pair, not a repeated
concurrency matrix or a reproduction of the original twenty-import incident.

### Scope of the memory result

The measured reduction is in **worker RSS**. Bun RSS was higher in candidate runs, including
before workload submission. Median peak Bun RSS was 590.07 versus 851.27 MiB for search and
587.45 versus 887.88 MiB for details. Median whole-container memory peaks also rose: 895.67 to
961.73 MiB for search and 887.27 to 1000.58 MiB for details.

Every run restored the same baseline database fixture. Candidate startup installed the changed
archive into that fixture before measurement, while baseline startup already had its archive.
The higher pre-workload Bun RSS makes this setup unsuitable for isolating the change's effect on
long-term Bun memory. These results establish the requested worker-RSS and CPU reductions;
they do not establish a reduction in total container memory at concurrency one.

## Implementation

Commit `9efb3dce68` changes the media-owned factory in
`plugins/media/backend/lib/vendors/youtube-music.ts` to pass `retrievePlayer: false` and
`retrieveInnertubeConfig: false`. Each sandbox execution still creates its own client.

The installed YouTube.js version is 17.2.0. All nine metadata entrypoints use `music.search`,
`music.getUpNext`, `music.getArtist`, or `music.getAlbum`. These methods use search, next, and
browse endpoints without accessing the player. Configuration retrieval adds session configuration
fields; the HTTP client removes `configInfo` from YTMUSIC requests.

The production change is four added lines and one replaced line. The regression suite uses the
real SDK with synthetic HTTP responses and a recording host that rejects unexpected requests.
It covers all nine mappings, direct queues, automix follow-ups, and language propagation.
Fixtures live under `plugins/media/tests/backend/` rather than the archived backend sources.

## Output validation

An ad hoc local validation created the original SDK client with both initialization defaults,
recorded each operation's metadata HTTP responses in memory, then replayed the same responses
through the optimized factory and the production mapping functions. All nine complete mapped
outputs were deeply equal. Each operation used a fresh client.

Independent live calls also passed these checks:

| Operation          | Fixed-response equality | Live comparison                         | Optimized metadata requests |
| ------------------ | ----------------------- | --------------------------------------- | --------------------------: |
| Track search       | Exact                   | All 16 shared result items equal        |                           1 |
| Artist search      | Exact                   | All 19 shared result items equal        |                           1 |
| Album search       | Exact                   | All 20 shared result items equal        |                           1 |
| Track details      | Exact                   | All fields except recommendations equal |                           2 |
| Artist details     | Exact                   | Complete output equal                   |                           1 |
| Album details      | Exact                   | Complete output equal                   |                           1 |
| Track translation  | Exact                   | Complete output equal                   |                           2 |
| Artist translation | Exact                   | Complete output equal                   |                           1 |
| Album translation  | Exact                   | Complete output equal                   |                           1 |

Details used English; translations used French. Search membership/order and related-track
recommendations varied between live requests. Search comparisons matched complete items by their
external identity rather than array position. Track comparisons excluded only the
`media-suggestion` relationship group. Fixed-response equality included those changing fields.

The baseline made three initialization HTTP requests per client; the optimized client made zero.
These request counts and local checks establish behavior, not worker resource savings. No cookies
were used. Live response bodies, titles, and external identities were not saved to tracked files.

## Validation

Final requested commands both exited successfully:

| Command                                                       | Result                        |
| ------------------------------------------------------------- | ----------------------------- |
| `bun turbo --output-logs=full check`                          | 38/38 tasks passed; 37 cached |
| `bun turbo --filter='!@ryot-app/e2e' --output-logs=full test` | 50/50 tasks passed; 50 cached |

Focused validation also passed:

- Media metadata adapter and three provider suites: 4 files, 14 tests.
- SDK YouTube adapter suite: 1 file, 3 tests.
- Local `e2e/src/api/kernel/sandbox/youtubei-tracer.test.ts`: 1 file, 1 test, using local Colima
  infrastructure and the normal E2E setup. This did not target the benchmark deployment.

Earlier full-suite attempts encountered unrelated intermittent DOM lookups and compiler test
timeouts. The complete client and client-plugin-compiler suites passed when run separately; the
final exact workspace commands then passed. No test timeouts, assertions, or implementation code
were changed to address those failures.

## Image provenance

The existing workflow generated Docker metadata but did not apply its labels. The running image's
revision label therefore could not prove its Ryot source revision. With user approval, commit
`c2b382c262` now checks out the PR head, uses that SHA for Docker metadata, and applies the generated
OCI labels. Both comparison images include this same workflow fix.

| Variant   | Source / CI commit                         | Successful workflow                                                     |
| --------- | ------------------------------------------ | ----------------------------------------------------------------------- |
| Baseline  | `c2b382c26242808a3d39ed846a01130d819ae072` | [35766977263](https://github.com/IgnisDa/ryot/actions/runs/35766977263) |
| Candidate | `ec957072bd656bee83f0c3f5946fe8636b8140f3` | [35767698711](https://github.com/IgnisDa/ryot/actions/runs/35767698711) |

Immutable multi-platform image references:

- Baseline: `ghcr.io/ignisda/ryot@sha256:72da720d776e89b53fe2735858eaf335f9d6e13ae8be2a181a7c36abbe229fe9`
- Candidate: `ghcr.io/ignisda/ryot@sha256:f309335fda12bab2fd349abfa50a251a1723e54454a45bd5bab99ee66239e067`

Registry manifests and configuration blobs were checked for both `linux/amd64` and `linux/arm64`.
All four OCI revision labels match their expected CI commits. Platform manifest digests are in
`comparison.json`. The earlier build at `77bd7fed49` lacked this provenance fix and is not a
comparison image.

## Measurement method

- Dedicated `ryot-benchmark` service on the existing two-vCPU host with 4,000,043,008 bytes of RAM,
  no swap, and no Ryot CPU or memory limit. The collector retained its 128 MiB limit.
- Bun 1.4.0, Deno 2.8.1, Effect 4.0.0-rc.117, on-demand workers, `info` logs, and disabled scheduler
  dispatchers throughout. The existing collector was version 0.155.0.
- Images alternated baseline/candidate for rounds 1, 2, and 3. Each scenario recreated the Ryot
  process, restored the fixture database, flushed benchmark Redis, and waited for stable Bun RSS.
- Every search used `furious` and page size 20. All details runs used the same ordered set of 20
  captured IDs, rotating over 30 requests. The supporting imports used its first five IDs. The six
  private input lists had the same SHA-256; the hash is preserved in `comparison.json`.
- The host collector sampled each second and the application collector every 200 ms. Worker
  lifetime high-water marks were available for every completed worker. All scenario cgroup peak
  resets were verified. Every run kept its five-minute recovery window.
- Profiling capability was available, but no profiling session was armed: every artifact has an
  empty `profileIds` array. No CPU profiles or heap snapshots were used for these measurements.
- CPU values use `ryot.cgroupCpuMs / 1000`, from submission through the end of recovery. They
  include Bun and Deno CPU and exclude the separate database, Redis, and collector containers.

The existing `variance` command runs both primary scenarios. Its optional scenario selector can
resume just `ytm-search-variance` or `ytm-details-variance`. The supporting check called
`runFreshRepetition` with `live-c2`, `requestCount: 5`, `repetitions: 1`, and `liveSearch: null` so
the stored IDs were reused instead of searching again. Its complete configuration is in both
`ytm-imports-c2-fixed-five.1.json` artifacts.

## Health and interruptions

All **14 accepted scenarios and 370 requests** completed. They recorded zero failed requests,
failed replays, health failures, missing worker peaks, OOM events, or workload watchdog triggers.
All application and host sampling gates passed. There were 27 missed application slots in total;
the worst scenario ratio was 0.783%, below the 1% gate. The longest application gap was 600 ms,
the longest host gap was 1,071 ms, and no host slots were missed. All workers drained after load.

Track details used six recorded worker attempts per request in the baseline and three in the
candidate. These counts include durable replay, not just failure retries. Search timing records
do not expose attempt counts and retain `null`.

Preparation and interrupted invocations are retained separately from accepted measurements:

1. The initial sampler preflight occurred before the user-requested pause. It was repeated after
   the verified baseline was deployed. The latest preflight is in `baseline-1/manifest.json`.
2. Coolify rendered worker concurrency as a literal `2`, so changing `.env` did not select `1`.
   The preparation check blocked submission. The intended setting was then applied through Coolify.
3. The failed preparation left the watchdog armed. During a planned redeployment it stopped Ryot
   with `healthFailing` at `2026-09-22T19:37:18.817Z`, before measured load. With user approval, the
   deployment wrapper was corrected to stop the watchdog for deployment downtime. The existing
   runner re-armed it after health checks and before workload measurement.
4. Full Coolify service restarts replaced PostgreSQL's anonymous volume and invalidated setup
   credentials. Benchmark state was recreated. Subsequent image changes recreated only Ryot;
   the database container ID stayed unchanged, preserving the fixture across variants.
5. Candidate archive installation replaced the details script ID. Commit `93364514cb` resolves
   that ID by slug after database restoration and before measurement. The first candidate search
   artifact was preserved and details were resumed independently.
6. One baseline round-two details attempt exceeded the local shell command's 30-minute budget.
   Its incomplete driver invocation is marked `driver-shell-timeout`; it contributes no resource
   result. Details were rerun from the fixture with a longer local command budget. Scenario request
   timeouts and product retry behavior were unchanged.

The Coolify service API returned no deployment UUID. Final image changes used Coolify image
configuration plus verified Ryot-only compose recreation. Running digests, revision labels,
architecture, and Bun/Deno executables were checked after each switch.

## Artifacts and teardown

`baseline-{1,2,3}/` and `candidate-{1,2,3}/` contain schema-validated manifests, scenario artifacts,
and summaries. All fourteen scenario artifacts passed the harness's provenance checks.
`comparison.json` contains the per-run values, medians, ranges, input fingerprint, validation
results, image digests, and teardown evidence. It makes no inference from the excluded attempts.

Sampler data, OTLP traces and metrics, and the kernel-warning window were exported privately and
their compressed archives passed integrity checks. The final application stdout export was not
recoverable after Coolify removed the stopped containers; the scenario, sampler, and OTLP evidence
remains complete. Local raw files, setup credentials, and temporary service backups were removed
after validation. Shared host sampler files, its binary, and collector storage were retained.

The service was stopped through Coolify. Final checks found no running benchmark containers and
no benchmark sampler or watchdog processes. The sampler credential file was removed. The Coolify
resource itself was preserved, with the candidate image configured for its next start.
