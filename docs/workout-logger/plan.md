# Workout Logger Implementation Plan

## Goal and scope

- [ ] Port the legacy workout logger and template editor into `plugins/fitness`. Preserve its user-facing workflows, not its implementation bugs. This document is an implementation plan and reference, not current product documentation.

Deliver one shared editor for:

- [ ] New workouts, including workouts started from templates.
- [ ] Repeating a saved workout.
- [ ] Editing saved workouts.
- [ ] Creating templates, including from saved workouts.
- [ ] Editing templates.

- [ ] Include exercise selection and same-kind replacement, sets, history copying, notes, RPE, supersets, reordering, bulk deletion, media, measurements, preferences, draft recovery, timers, sounds, wake lock, haptics, and native scheduled alerts. The legacy walkthrough is explicitly deferred.

Do not implement cross-device draft synchronization, a new fitness database, a general activity framework, server push for timer expiry, compatibility paths, or another background queue. Keep all artifact, API, compiler, archive, and protocol version constants unchanged.

This is a greenfield project. Refactor existing modules and change persisted schemas when that gives the feature a sound long-term ownership model. Update affected callers, tests, writers, and legacy mappings directly; do not retain obsolete paths or add compatibility layers. Prefer small, coherent public capabilities over minimal diffs that leave domain behavior in the wrong owner. This permits substantial internal changes, not unrequested general frameworks.

## Settled behavior

| Area                | Required behavior                                                                                                                                                                                                                                  |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Drafts              | One active draft per server/user/device. Starting another action offers Resume or Discard. Navigation does not discard or pause it.                                                                                                                |
| Storage units       | kg, km, seconds, and kcal. Display choices never relabel or modify the physical quantity.                                                                                                                                                          |
| Duration            | Active duration includes ordinary rest and excludes explicit workout pauses. Countdown and stopwatch pause independently. Confirming a set resumes a paused workout.                                                                               |
| Confirmation        | Only confirmed sets become workout history. Existing saved sets remain included even when they have no `confirmedAt`. Unconfirming cancels that set's active countdown safely.                                                                     |
| Rest                | Automatic start or an inline manual start control. Explicit Skip rest and zero rest both perform normal progression. Save configured rest, not measured elapsed rest. Record automatic and manual rest-start times.                                |
| Execution countdown | Honor the countdown preference; offer manual confirmation too. Validate required fields before automatic execution. Zero measurements are valid for manual confirmation; only positive durations start countdowns. Skip does not claim completion. |
| Late completion     | Reconcile an expired execution countdown once, using its original deadline. Do not start a fresh overdue rest countdown. Deleted, replaced, or unconfirmed targets cannot receive a stale completion.                                              |
| Supersets           | Preserve the cycling/navigation UX, membership, colors, collapse, and scrolling. Keep per-set rest; do not invent a separate end-of-round rest model. Use consistent cyclic targeting rather than the old first-other-incomplete implementation.   |
| Replacement         | Restrict candidates to the occurrence's kind. Replace only that occurrence's exercise identity; preserve its sets and completion state. Do not introduce the previously suggested confirmed-set block.                                             |
| History             | Keep automatic prefill, Previous-value copy, and append-all-sets as distinct operations. Previous values span repeated occurrences and older sessions when necessary.                                                                              |
| Preferences         | Follow precedence in `plugins/fitness/README.md`. Zero disables rest. Existing explicit values survive preference changes and set-type changes.                                                                                                    |
| Historical edits    | Preserve original workout times, active duration, and existing set times. No live execution timers. New historical sets without a supplied time use workout start, not today's time.                                                               |
| Repeats             | Copy reusable exercise/set data and structure. Retain exercise and set notes. Clear session energy, workout reflections, RPE, completion times, active duration, and personal attachments.                                                         |
| Templates           | No live execution or confirmations. Retain exercise-only entries. Omit completely empty set rows; allow partially specified planned measurements. Keep optional planned rest.                                                                      |
| Save                | Write the workout before its sets through existing services. Retries reuse stable IDs and do not duplicate; clear the draft only after success. Retain set identities and reject conflicting edits.                                                |
| Media               | Restore existing media when editing. Removal is a draft change until Save. Cancel cannot delete saved references. Support image preview and actual video playback.                                                                                 |
| Measurements        | First implementation slice, working through All Measurements. Use the current metric/reading model without grouped-entry names. Independent saves; cancelling a workout does not remove a measurement.                                             |
| Pro                 | Retain old gates. Never strip existing protected data from a loaded record or silently lose it during saving.                                                                                                                                      |

The old Pro gates were template creation/saving, same-kind replacement, set notes, inline history and copy-all-history, workout-level media, and enabling prompted rest. Automatic history prefill, Previous values, RPE, exercise notes, and exercise-level media were not explicitly Pro-gated by this editor. Do not broaden these gates accidentally.

## Research findings

### Persistent model is ready

The pre-work commits supply `activeDuration`, template-set `restTime`, nine installation-owned preferences, relationship-owned exercise overrides, and membership merges that preserve those overrides. Legacy mappings now copy these values and normalize template measurements.

Relevant owners:

- `plugins/fitness/manifest/schemas/property.ts`: workout, template, set, and measurement properties.
- `plugins/fitness/manifest/schemas/user-settings.ts`: global Fitness preferences.
- `plugins/fitness/manifest/schemas/relationship.ts`: exercise overrides and workout links.
- `plugins/fitness/shared/workout-records.ts`: canonical rounding, derived statistics, personal bests.
- `plugins/fitness/backend/automations/`: context policies and existing record processing.
- `apps/server/src/migrations/`: legacy copying only; not the runtime write path.

Do not reopen migration work unless implementation changes a persisted contract. Measurement logging uses the current metric/reading model and does not restore legacy entry names.

### Realistic workout sizes

The files named `*.sql` are PostgreSQL custom archives, not plain SQL. Read them with `pg_restore`; do not run `just restore-db` for a sizing exercise. That recipe clears configured PostgreSQL, Redis, and object storage.

Sizing used the locally available `postgres:18-alpine` image in disposable containers with `--network none`, `--read-only`, and a read-only bind mount. `pg_restore --data-only --table=workout --table=workout_template --file=-` was streamed into an in-memory COPY/JSON parser. No database was restored and no user identifiers, workout names, or note text were retained in this document.

| Archive         | Workouts | Templates | Max workout information bytes | Max representative workout draft bytes | Max template draft bytes |
| --------------- | -------: | --------: | ----------------------------: | -------------------------------------: | -----------------------: |
| `tmp/file.sql`  |    1,234 |         3 |                        13,480 |                                 15,930 |                    8,325 |
| `tmp/file2.sql` |      648 |        62 |                        19,885 |                                 20,614 |                   16,274 |
| `tmp/file3.sql` |      602 |        86 |                        10,446 |                                 11,720 |                    6,179 |

Representative draft sizes are estimates, not measurements of a not-yet-written codec. They include workout metadata, comments, exercise notes, supersets, media keys, display choices, stable 36-character occurrence/set identifiers, editing event IDs, confirmations, RPE, rest metadata, and numeric input measurements. They omit derived statistics, history query caches, image/video bytes, and signed URLs.

| Archive         | Workout draft median bytes | P95 bytes | P99 bytes | Workout estimates over 8 KiB |
| --------------- | -------------------------: | --------: | --------: | ---------------------------: |
| `tmp/file.sql`  |                     10,993 |    12,822 |    14,549 |                        1,160 |
| `tmp/file2.sql` |                      5,044 |    11,810 |    18,294 |                          145 |
| `tmp/file3.sql` |                      1,855 |     9,411 |    10,588 |                           58 |

Across the three archives there are 2,484 workouts and 151 templates. Maxima are 20 workout exercise occurrences, 60 workout sets, 13 sets in one workout occurrence, 22 template occurrences, and 66 template sets. No representative draft exceeds 64 KiB. `tmp/dump2.sql` and `tmp/dump3.sql` were also inspected; they contain no legacy `workout` or `workout_template` rows and were not added to this sample.

**Recommendation:** raise the existing plugin-storage value allowance from 8 KiB to 64 KiB. Keep one JSON draft value and the existing storage API. Re-measure with the actual codec before final acceptance, including a save input, Unicode notes, and many media locators. Count UTF-8 bytes, not JavaScript string length.

Storage and invocation limits are separate. The sandbox checks each operation's UTF-8 JSON input against a 64 KiB limit; this check does not count the surrounding invocation envelope. Validate the compact save input against the real limit; reject oversize submissions explicitly. Do not increase unrelated sandbox limits or split a logical save into partial writes to evade a limit.

### Runtime gaps that must be implemented

| Finding                                                                       | Checklist                                                                                                                                                                                              |
| ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Plugin operations expose exercise notes, metrics, and reading log/edit/delete | [ ] Add workout/template save/edit, editor-context, and override operations.                                                                                                                           |
| `OperationsService.dispatch` generates a new execution ID per invocation      | [ ] Give saves stable scoped IDs so a UI retry does not duplicate; no admission or pinned-replay framework.                                                                                            |
| Sandbox lacks ordinary user-entity update support                             | [ ] Extend the completed `createUserEntity` capability with bounded updates through the owning service. Each durable step owns its normal transaction; do not use bootstrap-only `ensureUserEntities`. |
| Event create workflow commits each item and can return a partial failure      | [ ] Preserve per-item partial-failure behavior; event update/delete calls are atomic only within their own batches. Do not treat `host.createEvents` as all-or-nothing.                                |
| Existing services reject an enclosing transaction                             | [ ] Keep each existing write service's transaction boundary. Reuse durable lifecycle steps rather than add an outer cross-resource transaction.                                                        |
| Fitness before policies query an already stored workout                       | [ ] Persist the workout before its dependent sets. Do not add proposed-reference snapshots or a virtual query overlay.                                                                                 |
| Installation `userSettings` is kernel-only in RyotQL                          | [ ] Read own settings through a Fitness context operation using `host.getUserSettings`; do not expose all installations' settings through the catalog.                                                 |
| No sandbox Pro-status read; operations have no Pro declaration                | [ ] Provide a narrow trusted Pro-availability read and enforce protected writes using the existing `ProKeyService`; do not create another license system.                                              |
| Client uploads only return temporary tokens                                   | [ ] Add permanent managed-asset upload support through the existing upload pipeline. A temporary token is not a saved asset locator.                                                                   |
| No normal unreferenced-managed-asset deletion command                         | [ ] Add owner/reference-checked cleanup. Reuse schema-aware locator traversal in `kernel/backend/src/lib/domain/data-references.ts`.                                                                   |
| Saved-view Add supports provider search only                                  | [ ] Add a generic plugin-route Add action and wire workouts/templates to those routes. Do not hardcode Fitness in a kernel renderer.                                                                   |
| Provider add signals refresh but does not return added entity IDs             | [ ] Extend generic provider-add with an invocation-correlated completion result. Fitness decides how returned IDs affect picker selection.                                                             |
| Workout/template editor reads do not exist                                    | [ ] Add complete editor queries; do not reuse presentation includes with a 100-row cap.                                                                                                                |
| Global resume affordance does not exist                                       | [ ] Add a minimal scoped return shortcut containing label and target, not workout data or a general activity framework.                                                                                |
| Native scheduled notifications are not installed                              | [ ] Add the Capacitor-8 notification adapter, permission/configuration work, tap routing, and SDK bridge.                                                                                              |
| Native haptics exist only for navigation                                      | [ ] Reuse the platform adapter behind a narrow plugin haptic primitive.                                                                                                                                |
| Wake-lock capability does not exist                                           | [ ] Add host-owned screen-awake demand with correct active-page and disposal handling.                                                                                                                 |
| Archived client assets do not permit audio                                    | [ ] Add the narrowly needed audio extensions/MIME types and artifact/compiler/archive coverage for the four existing sounds.                                                                           |
| Current onboarding is server selection, not a product walkthrough             | [ ] Keep the legacy tour deferred. Do not build a tour framework or unused future-only hooks for this feature.                                                                                         |

## Architecture and ownership

### Domain boundary

`plugins/fitness` owns the measurement composer, exercise picker, library queries and filters, same-kind replacement, set initialization/history copying, supersets, editor modes, drafts, timer reconciliation, save sequencing, and Fitness feature gates.

The client kernel owns authentication, server/user scope, generic provider search/add, transport, navigation, uploads, device storage, and native authority. It must not recognize workout modes, exercise kinds, set identifiers, or Fitness draft fields, and must not select or append exercises to a workout.

The backend kernel owns generic entity/event/relationship write services, schema validation, ownership checks, mutation receipts, durable execution, and lifecycle dispatch. Fitness scripts and workflows determine which domain writes to perform and in what order. Do not introduce a workout service, measurement service, or Fitness-specific provider completion handler in either kernel.

### Exercise picker UX and provider completion

The approved picker is a Fitness-owned library picker plus the existing generic provider-add flow, not a combined local/provider search or a second provider browser.

- [ ] Add exercises opens a searchable Fitness Library list with multi-selection. Show image, name, kind, and useful equipment/target information.
- [ ] Keep checked items while searching/filtering. The bottom action says Add N exercises and appends occurrences in selection order.
- [ ] Find/add an exercise opens the normal provider-add flow. In an empty library this action is prominent.
- [ ] On successful provider addition, return to the picker, refresh the library, and automatically check the added exercise. The workout changes only when Add selected is pressed.
- [ ] Cancel from provider search returns to the same picker with earlier selections intact. Cancel from the picker leaves the workout unchanged. Successfully added library entities remain in the library.
- [ ] Replacement uses the same picker in single-selection mode, titled Replace [exercise]. Only matching-kind entities can be selected; applying a replacement preserves that occurrence's sets and completion state.

For internal support, the kernel reports the successfully added entity IDs. Provider results are ordinary entity references.

Fitness reloads those entities through its own recipes, checks eligibility, and updates picker selection. If provider addition during replacement returns an incompatible kind, keep the entity in the library but do not select or apply it.

### Shared Fitness domain

Move reusable pure logic out of importer-specific modules into `plugins/fitness/shared/`. Shared sources use only the Plugin Kit neutral imports.

- [ ] Extract kind-aware measurement selection from `backend/imports/workout-domain.ts`.
- [ ] Extract the common set-property builder and set-type vocabulary. Extend its shared input with RPE and media only where both real callers need them.
- [ ] Extract common kg/lb and km/mi conversion constants/functions from `hevy.ts` and `strong-app.ts`; use them at importer and editor input boundaries.
- [ ] Keep canonical rounding/statistics in the existing `shared/workout-records.ts`.
- [ ] Put draft/save-input schemas, preference resolution, occurrence indexing, meaningful-template-set detection, and clone rules in focused shared modules.

Keep CSV parsing, source date formats, source-specific set labels, kind inference, source operation IDs, outcome units, and import attribution in `backend/imports/`. The editor knows the selected exercise kind; it must not infer it from entered values. Do not send interactive saves through imports, synthesize import runs, or reuse name-based provider resolution for already selected entity IDs.

Reusing the pure property builder does not mean trusting client-derived personal-best badges. Preserve policy-owned statistics and record-worker-owned personal bests.

### Local editor state

Implement a Fitness-owned controller/service and small React adapters under `plugins/fitness/client/workout-editor/`.

- [ ] Read the draft once, decode it, and expose loading, recoverable error, and ready states.
- [ ] Use `encodeWorkoutEditorDraft` and `decodeWorkoutEditorDraft` for the single stored JSON value. The bounded, lossless codec retains the complete frozen submission and its edit baseline; do not rebuild a pending submission from refreshed preferences.
- [ ] Keep input state current immediately. Do not let an older write overwrite a newer one.
- [ ] Treat a malformed or inaccessible draft as an explicit recovery choice, not permission to overwrite it.
- [ ] Flush local persistence before navigating away. If persistence fails, retain in-memory work and show retry. Do not discard while a save is in flight.
- [ ] Use stable occurrence/set identifiers internally. Existing set event IDs survive reordering, edits, and same-kind replacement.
- [ ] On resume/page refresh, reconcile the countdown and refresh context without replacing unsaved input.
- [ ] No automatic cross-tab synchronization. If multiple tabs edit the same saved workout, server stale-write detection prevents silent overwrite.

### Native notification primitive

Keep the public alert surface to `schedule` and `cancel`. Names are illustrative until implementation naming review; semantics are fixed:

- [ ] Schedule one one-shot alert with plugin-scoped key, UTC deadline, bounded title/body, a semantic navigation target, and a small audible/silent choice.
- [ ] Scheduling the same scoped key replaces the old deadline. Cancel removes pending and delivered instances for that key.
- [ ] Return a small result distinguishing scheduled, delayed/inexact scheduling, denied permission, and unsupported platform. Preserve existing public SDK error reasons for actual transport/disposal failures.
- [ ] The kernel derives server/user/installation authority from the bridge and manages numeric native IDs. Do not accept OS IDs, raw URLs, arbitrary native extras, custom channels, recurrence rules, or lists of notifications from the plugin.
- [ ] Store only scoped key-to-native-ID/target metadata in the host. Account/server changes cancel the departing scope's alerts; stale taps cannot open another user's draft. Cold-start taps wait for the correct authenticated scope and use the existing router.
- [ ] Register native delivery/tap listeners once in the kernel lifetime. Frame disposal does not cancel intentional scheduled alerts; explicit plugin cancellation does.
- [ ] Kernel permission handling must not redirect users into system settings without an explicit action. Report inexact scheduling rather than claiming precise delivery.

Use `@capacitor/local-notifications` compatible with Capacitor 8. Current official v8 docs describe Android notification permission, exact-alarm access, schedule warnings, and `allowWhileIdle` restrictions. Android Doze can restrict idle delivery to once per nine minutes per app; force-stop, device state, user permission changes, and power restrictions remain outside an exact delivery guarantee. No foreground service, alarm-clock entitlement, or background JavaScript worker is planned.

Web uses a kernel-owned scheduled callback and notification support while the host is running; closed-browser delivery is unsupported. Keep the deadline and recover state regardless of alert availability.

For wake lock, use a supported Capacitor-8 keep-awake adapter plus the browser wake-lock API where available. A minimal SDK awake-demand toggle is aggregated by the host and released when the requesting page ceases to be active, the frame closes, the app backgrounds, or the draft ends. Reacquire on foreground activation. Do not keep templates/historical edits awake or request permission before the logger needs it.

For foreground vibration, expose one fixed haptic pulse rather than a pattern API. Muting sounds suppresses application audio and audible scheduled alerts, but not visual completion state. Do not replay a sequence of last-second vibrations on late recovery.

### Save boundary

Use simple idempotent writes through existing services, not an atomic cross-resource coordinator and not a partial-resume engine.

- [ ] Fitness validates the final graph and writes the workout before its sets. Preserve historical timing, protected properties, media ownership, and relationship identity. Reject unrelated event IDs and schema/provenance mismatches.
- [ ] Each write carries a stable scoped ID so retries reuse identities instead of duplicating. Do not hold a transaction across sandbox execution, network work, or workflow boundaries.
- [ ] Show personal-best processing as separate from save completion. Fitness emits the workout-created signal once at successful finalization, not merely when the provisional entity is created.

Reuse existing lifecycle helpers, mutation receipts, and event-stream workers. Add only the generic user-entity write support missing from the current SDK/runtime.

## Ordered implementation phases

### First slice — Working measurement logging through All Measurements

This is the first independently usable deliverable. Do not make it wait for the workout editor, native alerts, or a cross-resource transaction coordinator.
**Status:** complete. All Measurements supports metric creation, pagination, reading log/edit/delete, and retry-safe new reading submissions.

**Files:** `plugins/fitness/client/measurements/{screen,queries}.tsx/ts`, a reusable composer under `client/measurements/`, focused measurement operations/contracts under `shared/` and `backend/operations/`, and `manifest/plugin.ts`.

- [x] Replace the existing Log measurement TODO in the All Measurements saved-view page with the working composer.
- [x] Use the current persisted model: metric entities supply names, keys, and optional units; reading events supply values, comments, and `occurredAt`. Do not add a grouped-entry name input or change the legacy migration.
- [x] Query available metrics and record one or more finite values, including zero, with one shared timestamp and comment. Require at least one entered value.
- [x] Add metric-only creation for an empty installation: display name, normalized stable key, and optional unit. Share key normalization and known units with OpenScale, reject empty keys and known-unit mismatches, and block duplicate keys in the form.
- [x] Extract genuinely shared metric/reading property-building helpers from the importer. Keep OpenScale source units, date parsing, import IDs, and attribution source-owned.
- [x] Add the plugin-scoped durable `createUserEntity` capability required for metrics, restricted to schemas owned by the executing plugin.
- [x] Use the existing event-write path to record readings. Give reading submissions stable scoped IDs so retries do not duplicate; keep the existing event-write path.
- [x] Keep reading input on validation/network/partial failure. Close and clear it only after completion.
- [x] Page all metric summaries and make later reading-page errors retryable. Verify metric and reading pagination beyond 100 entries.
- [x] Refresh the All Measurements summary, series, and reading log after a successful reading save through existing mutation/page-refresh behavior.
- [x] Export the composer for later use inside the workout editor. Workout cancellation must not undo already saved readings.
- [x] Add operation, DOM, and API tests for metric creation, unit/key normalization, duplicate checks, OpenScale reuse, privacy, and metric/reading pagination. Use synthetic fixtures, not private dump contents.
- [x] Add operation and DOM/browser tests for reading values including zero, units/comments, common timestamps, retry after partial failure/lost response, cancellation, and refreshed saved-view results.

**Exit:** a user can open All Measurements, create a metric if necessary, log values, and see the new entry and refreshed summaries. This path must work before workout-specific implementation starts.

The subsequent phases reuse this slice's contracts, helpers, submission handling, and composer rather than implement measurement logging again.

### Phase 1 — Shared contracts, importer extraction, and capacity tests

**Status:** complete. Synthetic workout and template drafts fit the proposed 64 KiB allowance; compact save inputs fit the sandbox input limit. Fitness package and compiler tests pass. The plugin-storage allowance remains unchanged until Phase 4.

**Files:** `plugins/fitness/shared/`, `plugins/fitness/backend/imports/{workout-domain,workout,hevy,strong-app,measurement}.ts`.

- [x] Define the canonical editor draft and compact save input/output schemas. Derive types from these schemas and existing measurements; no handwritten mirrors of entity/event wire shapes.
- [x] Extract the reusable domain functions listed above and update importer callers directly, without compatibility re-exports.
- [x] Implement clone, same-kind replacement, explicit/inherited rest, occurrence indexing, input validation, and set inclusion as pure tested transformations.
- [x] Add sanitized synthetic capacity fixtures: observed largest workout/template shapes, repeated exercise occurrences, at least 101 sets, Unicode notes, mixed displays, and media locators.
- [x] Check the encoded draft fits the proposed 64 KiB allowance and the save input fits the actual sandbox input limit. Failure never truncates data. Confirm public surface changes with package/compiler checks.

**Exit:** existing Hevy/Strong importer behavior remains green; domain tests express the settled rules and measured size envelope.

### Phase 2 — Reliable generic write primitive

**Depends on:** Phase 1; reuse minimal entity-create support from the measurement slice.

**Status:** complete. Generic user-entity create/update, save-related event/relationship retries, conditional entity/event writes, and committed event identities are available through production host dispatch.

**Owners:** `packages/contract`, `packages/plugin-backend-sdk`, `kernel/backend/src/modules/{mutations,entities,events,relationships,plugins}`, and sandbox compiler/runtime capability dispatch.

- [x] Extend the first slice's minimal generic entity-write support for the create/update behavior required by workouts/templates. Keep these primitives schema-neutral and bounded.
- [x] Extend SDK host contracts, the contract capability vocabulary, compiler intrinsic analysis where needed, runtime capability requirements, durable dispatch strategy, boot composition, and tests together.
- [x] Keep per-item policies and schema checks. Retries reuse stable scoped IDs and do not duplicate.
- [x] Test duplicate-free retry after a lost response, validation failure, and conflicting edits. Do not assert whole-save rollback.

**Exit:** production-path tests prove preservation of lifecycle hooks, generic kernel ownership, and duplicate-free retry.

### Phase 3 — Fitness operations and complete editor reads

**Status:** complete. Workout/template saves, scoped context and override operations, complete editor reads, time correction, and completion notifications are available. Editor screens and device persistence remain in later phases.

**Files:** new focused `plugins/fitness/shared/*-operations.ts` and `*-recipes.ts`; `backend/operations/*.sandbox.ts`; `backend/contracts/operation-recipes.ts`; `manifest/plugin.ts`.

- [x] Add create/update workout and create/update template operations using Phase 2. Add an explicit time-correction operation; preserve active duration unless deliberately corrected/cleared.
- [x] Add the editor-context operation for defaulted own settings and trusted Pro availability. Global settings editing remains kernel-owned; per-exercise override edits use the user's membership relationship and support removing a field to restore inheritance.
- [x] Add full workout/template loading, source cloning, exercise selection/replacement, paged inline session history, and Previous-value recipes. Colocate result schemas/decoders/types with recipes.
- [x] Page sets as top-level rows with cursors; presentation include limits must never truncate an editable record. Do not silently drop a deleted/unavailable referenced exercise: retain the draft and identify the blocker.
- [x] Load exercise kind, taxonomy, instructions, demonstration images, own override relationship, and source event identity/times. Retain recorded `exerciseKind` for historical sets even if the provider's current exercise kind changed.
- [x] Validate same-kind replacement at write time for changed existing occurrences. Expose availability for the later UI's local-only convenience gates; do not make generic history queries Pro-only data permissions.
- [x] Enforce meaningful protected changes server-side: new/changed template data, set notes, and workout media. Preserve unchanged imported/protected values on ordinary non-Pro edits.
- [x] Add typed operation outputs for saved, stale/conflict, validation, and Pro-required outcomes so the editor does not infer business failures from diagnostic English.
- [x] Finalize `workout.created` only after complete new saves and retain existing bounded event-stream recalculation. Tests distinguish saving from pending record recalculation.

**Exit:** API tests cover all modes, owner boundaries, existing data preservation, same-kind identity changes, time rules, templates with partial plans, and new-save notifications.

### Phase 4 — Device primitives and draft recovery

**Status:** complete. Scoped device primitives, ordered draft recovery, timer reconciliation, return shortcuts, and audio packaging are implemented. Editor UI and production entry points remain in later phases; native manual acceptance remains in Phase 8.

**Owners:** `packages/plugin-client-contract`, `packages/plugin-client-sdk`, `kernel/client/src/modules/{plugins,navigation,assets}`, `kernel/client/src/persistence`, native platform configuration.

- [x] Raise only the plugin-storage value allowance to the validated 64 KiB size; keep the current API and scope keys.
- [x] Implement ordered draft persistence and recovery in Fitness. Keep schema/decode/quota failures visible. Flush critical transitions; do not silently recover an unreadable value as an empty workout.
- [x] Implement the small schedule/cancel bridge and host alert service described above. Add native package/configuration, scoped native ID mapping, duplicate-key replacement, delivered-notification cleanup, permission outcomes, logout/server-change cancellation, and cold-start tap routing.
- [x] Add host-owned wake-lock and fixed haptic primitives, with Effect Layers and injected deterministic test adapters.
- [x] Add the minimal scoped return shortcut for the old cross-page active-workout affordance. Store only label/semantic target, restore it with the authenticated scope, and clear it on Finish/Discard. Do not make the kernel inspect Fitness draft fields.
- [x] Add four audio assets from `crates/frontend/public/sounds/` to Fitness client sources and narrowly extend supported artifact extensions/MIME types. Handle user-gesture/autoplay restrictions without breaking the logger or adding Howler as an unapproved client dependency.
- [x] Reconcile deadline completion on resume, storage recovery, notification tap, and page refresh. Test timer replacement, deletion, same-kind replacement identity, unconfirmation, late expiry, pause, and multi-scope isolation.

**Exit:** bridge tests and controller tests prove scoped alert replacement/cancellation and exactly-once draft reconciliation. Native manual verification remains mandatory in Phase 8.

### Phase 5 — Shared editor and picker UX

**Status:** complete. Shared editor and picker UX are implemented; media and entry-point integration remain in later phases.

**Files:** `plugins/fitness/client/workout-editor/`, shared recipes/contracts from earlier phases.

- [x] Build the compact/wide editor using `PluginScreenFrame`, SDK overlays/Back handling, registered icons, and bridged viewport/safe areas. Preserve 16px touch inputs, focus behavior, reduced-motion support, and accessible controls.
- [x] Implement name/comment/energy, live summary, active duration pause/resume, Finish/Save/Cancel, and local preference controls.
- [x] Implement all six exercise-kind input layouts, set types, add/delete, notes, RPE instructions, rest display/editing, confirmation/unconfirmation, execution countdown, and independent stopwatch.
- [x] Implement exercise notes/collapse, inline details/history, all three copy operations, and the approved Fitness Library picker with multi-selection, taxonomy/collection filters, sort, and saved picker presets.
- [x] Extend only the generic provider-add completion capability in the kernel/SDK. Implement the return-to-picker, automatic checking, eligibility, selection order, and same-kind single-selection replacement in Fitness.
- [x] Use `ReorderableList` for pointer/keyboard reordering. Implement superset create/edit/delete and cycling, plus bulk per-set/exercise deletion with group repair.
- [x] Keep inline prompted rest with explicit Start/Skip; zero rest progresses immediately.
- [x] Ensure historical/template modes share presentation but do not start live clocks or alert schedules.

**Exit:** DOM tests cover the user-facing inventory and the settled corrections, including immediate editing followed by Finish, reload recovery, repeated occurrences, and Back from nested overlays.

### Phase 6 — Media and measurements

**Owners:** Fitness client/operations; existing kernel upload intent and managed-asset modules; SDK upload bridge.

- [ ] Extend the current uploads capability with a permanent managed-asset path returning a locator. Do not store Blob/base64 bytes in a draft.
- [ ] Verify locator ownership on save. Track newly uploaded draft assets separately from existing references. Clean up newly abandoned assets best-effort; never present cleanup as a failed workout.
- [ ] Use `ManagedAssetProvider` for signed URL renewal. Add image preview and video playback.
- [ ] Reuse the working All Measurements composer and operations from the first slice inside the logger. Preserve the common timestamp, current metric units, finite values including zero, and independent save behavior.
- [ ] Do not implement grouped-entry names, a measurements-page rewrite, pinning, or unrelated measurement editing/deletion as hidden logger dependencies.

**Exit:** tests prove cancelled edits preserve saved media, media survive draft recovery, measurements save independently, and current imports remain unchanged.

### Phase 7 — Entry points and saved detail integration

**Files:** `plugins/fitness/manifest/{plugin,saved-views}.ts`, `plugins/fitness/client/workout/{screen,overview,details-model}.tsx/ts`, template detail entry, `packages/kernel-renderers`, generic saved-view Add contract.

- [ ] Register explicit editor routes/exports and a template detail page. Wire new workout/template entry points and replace existing Repeat/Edit/Adjust time placeholders.
- [ ] Add Create template from workout and Start workout/Edit template actions. A local draft guard applies to every entry, including cold notification entry.
- [ ] Add a generic plugin-route Add action to the entity-browser settings/renderer and point workout/template lists to those routes. Leave exercise provider-search Add behavior unchanged.
- [ ] After Save, navigate to the returned entity and refresh affected data through the existing SDK mutation/page-refresh mechanism.
- [ ] Display `activeDuration` distinctly from elapsed timestamp duration. Convert summary/set measurements and energy according to display preferences. Keep timeline calculations tied to real timestamps, not active-duration totals.
- [ ] Preserve independent collection actions and unrelated TODOs outside this feature's scope.
- [ ] Do not implement the deferred walkthrough or unused future-only tour hooks.

**Exit:** a browser flow can start from each supported entry point, leave/resume, finish/save, and read back the correct record with its template/repeat links.

### Phase 8 — Acceptance, packaging, and focused cleanup

- [ ] Rebuild the Fitness archive and server-owned client runtime/kernel renderers. Verify new operations, routes, source policies, and audio files compile in actual plugin artifacts, not only TypeScript tests.
- [ ] Run `bun run check` and `bun turbo --filter='!@ryot-app/e2e' test`.
- [ ] Run affected E2E files individually. Existing relevant suites include `e2e/src/api/plugins/fitness/{workouts,workout-templates,workout-records,preferences,measurements,exercise-details}.test.ts` and the Hevy/Strong import files. Add dedicated logger/API/browser files under their proper owners. Do not run the entire E2E suite.
- [ ] Test user-owned branches and recovery, not library schemas or type passthroughs.
- [ ] Use sanitized synthetic fixtures, not copied personal dump records.
- [ ] Manually verify iOS and Android: locked screen/background/closed app, notification permission denial, exact-alarm denial/revocation, Doze limitations, tap cold start, foreground double-alert prevention, muted alerts, pause/extend/skip/cancel, server switch/logout, and hardware Back.
- [ ] Manually verify supported web browsers: wake lock release/reacquisition, notification permission denial, navigation/reload recovery, best-effort background alerts, keyboard/pointer reorder, reduced motion, and touch input sizing.
- [ ] If any persisted schema or legacy mapping changes, follow `apps/server/src/migrations/README.md` with disposable PostgreSQL/Redis/object storage and exact rebuilt archives. Ordinary E2E does not validate that bootstrap path.
- [ ] Once implementation changes are complete, run the repository's codebase-cleanup skill in the main session. Remove temporary research fixtures, duplicate importer helpers, and newly obsolete paths only. Re-run affected checks after cleanup.

## Decision status

The product and ownership decisions in this plan are settled:

- Measurement logging is the first usable slice, through All Measurements, using the current metric/reading model without grouped-entry names.
- Saves are simple idempotent writes through existing services, not a resource coordinator.
- A partially committed save keeps its submitted snapshot, timestamp, and IDs fixed until completion. Later changes are a separate edit after that save completes.
- The library picker, selection behavior, same-kind replacement, and provider-result consumption belong to Fitness. The kernel exposes the generic provider-add flow and correlated added-entity references.
- The legacy walkthrough is deferred.
- Greenfield refactors and persisted-schema changes are permitted when needed for long-term ownership and viability; obsolete paths and compatibility layers are not.
- Template sets are meaningful when they contain any measurement, nonblank note or RPE, or explicit rest (including zero); set type alone is not enough.
- Repeats retain exercise and set notes, but clear RPE.
- Zero is valid for manual set confirmation. Execution countdowns require a positive duration.
- Time correction changes workout start/end only. Existing set, confirmation, and rest-start times remain unchanged; active duration changes only through explicit set/clear intent.
- Non-Pro users may remove existing set notes and workout media. Adding or changing their content requires Pro, and meaningful template changes remain gated.
- Generic field-scoped event preconditions distinguish editable fields from background-derived output. Repreparation must recheck the declared fields and run fresh policies, never bypass revision checks or overwrite a competing edit.

Implementation may refine module names, bounded payloads, and generic capability signatures. Those details must not silently change the settled UX, make the kernel Fitness-aware, or expand into unrequested frameworks.

## Research references

- Legacy route and components: `crates/frontend/app/routes/_dashboard.fitness.$action.tsx`, `crates/frontend/app/components/routes/fitness.action/`, `crates/frontend/app/lib/state/fitness.ts`, `crates/frontend/app/entry.worker.ts`.
- Fitness model and rules: `plugins/fitness/README.md`, `plugins/fitness/manifest/schemas/`, `plugins/fitness/shared/workout-records.ts`.
- Reusable importer logic: `plugins/fitness/backend/imports/{workout-domain,workout,hevy,strong-app,measurement}.ts`.
- Partial event creation: `kernel/backend/src/modules/events/event-create-workflow-live.ts`, `packages/contract/src/modules/events/contract.ts`.
- Per-invocation identity: `kernel/backend/src/modules/plugins/operations/service.ts`.
- Mutation ownership/receipts: `kernel/backend/src/modules/entities/{service,mutation-persistence}.ts`, `kernel/backend/src/modules/events/service.ts`, `kernel/backend/src/modules/relationships/service.ts`, `kernel/backend/src/modules/mutations/receipts.ts`.
- Plugin preference visibility: `kernel/backend/src/modules/ryotql/catalog.ts`; settings reads: `packages/sandbox-sdk/src/core.ts`.
- Local storage: `packages/plugin-client-sdk/src/react.tsx`, `kernel/client/src/modules/pages/bridge/storage.ts`, `kernel/client/src/persistence/storage.ts`.
- Upload gap and reuse: `kernel/client/src/modules/assets/temporary-uploads.ts`, `kernel/backend/src/modules/uploads/intents/service.ts`, `kernel/backend/src/lib/domain/data-references.ts`.
- SDK/native boundaries: `packages/plugin-client-sdk/README.md`, `packages/plugin-client-contract/src/index.ts`, `kernel/client/src/modules/plugins/bridge.ts`, `kernel/client/src/modules/navigation/native-navigation.ts`.
- Native notification constraints: <https://capacitorjs.com/docs/apis/local-notifications> (official v8 documentation checked during planning).
- Keep-awake adapter: <https://github.com/capacitor-community/keep-awake> (verify the exact Capacitor-8 release before dependency installation).
