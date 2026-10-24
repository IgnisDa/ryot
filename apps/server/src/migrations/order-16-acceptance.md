# Order 16 migration inventory and acceptance handoff

Inventory taken on 2026-10-28; mapping milestone updated on 2026-10-29. Media source facts, numbered
Anime/Manga items, parent correction evidence, and Fitness occurrence snapshots are implemented.
Production processor/readiness and writer audits remain in progress with their owners. No real-dump
migration, archive build, or server assembly has run. The analytics plan and migration runbook were read.

### Current execution checkpoint — 2026-10-29

Work resumed at the user's request. Overall status is **IN PROGRESS**; no overall acceptance or final
root validation is claimed. No commit or push was made, and no second review round is planned.

- Fitness browser acceptance is final at 3/3 (smoke 1/1, interactions 2/2). Exact numeric/history,
  edit-to-3.75, smoothing, raw-reading, zero-gap, and retry checks passed. All eight workout charts
  are clear; compact measurement capture is clipped, so its visual gate remains open. Media browser
  acceptance is 1/2: ranking, source-edit, and retry passed; the prepared summary fix (viewport waits
  and chart-specific capture) was not rerun. Six projections are ready with no pending/failed work.
  Earlier fixture-concurrency timeouts are historical; the second-page and Home-link gates remain open.
- Discovery admits work before and between pages using set-based dependency joins. Its affected
  checks and unit tests passed. Relationship recovery shares the events-owned required-target
  relation with discovery. The canonical Media reporting query path is unchanged; full SQL validation
  and startup remain open.
- The user approved kernel-wide relationship recovery covering two existing work-row revisions and
  current-claim fencing; account-wide fresh silent writes, root deduplication, and restore fencing;
  readiness across event roots and descendants; once-wave preparation with publication/catalog gates;
  and automatic startup, post-restore, and post-settlement recovery. Implementation and behavioral
  tests are ready, including migration `20261029090310_relationship_projection_input_repair`.
  Targeted format/lint and affected backend/server/E2E checks passed (34/34 tasks), after fixing
  boot Layer provision. Backend tests passed 3,014/3,015; one existing relationship-visibility case
  needs diagnosis under the new account gate. Read-only discovery comparison passed all 150,028
  eligible sources with zero six-column differences, but full production discovery hit the fixed
  five-second statement limit. A private factored-selector candidate subsequently passed complete
  six-column, global, ordered-missing, and production first-page equality in one read-only snapshot.
  Exact application and revalidation are next. The failed visibility case used a stale fixture token;
  its correction keeps the visibility guarantees. No migration or startup has used the new code,
  and no new acceptance pass is claimed.
- The prior 2,500-path freeze
  `a6b15dd4f239ac832ed44833e3c2926e569dc6ee222b1b4560d67e01dfc1a36d` is invalid after the discovery
  edit. Original artifacts and evidence remain historical. A new coordinated freeze/build is required
  before startup evidence.
- The normal `file` process is stopped. Exact comparison for 121,239 records, schema validation,
  all 43 asset proofs, restart, stability, and silence proofs are retained. Normal readiness, live
  metrics, and post-runtime proof have not passed. The `file2` migration has not run and its clone is
  unused.
- File2 source-derived expectations are prepared read-only for 69 enabled accounts, excluding 230
  disabled accounts from live execution. Enabled history covers 350 workouts and 5,870 sets. Private
  evidence is under `order16-file2-live-metrics-results-20261029-01`. No destination or live query ran;
  execution identities still need the new post-implementation source freeze.
- The user's new decision is that `file2`'s 107 missing original assets are unavailable and waived as
  an overall acceptance blocker. Asset byte/owner verification remains not performed and unavailable;
  never mark it passed or reconstruct assets. Accept `file2` only if all remaining data, schema,
  group, silence, restart, runtime, live-metric, and stability gates pass. No `file2` or overall
  acceptance is claimed now.
- Substantial backend and acceptance work remains. Run affected checks before tests and serialize
  E2E runs with full-stream unique logs. Cleanup, a new coordinated build, and final root
  `bun run check` followed by `bun turbo --filter='!@ryot-app/e2e' test` remain.

#### Prior execution evidence (historical)

This earlier checkpoint supersedes older deferred-execution wording. Fresh read-only preflight passed:
both existing targets were unused legacy clones, ports 32780/32781 were free, and retained source and
asset evidence was recorded complete at that time. The clean coordinated build passed 8/8 tasks in
1m55.16s; assembly passed in 36.565s. Its 2,500-path source fingerprint was then recorded as unchanged:
`a6b15dd4f239ac832ed44833e3c2926e569dc6ee222b1b4560d67e01dfc1a36d`.

Private execution evidence is retained under
`/private/var/folders/x2/4ldmcvss5wlg5f5sfly3bqwm0000gn/T/opencode/order16-runtime/authorized-20261029-01`.
The first `file` migration-only process exited 0 in **1,061.027 seconds**. The stopped-app snapshot
captured 294,513 records across 11 kinds, including 178,492 events and 43 managed assets. Exact
comparison then exited 1: no missing rows or extra canonical events; manual minutes matched 1,847;
Fitness matched all 52,926 rows. Hashes differed for 66,146/66,188 Media facts, 2,090/2,090 correction
evidence rows, and 35/35 parent outputs. Read-only field diagnosis explains every discrepancy through
the schema's PostgreSQL `timestamp(3)` conversion: the private oracle retained source microseconds
before parent/evidence replay. Structural, amount, ownership, identity, reference, order-key, and
logical-sequence differences are zero. A schema-specific oracle correction and fresh comparison
outputs now **pass exact comparison for all 121,239 canonical records**, with 30/30 PostgreSQL
rounding-boundary cases verified. Raw JSON timestamps remain unchanged. Fresh private evidence is
under `order16-oracle-corrected-20261029-01`; no production change, rebuild, or migration rerun was
needed. The original failed comparison, target, and captures remain preserved. Persisted-schema
validation passed all 121,239 records with zero failures; all three migration silence/group checks
passed; all 43 originals passed full managed-asset byte/owner proof. Completed migration-only restart
exited 0 in 2.799 seconds, and all 11 inventory hashes stayed unchanged. The original stability CLI
failed on tuple serialization. The narrowly repaired private validator now passes all original
checks: 178,492 events, 148 reports, 124 details, and 115 schemas unchanged; 357,758 complete payload
hashes were recomputed. Both snapshots and the original failed log remain unchanged. Final restart
gates passed with zero event-group, foreign-key, automation, or notification failures. The first normal
startup is healthy at the isolated loopback port, but its first runtime gate failed: 40,916 Fitness
events, 66,223 Media events, and 28,363 Media library relationships are all unready, with zero queued,
running, or failed jobs. Discovery blocked binding for over 20 minutes; relationship bulk admission
was suppressed with cron by the isolation setting, and ordinary reads do not admit it. The owned
stalled process was stopped with no jobs admitted. The fresh `normal-stalled` snapshot passes exact
event/report/detail/schema stability against completed restart; it is diagnostic preservation only,
not runtime acceptance. Bounded event discovery and repair-ordered
relationship startup/post-restore recovery are being designed; no production edits have started.
No manual recovery or copied external dispatch has been enabled. Source-derived
expectations are prepared using read-only Fitness supplements and the corrected oracle. Live metric
comparison and stopped-runtime source stability remain open; no complete migration acceptance is claimed.
File2 is untouched and remains
data-only because its 107 original assets are unavailable. No interrupted-phase experiment is
authorized. Source databases, dumps, captures, and benchmark databases remain preserved.

The initial assembly invocation with Bun's `--cwd` placement printed usage rather than assembling;
its log is retained. The successful invocation used `apps/server` as the shell working directory.
Runtime invocations use that working directory too; a usage-only exit is not migration acceptance.

## Source inventory

Both original files are PostgreSQL custom archives, despite their `.sql` extension. They restored
successfully with PostgreSQL 18 `pg_restore --exit-on-error --no-owner --no-privileges` into separate,
new disposable databases. No source dump was changed.

| Evidence                                   | `tmp/file.sql` (34 MB) | `tmp/file2.sql` (239 MB) |
| ------------------------------------------ | ---------------------: | -----------------------: |
| Users                                      |                      1 |                      299 |
| Metadata                                   |                 38,648 |                   44,355 |
| Seen rows                                  |                 66,188 |                  654,769 |
| Completed seen rows with no finish date    |                  1,121 |                   29,130 |
| Seen rows with manual time                 |                      2 |                       50 |
| Manual time, seconds                       |                110,820 |               24,253,140 |
| In-progress manual-time rows               |                      0 |                       11 |
| In-progress manual time, seconds           |                      0 |               14,013,420 |
| Known finish timestamps at UTC midnight    |                 18,952 |                   86,218 |
| Workouts                                   |                  1,242 |                      648 |
| Workout exercise occurrences               |                 10,768 |                    4,003 |
| Workout sets                               |                 40,916 |                   11,095 |
| Sets without `confirmed_at`                |                 15,121 |                    5,601 |
| Sets with a `rest_time` key                |                 24,411 |                    5,027 |
| Exercise occurrences with legacy muscles   |                  9,389 |                    1,775 |
| Exercise occurrences with legacy equipment |                  9,519 |                    1,638 |
| Measurement rows                           |                    224 |                       62 |

Both sources have no empty seen update arrays, negative/zero manual-time values, or workout exercise
references missing from the legacy exercise table. These are source observations, not acceptance
results for migrated data.

### Source baselines for later comparison

These aggregates were read only from `order16_file_source` and `order16_file2_source`, with PostgreSQL
`default_transaction_read_only=on`. Each seen row remains an independent source occurrence; update
arrays were not expanded or interpolated. Counts below are V1 states, not inferred V2 title
completions. `F+`/`F−` mean present/absent `finished_on`; `S+` means present `started_on`. Timestamp
presence does not establish exact-hour precision. Partial cumulative values still need undated
baseline classification; an old finish timestamp on a changed state is not a new observation date.

| Dump  | Media type   | State       |    Rows |      F+ |     F− |     S+ |
| ----- | ------------ | ----------- | ------: | ------: | -----: | -----: |
| file  | audio_book   | completed   |     115 |     113 |      2 |    107 |
| file  | audio_book   | dropped     |       1 |       0 |      1 |      1 |
| file  | audio_book   | in_progress |       1 |       0 |      1 |      1 |
| file  | book         | completed   |     297 |     195 |    102 |     32 |
| file  | book         | dropped     |      12 |       0 |     12 |     12 |
| file  | movie        | completed   |     652 |     397 |    255 |    351 |
| file  | movie        | dropped     |      15 |       0 |     15 |     15 |
| file  | movie        | in_progress |       1 |       0 |      1 |      1 |
| file  | music        | completed   |  62,046 |  62,046 |      0 | 61,969 |
| file  | show         | completed   |   2,962 |   2,238 |    724 |  1,802 |
| file  | show         | dropped     |       1 |       1 |      0 |      1 |
| file  | video_game   | completed   |      47 |       9 |     38 |      8 |
| file  | video_game   | dropped     |      37 |       0 |     37 |     20 |
| file  | video_game   | in_progress |       1 |       0 |      1 |      1 |
| file2 | anime        | completed   |  20,181 |  14,809 |  5,372 |  7,295 |
| file2 | anime        | dropped     |       2 |       2 |      0 |      2 |
| file2 | audio_book   | completed   |     497 |     445 |     52 |      6 |
| file2 | audio_book   | in_progress |      12 |       0 |     12 |     12 |
| file2 | book         | completed   |   4,667 |   4,267 |    400 |  2,582 |
| file2 | book         | in_progress |      22 |       0 |     22 |     22 |
| file2 | comic_book   | completed   |      26 |       1 |     25 |      0 |
| file2 | comic_book   | in_progress |       1 |       0 |      1 |      1 |
| file2 | manga        | completed   |  17,819 |  12,001 |  5,818 |  1,518 |
| file2 | manga        | dropped     |       5 |       5 |      0 |      0 |
| file2 | manga        | on_a_hold   |       4 |       4 |      0 |      0 |
| file2 | movie        | completed   |  41,989 |  34,715 |  7,274 |    174 |
| file2 | movie        | dropped     |       1 |       0 |      1 |      1 |
| file2 | movie        | in_progress |      56 |       0 |     56 |     56 |
| file2 | music        | completed   |      44 |      42 |      2 |     14 |
| file2 | podcast      | completed   |      51 |      51 |      0 |      0 |
| file2 | show         | completed   | 568,656 | 558,589 | 10,067 |    223 |
| file2 | show         | dropped     |       5 |       3 |      2 |      0 |
| file2 | show         | in_progress |     167 |       0 |    167 |    167 |
| file2 | show         | on_a_hold   |       1 |       0 |      1 |      0 |
| file2 | video_game   | completed   |     481 |     362 |    119 |     34 |
| file2 | video_game   | dropped     |       9 |       0 |      9 |      9 |
| file2 | video_game   | in_progress |      70 |       0 |     70 |     70 |
| file2 | video_game   | on_a_hold   |       2 |       0 |      2 |      2 |
| file2 | visual_novel | completed   |       1 |       0 |      1 |      0 |

Manual values below are exact sums of `manual_time_spent`, in seconds. All other type/state groups
have no recorded manual values, not a known zero. Of the ten completed game records in file2,
one has no finish date and contributes 18,000 seconds; all eleven in-progress game records have no
finish date. All other manual-time rows have a finish timestamp.

| Dump  | Media type | State       | Rows | Manual seconds |
| ----- | ---------- | ----------- | ---: | -------------: |
| file  | video_game | completed   |    2 |        110,820 |
| file2 | manga      | completed   |    3 |          4,680 |
| file2 | movie      | completed   |   25 |        194,640 |
| file2 | show       | completed   |    1 |          2,880 |
| file2 | video_game | completed   |   10 |     10,037,520 |
| file2 | video_game | in_progress |   11 |     14,013,420 |

#### Metadata basis coverage

Counts are seen rows whose joined legacy metadata has the stated basis. They are coverage counts,
not consumed totals. Positive, zero and absent remain separate; no negative bases were found in
these fields. Skeleton classification applies the complete current populated gate, including absent
specifics and Monitoring membership; custom entities are not skeletons. `Skeleton +` counts positive
bases that would be lost if capture read only the empty V2 parent properties.

| Dump  | Type / basis unit      | Seen rows | Positive |  Zero | Absent | Skeleton rows | Skeleton + |
| ----- | ---------------------- | --------: | -------: | ----: | -----: | ------------: | ---------: |
| file  | audio_book / minutes   |       117 |      117 |     0 |      0 |             1 |          1 |
| file  | book / pages           |       309 |      285 |    24 |      0 |             0 |          0 |
| file  | movie / minutes        |       668 |      668 |     0 |      0 |             1 |          1 |
| file  | music / seconds        |    62,046 |   61,720 |     0 |    326 |           327 |          1 |
| file2 | anime / episodes       |    20,183 |   17,594 | 1,372 |  1,217 |        11,227 |     10,787 |
| file2 | audio_book / minutes   |       509 |      508 |     0 |      1 |             9 |          9 |
| file2 | book / pages           |     4,689 |    3,451 |   944 |    294 |           517 |        281 |
| file2 | comic_book / pages     |        27 |        0 |     0 |     27 |            26 |          0 |
| file2 | manga / chapters       |    17,828 |   12,951 | 3,056 |  1,821 |         5,970 |      5,679 |
| file2 | manga / volumes        |    17,828 |   12,703 | 3,074 |  2,051 |         5,970 |      5,536 |
| file2 | movie / minutes        |    42,046 |   41,898 |    53 |     95 |           517 |        429 |
| file2 | music / seconds        |        44 |       26 |     0 |     18 |            17 |          0 |
| file2 | visual_novel / minutes |         1 |        1 |     0 |      0 |             0 |          0 |

File2 records anime positions on 20,167 completed and both dropped rows (two completed positions
are zero). Manga chapter positions exist on 17,755 completed, five dropped and four held rows;
volume positions exist on 442 completed rows only. No manga positions are zero. File has no anime
or manga rows. These recorded markers were not decremented, summed as consumption, or converted
between chapters and volumes.

Episode coverage joins each seen coordinate to its own parent's stored inventory, requiring
season/episode IDs. Distinct episode IDs at one coordinate would be ambiguous; none occurred.
Positive runtime requires one episode identity and one non-null runtime value. These source joins
do not substitute for the migration's provider-identity/latest-row resolution across parents.

| Dump  | Type / state        |    Rows | Unique coordinate | No coordinate | Positive runtime | Skeleton positive runtime | Specials |
| ----- | ------------------- | ------: | ----------------: | ------------: | ---------------: | ------------------------: | -------: |
| file  | show / completed    |   2,962 |             2,961 |             1 |            2,655 |                       311 |        2 |
| file  | show / dropped      |       1 |                 1 |             0 |                1 |                         0 |        0 |
| file2 | podcast / completed |      51 |                51 |             0 |               51 |                        51 |        0 |
| file2 | show / completed    | 568,656 |           542,723 |        25,933 |          487,387 |                   470,887 |    7,861 |
| file2 | show / dropped      |       5 |                 5 |             0 |                5 |                         4 |        0 |
| file2 | show / in_progress  |     167 |               122 |            45 |              116 |                       114 |        1 |
| file2 | show / on_a_hold    |       1 |                 1 |             0 |                1 |                         1 |        0 |

No resolved episode basis is zero. Missing coordinates and resolved coordinates without a positive
runtime must remain distinct. In particular, file2 has 25,978 source show coordinates without a
matching stored episode; later migration anomaly counts must account for these rather than hide them.

#### Fitness and measurement baselines

The following quantities are independent. Set duration converts minutes to seconds, rounding each
set to the existing three-decimal storage scale before summing. It is not added to active duration
or planned rest. Negative active durations remain unknown and must produce existing anomaly details.

| Measure                                     |               file |            file2 |
| ------------------------------------------- | -----------------: | ---------------: |
| Valid active-duration rows / seconds        |  1,241 / 7,795,653 | 646 / 12,097,906 |
| Negative active-duration rows               |                  1 |                2 |
| Null / zero active-duration rows            |              0 / 0 |            0 / 0 |
| Sets with duration / seconds                |    1,465 / 283,029 |    705 / 282,998 |
| Timed-kind sets missing duration            |                  0 |               60 |
| Untimed-kind sets without duration          |             39,451 |           10,330 |
| Recorded zero set durations                 |                 15 |               58 |
| Negative set durations                      |                  0 |                0 |
| Sets with planned rest / seconds            | 24,411 / 1,310,605 |  5,027 / 318,277 |
| Sets missing planned rest                   |             16,505 |            6,068 |
| Recorded zero planned rests                 |                  0 |                0 |
| Workouts with kcal / kcal total             |        0 / unknown |          2 / 289 |
| Workouts missing kcal                       |              1,242 |              646 |
| Negative / zero energy rows                 |              0 / 0 |            0 / 0 |
| Measurement entries / named readings        |          224 / 224 |          62 / 75 |
| Empty measurement entries                   |                  0 |                0 |
| Multi-reading entries / maximum readings    |              0 / 1 |            6 / 5 |
| Distinct owner/normalized metric keys       |                  2 |               24 |
| Readings with preference unit / without     |           201 / 23 |          31 / 44 |
| Zero / missing measurement values           |              0 / 0 |            0 / 0 |
| Duplicate normalized reading keys per entry |                  0 |                0 |

Both recorded energy values use the kcal preference/default. In file2 all 60 missing timed-set
durations belong to the `duration` kind; its 114 `distance_and_duration` sets all have duration.
Measurement entries use the original `(user_id, timestamp)` boundary, not timestamp alone.

#### Enabled-account scale

Enabled means `is_disabled IS NOT TRUE`, matching migration behavior. Rankings disclose only sizes.

| Measure                                       |       file |                                  file2 |
| --------------------------------------------- | ---------: | -------------------------------------: |
| Enabled / disabled accounts                   |      1 / 0 |                               69 / 230 |
| Enabled / disabled seen rows                  | 66,188 / 0 |                      145,898 / 508,871 |
| Enabled / disabled accounts with seen rows    |      1 / 0 |                                45 / 98 |
| Largest enabled seen histories, descending    |     66,188 | 24,771; 21,967; 14,670; 11,909; 11,302 |
| Enabled / disabled workouts                   |  1,242 / 0 |                              350 / 298 |
| Enabled / disabled workout sets               | 40,916 / 0 |                          5,870 / 5,225 |
| Largest enabled workout histories, descending |      1,242 |                    113; 68; 54; 43; 24 |

The owner-approved query targets are p95 ≤500 ms for a normal period and ≤2 s for all time over
100,000 observations. No enabled source account reaches 100,000 independent seen rows. The Media
owner handles the query prototype and synthetic scale coverage; no query-performance acceptance
is claimed by this inventory.

### Media source evidence and implemented mapping

- `seen-mapping.ts` no longer expands `updated_at` or interpolates percentages. V1 keeps
  only the final `progress`, not an amount per update. `crates/utils/dependent/progress/src/lib.rs`
  appends update timestamps for both progress and state changes. Timestamps therefore cannot prove
  intermediate amounts or consumption dates.
- V1 stores `manual_time_spent` in seconds; the edit-history UI converts duration inputs to seconds.
  The adapter writes cumulative minutes on the source fact, including partial progress and resolved
  show/podcast completions. Parent terminal status does not repeat the resolved child's manual time.
- `started_on` and `finished_on` are nullable timestamps. V1 explicitly supports completed records
  without dates. Available timestamps remain ordering/start evidence. All migrated source facts use
  `dateUnknown: true`; the README's claim that V1 completion dates are always known has been removed.
- V1 has no date-precision discriminator or source-import identity on `seen`. Date-only importers
  use `convert_naive_to_utc` in `crates/utils/common/src/lib.rs`, which writes UTC midnight. The UI
  also accepts custom dates and stores UTC timestamps. Midnight alone cannot prove original date
  precision, and a non-midnight timestamp alone cannot prove an exact consumption observation.
  Preserve available evidence without claiming that discarded precision can be recovered.
- `metadata-mapping.ts` owns the populated gate. Monitoring titles, all podcasts, and non-TMDB shows
  remain skeletons even when V1 has useful specifics. Historical estimates must join legacy
  `metadata` directly before `drop-tables.ts`, not rely only on migrated entity properties.
- Source estimation fields: `audio_book_specifics.runtime` and `movie_specifics.runtime` are minutes;
  `music_specifics.duration` is seconds; `visual_novel_specifics.length` is minutes;
  `book_specifics.pages` and `comic_book_specifics.page_count` are pages;
  `anime_specifics.episodes`, `manga_specifics.chapters`, and `manga_specifics.volumes` retain their
  separate units. Game time-to-beat is not consumption evidence.
- Episode runtimes live in `show_specifics.seasons[].episodes[].runtime` and
  `podcast_specifics.episodes[].runtime`. `episodic-sub-entity-mapping.ts` and
  `episode-resolution-sql.ts` already resolve episode identities and ambiguous/missing positions.
  Use that resolution when freezing a legacy episode basis.
- Partial numbered Anime/Manga evidence retains the original position and percent as `sourceProgress`;
  no subtraction is applied. Volume-only partial evidence uses unit `volumes`. Numbered completed
  items create independent `item-complete` events; optional chapter volume is context only. Completed
  Manga fractions remain exact numeric values. Source rows are never deduplicated.

### Completion-cycle audit

Removing interpolated measurements is not an isolated row deletion:

1. Show/podcast `progress` reopens a covered episode during `seen-completion-mapping.ts` replay.
   Every explicit episode completion has its own deterministic source-row identity. Regular episodes
   use the parent session; specials stay sessionless. Parent completions close full regular coverage,
   then clear it for a repeat. Parent status must be ended/canceled; empty coverage cannot complete.
2. Anime/manga progress-to-title inference and equal-or-later completion suppression are removed.
   Supported explicit completions retain independent deterministic source-row identities. Numbered
   items use `item-complete`, with no synthetic baseline, cumulative fields, or `completionKey`.
3. Completion ordering uses finish time where present and the last update otherwise. Creation time
   retains the last update; terminal statuses sort after their partial child baseline. Unknown-date
   classification remains separate from deterministic ordering.
4. Parent completions carry `completionKey`, `completionSilent: true`, an episode-only basis, and
   frozen `completion-occurrence`/`completion-episode` evidence on the owner's Media Library. Their
   effective order uses the closing child's `~parent` suffix. No child duration is repeated.

Source facts and parent evidence have separate atomic report guards. Restart does not overwrite
completed phases. Canonical correction-worker execution still needs real acceptance.

### Fitness evidence and adapter seams

- `exercise-taxonomy-mapping.ts` maps `exercise.muscles[]` and `exercise.equipment` to typed standard
  target/equipment entities and exercise relationships, using exact active plugin/provider identity.
  `e_z_curl_bar` normalizes to `ez_curl_bar`. Legacy muscle roles are absent, not inferred.
- `migrate-data.ts` creates taxonomy before workouts and invokes `workout-taxonomy-mapping.ts` after
  set conversion. It writes one `workout-exercise` per zero-based position in `information.exercises[]`.
- Workout exercise objects in both dumps contain `id`, `lot`, `unit_system`, notes, sets and totals;
  they contain no muscle/equipment snapshot. Available provenance is the legacy exercise assignment
  at export time, not proof of its assignment when the historical workout occurred.
- Snapshots retain typed target/equipment references, null roles, and `provenance: legacy` within the
  canonical 100-item array bounds. Repeated exercises remain separate. Templates create no snapshots.
  Occurrence ordering uses workout start, never a claim about timed set evidence. Assertions check
  ownership, recorded kind, taxonomy identity, deterministic output, and each source set's join.
- `buildWorkoutSetEventMigrationSql` preserves occurrence order and recorded `exerciseKind` from
  the workout JSON, then converts weight/distance to kg/km and duration to seconds. It keeps
  `confirmedAt`, but falls back to workout start for event ordering when confirmation is absent.
  Hourly set metrics must not treat that fallback as a timed observation.
- Active duration comes from V1 workout `duration` in seconds, independently of set duration and
  planned rest. Existing invalid duration/energy handling and report guards must remain intact.

## Mapping milestone and remaining gates

Fitness's exact occurrence contract is integrated. Media's source facts and frozen parent correction
evidence are integrated. `sourceRun: seen:<id>` preserves independent source identity; frozen bases
come from legacy metadata before it is dropped, including skeleton parents. No runtime capture or
notification hooks are replayed.

The finalized Media handoff is integrated: Anime/Manga `item-complete` uses
`consumedItem: { unit, position, volume? }`, one event per original numbered completion. Anime positions
are nonnegative integers; Manga positions and completed chapter volume context retain fractions.
Volume-only items use unit `volumes`, while retaining the target's normal chapter basis. Partial
volume-only rows use noncontributing `sourceProgress`. Partial chapter volume context uses the existing
integer `mangaVolume` field; fractional context fails explicitly because that schema cannot retain it.
Unpositioned explicit completed rows remain whole-title completions. Unpositioned Anime/Manga
in-progress rows at 100 percent fail explicitly rather than implying an unsupported title completion.
Active-schema resolution now requires `item-complete` on both Anime and Manga before conversion.

Supplementary rollback-only PostgreSQL fixtures passed six Fitness cases (repeated positions and
restart, missing taxonomy, identity conflict, set mismatch, missing exercise, overflow) and four Media
cases (facts/independent completions/parent evidence/restart, then-current numbered-item guard, invalid percent,
missing target). Each used a temporary fixture schema in disposable `postgres` and rolled back; neither
restored source database was modified. These cases do not establish real-dump or startup acceptance.
Changed-file Oxlint passed for the five mapping/orchestration TypeScript files. No package or
repository validation was run, as requested.

After the finalized handoff, nine changed-mapping SQL cases passed: a 512-row positive fixture covering
503 repeated item numbers across the batch boundary, zero, fractional chapters and volumes, context,
manual minutes, partial/held/dropped volume evidence, explicit whole-title completion and restart;
and explicit aborts for fractional Anime, negative/nonfinite/malformed Manga, fractional partial
chapter context, ambiguous unpositioned percent, null state, and deterministic output conflicts.
All 512 generated events also passed the current manifest schemas and canonical allocator: 505
episodes, one chapter, and one volume from 507 item events, with zero item-derived title completions.
Manual values and unknown-date attribution remained intact; partial positional evidence contributed
no item quantity. These were rollback-only fixtures, not real-dump migrations or persisted active-schema
acceptance. The owner separately reported 62 focused Media tests passed; those tests were not rerun here.

A read-only source query after handoff established file2's exact numbered completion expectations:
20,167 Anime episodes, 17,755 Manga chapters, and 59 volume-only Manga items (37,981 item events).
There are 14 unpositioned explicit Anime completions and five Manga completions, and zero ambiguous
unpositioned 100-percent in-progress or partial volume-only rows in that source. Fractional/partial
volume behavior therefore has supplementary fixture coverage, not demonstrated real-dump coverage.

Real migrations, active-schema checks, interrupted and completed restarts, normal-startup correction,
disabled-account checks, retention/restore, asset verification, and query timings remain pending.
No canonical mapping contract answer remains pending. The Media production processor/readiness and
writer audits must finish, and the orchestrator must authorize stable builds and acceptance before
the deferred commands below run. Full file2 asset acceptance still lacks its 107 original objects.

## Disposable resources

Created only for this task, with Docker label `ryot.acceptance=order16` and network
`ryot-order16-acceptance`. Existing containers were untouched. All published ports bind loopback.

| Resource                     | Location                                                      |
| ---------------------------- | ------------------------------------------------------------- |
| PostgreSQL 18                | `ryot-order16-postgres`, `127.0.0.1:32778`                    |
| Original restored sources    | `order16_file_source`, `order16_file2_source`                 |
| Redis                        | `ryot-order16-redis`, `127.0.0.1:32779`; PING returned PONG   |
| S3-compatible storage        | `ryot-order16-storage`, `http://127.0.0.1:32777`              |
| Separate destination buckets | `order16-file`, `order16-file2`                               |
| Asset staging helper         | `ryot-order16-assets`, `/staging`; helper sleeps for 24 hours |

Disposable PostgreSQL credentials: user `postgres`, password `order16-disposable`.
Disposable S3 credentials: access key `order16-disposable`, secret `order16-disposable-secret`,
region `us-east-1`. Each bucket contains 58 cached objects totaling 284,336,460 bytes from the
runbook's existing `/tmp/ryot-bucket` cache. No remote bucket was modified or contacted.

### Source asset coverage and blocker

All source JSONB columns were scanned recursively for `s3_images` and `s3_videos` using strict
JSONPath; the denormalized collection-membership view was excluded. Only the source fields below
contain those locators. Exact, case-sensitive keys were compared with the disposable bucket listing.
Each listed reference is a distinct key in these dumps, including across source fields.

| Dump  | Source field        | Source keys | Staged | Missing |
| ----- | ------------------- | ----------: | -----: | ------: |
| file  | exercise.assets     |          30 |     30 |       0 |
| file  | workout.information |          13 |     13 |       0 |
| file2 | exercise.assets     |          50 |      0 |      50 |
| file2 | metadata.assets     |          56 |      0 |      56 |
| file2 | workout.information |           1 |      0 |       1 |

File has 43/43 keys present and 15 additional staged objects. File2 has **0/107 keys present**;
its matching object backup is a real blocker for full asset acceptance. Of those missing keys,
46 exercise and 55 metadata locators belong to owned custom rows, and one belongs to a workout:
at least 102 owned locators lack bytes. Four custom-exercise locators and one custom-metadata locator
have no source owner; their normal migration ownership/omission rules still need validation.
Do not fill missing keys with substitute content or describe unresolved-locator reports as successful
asset preservation. Presence for file is not yet content-hash/managed-asset migration acceptance.

#### File-only seed and owner decision (2026-10-28)

Executed `just --justfile /private/var/folders/x2/4ldmcvss5wlg5f5sfly3bqwm0000gn/T/opencode/order16-sync-s3.just sync-s3`
with the local endpoint redirected to `ryot-order16-storage` and destination `order16-file`. The
recipe reused `/tmp/ryot-bucket`; its 58 objects (284,336,460 bytes) remained unchanged. The
destination retained 58 objects (284,336,460 bytes), passed the empty sync dry-run, and contains all
43/43 `file.sql` asset keys. `order16-file2` retained the same object count, byte total, and manifest
as before the run. The original remote `ryot` bucket was listed read-only; no remote writes or
downloads occurred. The temporary recipe was removed after the run.

Owner decision: the `file2` object backup is unavailable. Full `file2` asset acceptance remains
blocked; continue data-only validation without substitute assets.

Missing-key extension counts (case folded): exercise has 40 extensionless, five JPG, three PNG and
two WebP; metadata has 43 extensionless, twelve JPG and one JPEG; the workout key is extensionless.
For exact set comparison without publishing filenames or user identifiers, SHA-256 of sorted unique
UTF-8 keys joined by LF with a final LF is:

| file2 missing source | Key-set SHA-256                                                    |
| -------------------- | ------------------------------------------------------------------ |
| exercise.assets      | `192b045b46ef11f5e4f296289409224e582963a6f3601bcf68d98f811418be5c` |
| metadata.assets      | `babf221a2239bed37d46bae71a8ed387693d8ad71c9e2e195805e7a55f4188ee` |
| workout.information  | `57223234c08154543f77271e02d6644d91ef6bf4645e0c1496275163b9bf9221` |

Exact locators remain available in the isolated source DB. For each listed JSONB field, enumerate
`jsonb_path_query(field, 'strict $.**.s3_images[*]', '{}', true)` and the corresponding `s3_videos`
path, extracting the scalar with `#>> '{}'`. No remote asset recovery was attempted.

Keep the source databases intact for comparisons. The parent already created both unused targets
from those templates; do not recreate or drop them. Use Redis database 0 for the first dump and 1 for
the second. Select the matching S3 bucket. Export all of these explicitly for migration and normal
startup:

- `DATABASE_URL`
- `REDIS_URL`
- `FILE_STORAGE_S3_URL`
- `FILE_STORAGE_S3_REGION`
- `FILE_STORAGE_S3_BUCKET_NAME`
- `FILE_STORAGE_S3_ACCESS_KEY_ID`
- `FILE_STORAGE_S3_SECRET_ACCESS_KEY`

Do not use the repository's `just restore-db` or `just sync-s3` against working services. The
migration asset pass can delete copied legacy keys, so each dump needs its own seeded bucket.

## Deferred execution commands

On 2026-10-29, after confirming both names were unused, the two fresh disposable targets below were
successfully created from the preserved source databases. The source databases remain unchanged.
Clone preparation is complete: **do not recreate these existing targets or drop them**. No migration,
normal startup, archive build, or server assembly has run.

Run the remaining commands only after the orchestrator confirms production audit completion and
authorizes builds. Use the repository root for the build; assembly uses `apps/server` as its working
directory. Record separate build, assembly and migration wall times. Reuse artifacts between dumps.
The parent owns the global check before building. Freeze all artifact inputs with their owners first;
if an input changes, stop and coordinate a rebuild before reusing the artifacts. The exact private
execution checklist and per-phase log paths are in the kit's `execution-readiness.md`.

```bash
env -i PATH="$PATH" HOME="$HOME" TMPDIR="$TMPDIR" BUN_OPTIONS=--no-env-file \
  bun --no-env-file turbo --env-mode=loose --filter=@ryot-app/media-plugin --filter=@ryot-app/fitness-plugin --filter=@ryot-app/sandbox --filter=@ryot-app/kernel-backend --filter=@ryot-app/kernel-renderers --filter=@ryot-app/kernel-client --filter=@ryot-app/server build
env -i PATH="$PATH" HOME="$HOME" TMPDIR="$TMPDIR" BUN_OPTIONS=--no-env-file \
  bun --no-env-file --cwd apps/server run assemble
```

The client build is explicit; assembly builds the shared client runtime and compiles every shipped
kernel renderer, including Analytics. `BUN_OPTIONS` disables automatic env-file loading in nested Bun
commands as well as the outer command. Turbo's loose env mode passes this clean environment to child
tasks; it does not disable caching. No working-service environment is inherited.

These are the successfully executed clone-preparation commands, retained for reference only. Do not
run them again against the existing targets.

```bash
docker exec ryot-order16-postgres createdb -U postgres -T order16_file_source order16_file_migrated
docker exec ryot-order16-postgres createdb -U postgres -T order16_file2_source order16_file2_migrated
```

In one shell, set up an isolated runtime invocation. `env -i` and `--no-env-file` exclude working-service
credentials. Local storage, temporary files and logs are separate per dump. The function's second
argument selects migration-only or normal startup. Ports 32780/32781 must be free before normal startup.

```bash
ROOT=/Users/diptesh/Desktop/Personal/ryot
ACCEPTANCE=/private/var/folders/x2/4ldmcvss5wlg5f5sfly3bqwm0000gn/T/opencode/order16-runtime
mkdir -p "$ACCEPTANCE/file/storage" "$ACCEPTANCE/file/work" "$ACCEPTANCE/file2/storage" "$ACCEPTANCE/file2/work"

order16_run() {
  local dump="$1" migration_only="$2" redis_db port
  case "$dump" in
    file) redis_db=0; port=32780 ;;
    file2) redis_db=1; port=32781 ;;
    *) return 2 ;;
  esac
  env -i PATH="$PATH" HOME="$HOME" TMPDIR="$TMPDIR" BUN_OPTIONS=--no-env-file \
    DATABASE_URL="postgresql://postgres:order16-disposable@127.0.0.1:32778/order16_${dump}_migrated" \
    REDIS_URL="redis://127.0.0.1:32779/$redis_db" \
    FILE_STORAGE_S3_URL=http://127.0.0.1:32777 \
    FILE_STORAGE_S3_REGION=us-east-1 \
    FILE_STORAGE_S3_BUCKET_NAME="order16-$dump" \
    FILE_STORAGE_S3_ACCESS_KEY_ID=order16-disposable \
    FILE_STORAGE_S3_SECRET_ACCESS_KEY=order16-disposable-secret \
    FILE_STORAGE_LOCAL_DIR="$ACCEPTANCE/$dump/storage" \
    FILE_STORAGE_LOCAL_TEMP_DIR="$ACCEPTANCE/$dump/work" \
    SERVER_ADMIN_ACCESS_TOKEN=order16-disposable-local-admin \
    SERVER_LOG_FILE="$ACCEPTANCE/$dump/server.log" \
    SERVER_PLUGINS_SYSTEM_DIR="$ROOT/apps/server/plugins" \
    SERVER_CLIENT_DIR="$ROOT/kernel/client/dist" \
    SERVER_DISABLE_NOTIFICATIONS=true SCHEDULER_DISABLE_DISPATCHERS=true \
    FRONTEND_URL="http://127.0.0.1:$port" PORT="$port" TZ=UTC \
    DISABLE_TELEMETRY=true RUN_MIGRATION_ONLY="$migration_only" \
    bun --no-env-file --cwd "$ROOT/apps/server" run src/main.ts
}

order16_run file true > "$ACCEPTANCE/file/migration.log" 2>&1
order16_run file2 true > "$ACCEPTANCE/file2/migration.log" 2>&1
```

`SERVER_ADMIN_ACCESS_TOKEN` is required by current configuration, including migration-only startup.
Its disposable value above must never be reused outside this loopback validation. Notification
delivery and automatic cron dispatch are disabled to avoid using copied delivery/integration settings;
projection and correction workers remain enabled. These isolation settings do not replace the
migration-silence, enabled/disabled-account, or readiness gates.

Inspect each exit status and log before proceeding. Any unexpected source-state abort is a failed
conversion, not a documented omission. After each first successful run, snapshot reports and canonical event
IDs/properties/order fields, then run the same target again:

```bash
order16_run file true > "$ACCEPTANCE/file/restart.log" 2>&1
order16_run file2 true > "$ACCEPTANCE/file2/restart.log" 2>&1
docker exec ryot-order16-postgres psql -X -U postgres -d order16_file_migrated -c 'TABLE migration_report;'
docker exec ryot-order16-postgres psql -X -U postgres -d order16_file2_migrated -c 'TABLE migration_report;'
```

Run normal startup separately for each target and stop that foreground process after reconciliation:

```bash
order16_run file false
# After file reconciliation and stopping its process:
order16_run file2 false
```

An interrupted-phase restart needs another unused clone and a separately seeded bucket, because a
completed asset pass can remove legacy keys. Keep completed targets and their comparison snapshots.

## Verification metrics for the real runs

| Gate                                                                         |      file |    file2 |
| ---------------------------------------------------------------------------- | --------: | -------: |
| Source seen rows to reconcile against output or documented episode anomalies |    66,188 |  654,769 |
| Numbered Anime/Manga item events                                             |         0 |   37,981 |
| Unpositioned explicit Anime/Manga title completions                          |         0 |       19 |
| Source manual minutes, counted once per source row                           |     1,847 |  404,219 |
| In-progress manual minutes                                                   |         0 |  233,557 |
| Workout occurrence events                                                    |    10,768 |    4,003 |
| Workout set events                                                           |    40,916 |   11,095 |
| Workout completion events                                                    |     1,242 |      648 |
| Measurement entries / readings                                               | 224 / 224 |  62 / 75 |
| Enabled / disabled users                                                     |     1 / 0 | 69 / 230 |
| Original asset keys available                                                |   43 / 43 |  0 / 107 |

These are source expectations, not measured destination results. Compare exact source/destination
sets by owner and source identity, not only counts. Reconcile any reported unresolved episode's
consumption separately; do not silently subtract it from the source baseline. In particular:

- No interpolated quantities, numbered-item-to-title inflation, inferred exact hours, or parent
  duplicate duration. Check zeros and missing quantities separately. Freeze skeleton metadata bases
  and retain all explicit repeats, fractional chapters and volume evidence through `item-complete`.
- Every source set joins exactly one occurrence by plugin, owner, workout, exercise and order; kinds
  match the saved workout JSON. Taxonomy arrays match export-time assignments with null legacy roles.
- Decode migrated properties and typed references against the persisted active schemas, including
  correction evidence. Require zero schema failures, reference failures and deterministic conflicts.
- Compare event IDs, complete properties, effective order, and phase reports across completed restart.
  Exercise interrupted restart independently; completed phases must preserve later edits/suppression.
- After normal startup, wait for enabled library projections to become ready; compare live summaries
  and canonical facts. Correction must preserve frozen evidence and independent occurrences. Disabled
  accounts must run no plugin work. Check notification and automation-history counts after migration.
- Verify managed-asset byte hashes and ownership for file. Record file2 unresolved locators explicitly;
  its unavailable 107 objects remain outside data-only acceptance. Exercise reference remapping and
  frozen-evidence retention through the coordinated backup/restore acceptance.
- Record p95 ≤500 ms normal-period and ≤2 s all-time queries at 100,000 observations with the Media
  owner's prototype. The largest enabled real histories are only 66,188 / 24,771 source rows; record
  synthetic-scale evidence separately. No performance result is claimed here.

## Reproducible read-only acceptance kit (2026-10-29)

The prepared kit is at
`/private/var/folders/x2/4ldmcvss5wlg5f5sfly3bqwm0000gn/T/opencode/order16-acceptance-kit`.
This exact directory was verified against the environment. Its `README.md` describes the queries,
scope, privacy rules, expected exit codes, and deferred execution sequence. Its acceptance commands
perform no PostgreSQL or object-storage writes. PostgreSQL export connections use both
`default_transaction_read_only=on` and explicit repeatable-read/read-only transactions. S3 uses signed
GETs against the fixed disposable loopback endpoint. Local private SQLite/JSON/gzip artifacts are the
only data written. Console output contains aggregate counts and fingerprints, not source identifiers.

`source.sql.json` and `expected.py` reconstruct source expectations independently of the migration
SQL. `accept.py compare` performs exact ID/property/ownership/logical-order joins, rejects extra
canonical events, checks source-run multiplicity and manual minutes once per run, reconciles unresolved
episode identities with report details, verifies Fitness kind/taxonomy/provider/metric values, and
checks nested typed references. Parent completions and every frozen supporting episode are compared
separately. `validate.mjs` validates properties against destination-persisted active schemas.
`gates.py` covers migration notification/automation silence and enabled/disabled runtime work/readiness.
`assets.py` proves original byte hashes, permanent owner namespaces, registrations, owning references,
and destination bytes. Full file2 asset verification remains blocked rather than returning success.

### Preparation actually run

- Source SELECTs executed read-only against both preserved databases. Complete private source captures
  and symbolic expected-event inventories were produced. No destination query or migration was run.
- File2's first capture exceeded a 120-second command timeout. Its incomplete **local** SQLite capture
  was retained as `file2/interrupted-source.sqlite`; a fresh capture completed with a 600-second timeout.
  That incomplete file is never used by the comparison commands.
- Exact source-derived baselines match 37,981 file2 numbered items, 19 unpositioned Anime/Manga title
  completions, 10,768 / 4,003 workout occurrences, and 40,916 / 11,095 sets. Source manual minutes are
  1,847 / 404,219 across 2 / 50 source rows. Expected omitted episode identities are 1 / 25,978.
- Original asset GETs hashed all 43 file keys before any migration deletion. All 107 file2 keys returned
  unavailable. The captures retain content type, byte size, SHA-256 and original ownership references.
- Python AST and query-JSON syntax checks passed. The standalone persisted-schema validator imported
  successfully and rejected an empty input with exit 1, proving an empty export cannot pass.
  Destination SELECT execution, real persisted-schema validation, exact comparisons, restart gates,
  runtime readiness and managed-destination byte checks remain deferred.

| Prepared fingerprint                   | file                                                               | file2                                                              |
| -------------------------------------- | ------------------------------------------------------------------ | ------------------------------------------------------------------ |
| Exact source seen rows                 | `b6b71e06d3d6595aa9f9f71cfb168da67819bac9f49ffd7cbcff1310d08e7918` | `07ff70bfa4c196f5b5c6be2340b5ccfd0438e1bae54003914bc6521f188e7a0c` |
| Exact source workout rows              | `3bea2607b251b815757b91805744a4ad445cc6c6af553475f13dc8176a945ee2` | `44ee2c8e70f552312eb44228609828d560a838a71aa34031984e407ca6f10e16` |
| Original asset byte/ownership manifest | `a345e0303cc95861c1651bcd0cd40c5d6e0f95ce785f8e657c1662985a7fc66e` | `762c5e4804f92e05d6aa86c25bc026cfebf1064c08a7065044cb8cf71c5537c6` |

The complete per-table and symbolic expectation fingerprints are in each dump's `source-summary.json`;
asset evidence summaries are in `source-assets-summary.json`. Symbolic plugin/provider names make the
source expectations deterministic before destination installation IDs exist. Comparison rebuilds the
expected identities using the exact destination active plugin/provider bindings. These fingerprints
are preparation evidence, not successful destination acceptance.

### Commands for the parent after authorization

Keep the application stopped during each cross-table snapshot. Use fresh labels; existing local
captures are rejected. These commands only read the already-migrated destination; they do not perform
the build, migration, restart, or normal startup. Run only after the parent separately authorizes and
completes those operations. The same sequence applies to `file2` with its own directory and database.

```bash
KIT=/private/var/folders/x2/4ldmcvss5wlg5f5sfly3bqwm0000gn/T/opencode/order16-acceptance-kit
python3 "$KIT/accept.py" snapshot file migrated
python3 "$KIT/accept.py" compare file migrated
bun --no-env-file "$KIT/validate.mjs" "$KIT/file/migrated-validate.jsonl.gz"
python3 "$KIT/gates.py" file migration
python3 "$KIT/assets.py" verify file migrated

# After an authorized migration-only restart has exited:
python3 "$KIT/accept.py" snapshot file restarted
python3 "$KIT/accept.py" stability file migrated restarted

# During authorized normal startup, after reconciliation:
python3 "$KIT/gates.py" file runtime
# After stopping that process:
python3 "$KIT/accept.py" snapshot file reconciled
python3 "$KIT/accept.py" runtime-stability file restarted reconciled
```

Migration-only stability requires identical event IDs/properties/effective order and complete report
and detail hashes. Runtime stability checks original source facts and workout events plus reports,
excluding mutable correction checkpoints/run state and newly derived outputs. Exact live summary
equivalence, performance and backup/restore remain runtime-owner gates; readiness alone cannot prove
them. File2 asset verification exits 2 for its unavailable source bytes; this remains a full-asset
blocker even when all data-only comparisons pass.

### Final canonical event-group alignment

The finalized contract stores declaration metadata in `definition_event_schema.event_group`.
`20261028192959_event_groups` updates definitions and views; it introduces no event-row column.
Fitness anchors are unique by user/plugin/session/`exerciseOrder`, including across different
exercises. Every anchor requires at least one `workout-set`, and every set requires exactly one anchor
matching user, plugin, session, exercise, order and kind. The declaration makes session, kind, targets,
equipment and provenance immutable.

The final mapping change is limited to `workout-taxonomy-mapping.ts`: its existing source validation
uses a JSON-type `CASE` before `jsonb_array_length` and explicitly rejects empty or malformed set
inventories. The operator message requires corrected V1 evidence and a fresh restored copy, and says
not to invent sets or silently skip positions. The parent checked the preserved sources read-only:
file has **0 empty positions / 10,768**, and file2 has **0 / 4,003**. A separate read-only scan of the
retained local captures confirms those totals and zero malformed inventories. Expected counts do not change.

The private kit's `expected.py` rejects empty/non-array source sets. `accept.py` captures persisted
`event_group`, requires the exact Fitness declaration, exports grouped schemas for `validate.mjs`,
and includes schemas in restart hashes. The validator uses `PluginEventGroup` and
`pluginEventGroupIssue`. `group-consistency.sql` checks generic declared groups for duplicate keys,
invalid keys/sessions, unmatched or ambiguous dependents, and orphan anchors in both gate phases.
The historical restore owner must also run this query after event copying and before legacy table
removal/restore acceptance, with all failure counts zero. Kernel-owner tests cover mutation enforcement.

Focused verification passed: changed-file format/lint and Python/query syntax; **8 mapping rollback
cases**, **12 generic group rollback cases**, and **4 validator export cases**. The controlled mapping
cases cover valid repeated positions and empty, missing, null, object, string, number and boolean set
inventories. Group cases cover valid groups, missing anchors/sets, duplicate keys across exercises,
mismatched exercise/kind/order/session/owner/plugin, missing keys and null sessions. All SQL fixtures
used isolated schemas in disposable `postgres` and rolled back; none used a source or target database.
The reusable fixture command is `python3 "$KIT/group-fixtures.py"`.

This mapping and kit are ready for authorized build/migration against the canonical constraints.
The parent reports the kernel event-group scope passed 223 tests in 15 files through split runs, with
type/lint checks passing and no known failure in that scope. The earlier combined run had 21
fixture/load failures; subsequent lifecycle (24), service (60), and remaining-file (139) runs passed.
This is reported scoped evidence, not a consolidated backend, review, or E2E result. Stable-source
coordination, the parent's global check, remaining owner integration gates, and explicit authorization
still gate execution. Actual destination
queries, schema validation, restart/runtime checks, and destination asset proof remain unrun; file2's
107 unavailable original assets still block full asset acceptance. No targets, source databases,
dumps or object storage changed during this alignment.

### Execution-readiness inspection (2026-10-29)

Current Media declarations contain the mapped frozen basis, `dateUnknown`, `calendarDate`, minutes,
source identity, numbered item payload, and parent correction fields. The legacy sources still prove
unknown consumption dates, so the mapping must not fill `calendarDate` from ordering timestamps.
Current Fitness declarations and the private group's exact expected declaration agree; event-group
metadata adds no event-row column. No mapping/schema blocker was found in this bounded inspection.
Static field coverage passed for 48 current Media event schemas and the parent correction fields.

Two preparation defects were corrected without executing a build or touching a target. The isolated
run command now supplies the required disposable admin token and built client directory. The private
schema validator now rejects any successful parse that removes, adds, or normalizes persisted
properties. This closes a false-positive path: non-strict schemas can silently strip an undeclared
canonical field. Property-schema validation still does not establish allocator semantics, live summary
equivalence, performance, or backup/restore behavior. Those remain their owners' gates.
Four focused private validator cases passed: five valid canonical records, and rejection of stripped
fields, decoded rounding, and added defaults. No PostgreSQL fixture or earlier passed proof was rerun.
Changed Markdown formatting, JavaScript/Python syntax and standalone private-kit lint passed. The
repository's production lint rules reject the external CLI's existing Node import/object ordering;
that separate invocation did not pass and no suppression was added. No repository-wide check ran.
