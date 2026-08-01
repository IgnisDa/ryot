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
