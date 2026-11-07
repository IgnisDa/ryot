# Order of work

Do it in seven steps, each one deleting more than it adds, with the job table first because most later
steps move work onto it. After each step, rerun the flow probes on the VM with the tooling in
[`../work-reduction/`](../work-reduction/README.md), and record kernel lines, statements per flow and suite
CPU next to the baseline.

1. **Freeze the baseline.** Today: kernel backend 117,500 non-test lines, 93 tables, event without hooks
   97 statements, backlog event 460 ms. Targets: about 25 statements, under 100 ms and a suite under 20
   minutes. About 60,000 kernel lines is a reference point, not a budget.
2. **Add the job table and move background work onto it.** Port the job workflows that nothing durable
   awaits: frequent cron, notification delivery, account lifecycle, backups and integration sync. Entity
   import, provider population, related pages, translation, background work and automation runs are
   awaited by plugin or import workflows, or carry projections, so they move in steps 4 and 6, where those
   callers change. `workflow_runner`, `background_work`, the fair queue, admission and wake-ups are deleted
   once the last of them moves.
   - Check: ported kinds pass their e2e files.
3. **Make every request write one transaction.** Delete the 11 request-path workflows, the direct-path
   fallbacks, receipts and the double idempotency check. Add `idempotency_key` for the four request kinds in [`idempotency.md`](idempotency.md), and drop the keys and `submittedAt` from every other request.
   - Check: event create, collection membership, signup and plugin install have no workflow rows in
     their probes.
4. **Replace the four derived-state mechanisms with one fold.** Port Media consumption and history
   correction, and Fitness workout records, then drop the stream, projection and sync-generation tables.
   Background work and automation runs become jobs here.
   - Check: the 70-episode show settles in the write itself, with no polling in its tests.
5. **Remove account generations and Redis.** Reset and delete lock the user row. Replace the
   entity-interest socket as described in [`entity-updates.md`](entity-updates.md), which makes provider
   population, related pages and translation coalesced jobs. Move the search cache into process memory.
   - Check: the server starts with no Redis configured, and the e2e stack no longer runs it.
6. **Merge the six import workflows** into one workflow with a chunk cursor and one `import_item` table.
   Entity import becomes a job, and the workflows that awaited it wait on its result.
7. **Shrink the catalog and plugin tables.** Drop the 19 views, resolve the catalog in memory, fold the
   plugin tables, and run the backup memory test to decide the restore staging tables.

Tests that pin a deleted mechanism are deleted with it, not ported. The 19 kernel test files that name
workflows are the first ones to go.

## Measurements

Flow probes on the idle VM, medians of repeats. Baselines are step 1's figures and the closing totals in
[`../work-reduction/log.md`](../work-reduction/log.md); the 150-set save is `workout-editor-save-10x15`.

| After step      | Kernel lines | Event without hooks   | Backlog event          | Review | Signup | 150-set save | 70-episode show |
| --------------- | -----------: | --------------------- | ---------------------- | -----: | -----: | -----------: | --------------: |
| 1 (baseline)    |      117,500 | 97 statements         | 373 statements, 460 ms |    955 |    265 |        4,331 |          46,400 |
| 3 (`probesS3`)  |      113,838 | 56 statements, 253 ms | 327 statements, 357 ms |    803 |    211 |        3,490 |          39,947 |
| 4 (`probesS4d`) |      110,338 | 41 statements, 124 ms | 88 statements, 259 ms  |    482 |    211 |        2,585 |          12,294 |
| 5 (`probesS5`)  |      106,092 | 41 statements, 112 ms | 91 statements, 235 ms  |    514 |    220 |        2,646 |          13,115 |
| 6 (`probesS6`)  |      105,855 | 40 statements, 104 ms | 90 statements, 248 ms  |    514 |    217 |        2,639 |          13,122 |
| 7 (`probesS7`)  |      106,099 | 41 statements, 113 ms | 91 statements, 249 ms  |    505 |    192 |        2,654 |          13,262 |

Statement counts are net of the idle background. Suite CPU was not measured, because step 3 ran only the
affected e2e files.

Step 3's check: signup, plugin install and an event create without hooks leave no workflow rows, and no
flow starts a request-path workflow. Event creates and collection memberships that match after hooks still
start `AutomationRunWorkflow`, `ScriptExecutionWorkflow` and `BackgroundWorkWorkflow` rows after commit;
automation runs and background work become jobs in step 4.

Step 4's check: the 70-episode show's test reads its completion straight after the write that covers the
last episode, with no polling. Caller time from step 3 to step 4 fell from 32,599 ms to 13,082 ms for that
show and from 4,457 ms to 2,686 ms for the 150-set save. No fold deferred to a job and no job failed across
the probes. Automation runs are jobs, so no flow starts `AutomationRunWorkflow` or `BackgroundWorkWorkflow`.
Eight of the 23 probed flows still start `ScriptExecutionWorkflow` rows; signup, plugin install and event
creates without hooks start no workflow rows. Suite CPU was again not measured, because step 4 ran only the affected e2e files.

Step 5's check: the server starts with no Redis configured, and the e2e stack no longer runs it; neither the
process samples nor the container samples of the full run name it. Statements rose a little, because work
that Redis did now runs in PostgreSQL: sandbox replays are job rows, each with its claim, its wake-up and its
foreign key checks, which adds about 800 statements to the 70-episode show. Caller time held at 13,048 ms for
that show and fell to 2,421 ms for the 150-set save. Tables went from 86 to 91: `provider_rate_limit`,
`sandbox_journal_entry`, `transient_value` and `upload_intent` replace Redis keyspaces, and
`entity_schema_refresh_override` holds an instance admin's replacement for a schema's refresh interval. Provider population,
related pages and translation still run their scripts in `ScriptExecutionWorkflow`, because a script that
falls back from a direct run repeats HTTP calls that already finished.

Suite CPU, from `vmstat`, fell from 9,383 s in `full23` to 6,683 s in `fullS5d`, and wall time from 2,642 s to
1,892 s, still above the 20-minute target. `fullS5d` passed all 810 API tests and failed 5 of 138 browser tests.
All 13 tests in those files passed when rerun on an idle VM, so the failures come from running six browser
workers on four CPUs. The desktop impersonation test also fails intermittently on an idle VM, and did in
`full23`.

Step 6's check: imports run in `ProcessImportRunWorkflow`, or in `ProcessIntegrationRunWorkflow` for an
integration, and in the script that sends a plugin's chunks; no other import workflow is registered. Entity
imports are `entity-import` jobs. Cancelling an import run sets `cancelling`, which the run checks before
each record, and then interrupts the root. Each Data segment or plugin chunk runs under a step scope, and its
applied batch is the cursor: a replay skips it and its steps are forgotten. Import tables went from 11 to 5:
`import_run`, `import_item`, `import_issue`, `import_activity` and `integration`. A data submission key
moved to `idempotency_key`, and the auto-disable claim to a column on `import_run`. All tables went from 91 to 85. The probed flows do not import, so their figures held.

Suite CPU was 6,731 s in `fullS6` against 6,683 s in `fullS5d`, and wall time 1,923 s against 1,892 s.
`fullS6` failed 1 of 810 API tests and 3 of 138 browser tests. All four passed when their files were rerun on
an idle VM. The API failure is the HTTP slot spacing test, which measured 139 ms between arrivals against
a 140 ms floor for a 150 ms limit.

Step 7's check: the baseline has no views. `DefinitionCatalog` reads a user's installations in one statement
and derives listing, effectiveness and executability in memory, caching immutable revision definitions by ID
and the kernel definitions until they are replaced. SQL readers, RyotQL among them, receive the catalog as
common table expressions named like the old views. The revision manifest is a column of `plugin_revision`,
and `user_plugin_state`, `plugin_uninstall_receipt` and `plugin_catalog_change` are gone, so plugin tables
went from 9 to 5 and all tables from 85 to 81. Retrying an uninstall replays it until the package is
installed again, and is then refused as not found. Plugin flows fell: a private install from 163 to 138
statements, a system change from 184 to 119 and signup from 217 to 192. Event flows held. Kernel lines rose
by 244, because resolving the catalog takes more TypeScript than the view definitions it replaces.

The backup memory test kept the three restore staging tables. Peak memory was 132 MB at the start, 225 MB
after export and 325 MB after archive validation, and staging, preflight and the restore transaction added
nothing, against a 512 MiB limit. Holding the staged records and their mappings in memory instead would grow
with the archive, which the limits allow to reach millions of records.

Suite CPU was 6,702 s in `fullS7` against 6,731 s in `fullS6`, and wall time 1,923 s in both. `fullS7` failed 2
of 823 API tests and 5 of 138 browser tests. One API failure was the private uninstall retry, whose test now
expects the refusal; the other was the HTTP slot spacing test. The browser failures and the slot spacing test
passed when their files were rerun on an idle VM, except the workout template test, which failed again
alongside the other browser files and passed twice when run alone.
