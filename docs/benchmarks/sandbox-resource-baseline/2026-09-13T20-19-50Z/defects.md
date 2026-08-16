# Defects And Harness Issues Encountered During The Baseline Run

This file records behaviour observed while collecting the baseline. It states evidence only. It
does not propose fixes, and it does not claim a cause for anything that was not measured.

## 1. A large sandbox result leaves its workflow permanently suspended

**Status:** open, blocks two canonical scenarios, not attributed to a commit.

**Effect on the run:** `05-direct-1mib-payload` and `06-direct-large-payload` produced no
measurements. Payload-size scaling is therefore missing from this baseline. The first scenario is
recorded with `outcome: "aborted"` and `stopReason: "request-timeout"`.

### What was observed

A direct sandbox execution returning a 1 MiB payload never reaches a terminal state. The job stays
`pending` with no error, no failure and no timeout. It was waited out three times: 900 s inside the
canonical run, then 300 s and 130 s in separate probes.

Runtime counters during a stalled execution stay frozen at 2 replays started, 1 sandbox execution,
0 completed replays and 0 live workers, so the workflow body is re-entered once and then stops
before spawning anything.

### Durable state of a stalled execution

Querying the workflow engine's cluster tables for one stalled execution returned exactly three
messages, all with `processed = true`:

| message    | request bytes | reply                                                          |
| ---------- | ------------- | -------------------------------------------------------------- |
| `run`      | 369           | `{"_tag":"Success","value":{"_tag":"Suspended","cause":null}}`   |
| `activity` | 74            | `Complete` with a successful pin result                          |
| `deferred` | 1 048 916     | 1 048 857 bytes, `{"state":"completed", …}`                      |

The sandbox result was delivered into the durable deferred and acknowledged successfully. No second
`run` message was ever enqueued for the workflow entity, so the suspended workflow was never
resumed. The completed result sits in durable storage and nothing consumes it.

### Size is a probability, not a threshold

Bisecting the returned payload with a 45 s budget per attempt:

| payload bytes | result        |
| ------------- | ------------- |
| 65 536        | completed     |
| 262 144       | still pending |
| 524 288       | completed     |
| 786 432       | still pending |
| 1 048 576     | still pending |

A hard size limit would not produce that ordering. The behaviour is consistent with a race between
the sandbox result arriving and the workflow deciding to suspend: a result that arrives first is
consumed inline, and a larger payload takes longer to serialize and transfer, so it far more often
loses the race and takes the suspend path.

### Secondary consequence

Every stalled execution leaves a suspended workflow and its multi-megabyte reply row behind
permanently. Nothing reaps them.

### Attribution

Not attributed. The pre-instrumentation image is still present on the testing VM, but the domain is
fronted by Cloudflare and the authentication flow rejects a tunnelled origin, so the older container
could not be driven to compare. The instrumentation added in this change set only records metrics
around existing steps and does not touch the deferred or resume path, which makes it an implausible
cause, but that was not proven. Settling it requires a local end-to-end test that forces the suspend
path with a large result and runs with and without the instrumentation.

## 2. Connection reset while the host is CPU saturated

**Status:** observed once, no server fault found.

`16-import-concurrency-20` repetition 5 ended with `ECONNRESET` on the import submission. The
scenario is recorded with four of five repetitions.

Host and container evidence for that window:

- Ryot container restart count 0, `OOMKilled` false, no errors in the container log.
- No kernel OOM records, `oom_kill` counter unchanged at 0.
- No watchdog trigger.
- Memory pressure never exceeded PSI `full avg10` 0.44, and `MemAvailable` never fell below
  1319 MiB across the whole run.
- CPU pressure reached PSI `some avg10` 91.1.

The host was CPU saturated, not memory constrained, and the server stayed up throughout. The four
captured repetitions are mutually consistent, so the missing repetition was not re-run rather than
discarding good data for a fifth sample.

## 3. Concurrent live imports deadlock in PostgreSQL during population

**Status:** reproduced in both concurrent live runs, not investigated further.

| scenario                      | imports | completed | deadlocked |
| ----------------------------- | ------- | --------- | ---------- |
| `22-live-youtube-music-five`  | 5       | 4         | 1          |
| `23-live-youtube-music-twenty` | 20      | 16        | 4          |

Every failed import reports `failureStage: "population"`. Each durable workflow reply carries an
`EntityImportError` with stage `population` wrapping `SqlError: DeadlockError: deadlock detected`,
and no other failure cause appeared in either run. One in five imports failed at both concurrency
levels.

No warning or error was logged at `info` level during that window, so the failure is visible only
through the import result and the durable reply.

The live imports come from one search result page, so their related entities overlap: the same
artists and albums are populated by several imports at once. The hermetic import scenarios never
deadlocked across 29 repetitions at up to 20 concurrent imports, and every hermetic import generates
uniquely named related entities, so their entity graphs never overlap. This is consistent with lock
contention on shared global entities or relationships, but the conflicting statements were not
captured.

This does not meet the live-comparison stop condition in the plan, which covers throttling and
provider drift, so the live comparison continued to the twenty-import run.

## 4. Harness issues

These were defects in the benchmark tooling and the opt-in local benchmark test, not in the product.
They are recorded because they changed what the run could collect.

These were found and fixed during the run:

- **Opt-in local benchmark test was already broken on the branch.** It packaged plugin sources at
  `scripts/…`, which the archive policy no longer accepts, and its automation sources still read
  `automation.source.after`, which the event source no longer carries. It failed identically before
  any change in this set. Both were corrected so the validation run in Phase 6 could execute.
- **Generated sandbox sources did not type-check.** Embedding helpers through
  `Function.prototype.toString()` shipped transpiled JavaScript with no annotations, which the
  sandbox compiler rejects under `noImplicitAny`. The helpers are now annotated source text.
- **The harness access token expires inside a scenario group.** Long groups failed partway with
  `authentication-required`, and one 20-import repetition outlived the token even with a
  per-repetition refresh. The driver now signs in again before every repetition and retries an
  unauthorized request once against a fresh session. Group D scenario `19-typed-failures-20` was
  re-run after this fix.
- **Import polling did not survive a container restart.** The restart-recovery scenario takes the
  API down while imports are polled, and the error page returned in that window failed the run. Two
  attempts failed before polling was made to retry HTTP client failures until the repetition's own
  timeout. Each failed attempt still restarted the container, so the backend was restarted three
  times in total, and only the third attempt produced a scenario artifact.

These were not fixed during the run and limit how the host evidence can be read:

- **The host sampler ran at about 8 s, not 1 s.** It calls `docker stats --no-stream` once per
  container, and each call blocks for about 2 s while it takes two CPU readings. Across 12.6 h it
  wrote 5455 samples at a p50 interval of 8 s and a p95 of 9 s, so every interval exceeded the plan's
  5 s limit. The plan's stop condition for sampler gaps was therefore met continuously and was not
  enforced. Instantaneous host values such as `MemAvailable` can dip between samples; cgroup peaks
  are unaffected because they come from `memory.peak`.
- **The watchdog's Ryot-cgroup check may have read the wrong container.** It resolves the container
  with a `name=ryot` substring filter and takes the first match, which can equally be the PostgreSQL
  or Redis container of the same service.
- **The watchdog's stop action is unverified.** It stops containers labelled
  `com.docker.compose.project=ryot-benchmark`, but Coolify names the compose project after the
  service UUID. The containers were removed when the service stopped, so the label could not be
  checked afterwards without redeploying. No watchdog condition was ever met, so no scenario
  depended on the stop action.
- **Trace capture rotated.** The collector's file exporter kept five rotated files per signal, which
  discarded trace files older than 05:35 UTC. Metric capture rotated once and is complete.

## 5. Deviation from the plan's image verification

The plan requires the image's `org.opencontainers.image.revision` label to equal the `Run CI`
commit. That check cannot pass for this workflow: `docker/metadata-action` stamps the label with
`github.sha`, which for a `pull_request` event is GitHub's ephemeral merge commit, never the pull
request head. Provenance was established instead by the workflow run identity, the changed image
digest, the architecture and runtime checks, and by confirming that the deployed image serves the
new admin-gated snapshot fields that exist only in this change set.

The branch history was later rewritten to retag commit messages, which changed the `Run CI` commit
hash. `manifest.json` records the commits CI built and deployed, `3ec544225b` and `58d12dbbae`; they
now appear on the branch as `aea928bda6` and `b8c4818c0b`.
