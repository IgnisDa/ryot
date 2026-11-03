# Log

## 2026-11-01

- Provisioned the VM (`scripts/vm-provision.sh`) and mirrored worktree `080c70cc58`.
- Code reading so far:
  - Every workflow and activity is persisted through Effect Cluster `ClusterWorkflowEngine` with SQL
    storage (`kernel/backend/src/boot/workflow-engine.ts`): 33 workflow implementations and 131
    activity call sites. Cluster defaults that matter: `entityReplyPollInterval` 200 ms and
    `entityMessagePollInterval` 10 s.
  - About 926 of the ~944 e2e tests sign up a fresh user. Signup polls `initialization-status` every
    200 ms until `UserBootstrapWorkflow` finishes. That workflow runs one sandbox script per plugin
    (media and fitness each call `ensureUserEntities` for one entity), plus installation provisioning
    and default notification rules. The script work is trivial, so the signup cost is almost all
    framework overhead.
  - Harness (from the survey): about 27 non-opt-in files start extra API processes or whole stacks
    (about 45 processes and 30 container trios) alongside the 6 workers. Every browser test launches
    a fresh Chromium. The suite also contains fixed sleeps (61 s, 31 s, 20 s, …).
- Harness fixes from the first runs: e2e global setup replays a turbo-cached sandbox `dist/` that must
  match the root-installed copy (`vm-build.sh` now builds twice and fails on digest drift); runs have a
  wall cap and a stall watchdog; sync streams `git ls-files` as tar because macOS openrsync hung.
- Smoke run (`reviews.test.ts`, 3 tests, idle VM): 7.5–9.2 s per test for create/edit/delete of a
  rating. The shared database saw 34,410 statements, 41% on `cluster_*` tables (≈2,000 message
  inserts, each with a fence check, a reply insert, a processed update, and an execution/root
  lookup). Idle background: runner heartbeat, shard-lock refresh, and storage poll each ≈15
  statements/s. Total database execution time was only 14 s of a 90 s run, so latency here is round
  trips and waits, not database saturation.
- Repo finding: `e2e` pins `playwright@1.62.1` but `effect-playwright@0.8.0` resolves
  `playwright-core@1.63.0`, which is what launches Chromium (needs headless-shell build 1243). A fresh
  machine that installs browsers with the pinned CLI fails every browser test at launch. Baseline
  `base1` browser results before 05:17 are invalid for this reason.
- Baseline `base1` (whole standard suite, revision `71620fab90`) was stopped after about 30 minutes and
  34 files. Its browser results are invalid (Playwright build mismatch), so a clean rerun follows. Even
  the partial run shows:
  - Heavy files take minutes under load: `lifecycle-query-recipes` 1,058 s for 20 tests,
    `activity-log` 1,000 s for 13, `query-recipes-results` 847 s, `user-data` 705 s,
    `measurements` 464 s, `workout-occurrences` 339 s.
  - Every non-browser failure is a 180 s test timeout in a cascade-heavy test: show-tree clear, history
    merge, journaling an episode, paging 100 readings. None is a logic failure.
  - 1.54 M statements and 1,156 s of database execution; 34% of the statements hit `cluster_*`.
  - Database time under load goes mostly to waiting on locks:

    | Statement | Calls | Exec time |
    | --- | ---: | ---: |
    | `pg_advisory_xact_lock_shared(hashtext($))` | 74 k | 295 s |
    | Reply-path `FOR UPDATE` of the root `workflow_execution` (`lockRequestRoot`) | 58 k | 172 s |
    | `cluster_messages` insert, including the fence trigger | 76 k | 104 s |
    | Storage poll (`UPDATE cluster_messages … last_read`) | 39 k | 90 s |
    | Fence trigger's root `expired_at` lookup | 39 k | 79 s |
    | `pg_advisory_xact_lock` (exclusive) | 11 k | 34 s |

  - The shared lock is mostly the global `ryot-plugin-ingestion` key
    (`modules/plugins/packages/ingestion-fence.ts`). Sixteen sites take it shared: planning, sandbox
    pinning, workflow references, operations, saved views, reminders, background work, settings.
    Every private-plugin install, uninstall and settings change takes it exclusive
    (`installations/service.ts`, `ingestion-lock.ts`, `ingestion-service.ts`).
  - PostgreSQL queues new shared requests behind a waiting exclusive one. So one test installing a
    plugin first waits for every in-flight transaction in the server, then stalls every new one until
    it commits. This lock couples unrelated tests and fits "fails in the suite, passes alone".
  - Other hot reads: `select account_generation from "user" … for share`, 80 k calls (account
    admission); `user_lifecycle_operation` status check, 63 k.
- Correction: `probes3`'s logging and OTLP cost came from the harness setting an OTLP endpoint, which
  turns on per-span debug logging. OTLP export is now opt-in (`OTEL=1`). `base2` was restarted without
  it so the baseline matches normal e2e configuration. The owner keeps log level `all`.
- `base2` (revision `f3c8ce8f77`, before slice 1, no OTLP): the kernel OOM killer stopped it after
  63 min (unit memory peak 6.2 GB of the VM's 7.7 GB). By then 99 files and 693 tests had run, and
  28 tests had failed:
  - 23 of the failures are 180 s timeouts in cascade-heavy tests, the same files as `base1`:
    `history-correction-liveness` 4, `history-correction` 3, `user-data` 3,
    `plugin-package-conflicts` 3, `integrations` 4, `episodic-lifecycle` 2.
  - Three are browser tests (45 s timeouts).
  - Lock waits over 1 s were all on `ryot-plugin-ingestion`; slice 1 targets this.
  - The shared API server grew from 0.2 GB to 1.2 GB RSS over the run. Each per-file server holds about
    0.5 GB, plus Chromium and the test PostgreSQL connections. A full run on this VM therefore also
    needs less memory per server. The growth of the long-lived server is a follow-up to measure after
    the engine change, which drops Cluster's in-memory mailboxes.
- Slice 2 e2e (`eng3`, 14 targeted files):
  - Passing: every restart and recovery file (`imports/durability`, `reminders/recovery`,
    `sidecar-recovery`, `history-correction-recovery`, both tracers) and the two-process
    `global-provider-rate-limiting`.
  - Fixed along the way: the takeover sweep claimed orphans before boot had registered their workflows,
    and stranded them. Storing results as `jsonb` reordered keys, so the sandbox journal diverged on
    replay. Ubuntu unattended upgrades re-executed systemd mid-run and restarted the measurement unit;
    they are now disabled on the VM.
  - All 15 failures also failed in `base2`. Run alone, the `integrations` failures repeat. Their runs
    stay `blocked` on `configuration-required: tmdbAccessToken`. The harness passes the shell
    environment to the API servers, and the VM runs never had the owner's `RYOT_PLUGIN__*` provider
    configuration. Several "suite-only" failures in the baselines may therefore be missing
    configuration, not load. `vm-e2e.sh` now loads those keys from a VM-only file (never committed).
- `solo2`: the six failing files, run one at a time with provider configuration. Five pass in full:
  - `integrations` 20/20 in 38 s (740 s and 4 timeouts without configuration)
  - `episodic-lifecycle` 6/6
  - `history-correction` 6/6
  - `user-data` 4/4
  - `plugin-package-conflicts` 5/5

  `history-correction-liveness` fails 3 of 5 at 180 s, and its passing test takes 149 s. Work does
  not stall during these tests: the engine completes 750–1,170 workflow executions per minute, about
  2,700 per test. They are slow because of the sheer number of operations, which is what slices 3–4
  remove.
- `baseliv`: `history-correction-liveness` alone on the pre-engine baseline (`f3c8ce8f77`), with
  provider configuration. 4 of 5 fail at 180 s; the fifth passes in 27 s. The timeouts therefore
  predate slice 2, which turned one of them into a pass.
- The VM env file broke on the Hardcover key, whose value contains a space (`Bearer …`). Sourcing
  it ran the token as a command, so runs before this fix had no Hardcover key. The value is now
  quoted.
- Slice 3a: account admission in one statement (see `strategy.md`).
  - `probes5` shows statements down 12–18% per flow, with CPU unchanged (`probes.md`).
  - `acct1` ran the 15 e2e files that touch accounts, notifications, background work, integrations
    and recovery: 87 of 88 tests pass. The failure, `imports/durability`, was an engine bug from
    slice 2:
    - Stored JSON drops `undefined`, so the engine's own `Exit.void` deferreds (fired clocks and the
      interrupt signal) were stored without their `value` key.
    - Another process decoding them on a wake failed with "workflow wake failed: Missing key", and
      the execution never resumed. Here, a cancel written by the API never reached the import.
    - `eng3` passed by timing. Decoding now restores the dropped keys, and an engine test covers an
      interrupt written by another process.
  - `dur1`: the four restart and recovery files pass. `imports/durability` takes 75 s; it timed out
    in `acct1`. `reminders/recovery` takes 81 s, down from 150 s in `acct1`.
  - The fair queue sends its scripts by hash and backs off when idle (commit `4eef867752`).
- Engine micro-benchmark (local, PostgreSQL in Docker):
  - a workflow with no steps costs 0.54 ms of CPU;
  - each activity step with a 9 KB result adds about 0.15 ms;
  - a parent with one child costs 0.83 ms.

  So the 18 executions of an event create cost under 20 ms of its roughly 1 s of API CPU. What
  remains is the work inside them, not the engine.
- `full3`, the whole suite after principal slimming (`1760dc4d7a`), ended at 27 minutes with 407
  tests reported, 15 of them failed:
  - The kernel ran out of memory and killed a sandbox daemon, its intended first victim. systemd's
    default `OOMPolicy=stop` then stopped the whole unit, vitest included. The unit peaked at
    5.8 GB, with the test containers outside it, on the 8 GB VM; an earlier run hit the same OOM.
    Runs now launch with `-p OOMPolicy=continue`. The memory pressure itself is a slice 6 finding.
  - Seven failures are 180 s timeouts in the known slow files: `history-correction-liveness`,
    the media merge and clear tests, the reading-log and ranking pagination tests, and the
    private-package claim test.
  - The other eight failed in 27–66 s: optional event properties, special-episode activity, Movie
    detail rail, offline ranking retention, competing historical edit, lost-response workout retry
    and two package-quarantine tests. None were run alone; the next full run decides which are
    load-dependent.
- Slice 4, steps 1 and 2 (commits `5bcbc86538`, `543fb1bed2`): every write runs in its host-call
  workflow and settles inline unless that workflow suspends. See `design-run-once.md`.
- `full4`, the whole suite at `4b4e530c18` with `OOMPolicy=continue`, hit the 90-minute wall cap
  with 720 tests passed and 132 failed in 73 files:
  - The kernel killed a sandbox daemon 30 times, in bursts at 12:54–12:58 and 13:18–13:20 UTC. The
    unit kept running, but each kill freed only 30–60 MB, so pressure stayed and the kills
    cascaded. After the second burst nearly every file failed with 120 s hook timeouts; those are
    collapse, not distinct bugs.
  - Memory at the bursts, on a 4-vCPU, 7.7 GB VM without swap: six vitest workers grew from about
    270 MB to 600 MB each (3.6–3.9 GB together), the shared server held about 1 GB, each isolated
    per-file server 300 MB with its own PostgreSQL, Redis and object-storage containers, Docker
    containers 0.6–1 GB, and the vitest parent 0.4 GB.
  - The suite therefore cannot finish on this VM with six workers. `full5` reruns it with
    `--maxWorkers=4`, matching the CPU count, to separate memory collapse from load failures.
- `full5`, the same revision with `--maxWorkers=4`, is the first whole-suite run to finish: 58.6 min,
  956 tests, 914 passed, 25 failed in 18 files, 17 skipped.
  - Memory still ran out at the end. 41 sandbox daemons were killed between 15:06 and 15:08, while
    `pro-key` held eight API servers up for its whole file and `pro-gated-providers` three more. By
    then the four workers held about 1.2 GB each, up from 270 MB at start, and the shared server
    1.4 GB after 40 minutes. Isolated servers held 260–560 MB each.
  - Worker memory grows with the number of files a worker has run (`isolate: false`): 600 MB per
    worker in `full4` with six workers, 1.2 GB in `full5` with four.
  - Four of the failures were in `history-correction-liveness`. The history-correction background
    work failed with `Workflow replay 1 failed: ` and an empty message. The workflow rows show the
    cause:
    - A write's policy hook waited 104 s in the sandbox queue, then ran in 36 ms. Its 35 s deadline
      had passed, so the policy batch failed with `AutomationPolicyExecutionError`, which has no
      message.
    - The hook inherits the background lane. With 60 subjects in flight, every replay and fresh
      run of the same user and plugin shares one FIFO, so the awaited hook queued behind all of
      them.
    - `base2` failed the same tests by 180 s timeout before any of this work, so the ordering is
      older than slice 4; inline parking holds slots longer and makes it worse.
  - Fix (commit `8675c643a9`): within a flow, the fair queue takes awaited hook runs first, then
    replays and recoveries, then fresh runs. Lane, tenant and plugin turns are unchanged. HTTP
    rate-limit admission keeps the identity without urgency. Host failures without a message now
    report their tag and code.
- `urg1` (the fair-queue urgency fix, three files): `lifecycle-triggers` and `history-correction`
  pass, and `history-correction-liveness` fails one test instead of four (`baseliv`, before this
  work, also failed four). The 60-subject fan-out no longer misses a policy deadline, but it does
  not finish within 180 s beside two heavy files; that is background-lane capacity, for slice 6.
- E2E isolation is back on at the owner's request: each file runs in a fresh worker, so fixture
  maps and heap growth no longer accumulate. `pro-key` starts each scenario's API only for its own
  test instead of keeping eight up for the whole file. `iso1` (four files, including `pro-key` and
  a browser file) passes with workers peaking at 291 MB.
- `full6`, the whole suite at `6d5ab4c8f7` with isolation and six workers: 59.6 min, 922 passed,
  26 failed in 17 files, 8 skipped.
  - No sandbox daemon was killed. Workers peaked at 752 MB; module imports cost 403 s of worker
    time over the run. The shared server still grew to 1.67 GB, so its growth is its own.
  - The VM is CPU-bound in both `full5` and `full6`: about seven runnable processes on four
    vCPUs, 80% busy. PostgreSQL is not the bottleneck (its busiest statement totals 46 s); the
    shared server is, at about 22 requests a second.
  - Eleven of the failures are 180 s timeouts in the heavy history, integration and user-data
    files, which passed with four workers: six workers give each heavy test less CPU.
  - The rest fail in 12–75 s in both `full5` and `full6`. Most read Media consumption values
    (finished, minutes, watch days, episode-activity ordering, Reads/Listens) right after
    `createEventFixture`, which waits for the event to be listed but not for its background
    projection.
- `alone1` ran the fast-failing files alone at `6d5ab4c8f7`. Six of seven still failed, so they
  are not load failures. `basealone` ran them at the baseline `f3c8ce8f77`: `workspace-switcher`
  and two `saved-view-sorting` tests fail there too; the Media activity and detail tests pass.
  - Bisect (`bis1`–`bis3`): `activity-recipes` passes at `5bcbc86538` and fails from `543fb1bed2`,
    which settles script writes inline. A database probe (`probe2`) shows why: event projections
    settle one to two seconds after each write, and RyotQL reads a pending projection as absent by
    design. Faster writes left the tests reading before their projections. The tests read
    projected values (finished, minutes, watch days, Reads, Listens) without waiting; they now
    wait with `waitForEventProjections`, or for the rendered value.
  - Older test bugs: on Linux the workspace keycap's text is "CtrlSpace", so an exact "Space"
    match never held; titles without lifecycle activity tie and sort by ID, so "newest first" was
    arbitrary; `media-analytics` ordered tied IDs with `localeCompare`, while PostgreSQL orders them
    by code unit.
  - The server type check, which the VM runs never execute, found two misses in `1760dc4d7a`: the
    generic-import chunk workflow used `SandboxRepository` without its layer providing it, so
    grouped generic imports would fail at runtime; and the production sandbox smoke still built
    principals with `compiledHashes`.
- `fix1` and `fix2` run the corrected files alone; all Media files pass. Two further older bugs,
  both failing at the baseline (`basescope`):
  - `plugin-revision-scopes` and `plugin-package-conflicts` hold a sandbox writer's `httpCall`
    open, then compile a plugin package in the test worker before releasing it. Under load the
    compile alone outlasts the 8 s `httpCall` deadline, so the writer fails with a timeout
    (`external-uncertain`) instead of the outcome under test. The tests now compile first.
  - A browser page's identity records every ready plugin the user can reach, so a system plugin
    install, update or removal makes every open page stale and shows the update prompt, which is
    correct for a deploy. Six test files changed system plugins on the shared backend, and
    concurrent browser files (`media-analytics`, `media-reviews`) had their clicks blocked by the
    prompt; in `fix1` the prompt followed a system plugin update by 30 ms. Those six files now run
    on their own server through `runFileOnIsolatedServer`.
- `iso3`: with the compile moved out of the gate, the quarantine outcome holds, and one older
  product bug surfaces. Releasing a terminal import run's internal pins rewrote the row, so the
  column's update hook moved its user-visible `updatedAt` about 90 ms after the run read as
  complete, and a run compared before and after an unrelated quarantine looked changed. The
  release now keeps `updatedAt`.
- `full7`, the whole suite at `26d6f6212e`, collapsed after 27 minutes: 513 tests failed, almost all
  with `ECONNREFUSED`. At 18:45:54 the kernel killed the shared API server (1.1 GB,
  `oom_score_adj` 0) after 62 sandbox daemons. Four per-file servers were up beside it, each with
  its own PostgreSQL, Redis and object storage, and the 12 Bun processes held about 4.6 GB. Moving
  seven more files onto their own servers made such overlaps common.
  - Six workers bought no time on four vCPUs: `full5` with four took 58.6 minutes and `full6` with
    six 59.6. Vitest now uses at most the machine's available parallelism (still six on larger
    machines).
  - Servers a file starts get `oom_score_adj` 500 on Linux, so memory pressure costs that file
    rather than the shared backend and every file after it.
- `full8`, the whole suite at `0e0c86d004` with four workers: 68.3 min, 921 passed, 26 failed in 15
  files, 9 skipped. The shared server survived, but memory still ran out at 19:19–19:23 and
  20:07: the kernel killed 35 sandbox daemons (`oom_score_adj` 1000, about 60 MB each). Five
  per-file servers (0.3–0.74 GB each) were up beside the shared one (0.84 GB), four workers
  (1.5 GB) and containers (1.6 GB).
  - Product bug: one failed sidecar start disabled that sidecar for the life of the process. The
    supervisor set `startupFailed` on any start failure, and every later run failed at once with
    "Sandbox sidecar startup failed". The replacement for a killed daemon started while memory was
    still short, failed once, and `lifecycle-query-recipes`'s server lost its sandbox for the next
    14 minutes (eight failures, including account bootstrap). A failed start now backs off like a
    crashed generation, up to 30 s, logs its cause and records a `restart` event with reason
    `startup`.
  - `PlaywrightError` carries no message, so Vitest reported five unrelated browser failures under
    the first one's call log. The e2e runtime now fails with Playwright's own error.
  - `fitness-exercise` read the old note text right after saving an edit. `getByText` also matches
    the open editor's textarea, so the new text was "visible" before the save; the row then showed
    the old text until its refetch. The test now waits for the editor and the old text to go.
  - The entity-provider and translation files that timed out at 180 s pass alone in about 20 s
    each (`tri1`), so they depend on the shared server's state late in the run. Not yet explained.
  - CPU over the run, from per-process deltas in `ps.log`: API servers 45%, PostgreSQL 18%,
    workers 15%, Docker 8%, sandbox daemons 7.5%. System time is 23% of all CPU. The samplers ran
    `docker exec` about once a second; they now use the host's `psql` through the mapped port, and
    `pg_stat_statements` is copied once a minute instead of every 5 s.
  - The heaviest statement is the event stream binding sweep (`bindingDeclarations`): 393 calls,
    0.94 s each, 370 s in all. It runs in the 5-minute cron and lists about 2,800 unbound
    declarations per run, mostly new users' projected event schemas, which have no streams.
- The binding sweep listed declarations from `user_event_schema`, a view that joins kernel
  definitions to every user and system plugins' schemas to every installation, then sorted the
  wide rows (each with its projection) for the keyset. Every declaration without a binding row
  counted as stale, so each tick resolved a principal, opened a transaction and recorded a binding
  for every new user's projected schemas, although nothing can be bound before a stream exists.
  Every stream creation inserts or bumps its declaration's binding row (`ensureAndLockStreams` is
  the only path, restore included), so the sweep now walks binding rows and joins the declaration
  view per row. Tests that deleted binding rows to force reconciliation mark them stale instead.
- `testSupport.createGlobalEntity` created each seeded global entity with `populatedAt: null` and
  then updated it to set `populatedAt`: two lifecycle commands, each with its hooks, for every seeded
  show, season and episode (1,234 calls, 322 ms on average, in `full8`). It now creates the entity
  populated.
- Candidate, not done: script pins recompute `scriptsDigest` (a sorted `string_agg` over the
  revision's scripts) on every lookup, 177,761 calls and 88 s in `full8`. Storing it on the revision
  needs the script garbage collector to keep it current.
- `full9`, the whole suite at `dafaf83630`: 57 min, 933 passed, 15 failed in 10 files, 8 skipped.
  Nothing was killed for memory.
  - Product bug: `dispatchPendingInstallationLifecycle` started at most 100 pending installation
    workflows per call, from the test route or the 5-minute cron. A system plugin provisions an
    installation for every user at once, and with 800 users the installations past the first 100
    stayed `installing`. `namespaceInstallation` waits until health leaves `installing`, so late
    entity-provider and translation tests (`refresh` ×3, `related-progress`, `entity-translation`)
    waited out 180 s. Dispatch only starts workflows, and installations stay pending until theirs
    finishes, so one sweep now pages past each page it dispatched.
  - `page-freshness` went stale when another file removed a system plugin 0.1 s earlier, and the
    browser failures in `media-custom-entity` and `collection-detail` match the same window. Every
    system plugin change on the shared backend stales every open page by design. Vitest now runs the
    files that hold pages open (`browser/`, `api/kernel/pages/`) as a first project and the API
    files after them (`sequence.groupOrder`). `saved-view` removes a system plugin itself and moved
    to its own server.
  - `history-correction-liveness` (4 timeouts) and `analytics-recipes` (1) time out at 180 s when
    the shared background lane is busy; not yet addressed.
  - `tri2`, those eleven files together: all passed in 271 s, with the page group done before the
    API group started.
- `full10`, the whole suite at `d8b8a9ad88`: 58.5 min, 941 passed, 7 failed in 4 files, 8 skipped.
  The entity-provider, translation and page-freshness failures are gone. Database execution time
  totals 1,019 s; the binding sweep fell from 249 s to 0.21 s (11 calls).
  - `history-correction-liveness` (4) and `analytics-recipes` (1) still time out at 180 s.
  - `media-movie` counted the activity summary's "Watches" figure without waiting: while the
    projection is pending the summary shows "Updating" instead. `media-show` waited for the Log
    activity submit button to read "Mark S1·E4 watched", which it does only until the earlier
    unwatched episodes load; with backfill on it then reads "Mark 3 episodes watched". When the
    episode choices loaded after them, the first label never appeared. Both tests now wait for the
    settled state.
- `otel1`, `history-correction-liveness` beside five heavy Media API files with OTLP export: the
  same three liveness tests and `analytics-recipes` time out. Background dispatches waited 51 s on
  average (3,300 of them), interactive ones 12 ms, and the CPU was 42% idle.
  - Memory admission, not the queue, held the background lane at one run. Admission reserves each
    run's worst case, 298 MiB (isolate heap, external and headroom, staging, and five outstanding
    host-call frames), plus 128 MiB for a fresh process. The default 1.5 GiB budget leaves 852 MiB
    of dynamic memory, and a background run must leave 426 MiB for an interactive one, so only one
    background run fits. The queue's second background slot waited in `reserveRun`: 163 ms per
    dispatch, 45% of slot time. Sandbox runs added up to 897 s over 841 s of wall clock.
  - E2E servers now set `SANDBOX_MEMORY_BUDGET_MIB=2304`, which admits the configured five runs.
    Production keeps its defaults: two workers and 1.5 GiB admit one run in each lane.
- `otel2`, the same files with that budget: admission waits fell from 743 s to 1 s, dispatches rose
  from 4,671 to 7,812 in less time (780 s), mean background wait fell to 21 s and `integrations` ran
  in 364 s instead of 547 s. The liveness tests still time out.
- `liv1`–`liv3`, `history-correction-liveness` alone: it passes, but its 60-subject test takes
  166–180 s against a 180 s timeout. The file makes about 4,500 sandbox runs, and the API server
  spends about 0.85 of a core on them while sandbox daemons use about 0.5. The `PROFILE=1` profile
  (`liv2`) has no dominant frame: schema work is 25% of the API's CPU, PostgreSQL socket writes
  (one per statement) 9%, the workflow engine 13% and SQL building 10%.
  - Every activation of a script workflow body repeats the work of each earlier replay. In `otel2`,
    7,812 dispatches came from 44,025 `processSandboxExecutionQueue` calls, each of which offered
    the replay to the fair queue again (encoding its payload and principal), appended its journal
    to Redis again, logged its script output again and recorded its replay metric again. Each one
    also cleared recovery state in Redis, 33,539 times, because the recovery read created a record
    for every run.
  - A step whose first replay attempt has a stored success without recovery state now reuses the
    result from the deferred `DurableQueue.process` awaits, and skips all of that. A recovery read
    no longer stores a record; one exists only after a collateral failure, and only then does the
    run return a recovery identity for its caller to clear.
- `liv4`, with that change, against `liv3`: the file took 423 s instead of 462 s, the 60-subject
  test 149 s instead of 166 s, and the API server used 321 CPU-seconds instead of 377 (−15%).
- `full11`, the whole suite at `306769dee3`: 53.0 min, 940 passed, 8 failed in 4 files, 8 skipped.
  - `history-correction-liveness` (4) and `analytics-recipes` (1) still time out at 180 s.
  - `lifecycle-query-recipes` (2, new) read a pending library summary. Every event write queues one
    `library-summary-refresh` run in the background lane, and each run advances the summary's
    revision. The first run to finish already covers both writes, so `waitForLibrarySummary` saw a
    ready summary equal to the live computation; the second run then marked it pending again, and a
    pending summary is in no lifecycle state. The file passes alone (`lqr1`). Its state assertion
    now polls while the summary is in no state; a wrong state still fails at once. Other callers of
    `waitForLibrarySummary` that read the stored summary have the same exposure.
    - Candidate: a refresh request that a completed step already covered still recomputes the
      summary. Skipping it needs the request to carry its triggering write's position.
  - `fitness-analytics-interactions` timed out clicking under the "Update available" prompt.
    `browser/import-data` installs two system plugins on the shared backend in `beforeAll` and
    removes them in `afterAll`, which stales every open page; it now runs on its own server.
- `liv5`, `history-correction-liveness` alone with OTLP export at `309a1306f6`: the 60-subject test
  timed out (180 s), and only 36 replays recorded their metric against 2,765 script runs. The
  settled-step change dropped them: `DurableQueue.process` usually suspends the body while the run is
  in flight, so the activation that resumes reads the step as settled, and settled steps skipped
  their script logs and replay metric. Both are now recorded inside the step's observation activity,
  which runs once, in the first activation that sees the result; a failed replay, which ends the
  workflow, records directly. The metric's duration is the run's own rather than body wall time,
  which read about zero for a resumed step.
- `liv6`, `history-correction-liveness` alone with OTLP export at `5e73bdab7c`: the 60-subject test
  timed out again. Of 2,741 script replays, 1,708 ended pending; background dispatches waited 6.3 s
  on average (4,088 of them). One statement, the entity-row lock in
  `EventStreamRepository.lockSourceReferences`, took 172 s of the file's 328 s of statement time,
  nearly all of it waiting. PostgreSQL logged 608 lock waits over 100 ms, 168 s in total, all but one
  on a single `entity` tuple per test: that user's media library.
  - Media stores every history-correction record as an event on the user's one library entity, so
    every correction step for every subject locks that row and its streams for its whole commit
    transaction. The 75 subjects of the 60-subject test commit one at a time, while the CPU idles.
    Parking runs (slice 4 step 3) would not move this bound, so it waits.
  - Span logs now carry the parent span ID, so a span tree can be rebuilt from them.
- `liv7`, the 60-subject test alone: it timed out at 180 s. Its 459 correction commits held the
  library lock for 111 s in total, median 214 ms, of 287 ms median transaction time. A median commit
  (one event update under an unchanged library root) issued 140 statements:
  - 56 to save the unchanged library: schema validation twice, asset, row and catalog locks, a
    receipt, and the entity lifecycle batch (begin, lookup, contents, seal);
  - 12 to begin and seal a relationship batch with no relationships;
  - about 36 in six repeated locked write checks (ingestion and plugin-config locks, the plugin
    revision, installation and account reads, and the script pin).
  - An unchanged update now skips the entity lifecycle batch, which cannot contain evidence, and a
    command without relationships skips their batch.
- `liv8`, with those skips: the test passed in 165 s. The lock was held for 91 s (−18%), median
  172 ms.
  - A locked write check holds shared locks on the authority it read until the transaction ends, so
    repeating it inside the same transaction rereads the same rows. A user command commit, which
    never changes plugin, installation or account rows, now reuses each check for its key;
    `reuseLockedWriteChecks` is the opt-in for such a scope.
- `liv9`, with write checks reused: the test passed in 164 s. The lock was held for 87 s (−21% against
  `liv7`), median 158 ms; a median commit issues 100 statements instead of 140.
  - The wall time barely moved. From 20 s to 160 s the server committed about 3.3 correction steps
    a second, with about one commit in flight at any time, while sandbox runs kept the background
    lane's two slots busy. A step holds its slot for its script reads and its inline commit, so the
    test is bounded by steps × step time over two slots.
  - A single-completion movie took six steps: restart, audit, progress (record the occurrence),
    progress (publish), prune and clear; three of those commit only a phase change. A step that has
    written nothing now continues into the next audit, progress, prune, sweep, clear or dependency
    phase, each at most once per step, so writes per commit stay bounded. Coverage and the snapshot
    phases read the step's starting checkpoint and still start a step of their own, as does a
    restart. The movie now takes four steps.

## 2026-11-02

- The owner is not satisfied with the improvement and asked what a bigger redesign would look like.
- `probes11` adds no-hook event creates, the first measurement that separates the kernel write path
  from the plugin cascade. The cascade is about 82% of a backlog create's API CPU (`probes.md`).
- [`redesign.md`](redesign.md) proposes removing the cascade: declarative plugin effects, commands as
  one transaction, scripts that run once, and one job table. It waits on the owner's decisions.
- The VM restarted at about 03:44 UTC with nothing running: the owner restarted it from the Hetzner
  console. A first `probes11` attempt had started on stale code after a failed sync and was lost then.
- A `bun` process with 3.2 GB anonymous RSS killed at 23:42 UTC on 11-01 belongs to `liv2`, a
  `PROFILE=1` run, so it says nothing about normal server memory.
- The owner agreed to the redesign: a typical write under 100 ms, the suite under 20 minutes, plugins
  may declare effects as data, internals are free to change, and replicas must keep working.
- The spike ran the whole suite with and without the cascade (`full12`, `full13`). Writes fall about
  70% in handler time, statements 48% and machine CPU 21%, and the suite projects to 26–38 minutes,
  so the cascade alone does not reach the target. `redesign.md` is lowered to match and adds plugin
  installs and a measurement of the 55% of test time spent outside server handlers.
- `full13` first failed to start: the patch script matched the wrong indentation and had not been
  tried beforehand. The chain's wait loop also treated an inactive unit as an SSH failure, so nothing
  reported the stop, and the VM sat idle for about 20 minutes until the owner asked for status.
- `activity-log` and `fitness-exercise` each have one test that passed in `full11` and now fails every
  time at `76a8cff917`, including on an idle VM. Both look like stale expectations after feature commits
  `7767dcc8e7` and `d2769ea0d4`.
- The owner deleted the VM and allowed local runs. The raw results of `full11`–`full13` and `recheck12`
  were on the VM; this directory keeps the summaries, and the `vm-*.sh` scripts now have no target.
- Plugin scripts were checked for writing, waiting for effects to settle, then deciding. None do. Decisions
  use a write's direct result, the script's own commits, or a durable child workflow (imports).
- `local1` measures a real 150-set workout save: 3.1 s and 9,601 statements. The existing workout flows
  seed through a different path from the client's, so `flow-probes` gains `workout-editor-save-*` flows.
- The owner replaced the VM with a fresh one of the same size, and it was provisioned. The owner's review
  changed the direction, recorded in `redesign.md`: first-party plugins stay sandboxed, and derived state
  stays stored rather than computed on read.
- `legacy1` runs the home page on a real 28,619-title library. `jit=on` makes it about 5 times slower, and
  each rail visits every membership. The crash reproduces at a 400 MB limit with JIT on or off, so it is
  memory exhaustion rather than JIT alone. The run also OOM-killed another project's ClickHouse container on
  the owner's Docker VM, despite the limit on its own PostgreSQL container.
- `full15` is the clean baseline: 51 min, 945 passed, 6 failed, 8 skipped. Test time splits into 42% HTTP, 41%
  polling sleeps and 21% neither, which answers where the unmeasured time went. `full14` was discarded because
  it was accidentally started twice, so two suites ran into one results folder.
- `legacy2` compares JIT on and off on `tmp/file2.sql`. No read got clearly slower with JIT off, and the
  home page's OOM kills went from 3 of 3 loads to 0 of 3 at a 1 GB limit. The page is still poor with JIT off:
  30 s, and `upcoming` fails at the 30 s limit in 2 of 3 loads. All Shows fails at the limit either way, for
  the default view and 6 of its 8 other sorts. The direction now turns JIT off for RyotQL reads only.
- The owner confirmed the plugin section and JIT off for RyotQL reads. `legacy3` captured query plans: All Shows
  computes display fields for all 9,208 catalog shows before paging, and upcoming and the calendar read the whole
  episode catalog. `order-of-work.md` proposes the sequence for the owner's review.

