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
