# YouTube Music initialization: ready for resource comparison

## Status

**Paused before deployment and measured workloads because the benchmark server is busy.**
The implementation, output checks, local validation, and both image builds are complete.
Lower worker peak RSS and CPU-seconds have **not yet been demonstrated**.

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
| `bun turbo --output-logs=full check`                          | 38/38 tasks passed; 38 cached |
| `bun turbo --filter='!@ryot-app/e2e' --output-logs=full test` | 50/50 tasks passed; 45 cached |

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

## Benchmark state at the pause

Before the pause request:

- Coolify, SSH, GitHub, and the benchmark API health check succeeded.
- The existing service configuration was backed up to a mode-0600 file outside the repository.
- A benchmark user and workload plugin were created; their state is stored privately.
- The host sampler binary was rebuilt and copied to the existing benchmark tools directory.
- A ten-minute sampler preflight passed: 3,029 application samples, 607 host samples, no missed
  slots, and no application sample failures. OTLP trace and metric files grew during that interval.
- The verified baseline image was pulled on the benchmark host and its `linux/amd64` architecture
  and revision label were checked.

The preflight ran against the **previously deployed image**, not either new comparison image.
`baseline-1/manifest.json` records only this preparation; its image provenance remains unset.
Its watchdog drill file includes older dry-run entries as well as this run's entry.

No new image was deployed, no fixture database was captured or restored, and no measured scenario
was submitted. No Coolify deployment UUID exists for this task. Host/application collectors were
started by preflight; after the busy-server instruction, no remote action was taken to inspect or
stop them. Their current ownership must be checked before reuse or teardown.

Private local preparation files are under the approved OpenCode temporary directory:

- `ytm-initialization/coolify-service.json`: original service configuration backup.
- `ytm-initialization/baseline-1/state.json`: benchmark identity and plugin state.
- `ytm-initialization/baseline-1/*.log`: setup/preflight driver logs.
- `ytm-benchmark.ts`: local credential-loading wrapper for the existing driver.
- `ytm-parity.ts`: local in-memory parity probe.

These files are not committed and are not durable run artifacts. Credentials must still come
from the process environment and the Coolify API when resuming.

## Resume after the server is available

1. Reconfirm exclusive benchmark use, current service state, and collector/watchdog ownership.
   Back up any configuration changes made while this task was paused.
2. Verify the pinned baseline image on the host, deploy only the existing `ryot-benchmark` resource,
   and verify health, running digest, revision, Bun/Deno executables, and resource settings.
3. Reuse the private setup state only if its user/plugin still exist; otherwise run setup again.
   Capture one `furious` search result set and the fixture database. Use the same details IDs and
   database starting state for every variant. Recheck sampler/OTLP health and record full provenance.
4. Run the existing unprofiled variance scenarios: 30 sequential searches and 30 sequential track
   details, concurrency one. Run three rounds per variant in alternating baseline/candidate order.
   Preserve the existing stabilization and recovery windows. Do not enable CPU or heap profiling.
5. Run the matched concurrent-import comparison only after sequential scenarios pass the existing
   health, watchdog, OOM, and sampling gates. Keep fixed inputs and fresh database state.
6. Compare `workers.lifetimePeakRssMaxBytes` and `ryot.cgroupCpuMs / 1000`, including CPU-seconds per
   successful operation, completion counts, retries, failures, and repeated-run spread. The CPU
   metric is container-wide, not worker-only. Wall-clock latency is supporting evidence.
7. Save validated, sanitized scenario artifacts and the comparison. Accept the optimization's
   resource goal only after both peak RSS and CPU-seconds fall consistently with equivalent output.
8. Copy required telemetry, then stop this task's collectors/watchdog and the benchmark service
   when exclusive ownership permits. Delete temporary raw state after the run is complete.

The benchmark runner lives in `e2e/src/scripts/sandbox-resource-baseline/`; its `README.md` lists
the environment variables and commands. Keep separate variant/round directories so `variance`
does not overwrite its repetition-one artifacts. No performance conclusion is available yet.
