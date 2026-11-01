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
