# Write Pipeline Refactor Plan

The changes #1878 makes before merging, from a review of the branch against `ultra-rewrite`, grouped by phase. Every item is approved. Line numbers are from `8487b9c021`; verify them before editing. The bar: greenfield, no workarounds, no duplication, and shared code lifted into packages or the owning plugin.

## Phase 1: folds after commit

- Inline interactive folds run plugin code inside the write transaction (violates kernel/backend/AGENTS.md). Fold after commit through the fold-job path; the request waits; exact consumption; no folding under locks; delete the read-only savepoint for in-transaction script reads and host calls in the caller's transaction; a failing fold no longer rolls back the save.
- derived-values/marks.ts FoldMarks.collect vs queuePending near-copies; foldRunKey grouping ×3; replay threshold twice (marks.ts Object.assign + service.ts:464); commandOf hand-builds rootLifecycleCommand.

## Phase 2: derived-value refresh time + Media summary

- Folds may return a refresh time (date or instant). The kernel stores it per subject, resolves it in the user's reporting time zone (reuse signalScheduleDueFrom; move it somewhere shared), and the frequent cron queues background refolds when due, ahead of bulk fold jobs. A refresh needs no replay (empty change list).
- Media library summary: store one next release `{date, instant}` (by episodeReleaseOrder) and return it as the refresh time. Readers read stored values with ONE shared rule for never-folded subjects (live). Delete: nextAiringAt/Date + nextTrackedAiringAt/Date (library-summary.ts:100-131, 221-228), summaryReleaseArrived, correctedLifecycleState, readySummaryHolds, libraryProgressSummaryValue/currentLibrarySummaryValue live variants, live libraryNextUpEpisodeId (library-summary.ts:371-391, 465-540), presentationLive (episodic-recipes.ts:1086-1164), episodicHistoryExists (lifecycle-expressions.ts:870). Lists (lifecycle-list-recipes.ts:144,149,243; upcoming-recipes.ts:115), cards and schedules (signal-schedules.ts:198,247 staleProgress, episodesAvailable) must use the same reader.
- Media signal-schedules.ts:221-274 `timedFirst` duplicates episodeReleaseOrder (lifecycle-expressions.ts:473-480): use the stored next release + releaseHasArrived.
- Provider updates replay every user's full history: media-entity-updated.sandbox.ts:58-64, media-relationship-sync.sandbox.ts:31-41, library-titles.ts:93-101 return all-user fold requests for any update. Add a fold-request mode with an empty change list (refresh, not replay) and filter to fields the summary reads; batchMaxItems tied to FOLD_LIMITS.requestEntities in plugin.ts.
- Media queries coded around the RyotQL planner's merging: episodic-recipes.ts:1087-1099 unique aliases to stay out of the per-row lateral; library-summary.ts:462-475 `maximum` instead of `first`; lifecycle-expressions.ts:656,844 identical `${alias}Aired` aliases. Fix the planner (planner.ts:500-545): don't eagerly lateral-join aggregates read only inside a conditional, or add an explicit multi-measure construct; remove the alias tricks.
- Media fold carry dropped above FOLD_LIMITS.valueBytes/2 (fold/incremental.ts:56,128-130,283-294; history.ts:43-68 coverage carry with consumedOn arrays): bound the carry by construction; delete carryDropped/bounded. (e2e warm-writes OVERSIZED_FOLD_BYTES=65_536 mismatch then goes away or derives from the fold.)
- Statement size known limit 3 should shrink; measure.

## Phase 3: kernel commit path, policies, routes, services

Commit path:

- Policy requests modelled as persisted AutomationTriggers: runtime guards planner.ts:111-113, policies.ts:70-72,82, run-job-live.ts:125-131; schema/tables/automations.ts:62-63 allows 'request'; contract automations/lifecycle.ts:504-514; lifecycle/policies.ts:131-148 builds an unstored trigger; policy input exposes triggerId (policies.ts:252). Add an in-memory PolicyRequest type; remove request from stored triggers and DB check; delete guards.
- Policy chunks fixed at 50 (lifecycle/policies.ts:159-176) while lifecycle/batch.ts:15-37 chunks by count+bytes; changes/README.md:133-137 documents oversized-chunk failure. One chunker (count + bytes, optional subject grouping) sized against SANDBOX_LIMITS.execution.contextBytes.
- Policy match/apply/accept written 3× (entities/service.ts:341-422, relationships/prepared-mutations.ts:92-180, events/mutations.ts:223-283), disagreeing on decision-to-item matching. One adapter in automations/lifecycle/policies.ts.
- Placeholder population batch (changes/service.ts:1462-1485 afterCount 0, isLeader true; relationships/mutation-primitives.ts:609-631): pass populationBatchId; build batch from real counts.
- DbError for type invariants: changes/service.ts:1793-1796 (commitScript null writeContext), lifecycle/policies.ts:211-216, :315. Type the command or make defects/typed errors.
- Commit failures classified by tag/code strings twice (changes/script-changes.ts:31-86, changes/outcomes.ts:73-90). ChangeSets raises classified failures (CommitConflict with code, PolicyRejected).
- Receipts: changes/receipts.ts:25-89 vs scripts/executions/script-changes.ts:21-24 ChangeSetReceipt + changes/script-changes.ts:104-108 adapter; changes/service.ts:334-337 `unrecorded`; plugins/operations/service.ts:189-204 hand-copied keyedReceipt. One receipt type; keyedReceipt in #modules/mutations/idempotency.
- Principal → lifecycle command rule twice: scripts/host/execution-context.ts:55-110 and boot/kernel-workflow-references.ts:76-112. One helper in automations/lifecycle/command.ts.
- Script-call boilerplate (pin → principal → run → error → decode) in scripts/executions/bootstrap.ts:38-60, automations/policies.ts:118-276, run-job-live.ts:372,428-470, plugins/operations/service.ts:131-170,423, fold-scripts.ts:55-63. SandboxRepository.pinnedPrincipal + ScriptCalls.run with output schema.
- Change-set parts listed by hand ~9 places (changes/service.ts:193-242,268; authority.ts:111-168,218,259,322; changes.ts fromScriptChangeSet). One descriptor per part; split the ~870-line prepareChanges closure and its mutable `let kept`.
- AutomationEntityDraft mapping ×3 (automations/policies.ts:181-189, lifecycle/policies.ts:305-316, events/event-creation.ts:294-309) + per-item getByIdForUser (lifecycle/policies.ts:286-317). One helper, one batched read.
- Change-set relationship writes prepared/persisted per item (changes/service.ts:640-690; prepared-mutations.ts:289; persistPreparedSource mutation-primitives.ts:490 duplicates persistSources :378). Set-based via batched primitives.
  Routes and contract:
- Policy-failure wire reasons defined 5 ways (contract entities/schemas.ts:28,37; relationships/schemas.ts:25-26; entity-user-data/schemas.ts:24-25,45-51; events/schemas.ts:105,112 and :152) and transient failures mapped differently (user-data/routes.ts:22-30 503; entities/routes.ts:67-73 and relationships/routes.ts:60-66 400 with runId; events/routes.ts:66-67 400 without runId). One PolicyFailureReason + PolicyUnavailable in contract changes/; one route mapper next to scriptChangesFailure; decide runId once (delete: policies store no runs).
- HTTP routes rebuild the API command (events/routes.ts:21-34 apiCommand, entities/routes.ts:52-63, relationships/routes.ts:28-38): use apiLifecycleCommand (automations/lifecycle/api-command.ts:11).
- OperationReceipt {output, committed} (plugins/operations/service.ts:78-79) renamed in plugins/routes.ts ~121-138 and re-encoded in agent-tools/catalog.ts:312-322: return PluginInvokeResult throughout.
  Services:
- Data import retry-alone fallback: imports/data-workflow.ts:106-111 runRejections, :804-889 writeEvents, :826-831 managed-asset special case; generic-import-workflow.ts:954-976 differs; outcome recording differs (data :643-689 vs generic :882-888). Per-item outcomes from independent mode; one outcome helper in commitImportItem's recorded hook.
- validateGenericItem (generic-import-workflow.ts:325-462, called twice :649-656 and :676) repeats commit-path validation (relationships/mutation-support.ts:294-340; changes/authority.ts:218-245 undeclaredSchema partial). Use change-set authority checks; keep import-only rules, computed once.
- commitPopulation: outer retryOnDeadlock (entities/providers/population.ts:73) on top of runRootTransaction's; precondition FOR UPDATE before lockCatalog (changes/service.ts:1596 vs :1600, reverse of documented lock order); result via Ref (population.ts:56-93); Effect.die callers (population.ts:216, population-job.ts:269,362). Drop outer retry, precondition after catalog lock, typed check failure, split variants.
- Access revocation two owners + 100 ms sleep-poll (accounts/lifecycle/service.ts:20-21,94-115; job.ts). Revoke in the transaction creating/reactivating the operation; idempotent cache purge; delete claim/timeout/poll.
- integration.disabled signal bypasses ChangeSets (integrations/integration-workflow-live.ts:273-287, not in an activity); kernel-signal commit hand-built twice (reminders/worker.ts:99-172, signal-schedules/worker.ts:156-215). One kernel-signal commit helper; delete emitSignal and its mock.
- data_change pruned only by SignalScheduleRepository.pruneEvaluations behind disableDispatchers (signal-schedules/worker.ts:302): give pruning an always-running owner or record only when evaluation is active.
- Signal-schedule "current target" twice and disagreeing (repository.ts:88-161 listTargets vs :245-291 advanceSnapshots without installation/entitlement checks). One shared subquery.
- Dead EntitiesServiceMigrationLive + Layer.fresh (entities/service-layer.ts:10-32; boot/layers.ts:258,413): delete; define provided layer once in changes/layer.ts.
- Sandbox protocol limits hold product limits (kernel/sandbox/src/protocol/limits.ts:1,19-27,45,156-159 userSettingsBytes, pluginConfigBytes, oauthTokenResponseBytes, integrations, FOLD_LIMITS projection context; host-execution-policy.ts:9,30-68; sandbox/README.md:92,105-108). Move each to its owner's contract module; backend passes context limit in SandboxRunInput.
- Small kernel helpers: exceedsJsonBytes (plugins/configuration/revisions.ts:52-55, preferences/user-settings-size.ts:4-7, integrations/settings-schema.ts:16-25, backups/restore/writer.ts:3175-3186; jsonByteLength imported from plugin-backend-compiler into runtime) → @ryot-app/ts-utils/json; statement-trigger builder (platform/db/collection-order.ts:1-30, data-changes.ts:20-29,54-78); post-migration statement list ×3 (platform/db/migrate.ts:22-28, testing/baseline-migration.ts:20-26, revision-immutability.test.ts:138-146).
- hostCallDiscriminator set but never read (sandbox/src/host/invocation.ts:52; scripts/host/durable-dispatcher.ts:112; boot/script-host.test.ts:142): delete.
- Leftovers: planFixture (automations/lifecycle.test-support.ts:244) unused; changes/README.md:70 isEmptyChangeSet "lets callers skip" but private; scripts/authorization/authority.ts:38/89 resolve→resolveStored→resolve rename; PolicyBatchItem/matchPolicyBatch/applyPolicyBatch exported but file-local; workflow.ts:844 uses re-export jsonValueSchema instead of JsonValue.
- Test fakes: emptyResult (changes/service.ts:323-332) re-typed in collections/service.test.ts, imports/data-workflow.test.ts, population.test-support.ts, test-support/service.test.ts; ten files hand-roll Layer.mock(ChangeSets): export emptyCommitResult + recording ChangeSets helper in changes/change-sets.test-support.ts.
- Dead EventsRepository methods hasUserEvents (events/repository.ts:458), deleteEvent (:703), updateEventEntityReferences (:767) used only by tests.
- Stale docs: events/README.md:38-39 (user commands), :71-72 (EventStreamRepository methods); entities/mutation-persistence.ts:101 comment for deleted isUnchangedUpdate; plugins/README.md:31 (agent tools return output), :220 ("as before"), :227-238 product names and measurements; derived-values/README.md:80 product examples.
- kernel/client bridge/session.ts:591 strips a `cause` key nobody sets.

## Phase 4: SDK and package lifts

- defineActivityWithChanges (plugin-backend-sdk/src/workflow.ts:286-365) duplicates defineOperation (operation.ts:8-30); ActivityResult duplicates OperationResult; activity detected by import name (compiler-source.ts:297-299,388-394; compiler-execution.ts:700-710; compiler-plugin-manifest.ts:81-101; compiler-builtins.ts:39). One defineActivity returning { output, changes? } sharing defineOperation; record activity-ness in the script manifest.
- Client SDK: RyotClientError makes `conflict` optional (plugin-client-sdk/src/client/errors.ts:12) and formatConflict (i18n/errors.ts:44-55) papers over it; messages map unused (fitness adjust-time.tsx:176). Variant union with required conflict/rejection; isCommitConflict predicate.
- plugin-client-contract: pluginOperationFailureVariants (bridge/capabilities.ts:362-382) vs BackgroundSubmissionOutcome failures (background-submissions.ts:99-122); reason lists repeated (capabilities.ts:55-63, :84-93). Define once; derive literals.
- "may have been applied" reasons twice (plugin-client-sdk/src/queries/submission-hook.ts:11-21, kernel/client/src/modules/background-submissions/service.ts:79-83): one predicate in plugin-client-contract.
- Client predicates inline in Fitness: isOperationRejected (fitness client use-editor-actions.ts:72-73, controller.ts:547, exercise/merge.tsx:77), changes-conflict check (use-workout-editor.tsx:99): export isOperationRejected/isChangesConflict from plugin-client-sdk client/errors.ts.
- listIntegrations third page shape (plugin-backend-sdk/src/core/integrations.ts:28,46-49 { items, nextCursor }); readAllRyotqlPages/continuationCursor (ryotql.ts:102-142) RyotQL-only; Media integration-push.ts:55-71 hand loop. Return { items, pageInfo }; generic readAllPages; use in Media.
- Signal-schedule read-set analysis hard-codes catalog facts (ryotql-recipes/src/signal-schedules.ts:244-247 globalSchemaColumns, 250/368 UNBOUNDED_FIELD relatedPopulationStatus, 342 events never global, 360-375 walker; definitions/src/row-source-validation.ts:112 allowed tables). Put metadata in packages/ryotql/src/catalog.ts; derive both; use contract mapAuthoredNode walk.
- signal-schedules.ts next-instant range hand-writes the ±1 day window that row-source-time.ts has (rowSourceTimeWindow). One helper for date and instant windows used by due and next queries.
- Unused SDK exports: core.ts:46 changeSetSchema; core.ts:35 ChangeSetGlobalEntityReference; ChangesOutput exported as changesOutputSchema (core.ts:47) and automationResultSchema (automation.ts:8-11,19). Delete/keep one; update READMEs.
- UpdateEventItem (contract events/schemas.ts:79-85) test-only; events/mutations.ts:24-35 restates fields. Delete; tests use EventUpdate["item"].
- change-set.ts: populatedAt ad-hoc Date check (98-102) → IsoUtcString; OutputWithChanges plain Struct (214-215) → strictStruct; distinct-ID filter twice (67-70, 167-172).
- WeakMap validation cache by identity (ryotql/src/binding.ts:37-50): validate at entry; branded validated document.
- definition-set worker protocol (definitions/src/definition-set-protocol.ts) used only by kernel validation-worker: move to kernel validation-worker-protocol.ts; keep DefinitionSource/DefinitionSetPlugin schemas in definitions.
- Stale-baseline operation error: add an SDK operation-level conflict error next to OperationRejectedError that reaches clients as 409 changes-conflict (used by Fitness workout save and Media activity delete in phase 5).
- SDK `reject` helper (Media has plugins/media/backend/lib/failures.ts:11; Fitness invalid/requireFound + ~15 inline OperationRejectedError): export from plugin-backend-sdk operation.ts.
- SDK createEventChange builder (update/delete exist in plugin-backend-sdk/src/core/changes.ts:83-101; creates hand-rolled in Media media-review-create.sandbox.ts:95-107, media-activity-log.sandbox.ts:133-141, fold/history.ts:532-541; Fitness workout-editor-save.ts:726,762,793, exercise-note-create.sandbox.ts:29, measurement-reading-log.sandbox.ts:40).
- SDK fold definition: value schema + replay/update handlers, strict decode policy (Media media-fold.sandbox.ts:64-73 fails; Fitness exercise-records.sandbox.ts:85-88 replays on decode failure — wrong); kernel-defined subject-events read replacing mediaFoldEventsRecipe's re-encoded subject routing (fold/recipes.ts:80,126-132) and Fitness workout-record-recipes.ts range read; fold recipes must be static documents with typed parameters (Media fold/recipes.ts:64-151 and Fitness workout-record-recipes.ts:66-79 bake IDs/limits into documents, violating Media README:1024-1025). Fold timestamps typed as ISO (drop normalizers: Media fold/incremental.ts:58-65,296-308, history.ts:164-171; Fitness exercise-records.ts:71-73; use IsoDateString from ryotql-recipes codecs.ts:3).
- signalAutomationInput test builder in @ryot-app/plugin-backend-sdk/testing (fixtures in plugin-backend-sdk/tests/automation.test.ts:201-229, fitness notification.test.ts:12-40, media automation-test-utils.ts:20-41, kernel definitions/kernel-scripts/notification.test.ts:29-45).
- userMediaLibraryRecipe (ryotql-recipes/src/user-media-library.ts, exported from plugin-backend-sdk/src/ryotql.ts:11) is Media vocabulary: move to plugins/media/shared; drop SDK export.
- In-memory RyotQL evaluator: lift Fitness fitness/backend/operations/in-memory-ryotql.test-support.ts into ryotql-recipes test-utils or SDK testing; Media tests fake RyotQL by string/regex (automation-test-utils.ts:238-272, media-activity-log.test.ts:43-62).
- Kernel helper to seed a plugin revision for plugin DB tests (Media tests/media-database.ts:39-57,74-100 copies shared/provider-lookups-execution.test.ts:26-87).
- Shared DB test runner helper (apps/server/test.ts, kernel/backend/test.ts, plugins/media/test.ts): runDatabaseTests({ label, workers, run }) in kernel/backend/src/testing/database-run.ts.

## Phase 5: Media, Fitness, server, e2e

Media:

- Fold predicates re-derived: incremental.ts sourceRunOf (70-73) = history.ts:183-186; isConsumption (67-68) = consumption.ts:28; isUnsourced (75-76); isExplicitCompletion (78-79) = completionKeyOf history.ts:159-162. One shared fold module.
- Library link / summary field helpers ×5 (entity-selections.ts:60-78 libraryLinkExists, :85-108 libraryLinkSource, library-summary.ts:352-366,444-458,465-475, fold/recipes.ts:183-211; summaryRead library-summary.ts:368 vs summaryValue signal-schedules.ts:171; 12 field names repeated). One libraryLink primitive (predicate/join/source) + typed summaryField keyed by librarySummaryPropertiesSchema.fields.
- Activity delete doomed write (media-activity-delete.sandbox.ts:40-42): use the SDK stale-baseline error; consistent with update (rejection.record.not-found) and review delete.
- libraryLinkUpsert helper (media-copy-write.sandbox.ts:139-148, media-monitoring-enable.sandbox.ts:44-51).
- Dead: emptyTrending stubs (movie/tmdb/shared.test.ts:15-19,585; show/tmdb/shared.test.ts:16-20,1075), librarySummaryEntitiesRecipe (library-summary.ts:231-263) + stale comment (264-267), trendingEntitySchemaSlugs (discovery-recipes.ts:146) duplicating media-trending.sandbox.ts:24-27.
- Port Media tests to the lifted in-memory RyotQL evaluator and plugin-revision seed helper.
  Fitness:
- Workout save doomed write (workout-editor-save.ts:558-579; README:325-327; e2e workout-editor.test.ts:598-611): use SDK stale-baseline error where baseline or a recorded occurrence is missing; mislabelled invalid("invalid-source") at :679,:692,:706; RyotqlPaginationError → invalid-source (:679).
- 0.001 tolerance (shared/workout-record-recipes.ts:35,74-75; exercise-records.test.ts:270-271; workout-record-recipes.test.ts:110-111 asserts 49.999/80.001): compare the same normalised values (fold projects candidates, or one helper derives slack from workoutSetScales).
- Dead awardWorkoutPersonalBests + WorkoutRecordMaxima (shared/workout-records.ts:29-39,154-171); award rule inline twice (exercise-records.ts:124-133, 242-248): one helper.
- Duplicate types/constants: LaterSetsRequest (exercise-records.ts:53-62) = WorkoutRecordRange (workout-record-recipes.ts:38-47); unorderedLast twice (exercise-records.ts:13, workout-record-recipes.ts:34); null→undefined measurement mapping ×3 (exercise-records.ts:93-98,103-108; test 259-264); comparePositions must match SQL orderBy (workout-record-recipes.ts:107-114).
- Fold decode: replay only when input.value === null; strict decode otherwise (exercise-records.sandbox.ts:85-88); `?? ""` at :55,:116; :115 drops added sets without session.
- Taxonomy cap via coincidental include limit 100 (automations/workout-exercise-policy.sandbox.ts:64; shared/taxonomy-recipes.ts:84,105) vs WORKOUT_TAXONOMY_LIMIT (workout-taxonomy.ts:8); three batching styles (WORKOUT_TAXONOMY_BATCH taxonomy-recipes.ts:269 + hand loop policy :44-53; Array.chunksOf measurement-readings.ts:48; local chunked workout-editor-save.ts:101): use Array.chunksOf, limits from WORKOUT_TAXONOMY_LIMIT.
- Occurrence paging loop twice (workout-time-correction.sandbox.ts:48-64, workout-editor-save.ts:664-681): one readWorkoutOccurrences via readAllRyotqlPages.
- Use SDK reject, client predicates, createEventChange.
  Server:
- History handoff admission via kernel-internal JSON (apps/server/src/migrations/history-handoff.ts:166-183 import_run input_summary fileNames uploadToken); 40 MiB restates UPLOAD_MAX_FILE_BYTES (:26; contract assets/upload-policy.ts:1). Give ImportsService.startImportRun an admission/dedup key (part hash); import the limit.
- Episode-locator CASE twice (seen-mapping.ts:286-289, review-mapping.ts:311-314): into history-handoff-sql.ts.
- The migration tests and the Media history (JSON) import source stay.
  e2e:
- bootstrap-identity.test.ts no longer checks the committed entities.ensures (:84,:148): assert bootstrap-marker entity per user.
- plugin-revision-scopes.test.ts:32-70 retained Whiskey writer (fixtures/kernel/plugin-namespaces.ts:400-413) writes nothing: return a change set depending on old definitions; assert outcome.
- Media operation recipes redefined in e2e (perf/warm-writes.test.ts:54-77, plugins/media/reviews.test.ts:31-50, perf/flow-probes.test.ts:59, fixtures/plugins/media/activity-log.ts:17-29): move to plugins/media/backend/contracts/operation-recipes.ts.
- warm-writes OVERSIZED_FOLD_BYTES (:52) vs Media carry budget: derive from the fold (or drop after phase 2 carry fix).
- workout-editor.test.ts:172 asserts private set:<clientId> item identity.

## Phase 6: dead code, docs, final

- Anything left from the lists above; cleanup skill (main session); root check; affected package tests; affected e2e; push; PR body; R2 real-data run on file2.
- Known limits to revisit after: Media statement size (3), lifecycle lists filter before paging (5), manual imports sourceRun prefix (8), handoff temporary upload per waiting start (9), collection order revision +2 on upsert (10), timing-sensitive e2e (11).
