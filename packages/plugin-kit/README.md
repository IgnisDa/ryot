# Plugin Kit

`@ryot-app/contract/modules/plugins/manifest` owns plugin authoring schemas and types. `definePlugin` preserves
literal types while validating the strict authored manifest: every section is required, empty arrays
are explicit, unknown fields are rejected, and `scripts` is not authored. Sandbox slugs use lowercase
letters and numbers separated by `.`, `_`, or `-`; `/` is reserved for path mapping.

## Package Layout

| Root       | Archived | Owner and allowed dependencies                                                       |
| ---------- | -------- | ------------------------------------------------------------------------------------ |
| `host/`    | No       | Manifest and code imported directly by the server or kernel client                   |
| `backend/` | Yes      | Sandbox entrypoints and libraries; may import siblings and `shared/`                 |
| `client/`  | Yes      | Optional client source; uses client SDK/UI SDK and may import siblings and `shared/` |
| `shared/`  | Yes      | Environment-neutral `.ts`; may import shared siblings and plugin-kit neutral shims   |

Archived roots never import `host/`. Production host code reaches archived backend code only through
`backend/contracts/**`, which holds sandbox-owned schemas, recipes, and helpers needed by host callers.
Nothing host-only belongs under an archived root.

Client entries default-export components or presentation definitions. They do not mount or bootstrap
an application. The compiler generates one application bootstrap and React root for plugin routes,
entity pages, saved-view renderers, and workspace homes. Public cross-plugin imports use
`@ryot-app/plugins/<plugin-slug>/<export-name>` and must name a declared client dependency.
Client code may read `usePageContext().target.kind`, but must derive target paths, route parameters,
entity IDs, and entity schema slugs from the live routing APIs. The kernel retains and reuses a client
realm across locations, so the initial page context is not a navigation state source.
Client code runs in an opaque-origin iframe without `localStorage`; keep per-device preferences with
the client SDK's `usePluginStorage`.

Backend areas group entrypoints under `automations/`, `bootstrap/`, `imports/`, `integrations/`,
`operations/`, `workflows/`, and `providers/`; cross-area code belongs in `backend/lib/`.

Provider entrypoints use:

```text
backend/providers/<provider slug path>/<operation>.sandbox.ts
```

The path is the provider slug with `/` replacing `.`, and the basename is `details`, `search`,
`search-options`, `resolve`, or `translate`. Other sandbox basenames in a provider directory are
provider-associated ordinary scripts.

## Script Discovery

Every `backend/**/*.sandbox.ts` file is an entrypoint. `ryot plugin build` reads its direct definition
and derives `scripts`, including entry path and provider identity, into archive `manifest.json`.
Installation recomputes that list from sources and rejects disagreement, so editing archive metadata
cannot widen a script. Renaming a script slug requires updating all manifest references.

Each entry default-exports exactly one direct definition with static manifest, input schema, output
schema, and Effect-returning `run`. The static manifest is the source of its metadata; there are no
driver maps or runtime kind selection.

| Kind         | Helper                   | Use                                                             |
| ------------ | ------------------------ | --------------------------------------------------------------- |
| `script`     | `defineScript`           | Boot, cron, bootstrap, or internal execution                    |
| `operation`  | `defineOperation`        | Public `plugins.invoke` entrypoint                              |
| `workflow`   | `defineWorkflow`         | Deterministic durable orchestration; capabilities must be empty |
| `automation` | `defineAutomation`       | After hook (`automationType: "automation"`)                     |
| `automation` | `defineAutomationPolicy` | Before hook (`automationType: "policy"`)                        |
| `provider`   | `defineProvider`         | One logical provider operation                                  |

A logical provider requires `details` and may declare `search`, `resolve`, and `translate`, each as a
separate provider script. `rootEntitySchemaSlug` may reference an entity schema from the same plugin.
User-effective provider and schema resolution includes ready private installations only for their
owner; APIs without user context resolve system definitions only. Persisted provenance uses stable
plugin ID, not installation ID.

## Shared Sources

`shared/**` accepts `.ts`, not `.tsx`. Its only bare imports are
`@ryot-app/plugin-kit/effect`, `/ryotql`, and `/schema`; relative imports remain inside `shared/`.
Client and sandbox compilers enforce the same rule and reject client-only or sandbox-only SDK imports.

The `ryotql` shim exports RyotQL, `IsoDateString`, and the four event expression helpers. It must not
re-export `@ryot-app/ryotql-recipes`, which brings in the contract runtime. The `effect` shim exports
only `DateTime`, `Option`, `Result`, `Schema`, and `SchemaGetter`. Backend compilation aliases these
neutral shims to existing runtime modules where possible to avoid charging duplicate libraries to
each script's 1 MiB budget.

Only sources reachable from a declared client or sandbox entry are checked. A plugin with no client
entry can therefore leave otherwise unreachable shared files unchecked.

## Manifest Sections

| Section                | Purpose                                                                 |
| ---------------------- | ----------------------------------------------------------------------- |
| `metadata`             | Package slug, name, description, version, and icon                      |
| `configSchema`         | Plugin-owned environment configuration                                  |
| `scripts`              | Build-derived sandbox entries and requirements                          |
| `providers`            | Logical providers mapped to provider-operation scripts                  |
| `workflows`            | Public workflow slugs                                                   |
| `operations`           | Public user- or integration-authenticated operations                    |
| `userBootstrap`        | Per-user bootstrap dispatches for system plugins                        |
| `crons`                | Scheduled system-subject dispatches                                     |
| `importSources`        | Payload, single-file, or named-file workflow inputs                     |
| `httpRateLimits`       | Deployment-global limits by normalized HTTP(S) origin                   |
| `integrationProviders` | Push, sink, or yank integrations                                        |
| `entitySchemas`        | Entities, events, user-state policy, and merge identity                 |
| `relationshipSchemas`  | Typed relationship endpoints                                            |
| `signalSchemas`        | Signal audience, catalog, and formatter definitions                     |
| `client`               | Version 1 public exports, routes, entities, dependencies, and home view |
| `savedViews`           | Renderer, settings, and optional named RyotQL data sources              |
| `hooks`                | Stable before/after lifecycle hooks                                     |

All referenced scripts, workflows, providers, and config keys must exist. Active plugins share the
global namespaces enforced by `PluginManifest`. Entity and relationship schema evolution is additive.

Client exports are stable names with kind `page`, `component`, or `presentation`. Routes map URL
patterns to page exports; entity declarations map owned schema slugs to detail and grid/list
presentation exports; `homeView` names a plugin-owned saved view or is null. Saved views do not carry
legacy display mappings or sandbox scripts.

## Subject And Capabilities

Ingestion assigns plugin scope (`system` or `user`); manifests do not. Execution subject identifies
whose data an invocation uses and does not widen plugin privilege. Kernel dispatch selects it, never
script input. User plugins cannot declare `userBootstrap` or `httpRateLimits`, or use a system
plugin slug.

`capabilities` is an allowlist request, not a grant. The backend intersects it with host functions and
policy for script kind, subject, plugin scope, provider association, and bootstrap designation. Domain
modules still enforce ownership. Declare only used methods. `artifact-read` and `scratch` request
filesystem grants. Workflows declare no capabilities and receive durable replay primitives only.

Subject follows the dispatch path: cron uses system; user bootstrap uses the initialized user;
user operations, imports, and user-triggered provider calls use the caller; integration operations add
validated integration context; automations use a trusted automation-run subject; durable descendants inherit
their parent's subject.

Hooks receive a deterministic projection of the complete immutable trigger retained by the kernel.
`automation` contains `triggerId`, `runId`, `hookSlug`, `causation`, `occurredAt`,
`executionUserId`, optional `hookMetadata`, and projected `payload`. Narrow on `payload.category`,
`payload.resource`, and `payload.operation` before reading its data. Projection changes only the
sandbox input; it never removes evidence from the retained trigger.

Each automation script must declare `inputProjection`. At least one resource is required, names are
trimmed and unique, and undeclared resources fail closed rather than receiving a complete payload.
After-automation projections have this shape:

```ts
inputProjection: {
	entity?: { properties: string[]; compareProperties: Comparison[]; parentEntityProperties: string[] };
	event?: { properties: string[]; compareProperties: Comparison[] };
	relationship?: { properties: string[]; compareProperties: Comparison[]; parentEntityProperties: string[] };
	providerEntityImport?: true;
	signal?: { properties: string[] };
}
```

Policy projections are deliberately smaller:

```ts
inputProjection: {
	entity?: { properties: string[] };
	event?: { properties: string[] };
	relationship?: { properties: string[] };
}
```

`properties` selects keys from each projected `draft`, `before`, `after`, or signal property map;
all non-property identity and operation fields remain present. `parentEntityProperties` independently
selects `population.parentEntity.properties`; other population fields remain present.
`compareProperties` produces a sorted `changedProperties` list on update requests and changes,
including items in projected batches. A `json` comparison uses canonical JSON equality, including
array order and multiplicity. `unordered-array` compares arrays as sets of canonical JSON elements,
ignoring order and duplicate multiplicity; non-arrays use JSON equality. Missing and present values,
including `null`, remain distinct. Compared properties need not also be selected into snapshots.

Do not query omitted or historical invocation data back through RyotQL. RyotQL describes current
state under the trusted principal, which can differ from the complete trigger-time evidence.
Plugins never own database tables or direct persistence; writes use kernel host functions.

Exact host-function and filesystem limits are in the
[sandbox runtime reference](../../kernel/backend/src/lib/infrastructure/sandbox-runtime/README.md).

Prefer bounded batch host calls. Do not hide N+1 bridge traffic behind concurrency: each execution has
a host-call budget and at most four calls may be in flight.

Provider-associated scripts share cache namespace by logical provider ID. Standalone scripts use
immutable script ID. Both are isolated by executing user, not plugin owner. Exact key, TTL, and restart
semantics are in the sandbox runtime reference.

## Lifecycle Hooks

Every manifest declares `hooks`, including `[]` when empty. A hook's identity is `(pluginId, slug)`;
keep its slug stable when changing its script, targets, order, or metadata. Hook targets name schemas
declared by the manifest. Event targets name both their entity schema and event schema. There are no
wildcards or expression rules. The archive includes only active discovered scripts, and every hook
must reference an automation-kind script with the correct `automationType`.

```ts
// Inside the authored manifest; "item" must be a declared entity schema.
hooks: [
	{
		slug: "item.ensure-membership",
		name: "Ensure library membership",
		scriptSlug: "ensure-membership",
		stage: "after",
		delivery: "required",
		targets: [
			{ resource: "entity", operation: "create", entitySchemaSlug: "item" },
			{ resource: "provider-entity-import", operation: "complete", entitySchemaSlug: "item" },
		],
		causationSources: ["api", "import", "integration"],
		retry: { maxAttempts: 3, initialDelayMs: 1000, maxDelayMs: 60000, externalIdempotency: "none" },
	},
];
```

Entity, event, and relationship targets support `create`, `update`, and `delete`. Provider import
supports only after-`complete`; signal supports only after-`emit`. Import completion remains a fact
even when the global entity already exists. `signalSchemas[].notificationHookSlug` names an after
hook that targets that signal; it is never a script slug.

Before hooks use `defineAutomationPolicy` and `automationType: "policy"`. They execute sequentially
by `(position, pluginId, hookSlug)`; omitted `position` means 1000. Their capabilities are read-only:
`executeRyotql`, schema/integration/config/preference reads, cache reads, and diagnostic `log`/`span`.
No domain writes, HTTP, signals, notifications, cache writes, persistent claims, child workflows, or filesystem grants
are allowed. Outputs are `{ action: "allow" }`, `{ action: "reject", reason }`, or
`{ action: "transform", patch }`. A patch must name the current resource and contain a non-empty
draft patch. Entity create/update may patch `name` and properties; relationship create/update may
patch properties; event create may patch `sessionEntityId` and properties. Delete transforms and
event update transforms are rejected. A properties patch is `{ remove: string[], set: Record<string,
JsonValue> }`: names are unique, set/remove cannot overlap, removal runs before set, and an empty
patch is invalid. The kernel applies accepted patches in hook order, projects that updated request for
the next policy, keeps operation, scope, and target identity fixed, and validates the final draft with
its AppSchema before writing.
Numeric `AppSchema.normalize` remains schema decoding behavior; do not move rounding into hooks.

Only before-event hooks may set `batchFrequency: "item" | "once-per-subject"`; omission means `item`.
For event-create batches, `once-per-subject` runs on the first eligible item for each deterministic
subject key. Before hooks have no `delivery` or `retry` fields. Infrastructure failure returns
`policy-execution-failed` with the run ID and creates no mutation. Resubmission is a new command;
delayed automatic and manual policy retry are not allowed.

After hooks use `defineAutomation` and `automationType: "automation"`. They run concurrently and
independently. Dependent steps belong in one script or plugin workflow. `delivery: "async"` does not
delay the response. `delivery: "required"` waits for one immediate attempt with bounded waiting;
failure does not roll back committed source data. Responses can carry `required-hook-failed` or
`required-hook-pending` with `hookSlug` and `runId`, or `automation-limit-reached` with `triggerId`
and at most 100 omitted `{ pluginId, hookSlug }` identities. Warnings never contain sandbox logs.

An after hook may declare `executionScope: "user" | "global"`; omission matches both. The kernel
compares it against the run's `executionUserId`, so a `user` hook is never planned for a global write
and a `global` hook is never planned for a user-scoped one. Per-recipient signal hooks keep working
because each recipient's run carries that user.

An after hook may also declare `frequency: "item" | "batch"`; omission means `item`. Every
change-producing write emits one batch trigger per resource in addition to its item change triggers,
even when a single item changed. An item hook matches only item triggers and a batch hook matches only
batch triggers, so each hook sees every change exactly once. The retained trigger keeps complete item
evidence; a batch run receives its script's projection of every item as `payload.items` with
`operation: "batch"` and must filter those items itself. The batch matches the hook when any item
matches a declared target. Batch frequency requires entity, event, or relationship targets. Large
writes are split into deterministic retained chunks by item count, so a batch hook can run more than
once for one write and must stay idempotent per item. The runtime separately enforces the 64 KiB
invocation limit after projection; it does not rechunk retained evidence for a specific hook.

Omitted `retry` means `{ maxAttempts: 1, initialDelayMs: 1000, maxDelayMs: 60000,
externalIdempotency: "none" }`. Attempts include the first attempt and are bounded to 1–10.
Exponential delays double from `initialDelayMs` (1–3,600,000) to `maxDelayMs` (1–86,400,000), which
must be at least the initial delay. Only kernel-classified infrastructure failures are retryable;
schema failures, missing retained artifacts, and business failures are terminal. HTTP uncertain
outcomes are terminal unless the hook declares `externalIdempotency: "run-id"`. Automatic retries
for scripts with `httpCall` or `sendNotification` require this declaration. Declare it only if the
external operation supports deduplication and receives `automation.runId` as its idempotency key.
All attempts share that logical run ID; external exactly-once delivery is not guaranteed.

`causationSources` is an optional non-empty allowlist of `api`, `import`, `integration`, `bootstrap`,
`provider-refresh`, or `automation`. Causation retains `initiator`, `executionId`, `rootExecutionId`,
nullable `parentTriggerId`/`parentRunId`, `depth`, and optional `integrationId`, `importRunId`, and
`providerExecutionId`. Kernel host writes derive child parents from the trusted run, preserve root
attribution, set source to `automation`, and increment depth. Plugin input cannot set these parents.
Depth and shared run budgets are kernel-enforced. Blocked policy planning rejects the write;
blocked post-write planning retains the source mutation.

`getPluginConfig` reads only the pinned configuration revision and declared keys. Configuration is
never copied into automation input or history. `emitSignal` returns `{ triggerId, wasCreated }`.
Notification subscriptions remain portable user configuration; triggers, runs, attempts, retry
state, logs, and encryption keys are not account-backup data.

## HTTP Rate Limits

Every manifest includes `httpRateLimits`, using `[]` when empty. Each declaration has a lowercase
slug `key`, positive safe-integer `requests` and `intervalMs`, and a non-empty list of HTTP(S) origins.
Origins contain no path, query, fragment, credentials, or wildcard and are normalized before unique
key and origin checks.

Limits are deployment-global, not per plugin, script, user, or credential. Identical declarations can
coexist; conflicting declarations sharing a key or origin reject the prospective active snapshot.
Matched traffic uses an evenly spaced global schedule with no burst reservation. A generic HTTP 429
retries durably after valid `Retry-After`, otherwise after the declaration interval. Unmatched origins
are not constrained by this limiter.

## Durable Workflows

Workflow modules orchestrate only `activity`, `sleep`, and child-workflow calls. Call order, names,
slugs, inputs, and app-owned child execution IDs must remain deterministic across replay. Exactly one
durable owner may create each execution. Move ambient time, randomness, network, filesystem, mutable
state, and ordinary host functions into activity scripts. Use `Effect.fail` for expected failures.
Runtime pinning and replay semantics are in the
[sandbox runtime reference](../../kernel/backend/src/lib/infrastructure/sandbox-runtime/README.md#durable-state).

## Installation Lifecycle

Ingestion validates a complete prospective registry, compiles entries, persists immutable
content-addressed scripts, and atomically swaps the active snapshot. Readers see a complete old or new
snapshot. Existing durable workflows retain pinned versions; new resolution uses the active snapshot.

System plugins are deployment-controlled. Accepted hook runs keep pinned package, configuration,
and script revisions through their retry window. Disablement and uninstall exclude new planning but
do not cancel accepted runs. The kernel retains compact revision attribution for history after
executable artifacts expire.

## Configuration And Data Contracts

`configSchema` is strict top-level `AppSchema` data with string, number, integer, boolean, or enum
fields. It supports labels, descriptions, secrets, defaults, and ordinary validation, but not nested
values, arrays, dates, translation, normalization, or schema rules. Script and import-source config
requirements must name declared fields. Scripts declare host-owned configuration separately.

Numeric `normalize.round.scale` in other manifest property schemas applies half-up rounding before
validation.

`mergeIdentityProperties` names unique top-level entity properties whose persisted JSON values must
match before user state can merge. Omission means no property-based merge restriction.

Crons target one script and use either `{ cron }` or `{ tier: "infrequent" }`. Boot entries target one
script and run once per server start. Both run with system subject through durable execution; dispatch
is skipped when `scheduler.disableDispatchers` is enabled. Boot scripts must be idempotent.

Operations map a public slug and `user` or `integration` auth to an `operation`-kind script. Import
sources map strict input schemas to workflows. Uploads are top-level string fields with upload format;
the kernel validates each file and exposes it by field name for `readNamedArtifact(key)`. Payload-only
sources use ordinary fields.

## Recipes

`@ryot-app/plugin-kit/operations` provides an Effect-based typed operation invoker.
`defineOperationRecipe` pins plugin slug, operation slug, and input/output Effect Schemas;
`invokeOperationRecipe` encodes input, calls the supplied transport, and decodes output.
