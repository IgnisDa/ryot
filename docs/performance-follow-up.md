# Performance Follow-up

Plan, **2026-11-26**, written at the end of PR #1878 (`write-pipeline`, head `df43470bc5`) for an
agent that starts fresh. This is an engineering reference. Once an item ships, the owning package
README replaces its section.

## Start here

- **History.** The work came out of the T3 thread `34da0f1c-d086-4c85-8c7b-ddef7bae9c71`
  (Claude Code session `a46c0786-b11d-471e-b9c4-164a0dacdd62`). The original problem statement is in
  thread `ec1e8561-ce94-4ad3-bc30-3ad27d441e3b` and the threads it links. Read the user's prompts in
  both before planning. The thread also holds what this document deliberately leaves out: the
  measurement host's address and access, its container rules, the image build recipe, and where the
  datasets live.
- **What #1878 changed:** [`write-pipeline-design.md`](write-pipeline-design.md). Its item 11 holds the
  final real-data numbers at the merged head.
- **Branch.** Start from `ultra-rewrite` once #1878 is merged, or from `write-pipeline` if it isn't yet.
  Use one common commit prefix, such as `[perf-follow-up]`.
- **Scope.** Do the items in the order below, one focused change at a time, and measure each one before
  and after on the same dataset. Ask the user before widening scope.

## Goal

Every action feels fast on a 2-core / 4 GB server with a large real library: **at most 250 ms warm
server time (p50)** for interactive reads and writes. An empty library keeps its current feel.

These constraints are settled, and the user decided each of them:
- First-party plugins stay sandboxed and use the same contract as third-party ones. There is one way of
  doing things, and no second trust level.
- Ryot is greenfield: no compatibility paths, shims or workarounds. Code stays DRY at the right layer,
  with domain vocabulary in plugins and the kernel product-agnostic.
- Results must not change. Where a value is stored to make reads cheap, tests prove that stored and
  live values are equal, including as time passes without a write.

## Where #1878 left things

#1878 made writes independent of history size and moved every kernel write onto one commit path. On a
local container limited to 2 CPU / 4 GB, warm writes and most reads meet the target. On the
measurement host they don't:
- writes are 3–6× slower there;
- most of that time is sandbox runs;
- analytics and some lists are still O(history) or O(library).

### Datasets

These are real V1 databases. They hold other people's data, so the following rules apply:
- Never print, open or commit rows. Report aggregates only.
- Upload them only to the measurement host, which has no egress.
- Never copy them into the repository.

| Dataset | Users | Shape |
|---|---|---|
| `file.sql` | 1 | 28.9k library members, 68k watches, 1,254 workouts |
| `file2` | 299 (49 with events) | owner: 14.7k library, 56.6k events, 4,610 shows; 3.65 GB database |
| `file3` | 2 (1 with data) | 16k library, 154k watches |

The Ryot Cloud dumps (`dump1`–`dump3`) are pre-release V2 databases, not V1. The migration can't read
them, and a converter would be a compatibility path, so they are not used.

### Measurement setup

- **Harness:** `e2e/src/api/perf`:
  - `library-check` for reads;
  - `warm-writes` for writes; `WARM_WRITES_USER_RANKS` runs several users at once;
  - `flow-probes`.

  They run against an external server, as described in [real-data probes](../e2e/README.md#real-data-probes).
- **Local clone:** Docker limited to 2 CPU / 4 GB. The design doc's numbers come from here.
- **Measurement host:**
  - 2 cores shared with other services (up to about 1 core of other load), app 2 GB, database 768 MiB,
    `shared_buffers` 128 MB, no egress;
  - 3–5× slower than the local clone for reads and 5–6× for writes;
  - touch only the measurement containers there;
  - build images locally (linux/amd64; see the thread for the cross-build recipe), never on the host.
- **Local load:** the laptop rebooted once under several agents' load. Run one heavy local job at a time
  (builds, tests, containers), check `uptime` first, and wait while the 1-minute load is above 8. Run
  e2e files one at a time.

### Numbers at `4c64f50ae7` on the measurement host (`file.sql`, p50 round trip)

The merge with `ultra-rewrite` and a cleanup followed. Final numbers at the merged head are in the
design doc's item 11.

**Writes.** Before #1878's performance fixes → after. Local clone figures are for comparison.

| Write | Host before | Host after | Local clone |
|---|---:|---:|---:|
| Review delete | 569–719 ms | 593–887 ms | 121–138 ms |
| Progress log (movie, music) | 739–787 ms | 741–829 ms | 152–161 ms |
| Show episode log | 1,137–1,386 ms | 1,345–1,755 ms | 200–235 ms |
| Workout save, one exercise | 1,018–1,095 ms | 1,002–1,049 ms | 197 ms |
| Workout save, 9 exercises / 35 sets | 1,633 ms | 1,731 ms | 286 ms |

- **Run cost:** a write makes about 2.7 sandbox runs, and about 760 ms of the mean 1.13 s request is
  sandbox attempt time.
- **Show episode logs:** they got 60–90 ms more SQL in #1878 because they now refold the stored
  library summary.
- **Concurrency:** with the 4 largest `file2` users writing at once, p50 rose to 2.5–9 s and p95 up to
  15 s. `reserveRun` waited p50 662 ms, p95 2.4 s and max 11.9 s, with no refusals.

**Reads**

| Read | Before #1878's fixes | After |
|---|---:|---:|
| Continue / backlog shows | 1,674 / 1,559 ms | 378 / 398 ms |
| Show detail summary | 1,716 ms | 536 ms |
| All shows / search | 865 / 842 ms | 478 / 533 ms |
| Upcoming | 831 ms | 463 ms |
| Continue / backlog podcasts | 448 / 501 ms | 221 / 245 ms |
| Show detail activity | 1,934 ms | 1,582 ms |
| Flat rails | 0.7–0.8 s | unchanged |
| Analytics summary, all time / year | 8.7 / 9.4 s | unchanged |
| Analytics trend, all time | 2,660 ms | 4,427 ms (recheck 4,741), same statement |
| Analytics ranking / records / activity | 2.3 s / 0.39 s / 6.2 s | unchanged (activity 6.7 s) |
| Music view, three pages | 4.4 s | unchanged |
| Fitness totals | 2.7 s | unchanged |
| Page load | 10.8 s | 10.2 s |

On `file2` before the fixes, all shows took 11 s (p95 26 s, with 30 s timeouts) and continue-show
took 7 s.

**Background**
- **Fold drain after migration:** 45 min for 1,177 jobs, 0 failed, about 3 CPU-s per job, 2.36 s per
  sandbox attempt, 97 host calls per attempt at 16.7 ms mean. `file2` took 2 h before the fixes.
- **Steady state:** 108 statements and 1.7 s of SQL per 5-minute cron, against 1.3 s before. Signal
  schedules take about 1.0 s, script liveness 301 ms (69 before) and config prune 211 ms (80 before).
  Other tenants' load was higher during the second run.
- **Memory:** the app peaks at 650–810 MiB during migration and drain, with no out-of-memory.

## Work, in order

The `#n` numbers are the measurement diagnoses' numbers, kept for cross-reference with the thread.

### 1. Sandbox code cache (#5, #6)

- **Cost:** writes are 0.6–1.8 s on the host against 0.12–0.29 s locally, and they don't depend on
  library size: the median user matches the largest. Shared admission multiplies this under
  concurrency (see above).
- **Cause:**
  - Each write makes 2.6–2.8 runs. Guest-only time per run is p50 129 ms and p95 421 ms; background
    runs with no host calls are p50 91 ms.
  - `kernel/sandbox/native/src/execute.rs` builds a fresh `JsRuntime` from the snapshot and parses and
    compiles the module source on every run, with no code cache.
  - Plugin modules are median 65 KB and max 304 KB, across 254 scripts.
  - Host RyotQL calls inside runs add p50 75 ms and p95 1.2 s.
- **Fix:**
  - Add a V8 code cache keyed by the module SHA-256, which `execute.rs` already computes, held per
    sidecar generation (`ModuleLoader::load`; `deno_core` `ModuleSource` with a code cache).
  - Isolates stay fresh per run.
  - Then measure whether one write's planner, fold and after-hook runs can share one run. That is a
    larger `ChangeSets` change, so ask before doing it.
- **Expected:** remove the compile share of the 90–130 ms fixed cost per run, roughly 150–300 ms per
  write on the host. Shorter runs also shorten admission waits.
- **Verify:**
  - guest-only time per run, from traces;
  - warm-writes p50 for one user and for 4 concurrent users on `file2`;
  - the sandbox's existing benchmarks in the git history (commits labelled `[sandbox-` or
    `benchmark`).

### 2. Cover images in list rows (#13)

- **Cost:** saved views select one preferred image, at 24–27 KB per 20 rows. The lifecycle rails still
  select the whole images array: backlog-flat 137 KB / 71 KB, backlog-show 66 / 44 KB, upcoming 60 KB.
  Movies and shows carry 220 images on average, up to 1,020.
- **Fix (Media):** `lifecycle-list-recipes.ts` `listedMediaSelection` uses
  `mediaPresentationImageSelection`, and its client consumers follow.
- **Expected:** about 25 KB per 20 rows, constant per page.

### 3. Analytics (#3): cheaper aggregation, then stored rollups

- **Cost (p50):**

  | Read | `file2` | `file3` |
  |---|---:|---:|
  | Summary, all time | 9.6 s | 21.2 s |
  | Trend, all time | 7.3 s | 11.6 s |
  | Hours, all time | 5.8 s | 2.3 s |
  | Ranking, all time | 3.6 s | 7.5 s |
  | Records, all time | 11.3 s (cold I/O) | 0.57 s |
  | Summary, year | 2.8 s | 8.2 s |

  On the local clone the slowest are 1.1–2.1 s.
- **Cause:** every statement aggregates all of the user's consumption events (24.4k on `file2`, 153k on
  `file3`). Per event it:
  - joins `entity` by primary key only for the media type, which is the top self-time node;
  - reads the projection through a parallel sequential scan of every user's `derived_value` rows;
  - visits scattered event heap pages.

  45–85% of blocks come from disk. Summary's `processing` counts projection status per event, which
  takes 1.6–4.8 s.
- **Fix:**
  - **(a) Media:** carry the media type in the consumption contribution
    (`consumption-projection.ts`, `ConsumptionContribution`) and group by it. Join `entity` only for
    the at most 100 rows that ranking and records return (`analytics-recipes.ts`,
    `consumption-recipes.ts`).
  - **(b) Media:** summary `processing` reads one status per stream (`projectionProcessing` over
    `eventStream`) instead of a per-event `countIf`.
  - **(c) Kernel + Media:** stored rollups per user × media type × local day, maintained by the
    consumption fold. All-time and year ranges read the rollups and scan events only at the partial
    edges. Only (c) reaches 250 ms; without it, cost stays linear in history.
- **Also check:** analytics trend, all time, went from 2.7 s to 4.4 s across #1878 with the same
  statement. The design doc's item 11 says whether that was host contention or a plan change. If it is
  a plan change, fix it here first.

### 4. Catalog relation estimates (#10)

- **Cost:** Fitness totals take 2.7 s and target ranking 1.6 s on the host. The plugin catalog's
  `installations` relation sequentially scans `plugin_revision` once per saved view (40–340 ms).
- **Cause:** the `user_*` catalog relations come from `jsonb_array_elements`. The planner estimates
  them at 100 rows, or 1 after a filter, and picks nested loops. Fitness totals remove 521k rows by
  join filter, and target ranking removes 1.19M, which is quadratic in a lifter's sets.
- **Fix (kernel):** in `modules/definitions/catalog-relations.ts` `elements()`, emit relations whose
  row count the planner knows, such as a `VALUES` list or a materialized relation with statistics.
- **Expected:** hash joins, with Fitness rank and totals at about 0.1 s.

### 5. Plugin catalog ETag (#12)

- **Cost:** 545 KB on every refresh after #1878 (663 KB before), 98% of it Media `clientEntities`, at
  371–399 ms round trip. Its size is constant per refresh and doesn't grow with data.
- **Fix (kernel + client):** serve it keyed by a content hash of the user's installation and revision
  set (an ETag), so an unchanged refresh returns 304.

### 6. Fold drain throughput (#7)

- **Cost:** 45 min per 1,200 fold jobs on `file.sql`, and 2 h on `file2` before #1878's fixes.
- **Cause:**
  - The drain is serialized on the one background sandbox slot: attempt time sums to the drain's wall
    time, and the background lane gets at most half of 2 slots.
  - Each fold attempt makes about 97 host RyotQL calls.
- **Fix:**
  - **(a) Media:** fold scripts batch their reads into fewer host calls. Each call costs about 20 ms
    outside SQL on the host.
  - **(b) Kernel/sandbox:** background runs may borrow idle interactive capacity
    (`kernel/sandbox/src/host/admission.ts`, lane shares).
- **Expected:** (a) cuts run time in proportion to the calls saved. (b) gives up to 2× throughput when
  there is no interactive load.

### 7. Steady-state cron (#9)

- **(a) Integration providers, 282 ms per cron on `file2`.**
  - Cause: `prepareYankRuns` resolves providers per user, then `evaluateIntegration` resolves them again
    per integration, each time joining `plugin_revision` blobs.
  - Fix: pass the resolved provider through (`integrations/service.ts`,
    `plugins/catalog/readiness-service.ts`), and build readiness metadata from `DefinitionCatalog`'s
    immutable per-revision data (`plugins/catalog/integration-providers.ts`).
- **(b) Script liveness, 66–301 ms.**
  - Cause: the workflow-reference branch of `retainedScriptExecution` ORs two conditions, so it runs a
    nested loop over every script for each script, O(scripts²). The `automation_run` branch has the
    same shape.
  - Fix: split each OR into separate `EXISTS` clauses (`plugins/packages/repository.ts`).
- **(c) Config revision prune, 80–211 ms with 0 candidates.**
  - Cause: JIT compilation is 55 of 98 ms.
  - Fix: the same OR split in `pruneRevisionArtifacts`, and `jit=off` for the app's maintenance
    statements, as RyotQL reads already do.
- **(d) Signal-schedule targets.**
  - Cause: `listUserPlugins` reads every installation, including disabled users' (598).
  - Fix: filter disabled users and page by user in `signal-schedules/repository.ts`.

### 8. Suggestions (#14)

- **Cost:** 626 ms of SQL on `file3`.
- **Cause:**
  - The `source` InitPlan walks 16k library members against a non-user-scoped index.
  - `eventOrderDescending` emits `occurred_at DESC NULLS LAST`, which no index matches, and
    `occurred_at` is `NOT NULL`.
- **Fix:**
  - Media `discovery-recipes.ts` `suggestionSourceId` drives from the user's `complete` events through
    `event_user_schema_occurred_at_idx`, scanned backward.
  - The kernel orders `NOT NULL` columns without `NULLS LAST`.

### 9. Indexed projection keys (#4, including #1878's open 2b)

- **Cost:**
  - Flat rails take 0.46–0.8 s, three pages of all movies 2.3 s, and the music view 4.4 s on the host.
  - Lifecycle lists still filter by state before paging; on `file2` that is 4,610 loops, about 1 s.
- **Cause:** lifecycle state and `lastActivityAt` live in `derived_value` JSON. Each page reads every
  library member's projection and sorts again, O(library).
- **Fix (kernel + Media):**
  - Plugins declare typed, indexed projection keys, for example (user, kind, `lifecycleState`,
    `lastActivityAt`), so RyotQL can page by key.
  - Files: `kernel/backend/src/schema/tables/derived-values.ts`, the RyotQL catalog projection fields,
    and `plugins/media/shared/library-summary.ts`.
- **Expected:** about 0.2 s for three pages.

### 10. Statement overhead (#11, measure first)

- **Cost:** time outside SQL execution for the largest recipes was 0.66–1.8 s on `file2`. PostgreSQL
  planning takes 170–470 ms on 135–192 KB statements.
- **Since #1878:**
  - The largest statements shrank: continue-show from 135 to 29.5 KB, show detail summary from 192 to
    44 KB.
  - The merge with `ultra-rewrite`'s timed and date-only airing rule grew them again. The library
    summary is 1.34× its size, the show presentation went from 37.5 to 50.9 KB, and continue-show from
    30.2 to 46.4 KB.
- **Options:**
  - render that rule more compactly in RyotQL;
  - measure plan reuse for identical SQL text (named prepared statements per connection). Generic plans
    can mis-plan skewed parameters, so measure before adopting.

### 11. Database settings documentation

- A 768 MiB database with `shared_buffers` at 128 MB and `effective_cache_size` at 4 GB makes the
  planner assume a cache that isn't there. Document settings sized to the container.
- Per-user rows are scattered across a multi-user heap. The migration could insert events ordered by
  (user, entity, `occurred_at`) for locality; live writes interleave anyway. Measure before changing.

## Not scheduled

These are listed so they aren't rediscovered; each needs the user's go-ahead.
- **Server memory budget.** The user deferred it on 2026-11-19. Earlier threads: one Ryo compile
  takes 340–740 MB, the app grew from 329 MB to 1.9 GB, and the host froze.
- **Show episode log cost.** Each write refolds the stored library summary, about 60–90 ms of SQL on
  the host. That is what makes #1878's show cards and continue-watching lists cheap to read.
- **Media fold sources.** `occurrences` and `coverageSources` grow with history; a title needs about
  7k sources to reach the bound.
- **Manual imports** store `sourceRun` without the run prefix that `batch.ts` adds.
- **Policy chunks.** A subject with more than 50 items gets a chunk of its own, and a chunk over the
  sandbox context limit fails with `policy-execution-failed`.
- **Timing-sensitive e2e tests.** `reminders/recovery` has about 47 s of headroom, and
  `global-provider-rate-limiting` fails under load when a restart outlasts its 20 s window.

## Working rules

- Root `AGENTS.md` applies:
  - make package checks pass before tests;
  - run only affected tests, with `bun turbo test --filter=<pkg> --concurrency=1`;
  - run affected e2e files one at a time, never the whole suite;
  - run `.agents/skills/codebase-cleanup` in the main session at the end, then root `bun run check`.
- Never use bare `git stash` or `git stash pop`; the stash is shared with other worktrees and sessions.
- Push as `IgnisDa` with a per-command token. Never switch the global `gh` account.
- Before declaring an item done, report its numbers before and after on the measurement host, beside
  the local clone's.
