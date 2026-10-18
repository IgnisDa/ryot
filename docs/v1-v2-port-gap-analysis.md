# V1 → V2 Port Gap Analysis

## Scope and evidence

Code inventory audited on **2026-10-26**, against repository commit
`e85f5099664211919552cca54b26c8ffe97541d5`. This is a legacy engineering reference,
not maintained product documentation; maintained user documentation lives in `apps/docs`.

The comparison covers V1's public operations, HTTP handlers, scheduled work, dependent
utilities, data models, preferences, and client screens. It maps these to executable V2
services, plugin declarations/scripts, recipes, client surfaces, and migration mappings.
Generated files, dependency trees, build outputs, and historical migration steps are not
separate product features. Test references below are evidence of existing coverage, **not
a claim that those tests were run for this documentation audit**. Provider declarations
and fixtures do not prove that every upstream service works live.

### Current source map

| Area | V1 reference | V2 implementation |
| --- | --- | --- |
| Backend assembly and jobs | `crates/backend/src/{common,main,job}.rs` | `apps/server`, `kernel/backend/src/boot`, `kernel/backend/src/platform` |
| Public API | `crates/resolvers`, `crates/graphql` | `packages/contract/src/modules`, kernel routes, plugin operations |
| Business logic | `crates/services`, `crates/utils/dependent` | `kernel/backend/src/modules`, `plugins/{media,fitness}/backend` |
| Models and persistence | `crates/models`, `crates/migrations` | `kernel/backend/src/schema`, contract schemas, plugin `manifest/schemas` |
| Metadata providers | `crates/providers` | `plugins/media/backend/providers`, `plugins/fitness/backend/providers` |
| Plugin execution and authoring | Compiled-in Rust services/providers | `kernel/sandbox`, `packages/plugin-{backend,client}-compiler`, plugin SDKs, `packages/plugin-archive`, `packages/cli` |
| Client | `crates/frontend/app` | `kernel/client`, plugin `client` directories, `packages/kernel-renderers` |
| Queries | Domain-specific Rust services | `packages/ryotql`, `packages/ryotql-recipes`, plugin `shared/*recipes.ts` |
| Deployed V1 data conversion | Not applicable | `apps/server/src/migrations` |
| Companion clients | `apps/browser-extension`, `apps/kodi` | Same directories; extension now uses the V2 contract |

The former `apps/backend`, `apps/app-backend`, `modules/ryotql`,
`lib/sandbox/scripts/providers`, `modules/god-mode`, and `modules/legacy-bootstrap`
locations are not the current source map.

### Status rules

- **Covered**: the behavior has a concrete implementation and a usable API or client path.
- **Reshaped**: a concrete replacement exists, but its contract or semantics differ.
- **Partial**: a feature works, but identified V1 behavior or client controls are absent.
- **Missing**: no equivalent producer, command, recipe, or client path was found.
- **Excluded**: a retained exclusion or documented omission; not an automatic port task.

No GraphQL-shaped endpoint is required for parity. V2 reads persisted rows through
RyotQL; HTTP reads serve non-row results such as jobs, files, health, and process state.
Generic query or write capability alone does not count as a finished domain feature.

## Summary

The old backlog overstated the missing surface. Account exports/restores, genre entities,
collection update/delete and contents, custom-entity editing, event editing/deletion,
fitness record rebuilding, Calendar, Pro verification, and admin log downloads now exist.
Recommendations, watch-provider display, media home queries, and episode progress also
have client consumers, not only hand-built test queries.

The main remaining work is notification producers, safe data retention, richer collection
browsing, some custom-media/history controls, and complete V1-style
analytics. Default collections, immutable history, a nightly calendar table, and destructive
workout replay are **not** accurate descriptions of the current V2 design.

## Recommended implementation order

### Agreed product direction

The owner confirmed these choices after the code audit:

1. **Keep V2's redesigns.** Close missing user capabilities, not every difference from a V1
   table, API, preference or job. Keep lifecycle-derived lists, explicit monitoring,
   source-preserving projections and managed assets.
2. **Prioritize daily use after correctness.** Editing, ratings, refresh, ordering and browse
   controls come before new alerts and complete analytics.
3. **Library membership is explicit intent.** Keep an item until the user explicitly removes
   it. Removing its last activity, review or collection entry must not automatically remove
   its library membership. V1 reason recomputation/automatic membership removal is therefore
   **not planned**, rather than an unresolved port gap.

The sequence below is the recommended backlog, not an effort estimate or authorization to
implement it all at once. Dependencies are hard prerequisites; row order otherwise states
product priority. Independent work can proceed without waiting for every earlier row.
An item closes only when its intended behavior has a usable client path, not just an API.
Completion status tracks this roadmap, not the inventory's parity labels: **Pending** means the
completion gate is still open, **In progress** means implementation or validation is underway,
and **Done** means the accepted behavior and validation results are recorded below.

### Phase 1 — Correctness and daily use

| Order | Completion status | Feature to implement | Depends on | Completion criteria |
| --- | --- | --- | --- | --- |
| 1 | Done | **Settle and implement history-correction behavior** | Agreed: repair automatic consequences; preserve explicit records and overrides; suppress explicitly deleted automatic occurrences; keep corrections silent and retain provider-time completion evidence | The bounded, resumable implementation replaces the unbounded ledger. Runtime acceptance, status/retry controls, and final validation pass. See the Order 1 acceptance record below. |
| 2 | Done | **Wire existing custom-media/person/group editing** | Existing entity editor/save capability | Add owner-only edit entry points and update-mode routes; reuse the shared editor, declared outgoing links and stale baselines. Derive publish year when absent and a date is supplied. Existing fields/assets survive unrelated edits. This does not require building custom episode authoring first. |
| 3 | Done | **Support rating-only Media reviews** | Existing review events and operations | Create, read, edit and delete a rating without requiring text. Keep at least one of rating/text, the 0–100 storage scale, ownership checks and retry safety. Imported rating-only records are editable without inventing review text. Alternate display scales are a separate decision. |
| 4 | Done | **Add explicit provider refresh** | Existing population/enrichment workflows | Successful provider data can be refreshed from Media detail screens with progress, failure and retry controls. Shared bounded admission, write fences, current-language translation refresh, and successful-check freshness evidence preserve saved data and user intent. See the Order 4 acceptance record below. |
| 5 | Done | **Add collection member reordering** | Existing memberships and rank reads | Server-owned moves, sparse integer ranks, transactional respacing, revision-fenced pagination, retry-safe submissions and shared pointer/keyboard controls with haptics are shipped. Real dump migrations preserve complete collection order. See the Order 5 acceptance record below. |
| 6 | Pending | **Finish everyday library and collection browsing** | Existing recipes/filter primitives | Expose useful source, lifecycle state, rated/unrated and date filters; add title, rating, release/consumption and activity sorts where applicable. Extend collection domain filters through plugin-owned selections, not kernel branches on Media/Fitness IDs. Search, count and all loaded pages must use the same filter/sort. Preserve V2's cycle-aware state semantics. |
| 7 | Done | **Complete custom relationship and episodic authoring** | 2; 1 for changes affecting recorded coverage | Add user-owned custom seasons/episodes and the missing creator/group association controls, with ordering and ownership validation. Define what happens when an edited/deleted child has history; do not silently delete history. Keep provider-owned inventories read-only to ordinary custom editors. |
| 8 | Done | **Expose Media merge and explicit removal/clear controls** | 1; agreed persistent-membership policy | Ship one confirmed destructive **Remove from library** action that clears the caller's history, reviews, annotations, monitoring, collection memberships and correction evidence, including child data. Preserve metadata and structural links. Already-running and future imports/integrations may restore data normally; add no exclusion state. Merge keeps same-schema/identity rules, destination conflict values and explicit records; missing or ambiguous child mappings reject before any writes with actionable errors. See the Order 8 acceptance record below. |

Rows 2, 3 and 4 can proceed independently once any relevant correctness contract is settled;
there is no technical dependency between rating-only reviews and collection ordering.
Phase 1 does not require completion of the later analytics or notification work.

### Phase 2 — Safe cleanup

| Order | Completion status | Feature to implement | Depends on | Completion criteria |
| --- | --- | --- | --- | --- |
| 9 | Done | **Clean up removed and abandoned managed assets** | 2 and 7 for editor integration; existing managed-reference checks | Schedule or request cleanup after committed edits/deletions, not before them. Recheck ownership and live references, including retained workflow evidence. Shared/retained assets survive; unused uploads and previously saved removed assets eventually disappear. Failure is retryable and does not turn a successful edit into data loss. See the Order 9 acceptance record below. |
| 10 | Done | **Collect genuinely unreferenced provider graphs** | 8 and the explicit-membership policy | Define graph roots and traversal before deletion. All users' library memberships and owned data, current relations, active work and retained dependencies must be considered. Collect eligible unused provider entities/children/genres and associated runtime data in bounded, retry-safe batches. Do not infer that an entity is disposable merely because it has no events, and do not port V1's association-join deletion rule literally. See the Order 10 acceptance record below. |

These are storage-maintenance tasks, not a reason to postpone usable Phase 1 features.
Asset-reference and entity-reachability rules are different; one collector must not borrow
the other's deletion criteria. Do not enable destructive collection before its safety cases
are covered. A stored backup is self-contained; a live export/restore may still retain work
that cleanup must respect.

### Phase 3 — Upcoming content and alerts

| Order | Completion status | Feature to implement | Depends on | Completion criteria |
| --- | --- | --- | --- | --- |
| 11 | Pending | **Complete the upcoming feed** | 4; existing Calendar sources | Reuse source data/recipes for monitored upcoming items across supported media, next-N/day windows, deduplication and home presentation. Keep Calendar query-based; no nightly calendar table. Define timezone, missing-date and freshness behavior before using this data for delivery. |
| 12 | Pending | **Add entity reminders** | Existing durable scheduling, subscriptions and delivery | Persist due state and expose create/edit/cancel controls. Deduplicate delivery admission per reminder occurrence across restart/retry, then record the outcome and settle reminder state. Report uncertain external delivery without automatically sending a duplicate; do not promise exactly-once delivery by third-party channels. Do not recreate a mandatory Reminders collection; preserve ordinary library membership. Resolve missed-deadline and timezone behavior before shipping. |
| 13 | Pending | **Add release-day notifications** | 4 and 11; existing monitoring/subscriptions | Notify eligible monitoring users from release dates, not provider episode-discovery signals. Deduplicate each occurrence/recipient, handle date changes and bounded catch-up, and keep display/query refresh separate from delivery. |
| 14 | Pending | **Add stale-progress and newly-available-episode alerts** | 1; defined schedule/deduplication rules, reusing 13 where useful | Add opt-in in-progress/on-hold nudges (V1 defaults: 7/14 days) from current state and latest relevant activity. Agree Pro gating and repeat frequency. Use a “more episodes available” signal instead of moving an ordinary Completed collection to Watchlist. Do not turn monitoring on implicitly when logging progress. |

Reminders are independent of the upcoming feed and can proceed in parallel with row 11.
Use current feature-owned workflows; extract shared scheduling machinery only when the
implementations show a real common need. None of these tasks requires rebuilding channel
delivery, which already exists.

### Phase 4 — Discovery, analytics and lower-priority account controls

| Order | Completion status | Feature to implement | Depends on | Completion criteria |
| --- | --- | --- | --- | --- |
| 15 | Pending | **Ship collection recommendations** | 4 and 6 | Add a reusable Media-owned recipe and paged/searchable client surface over the existing suggestion graph. Specify exclusions and empty-result behavior. Keep the current latest-completion home recommendation design unless a separate product decision changes it; do not copy V1 random sampling simply for parity. |
| 16 | Pending | **Complete the analytics experience** | 1; a metric contract and the exclusion decisions below | Inventory each missing media/fitness metric and ship in slices: consumption totals by type, workout/measurement totals, period comparisons and grouping, then hourly timelines and frequency breakdowns. Define units, unknown dates/durations, rewatches, episodic counts, timezone and exclusions before implementing queries. Reuse current recipes/projections; introduce precomputation only for demonstrated query/scale limits. A complete screen, not a generic aggregate API, closes the gap. |
| 17 | Pending | **Add account rename controls** | Existing hosted auth and admin authorization | Ship self-service rename, then admin-on-behalf rename if required. Keep server-token administration; do not reintroduce V1 roles or the onboarding-tour flag. This is independent work and may move earlier without delaying the main feature sequence. |

### Differences that need a decision, not an automatic implementation slot

Keeping V2's redesigns does not settle every individual behavior. Before adding any of the
following, choose **implement**, **accept the V2 behavior**, or **exclude**, and record the
choice beside the gap. Only an approved capability enters the numbered backlog.

| Difference | Recommended treatment / decision point |
| --- | --- |
| Automatic library-reason recomputation and default smart-collection edits | Closed as intentional redesign under the agreed policy. Do not implement; explicit removal, live state and explicit monitoring are the replacement. |
| Exact V1 recommendation sampling, enabled-lot gates and global fallback | Keep current home selection. Decide whether a separate explicit recommendation preference is needed; hiding a navigation view must not silently become a processing permission. |
| Rating scales, positional reviews, consumption-to-review links, episode retargeting, multi-source consumption, dated/manual-time progress and manga volume-only next-entry | After row 1, choose the user workflows to support, then place approved history controls after row 3 and before analytics. Do not restore every old field or override V2 next-up semantics without a requirement. |
| Learned collection string choices and standalone genre pages | Keep explicit choices and existing genre pickers/filters unless a user workflow needs more. Approved browse work fits after row 6. |
| Broader exercise merge and `exclude_from_analytics` | Decide before row 16's metric contract. Keep same-kind/ownership protections; do not change recorded units/kinds or restore destructive workout replay. An exclusion preference is not required merely because V1 stored one. |
| Same-time import ordering, association-only imports and old Generic JSON files | Keep source-order/dependency-safe V2 processing unless a concrete correctness case requires a change in row 1. Decide direct old-file conversion separately; do not reinstate the removed sink or old backup format. |
| V1 display/dashboard/per-provider-language preferences | Keep workspace/home, current language and plugin-owned settings as defaults. Add only selected missing user controls; upcoming-window/dedup controls belong to row 11, not a wholesale preference-schema port. |
| S3 prefix/custom metadata helpers, bucket probe, URL expiries and operator configuration knobs | Add only a current operational requirement. Bucket health and configurable upload limits can be scoped separately; old export internals, token settings and startup knobs do not block this roadmap. |
| Public sharing, collaborators, review visibility/comments/likes | Remain excluded. Restoring them would be a separate product/security scope, not a small follow-on notification task. |

### Per-feature completion gate

For each accepted feature, update the owning contract/declaration, service or plugin script,
read recipe, client and relevant documentation together. Cover ownership, demo restrictions,
stale writes, replay/restart and failure outcomes where applicable. Make affected checks pass
before affected tests; use focused browser/API coverage for the actual user flow. Follow the
repository's final validation requirements for code changes. Update this inventory and close
the numbered item only when those results and the accepted behavior are recorded.

### Phase 1, Order 1 — History-correction acceptance

Accepted behavior: corrections repair automatic completions without removing independent explicit
records. Editing an automatic completion makes it explicit; deleting it suppresses that occurrence
without deleting supporting activity. Later independent repeats can complete again. Corrections
remain silent, library membership and monitoring remain unchanged, and later provider changes do
not rewrite the episode inventory or positional total retained for a past completion. Automatic
records retain source-order keys so same-time creation and repair cannot change lifecycle ordering.
No compatibility path is added.

Owners: `packages/contract/src/modules/mutations/user-command.ts`, kernel event revision reads and
atomic user-command baseline checks, `plugins/media/shared/{history-correction,lifecycle-expressions}.ts`,
`plugins/media/backend/{contracts/history-correction-recipes,automations/history-correction,automations/media-history-correction.sandbox,automations/reconcile-media-history.sandbox}.ts`,
Media manifest declarations, and the existing activity editor/delete menus. Jellyfin skips
correction-created completions. User documentation: `apps/docs/src/concepts/history-correction.md`.

Validation on **2026-10-26**:

- Repository-wide `bun run check` passed after fresh migration-baseline generation.
- Focused kernel durable-work, user-command, revision-guard, event, RyotQL, backup, and boot suites:
  **176 tests passed** across ten files. Coverage includes atomic rejection, independent source/evidence
  drift, unchanged root saves, cascades, retirement, replay, retained pins, and lock-order regression.
- Contract tests: **283 passed**; backend SDK tests: **104 passed**; compiler execution tests:
  **21 passed**; focused sandbox bridge/runner tests: **47 passed**.
- Full Media run: **1,685 tests passed** across 231 files. Subsequent focused worker, continuation,
  recipe, and status/history UI tests: **27 passed**, including 3,000-source and 3,000-episode cases.
- API correction and recovery suites: **7 passed**, including concurrent parent captures, independent
  explicit records, overrides, suppression, repeats, tied timestamps, retained provider inventories,
  committed continuation recovery after a server restart, and idempotent explicit retry.
- Existing API automation, episodic-lifecycle, and activity-log suites: **34 passed** across their latest
  runs. Repeated-completion assertions now wait for derived work, not unrelated library-admission rows.
- Both shipped bundles build under unchanged limits; documentation generation passed with no generated
  configuration-reference changes. The baseline is `20261026082705_parched_stardust`.
- Main-session review and cleanup are complete. Post-baseline API/browser acceptance passed **45 of
  47 tests**, including all **6 browser tests**. Concurrent parent capture and restart recovery reached
  the 180-second test limit while repository tests also ran; server logs contain no error entries.
  The isolated correction/recovery rerun passed all **7 tests**, including both timed-out cases,
  without timeout changes. The repository test run found two stale field/trigger inventory expectations;
  both are corrected, with **46 focused tests passed**. Final repository-wide `bun run check` passed
  across **30 projects / 7,406 files**, followed by `bun turbo --filter='!@ryot-app/e2e' test`:
  **51 successful tasks**, with no failures. All selected API/browser cases passed across these runs.

The owner approved generic logical event ordering, normalized event-backed evidence, scalar scope
revisions, and durable atomic correction steps with visible pending/failed state. A per-subject
inventory fingerprint prevents mixed inventories across provider changes. The worker
uses event-backed evidence and persists progress after bounded steps. Repeated stale-write conflicts
yield to a fresh durable continuation. Status reads handle multiple historical and active work rows.
No truncation, limit increase, compatibility path, or serialization bypass is added. Final validation
is complete; this item is **Done**.

Checkpoint steps no longer mutate the library entity: its unchanged save uses the existing no-op
persistence behavior.

#### Liveness follow-up

The owner approved removing the plugin-wide and library-wide commit guards that let unrelated writes
and other subjects' corrections stale every step. Changes:

- Kernel background work serializes jobs per `(userId, pluginId, purpose, scope)`: dispatch claims the
  oldest queued job under an advisory lock only when none is running, fails a running job whose
  workflow wrapper expired, and hands the scope to its next job when a job settles. Recovery selects
  running heads and one oldest queued job per idle scope, so queued rows cannot crowd out heads. The
  per-job `recover()` call is gone from the workflow body.
- The kernel `dataBaseline` command field, the `data_revision` table and triggers, the `dataRevision`
  RyotQL table, and `DataRevisions` are removed. The migration baseline is regenerated as
  `20261026132345_broken_mattie_franklin`; its only semantic changes are the dropped table and the
  `purpose` column added to `background_work_scope_idx` (drizzle-kit also reorders the `purpose` and
  `current_job_id` column declarations).
- Media drops the library event-scope baseline and replaces the revision checks with a per-subject
  inventory fingerprint (`correctionInventoryFingerprintRecipe`) stored as `inventory` on the
  checkpoint. Audit, prune, and sweep process up to 25 records per step.
- Conflict requeues are capped at ten consecutive no-progress continuations (`conflictBase` and
  `conflictAttempt`); a committed step resets the count, and a capped job fails.

Validation on **2026-10-26** (before repository-wide checks):

- Kernel backend: **2,775 tests passed** across 327 files, including eight new scope-serialization,
  handoff, expiry, recovery-crowding, and concurrent-claim cases. Contract: **283**; backend SDK:
  **104**; RyotQL: **37**; full Media: **1,700 tests passed** across 232 files, including conflict-cap
  chains, fingerprint reset cases, and 25-record audit, prune, and sweep pages with revision prediction.
- New API suite `history-correction-liveness.test.ts`: **5 passed** (60-subject fan-out with a second
  wave mid-run, overlapping chains with a concurrent Retry, a multi-page snapshot under unrelated
  provider writes, batched audit revision prediction, and fingerprint changes after real episode,
  season, show, link-add, and link-remove writes). Existing history-correction (**6**), recovery
  (**1**), episodic-lifecycle (**6**), automations (**15**), and activity-log (**13**) suites still pass.
- After cleanup and DRY consolidation (shared scope-key helpers, correction request builders, and a
  shared e2e correction fixture): repository-wide `bun run check` and
  `bun turbo --filter='!@ryot-app/e2e' test` (**51 of 51 tasks**) passed, and the six suites above passed
  again. An independent outcome review confirmed the change.
- Not covered by an API test: cap failure followed by Retry. The status recipe is unchanged, and its
  failed/Retry path is covered by recipe, operation, client, and recovery tests.

### Phase 1, Order 2 — Custom entity editing acceptance

Accepted behavior: owned custom media, people, companies, and groups expose **Edit** and use the
shared editor's update mode. Provider-owned entities remain read-only. Saves retain declared
fields, nested values, assets, incoming links, and untouched outgoing links. Updates compare the
loaded entity and outgoing relationship baselines, including empty groups, so stale edits cannot
silently replace newer links. Identical retries retain their command identity and replay receipts.

API-source custom-media creates and updates derive a missing publish year from a valid full
publish date. Explicit years remain unchanged when dates change; year-only metadata is allowed.
Duplicate actions are deferred. Custom season/episode authoring and new incoming association
controls remain in row 7; removed-asset collection remains in row 9. No compatibility path is added.

Owners: `packages/contract/src/modules/entities/editor.ts`,
`kernel/backend/src/modules/entities/editor/service.ts`, the shared SDK entity editor,
`plugins/media/shared/{media-entity-editors,media-recipes}.ts`,
`plugins/media/client/entity-editor`, and
`plugins/media/backend/automations/custom-publish-year-policy.sandbox.ts`.
User documentation: `apps/docs/src/guides/custom-media.md`.

Validation on **2026-10-26**, after affected checks passed:

- Contract tests: **283 passed**; shared SDK editor tests: **14 passed**; backend editor tests:
  **20 passed**, including stale link additions/changes/deletions, concurrent drift, retries,
  ownership, atomic saves, immutable fields, and preserved incoming/unlisted links.
- Isolated Media client/recipe/manifest/policy tests: **578 passed** across 65 files.
- `e2e/src/api/plugins/media/custom-entity-editor.test.ts`: **2 passed**, covering year derivation,
  explicit-year preservation, stale snapshots/links, foreign ownership, and replayed updates.
- `e2e/src/browser/media-custom-entity.test.ts`: **6 passed**, covering create/edit entry points,
  retained/removed genres, nested show fields, managed images, and person/company/group editing.
- Repository `bun run check`: passed in an isolated worktree based on `1e2fff0fbc` plus this item's
  changes. Media/Fitness bundles built successfully; docs configuration generation passed with no
  generated reference changes. Review and the scoped cleanup pass found no remaining blockers.

Isolation excluded concurrent history work without changing it. Repository-wide test suites were
omitted at the owner's request; only the affected e2e files ran. The accepted edit-only scope is **Done**.

### Phase 1, Order 3 — Rating-only review acceptance

Accepted behavior: one private `review` event can contain a finite 0–100 rating, trimmed
nonblank text, or both. Zero and decimal ratings are valid. Missing content is omitted from
stored properties. Removing text also removes its spoiler flag; removing both fields is
rejected, with deletion kept separate. The **Rate or review** composer puts the rating first
and shows spoiler controls only with text. Existing imported positional fields survive edits.
Ownership, demo protection, stale-update snapshots, replay safety, and persistent library
membership remain unchanged. Alternate rating scales remain outside this item.

Owners: `plugins/media/shared/media-review-operations.ts`, the Media review create/update/delete
operations, `shared/media-recipes.ts` review selections, and `client/media/{review,activity-rows,activity-row-menu}.tsx`.
No kernel schema change or compatibility path is needed.

Validation on **2026-10-26**, in an isolated worktree based on `4d334567d9` plus these changes:

- Media and e2e package `bun run check`: passed.
- Repository `bun run check`: passed in the isolated worktree.
- Focused Media operation/composer/row-menu/entry-point tests: **114 passed** across seven files.
- `e2e/src/api/plugins/media/reviews.test.ts`: **3 passed**, covering concurrent creation and
  replayed edits/deletes, stale edits, imported records, content transitions, invalid content,
  ownership, and retained library history.
- `e2e/src/browser/{media-reviews,media-movie}.test.ts`: **7 passed**, including rating-only
  create/read/edit/delete, empty-edit rejection, and existing Movie logging entry points.

### Phase 1, Order 4 — Explicit provider refresh acceptance

Accepted behavior: Media detail screens offer **Refresh provider data** for eligible provider roots,
including media, people, companies and groups. Full population refreshes the root, its children and
declared related groups, not the recursive graph. Saved data stays readable during work and after
failure. User history, annotations, collection/library membership, ownership and monitoring choices
remain unchanged; existing provider-change detectors and notifications still run.

`POST /entities/:entityId/enrichment` takes `operation`, `action` and an immutable `idempotencyKey`,
and returns `enrichmentRequestId`. The SDK and bridge use `requestEnrichment`; the old failure-only
endpoint and capability are removed. Transport retries retain the submission identity, completed
submissions replay, and queued/running/retrying states remain visible through watches and polling.

All population callers share admission. Compatible work coalesces across users; incompatible work
queues. Limits are eight running owners, 1,000 active requester rows globally and 50 per user.
Successful manual refreshes have a one-minute cooldown. Request/attempt fences reject late writes;
bounded deterministic execution IDs keep paged retries within existing workflow-store limits.

Manual refresh also refreshes the caller's current-language translation when canonical content is
unchanged, not every language. Canonical-generation and same-generation supersession guards reject
stale overlays. Translation admission failure is visible and retryable without invalidating canonical
success. `providerCheckedAt` retains the last successful details check, including unchanged responses;
related completion is separate. Unmonitored successful data refreshes only on request; monitoring
remains automatic. Future release delivery must refresh or defer stale candidates under a declared
freshness window and require completed inventory where needed. No daily partial reset or alerts are added.

Owners: kernel entity enrichment, provider population and localization; contract entity schemas;
client bridge/SDK; Media detail controls and summary recipes. Generated migration:
`kernel/backend/src/drizzle/20261027014201_open_johnny_storm/`. No user guide was added, as requested.

Validation on **2026-10-27**:

- Affected package checks passed before tests. Post-cleanup focused kernel suites: **271 tests**
  across 35 files; full client SDK suite: **254 tests** across 24 files. Full Media suite:
  **1,703 tests** across 232 files.
- Selected API/browser suites: **19 tests passed** across provider refresh, paged related retry,
  population failure, translation and Movie detail files. Both shipped plugins and the client built.
- The full test run found one stale approved-field expectation for `providerCheckedAt`; it was fixed,
  and all **39 validator tests** passed. No test timeout or workflow-storage limit was raised.
- Final repository `bun run check`: passed across **30 projects / 7,429 files**. Then
  `bun turbo --filter='!@ryot-app/e2e' test`: **51 successful tasks**, no failures.
- Main-session review and scoped cleanup are complete. Duplicate SDK types and an unused request
  patch field were removed; no compatibility path or type-checker bypass was added. This item is **Done**.

### Phase 1, Order 5 — Collection ordering acceptance

Accepted behavior: collection detail offers **Reorder members** with immediate saves, shared
pointer/keyboard handles and bridged haptics. Reorder mode is unfiltered. Start/end actions span
unloaded pages; moves at a loaded boundary use actual server-side neighbors. Returning to normal
browsing loads a fresh member query. New members still prepend, member-field edits preserve order,
and rank changes do not manufacture collection add/remove events or domain hooks.

The canonical move command carries an expected collection revision and immutable submission
identity/time. Ownership, move/rebalance and replay receipt commit atomically. Completed requests
replay before newer-revision checks; changed input with the same identity conflicts. Transport and
malformed-response retries retain the original submission. Stale moves and continuation pages offer
reload rather than silently mixing orders.

Dump research rejected consecutive-position range shifting: collections reach **28,179** members.
The shared relationship writer uses sparse safe-integer ranks with an initial `2^32` spacing,
indexed rank/member-ID reads, and collection-scoped locking. Gap exhaustion first respaces up to
128 neighbors on each side; a fully dense window uses one set-based collection-wide respace without
loading that collection into application memory. Inserts, updates, removals, merges and cascading
deletions share the invariant. V1 conversion assigns spaced integers in legacy order; no decimal
fallback, compatibility path, protocol-version change or background compaction job is added.

Owners: collection contract/routes and `CollectionOrderingService`, relationship rank persistence,
entity deletion locks and collection-revision trigger, RyotQL catalog/collection recipes, client
bridge/SDK and collection renderer. Haptic requests are owner-neutral through the existing device
capability; other device actions retain plugin ownership checks. User documentation:
`apps/docs/src/concepts/collections.md`. Migration:
`kernel/backend/src/drizzle/20261027150457_warm_zaran/`.

Validation on **2026-10-27**:

- Affected package checks passed before tests. Collection backend suites: **48 passed**, including
  repeated tight-gap moves, local/full respacing, concurrent adds/moves, replay, stale input,
  ownership, metadata preservation and deletion revisions. Renderer suites: **50 passed**;
  collection recipes: **20 passed**. Broader entity/editor/user-data/relationship suites:
  **142 passed** across five files.
- API/browser acceptance: **23 passed** across collection ordering, existing collection commands
  and collection detail, then **23 passed again** after review and cleanup. The final browser case
  checks normal browse order after leaving reorder mode.
- Full migration-only validation and restart passed for `tmp/file.sql` and `tmp/file2.sql` in
  isolated local PostgreSQL, Redis and S3 resources. All **28,464** and **100,289** memberships retain
  complete per-collection ordered-ID hashes and counts; ranks are valid/unique and revisions match
  membership counts after restart. Automation history, enrichment requests and translations remain
  empty; content generations and environment configuration revisions pass their checks. The larger
  dump reports **103 unresolved asset locators** with the available asset cache; locators are retained.
  Other reports are documented legacy-data anomalies, not ordering errors. This is not a claim that
  every migration mapping or external provider was re-audited.
- Both shipped plugins, kernel renderers and the client built. Main-session review and cleanup are
  complete; redundant bridge dispatch, query state and fixture layers were removed. Disposable
  validation resources were removed without changing the working database, Redis DB 0, local `ryot`
  bucket, original dumps or cached source assets. Repository-wide `bun run check` passed:
  **38 successful tasks**, **30 projects / 7,482 files**. The docs production build passed.
  The first full test run found three stale field/trigger inventory expectations; those are updated,
  with all **47 focused tests passed**. Final repository `bun run check` passed again, followed by
  `bun turbo --filter='!@ryot-app/e2e' test`: **51 successful tasks**, no failures. No timeout or
  capacity limit was raised. This item is **Done**.

### Phase 1 Order 8 acceptance — Media removal and merge

Media detail screens expose **Your data** with confirmed **Remove from library** and
**Merge my data into…** actions. Removal and clear are one destructive operation. Metadata,
provider inventories and custom structural links remain. There are no tombstones or integration
exclusions; ordinary writers may restore data after removal.

The generic `EntityUserDataService` owns HTTP and sandbox commands. Media declares relationship,
child and correction-evidence scopes through its manifest. Scope checks include detached historical
children. Merge preserves explicit events without heuristic deduplication, combines memberships,
keeps destination conflict values, transfers source-only fields, rewrites typed evidence references,
and resets temporary correction checkpoints and coverage. Missing or ambiguous child matches reject
before writes with actionable errors. Submission identities and timestamps remain immutable on retry.

Validation on **2026-10-27**:

- Focused kernel suites: **124 tests** across seven files; backup reference suites: **8 tests**.
  Focused Media suites: **31 tests**; shared client-page/navigation suites: **48 tests**.
  The sandbox TypeScript suites passed **226 tests**, including typed user-data failure preservation.
- Affected API suites passed **22 tests** across Media user data, generic entity user data, demo access
  and Fitness exercise merge. Browser acceptance passed **3 tests** for cancel/confirm removal,
  same-schema merge/navigation, and a visible episodic mapping refusal without partial writes.
  The final Media API/browser run used one worker; no timeout or capacity limit was raised.
- Final repository `bun run check`: **38 successful tasks**, **30 projects / 7,474 files**.
  Then `bun turbo --filter='!@ryot-app/e2e' test --concurrency=1`: **51 successful tasks**, no failures.
- DRY and cleanup passes share commit/replay, host command setup, HTTP fixture submissions and
  client-page picker/collection wiring. Redundant schema tests, a single-use wrapper and temporary
  diagnostics were removed. No compatibility path, migration, version change or type-checker bypass
  was added. This item is **Done**.

### Phase 2 Order 9 acceptance — Managed asset collection

Clients no longer delete permanent uploads. The `uploads/cleanup` endpoint, the bridge `cleanup`
upload action, the SDK `uploads.cleanup` method and the editor, schema-form and workout-draft upload
tracking that fed them are removed. `managed_asset.check_after` defaults to 24 hours after
registration. The frequent `managed-asset-collection` cron takes due rows in bounded batches and
locks each owner's due rows with `SKIP LOCKED`. A row that a writer has share-locked is skipped
until the next run. One set-based query per batch finds referenced locators across the existing
reference sources. Referenced rows are deferred 24 hours. Unreferenced rows are retired; the object is
then deleted and the row removed, so a content-addressed key can be registered again. A failed
object deletion leaves the retired row for the next run, and a save racing a retirement is rejected
by the existing reference lock. Removed or replaced saved assets, cancelled uploads and abandoned
uploads disappear within about 48 hours. An editor or workout draft left unsaved for more than
24 hours after an upload must upload the file again.

Validation on **2026-10-28**:

- Focused kernel suites: **258 tests** across 22 asset, backup, script-host and domain-write files,
  including collector deletion, deferral, retry, skipped in-flight writers and batched reference
  lookup. Affected package suites passed: contract **283**, plugin-client-contract **52**,
  plugin-client-sdk **256**, kernel client **1,186**, Fitness **565**, fixture **18**.
- Affected e2e files `api/kernel/uploads/uploads.test.ts` and `browser/client-plugin.test.ts`:
  **15 tests** passed.
- Final repository `bun run check`: **38 successful tasks**, **30 projects / 7,491 files**. Then
  `bun turbo --filter='!@ryot-app/e2e' test`: **51 successful tasks**. A first run that overlapped
  the e2e browser run had four Fitness DOM `waitFor` misses; the rerun passed without changes.
- One additive migration adds `check_after` and two partial indexes. No compatibility path, version
  change or type-checker bypass was added. This item is **Done**.

### Phase 2 Order 10 acceptance — Provider graph and accumulated data collection

Provider entities carry `check_after`, which defaults to seven days after insertion and is pushed
forward by provider refreshes and active watches. Plugin relationship schemas may declare
`retention: "composition"` (members live and die as one unit) or `"root"` (the relationship keeps
its endpoints). Media declares show/season/episode and podcast/episode as compositions and trending
as a root. The frequent `entity-graph-collection` cron takes due provider entities, expands them to
composition units and locks members with `SKIP LOCKED`. A unit is live when any member is user-owned,
not yet due, used by an event, linked by a user or root relationship, pending enrichment or import,
named by a typed entity reference in user-owned properties, or mentioned by pending background work,
pending automation triggers or saved views. Dead units one global reference away from a live unit
are deferred seven days. Everything else is deleted with its dependent rows, and surviving neighbors
have `related_populated_at` cleared so they repopulate. A pending or running backup pauses collection.

Accepted submissions must be within seven days of server time. Older or future-dated submissions fail
with `SubmissionExpired` (410). Mutation receipts are pruned after 14 days once no unexpired workflow
execution or pending batch candidate can replay them. Settled background work older than seven days
is pruned, except the latest row per scope and jobs that an event stream still references.

Validation on **2026-10-28**:

- New kernel suites cover graph collection, background-work pruning, receipt pruning and the submission
  window. The collector tests cover orphan and translation deletion, user, event and root deferral,
  whole-unit composition decisions, one-hop references with neighbor refresh, typed references, the
  backup fence, and skipping writer-locked rows. Fixed-timestamp tests now submit at the current time.
- Affected e2e files passed: `api/kernel/entity-user-data/entity-user-data.test.ts`, including the new
  expired-submission case, plus `api/plugins/fitness/workout-actions.test.ts`,
  `api/plugins/fitness/measurements.test.ts`, `api/plugins/media/activity-log.test.ts`,
  `api/kernel/collections/ordering.test.ts` and `api/plugins/media/custom-entity-editor.test.ts`.
  The first measurements run hit a 12-second database stall during server startup. Workflows stopped
  after cluster shard-lock storage timed out, before any new cron task had run, and the unchanged
  rerun passed.
- Final repository `bun run check`: **38 successful tasks**, **30 projects / 7,504 files**. Then
  `bun turbo --filter='!@ryot-app/e2e' test`: **51 successful tasks**.
- One additive migration adds relationship `retention`, `entity.check_after`, and indexes for due
  entities, receipt age, workflow execution lookup and stream-current jobs. No compatibility path,
  version change or type-checker bypass was added. This item is **Done**.

## Functional inventory

Paths abbreviated as `modules/...` in the tables below are under
`kernel/backend/src/modules/...`.

### Accounts, administration, and infrastructure

| V1 behavior | Status | Current V2 home and limits |
| --- | --- | --- |
| Register, login/logout, OIDC, long-lived auth tokens | Reshaped | `modules/accounts/auth/service.ts`: Better Auth hosted login, external OIDC, OAuth 2.1/PKCE for web/native, API keys. Application APIs accept OAuth bearer tokens or `X-Api-Key`, not hosted-login cookies. Username login becomes email login. |
| TOTP setup, verification, disable, recovery codes | Covered | Better Auth two-factor plugin, hosted `/oauth/two-factor`, kernel Account settings. Availability depends on a credential account. |
| Password-change sessions and admin provisioning/reset | Reshaped | Instance Admin provisions credential/OIDC accounts and obtains Better Auth reset links; links expire after 30 minutes. No V1 password-change-session wire contract. |
| User details, preferences, account name | Partial | Self `user` reads use RyotQL; kernel preferences are `language` and `disableIntegrations`; domain preferences belong to installations. Better Auth exposes `/update-user`, but the shipped Account screen has no rename form. See [account and preference differences](#account-and-preference-differences). |
| User listing, disable/delete/reset | Covered | `modules/instance-admin` commands plus admin RyotQL `user` and `userLifecycleOperation` reads; client `kernel/client/src/routes/instance-admin`. Reset/delete are durable operations. Normal user reads see only self; the old claim that any authenticated caller receives the full user list is wrong. |
| Admin impersonation | Reshaped | Instance Admin one-use 60-second handoff, PKCE, one-hour impersonation session, client banner and explicit exit. This replaces the admin use of access links; it is not missing with public sharing. |
| Demo account | Reshaped | `USERS_DEMO_ACCOUNT_ID`, `/demo`, credential-scoped restrictions. Owner credentials remain unrestricted; shared demo changes persist, with no periodic reset. |
| Admin application-log download | Covered | `modules/instance-admin/logs.ts`, contract `modules/instance-admin/logs.ts`: paged active/rotated files, individual downloads and ZIP-all. Signed tickets expire after five minutes and are reusable until expiry, unlike V1's consumed single-use token. |
| Core details and capabilities | Reshaped | `/system/config` reports version, frontend origin, auth, SMTP availability, Pro state, analytics, and storage provider. Provider/schema/source catalogs supply domain capabilities through RyotQL. Not just an auth-config payload. |
| Health and observability | Reshaped | `/system/health` checks PostgreSQL and Redis; structured rotating logs and optional OTLP replace the Rust process facilities. There is no S3 bucket probe in this health response. |
| Server Pro key | Covered | `kernel/backend/src/platform/pro-key.ts`: Unkey verification, expiry validation, one-hour cache. Trusted host checks gate integrations and Fitness operations. This is not an unresolved question about whether V2 has paid features. |
| File upload/download/delete | Reshaped | `modules/assets`: upload intents/completion, owned managed assets, download resolution, safe unreferenced cleanup, local permanent-storage fallback and S3. Temporary imports use local working storage. See [asset lifecycle](#asset-lifecycle). |
| User data export and listing | Reshaped | `modules/backups`: durable export, RyotQL `backupRun` listing, short-lived download URL and deletion; kernel Backup settings. It replaces V1's S3 JSON export/list-by-prefix mechanism. |
| Restore | Covered; additional V2 behavior | Atomic clean-account restore of validated backup archives, dependencies, private compiled plugins and assets. Secrets are redacted where required. Backup is not a credentials/session dump and is not the V1 Generic JSON format. |
| Manual cache expiration / arbitrary background-job dispatch | Reshaped | Owning workflows, mutation invalidation, entity watches, automatic reconciliation, automation retry UI, and scheduler replace the global V1 controls. Explicit entity enrichment refreshes successful provider data. No general user `expireCacheKey` or `deployBackgroundJob` equivalent. |

Primary evidence: `packages/contract/src/modules/{account,instance-admin,system,assets,backups}`;
`kernel/backend/src/modules/{accounts/auth,backups}/README.md`;
`kernel/backend/src/platform/{config/definition,pro-key,storage/download-tickets}.ts`.

### Media, library, and discovery

| V1 behavior | Status | Current V2 home and limits |
| --- | --- | --- |
| Eleven media lots | Covered | Media schemas for book, comic-book, anime, movie, show, manga, audiobook, podcast, video-game, music and visual-novel; type-owned detail screens and presentations. |
| Provider search, details, person/company/group lookup | Reshaped | Provider operations, `/entity-providers/search`, queued `/entity-providers/imports`, entity watches, and RyotQL. Search and library import are distinct. Providers are plugin-owned, not kernel scripts. |
| Browser-extension metadata lookup | Covered | Media `metadata-lookup`, integration-authenticated and restricted to the browser-extension integration; TMDB movies before shows. Extension uses `apps/browser-extension/src/lib/contract-client.ts`. |
| User media/people/group lists | Partial | Built-in saved views, generic entity browser, text search, collection and genre filters, type-specific presentations. The default sort is activity for titles, credit count for creators, parts for groups. Not every V1 filter/sort is exposed. |
| Media-library admission | Reshaped | Required Media entity/import/event/collection hooks add `in-media-library`; new memberships record `add-to-media-library`. Library membership is persistent intent, not a materialized set of V1 reasons. No reason recomputation/removal sweep. |
| Seen/progress/status history | Reshaped | `backlog`, `progress`, `complete`, `dropped`, `on_hold`, plus integration `list-state` snapshots; plugin `media-activity-log`, history UI, and RyotQL lifecycle recipes. Events can be edited and deleted. |
| Completion, rewatch, episodic progress | Reshaped | Required full-progress and episodic-parent hooks, per-cycle coverage, session assignment, season/episode queries and next-up. Shows/podcasts distinguish `caught_up` from terminal `complete`; specials do not block completion. Anime/manga progress is cumulative position, not per-chapter/episode history expansion. |
| Correct/delete existing history or reviews | Covered | Kernel `PATCH`/`DELETE /events/:eventId`; Media activity/review update/delete operations and row menus. Snapshot preconditions detect stale edits. Media-owned completion evidence and atomic reconciliation repair derived records, preserve explicit overrides and deletion suppressions, and keep corrections silent. |
| Ratings and review text/spoilers | Partial | Schema-owned private `review` events support rating-only, text-only, or combined content through the Media composer and create/update/delete operations. Ratings remain 0–100, including zero and decimals. Imported rating-only records are editable without placeholder text. Alternate display scales and some review-position controls remain separate decisions. |
| Collections and membership metadata | Partial | Kernel collections CRUD, strict member-field schemas, add/remove/upsert membership, paged browser/detail renderer, search/type/property/cross-collection filters, and server-owned reordering with revision-fenced pagination and shared haptics. Richer domain browsing remains in Order 6. Details below. |
| Owned and Monitoring default collections | Reshaped | Owned/ownedOn annotations on `in-media-library`; `media-monitoring` relationships and explicit status/enable/disable operations. Both have client controls. They are not protected kernel collections. |
| Watchlist, In-Progress, Completed smart collections | Reshaped / partial | Lifecycle-derived home lists replace the state-list role. V2 does not maintain ordinary named collections or automatically enable monitoring when logging progress. New aired episodes affect live coverage without a collection-moving job. |
| Custom metadata/person/group | Covered | Manifest editors, shared SDK editor, `POST /entities/editor`, and owner-only create/edit routes cover media, people, companies, groups, show seasons/episodes and podcast episodes. Atomic saves compare loaded entity/relationship baselines and preserve unrelated fields/assets. API custom-media saves derive missing publish years from full valid dates; explicit years remain unchanged. Children are deleted only without history. Duplicate actions are deferred. |
| Genres | Covered; reshaped | `genre` entities, local `genre.media-catalog` identities and typed `<schema>-to-genre` links; provider population, migration, any/all/none filters, pickers and private custom genres. No standalone V1 genre-list/detail page is shipped. |
| Creator and group associations | Covered | Typed ordered relationships, creator credit rails and paged credit modals, group member screens; character names retained on person credits. Custom media and credit-bearing groups edit incoming credits; groups edit their members. |
| Recommendations | Partial | `media-suggestion` graph, detail rails, `latestCompletionSuggestionsRecipe` and Media home. Collection-specific recommendations have no shipped recipe/UI. V1 randomized multi-source selection, fallback, enabled-lot filtering and candidate sampling are not reproduced. |
| Trending | Covered; reshaped | Media infrequent cron populates `media-trending`, TMDB movie/show scripts and `trendingLatestMediaRecipe`; consumed by Media home. Not a missing dedicated endpoint or saved view. |
| Watch providers | Covered | TMDB movie/show properties and detail UI filtered by viewer region, offer kinds and JustWatch attribution. Data includes stream/free/ads/rent/buy. V1's user-defined consumption-source lists are now Media per-type settings, not dropped. |
| Translated titles/descriptions/images | Reshaped | `modules/entities/localization`, durable enrichment requests and generation-bound overlays; user-language RyotQL resolution, watches and retry controls. TMDB/TVDB show children and iTunes podcast episodes have translation bindings; the old blanket episode-translation gap is wrong. Per-provider language preferences are not preserved as such. |
| Provider-change monitoring | Covered; reshaped | Media monitoring sweep refreshes eligible global provider entities; entity/relationship detectors emit persisted signals, catalog subscriptions and notification formatters. Includes monitored people/company associations. No global V1 periodic partial-state reset. |
| Calendar and upcoming | Partial / reshaped | Kernel Calendar with month/agenda and source visibility; Media show/podcast episodes, anime airings and flat releases; Fitness workouts. Dates come directly from entities/JSON via recipes, so nightly `calendar_event` materialization is unnecessary. Home airing panels cover shows/anime, not V1's full monitored next-N feed. |
| Analytics | Partial | Media activity heatmap/counts/minutes/reviews, per-entity consumption summaries; Fitness summaries/history/measurements. No unified V1 analytics screen or full metric set. |
| Merge/disassociate user data | Covered; reshaped | Media detail **Your data** controls confirm removal or same-schema merge through `media-user-data` and the canonical `/entity-user-data/merge` and `/entity-user-data/clear/:entityId` owner. Scope includes child history, reviews, annotations, monitoring, collections and correction evidence; metadata and structural links remain. Merge preserves explicit records and destination conflict values; missing or ambiguous child mappings reject atomically. Imports and integrations may restore removed data normally. |
| Recently-consumed flag | Partial / reshaped | V1 `userEntityRecentlyConsumed` reads a time-limited debounce cache marker, not a recently-consumed list. Integration admission now has persistent debounce/duplicate checks, but there is no corresponding public flag or V1 dashboard badge. |

Primary evidence: `plugins/media/{README.md,manifest/plugin.ts,manifest/saved-views.ts}`;
`plugins/media/shared/{lifecycle-expressions,episodic-recipes,lifecycle-list-recipes,discovery-recipes,activity-recipes,airing-recipes,media-entity-editors}.ts`;
`kernel/backend/src/modules/entities/{user-data/service,providers/enrichment}.ts`;
`packages/ryotql-recipes/src/{collections,calendar}.ts`;
`packages/kernel-renderers/{README.md,src/collection-detail.tsx,src/calendar.tsx}`.

### Fitness

| V1 behavior | Status | Current V2 home and limits |
| --- | --- | --- |
| Exercise dataset, details, search/filter, custom exercise | Covered; reshaped | Free Exercise DB provider and Fitness Catalog target/equipment providers, library picker, detail/history UI and shared entity editor. Dataset population is on demand, not a startup import of every exercise. |
| Exercise taxonomy, instructions, assets | Covered | Typed targets/equipment relationships, target roles, instructions and managed attachments. Standard and private taxonomy pickers support import and creation. |
| Exercise settings | Partial / reshaped | Installation unit/rest/sound/timer settings and per-exercise membership overrides. Stored units are kg/km/seconds; changing display units does not rebuild history. V1 `exclude_from_analytics` has no equivalent. |
| Exercise merge | Partial / reshaped | `exercise-merge` moves user data and collection links, replaces template references and triggers record repairs. Requires a custom source and same kind; V1 allowed same-lot provider-source merges too. Multi-step merge is retry-to-complete, not atomic. |
| Workouts: create/edit/delete, attributes, repeat | Covered; reshaped | `workout-editor-save`, `workout-delete`, `workout-time-correction`, shared live/historical editor and repeat flows. Atomic source save, stale baselines, durable retry identities, notes/media, confirmed sets, rest timers, supersets and device drafts. |
| Workout duration and unit handling | Reshaped | Active duration excludes explicit pauses and remains distinct from elapsed timestamps. Time correction preserves recorded duration unless explicitly changed; unlike V1, editing times does not silently replace it with elapsed duration. |
| Templates: list/detail/create/edit/delete/use | Covered | Template saved view/detail, shared editor and explicit delete; templates store plans without workout execution events. Writes/replacement and protected notes/media have current Pro rules. |
| Personal bests, derived set stats, history repair | Covered; reshaped | `script.workout-record-step`, event-stream projections, changed-set/context hooks, durable reconciliation and freshness checks. Rebuilds derived stats by exercise and recorded kind, without deleting/recreating workouts or replaying historical notifications. |
| Exercise reviews/notes | Covered; reshaped | Private exercise `review` events, note create/update/delete and detail UI. No public reviews, comments or likes. |
| Measurement logging/list/edit/delete/charts | Covered; reshaped | Metric entities, entry entities and session-linked reading events; dynamic metrics, pinning, composer, trends and paged history. Names on V1 measurement entries are not retained; time and comments are. Multi-call reading edits may partially commit. |
| Fitness analytics | Partial | Workouts period comparisons, consistency/streaks, volume/counts, personal bests, muscle activity and measurement series. Not the complete V1 cross-domain daily/hourly analytics payload. |
| Strong, Hevy, OpenScale imports | Covered | Fitness-owned sources and bounded import workflows; chronological processing and unit normalization. Strong provides active duration, Hevy leaves it unknown; OpenScale reuses normalized metrics. |
| Native workout experience | Additional V2 behavior | Shared Capacitor client, native rest alerts/haptics/screen-awake control, device-local recovery, iOS Live Activities. This is not server reminder delivery. |

Primary evidence: `plugins/fitness/{README.md,manifest/plugin.ts,manifest/schemas}`;
`plugins/fitness/backend/{operations,automations,workout-record-step.sandbox.ts}`;
`plugins/fitness/shared/{workout-records,workout-list-recipes,measurement-recipes}.ts`;
`kernel/backend/src/modules/events/README.md`; `kernel/client/README.md`.

### V2-only platform facilities

These facilities explain where V1 behavior now lives; they are not additional V1 port gaps.

| Facility | Current owner |
| --- | --- |
| System/private plugin archives, immutable revisions, install/uninstall, readiness, quarantine, encrypted configuration and installation preferences | `modules/plugins`, `modules/definitions`; kernel plugin settings UI |
| Backend/client authoring builds, deterministic archives and plugin-facing APIs | `packages/plugin-backend-compiler`, `packages/plugin-client-compiler`, `packages/plugin-archive`, `packages/cli`, plugin SDKs and `packages/plugin-kit` |
| Isolated backend script execution, bounded host capabilities, egress/rate limits and durable replay | `kernel/sandbox`, `modules/scripts`, `kernel/backend/src/platform/egress`; the sandbox still includes a native Rust daemon |
| Persisted lifecycle policies, hooks, signals, subscriptions, run history and retry | `modules/automations`, plugin hook declarations and kernel Automation History settings |
| User-scoped generic reads, custom/built-in saved views, renderer composition and workspace homes | `modules/ryotql`, `modules/saved-views`, `modules/pages`, shared recipes and kernel renderers; saved-view APIs do not imply a complete visual query-authoring UI |
| Atomic user commands, replay receipts, source-preserving projections and live enrichment hints | `modules/user-commands`, `modules/mutations`, `modules/events`, `modules/entities` |
| Sandboxed client pages and semantic native capabilities | `kernel/client`, `packages/plugin-client-contract`, client/UI SDKs; plugin frames receive no bearer credentials or native authority |

## External-source inventory

### Metadata providers

All **18 V1 vendor families** still have V2 Media implementations. This is vendor and
schema coverage, not a promise of identical fields, ranking, pagination or live availability.
V2 splits a vendor into root-schema providers and operation scripts.

| Vendor | V2 root schemas declared in `plugins/media/manifest/plugin.ts` |
| --- | --- |
| AniList | anime, manga, person, company |
| Audible | audiobook, audiobook-group, person |
| Giant Bomb | video-game, video-game-group, person, company |
| Google Books | book |
| Hardcover | book, book-group, person, company |
| IGDB | video-game, video-game-group, company |
| iTunes | podcast |
| Listen Notes | podcast |
| MangaUpdates | manga, person |
| Metron | comic-book, comic-book-group, person |
| MusicBrainz | music, music-group, person |
| MyAnimeList | anime, manga |
| Open Library | book, person |
| Spotify | music, music-group, person |
| TMDB | movie, show, movie-group, person, company |
| TVDB | movie, show, movie-group, person, company |
| VNDB | visual-novel, person |
| YouTube Music | music, music-group, person |

Additional local providers are Media Catalog genres and Fitness Catalog targets/equipment;
Free Exercise DB replaces V1's GitHub exercise-library job. Child show seasons/episodes and
podcast episodes are populated through parents. Search, details, resolve, translate, related
and trending are separate bindings: not every provider implements every operation.

Evidence: V1 `crates/providers/*`; V2 `plugins/media/backend/providers/*` and
`plugins/fitness/{manifest/plugin.ts,backend/providers}`. Required credentials now belong to
plugin config (`plugins/media/manifest/config.ts`), with readiness checks before execution.

### Import sources

V1's `ImportSource` enum has **20** entries, not approximately 19. V2 declares **17 Media
sources**, **3 Fitness sources**, plus kernel **Data JSON**. Spotify history is new; V1
Generic JSON is replaced, not accepted as an unchanged input format.

| V1 source | V2 source / input | Inventory result |
| --- | --- | --- |
| IGDB | Media `igdb`, CSV + collection | Present |
| IMDb | Media `imdb`, watchlist/ratings CSV | Present; dates/ratings/backlog rules implemented |
| Plex | Media `plex`, server API | Present |
| Hevy | Fitness `hevy`, CSV + timezone | Present |
| Trakt | Media `trakt`, user/list API or export ZIP | Present; export mode needs no Trakt API credential |
| Movary | Media `movary`, history/ratings/watchlist CSVs | Present |
| AniList | Media `anilist`, JSON + timezone | Present; cumulative anime/manga progress |
| Grouvee | Media `grouvee`, CSV | Present |
| Netflix | Media `netflix`, export ZIP + optional profile | Present |
| Watcharr | Media `watcharr`, JSON | Present |
| Jellyfin | Media `jellyfin`, server credentials | Present |
| OpenScale | Fitness `open_scale`, CSV + timezone | Present |
| Strong App | Fitness `strong_app`, CSV + timezone | Present |
| Goodreads | Media `goodreads`, CSV | Present |
| Hardcover | Media `hardcover`, CSV | Present |
| StoryGraph | Media `storygraph`, CSV | Present |
| MyAnimeList | Media `myanimelist`, anime/manga XML or gzip | Present |
| Generic JSON | Kernel `data-json`, owner-qualified generic document | Replacement; no direct V1 `CompleteExport` parser |
| MediaTracker | Media `media_tracker`, server API | Present; unsupported identifiers produce issues |
| Audiobookshelf | Media `audiobookshelf`, server API | Present; finished history and collections |
| No V1 enum entry | Media `spotify`, extended-history ZIP | Added |

The pipeline now includes captured inputs, pinned code/config/settings, stable per-record
operation IDs, sorted spill/merge artifacts, provider resolution/population, incremental
commits, failure downloads, cancellation and restart recovery. Separate import runs can
still duplicate earlier history. Data JSON resolves document dependencies; Fitness creates
exercise references before workout sets. The old blanket dependency-order gap is wrong.

Two old edge-case differences remain: Media can retain an association-only source item,
instead of V1's global discard of items with no history/reviews/collections; same-time media
records sort by entity identity, timestamp and source item/event indexes, not V1's secondary
season/episode/chapter/volume ordering. These are identified differences, not proof of a
broken importer. V1 exports require conversion or the startup V1 database migration, not
the V2 backup restore endpoint.

Evidence: `crates/models/enum/src/user_enums.rs`, `crates/utils/dependent/import/src/lib.rs`;
`plugins/{media,fitness}/manifest/plugin.ts`; `plugins/media/backend/imports/{collection,helpers}.ts`;
`kernel/backend/src/modules/imports/{README.md,data-graph.ts}`.

### Integrations

| V1 provider / mode | V2 implementation | Status and material difference |
| --- | --- | --- |
| Emby sink | Media `emby` | Present; episode-to-series resolution |
| Kodi sink | Media `kodi`; existing Python add-on posts playback JSON | Present |
| Plex sink and yank | Media `plex_sink`, `plex_yank` | Present; yank supports ownership |
| Jellyfin sink and push | Media `jellyfin_sink`, `jellyfin_push` | Present; completion push hook and sink provider-ID resolution |
| Komga yank | Media `komga` | Present; API-key auth, positional manga progress and ownership |
| Audiobookshelf yank | Media `audiobookshelf` | Present; in-progress snapshot and optional paged ownership; manual import owns finished history |
| YouTube Music yank | Media `youtube_music` | Present; local-day confirmation claims and completion behavior |
| Browser-extension sink | Media `ryot_browser_extension` | Present; Pro-gated, disabled-site setting and metadata lookup |
| Radarr / Sonarr push | Media `radarr`, `sonarr` | Present; configured collection-add hooks |
| Generic JSON sink | Kernel `data-json` webhook | Replaced; legacy provider removed and explicitly skipped by migration, not an unimplemented sink stub |
| No V1 provider entry | Media Spotify and AniList OAuth yanks | Added; AniList uses list-state snapshots, not invented historical watches |

Kernel integration CRUD, enabled state, manual user sync, scheduled yank sync, durable sink
ingress, owned run history/issues, automatic disable after five consecutive failed runs,
and the disablement notification are present. Ownership is stored on library relationships,
not an Owned collection. Provider minimum/maximum normalization, percent debounce,
positional duplicate suppression and timestamp fallback now live in Media import application
(`backend/imports/integration-progress.ts`), not the old event-policy file. Push hooks and
notification formatters use one external-delivery attempt without automatic uncertain retry.

Evidence: V1 `crates/models/enum/src/integration_enums.rs`, `crates/services/integration`;
V2 `plugins/media/{manifest/plugin.ts,backend/integrations,backend/automations}`;
`kernel/backend/src/modules/{integrations,imports}/README.md`.

## Scheduled and dependent behavior inventory

V1 dispatch is in `crates/backend/src/job.rs`; its background implementation root is
`crates/services/miscellaneous/background/src`. V2 frequent tasks are assembled in
`kernel/backend/src/boot/cron-workflow-definitions.ts`, while domain crons are plugin-owned.

| V1 task / job | V2 equivalent or gap |
| --- | --- |
| Frequent yank and `SyncUserIntegrationsData` / `SyncIntegrationsData` | Scheduled/manual integration sync workflows and captured-source application; covered. |
| `ProcessIntegrationWebhook` | Durable integration ingress/run workflows; covered. |
| `ImportFromExternalSource`, import-report invalidation | Durable roots, reconciliation, terminal failures, cleanup and cancellation replace restart/estimated-finish invalidation. V2 resumes interrupted work; it does not mark every pre-restart run failed or enforce V1's estimate deadline. |
| `PerformExport` | Account backup export workflow, storage and download; covered with a different archive. |
| `AddEntitiesToCollection`, `RemoveEntitiesFromCollection` | Membership commands/workflows plus import/host batches; covered without preserving the V1 job API. |
| `HandleEntityAddedToCollectionEvent` | Membership events and typed fields exist. V1's automatic learning of string/string-array `possible_values` is absent; choices are explicitly configured. |
| `BulkMetadataProgressUpdate`, `HandleOnSeenComplete` | Media activity batches, source writers and required completion hooks; reshaped. No V1 default-collection side effects. |
| `HandleMetadataEligibleForSmartCollectionMoving` | Live episodic coverage replaces the state correction. No Completed→Watchlist collection move or corresponding notification. |
| Refresh monitored metadata and people | Media monitoring sweep, provider refresh and semantic detectors; covered. |
| Reminder notification + removal | Missing producer/schedule and completion/removal behavior. |
| `recalculate_calendar_events` | Replaced by query-time Calendar sources over populated entities and airing arrays; no missing materializer. |
| Notify users for released media | Missing server release-day notification producer; Calendar display is not delivery. |
| Outdated seen-entry notifications | Missing 7-day in-progress / 14-day on-hold nudge producer; V1 gated this on Pro. |
| `regenerate_user_summaries`, `RecalculateUserActivitiesAndSummary` | On-demand domain recipes and projections cover part of the result; no full V1 daily activity/summary reconstruction. |
| Integration sync to Owned collection | Ownership sync annotates Media library links during integration application; covered/reshaped. |
| `remove_useless_data` | Reshaped: the frequent `entity-graph-collection` cron deletes unused provider entities, children and genres by declared composition/reference retention, and receipt and background-work retention prune replay records. Legacy cache/access-link rows no longer exist. |
| `cleanup_user_and_metadata_association` | Accepted redesign: no reason recomputation or automatic deletion after the last history/review/collection reason disappears. Membership persists until explicit removal; full clear removes user data. |
| `remove_cached_metadata_after_updates`, `expire_cache_keys` | Direct RyotQL reads, mutation refresh hints, entity watches, TTL caches and trending refresh replace V1 recommendation-cache invalidation. No need to recreate obsolete application-cache rows. |
| `put_entities_in_partial_state` | No daily invalidation of every library provider entity. Watches fill missing base/related data; monitoring refreshes monitored data. Successfully populated unmonitored data refreshes only on explicit request. |
| `revoke_invalid_access_tokens` | This function revokes expired/exhausted **access links**, not all login tokens. Excluded with sharing links; OAuth/API-key expiry is handled by auth. |
| `rebalance_collection_ranks` | Reshaped: canonical collection writes allocate sparse integer ranks and respace exhausted gaps transactionally, first in a bounded window and then set-based across a fully dense collection if needed. No separate job or V1 fractional-fragmentation thresholds. |
| `UpdateExerciseLibrary`, `UpdateGithubExercises` | Free Exercise DB search/details and watched population replace eager whole-library loading. No exposed refresh-all-dataset command. |
| Scheduled / explicit `ReviseUserWorkouts` | Replaced by source-preserving event-stream record processors and reconciliation, including migrated stream seeding. It is incorrect to call fitness recalculation unbuilt because the V1 destructive replay scheduler is absent. |
| `UpdateMediaDetails`, post-import person/group enrichment | Provider import/population fetches base details; foreground interest completes related data, monitoring refreshes. Explicit enrichment refreshes successful data through the same population owner. No separate stub-enrichment job. |
| `UpdateMediaTranslations` | Generation-bound, language-scoped on-demand translation and explicit failed/cancelled-request retry; covered/reshaped. |
| `ReviewPosted` | Media `review.created` signal exists, but its actor audience replaces V1 notification to monitoring users of a public review. Not social-alert parity. |
| `PerformBackgroundTasks` | Owning V2 schedulers/reconcilers replace one global maintenance job. Missing domain jobs are the specific rows above. |

V2 also reconciles bootstrap/account-lifecycle work, event streams, automation runs and
retention, integration recovery, OAuth connections, upload intents, plugin catalogs and
installations, expired backup artifacts, completed workflow trees, mutation receipts and settled
background work. See `modules/garbage-collection/README.md` for workflow retention. Unused provider
entities follow the graph retention rules in `modules/entities/README.md`; library membership is a
root, not something the collector removes.

## Notification inventory

All nine V1 delivery platforms are implemented: **Apprise, Discord, Telegram, ntfy,
Gotify, Pushover, PushBullet, PushSafer and email**. Channels have create/update/delete/test
commands and settings UI; reads use the `notificationChannel` catalog. Subscriptions select
an exact kernel/plugin signal identity, not V1 platform-specific event filters.

| V1 notification | Current result |
| --- | --- |
| Integration disabled after repeated errors | Covered by kernel integration-disable signal and delivery. |
| New workout | Covered by Fitness `workout.created`; API-origin completions, not imported historical replay. |
| Metadata status / season count / episode discovery / anime episodes or manga chapters | Covered by Media status, season-count, episode-discovered and content-count signals. |
| Person metadata / metadata-group association | Covered; company associations have explicit signals too. |
| Episode images / episode name / release-date changes | Media detector signals exist; show-date and publish-year paths are explicit. Season-zero special episodes are excluded from these episode-change detectors. |
| Review posted | Reshaped: author-only `review.created`, no public/cross-user model. |
| Reminder | Missing. |
| Metadata published today | Missing; episode-discovered is a provider-inventory change, not a date-driven release alert. |
| Stale in-progress/on-hold | Missing. |
| Completed show moved back to Watchlist | Missing literal move/alert; lifecycle correction is derived. |

Evidence: `crates/models/enum/src/notification_enums.rs`;
`plugins/{media,fitness}/manifest/schemas/signal.ts`;
`plugins/media/backend/automations/{media-entity-updated,media-relationship-sync,media-association,review-created}.sandbox.ts`;
`kernel/backend/src/modules/notifications/delivery.ts`;
`kernel/backend/src/modules/automations/README.md`.

## Remaining gaps and decisions

These are behavioral differences found in current code, not a new commitment to restore
all V1 behavior. The [implementation order](#recommended-implementation-order) distinguishes
planned capabilities from decisions and accepted redesigns. The groups below are an inventory,
not a priority order or a requirement to reproduce an old table/job/endpoint. Do not reopen
resolved export, genre, Calendar, editor or projection work.

### Notification producers

1. Entity reminders with persisted due dates, delivery, and post-fire state/removal.
   Ordinary collection membership fields or native workout timers do not implement this.
2. Release-day alerts to monitoring users. These can use the current source data; they do
   **not** depend on rebuilding V1's calendar table.
3. In-progress/on-hold nudges (V1: 7/14 days, Pro-only).
4. Decide whether a derived “more episodes to watch” alert replaces the literal
   Completed→Watchlist notification. No current producer does so.

### Retention and metadata freshness

- Unused provider entities, genres and their children are collected by declared graph retention
  (Order 10). User links, events, typed references, active work and recent interest are roots.
- No job recomputes V1 library reasons or removes memberships automatically. **Accepted V2
  behavior:** membership persists until explicit removal; deleting the last event, review or
  collection entry must not remove it. Do not build a reason-based membership cleanup job.
  Graph collection treats library memberships as roots.
- Explicit enrichment refreshes successful provider data; entity interest only fills missing
  details/related data. Monitoring remains automatic; unmonitored successful data refreshes only
  on request. `providerCheckedAt` records successful canonical/inventory checks, not generic edits
  or translation. Future release delivery must refresh or defer stale candidates under its declared
  freshness window and require completed related inventory where needed. No daily reset is added.

### Collections and browse controls

- **Ordering:** `POST /collections/memberships/reorder` moves a member relative to an anchor or
  absolute end. Sparse integer ranks, on-demand respacing, collection-scoped locks, revision-fenced
  pages and immutable retry identities preserve order. The collection detail's unfiltered reorder
  mode uses shared drag/keyboard handles and haptics; ordinary member-field edits preserve position.
- **Remaining V1 browse controls:** current collection detail supports name/type/member-field
  and cross-collection filtering, plus collection order/name/add-date sorts. It does not expose
  V1's media/exercise-specific filters and rating/consumption/date/random sorts as a complete set.
  Built-in Media views expose year/provider-rating/NSFW/genres/collections, but no equivalent
  full source/state/rated-unrated/date-range filter and sort selection; `sortChoices` is empty.
  Generic RyotQL expressibility alone does not close the client gap.
- **Recommendations:** per-collection candidate search/page UI and a reusable Media-owned
  recipe are absent. User home recommendations deliberately use the latest useful completion,
  rather than V1's random set of up to ten library sources with candidate oversampling and
  global fallback. Disabled views do not act as V1 enabled-media-lot recommendation filters.
- **Membership choices:** V1 learned possible string values after adds; V2 uses declared
  choices and does not expand them automatically.
- Default-name protection and automatic Watchlist/In-Progress/Completed/Monitoring edits are
  not missing generic collection CRUD. The replacement uses lifecycle state, library annotations
  and monitoring links. Migrated named collections can remain ordinary collections.

Evidence: `modules/collections/service.ts`, `packages/contract/src/modules/collections/contract.ts`,
`packages/ryotql-recipes/src/collections.ts`, `plugins/media/manifest/saved-views.ts`,
`plugins/media/shared/discovery-recipes.ts`, `crates/services/collection/src`.

### Custom media and history controls

- Owner-only custom-media/person/company/group editing uses the shared editor, declared outgoing
  links, and loaded entity/relationship baselines. Missing publish years derive from valid full
  publish dates on API creates/updates; explicit years survive date changes. Duplicate actions
  were deferred by product decision. Media editors own person/company credits; group editors own
  members. Custom shows and podcasts author seasons/episodes under fixed parents (see row 7).
- V1 custom `is_partial` inference is not a field to restore blindly: provider availability and
  related completeness now have separate stamps/statuses, and custom entities have no provider
  population.
- Media review creation and editing accept a rating, nonblank text, or both. Clearing text removes
  its spoiler flag; clearing both content fields is rejected, with deletion kept separate. The
  **Rate or review** composer shows rating first and spoiler controls only with text. Review scale
  preferences and V1's anime/manga positional review controls are not reproduced; existing imported
  positional fields survive edits.
- V1 seen rows can link a review, correct the episode identity, and retain a consumption-source
  array. Current Media operations do not link a review to a consumption record or retarget an
  event to another episode; `consumedOn` is one string per event. Progress logging is separate
  from dated completion logging, and does not accept V1's started-date/manual-time input.
- Activity/review edit/delete and automatic completion repair are implemented. Source corrections
  can create, update, or invalidate derived completions across affected consumption cycles. Explicit
  completions survive inference; editing an automatic completion makes it explicit, and deletion
  suppresses that occurrence without deleting supporting history. Source-order keys settle same-time
  lifecycle interpretation without reinstating V1 episode-position import sorting. Corrections are
  silent; later provider changes do not rewrite retained past completion evidence. See row 1 for validation.
- Show/podcast next-up and paged episode/season progress are implemented. Their cycle-aware
  rules intentionally differ from V1's “next after latest history position” and lifetime
  times-seen tree. Anime/manga expose the latest position; V1's separate manga volume-only
  next-entry behavior is not equivalent.

Evidence: `plugins/media/shared/{media-entity-editors,media-review-operations,anime-recipes,manga-recipes}.ts`,
`plugins/media/client/entity-editor/page.tsx`, `plugins/media/shared/media-activity-operations.ts`,
`plugins/media/README.md` (Operations and Lifecycle),
`crates/services/miscellaneous/{metadata-operations,entity-user-details}/src/lib.rs`.

### Analytics and upcoming feeds

- There is no full V1 analytics replacement assembling all media counts and type-specific
  durations/pages, fitness reps/weight/distance/rest/calories/bests, per-hour timelines,
  exercise/muscle/equipment frequency rankings and automatic day/month/year grouping. Current
  Media home activity, Fitness home/workout summaries, measurement series and per-entity
  consumption totals cover subsets. No `daily_user_activity` table is required merely for parity.
- Calendar itself is built. Remaining V1 upcoming-feed controls are monitored-only next-N
  items/days across all relevant media, configurable dashboard dedup/count/window choices,
  and the same breadth of upcoming content on home. Current home panels focus on shows/anime;
  Calendar uses source visibility and a per-source monthly cap, includes specials, and does
  not reproduce the old dashboard preference contract.
- Recently-consumed debounce information is not exposed as a user flag. Do not conflate this
  with paged activity/history, which exists.

Evidence: `crates/services/statistics/src`, `crates/utils/dependent/analytics/src/lib.rs`;
`plugins/media/shared/{activity-recipes,airing-recipes}.ts`;
`plugins/fitness/shared/*recipes.ts`; `packages/kernel-renderers/src/calendar.tsx`.

### Account and preference differences

- Better Auth can update a user's own name; no shipped rename UI or dedicated admin
  rename-on-behalf command exists. V1 roles/last-admin deletion guard do not apply to the
  server-token admin model. V1 onboarding-tour state is not the V2 account-bootstrap marker
  or server-selection onboarding flow.
- Preserved or replaced preferences include language, integration disablement, Media NSFW,
  per-type “where you consume”, Fitness units/rest/timers, source visibility and saved-view
  navigation. Hiding a view does not disable domain processing or recommendation eligibility.
- V1 landing path, list page size, review scale, disable-reviews/videos/watch-providers,
  navigation-animation toggle, configurable dashboard sections and per-provider language
  selection have no matching server preference contract. V2 adds device appearance and
  workspace/home choices; these are not exact migrations of those old controls.
- V1 exercise `exclude_from_analytics` is explicitly omitted by migration. Exercise merge
  currently accepts custom sources only. Whether to restore broader behavior is a product
  decision, not a missing workout-revision scheduler.

Evidence: `crates/models/user/src/lib.rs`,
`packages/contract/src/schema/user-preferences.ts`, plugin user-settings declarations,
`kernel/client/src/routes/_authenticated/settings/{account,preferences}.tsx`,
`plugins/fitness/backend/operations/exercise-merge.sandbox.ts`.

### Asset lifecycle

- Object deletion, byte streaming, stat, managed ownership and unreferenced cleanup exist.
  Public arbitrary S3 delete/list/metadata operations are not the managed-asset contract.
- V1 deleted removed custom-entity S3 assets while updating. V2 has no client-requested deletion:
  a server collector rechecks every managed asset's references 24 hours after registration and
  every 24 hours after that, then retires, deletes and forgets unreferenced assets. Automation
  history and other retained records keep assets referenced; the grace period protects in-flight
  work and open editors.
- S3 prefix listing, custom S3 metadata read/write and a bucket-accessibility probe are absent
  from `platform/storage/s3.ts`. Backup listing and metadata are database-owned now, so those
  old internal helpers are not all standalone user-feature gaps.
- Upload/download URLs use 15-minute windows; V1 used 10-minute writes and 2-minute reads.
  Current upload limits are 50 MiB normally and 1,088 MiB for temporary ZIPs, not one universal
  50 MB cap. Limits are constants, not V1's configurable max-file-size setting.

Evidence: `modules/assets/{uploads/intents,storage/managed-assets,storage/managed-asset-collector,storage/object-storage}.ts`,
`packages/contract/src/modules/assets/upload-policy.ts`,
`crates/services/file-storage/src/lib.rs`.

### Instance configuration

Already present: SMTP sender/mailbox and credentials (`SERVER_SMTP_*`), Pro key,
registration/local-auth/OIDC controls, demo user, telemetry opt-out, Umami host/website ID,
port, timezone, storage paths/S3 credentials, frequent/infrequent schedules, dispatcher
disablement, and Media provider credentials/progress threshold. Do not leave these in an
“unverified/missing” list.

No matching operator setting was found for V1's login-token lifetime, password-strength
validation toggle, dashboard announcement, provider image-size preference, configurable
max upload size, host binding or startup sleep. Auth now uses short access tokens and refresh
tokens; host defaults to `0.0.0.0`. V2 scheduler phrases/cron tiers and dispatcher disablement
are not V1's global stop-all-background-workers switch. CORS/auth proxy behavior is redesigned;
the GraphQL playground and its config setting are obsolete.

Evidence: `crates/config/definition/src/lib.rs`,
`kernel/backend/src/platform/config/definition.ts`,
`plugins/media/manifest/config.ts`, `modules/accounts/auth/README.md`.

## Excluded and deliberately replaced contracts

Absence alone is not proof of product intent. The following retain the previous analysis's
exclusions or have explicit current migration/design evidence:

- **Collection collaborators and public sharing/access links:** no V2 shared-collection or
  public profile/session-link contract. Admin impersonation has a separate working replacement.
- **Public/private review visibility, cross-user reviews, comment threads and likes:** events
  are user-owned; migration omits visibility and comments. Actor-only review notification is
  not a port of the old public-review audience.
- **Manual partial-state flag:** provider population/related status and explicit enrichment refresh
  replace it without invalidating saved data first.
- **V1 Generic JSON wire formats:** replaced by owner-qualified Data JSON and deterministic
  account backups. Removed `generic_json` integrations are reported/skipped in V1 migration.
- **V1 default-collection identity:** Owned/Monitoring use annotations/links and lifecycle
  lists are derived. No requirement follows to forbid renaming an ordinary collection because
  it has a V1 default name.
- **V1 destructive workout replay, calendar materialization, application-cache schema and
  eager exercise-library download:** replaced by projections, query sources, current caching
  and on-demand providers. Their specific missing output behaviors remain listed above.

## Migration inventory is separate from runtime parity

`apps/server/src/migrations/README.md` and its mapping files are the authority for upgrades.
They migrate referenced media/provider entities, custom entities, episodes, genres, ordered
credits, collections/member schemas, library/owned/monitoring links, seen history/reviews,
workouts/templates/sets, measurements, managed assets, integrations, channels and selected
preferences. Watchlist memberships also seed backlog events; Media memberships seed library
events. Workout streams are seeded for current projection processors.

Important omissions/changes include old passwords/sessions/TOTP, admin role, access links,
unreferenced provider data, translations, stale watch-provider data, provider-only suggestions,
review visibility/comments, removed Generic JSON integrations, automation/notification
history, seen-to-review links, and preferences without current equivalents. Migration preserves or reports anomalies;
it does not replay historical notification hooks. Losing old sessions or a cached translation
does not mean runtime login or translation is unimplemented. Conversely, a migration mapping
does not prove that its runtime editor or notification producer exists.

## V1 public-operation coverage index

This index accounts for **117 resolver methods across 18 resolver modules**, including one
debug-only mutation (116 without it). Names are the Rust snake-case names; GraphQL exposes
their lower-camel-case forms. Every row refers to the corresponding
`crates/resolvers/<module>/src/lib.rs`. Status details are in the inventories above.

| Resolver module | Queries | Mutations | V2 disposition |
| --- | --- | --- | --- |
| `custom` | — | `create_custom_exercise`, `update_custom_exercise`, `create_custom_metadata`, `update_custom_metadata`, `create_custom_metadata_group`, `update_custom_metadata_group`, `create_custom_person`, `update_custom_person` | Schema-declared entity editor and plugin commands, including custom seasons/episodes and media-side credits. |
| `fitness` | `user_workout_templates_list`, `user_workout_template_details`, `user_exercises_list`, `user_workouts_list`, `exercise_details`, `user_workout_details`, `user_exercise_details`, `user_measurements_list` | `create_or_update_user_workout_template`, `delete_user_workout_template`, `create_or_update_user_measurement`, `delete_user_measurement`, `create_or_update_user_workout`, `update_user_workout_attributes`, `delete_user_workout`, `update_user_exercise_settings`, `merge_exercise` | Fitness recipes/screens and operations; merge/settings differences above. |
| `user/services` | `user_metadata_recommendations`, `user_integrations`, `user_notification_platforms` | `create_or_update_user_integration`, `delete_user_integration`, `create_user_notification_platform`, `update_user_notification_platform`, `delete_user_notification_platform`, `test_user_notification_platforms` | Discovery recipe plus integration/channel commands and catalog reads. |
| `user/authentication` | `get_oidc_redirect_url`, `user_by_oidc_issuer_id` | `complete_oidc_login`, `register_user`, `login_user`, `logout_user`, `generate_auth_token`, `verify_two_factor`, `initiate_two_factor_setup`, `complete_two_factor_setup`, `disable_two_factor`, `regenerate_two_factor_backup_codes` | Hosted Better Auth/OAuth/OIDC/API keys; no public arbitrary issuer-ID user lookup replacement. |
| `user/management` | `users_list`, `user_details`, `user_access_links` | `delete_user`, `reset_user`, `update_user`, `update_user_preference`, `get_password_change_session`, `set_password_via_session`, `create_access_link`, `process_access_link`, `revoke_access_link`, `generate_user_impersonation_link` | Account/auth and Instance Admin; sharing excluded, roles reshaped, rename UI/admin-on-behalf gap. |
| `exporter` | `user_exports` | `deploy_export_job` | Backup runs, export and download. |
| `file-storage` | `get_presigned_s3_url` | `presigned_put_s3_url`, `delete_s3_object` | Managed upload intents/downloads/cleanup; no arbitrary bucket authority. |
| `importer` | `user_import_reports` | `deploy_import_job`, `delete_user_import_report` | Import source/run/issue catalogs and start/delete/cancel/failure-download commands. |
| `collection` | `user_collections_list`, `collection_contents`, `collection_recommendations` | `create_or_update_collection`, `delete_collection`, `reorder_collection_entity`, `deploy_add_entities_to_collection_job`, `deploy_remove_entities_from_collection_job` | Collection recipes/CRUD/member commands and server-owned reordering with client controls; collection recommendations remain absent. |
| `statistics` | `user_analytics_parameters`, `user_analytics` | — | Partial domain analytics, not a complete unified replacement. |
| `miscellaneous/metadata` | `metadata_details`, `user_metadata_list`, `user_metadata_details`, `user_entity_recently_consumed` | `merge_metadata`, `disassociate_metadata`, `mark_entity_as_partial` | Media/entity recipes and user-data commands; debounce flag absent, partial flag replaced. |
| `miscellaneous/media-translation` | `media_translation` | `deploy_update_media_translations_job` | Language-scoped entity resolution and durable translation work. |
| `miscellaneous/tracking` | `user_calendar_events`, `user_upcoming_calendar_events` | `delete_seen_item`, `update_seen_item`, `deploy_bulk_metadata_progress_update` | Calendar sources, home airing subset and activity commands; edit/delete are implemented. |
| `miscellaneous/system` | `core_details` | `expire_cache_key`, `deploy_background_job`, `deploy_update_media_entity_job`, `generate_log_download_url`, `development_mutation` (debug only) | System config/catalogs, owning schedulers, explicit provider enrichment, admin logs; no general cache/job control; test support replaces development-only hooks. |
| `miscellaneous/social` | `person_details`, `user_person_details`, `user_people_list` | `create_or_update_review`, `delete_review`, `create_review_comment` | Creator recipes/screens and private review commands; public/comment features excluded. |
| `miscellaneous/search` | `metadata_search`, `people_search`, `metadata_group_search`, `trending_metadata`, `metadata_lookup` | — | Provider operations, Media trending/home and integration metadata lookup. |
| `miscellaneous/filter_preset` | `filter_presets` | `create_filter_preset`, `delete_filter_preset`, `update_filter_preset_last_used` | Saved-view CRUD/clone/visibility/order and URL filters; Fitness picker has device-local presets. Not the same context-keyed, last-used-ranked preset/quota contract. |
| `miscellaneous/grouping` | `metadata_group_details`, `user_metadata_groups_list`, `user_metadata_group_details`, `genre_details`, `user_genres_list` | — | Group/genre entity graph and recipes; genre filter/picker works, standalone genre list/detail UI absent. |

V1's `crates/resolvers/router/src/lib.rs` adds HTTP playground/config, temporary multipart
upload, integration webhook and single-use log download handlers. V2 replaces these with
system config, owned upload intents, durable webhook ingress and admin log tickets; the
GraphQL playground is not retained. Companion extension/Kodi transport is accounted for
in the integration inventory, not an additional GraphQL port.

## Existing validation coverage to use for future ports

These suites existed in the audited tree; they were **not run** for the original document-only
audit. Later implementation runs are recorded separately above:

- API Media: `e2e/src/api/plugins/media/{activity-log,calendar-sources,discovery-recipes,activity-recipes,media-genres,lifecycle-query-recipes}.test.ts`, plus `events`, `imports`, `integrations` and `media-monitoring` suites.
- API Fitness: `e2e/src/api/plugins/fitness/{workout-editor,workout-records,exercise-details,exercise-notes,measurements,workout-templates,preferences,calendar-sources}.test.ts` and import suites.
- Browser: `e2e/src/browser/{media-custom-entity,collection-detail,calendar,backups,notification-channels,god-mode-logs,god-mode-impersonation,two-factor}.test.ts` and Media/Fitness interaction suites.
- Kernel: service suites under `modules/{entities,events,collections,imports,integrations,backups,notifications,instance-admin}`; provider/parser/operation and shared-recipe suites in both plugins.

Future updates should cite the actual owner, producer, read recipe and client consumer.
Mark an intentional change only when there is design/migration evidence or an explicit
product decision; otherwise retain it as a documented difference.
