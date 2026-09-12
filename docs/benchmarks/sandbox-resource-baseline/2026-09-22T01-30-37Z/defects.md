# Defects And Harness Issues Encountered During The #8312 Verification Run

This file records behaviour observed while collecting run `2026-09-22T01-30-37Z`. It states evidence
and attribution. It does not propose fixes, and it does not claim a cause for anything that was not
measured.

The purpose of this run is narrow: confirm that Effect `4.0.0-rc.117` fixes
[Effect-TS/effect#8312](https://github.com/Effect-TS/effect/issues/8312) and re-measure the two
scenarios whose data the stall destroyed. Defects from earlier runs are in
`../2026-09-13T20-19-50Z/defects.md` and `../2026-09-19T09-33-37Z/defects.md` and are not repeated
here.

## Harness defects found during provisioning

### 1. `run.ts` exits 0 when a phase fails

**Status:** open. Observed twice during provisioning for this run.

`run.ts provenance` failed with `RemoteCommandError` (exit code 127, missing host binary) and
`run.ts preflight` failed with `RemoteCommandError` (exit code 1, missing `app.jsonl`). Both printed
an Effect stack trace and neither completed its work, but **both processes exited 0**.

Evidence for the preflight failure:

- The process exit code was 0.
- `manifest.json` recorded `preflight: null` and `watchdogDrill: null`.
- The `preflight` invocation was left with `outcome: "running"` and `completedAtUtc: null`.

The failure is therefore invisible to any supervision that reads exit status. `../effect-workflow-stall.md`
tells an operator to "trust the `exit=` line", and the recurring check-in for the previous run said
the same. That instruction is unsafe as written: a phase can fail, leave the manifest unwritten, and
still report success. A failed phase must exit non-zero.

This compounds defect 11 of the previous run, where invocations recorded `scenarioIds: []`. Both are
the same class: the manifest is not a reliable record of what happened.

### 2. The host tool directory was absent, not merely emptied

**Status:** recorded as evidence for defect 26 of the previous run.

`../2026-09-19T09-33-37Z/defects.md` defect 26 records that the teardown command reports a state that
never existed. This run adds that the teardown report was wrong in the other direction too. That
report stated `/root/ryot-benchmark-tools` still held `ryot-benchmark-host`, `smoke.jsonl`,
`smoke.pid` and `watchdog-triggers.attempt1-archive.jsonl`. At the start of this run the directory
did not exist at all, and the VM root filesystem had dropped from 43 % to 13 % used, so the host was
rebuilt between the two runs. Nothing measured was lost; the point is that the teardown record
cannot be used to establish host state.

`run.ts provenance` fails with exit code 127 when the binary is absent, so the missing tool is
detected — but see defect 1: it is detected and then reported as success.

### 3. The application sampler's token file is an undocumented manual step

**Status:** open.

`preflight` starts the application collector with
`app-sample --token-file /root/ryot-benchmark-tools/admin-token`, but nothing in the harness ever
writes that file. `ops.ts` only ever removes it, in `teardown`. `README.md` mentions that "the admin
token lives in a mode-0600 file on that host for the run only" without saying that the operator must
place it, and no command does it.

The failure mode is indirect and slow: `startAppCollector` succeeds because the process is spawned
detached, the collector then exits immediately, and preflight only fails ten minutes later when it
tries to read the samples that were never written. Combined with defect 1, the run reports success.

### 4. `pkill -f` / `pgrep -f` self-match, reproduced

**Status:** further evidence for defect 26 of the previous run.

Defect 26 records that the teardown probe's `pgrep -f ryot-benchmark-host` matches the `bash -c`
wrapper it runs inside, so it reports `running` unconditionally. The same pattern was reproduced
destructively here: `ssh root@host 'pkill -f "ryot-benchmark-host sample"'` terminated the sampler
and then killed its own login shell, because the remote command string contains the pattern. The ssh
client returned 255.

Any process probe or kill against these tools must match on something other than the full command
line, or explicitly exclude the invoking shell.

## Defects found in the product

### 5. Deadlock retry is dead on every Drizzle query failure

**Status:** fixed in `75970d6472`, not present in the image this run measured. Verified
under load by run `2026-09-22T11-45-22Z`; see the verification note at the end of this defect.

Three of 252 live-matrix imports failed with `failureStage: "population"` — `live-c2.1` index 11,
`live-c5.2` index 10, `live-c3.3` index 0 — each terminating in 196–279 s rather than hanging.

Root-caused from the OTLP trace file. The causal chain is `EntityImportWorkflow` →
`runEntityImportPhases` → `ProviderEntityPopulationWorkflow` → `synchronizeEntityGraph` →
`syncProviderRelatedEntityGroupScope` → `sync-related-entity-group:2:media-suggestion` →
`syncRelatedEntityGroup` → `sql.transaction` → `sql.execute`, failing on
`select pg_advisory_xact_lock(hashtextextended($1, 0))` with
`SqlError/DeadlockError: deadlock detected`. Two distinct lock classes collide:
`live-c2.1` deadlocked in `EntitiesRepository.lockProviderEntityMutations` under
`EntitiesService.persistPlannedProviderUpserts`, `live-c5.2` in
`EntitiesRepository.lockEntityReferencesByIds` under
`RelationshipsService.persistPlannedReconciliation`.

The transaction was already wrapped in `retryOnDeadlock(mapDatabaseErrors(...))`, so a deadlock
should have been retried and invisible. It never was. Drizzle reports a failed query as
`new EffectDrizzleQueryError({ ..., cause: Cause.fail(e) })` — an Effect `Cause`, not the error.
`unwrapDatabaseFailure` in `kernel/backend/src/lib/infrastructure/db/service.ts` unwrapped
`EffectDrizzleQueryError` and `Error.cause` but had no `Cause` branch, so it stopped at the `Cause`
and handed that to `unknownToDbError`, which reads `code`, `table`, `column` and `constraint` off it.
A `Cause` has none of those, so **every `DbError` raised from a Drizzle query carried
`code: undefined`** and the `error.code === "40P01"` predicate could never match.

Diagnostic fingerprint: the `DbError.message` is a stringified `Cause`, `Cause([Fail(...)])`.

Blast radius — four error-code paths were silently dead for all Drizzle-issued queries:

- `retryOnDeadlock`, SQLSTATE `40P01`.
- `isUniqueConstraintError`, `23505`, used at `modules/imports/repository.ts:82` and
  `modules/backups/runs/repository.ts:70`.
- The `23505` branch at `modules/backups/restore/writer.ts:375`.
- The `40001` serialization retry at `modules/backups/restore/workflow.ts:303`.

The fix adds a `Cause.isCause` branch that recurses through `Cause.squash`. Three regression tests
were added and verified to fail without it; the four pre-existing tests pass either way, because they
construct a bare `SqlError`, a shape no Drizzle query ever produces. That is precisely how the defect
survived a test suite that covered the mapping.

Two caveats stated rather than resolved: lock ordering is unchanged and `retryOnDeadlock` allows only
two retries, so three attempts may still not survive 20-way concurrency; and the claim that `rc.116`
avoided these deadlocks because its stall serialized the imports is inference, not something proven
against `rc.116` traces.

#### Verification note (run `2026-09-22T11-45-22Z`)

**Verdict: fix verified. No lock-ordering follow-up needed.**

Unit check: `bun --bun run vitest run src/lib/infrastructure/db/service.test.ts` in
`kernel/backend` passes 7/7 with the fix; with only the `Cause.isCause` branch removed it fails
exactly the 3 new Drizzle-shape tests (`recovers PostgreSQL metadata…`, `recovers the violated
constraint…`, `retries a deadlock reported through Drizzle`) while the 4 pre-existing bare-`SqlError`
tests pass either way. Audit: `retryOnDeadlock` is still `times: 2` (3 attempts) at
`kernel/backend/src/lib/infrastructure/db/service.ts:60`; all seven callers
(`provider-entity-population-workflow.ts:228,339`, `population.ts:141`,
`relationship-population.ts:179`, `relationships/mutation-support.ts:153`,
`events/service.ts:58`, `events/event-create-workflow-live.ts:70`) still wrap
`retryOnDeadlock(mapDatabaseErrors(database.transaction(…)))`. Advisory-lock acquisition order is
unchanged (`lockProviderEntityMutations` and `lockRelationshipMutations` sort keys;
`lockEntityReferencesByIds` orders by id).

Load evidence, fix image `sha256:3df726ccc208b3ae18bb68cd0fa1fd063d91e158e0d703a9dd1ef7c3844d1605`
(CI `236b163e1c`, Main run `35720755387`, `linux/amd64`, in-container Bun `1.4.0`, Deno `2.8.1`,
Effect `4.0.0-rc.117`, `SANDBOX_PROCESS_MODE=on-demand`, `SCHEDULER_DISABLE_DISPATCHERS=true`):

- Hermetic overlap gate (deterministic, local harness, fix code):
  `RUN_OPERATIONAL_GATES=1 bun --bun run vitest run
  src/api/plugins/media/imports/media-population-overlap-gate.test.ts` — 1 passed (≈209 s):
  3× 5-import + 3× 20-import overlapping graphs (shared artists + album), all 75 imports
  completed, PostgreSQL deadlock counter unchanged.
- Live matrix on `ryot-benchmark` (same Williams design as the defect run, unmodified harness,
  `BENCHMARK_REQUEST_TIMEOUT_MS=5400000`): 12/12 repetitions `completed`, 252/252 requests
  completed (20 imports + 1 warm-up probe each), 0 failed, `failedByStage` empty everywhere, no
  request over 600 s (max import latency 465.4 s at c1).

| Rep | Reqs | Completed | Failed | 40P01 terminal | Window s | Max latency s |
| --- | --: | --: | --: | --: | --: | --: |
| live-c1.1/.2/.3 | 21 | 21 | 0 | 0 | 481.7 / 454.2 / 447.1 | 465.4 / 438.2 / 431.0 |
| live-c2.1/.2/.3 | 21 | 21 | 0 | 0 | 332.2 / 354.3 / 327.3 | 314.1 / 337.9 / 311.1 |
| live-c3.1/.2/.3 | 21 | 21 | 0 | 0 | 341.8 / 345.5 / 334.5 | 325.6 / 329.2 / 316.0 |
| live-c5.1/.2/.3 | 21 | 21 | 0 | 0 | 323.7 / 313.9 / 331.2 | 307.5 / 297.8 / 315.2 |

Trace evidence: the shared collector `traces.json` holds the defect run's 4 deadlock lines
(`DeadlockError … deadlock detected` in `sync-related-entity-group:2:media-suggestion`, 07:51–09:30
UTC) alongside 3 017 trace lines starting inside the verification window (12:00:42–14:45:53 UTC),
of which 0 mention `deadlock` and 0 mention `40P01`. Trace export was therefore healthy and the
zero is a measured zero, not a sampling gap.

Artifacts: `../2026-09-22T11-45-22Z/manifest.json`, `../2026-09-22T11-45-22Z/summary.json`,
`../2026-09-22T11-45-22Z/scenarios/live-c{1,2,3,5}.{1,2,3}.json`.

Deviations from the plan: the fix image was deployed by editing the host compose file on the
server (backup at `docker-compose.yml.pre-p01-verification`); the Coolify service record still
pins the pre-fix digest, so a Coolify-triggered redeploy reverts until the record is updated. The
benchmark database was recreated fresh (dropped `postgres` + `ryot_fixture`, flushed Redis):
the new image crash-looped on the old database (`SchemaEvolutionError` in system-plugin
ingestion, from co-shipped commits, not from the fix), and live imports require a fresh database
so prior population does not turn imports into cache hits. The deployed image is CI `236b163e1c`
(19 commits ahead of origin, not fix-only). The full 12-repetition matrix was run instead of a
c2/c5-only subset because `run.ts live` has no subset selector; c2 and c5 each have the required
≥3 repetitions.

Remaining gap (observability, not correctness): no retry counter exists — `retry` appears 0 times
in every scenario artifact — so a per-rep retry count cannot be reported. The retry path itself is
proven by the `retries a deadlock reported through Drizzle` unit test; under this load there was
no deadlock event for it to absorb.

### 6. Import throughput regressed about 2× against rc.116

**Status:** open, cause not established.

Follow-up: [narrow throughput diagnosis, 2026-09-23](../throughput-diagnostic-2026-09-23/README.md).
Controlled probes separate Deno loading, durable handoff/resume, SQL/Redis, Bun CPU, and collection
overhead. Neither an Effect-only local backend comparison nor same-host Deno probes of the original
images reproduced a twofold version-specific slowdown. Repeated worker loading and durable
coordination dominate the small-unit cost; the historical increase remains unexplained. This remains
a cross-run observation, not proof of an Effect regression.

Per unit of working time the hermetic soak runs at 2.21–2.45 executions per second against `rc.116`'s
4.32. Because `rc.117` is busy 91–99.5 percent of each wave and `rc.116` was busy 53–73 percent, the two
effects cancel and wall-clock wave duration is unchanged at about 26 minutes.

This is not cosmetic: it caused data loss. Wave 7 crossed the 30-minute request timeout and ended the
soak at 6 of 10 waves, so the retention series is four waves shorter than designed and the question
of whether the slope flattens is unanswered.

The comparison is between a busy-time rate for `rc.116` and a rate for `rc.117` that is effectively
both, since `rc.117` is almost never idle. That is the correct pairing, but it is worth stating
explicitly because comparing `rc.116`'s busy-time rate against a wall-clock rate would understate the
regression.

## Observability gaps

### 7. A failed import reports a constant code

`ImportEntityRunResult`'s failed variant in
`packages/contract/src/modules/provider-entities/schemas.ts` carries
`code: Schema.Literal("import-failed")` — a constant — plus a three-value `stage`. Nothing
distinguishes a deadlock from a provider timeout from a schema violation. Diagnosing defect 5
required the OTLP trace file; the benchmark artifacts alone could not have done it.

### 8. The backend emits almost no OTLP log records

The collector captured 55 log records for the whole run, all from startup. Traces carried the
diagnosis; logs contributed nothing.

### 9. The data-gathering plan's claim that OTLP export is disabled is stale

`../sandbox-resource-data-gathering-plan.md:87` states that the compose file has no
`OTEL_EXPORTER_OTLP_ENDPOINT` and that OTLP export is therefore disabled. The deployed service has
`OTEL_EXPORTER_OTLP_ENDPOINT=http://otel-collector:4318` and an
`otel/opentelemetry-collector-contrib:0.155.0` sidecar writing traces, metrics and logs to files on a
named volume.

This mattered. Acting on the plan's text rather than the live deployment, this session initially
reported the three import failures as undiagnosable. They were fully diagnosable, and the trace file
that diagnosed them had been accumulating for eight hours. The collector also survives recreation of
the `ryot` container, unlike `docker logs`. Correct the plan before the next run.

## Harness defects found during measurement

### 10. A truncated soak reports itself as completed

**Status:** open.

`soak-hermetic-import.1.json` records `outcome: "completed"` and `stopReason: null` after the
scenario stopped at wave 6 of 10 because wave 7 exceeded the request timeout. The truncation is
recorded only in prose, in `notes`: `"wave 7 exceeded the request timeout and ended the soak"`.

Any reader or tool that trusts `outcome` will treat a 6-wave series as a 10-wave one and will read
the retention slope off an incomplete run without knowing it. `soak.waves` does report 6, so the
artifact contradicts itself. An early stop must set `outcome` and `stopReason`.

### 11. Import submissions never record execution or queue time

**Status:** open.

`requests[].executionMs` and `requests[].queueWaitMs` are `0`/`null` for every import request, and
the derived `requests.executionMs.*` and `requests.queueWaitMs.*` metrics are correspondingly
`null`, in both the soak and all twelve live repetitions. Only end-to-end `latencyMs` is populated.

Combined with defect 12 this leaves no way to separate queueing from execution for an import, which
is exactly the decomposition a concurrency comparison needs.

### 12. The documented stall threshold is below the hermetic workload's own cost

**Status:** open. Not a code defect; a measurement-rule defect in `../effect-workflow-stall.md` and
in the operating check-in for this run.

A wave or repetition submits all 20 imports at once with `concurrency: "unbounded"`
(`e2e/src/scripts/sandbox-resource-baseline/scenario-runner.ts:465`); measured submission spread is
0.1 s. They then run concurrently for the whole wave, so each import's latency is close to the wave
window — within 15–75 s of it — rather than being the cost of that import in isolation.

The `latencyMs > 600000` rule was calibrated on a live import costing about 165 s, where roughly
765 s meant a stall. For the hermetic soak, normal per-import latency is **1 520–1 760 s**, because
twenty imports genuinely share two vCPUs for the length of the wave. Every one of the 120 requests
therefore trips the threshold while the backend is busy 91 to 99.5 percent of the time. The rule
reports 120 stalls where dead-time analysis finds none.

It remains sound for the live matrix, where normal latency is 196–466 s and a stalled import would
stand out — as it did on `rc.116`, at about 775 s against a 177 s median.

A stall threshold has to sit above the workload's own cost. Either scale it per scenario, or use the
two scenario-computable discriminators instead: contiguous backend idleness from
`series.application`, and the spread of request terminal times within a wave. Both are in
`soak-dead-time.json`.

### 13. Scenario artifacts already carry the series needed for stall analysis

**Status:** open, documentation gap rather than a code defect.

`series.application` in every scenario artifact carries `activeExecutions`, `executingImportBodies`,
`workers`, `bunRss` and `cgroupCurrent` at 1 Hz for the whole scenario. The whole dead-time analysis
is computable from committed artifacts alone, for this run and retrospectively for
`2026-09-19T09-33-37Z`.

This session initially ran that analysis against the 238 MB `app.jsonl` on the benchmark VM instead,
which required care not to perturb a live run and which produced a **wrong answer**: the ad-hoc
script truncated each wave at its execution ceiling and thereby hid a real 141 s gap in soak wave 4.
Nothing documents that the artifact is self-sufficient for this, so the harder and less reliable
path was taken first.

## Deviations from the plan

1. The host sampler binary was rebuilt and reinstalled at `/root/ryot-benchmark-tools/` mode 700
   before provisioning, because the directory was absent (defect 2).
2. The admin token file was written by hand to `/root/ryot-benchmark-tools/admin-token` mode 600
   (defect 3).
3. The first `preflight` invocation failed and is recorded in the manifest with
   `outcome: "running"`. It collected no data. The `preflight` block in the manifest comes from the
   second invocation.
4. The benchmark deployment's `SERVER_ADMIN_ACCESS_TOKEN` was rotated as part of the redeploy that
   moved the service to the `rc.117` image.
5. The soak stopped at 6 of 10 waves when wave 7 exceeded the request timeout (defect 6). Figures are
   computed over the six complete waves.
6. `BENCHMARK_REQUEST_TIMEOUT_MS=5400000` was set for the live matrix, raising the per-request
   timeout from the default.
7. The live matrix was restarted once after a `ScenarioPreparationError`. Coolify had regenerated
   `docker-compose.yml` with literal values, and a service's explicit `environment:` block overrides
   `.env`, so the worker-concurrency override never reached the container. Fixed on the server, with
   the original kept at `docker-compose.yml.pre-benchmark-substitution`.
8. The deadlock fix in `75970d6472` was committed during the run and deliberately **not** deployed.
   The measured image predates it.
