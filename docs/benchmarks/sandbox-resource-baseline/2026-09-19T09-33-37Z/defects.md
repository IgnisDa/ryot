# Defects And Harness Issues Encountered During The Follow-Up Run

This file records behaviour observed while collecting run `2026-09-19T09-33-37Z`. It states evidence
and attribution. It does not propose fixes, and it does not claim a cause for anything that was not
measured.

Fixes landed during the run are identified by commit subject rather than hash: this repository's
history was rewritten by a `fast-import` while the run was in flight, so older hashes no longer
resolve. Search by the `[resource-data-gathering]` tag.

The defects carried over from the first baseline are in `../2026-09-13T20-19-50Z/defects.md` and are
not repeated here.

## Product defects

### 1. Effect `ClusterWorkflowEngine` loses workflow wake-ups over PostgreSQL

**Status:** open upstream, [Effect-TS/effect#8312](https://github.com/Effect-TS/effect/issues/8312),
standalone reproduction at
[IgnisDa/effect-workflow-stall-repro](https://github.com/IgnisDa/effect-workflow-stall-repro).
Not a Ryot defect. **This is the dominant finding of the run.**

A workflow that suspends on a durable queue can be resumed while the storage poll loop is
mid-iteration. The poll claims the reset `run` message and sets `last_read`, then skips it because
the in-memory processed-request set is only cleared once per poll iteration. The message is not
re-selected until its `last_read` is ten minutes old, a threshold hard-coded in `SqlMessageStorage`.

**Effect on this run:** 188 of 452 imports exceeded 600 s. `soak-hermetic-import` stalled 171 of 200
(85.5 %), median 755.8 s, max 1 581.9 s, minimum 526 s against an expected ~13 s — not one import ran
clean. The live matrix stalled 17 of 252. Throughput, load windows and the import soak's retention
figures are all unusable as sandbox measurements. Full evidence and the list of affected data is in
`../effect-workflow-stall.md`.

The stalled imports completed with correct results. The defect is timing only.

### 2. Concurrent imports deadlock PostgreSQL during population

**Status:** fixed in `fix(backend): [resource-data-gathering] [upstream] prevent concurrent
population deadlocks`, before this run.

Overlapping population transactions acquired provider-entity rows, relationship endpoints and
relationship records in different orders, producing SQLSTATE 40P01. Fixed by acquiring those locks in
one deterministic order, sorting related mutations by canonical identity, and retrying the whole
transaction. This run recorded 0 deadlocks (`db.deadlocksDelta`) across 452 imports.

The same investigation surfaced [Effect#8238](https://github.com/Effect-TS/effect/issues/8238), a
lost `DurableDeferred` wake, fixed in `4.0.0-rc.116` and re-validated by the targeted run in
`../2026-09-19T05-06-19Z/`.

### 3. Provider import metrics counted workflow body attempts as imports

**Status:** fixed in `feat(observability): [resource-data-gathering] repair benchmark sampling and
add profiling`.

The exported import metrics treated each workflow body attempt as an import, so replayed bodies were
counted repeatedly and the logical import count was wrong by the replay factor. Attempts are now
named as attempts and each phase attempt is traced per execution. Logical import state is owned by
benchmark records instead.

This mattered beyond the benchmark: the same counters are the production signal for import progress.

### 4. Container profile output collided with the sandbox Deno cache

**Status:** fixed in `fix(observability): [resource-data-gathering] write container profiles outside
the Deno cache directory`.

`/home/ryot/tmp` is the sandbox Deno cache root, so profile files written there collided with cache
entries. Profiles now go to `/home/ryot/work/benchmark-profiles`.

### 5. The collector image cannot run the preflight rotation check

**Status:** fixed in `fix(observability): [resource-data-gathering] read collector output sizes from
the host mount`.

The OpenTelemetry collector image is distroless, so `docker exec … sh -c` exits 127 and the output
rotation check could never run. The check now resolves the `/output` mount and stats it from the
host.

## Measurement-method defects found in this run

### 6. A stall is invisible to every safety mechanism the harness has

**Status:** open. No detection exists.

A stalled import is a slow success. The watchdog reads memory and health only; the consecutive
poll-failure cap counts failed polls and a stalled poll succeeds; a 765 s stall sits well under the
30-minute request timeout. Nothing fails, nothing retries, nothing logs.

**Effect on this run:** `soak-hermetic-import` stalled 171 of 200 imports over 6 h 39 m and every
in-flight signal available to the operator — wave logs, watchdog file, container status, health
series — reported a healthy run. The stall was only visible after the fact, in
`requests[].latencyMs`.

A compounding factor: a soak writes its artifact only on completion, so an aborted soak loses its
stall evidence along with everything else.

### 7. The phase-segment endpoint cannot express suspension time

**Status:** open. The detector built on it has been retracted.

`GET /api/test-support/provider-imports/phase-segments` records only the _active_ execution of a
phase. The suspension on the durable queue — which is the entire defect — falls outside every
recorded segment, so a merged per-execution duration is roughly the same whether or not the import
stalled.

**Evidence.** One execution from `soak-hermetic-import`:

```
exec DGbLpThVlNRs  attempts 2  first -> last span 12.3 s  [(interrupted, 0.4 s), (success, 0.0 s)]
  matching request record: latencyMs = 698337
```

A method built on this endpoint reported about 12 s per import and **zero stalls for seven hours**
while the run was stalling 171 imports of 200 at 526–1 582 s. That method was documented in
`../effect-workflow-stall.md` and has since been retracted there; the script that implemented it
(`stall-check.sh`, outside the repository) is disabled with a guard rather than deleted.

The correct measurement is wall-clock `requests[].latencyMs` after the fact, and in flight the ratio
of a wave's load window to the work it contains.

### 8. The stall evidence table conflated `direct` executions with imports

**Status:** corrected in `docs(benchmarks): [resource-data-gathering] retract the phase-segment stall
detector`.

An earlier revision of `../effect-workflow-stall.md` credited the hermetic matrix with 400 stall-free
imports. The hermetic matrix submits `direct` executions, which execute synchronously and never reach
the durable queue, so those 400 were not evidence for or against the defect. The row was removed
rather than corrected.

Only `import` and `live-import` submissions reach the stalling path. `direct`, `live-details` and
`live-search` cannot stall this way.

### 9. A 26-minute wave load was reported as healthy cadence

**Status:** operator error, recorded because the signal was available from wave 1.

`soak-hermetic-import` waves spent 1 119–1 582 s of load on twenty imports that should each take
about 13 s. That is a ratio of one to two orders of magnitude between a load window and the work
inside it, visible in the first wave log, and it was repeatedly reported as steady cadence. It was
the stall.

### 10. `profiles/analyze.ts` summarized nothing and reported success

**Status:** fixed in this session.

`analyzeProfile` looked for `attempt-<n>` directories directly under the profile token directory,
but `fetchProfiles` copies the container layout, which is
`<token>/execution-<n>/attempt-<m>/`. No attempt directory was ever matched, the token directory
itself holds only `meta.json`, and the analyzer emitted one empty entry per token.

**Why this is serious:** the run logged `profiles: 4` and exited 0 against a 1 044-byte summary
holding no CPU stacks, no heap summaries and no checkpoints. The documented next step is
`--delete-raw`, which would have deleted 726 MB of irreplaceable raw profiles — the only copy, taken
from containers that no longer exist — immediately after "successfully" summarizing nothing.

After the fix the same inputs produce 21 profile entries and a 1.15 MB summary, and the profile
attribution section of `report.md` exists because of it.

### 11. Phase invocation records never reached the manifest

**Status:** reconstructed by hand; the write path is unfixed.

`run.ts` records an invocation in `manifest.json` at the start and end of every phase command.
None of the seven phase invocations of this run were present in the manifest afterwards — the file
on disk matched its last committed state, which predates the idle phase.

**Effect:** `summarize-run.ts` refused the entire run, with 50 provenance errors of the form
`<scenario> was produced by an invocation the manifest does not record`. No summary, no report.

The records were reconstructed from the artifacts, which each carry their own `invocationId` and
timeline, and the reconstruction is recorded as a manifest deviation. Start and end times bound the
scenario work rather than the process lifetime. `preflight`, `teardown` and `watchdogDrill` are still
null for the same reason.

The later `soak-control-extended` invocation did reach the manifest, start and completion both, so
the symptom is intermittent rather than total — which makes it worse to rely on, not better. That
record also arrived with `scenarioIds` empty, so the manifest said a soak ran without saying which
scenario it ran; the artifact carries the id, and the field was filled by hand. `summarize-run.ts`
validates artifact provenance against these records but does not reject an empty `scenarioIds`,
which is why the omission is silent.

### 12. The final manifest write is unguarded and fails the process after the work is done

**Status:** open.

`soak-hermetic-import` completed all ten waves, all 200 requests, and wrote its 18.8 MB artifact,
then exited **1** because the final `updateManifest` hit `EPERM` opening `manifest.json` during a
host filesystem fault. A 6 h 39 m scenario reports failure for a bookkeeping write that happens after
every measurement is already durable, and there is no retry and no recovery path.

### 13. Results the pipeline can produce but nothing records

**Status:** open.

`retention.ts` exports `retentionClassification`, and it is unit-tested, but nothing in the driver,
the soak runner, the aggregator or the summarizer invokes it. Soak artifacts carry the raw inputs and
the fitted slopes but no classification. The classifications in `report.md` were computed by hand
from the recorded inputs.

The manifest's `profiles` block (`rawDeleted`, `verifiedAtUtc`, `remainingRawEntries`) has the same
shape of problem in the opposite direction: `profiles/analyze.ts` verifies the deletion and records
it in `profiles/summary.json`, but no command copies it into the manifest, which the plan requires.
It was filled by hand and recorded as a deviation. This is the same failure mode as the deployment
provenance fields in defect 16, which were declared for a whole baseline before anything wrote them.

### 14. Task-completion notifications report the wrong exit code

**Status:** open, tooling outside this repository.

The completion notification for the `soak-hermetic-import` process reported exit 0 for a process that
exited 1. The `exit=` line in the captured log was correct. Trust the log line, not the notification.

## Harness defects fixed during the run

Each of these aborted or corrupted at least one phase before it was fixed. They are listed in the
order they were hit.

### 15. Sampling produced invalid host evidence

`feat(observability): [resource-data-gathering] repair benchmark sampling and add profiling`.
Sampling ran on a sleep-after-request loop and called `docker stats` once per container, which
invalidated the first baseline's host evidence entirely. Both samplers now use deadline scheduling
with missed-slot accounting, and the host series reads procfs and cgroup v2 directly. Benchmark
containers previously resolved by name substring and now resolve by exact compose service.

Application snapshots moved onto the benchmark host, because the public route costs more in network
latency than the 200 ms sampling interval.

### 16. The manifest recorded no deployment provenance

`feat(observability): [resource-data-gathering] record deployment provenance in the run manifest`.
The manifest declared image, deployment, runtime and commit provenance, but no command ever filled
it. A provenance command now reads the deployed digest, architecture, OCI revision, enforced limits
and a redacted compose hash from the host, and refuses a deployment whose digest is not the one the
run asked for.

### 17. The OAuth session expired mid-phase, three distinct ways

Three separate fixes were needed:

- `fix(e2e): [resource-data-gathering] refresh the benchmark session between repetitions` — a
  scenario group outlives the access token.
- `fix(e2e): [resource-data-gathering] keep the benchmark session alive` — a single high-concurrency
  repetition outlives it, so an unauthorized request is retried once against a fresh session.
- `fix(observability): [resource-data-gathering] refresh the benchmark session once per token
expiry` — live scenarios poll import results with unbounded concurrency, so on expiry every
  in-flight poll received 401 together and each started its own sign-in. The burst tripped the auth
  rate limiter, and the 429 from the authorize step was thrown rather than returned, escaping the
  retry and aborting the phase. Refreshes now run under a single permit.

### 18. Sign-in raced container recreation and discarded the real error

`fix(e2e): [resource-data-gathering] retry benchmark sign-in across process recreation`. Recreating
Ryot between repetitions restores the fixture database, invalidating the issued token. The forced
sign-in could reach the process while it was still stopped, and the resulting error payload was
discarded in favour of a generic "returned no token" failure that aborted the whole phase.

### 19. Transport failures aborted multi-hour phases

Three fixes: `retry benchmark requests on transport reset`, `retry idempotent benchmark admin calls
on transport reset`, and `retry remote commands on ssh transport failure`. In the last case a
transient banner-exchange timeout aborted a three-hour phase; ssh reports transport failure as exit
255, which means the remote command never ran, so the attempt is now repeated.

Related, from the first baseline: `match the client error that wraps restart failures` and `poll
imports through a container restart`.

### 20. A stale watchdog trigger aborted every repetition after the first

`fix(observability): [resource-data-gathering] stop losing benchmark progress to stale triggers and
dead backends`. The watchdog appends to one trigger file for the whole run, so every repetition after
the first trigger inherited it, reported `aborted`, and stopped the remaining matrix units. Triggers
are now filtered to the repetition window, as the journal and phase segments already were.

### 21. A soak could hang for over an hour on a dead backend

Same commit as 20. Soak waves ran without the request timeout that fresh repetitions apply, and
import result polling treated every HTTP failure as transient, so a stopped backend held one soak for
over an hour instead of failing. Both are now bounded.

### 22. Profiling a concurrent soak wave cost about 1.9 GB

`fix(observability): [resource-data-gathering] stop profiling concurrent soak waves`. CPU profiling
wave two of a twenty-import soak added about 1.9 GB of host memory on top of the load, dropped
MemAvailable under the 384 MiB watchdog floor, and had the Ryot container stopped mid-scenario. Only
sequential waves are profiled now; the profile phase still covers concurrent execution.

This is why `soak-hermetic-import` carries no wave-2 CPU profile.

### 23. Generated sandbox sources failed the compiler's own type check

`fix(e2e): [resource-data-gathering] type the generated benchmark sandbox sources`. The sandbox
compiler type-checks generated sources, so embedding helpers through `Function.prototype.toString`
shipped transpiled JavaScript without annotations and failed under `noImplicitAny`. Annotated sources
are embedded instead.

### 24. The summarizer saw only one invocation's scenarios

`fix(e2e): [resource-data-gathering] record every scenario and final facts when summarizing`. A
canonical run is collected across several driver invocations, so the rebuilt manifest listed only the
last invocation's scenarios and kept health facts that are only known once the run has ended.

## Operator errors

### 25. The complete `soak-control-extended` artifact was destroyed after the run

**Status:** the scenario is being re-run; the trimmed copy is committed as an interim record.

`bunx oxfmt` was run over the run directory to format the edited Markdown. It also reformatted all 50
committed scenario artifacts, converting two-space indentation to tabs. `git checkout` reverted
those, but the newly written `soak-control-extended.1.json` was untracked and had no committed state
to revert to. It was then "restored" from `~/.ryot-benchmark-raw/`, on the assumption that the raw
directory holds the same file. It does not: the raw copy carries only `metrics`, `requests`,
`repetition` and `scenarioId`, while the run directory holds the complete artifact. 8.8 MB was
overwritten with 278 KB. There was no snapshot and the file was untracked, so it was unrecoverable.

**Effect:** `series` (200 ms application and 1 s host samples), `waves`, `timeline`, `containers`,
`phases`, `workers`, `journal`, `watchdog` and `configuration` were lost for that scenario.
`summarize-run.ts` fails schema decode against the trimmed artifact, so `summary.json` could no
longer be regenerated from the committed artifacts. The 143 metrics and 1 000 request records
survived, so every figure quoted in `report.md` remained sourced.

**Two things made this possible and both are worth fixing.** The run directory is the only home for a
complete artifact, and a fresh one is untracked until committed, so there is a window where normal
tooling can destroy it with no recovery path — artifacts should be committed as soon as they are
written. And `oxfmt` should not be run across a directory of generated evidence; it has no reason to
touch scenario artifacts, and its reformatting of 50 committed files was itself a near-miss.

## Deviations from the plan

Recorded in `manifest.json`; summarized here.

1. `soak-live-details` was not run. `live-details` executes synchronously and cannot reach the
   stalling path, so it would have measured YouTube Music latency rather than anything the decision
   questions ask. `soak-control` provides the non-import soak baseline.
2. The live phase required six attempts. Attempts 1–5 aborted and their artifacts are not in this
   directory; their stall counts survive only in `../effect-workflow-stall.md`.
3. The harness changed mid-run, between the profiles phase and `soak-control`, for defects 20, 21 and 22. Scenarios before and after that point ran on different harness revisions.
4. `soak-hermetic-import` measures Effect #8312, not the sandbox.
5. The manifest was completed by hand after defect 12.
6. The seven phase invocation records were reconstructed from the artifacts, per defect 11.
7. The manifest `profiles` block was filled by hand from `profiles/summary.json`, per defect 13.

## Open follow-up

When Effect publishes a release that fixes #8312:

1. Bump `effect` and the matching `@effect/*` packages from `4.0.0-rc.116` in every workspace that
   pins them — 26 `package.json` files, no catalog entry. No Ryot code works around the stall.
2. Deploy to the benchmark service and pass sampling preflight.
3. Rerun the Phase 12 live concurrency matrix **and** `soak-hermetic-import` into a new run
   directory. The soak is required for a retention figure; the one in this run accrued under stall.
4. ~~Consider a longer `soak-control` at a higher operation count, to separate a slow leak from
   allocator high-water.~~ Done. `soak-control-extended` ran 1 000 direct executions on
   2026-09-20 and returned a fitted slope of 38.5 MiB per 1 000 operations, under the plan's 100 MiB
   ceiling, classifying as allocator-high-water (see `report.md`, Bun retention).
