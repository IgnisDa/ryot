# Automation Lifecycle Implementation Plan

## Purpose

Replace the current automation occurrence, subscription run, signal, mutable plugin package, and exceptional lifecycle paths with one kernel-owned lifecycle system. Plugins continue to own schemas, hook declarations, and sandbox code. The kernel owns all persistence, transaction boundaries, revision pinning, execution, retry, causation, authorization, retention, and history.

This is an executable implementation plan, not a PRD. A fresh agent should execute it from top to bottom without reopening the architecture decisions below. The repository is greenfield, so remove replaced contracts and tables instead of adding compatibility adapters. The shipped V10 Rust migration remains supported as explicitly described in this plan.

## Required Reading

Before editing, read:

- Repository and package `AGENTS.md` files that apply to each changed path.
- `kernel/backend/src/modules/automations/README.md`.
- `kernel/backend/src/lib/infrastructure/sandbox-runtime/README.md`.
- `kernel/backend/src/modules/plugins/AGENTS.md`.
- `migrations/v10-rust/README.md` and `migrations/v10-rust/AGENTS.md`.
- `e2e/README.md` and `e2e/AGENTS.md` before changing the E2E harness.
- `packages/contract/AGENTS.md` before changing HTTP contracts.

Do not commit, amend, or push unless the user explicitly requests it.

## Fixed Decisions

- Plugins never own database tables or direct persistence.
- Plugins persist only through kernel sandbox host functions.
- Plugin identity is stable; plugin package revisions are immutable.
- Plugin hook definitions live only in immutable plugin manifests. There is no persisted automation-rule definition table.
- Every successful runtime entity, event, relationship, and signal mutation appends its lifecycle trigger and matching runs in the same PostgreSQL transaction.
- API, bootstrap, import, integration, provider, and sandbox writes use the same owning service path and lifecycle behavior.
- Historical V10 migration writes do not create triggers or runs.
- Hook matching and script/configuration pinning use the plugin and installation state active when the trigger transaction commits, not worker-time state.
- Existing accepted runs finish after plugin disable or uninstall.
- Failed runs remain manually retryable for a bounded configurable window.
- Pre-write policies are pure. They may read, allow, reject, or transform, but may not mutate state, make HTTP calls, emit signals, send notifications, write caches, or claim persistent values.
- Pre-write request triggers and post-write change triggers are separate immutable records linked by causation.
- Pure policy executions and post-write hooks share one user-visible run history.
- Post-write hooks are concurrent and independent. Dependent work belongs in one script or plugin workflow.
- Post-write hooks can be `required` or `async`.
- A failed required hook does not roll back committed source data. The API succeeds with a structured warning containing the hook slug and run ID.
- Hook retry policy is manifest-owned. The kernel classifies retryable infrastructure failures.
- Hooks with externally non-idempotent capabilities opt into automatic retries only when they support an idempotency key.
- One logical run has separate immutable attempt rows.
- Recursive chains carry parentage, depth, and a shared run budget. The kernel enforces configurable depth and run limits.
- Signals become typed automation triggers. Remove the separate `signal` table and duplicate occurrence snapshot.
- Notification subscriptions remain user configuration and are included in account backup/restore.
- Automation triggers, recipients, runs, attempts, retry state, history artifacts, and encryption keys are not included in account backups.
- Automation history uses configurable bounded retention.
- Configuration snapshots use one dedicated 32-byte encryption key generated once and stored in the PostgreSQL singleton `plugin_config_encryption_key` table. All nodes sharing the database use this key. Do not use `SERVER_ADMIN_ACCESS_TOKEN` as an encryption key.
- Replace `AutomationOrigin` with structured causation.
- Keep `AppSchema.normalize` as narrow numeric canonicalization. Do not move numeric rounding into sandbox hooks.
- The current library-membership policy and provider-import automation become one media-owned post-write hook executed by the common kernel runner.
- Use the existing Effect workflow engine for durable execution. Do not introduce a second general-purpose job queue.

## Current Problems To Remove

The implementation must remove these inconsistencies rather than preserve them:

- `automation_occurrence`, `subscription_run`, and `signal` represent overlapping execution inputs and incomplete history.
- Subscription hooks create occurrence and run rows, event policies create neither, and provider-import hooks create occurrences but no runs.
- Event policies execute with a synthetic subscription subject and run ID that has no database row.
- `library-membership-policy.sandbox.ts` mutates relationships before an event write and always returns `allow`.
- Direct `POST /entities` cannot invoke that event policy, while provider imports invoke a separate library-membership script.
- Lifecycle dispatch usually occurs after the source transaction, leaving committed-data-without-trigger crash windows.
- Entity and relationship API occurrence IDs can be random while event, signal, and provider paths are mostly deterministic.
- Entity/event update and delete coverage is incomplete.
- Sandbox relationship writes bypass relationship lifecycle automation.
- Signal dispatch deduplicates by rule ID alone and can discard additional recipient executions.
- Automation-emitted signals copy the original origin and lose direct automation causality.
- Provider-import hooks overwrite supplied import/integration attribution.
- `subscription_run.sandbox_script_id` does not protect old code from plugin garbage collection and does not make old code executable after an upgrade.
- Plugin upgrades overwrite manifest, source hash, compiled hash map, and source files on the stable plugin row.
- Plugin configuration is mutable, so code pinning alone is not reproducible.
- Scripts query their own invocation back through execution-only RyotQL tables even though the dispatcher already has the immutable input.
- There is no general recursion budget, complete automation history API, or retention policy.

## Target Data Model

Use Effect Schema-derived types for persisted JSON and boundary payloads. Keep Drizzle types, schemas, runtime decoders, and migration SQL aligned.

### `plugin`

Keep stable plugin identity and mutable activation state only:

```text
plugin
- id
- slug
- scope: system | user
- owner_user_id: nullable
- active_revision_id
- status
- created_at
```

Preserve the existing system-slug and owner-slug uniqueness rules. An upgrade inserts a revision and changes `active_revision_id`; it never rewrites historical package data.

### `plugin_revision`

Add immutable package revisions:

```text
plugin_revision
- id
- plugin_id
- version
- source_hash
- manifest jsonb
- created_at
```

Add a unique constraint on `(plugin_id, source_hash)`. Reject attempts to mutate a revision. Resolve effective definitions and executable declarations from active revisions.

### `plugin_revision_source_file`

Replace `plugin_source_file` ownership by mutable plugin ID:

```text
plugin_revision_source_file
- plugin_revision_id
- path
- contents
```

Use `(plugin_revision_id, path)` as the primary key. Retain source files while a revision is active or within an execution retry window. They may be pruned later without deleting compact revision attribution.

### `sandbox_script`

Change plugin script ownership to immutable revision ownership:

```text
sandbox_script
- id
- plugin_revision_id: nullable for kernel scripts
- provider_id: nullable
- slug
- name
- source
- content_hash
- compiled_code
- compiled_format
- metadata jsonb
- created_at
```

Use unique `(plugin_revision_id, slug, content_hash)` for plugin scripts and retain the existing kernel-script uniqueness rule. A run references this exact row. `getScriptPin` must accept an explicitly pinned script regardless of the plugin's current active revision, provided its retained revision, ownership, and configuration references are valid.

Do not copy compiled code into automation runs.

### `plugin_installation`

Keep stable installation identity and current state:

```text
plugin_installation
- id
- user_id
- plugin_id
- active_config_revision_id
- health
- health_reason
- is_disabled
- uninstalled_at: nullable
- sort_order
- home_saved_view_id
- created_at
- updated_at
```

Remove mutable inline `config` after the revision cutover. Disablement affects new planning only. Queued and running work continues from pinned revisions.

Uninstall is a state transition, not immediate physical deletion. Set `uninstalled_at`, exclude the installation from new resolution, and retain it while queued, running, or retryable runs need it. After the retry window, the installation tombstone may be deleted and `plugin_config_revision.plugin_installation_id` uses `ON DELETE SET NULL`; immutable `owner_user_id` preserves ownership. Retain compact private plugin, plugin revision, and config revision tombstones through the complete automation history period because run foreign keys remain non-null. Delete those identities only after their historical runs expire. User deletion still removes the tombstones and user-owned execution history.

### `plugin_environment_config_state`

Add one authoritative environment-config pointer for each system plugin:

```text
plugin_environment_config_state
- id
- plugin_id
- active_config_revision_id
- updated_at
```

Use a unique constraint on `plugin_id`. At server boot, resolve and validate environment configuration, then create/reuse its immutable revision and update this pointer under a plugin-scoped transaction lock. All server nodes must resolve the same fingerprint; startup fails on disagreement instead of allowing nodes to switch active configuration back and forth. Lifecycle planning reads this pointer at T1.

### `plugin_config_encryption_key`

Store one generated 32-byte encryption key in a PostgreSQL singleton table. Initialize it
exactly once transactionally so all nodes sharing the database use the same key. If the key
is missing while retained encrypted configuration exists, startup must fail rather than
silently generating a replacement.

### `plugin_config_revision`

Add immutable validated configuration snapshots:

```text
plugin_config_revision
- id
- plugin_revision_id
- plugin_installation_id: nullable for system environment configuration
- owner_user_id: nullable and immutable
- scope: environment | installation
- encrypted_payload: nullable after pruning
- payload_fingerprint
- nonce
- created_at
- payload_pruned_at: nullable
```

Encrypt the complete validated configuration with authenticated encryption such as AES-256-GCM using the dedicated database key. Store nonce, authentication data required by the selected primitive, and ciphertext. Derive a separate keyed fingerprint subkey with domain separation so matching plaintext configurations can reuse a revision without exposing a raw plaintext hash.

Initialize the database key once transactionally; no manual environment or Helm key setting, extra deployment mount or Secret for this key, or key rotation API is required. Startup must fail with a clear error when encrypted rows require an unavailable key. Do not print keys, plaintext secrets, ciphertext, or complete decrypted configuration.

Installation config updates create a revision validated against the selected plugin revision and atomically update `active_config_revision_id`. Environment state uses `plugin_environment_config_state`. API reads decrypt through the config service and redact AppSchema fields marked `secret`.

Coordinate package and configuration activation explicitly:

- Persist the new immutable plugin revision before activation.
- For a system revision, validate environment configuration and create/reuse its config revision before switching `plugin.active_revision_id` and `plugin_environment_config_state.active_config_revision_id` in one transaction.
- For a private revision, decrypt and validate the installation's current configuration against the new revision. Create the replacement config revision and switch both package and config pointers in one transaction when valid.
- If private configuration is incompatible, activate the package revision, mark the installation `needs-configuration`, and prevent planning until a matching config revision is active.
- The planner requires `plugin_config_revision.plugin_revision_id` to equal the selected plugin revision.
- System activation fails rather than publishing a package revision whose environment configuration is invalid.

### Manifest hooks

Replace the current `eventAutomations`, `entityAutomations`, `relationshipAutomations`, `signalAutomations`, and `providerEntityImportAutomations` arrays with one explicit hook contract. Keep the schema concrete rather than building a generic rule language.

Each hook declares:

```text
- slug: stable authored hook identity within the plugin
- name
- script_slug
- stage: before | after
- targets: non-empty array of supported resource/operation/schema matchers
- position: before hooks only, default 1000
- delivery: required | async for after hooks
- retry policy
- optional causation-source filter
- optional metadata
- optional event batch frequency: item | once-per-subject
```

Initial target resource kinds are `entity`, `event`, `relationship`, `provider-entity-import`, and `signal`. Initial operations are `create`, `update`, `delete`, `complete`, and `emit`, constrained by resource kind. Keep provider-import completion as a domain fact because importing an already-existing global entity can still require user-scoped behavior.

Manifest validation must enforce:

- Hook slugs are unique within one plugin revision.
- Referenced scripts exist, are active in that revision, and have automation kind.
- Before hooks use policy definitions and only policy-safe capabilities.
- After hooks use automation definitions.
- `position` is valid only for before hooks.
- `delivery` is valid only for after hooks.
- Automatic external retry requires an explicit idempotency declaration when the script has externally non-idempotent capabilities such as `httpCall`.
- Every referenced schema target belongs to the effective declared schema surface.
- Notification signal schemas reference a stable notification hook slug, not a script slug.
- `once-per-subject` is valid only for before-event hooks. Preserve current batch behavior by running it on the first eligible item for each deterministic subject key in one event-create batch.

Stable runtime hook identity is `(plugin_id, hook_slug)`. Do not include target, script slug, position, or manifest array index in identity.

### `automation_trigger`

Replace `automation_occurrence` and `signal` with one immutable trigger table:

```text
automation_trigger
- id
- category: request | change | signal
- resource_kind: entity | event | relationship | provider-entity-import | signal
- operation: create | update | delete | complete | emit
- scope_user_id: nullable
- payload jsonb: nullable after retention pruning
- initiator_kind: user | integration | system
- initiator_id: nullable
- source: api | import | integration | bootstrap | provider-refresh | automation
- execution_id
- root_execution_id
- parent_trigger_id: nullable
- parent_run_id: nullable
- integration_id: nullable
- import_run_id: nullable
- provider_execution_id: nullable
- depth
- blocked_reason jsonb: nullable
- occurred_at
- created_at
- payload_pruned_at: nullable
```

Define strict Effect Schema unions for payloads. Request payloads contain the validated proposed draft. Change payloads retain immutable before/after snapshots appropriate to create, update, or delete. Provider-import completion contains entity ID/schema, provider ID, external ID, and user scope. Signal payloads contain signal schema, properties, actor, and optional subject.

Use deterministic trigger IDs derived from the owning command/workflow execution ID, item identity, resource kind, operation, and stable discriminator. Never generate a second trigger for an idempotent replay of the same logical mutation. Reusing an ID with different content fails.

Persist every trigger for the named lifecycle resources even when no hook matches. This invariant applies to runtime entity, event, relationship, provider-import completion, and signal operations. It does not add lifecycle semantics to unrelated tables such as uploads, saved views, plugin configuration, or import-run bookkeeping. Bounded retention controls volume.

### `automation_trigger_recipient`

Replace `signal_recipient`:

```text
automation_trigger_recipient
- trigger_id
- user_id
```

Use `(trigger_id, user_id)` as the primary key. Recipient resolution occurs in the signal transaction. One signal trigger may produce one run per `(hook, execution_user_id)` without duplicating its payload.

### `automation_run`

Replace `subscription_run` with one logical execution model:

```text
automation_run
- id
- trigger_id
- execution_user_id: nullable
- plugin_id
- plugin_revision_id
- plugin_config_revision_id
- sandbox_script_id: nullable after artifact pruning
- hook_slug
- hook_name
- script_slug
- script_content_hash
- stage: before | after
- delivery: policy | required | async
- retry_policy jsonb
- status: queued | running | succeeded | failed | rejected | skipped
- skip_reason jsonb: nullable
- attempt_count
- next_attempt_at: nullable
- queued_at
- started_at: nullable
- finished_at: nullable
- artifacts_expire_at
```

Derive run ID from `(trigger_id, plugin_id, hook_slug, execution_user_id-or-system)`. Insert with conflict verification: identical replay is accepted; conflicting data fails. Snapshot the small attribution fields needed after executable artifacts are pruned.

Use foreign keys that retain plugin revision, config revision, and script artifacts while a run is queued, running, or retryable. After retention cleanup, allow large executable/config artifacts to be pruned while compact identity fields remain on the run.

### `automation_run_attempt`

Add immutable execution attempts:

```text
automation_run_attempt
- id
- run_id
- attempt_number
- workflow_execution_id
- status: running | succeeded | failed
- failure_kind: nullable
- retryable
- logs jsonb: nullable
- returned_value jsonb: nullable
- error jsonb: nullable
- timing jsonb: nullable
- started_at
- finished_at: nullable
- artifacts_pruned_at: nullable
```

Use unique `(run_id, attempt_number)`. Derive attempt and workflow IDs from run ID plus attempt number. Serialize attempt creation so only one attempt is active. Keep the existing bounded artifact truncation behavior, but rename it for automation attempts.

Workflow replay of one attempt is infrastructure behavior and must not create another product attempt. Automatic or manual retry creates the next attempt.

### `notification_subscription`

Keep this table as user configuration. It is not a persisted executable rule definition. Continue to back it up and restore it. Resolve its signal schema and notification hook from the plugin revision active when the signal trigger commits, then create a normal pinned run.

Renaming this table and API vocabulary to `notification_preference` is optional and is not required for this refactor. Prefer no rename unless it materially simplifies changed code.

## Causation Contract

Delete `AutomationOrigin`. Define a strict causation schema that separates:

- Initiator: user, integration, or system identity.
- Source mechanism: API, import, integration, bootstrap, provider refresh, or automation.
- Root execution ID.
- Immediate parent trigger and run.
- Optional integration, import run, and provider execution attribution.
- Current chain depth.

When a sandbox run writes through a host function, derive child causation from the trusted execution principal. Do not accept plugin-supplied parent IDs. Preserve the original initiator and root execution, set source to `automation`, set the current run as parent, and increment depth.

Move existing plugin checks based on origin into manifest causation filters when possible. Scripts may receive causation for audit and exceptional behavior, but common dispatch filtering belongs in the manifest.

## Lifecycle Planning And Transactions

### Dependency direction

Domain modules must not import a higher-level concrete automation implementation. Define a small lifecycle planning persistence port at the generic domain boundary and implement it in the automations module through layer wiring. The port supports only trigger/run planning inside the caller's active database transaction and returns planned run IDs. Post-commit workflow submission remains an upward durable effect through layer wiring.

This transaction-scoped persistence port is an approved exception to the existing `DurableQueue` inversion wording in `kernel/backend/AGENTS.md`: asynchronous execution still uses the Effect workflow engine, but the trigger and run outbox records must share the source transaction. Update that stable repository guidance as part of the cutover so future agents do not move planning back outside the transaction.

Do not start workflows, perform network I/O, or execute sandboxes inside the transaction.

### Change flow

For every successful runtime entity, event, relationship, provider-import completion, or signal operation:

1. The owning service validates the request and causation.
2. The service opens the transaction.
3. The owning repository writes the domain row.
4. The service constructs exact before/after snapshots from persisted values.
5. The lifecycle planner inserts the immutable trigger using the active transaction.
6. The planner resolves matching active hooks at that instant.
7. The planner resolves the already-active encrypted config revision and verifies that it belongs to the selected plugin revision. Config revision creation and pointer activation occur only in plugin ingestion, installation configuration, or environment configuration flows; an unrelated domain write must not activate configuration.
8. The planner enforces depth and chain run budget.
9. The planner inserts deterministic queued runs with pinned plugin revision, config revision, and script.
10. The transaction commits.
11. The caller starts required runs and awaits their terminal outcomes.
12. The caller starts async runs with `discard: true`.
13. The reconciliation path starts any committed queued runs missed between commit and workflow submission.
14. Required failures become structured warnings; the domain result remains successful.

Queued run rows are the transactional outbox. Continue using Effect `WorkflowEngine` for execution. Add only a focused automation-run reconciler that submits deterministic workflows for stranded queued rows; do not create a general queue framework or duplicate workflow state in a new queue product.

Use row locking and compare-and-set status transitions. Durable ownership does not guarantee single-flight execution, so all kernel host writes remain idempotent by logical run ID and host-call discriminator.

### Request policy flow

For a write with before hooks:

1. Validate the incoming shape enough to resolve scope and target.
2. Create a request trigger in a short transaction.
3. Resolve and insert pinned policy runs in that transaction.
4. Execute policy runs sequentially by `(position, plugin_id, hook_slug)`.
5. Feed each transformed draft into the next policy.
6. Revalidate the final draft with the target AppSchema.
7. On rejection, mark the rejecting run `rejected`, retain policy history, and do not write the domain row or create a change trigger.
8. On acceptance, perform the normal domain mutation transaction and create a separate change trigger linked to the request trigger.

Policy execution capabilities must be selected by stage, not by pretending the subject is a subscription.

Before-policy runs do not use delayed automatic or manual retry because a later attempt must not silently apply a stale proposed mutation after the caller has returned. A retryable policy infrastructure failure records a failed attempt, marks the request run failed, creates no domain write, and returns a stable `policy-execution-failed` error containing the run ID. The caller may resubmit the command with a new command identity. Limited replay inside the same durable workflow attempt remains infrastructure replay, not a new product attempt. Manifest retry policy applies to after hooks only.

Run-budget planning is all-or-none per trigger. Resolve hooks in deterministic `(position, plugin_id, hook_slug, execution_user_id)` order before inserting any run. If all matching runs do not fit the remaining root budget, insert none of them, mark the trigger blocked, and store bounded omitted identities as `{ pluginId, hookSlug }` pairs. A blocked request-policy trigger rejects the proposed write with a stable automation-limit error; policy checks must never be silently skipped. A blocked post-write trigger leaves the committed source mutation successful and produces a structured warning when it had required hooks.

### Required warning contract

Add a reusable client-safe warning schema in `packages/contract`:

```text
required hook warning:
- code: required-hook-failed | required-hook-pending
- hook_slug
- run_id

planning-limit warning:
- code: automation-limit-reached
- trigger_id
- omitted_hooks: bounded plugin ID and hook slug pairs
```

Mutation responses that can await required hooks must expose warnings alongside their existing result. Change affected contracts directly; do not preserve old response mirrors in this greenfield codebase. Keep warning codes stable and do not expose sandbox errors or logs in mutation responses.

After commit, submit all required hooks concurrently and await them with all-settled semantics through one immediate attempt only. Do not hold the HTTP request through retry backoff. Bound waiting by the existing sandbox execution timeout plus small fixed workflow handoff overhead; do not add another user configuration knob. Return `required-hook-failed` when the immediate attempt is terminally failed or scheduled for retry, `required-hook-pending` when workflow submission or bounded waiting does not reach a terminal attempt, and `automation-limit-reached` when required planning was blocked. The reconciler still submits committed pending work. Async-hook failures never alter the mutation response.

## Retry And Attempt Semantics

Define a small manifest retry schema with finite values, for example maximum attempts and bounded exponential delays. Choose conservative defaults in code and document them. Do not add arbitrary expression-based retry rules.

The kernel failure taxonomy must distinguish at least:

- Timeout or transient sandbox infrastructure failure: retryable.
- Temporary resource/admission failure: retryable.
- Invalid input/output schema: terminal.
- Missing retained revision/config/script: terminal operational error.
- Script-returned business failure: terminal.
- External HTTP uncertain outcome: terminal unless the hook opted into external-idempotent retry.

Pass the logical run ID and stable host-call discriminator to kernel writes so repeated attempts converge. Expose the logical run ID to sandbox code as the external idempotency key. Do not claim exactly-once delivery to external systems.

Manual retry authorization requires ownership of the run or god-mode access. It creates the next attempt on the same pinned run and is allowed only before `artifacts_expire_at` and while required key material remains available. It does not require the plugin to remain active.

## Recursion Limits

Add bounded server configuration for maximum automation depth and maximum runs in one root causal chain. Keep defaults finite and conservative.

Use `root_execution_id`, `parent_run_id`, and `depth`. During run insertion, serialize planning for one root execution with a PostgreSQL advisory transaction lock or an equally small database-owned lock. Count accepted runs for the root under that lock. Do not add a separate causal-chain table initially.

When a limit is exceeded:

- Retain the trigger.
- Set a stable `blocked_reason` on the trigger.
- Do not create hidden partial fan-out beyond the accepted budget.
- Emit bounded logs/metrics.
- Surface blocked descendants in history without executing them.

## Retention And Deletion

Add two bounded server settings rather than many knobs:

- Automation retry window.
- Automation history retention.

Use the retry window for executable scripts, encrypted config payloads, and manual retry eligibility. Use history retention for trigger payloads and attempt artifacts. After artifact expiry:

- Null or prune trigger payloads and set `payload_pruned_at` while retaining trigger identity and causation summary until summary retention expires.
- Null attempt logs, errors, and returned values and set `artifacts_pruned_at` while retaining status and timing summary.
- Prune inactive script code, revision source files, and encrypted config payloads when no active or retryable work needs them, while retaining compact referenced identity rows through the history period.
- Keep compact run attribution through the configured history period.
- Delete expired compact history in bounded batches.

Implement cleanup through existing durable scheduling/workflow infrastructure. Do not place unbounded deletion in request paths.

User deletion must remove that user's private config revisions, private plugin revisions, runs, attempts, and recipient rows. For shared signal triggers, preserve the trigger and other recipients' runs. A run must never recreate user data after user deletion.

Plugin disable affects future planning. Plugin uninstall tombstones active installation state, while retained revisions and artifacts required by accepted runs survive until their retry window ends. Historical summaries remain inspectable after artifacts are pruned.

## Sandbox Contract

Change `AutomationInput` to carry the immutable invocation directly:

```text
automation
- trigger_id
- run_id
- hook_slug
- causation
- occurred_at
- resource
- operation
- source payload
- hook metadata
```

Do not make scripts query their trigger or run metadata back through RyotQL. Remove execution-only `automationOccurrence` and `subscriptionRun` catalog tables and remove `automationOccurrenceRecipe` and `automationRunRecipe` after all scripts migrate.

Keep ordinary user-data RyotQL access scoped by the trusted principal. The principal must include pinned plugin revision and config revision identities. `getPluginConfig` decrypts only the pinned config revision and still enforces script-declared keys. Never place decrypted configuration into workflow payloads, automation input, logs, run history, or returned API warnings.

Split sandbox capability selection by execution stage:

- Before policy: read-only policy-safe capabilities.
- After user run: user-scoped read/write capabilities declared by the script.
- After system run: existing system restrictions plus trusted automation scope.

Remove the synthetic subscription subject used for policies. Replace subscription-specific trusted context with an automation-run subject that carries run, trigger, execution user, causation, and pinned revision data. Notification authorization should require a user-scoped automation run and the declared notification capability, not a legacy `subscription` label.

## Domain Write Cutover

Move lifecycle creation into owning services and remove caller-owned manual dispatch.

### Entities

Update entity create, update, and delete paths to:

- Require or derive deterministic command identity.
- Capture persisted before/after snapshots.
- Insert triggers and runs in the same transaction.
- Return required-hook warnings.

Ensure API, bootstrap, provider population, import, and sandbox paths call these service methods. Remove random occurrence IDs and dispatch in callers.

### Events

Retain event creation workflow ownership. Replace the current policy engine with request-trigger policy runs. Write each accepted event and its change trigger/runs atomically. Add update/delete lifecycle handling if those operations remain public.

Keep `AppSchema.normalize` in parsing. Apply policy transforms before final AppSchema validation as specified above.

### Relationships

Move API route dispatch into `RelationshipsService`. Ensure create, idempotent upsert/update, and delete all produce correct snapshots and triggers. Route `changeUserRelationships` through the same methods so plugin-created relationships emit child lifecycle facts. Avoid recursively emitting a change when an idempotent upsert changes nothing.

### Provider population and import completion

Replace provider workflow manual lifecycle dispatch with normal entity/relationship services. Preserve deterministic execution/item identities for every population phase. Keep provider-import completion as one explicit user-scoped domain trigger and plan its hooks through the common mechanism. Remove direct sandbox execution in `provider-entities/operations-workflow.ts`.

### Signals

Change signal emission to insert one `automation_trigger` with category `signal`, resolve recipients, insert recipient rows, and plan one run per applicable recipient in the same transaction. Remove `SignalDispatch` and separate signal occurrence recording. Ensure actor/recipient overlap is deduplicated by user while runs are unique by both hook and execution user.

## Integration Cutover

Keep `import_run` as the canonical yank/sink/import execution record. Do not merge integration execution into automation runs.

Propagate structured causation through:

```text
integration execution
-> import run
-> provider population execution
-> request/change/signal trigger
-> automation run
-> child kernel write or external push
```

Update integration-created entity/event/relationship commands to include integration ID, import run ID, root execution ID, and deterministic item identity. Fix provider population execution IDs that currently collapse distinct causes for the same entity.

Move source-specific progress debounce/admission out of `integration-progress-policy.sandbox.ts` because a pure policy cannot call `claimPersistentValue`. Put this behavior in the media integration import pipeline that produces progress events. Reuse existing persistent claims there; do not add a generic stateful-policy exception or a new kernel rule engine. Include integration/import identity in claim keys where needed for diagnosis and collision safety.

Keep Radarr, Sonarr, Jellyfin, and similar push scripts as post-write automation hooks. Their manifest retry policy must not automatically retry uncertain external outcomes unless the specific integration supports and sends the run idempotency key.

Preserve integration disablement and `integration.disabled` behavior, but represent downstream notification work through normal signal triggers and automation runs.

## First-Party Plugin Changes

### Media

Replace both library membership implementations:

- `plugins/media/backend/automations/library-membership-policy.sandbox.ts`
- `plugins/media/backend/automations/media-library-membership-on-import.sandbox.ts` or its current equivalent

with one idempotent after hook whose stable slug is `media.ensure-library-membership`.

Bind it to:

- Eligible user-scoped entity creation.
- Eligible provider-entity-import completion for a user.

Do not bind it to every media event. The hook upserts `in-library` through the normal relationship service host function, which emits a child relationship trigger only when state changes.

Convert all media bindings to explicit stable hook slugs and stages. Move origin checks into causation filters where possible. Update all scripts to consume inline trigger payload and hook metadata instead of `automationOccurrenceRecipe` or `automationRunRecipe`.

Move integration progress claim logic into integration production as described above. Keep episodic session behavior as a pure before-event policy. Review every current policy capability and fail manifest validation if it is not policy-safe.

### Fitness and kernel notification

Convert fitness entity and notification automations and the kernel notification script to authored hooks. Update them to consume inline signal/entity payloads. Keep notification message vocabulary plugin-owned.

### Plugin authoring documentation

Update `packages/plugin-kit` documentation and manifest examples to explain:

- Stable hook slugs.
- Before versus after semantics.
- Required versus async delivery.
- Retry and external idempotency declarations.
- Causation filters.
- Inline automation input.
- No plugin-owned persistence.
- Numeric AppSchema normalization remains schema behavior.

## User-Facing History And APIs

Add authenticated automation history operations to `packages/contract/src/modules/automations/contract.ts` and the backend routes/service:

- List runs for the authenticated user with cursor pagination and bounded filters.
- Get one owned run with compact trigger summary and attempts.
- Retry one eligible failed run.

Do not expose encrypted configuration, raw script code, arbitrary trigger payloads belonging to other users, or unbounded logs. Expose retained payload/log detail only for owned runs and only while retained. Redact sensitive fields where schemas identify them.

Add a kernel client history surface using existing settings/navigation patterns. It must show status, hook/plugin name, source resource, time, attempts, retained errors/logs, and retry eligibility. Keep frontend work within the existing design system; do not build a new generic workflow console.

Notification subscription catalog/install/activate/deactivate/delete APIs remain. Update naming only where required by hook identity changes.

## Backup And Restore

Keep notification subscriptions in archive export/restore. Preserve current omission of reproducible active defaults.

Explicitly exclude:

- Automation triggers and recipients.
- Automation runs and attempts.
- Logs, errors, returned values, and retry state.
- Historical plugin environment config revisions.
- Encryption key material.

Full PostgreSQL backups include the `plugin_config_encryption_key` row and encrypted
configuration rows. Account exports exclude the key and historical configuration revisions.

Do not add automation history archive sections. Restore and export operations must not create runtime lifecycle triggers for historical rows. Add tests that assert absence rather than silently relying on omission.

Backup restore is an explicit historical-write boundary, like V10. Its restore writer may use repository-level persistence without runtime lifecycle planning. Keep that bypass inside the backup restore module, document it in backend architecture checks and guidance, and prohibit ordinary API, import, integration, provider, bootstrap, and sandbox callers from using it.

For user-owned plugin package/config backup behavior, preserve the current product contract. Export only the current portable plugin/config state through existing secure/redacted rules; do not export revision history or ciphertext tied to server keys. Restore creates fresh revisions encrypted by the destination server's dedicated database key.

## V10 Rust Migration

The V10 migration reconstructs historical state and must create zero automation triggers, runs, attempts, or notifications for migrated rows.

Required changes:

- Resolve the active `plugin_revision` for current media and fitness packages instead of reading mutable manifest/hash fields from `plugin`.
- Resolve providers and scripts through stable plugin ID plus active revision and local slug.
- Create deterministic installation and active configuration revision state required by the new schema.
- Keep plugin user-bootstrap dispatch disabled during migrated user bootstrap.
- Keep direct historical SQL writes outside runtime lifecycle services.
- Preserve all existing omissions, warnings, restart guards, migration reports, and deterministic identity checks.
- Do not replay current hooks over migrated seen events, reviews, collections, entities, or relationships.
- Replace any migration assumptions about `plugin.config`, mutable source files, or current compiled hash maps.
- Keep notification preference migration and defaults, adapted to notification hook identity.
- Update `migrations/v10-rust/README.md` to state that historical lifecycle and automation history are intentionally omitted.

Follow the real validation runbook with restored legacy dumps. Per `migrations/v10-rust/AGENTS.md`, do not add a synthetic normal E2E test that bypasses startup migration behavior.

## Implementation Phases

Use additive compile-safe staging only where the dependency graph requires it. Phases 1 and 2 must leave their changed packages type-safe. Phases 3 through 7 are one coordinated runtime cutover: their subphases may temporarily retain old symbols or fail the branch-wide build, but complete the whole cutover and remove temporary staging before claiming that checkpoint. Never dual-write old and new execution records, never ship both systems, and do not add public compatibility adapters.

### Phase 1: Shared schemas and manifest contract

1. Add brands and Effect Schemas for plugin revisions, config revisions, triggers, runs, attempts, causation, warnings, retry policy, and hook declarations.
2. Replace manifest automation binding arrays with explicit hooks.
3. Replace signal notification script references with hook references.
4. Update manifest policy validation and contract tests.
5. Update sandbox automation input/output definitions.
6. Keep `AppSchema.normalize` unchanged.

Primary paths:

- `packages/contract/src/modules/automations/`
- `packages/contract/src/modules/plugins/manifest.ts`
- `packages/contract/src/modules/plugins/manifest.test.ts`
- `packages/contract/src/schema/brands.ts`
- `packages/sandbox-sdk/src/automation.ts`
- `packages/sandbox-sdk/src/core.ts`
- `packages/plugin-kit/`

### Phase 2: Immutable plugin and config revisions

1. Add revision/config/environment-state tables and change script/source ownership.
2. Add dedicated database-key initialization, authenticated encryption service, key derivation domains, and tests.
3. Refactor plugin ingestion to insert/reuse immutable revisions and coordinate package/config pointer activation transactionally.
4. Refactor installation and environment config updates to create immutable encrypted revisions.
5. Refactor effective definitions, providers, workflows, crons, boot scripts, and sandbox pin resolution to use revisions.
6. Adapt script garbage collection and uninstall guards to retained revision references.
7. Update private/system plugin fixture and repository tests.
8. Update maintained deployment documentation for database key storage and recovery; do not add a deployment key setting.

Primary paths:

- `kernel/backend/src/lib/infrastructure/db/schema/tables/core.ts`
- `kernel/backend/src/lib/infrastructure/config/`
- `kernel/backend/src/modules/plugins/`
- `kernel/backend/src/modules/sandbox/`
- `kernel/backend/src/lib/infrastructure/sandbox-runtime/`
- `apps/docs/src/deployment.md`

Stop if the selected encryption primitive cannot support authenticated decryption with the dedicated database key without exposing plaintext, or if singleton-key initialization cannot be transactional across nodes. Resolve that before persisting config revisions.

### Phase 3: Trigger, run, and attempt persistence

1. Replace automation/signal tables in Drizzle source schema.
2. Generate the Drizzle migration through the package command; do not hand-edit generated snapshots.
3. Implement repositories with schema decoding, deterministic identity, conflict verification, row locks, and state transitions.
4. Add indexes for queued-run reconciliation, user history pagination, trigger causation, signal recipients, retention cleanup, and run attempts.
5. Add repository/schema tests for all constraints and cascades.

Recommended index shapes must cover:

- Queued runs by `(status, next_attempt_at, queued_at, id)`.
- User history by `(execution_user_id, queued_at desc, id desc)`.
- Runs by trigger.
- Attempts by `(run_id, attempt_number)`.
- Triggers by root execution and parent run.
- Signal recipients by user.
- Retention timestamps.

### Phase 4: Planner and durable execution

1. Implement transaction-scoped hook resolution and run planning.
2. Resolve active plugin/config revisions at trigger transaction time.
3. Implement deterministic run IDs and multi-recipient uniqueness.
4. Implement depth/run-budget enforcement under a root lock.
5. Replace subscription workflow with a generalized automation-run workflow.
6. Implement attempts, retry classification, schedules, terminal transitions, and manual retry.
7. Start required and async runs after commit.
8. Add focused reconciliation for stranded queued runs using deterministic workflow IDs.
9. Add retention cleanup through existing durable scheduling.
10. Add bounded metrics and trace attributes without IDs as metric labels.

Primary paths:

- `kernel/backend/src/modules/automations/`
- `kernel/backend/src/boot/layers.ts`
- `kernel/backend/src/boot/kernel-workflow-references.ts`
- `kernel/backend/src/lib/infrastructure/workflow.ts` only if layer wiring is required

Do not modify Effect workflow internals or attempt to share an application transaction with the cluster workflow message store.

### Phase 5: Sandbox principal and host contract

1. Add the automation-run subject and remove synthetic subscription semantics.
2. Thread pinned plugin/config revision IDs through trusted principals.
3. Pass full trigger input and hook metadata directly to scripts.
4. Resolve plugin config from the pinned encrypted revision.
5. Enforce policy-safe capability selection.
6. Derive child causation and host-call idempotency from trusted run context.
7. Keep execution-only automation RyotQL tables temporarily until Phase 7 consumers migrate; remove them at the coordinated runtime-cutover checkpoint.

### Phase 6: Owning service write paths

1. Cut entity create/update/delete over to atomic planning.
2. Cut event request policies and change writes over.
3. Cut relationship create/update/delete and sandbox batches over.
4. Cut provider population writes over.
5. Cut signal emission over and remove signal dispatch.
6. Remove caller-owned lifecycle dispatch and no-op layers.
7. Verify no runtime repository write bypasses its owning service without an explicitly documented V10, backup-restore, or test-support reason.

Use architecture checks or focused source tests to prevent route, sandbox, importer, provider, and bootstrap code from reintroducing direct lifecycle dispatch.

### Phase 7: Integrations and first-party plugins

1. Propagate causation through import/integration/provider workflows.
2. Move integration progress admission/claim logic out of policy execution.
3. Convert all first-party manifests and scripts to stable hooks and inline input.
4. Consolidate media library membership.
5. Convert notification handlers and external push hooks.
6. Remove direct provider-import automation execution.
7. Verify external retry declarations and idempotency behavior.

### Phase 8: HTTP history, warnings, and client

1. Add warning-bearing mutation responses.
2. Add authenticated run list/detail/retry APIs.
3. Decode run history from the authenticated HTTP contract in the client service. Do not expose automation persistence through authenticated RyotQL or recreate the removed execution-only RyotQL surface.
4. Add the kernel client history surface and retry action.
5. Update OpenAPI descriptions and API tests.

### Phase 9: Backup, user lifecycle, retention, and V10

1. Update backup/restore for current plugin/config state and notification subscriptions only.
2. Assert automation history exclusion and no restore-triggered execution.
3. Update user deletion/reset behavior and shared-recipient preservation.
4. Finish retention and inactive revision garbage collection.
5. Adapt V10 migration resolution and documentation.
6. Validate V10 with restored legacy dumps using its runbook.

### Phase 10: Delete the old system

Remove all old symbols, tables, code paths, tests, and documentation, including:

- `automation_occurrence`.
- `subscription_run`.
- `signal` and `signal_recipient`.
- `AutomationOrigin`.
- `LifecycleDispatch` caller-owned/manual dispatch.
- `SubscriptionExecutionWorkflow`.
- Legacy automation binding arrays and derived binding IDs.
- `automationOccurrence` and `subscriptionRun` RyotQL catalog entries.
- `automationOccurrenceRecipe` and `automationRunRecipe`.
- Direct provider-import hook loops.
- Synthetic subscription policy subjects.
- Mutable plugin manifest/source/hash storage on `plugin`.
- Mutable inline plugin installation config.
- Temporary migration adapters created during this work.

Run repository-wide searches for each removed concept. Do not leave deprecated aliases in this greenfield codebase.

## Focused Test Requirements

Follow repository testing rules: no mocks/spies/fake timers; inject deterministic layers and use `TestClock` where needed.

Add or update focused tests for:

- Manifest hook validation, stable identity, target compatibility, stage capabilities, and external retry declarations.
- Immutable plugin revision ingestion and active-pointer switching.
- Old revision execution after upgrade/disable/uninstall.
- Config encryption round trip, wrong/missing key, transactional singleton-key initialization, redaction, fingerprint reuse, and payload pruning.
- Trigger payload decoders for each category/resource/operation.
- Atomic trigger/run insertion with domain writes and rollback on planning failure.
- Idempotent replay and conflicting deterministic IDs.
- One signal run per recipient/hook pair.
- Policy order, transform chaining, revalidation, rejection, and capability denial.
- Before-policy infrastructure failure creates no mutation and cannot be retried later into a stale write.
- Required warning behavior and independent concurrent hooks.
- Run state transitions and one-active-attempt enforcement.
- Retry taxonomy, backoff with `TestClock`, exhaustion, and manual retry window.
- External retry opt-in validation.
- Causal parent derivation and prevention of plugin-supplied parent widening.
- Depth and shared run-budget enforcement under concurrent fan-out.
- Retention pruning and revision garbage-collection guards.
- User deletion with shared signal recipients.
- Backup exclusion and restore non-execution.
- Integration/import/provider causation retention.
- `AppSchema.normalize` remains numeric decoding behavior and client/server validation order stays aligned.

## E2E Plan

Read `e2e/README.md` before editing the harness. Keep generic lifecycle suites under `e2e/src/api/kernel/` and media behavior under `e2e/src/api/plugins/media/`.

### Fixture changes

Update `e2e/src/fixtures/kernel/automations.ts`:

- Replace signal/subscription-run-only helpers with admin-gated trigger, recipient, run, and attempt inspection.
- Add polling by trigger ID, root execution ID, hook slug, execution user, status, and source record.
- Poll runs and attempts separately.
- Keep notification subscription helpers as user configuration helpers.

Update plugin fixtures:

- `e2e/src/fixtures/kernel/test-plugin.ts` must return stable plugin ID plus immutable revision IDs, source hashes, script IDs, installation ID, and config revision IDs.
- Reinstall/update helpers return a new revision instead of mutating the fixture's current script identity in place.
- Preserve old revision handles so tests can assert pinning.
- Update private plugin, client plugin, sandbox provider, and integration-provider fixtures to authored hook slugs and revisions.

Update entity/event/relationship fixtures to preserve warning-bearing mutation results rather than hiding warnings.

### New generic suites

Add `e2e/src/api/kernel/automations/lifecycle-triggers.test.ts` covering:

- Request trigger before policy execution.
- Rejected policy creates no source row and no change trigger.
- Failed policy infrastructure returns `policy-execution-failed`, records its attempt, and never writes later through delayed retry.
- Accepted policy and transformed draft create the linked change trigger.
- Entity/event/relationship create, update, and delete carry exact snapshots.
- Trigger and matching runs exist atomically with the source write.
- Direct HTTP and contract-client writes behave identically.
- Required hook failure returns structured warning while source data remains committed.
- Independent post hooks both run when one fails.
- Async hooks do not delay mutation response.
- Deterministic replay does not duplicate trigger or run.

Add `e2e/src/api/kernel/automations/retries.test.ts` covering:

- Retryable failure creates numbered attempts and eventually succeeds.
- Terminal failure does not retry.
- Attempt limit exhaustion marks the run failed.
- Pinned plugin/config/script identity does not change across attempts.
- Manual retry works after upgrade/disable/uninstall within the retry window.
- Manual retry fails after artifact expiry.
- External HTTP hooks do not auto-retry without idempotency opt-in.

Add `e2e/src/api/kernel/automations/recursion-budget.test.ts` covering:

- Automation-created event/relationship/signal receives correct parent and depth.
- Maximum depth blocks descendants.
- Concurrent fan-out shares one root run budget.
- Blocked work is visible and does not execute.
- Replays do not consume the budget twice.

### Existing generic suites

Update:

- `e2e/src/api/kernel/entities/entities.test.ts` for direct `POST /entities`, provider-independent media creation parity, atomic triggers, warnings, and unchanged numeric normalization.
- `e2e/src/api/kernel/events/events.test.ts` for request/change trigger split and rejected outcomes.
- `e2e/src/api/kernel/relationships/relationships.test.ts` for insert/update/delete and sandbox-path parity.
- `e2e/src/api/kernel/automations/notification-subscriptions.test.ts` for notification preferences plus typed signal triggers, per-recipient runs, and attempts.
- `e2e/src/api/kernel/notifications/notification-channels.test.ts` for trigger-to-delivery history and zero-channel behavior.
- `e2e/src/api/kernel/plugins/plugins.test.ts` for revision A run executing revision A after revision B activates, disable/uninstall semantics, and retained retry.
- `e2e/src/api/kernel/plugins/private-plugins.test.ts` for immutable encrypted config revisions and secret non-exposure.
- `e2e/src/api/kernel/plugins/system-plugin-reconciliation.test.ts` for immutable system revision activation.
- `e2e/src/api/kernel/sandbox/durable-tracer.test.ts` and `async-flow.test.ts` for lifecycle-emitting sandbox writes and pinned config reads.
- `e2e/src/api/kernel/provider-entities/provider-entities.test.ts` and `search-import.test.ts` for unified provider completion hooks, deterministic changes, and no duplicate runs.
- `e2e/src/api/kernel/integrations/integrations.test.ts` for integration/import causation and separation between import runs and automation runs.
- `e2e/src/api/kernel/integrations/continuous-error-disable.test.ts` for failure attempts and exactly one disable notification chain.
- `e2e/src/api/kernel/god-mode/delete-user.test.ts` for shared trigger recipients and user-owned history/config cleanup.
- `e2e/src/api/kernel/auth/god-mode-reset-user.test.ts` for reset semantics.
- Backup archive validation, round-trip, and lifecycle suites to assert history/key exclusion and restore non-execution.

### Media behavior suites

Update or add media-owned E2E coverage proving:

- Direct `POST /entities` for an eligible user-scoped movie invokes `media.ensure-library-membership`.
- Provider-backed TMDB movie import invokes the same hook slug and produces the same `in-library` outcome.
- Importing an already-existing global movie still emits provider-import completion and ensures membership.
- The old event-wide library policy no longer runs when progress/review events are created.
- Relationship creation by the hook emits a normal child relationship trigger.
- Replaying either source operation does not duplicate membership or runs.
- Media completion, episodic policy, review signal, monitoring, and external push behavior still work with inline inputs.

Primary existing suites include:

- `e2e/src/api/plugins/media/events/automations.test.ts`.
- `e2e/src/api/plugins/media/media-monitoring/media-entity-update-signals.test.ts`.
- Relevant provider and integration suites under `e2e/src/api/kernel/` where kernel behavior owns the assertion.

### V10 validation

Do not add a substitute normal E2E suite for V10. Update generated-SQL/unit coverage where appropriate, then follow `migrations/v10-rust/README.md#validation-runbook` against normal and larger available legacy dumps. Verify:

- Migration creates required active plugin/config revisions.
- Migration creates zero triggers, recipients, runs, and attempts.
- Existing notification preferences survive.
- Post-migration runtime writes use the new lifecycle model.
- Restart behavior remains idempotent.

## Validation Commands

Run focused package checks/tests during each phase, then the full matrix. Use package working directories where useful.

```bash
bun run --cwd packages/contract test
bun run --cwd packages/contract check
bun run --cwd packages/sandbox-sdk test
bun run --cwd packages/sandbox-sdk check
bun run --cwd kernel/backend test
bun run --cwd kernel/backend check
bun run --cwd plugins/media build
bun run --cwd plugins/fitness build
bun run --cwd apps/docs generate
bun run --cwd e2e check
bun run --cwd e2e test
bun run check
bun run test
bun run build
```

Generate database migrations only through:

```bash
bun run --cwd kernel/backend db:generate
```

Run the V10 migration validation separately using its documented restored-dump runbook.

The `check` scripts run formatters with writes. Inspect the final diff after checks and do not revert unrelated user changes.

## Stop Conditions

Stop and ask the user before proceeding if:

- Effect Workflow cannot safely execute a retained pinned script revision without changing behavior outside the documented sandbox boundary.
- The selected configuration encryption cannot support authenticated decryption with the dedicated database key.
- A required plugin configuration value cannot be snapshotted without persisting credentials contrary to this plan.
- An owning service cannot append lifecycle planning in its transaction without holding that transaction across network, sandbox, or workflow work.
- V10 can no longer resolve deterministic active media/fitness revisions from the startup order.
- A first-party policy requires a state mutation other than the integration progress claim already assigned to the integration pipeline.
- A source write has no deterministic command/item identity and adding one changes its public idempotency contract.
- External integration behavior requires automatic retries but cannot provide an idempotency guarantee.

Do not silently add compatibility layers, suppress lifecycle per caller, weaken policy purity, or fall back to current plugin/config state.

## Completion Criteria

The work is complete only when:

- Plugin upgrades create immutable revisions and old accepted runs execute pinned old code/config.
- All runtime entity, event, relationship, provider-import completion, and signal operations create triggers and matching runs atomically through owning services.
- Policies are pure, recorded, ordered, and linked to separate committed change triggers.
- Signals use trigger/recipient storage and execute once per matching user/hook pair.
- Provider-import hooks use the common run/attempt workflow.
- Direct entity creation and provider-backed entity import invoke the same media library-membership hook.
- Structured required-hook warnings are available to API clients.
- Runs, attempts, retry, recursion limits, retention, user history, and manual retry work end to end.
- Integrations retain import-run ownership and complete causation into downstream automations.
- Backup/restore excludes history and keys and does not replay work.
- V10 reconstructs historical state without creating or running automations.
- Old occurrence, subscription-run, signal, origin, derived-binding, execution-only RyotQL, and manual dispatch systems are removed.
- Focused tests, E2E, checks, builds, and V10 restored-dump validation pass.
- `kernel/backend/src/modules/automations/README.md`, sandbox runtime documentation, plugin authoring documentation, migration documentation, and maintained deployment documentation describe the implemented system rather than the removed one.

## Implementation Report

When execution finishes, add a short report under `docs/` only if the user requests one. Otherwise summarize in the final response:

- Schema and architecture changes.
- Removed exceptional paths.
- Integration and plugin behavior changes.
- E2E suites added or updated.
- V10 dumps used for validation.
- Commands run and results.
- Any remaining operational risks or intentionally deferred UI polish.
