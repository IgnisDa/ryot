# Order 12 — Entity reminders implementation plan

## Status and handoff

This is an approved engineering plan for Order 12 in
[the V1 → V2 gap analysis](v1-v2-port-gap-analysis.md#phase-3--upcoming-content-and-alerts).
It is reference material, not maintained user documentation. Maintained user documentation belongs
in `apps/docs`.

Planning completed on **2026-10-28**. Implementation and validation have not started as part of this
task. The checkout at handoff was based on `9e600b74506a8fe3b8016d0367dae1d5e5c3e9cf`, with concurrent
uncommitted work, including Media library projections and migration documentation. Recheck the
current code and working tree before editing; preserve that work. File paths below describe the
researched checkout and proposed additions, not a claim that the feature already exists.

The user approved the product decisions below. No product decision remains open. Ask only if new
evidence requires changing this contract or widening the scope. The user withdrew the request to
commit this planning work; do not infer commit authorization from this document.

## 1. Approved behavior

| Topic | Decision |
| --- | --- |
| Ownership | Generic, kernel-owned reminders attached to entities. Media and Fitness provide entry points. No kernel branches on plugin IDs or domain slugs. |
| Multiplicity | Multiple independent, one-time reminders per entity. Recurrence is outside Order 12. |
| Scheduling | Date and time with a visible, selectable IANA timezone, initially the device timezone. Store a fixed UTC instant. Travel or a later device timezone change does not move the reminder. |
| Scan interval | Reuse the existing frequent scheduler, **five minutes by default**. No new one-minute scheduler is required. This is scheduled server delivery, not a precise alarm guarantee. |
| Downtime | Process overdue scheduled reminders after recovery, in bounded batches, and show that they were late. Do not discard them merely because their due date has passed. |
| Delivery | Use existing notification subscriptions and enabled channels. All notification callers share one durable admission/delivery owner. |
| Unavailable delivery | Disabled subscription, disabled server delivery, or no enabled channels settles the occurrence as **Not sent**, with a reason. Enabling delivery later does not replay that occurrence. |
| Uncertain delivery | Report **Delivery unknown** when a send may have reached the provider. Never automatically resend an uncertain attempt. Third-party exactly-once delivery is not promised. |
| Library membership | Creating, firing, cancelling or deleting a reminder does not change ordinary library membership. No mandatory Reminders collection. |
| Explicit library removal | Clear the caller's reminders in the removed entity's declared user-data scope and prevent unsent work from firing. A request already sent cannot be recalled. |
| Merge | Transfer independent reminders without heuristic deduplication. Use existing same-schema, ownership and unique-child-mapping rules. |
| Backup restore | Restore unfinished reminders as **Needs scheduling**. Preserve their message and original date/time evidence. The normal scheduling form creates a fresh occurrence after user action. Completed/cancelled records remain history. |
| V1 conversion | Convert valid V1 Reminders entries into **Needs scheduling** records. Preserve the original date and text; invent neither a time nor a timezone. Never fire historical reminders during migration or startup. |
| Migration acceptance | Real-dump migration validation is part of Order 12, including restart checks. Generated SQL tests and ordinary e2e are insufficient. |
| History | Retain the authored reminder and compact outcome until explicit removal. Prune detailed channel diagnostics after **30 days**, but retain deduplication evidence as long as source work can replay. |
| Greenfield | Breaking schema/API changes are allowed. Remove obsolete paths rather than retain compatibility readers or SDK aliases. Keep repository version constants unchanged. |

The existing native workout rest alerts have a different device-local purpose. This feature uses
server notification channels. Release-day alerts, upcoming feeds and stale-progress nudges remain
their separate backlog items.

## 2. Research findings and source map

Paths in this table are existing files unless marked as proposed.
Backend `modules/...` and `boot/...` paths are relative to `kernel/backend/src`; client paths in
the host-screen row are relative to `kernel/client/src` after its first full path.

| Concern | Source and implication |
| --- | --- |
| Legacy behavior | `crates/services/miscellaneous/background/src/calendar.rs`, `notify_users_for_pending_reminders`: reads `text` and date-only `reminder` from the named collection, sends only on an equal date, then removes the membership. Do not port that runtime behavior. |
| Current channels | `kernel/backend/src/schema/tables/notifications.ts` stores channels only. `modules/notifications/repository.ts` owns channel writes. Channel settings updates currently toggle disabled state; credentials are not exposed through RyotQL. |
| Delivery crash window | `kernel/backend/src/modules/notifications/notification-delivery-workflow-live.ts` calls `deliverEnabledChannels` inside one activity. There is no durable per-channel claim/outcome ledger. |
| Misclassified outcomes | `modules/notifications/delivery.ts` flattens HTTP/SMTP errors; globally disabled delivery returns success. `deliver-enabled-channels.ts` exposes only `sent`/`failed`. |
| Parallel entry paths | `modules/notifications/service.ts` and `script-host.ts` enqueue delivery, while `modules/scripts/host/durable-dispatcher-live.ts` constructs and dispatches `NotificationDeliveryWorkflow` directly. Both sandbox paths must use the same admission owner. |
| Trusted source identity | `modules/scripts/host/durable-dispatcher.ts`, `prepareSandboxSendNotification`, and `modules/notifications/script-host.ts` derive identity from automation run ID and host-call discriminator. Preserve this trusted origin across retries. |
| Formatter completion | `sendNotification` returns after enqueueing, not after external delivery. A successful automation run alone cannot settle a reminder as delivered. |
| Kernel signals | `modules/definitions/kernel-source.ts`, `kernel-scripts/notification.sandbox.ts`, and `modules/automations/planner-resolver.ts` implement `integration.disabled`. The resolver explicitly checks that slug. Generalize selection through declared kernel signal metadata. |
| Transactional planning | `modules/automations/signal-service.ts` currently plans in its own transaction and dispatches afterward. Expose reusable transactional planning so a reminder transition and its signal cannot commit separately. |
| Subscription initialization | `modules/accounts/provisioning/bootstrap.ts` calls `NotificationSubscriptionsService.ensureDefaultRules`. New signals enter default initialization through definitions. A missing/disabled subscription must remain a visible delivery condition, not be silently enabled by reminder creation. |
| Scheduling | `modules/scheduler/{cron,frequent-cron,cron-workflow}.ts`, `boot/cron-workflow-definitions.ts`: interval-boundary workflow IDs are shared across replicas. Reminder rows still need their own admission uniqueness. |
| Retirement | `boot/admitted-workflows.ts` omits notification delivery. Use `modules/mutations/{receipts,workflow-dispatch}.ts` and the account-generation token for admission and reset/delete retirement. |
| Workflow expiry | `modules/garbage-collection/README.md`: successful completed workflow trees expire after 24 hours; failed trees after 168 hours. Durable reminder outcomes and deduplication must outlive journal cleanup where needed. |
| Entity user data | `modules/entities/user-data/{service,planning,graph-repository}.ts` currently captures events and relationships, including historical child evidence. Add reminders to capture, stale checks, clear and merge. |
| Graph collection | `modules/entities/retention/repository.ts`, `liveIds`: reminder roots are not currently considered. Active and Needs scheduling reminders must retain their targets. |
| Backup references | `modules/entities/repository.ts`, `listReferencedGlobalEntitiesForBackup`, currently finds event/relationship references. Reminder-only targets and parent scope need export dependencies too. |
| Backup format | `modules/backups/{README.md,archive/schemas.ts,export/snapshot.ts,restore/writer.ts,restore/persistence.ts,restore/account-cleanliness.ts}`: subscriptions are portable; channels and delivery jobs are not. |
| Shared host screens | `kernel/client/src/modules/pages/documents/page.tsx`, `modules/collections/screens.tsx`, `modules/ui/host-screen-session.ts`, and `modules/pages/bridge/session.ts` provide the host-screen pattern. |
| Media UI | `plugins/media/client/media/{summary-header,episode-details}.tsx` are shared action locations. `client/media/` remains schema-agnostic; descriptors supply domain copy. |
| Fitness UI | `plugins/fitness/client/exercise/{screen,overview}.tsx`, `client/workout/{screen,overview}.tsx`, and `client/workout-template/screen.tsx`. |
| Date/time reuse | `plugins/fitness/client/{datetime-input,datetime-field,use-datetime-input}` already handles DST gaps and repeated times. `packages/plugin-ui-sdk/src/schema-form/datetime.ts` is another converter whose precision and consumers must be accounted for during consolidation. |
| V1 collection conversion | `apps/server/src/migrations/{collection-mapping,migrate-data}.ts` preserves collection fields as ordinary membership properties; it does not create reminder schedules. |

Read applicable `AGENTS.md` files and feature READMEs before implementation. In particular: backend,
client, contract, client bridge/SDK/UI SDK, Media, backups, legacy migration and e2e instructions.

## 3. Data and command design

### 3.1 Reminder records

Add `kernel/backend/src/modules/reminders/` with its service, owning repository, routes, feature Layer,
worker and README. Add contract definitions under `packages/contract/src/modules/reminders/` and
register the contract group and backend routes.

The logical reminder record needs:

- Owner and account scope, stable reminder ID, created/updated timestamps and revision.
- Target entity ID and validated parent/scope reference when the target is a declared child.
- Authored message and sufficient nonsecret entity-title evidence to explain history after a target
  disappears. Do not put domain-specific metadata into kernel schemas.
- UTC due timestamp and IANA timezone for scheduled occurrences.
- Original scheduling evidence for Needs scheduling records. V1 supplies a **date only**, so those
  records must support an absent instant/timezone rather than encode fabricated midnight/UTC values.
- Lifecycle state, processing identity, selected formatter run/notification linkage and compact outcome.
- Optional replacement linkage so an explicitly scheduled replacement does not leave the original
  imported/restored record looking like an unhandled scheduling request.

Use Schema-derived types and database constraints for valid state combinations. Proposed state names:
`needs-scheduling`, `scheduled`, `processing`, `settled`, `cancelled`. Final spelling is an implementation
detail; distinguish missing schedule, pending execution and completed outcome in both persistence and UI.

Index due scheduled rows by due time and stable ID, owner-scoped list order, target/scope references,
and processing work needing reconciliation. Use bounded keyset pages, not unbounded row loading.

### 3.2 Commands

One service owns create, edit, cancel, schedule-again and explicit history removal. Schedule-again
uses the same creation implementation and form; it creates a new occurrence identity, not a second
delivery mechanism. Consuming a Needs scheduling record and creating its replacement must be atomic
and retry-safe. Preserve prior completed outcomes.

- Authenticated mutations use the protected demo policy, ownership checks, `idempotencyKey`,
  `submittedAt`, mutation receipts and account-generation admission.
- Edit/cancel carry the expected revision. Replay an already committed receipt before testing a newer
  revision. Reject reuse of a submission identity with different normalized content.
- New schedules must be in the future at initial acceptance. A retry of an accepted submission remains
  a replay even if its due time has since passed.
- Processing is the edit cutoff. A stale editor must reload rather than overwrite the admitted message.
- Cancel Scheduled/Needs scheduling work directly. For Processing, revoke unsent work atomically and
  report accurately if a send already started. Do not label an in-flight external request as recalled.
- Explicit history removal erases authored content while preserving any minimal replay/cancellation
  evidence still required by accepted work. Do not make history removal a bypass around cancellation.
- Validate target visibility with existing entity-scope readers. Derive/validate child scope from
  manifest `userState.children`; do not trust an arbitrary client-provided parent.

Define shared bounds for message length, batches and admitted work. Use existing limits where they
apply; new values must be explicit and tested. Distinguish capacity deferral from permanent Not sent.
Do not invent arbitrary scheduling horizons, delivery expiration windows or Pro gating.

## 4. One notification admission and delivery path

### 4.1 Durable ledger

Extend the notification feature with a logical notification table and per-channel delivery table.
Give each table exactly one runtime writing repository. The channel repository can stay separate
from a new delivery repository; all entrypoints call the same service owner.

A notification stores its owner/account generation, immutable source key and input digest, message,
source correlation, admission/settlement state and compact result. Source identity must survive
deletion of optional automation-history foreign keys. A per-channel record stores the notification ID,
stable channel identity, safe display description/kind, send claim and outcome. Enforce uniqueness
on notification source and on notification/channel identity in the database.

Select channel IDs once at notification admission. A later channel addition does not join an old
occurrence. Recheck deletion/disablement before claiming a send. Preserve outcome evidence when a
channel is deleted; do not copy credentials into public read models or historical diagnostics.

Route these through the shared admission owner:

1. `NotificationsService.test` and `sendMessage`.
2. `makeNotificationScriptHost`.
3. `prepareSandboxSendNotification` and the durable dispatcher's send branch.
4. Reminder formatters through the same trusted `sendNotification` capability.

Keep the script-facing capability narrow. Derive source run, host-call discriminator, recipient and
account generation from trusted host context. A script must not choose another reminder's occurrence
or bypass its cancellation fence. Multiple host calls in one automation remain distinct messages;
retries of the same run/call must not be new messages.

Channel tests also need a retained submission identity. Return a genuine admitted notification ID so
the settings UI can distinguish queueing from delivery and read outcomes through RyotQL.

### 4.2 Send and recovery invariant

For each channel:

1. Do local validation/preparation that can establish a definite pre-send failure.
2. In a short transaction, recheck account/source authority and channel state, then change Queued to
   Sending with one durable attempt identity and timestamp.
3. Commit before external I/O.
4. Only the execution that acquired that fresh claim may call the transport.
5. Record Accepted, Failed, Unknown or Skipped through an attempt-fenced write.

**Do not journal a successful claim in one activity and send in another replayable activity.** Recovery
could reuse the journaled claim and repeat the external request. The activity that can perform I/O
must freshly test the durable claim. Finding an existing Sending claim never grants permission to send.

Define bounded handling of abandoned Sending records using workflow/attempt state and a documented
deadline. Do not mark a healthy concurrent attempt abandoned merely because another worker sees it.
An abandoned claim becomes Unknown; do not reclaim it for another external attempt. Handle late
results only from the original attempt, without reopening delivery. Database outcome-persistence
retries may repeat database writes, never the provider call.

Accepted means the provider acknowledged the request, not that the recipient read it. Preserve
partial success. Known pre-send failures and explicit provider rejections differ from ambiguous
timeouts, connection loss after request transmission and process interruption. Classify conservatively.
Server delivery disablement is Skipped, never Accepted.

Review each existing adapter's response semantics while introducing typed outcomes. The current
adapter tests mostly check request shape, not provider acceptance. Add hermetic response cases and
safe plain-text handling, including Telegram's current `parse_mode: "Markdown"` behavior. Reuse the
nine existing transport adapters rather than create reminder-specific adapters.

### 4.3 Recovery, account fencing and retention

- Commit admission before dispatch. A worker recovers admitted-but-undispatched notifications.
- Register notification delivery in `boot/admitted-workflows.ts` and use mutation workflow admission.
  Revalidate account generation before admission and send claims, including both sandbox paths.
- Use a narrow transaction-scoped source policy/cancellation port where delivery needs reminder
  authority. Bind it in feature/boot Layers; do not introduce a dependency cycle from the generic
  delivery service back into the reminder service.
- If a reminder is removed while its formatter is delayed, later formatter retries must fail closed
  or resolve to cancelled work. Removing the authored row must not erase that guard too early.
- Prune detailed channel diagnostics 30 days after settlement. Preserve compact reminder outcomes.
  Compact source keys/claims stay until retained automation retries, active workflow trees and valid
  submission replay can no longer recreate the send. Workflow expiry alone is not sufficient.
- Align source retention with automation history pruning so a pending reminder can still settle when
  formatter evidence would otherwise expire. Avoid a forever-Processing state.

## 5. Reminder scheduling and signal integration

Add reminder due/reconciliation tasks to the existing frequent cron assembly. Respect dispatcher
disablement and the configured interval; the accepted default is five minutes. Do not add a timer per
reminder or a new scheduling framework.

Each scan uses `dueAt <= now`, stable ordering and bounded batches. Catch per-record failures so one
bad reminder cannot block later work. Recovery must cover both work never dispatched and work whose
formatter/delivery has settled. Use database uniqueness and locking in addition to cron execution IDs.

Add kernel `reminder.due` with actor audience and a declared notification formatter. Update:

- `modules/definitions/kernel-source.ts`.
- `modules/definitions/kernel-scripts/notification.sandbox.ts` and its projection.
- `modules/automations/planner-resolver.ts` to select declared kernel formatters rather than the
  `integration.disabled` literal.
- Definition, formatter, subscription and planning tests. Regenerate kernel script artifacts through
  the build tooling, never by hand.

Refactor signal emission into reusable transaction-scoped planning plus post-commit execution, and
make the existing public emission path use those same internals. In the reminder transaction:

1. Acquire the required authority/catalog/entity/reminder locks in the common documented order.
2. Recheck due state, expected occurrence and current eligibility.
3. Record Processing and the unique occurrence identity.
4. Plan the immutable signal and formatter run, retaining the correlation needed for settlement.
5. Commit, then dispatch through the existing lifecycle execution owner.

The selected notification formatter's absence due to an inactive/missing subscription is a persisted
Not sent outcome. Distinguish it from planning errors, budget rejection or unavailable code. An
enabled subscription does not imply that a channel exists.

Use trusted run correlation to connect the formatter's eventual notification admission to the reminder.
Formatter success is only evidence of admission. The reminder worker settles from actual delivery
results; formatter failure, missing admission and expired evidence also require explicit outcomes.
Ensure a terminal reminder cannot later acquire a new send from a delayed formatter retry.

Include scheduled time, admitted/settled times and enough evidence to display lateness. Do not use
provider freshness, monitoring or the upcoming-feed implementation as prerequisites.

## 6. Entity lifecycle, retention and removal

Extend the existing user-data scope rather than create a separate Media/Fitness reminder remover.

- Include reminder rows and their revisions in user-data captures and stale rechecks.
- Capture validated parent scope for child reminders. Include detached historical children retained
  by those reminders when clearing or merging the parent.
- Add reminder targets to merge's required child mappings. Missing or ambiguous destinations reject
  before any source writes. Preserve reminder IDs/occurrence evidence while remapping targets.
- Keep all independent reminders on merge, even if their message and time match. Preserve immutable
  messages already admitted for delivery; a merge must not create another occurrence.
- Clear authored reminder content and revoke queued work in the same source transaction as user-data
  removal. Preserve minimal cancellation/deduplication evidence until delayed work cannot replay.
- Route entity deletion through the same reminder lifecycle owner. Deletion must cancel pending work
  rather than merely null its foreign key and leave it scheduled.
- Active, Processing and Needs scheduling reminders retain target and scope entities in graph
  collection. Settled history can use a title snapshot if provider metadata is later collected.
- Reminder creation must lock referenced entities in a way that conflicts with graph retirement.
  Test both outcomes of creation racing collection.
- Account cascade cleanup and generation fencing must cover reminders, notifications and claims.

Before implementing concurrent paths, document lock order against existing mutation receipt,
account, plugin ingestion/configuration and entity locks. Due scans must not take reminder locks
first while clear/merge takes the reverse order. Use existing transaction-scoped ports to keep table
writes with their owners and avoid upward module imports.

## 7. Backup and V1 migration

### 7.1 Current backup format

Add a required reminder section to the current archive schema and ordered entry list. Keep the backup
version constant unchanged and update all archive fixtures; no missing-section compatibility path.

Update `archive/{schemas,archive,references}.ts`, `export/snapshot.ts`, backup dependency discovery,
`restore/{writer,persistence,account-cleanliness}.ts`, feature Layers and relevant failure contracts.

- Export authored reminder data, original schedule evidence and compact outcomes.
- Include reminder-only global entity dependencies and exact owning plugin requirements.
- Remap target and parent IDs using the archive's explicit ID maps.
- Treat existing reminders as account data when checking restore cleanliness.
- Historical inserts belong only in `restore/persistence.ts` under the atomic restore transaction.
- Scheduled/Processing source records become Needs scheduling; retain evidence that a Processing
  source may have sent. Previously Needs scheduling records stay inactive.
- Settled/cancelled records remain history. Never restore live claims, workflow IDs, formatter runs or
  delivery jobs as executable work.
- Repeated restore execution must use the existing atomic completion marker, not create duplicate
  reminders. Export/restore remains within current metadata limits; only events stream.
- Channels remain outside the archive. Show channel/subscription readiness before the user creates
  a replacement occurrence; neither restore nor scheduling silently enables a subscription.

### 7.2 One-time V1 conversion

Add a mapping owned by `apps/server/src/migrations`, composed from `migrate-data.ts` after users and
referenced entity mappings exist and before legacy tables are dropped. This is the existing legacy
bootstrap exception, not a V2 compatibility path.

Inspect the exact V1 `collection` / `collection_to_entity` shapes in the available dumps and existing
mapping helpers. Match the same named collection semantics as V1's worker, not collections that
merely have a similarly named field. Preserve each valid entry's owner, target, original date and text.

- Produce deterministic IDs from legacy membership identity and a mapping discriminator.
- Insert Needs scheduling only: null active due instant/timezone, preserved date-only evidence.
- Use restart guards consistent with the surrounding migration. An interrupted restart must not
  duplicate records or replace already committed/user-adjusted records.
- Ordinary migrated collection metadata and memberships may remain as inert user data; no runtime
  worker interprets them as schedules. Do not silently destroy collection content to remove the old
  special behavior.
- Resolve every target and parent reference explicitly. Malformed dates/text, missing owners and
  missing/ambiguous targets must not be silently skipped. Follow the migration rule: abort unexpected
  state with a useful remedy; introduce a documented anomaly category only with an explicit reason.
- Write set-based migration counts and per-record anomaly evidence where applicable. Do not log
  private reminder text in routine terminal output.
- Migration-only execution and subsequent ordinary startup must not send Needs scheduling records.
  Historical automation and notification execution tables remain empty.
- Update the migration README's mappings, reporting and validation sections. Changes to
  `kernel/backend/src/platform/db/migrate.ts` still require the prior discussion mandated by the
  migration instructions; this plan does not authorize moving the migration there.

### 7.3 Required real-dump validation

Read the current migration README runbook before executing. At handoff, `tmp/file.sql`,
`tmp/file2.sql` and `tmp/file3.sql` exist. Inspect their formats and V1 applicability. Validate the
normal and larger applicable dumps, and record the disposition of every available candidate.

Use disposable PostgreSQL, Redis and object storage with explicit environment overrides. The current
`just restore-db` recipe deletes the configured working database, Redis data and local bucket, and
`just sync-s3` targets the normal local bucket. **Do not run those recipes against the developer's
working resources.** Reproduce the runbook operations using explicitly isolated targets. Preserve
original dump files and source asset caches; the asset phase can delete copied source keys.

Build the shipped Media/Fitness archives, backend, renderers and sandbox as required by the current
assembly tooling. Then run server assembly and migration-only mode with isolated configuration:

```bash
# Run from the repository root; Turbo builds dependencies and reuses valid caches.
bun turbo --filter=@ryot-app/server build
```

The current server build does not run assembly. Next run `bun run assemble` with `apps/server` as
the working directory. Run `bun run run-migration` from that directory only after supplying the
isolated database/Redis/storage configuration. Reuse built artifacts across dumps when their inputs
have not changed.

For each applicable dump:

1. Restore it and seed a disposable asset bucket from the available cache, following the runbook.
2. Before migration drops legacy tables, capture source reminder counts and canonical hashes over
   membership ID, owner, target, date and message. Keep sensitive evidence in disposable local
   validation storage, not committed documentation.
3. Run migration-only mode and inspect logs, `migration_report` and mapped reminders.
4. Compare the complete source and destination sets, not a sample. Verify Needs scheduling, absent
   active instant/timezone, exact text/date preservation, target ownership and deterministic IDs.
5. Confirm no reminder signals, admitted sends, channel attempts or automation history were created.
6. Restart migration-only mode and confirm unchanged IDs, hashes, counts and prior outcomes.
7. Exercise an interrupted phase/restart with legacy tables still present to verify restart guards;
   completed startup alone bypasses much of the legacy migration and is insufficient evidence.
8. Start normally on disposable resources and invoke/wait for due processing. Needs scheduling
   records must remain inactive. Explicitly schedule one through the actual client/API path using a
   hermetic notification target and verify one new occurrence.
9. Run the existing migration invariant checks for plugin/configuration revisions, history silence,
   collection order, relevant entity/provider state and other changed mappings. Record unrelated
   known anomalies separately rather than count them as reminder successes or failures.
10. Record commands, dump identity, timings, counts/hashes, restart results and anomalies in the
    acceptance handoff. Remove disposable resources after evidence is retained.

If the real dumps have no reminder entries, report that fact. Still validate full startup and restart
on them, then add controlled reminder cases to an isolated restored copy and label that evidence as
supplementary rather than pretending the original dumps covered conversion.

## 8. Client and shared SDK work

Implement one kernel-owned reminder management screen and editor in a proposed
`kernel/client/src/modules/reminders/` feature. Add an account-level route, for example
`/_authenticated/settings/reminders`, and the corresponding settings navigation entry.

Expose a semantic SDK host-screen capability such as `screens.manageReminders({ entityId, ... })`.
It opens the same kernel UI used by the account page, scoped to an entity. Extend:

- `packages/plugin-client-contract/src/bridge/{capabilities,messages}.ts` and declared aggregation points.
- `packages/plugin-client-sdk/src/client/{adapter,client}.ts` and bridge request handlers.
- `kernel/client/src/modules/pages/{documents,runtime,bridge}` wiring.
- Host-screen exclusivity/cancellation, inert document state, stale-reply suppression and refresh hints.
- The relevant API group port, client feature Layer and query/mutation definitions.

Use RyotQL catalog tables with explicit owner-only visibility for reminder and delivery reads. Expose
only safe fields; keep account-generation tokens, credentials, internal workflow payloads and raw
diagnostics out of public recipes. The host UI can own reminder reads without giving every plugin
access to another plugin's reminder messages. Add named recipes under `packages/ryotql-recipes` for
account/entity lists, counts, readiness and outcome detail.

UI requirements:

- Upcoming, Needs scheduling and history views with stable sorting/cursor pagination.
- Entity title/link, message, selected timezone, due time and late-delivery evidence.
- Create/edit/cancel, Schedule again and explicit terminal-history removal.
- Needs scheduling preserves the original date/time as context but requires a future time/timezone
  choice. Do not silently pre-accept a made-up V1 time.
- Display Accepted, Partial, Failed, Unknown and Not sent honestly, including per-channel summaries.
  Once detailed diagnostics expire, the compact outcome remains readable.
- Explain channel/subscription/server readiness using existing settings controls. Preserve an explicit
  user's disabled preference and do not convert missing channels into a validation lie about delivery.
- Retain one immutable submission across transport retries; stale revisions offer Reload.
- Refresh/poll while processing using shared query scheduling. Use shared load-more state and avoid
  changing rolling query keys with the clock.
- Keyboard, focus, mobile Back and compact/safe-area behavior follow current shared UI primitives.

Wire the shared host-screen action into Media's summary header and episode details, and Fitness
exercise, workout and template details. Pass validated child context for episodes. Keep domain copy
in plugins and reminder mechanics in the shared owner.

Extract the reusable Fitness date/time resolution into an existing appropriate shared package. Use
one canonical conversion algorithm for reminders and affected existing forms. Account for the schema
form converter's seconds/milliseconds support before replacing it; do not regress unrelated editing
precision. Keep React state/field components separate from environment-neutral conversion logic.
DST gaps reject; repeated times require a clear offset/occurrence choice. The server validates the
resulting instant and timezone. Do not use server local time or parse a date-only string as UTC midnight.

## 9. Execution sequence and acceptance tests

Implement in these dependency-ordered slices. Keep affected contracts, fixtures and tests aligned
within each slice; do not defer all integration failures to the final validation run.

### A. Contract, persistence and notification owner

- Add Schema definitions, SQL constraints/indexes, repositories and the generated migration using
  current repository tooling. Preserve concurrent migration work.
- Refactor all notification entrypoints, including channel tests and durable sandbox dispatch.
- Add account admission/retirement and per-channel claim/recovery behavior.
- Verify same-source replay, changed-content conflict, concurrent admission, multi-channel partial
  outcomes, disabled/deleted channels and server-disabled delivery.
- Verify account reset/recreation rejects old work, including a stale workflow payload.
- Verify failure before send versus loss after send, and failure while saving a successful result.

### B. Reminder service, signal and worker

- Implement guarded commands, due scan, transactional signal planning and settlement correlation.
- Verify ownership/demo checks, future-time validation, stale edits, immutable retries and multiple
  independent reminders for one entity.
- Verify concurrent scans, due/edit/cancel races, overdue catch-up, bounded batches and a failing
  row not blocking later rows.
- Verify disabled/missing subscription, no channels, formatter failure, lost dispatch and expired
  formatter evidence all leave an accurate recoverable or settled state.
- Verify a delayed formatter cannot send after cancellation, clear, history removal or terminal
  settlement. A successful formatter must not falsely imply accepted delivery.

### C. Lifecycle, backup and V1 mapping

- Integrate clear/merge/delete, graph retention, backup dependencies and historical restore.
- Verify reminder-only targets survive collection; settled history does not retain provider graphs
  forever. Test creation versus collection locking.
- Verify independent reminders survive merge and missing child mappings reject atomically. Include
  detached child reminders and clear/merge racing admission/send claims.
- Cover backup round trips, clean-account refusal, ID remapping, inactive unfinished restores,
  completed outcome preservation and a restore snapshot taken while delivery was Processing.
- Implement V1 mapping and reporting. Verify deterministic conversion, date-only preservation,
  malformed-input refusal and interrupted restart behavior.
- Complete the real-dump runbook in section 7.3.

### D. Shared client flow

- Implement the host-screen capability, account page, shared form and plugin actions.
- Verify UTC/non-UTC zones, DST gaps/folds, unchanged timestamp precision and a device timezone
  change after creation.
- Browser acceptance must cover Media and Fitness entry points, entity-scoped create/edit/cancel,
  account list, Needs scheduling replacement, transport/stale-write behavior and outcome display.
- Verify the frame is inert during the host screen, only one host screen can open, Back closes the
  correct surface, and document replacement suppresses stale replies.

### E. Crash/restart acceptance and closeout

- Reuse `e2e/src/fixtures/kernel/notifications.ts`, hermetic HTTP support and isolated API-server
  fixtures. Add reminder fixtures under the kernel tree, deriving types from the HTTP contract.
- Test an accepted external request whose response is held while the API process is terminated.
  After restart, the request count remains one and the UI/API reports Unknown rather than resending.
- Test admission committed before dispatch, and partial multi-channel completion across restart.
- If a test-support operation is needed to trigger a scan, it must call the production owner through
  the existing admin-only harness. Never seed lifecycle state with raw row writes in e2e.
- Use Effect Layers/TestClock for application branches and real I/O with `it.live` for e2e. Do not add
  mocks, spies, fake timers, inflated timeouts or capacity changes to hide failures.

## 10. Validation commands and completion gate

Use root Turbo filters without passthrough arguments for non-e2e package checks/tests. Example for
the expected main package set; adjust only to the packages actually affected by the final changes:

```bash
bun turbo --filter=@ryot-app/contract --filter=@ryot-app/kernel-backend --filter=@ryot-app/kernel-client --filter=@ryot-app/plugin-client-contract --filter=@ryot-app/plugin-client-sdk --filter=@ryot-app/plugin-ui-sdk --filter=@ryot-app/ryotql-recipes --filter=@ryot-app/media-plugin --filter=@ryot-app/fitness-plugin --filter=@ryot-app/server --filter=@ryot-app/e2e check
bun turbo --filter=@ryot-app/contract --filter=@ryot-app/kernel-backend --filter=@ryot-app/kernel-client --filter=@ryot-app/plugin-client-contract --filter=@ryot-app/plugin-client-sdk --filter=@ryot-app/plugin-ui-sdk --filter=@ryot-app/ryotql-recipes --filter=@ryot-app/media-plugin --filter=@ryot-app/fitness-plugin test
```

Checks must pass before affected tests. Include backend SDK/sandbox/compiler packages if their
contracts or runtime surfaces change. Do not force reruns or clear/disable caches.

Run only selected e2e files, separately as the e2e README requires. New filenames can follow:

```bash
bun turbo --filter=@ryot-app/e2e test --only -- 'src/api/kernel/reminders/reminders.test.ts'
bun turbo --filter=@ryot-app/e2e test --only -- 'src/api/kernel/reminders/recovery.test.ts'
bun turbo --filter=@ryot-app/e2e test --only -- 'src/browser/entity-reminders.test.ts'
```

Also select existing affected notification-channel, subscription, account-retirement, backup and
entity-user-data suites from the current tree. Never run the full e2e suite. Build the affected shipped
client artifacts and docs through their canonical tooling.

After implementation and affected checks/tests, perform one read-only review, address findings and
execute `.agents/skills/codebase-cleanup` in the main implementation session. Run repository-wide
validation only at the end, in this order:

```bash
bun run check
bun turbo --filter='!@ryot-app/e2e' test
```

Close Order 12 only when all of the following are recorded:

- [ ] Shared notification owner is used by every existing send entrypoint.
- [ ] Reminder commands, read recipes, host UI and Media/Fitness entry points work together.
- [ ] Crash/retry deduplication, uncertain outcomes and account retirement pass acceptance.
- [ ] Clear/merge/delete, child scope, graph collection and retention are covered.
- [ ] Backup restore and V1 conversion leave unfinished historical reminders inactive.
- [ ] Real normal/larger dump validation, source comparisons and restart checks are complete.
- [ ] Maintained docs and feature READMEs describe the shipped behavior.
- [ ] Affected checks/tests, selected e2e and final repository checks/tests pass.
- [ ] Review fixes and scoped cleanup are complete.
- [ ] `docs/v1-v2-port-gap-analysis.md` contains the accepted behavior, actual validation results and
  remaining limitations, with Order 12 marked Done only at that point.

Report genuine blockers or uncovered acceptance cases. Do not claim live delivery-provider testing
from hermetic adapter tests, or migration acceptance from zero-source-data samples alone.
