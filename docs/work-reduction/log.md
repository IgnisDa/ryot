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
