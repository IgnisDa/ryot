# Plugin Kit

`@ryot-app/contract/modules/plugins/manifest` owns plugin authoring schemas and types. `definePlugin` preserves
literal types while validating the strict authored manifest: every section is required, empty arrays
are explicit, unknown fields are rejected, and `scripts` is not authored. Sandbox slugs use lowercase
letters and numbers separated by `.`, `_`, or `-`; `/` is reserved for path mapping.

## Identity

Set `metadata.packageId` to a permanent `publisher/name` package ID. Each segment is lowercase
`[a-z0-9]+(-[a-z0-9]+)*` and 1-64 characters. The `ryot/` publisher is reserved for bundled
plugins, and a fork must choose a new package ID. Package IDs and content hashes do not verify a
publisher.

The package ID is portable; the local `plugin.id` identifies one system record or one user's private
record. Names and slugs are display metadata, not selectors. Routes use `/p/<publisher>/<name>` and
saved views use `/v/c/<savedViewId>`, `/v/k/<slug>`, or `/v/p/<publisher>/<name>/<slug>` through the
shared navigation helpers.

Domain recipes accept a `PluginIdentityReference`. Authored saved views and trusted sandbox scripts
pass `{ kind: "self" }`. Browser contributors call `usePluginIdentity(packageId)` or the non-React
`client.pluginIdentity(packageId)`. Presentation loaders use the selected entity's stored owner, not
the page owner. Ordinary HTTP queries use `local` or `{ kind: "package", packageId, scope }`
references, never `self`.

Client dependencies are an importer-local alias map:

```ts
pluginDependencies: {
  catalog: { packageId: PluginPackageId.make("ryot/catalog"), scope: "system" },
}
```

Imports use `@ryot-app/plugins/catalog/<export-name>`. Dependencies do not grant read or write
authority, and contributors share one JavaScript realm, so identity bindings do not isolate modules.

System configuration keys are `RYOT_PLUGIN__<PUBLISHER>__<NAME>__<CONFIG_KEY>`, uppercased with `-`
replaced by `_`. Private configuration never reads environment variables.

A system package ID cannot be installed privately. When system activation meets a retained private
claim, the private installation is quarantined with its data intact until it is explicitly
re-enabled. Backups remap typed plugin references by package ID and scope; IDs inside opaque plugin
JSON are not rewritten.

## Package Layout

| Root        | Archive output                             | Owner and allowed dependencies                                                       |
| ----------- | ------------------------------------------ | ------------------------------------------------------------------------------------ |
| `manifest/` | None                                       | Manifest and declarations imported directly by the server or kernel client           |
| `backend/`  | Compiled JavaScript                        | Sandbox entrypoints and libraries; may import siblings and `shared/`                 |
| `client/`   | Emitted client assets                      | Optional client source; uses client SDK/UI SDK and may import siblings and `shared/` |
| `shared/`   | Bundled when reachable into scripts/assets | Environment-neutral `.ts`; may import shared siblings and plugin-kit neutral shims   |

Backend, client, and shared authoring sources never import `manifest/`. Manifest code reaches backend
source only through `backend/contracts/**`, which holds sandbox-owned schemas, recipes, and helpers
needed by server callers; environment-neutral values used by both belong in `shared/`.
Nothing manifest-only belongs under backend, client, or shared.

Client entries default-export components or presentation definitions. They do not mount or bootstrap
an application. The compiler generates one application bootstrap and React root for plugin routes,
entity pages, saved-view renderers, and workspace homes. Public cross-plugin imports use
`@ryot-app/plugins/<dependency-alias>/<export-name>` and must name a declared client dependency.
Client code may read `usePageContext().target.kind`, but must derive target paths, route parameters,
entity IDs, and entity schema slugs from the live routing APIs. The kernel retains and reuses a client
realm across locations, so the initial page context is not a navigation state source.
Client code runs in an opaque-origin iframe without `localStorage`; keep per-device preferences with
the client SDK's `usePluginStorage`.

Plugins can request a kernel-rendered fixed card through `client.iosLiveActivities`; the client SDK
documents its Effect API and lifecycle.

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

`ryot plugin build` compiles every local `backend/**/*.sandbox.ts` entry and derives `scripts` in the
archive manifest. Archives contain compiled backend/client artifacts, not authored sources.
Installation validates structure and hashes without recompilation or source-provenance proof.
Renaming a script slug requires updating its manifest references. See the
[archive format](../plugin-archive/README.md).

Each entry default-exports exactly one direct definition with static manifest, input schema, output
schema, and Effect-returning `run`. `defineManifest` contains the script identity and kind plus its
kind-specific authored fields, such as an automation `inputProjection` or provider
`searchOptionsSchema`. It does not contain capabilities, configuration requirements, OAuth fields, or
executable dependencies. The compiler derives those from the entry's used code and writes them to the
build-derived script metadata. There are no driver maps or runtime kind selection.

| Kind         | Helper                   | Use                                                             |
| ------------ | ------------------------ | --------------------------------------------------------------- |
| `script`     | `defineScript`           | Boot, cron, bootstrap, or internal execution                    |
| `operation`  | `defineOperation`        | Public `plugins.invoke` entrypoint                              |
| `workflow`   | `defineWorkflow`         | Deterministic durable orchestration; no local host capabilities |
| `automation` | `defineAutomation`       | After hook (`automationType: "automation"`)                     |
| `automation` | `defineAutomationPolicy` | Before hook (`automationType: "policy"`)                        |
| `provider`   | `defineProvider`         | One logical provider operation                                  |

A logical provider requires `details` and may declare `search`, `resolve`, and `translate`, each as a
separate provider script. `rootEntitySchemaSlug` may reference an entity schema from the same plugin.
User-effective provider and schema resolution includes ready private installations only for their
owner; APIs without user context resolve system definitions only. Persisted provenance uses stable
plugin ID, not installation ID.

Sandbox definition helpers infer the `run` failure type from its implementation. Use typed/tagged
failures for expected plugin errors; host capability calls contribute `SandboxHostError` to that
type. Workflow body failures become failed replay envelopes. Import `Effect` from
`@ryot-app/plugin-backend-sdk/effect` in ordinary backend scripts and the restricted
`@ryot-app/plugin-backend-sdk/workflow` surface in workflows. The shared `@ryot-app/plugin-kit/effect`
shim remains environment-neutral and does not export `Effect`.

## Shared Sources

`shared/**` accepts `.ts`, not `.tsx`. Its only bare imports are
`@ryot-app/plugin-kit/compression`, `@ryot-app/plugin-kit/effect`, `@ryot-app/plugin-kit/ryotql`, and
`@ryot-app/plugin-kit/schema`; relative imports remain inside `shared/`.
The plugin client and backend compilers enforce the same rule and reject client-only or backend-only SDK imports.

The `ryotql` shim exports query builders, `IsoDateString`, and event expressions, not application
recipes. The `effect` shim exports `DateTime`, `Option`, `Result`, `Schema`, and `SchemaGetter`, not
`Effect`. The `schema` shim supplies shared schemas/brands and `roundHalfUp`; `compression` supplies
`deflateSync`/`inflateSync`. Backend compilation reuses runtime modules to avoid duplicate bundles.

Only sources reachable from a declared client or sandbox entry are checked. A plugin with no client
entry can therefore leave otherwise unreachable shared files unchecked.

## Manifest Sections

| Section                | Purpose                                                                 |
| ---------------------- | ----------------------------------------------------------------------- |
| `metadata`             | Permanent package ID, name, description, version, and icon              |
| `configSchema`         | Plugin-owned environment configuration                                  |
| `userSettingsSchema`   | Optional non-secret per-user preferences rendered by the kernel         |
| `scripts`              | Build-derived sandbox entries and requirements                          |
| `providers`            | Logical providers mapped to provider-operation scripts                  |
| `workflows`            | Public workflow slugs                                                   |
| `operations`           | Public user- or integration-authenticated operations                    |
| `userBootstrap`        | Per-user bootstrap dispatches for system and private plugins            |
| `crons`                | Scheduled system-subject dispatches                                     |
| `importSources`        | Payload, single-file, or named-file workflow inputs                     |
| `httpRateLimits`       | Deployment-global limits by normalized HTTP(S) origin                   |
| `integrationProviders` | Push, sink, or yank integrations                                        |
| `oauthProviders`       | Optional kernel-managed OAuth clients for integration settings (system) |
| `entitySchemas`        | Entities, events, editors, entity-user-data policy, and merge identity  |
| `relationshipSchemas`  | Typed relationship endpoints and optional user-write ownership rules    |
| `signalSchemas`        | Signal audience, catalog, and formatter definitions                     |
| `calendarSources`      | Optional dated occurrences listed by the kernel calendar                |

Set `userWritePolicy: "source-owner"` on structural relationship schemas when user-scoped writes
must require ownership of the source entity. The target may be global and visible. The rule covers
creates, updates, and deletes through HTTP, editors, and sandbox writers; authorized global provider
writes retain their existing authority. Leave it omitted for personal annotations that may reference
global sources. Enforcement uses both the pinned and active schema, so an older execution cannot
bypass an active ownership restriction.
| `client` | Version 1 public exports, routes, entities, dependencies, and home view |
| `savedViews` | Renderer, settings, and optional named RyotQL data sources |
| `hooks` | Stable before/after lifecycle hooks |

All referenced scripts, workflows, providers, and config keys must exist within the declaring package.
Local declaration names can repeat across packages. Entity and relationship schema evolution is additive.

Client exports are stable names with kind `page`, `component`, or `presentation`. Routes map URL
patterns to page exports; entity declarations map owned schema slugs to detail and grid/list
presentation exports and may name a `createRoute`, one of the declared routes, that the kernel library
picker offers for creation with the search text as the `name` search parameter (other picks, and schemas
without one but with a manifest `editor`, create inline); `homeView` names a plugin-owned saved view or is null. Saved views do not carry
legacy display mappings or sandbox scripts.

### User Settings

System and private plugins may declare `userSettingsSchema` with primitive fields, primitive arrays,
and static enum choices. Labels, descriptions, ordering, defaults, validation, and rules use `AppSchema`.
Secrets, uploads, OAuth connections, objects, and dynamic choices are not supported. The schema must
validate an empty record after applying defaults, so initial preferences and reset are always valid.

Defaults apply to absent keys, not explicit nulls. A field with a default and `validation.required`
accepts an empty record after defaults while rejecting null choices.

Users edit these preferences under Settings → Plugin preferences. Values belong to the exact user's
installation, separate from `configSchema`, and are included in account backups. Reset removes stored
choices. Schema evolution is additive; incompatible changes are rejected.

User-scoped backend scripts declare `getUserSettings` and call `host.getUserSettings()` to read their
own plugin's current settings with defaults applied. Decode the JSON record with plugin-owned Effect
schemas. Retained execution reads use the pinned manifest schema; durable activity replay retains the
recorded read. System execution without a user cannot read user settings. `getUserPreferences` exposes
the kernel-owned `disableIntegrations`; entity language remains a kernel preference. Client code
reads the same resolved settings with the client SDK's `usePluginUserSettings(pluginId)`.

Direct user executions, such as operations, declare `updateUserSettings` and call
`host.updateUserSettings(patch)` to change the execution user's settings for their own plugin. The
kernel selects the installation from the executing plugin and user, never from the patch. Each
top-level key replaces the stored value; keys must exist in the pinned manifest schema, and the merged
document must validate against the active schema and stay within 64 KiB. The call returns
`{ saved: true }`; re-read with `getUserSettings` when needed. Integration, import, bootstrap,
automation, event-projection, and system executions cannot write settings, and one execution may make
at most four calls.

There is no compare-and-set. Saves from the settings page replace the whole document, a durable run's
recorded `getUserSettings` read may be stale, and at-least-once re-execution can reapply a patch over an
intervening edit of the same key.

### Calendar Sources

`calendarSources` is optional; omitting it declares none. Each source has a local `slug`, `name`,
`icon`, `precision`, `subject`, and one RyotQL `query` body: `from`, optional `where` and `joins`, and
a `rows` output with `fields` and optional `include`. The kernel owns ordering, paging, and the
calendar window, so a query cannot declare `orderBy` or `pagination`.

`startAt` names a projected date field. Optional `caption`, `art`, and `done` name projected text,
JSON, and boolean fields. `precision` is `date` for date-only values stored at UTC midnight or
`instant` for timestamps. `subject` names the query alias of the occurrence's entity and its schemas,
as for entity-browser views. Installation validates the query with plugin-audience access, the field
kinds, and that the subject alias is an entity table; `self` references bind to the installed plugin.

Users can hide individual sources. Hidden state is per user, keyed by the exact plugin and source
slug, and included in account backups.

## Execution Authority

Ingestion assigns plugin scope (`system` or `user`); manifests do not. Execution subject identifies
whose data an invocation uses and does not widen plugin privilege. Kernel dispatch selects it, never
script input. Private plugins may initialize their own user entities through `userBootstrap`; they
cannot write global domain data or declare deployment-owned `httpRateLimits` or `oauthProviders`.

The compiler derives local host capabilities from each entry's reachable code, including helpers,
closures, and forwarding methods. Executable dependencies do not merge authority: children use their
own metadata and workflow replay has no local host capabilities.

Ordinary scripts receive `ScriptHost`; policies receive `PolicyHost`. Narrowing a helper's host type
does not grant authority. Runtime checks combine pinned metadata, script kind, subject, plugin scope,
provider association, and bootstrap designation; domain services still enforce ownership. Filesystem
use derives capability requirements, but trusted paths are separately kernel-supplied.

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

RyotQL reads current state, not omitted trigger-time evidence. Plugins write through kernel host
functions, never direct persistence. Relationship writes must choose merge or replace; membership
upserts use merge to preserve annotations. Event updates/deletes are atomic per host batch, not across
calls. Exact patch shapes, limits, and replay identities are in
[Script Writes](../../kernel/backend/src/modules/scripts/README.md#script-writes).

Event-stream processors use `EventStreamStepInput`/`EventStreamStepOutput` from
`@ryot-app/plugin-backend-sdk/event-streams`. `requestEventStreamWork` registers an owned schema and
same-revision processor with declared output properties; registration does not dispatch. Start work
with `host.executeWorkflow("event-stream-work", kernelDispatch, { id: workId })` using that SDK's
reference. The kernel restricts updates to those properties.

Exact host-function and filesystem limits are in the
[sandbox runtime reference](../../kernel/backend/src/modules/scripts/README.md).

Prefer bounded batch host calls. Do not hide N+1 bridge traffic behind concurrency: each execution has
a host-call budget and at most four calls may be in flight.

Provider-associated scripts share cache namespace by logical provider ID. Standalone scripts use
immutable script ID. Both are isolated by executing user, not plugin owner. Exact key, TTL, and restart
semantics are in the sandbox runtime reference.

## Lifecycle Hooks

Every manifest declares `hooks`, including `[]` when empty. A hook's identity is `(pluginId, slug)`;
keep its slug stable when changing its script, targets, order, or metadata. Ordinary hook targets name
schemas declared by the manifest. Event targets name both their entity schema and event schema. There are no
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

An after hook may also observe the kernel's collection events with an explicit target:

```ts
{
  stage: "after",
  executionScope: "user",
  targets: [{
    owner: { kind: "kernel" },
    resource: "event",
    entitySchemaSlug: "collection",
    eventSchemaSlug: "add-entity-to-collection",
    operation: "create",
  }],
}
```

Only `review`, `add-entity-to-collection`, and `remove-entity-from-collection` are available through
this exception. It requires user execution and cannot be a before hook or a global observer. An
observer retains its own plugin's write authority; it must not extend kernel schemas or write another
plugin's domain data. A plugin's own schema named `collection` remains a separate local target. Names
alone never select kernel ownership.

Before hooks use `defineAutomationPolicy` and `automationType: "policy"`. They execute sequentially
by `(position, pluginId, hookSlug)`; omitted `position` means 1000. The compiler and runtime allow
only the policy-safe host surface: `executeRyotql`, schema/integration/config/preference reads, cache
reads, and diagnostic `log`/`span`. Each run receives shared automation metadata and optional
immutable references with per-item projected request snapshots:

```ts
{
  automation: { /* shared invocation metadata and references */ },
  items: [{ itemIdentity, payload }],
}
```

Return a decision for each item, matched by its identity:

```ts
{
  items: [{ itemIdentity, decision }];
}
```

The request snapshots and references are read-only. Calculating values does not write them to source;
changes require an explicit transform decision. No domain writes, HTTP, signals, notifications, cache
writes, persistent claims, child workflows, or filesystem grants are allowed. Decisions are
`{ action: "allow" }`, `{ action: "reject", reason }`, or
`{ action: "transform", patch }`. A patch must name the current resource and contain a non-empty
draft patch. Entity create/update may patch `name` and properties; relationship create/update may
patch properties; event create/update may patch properties, `sessionEntityId`, and `occurredAt`.
Event identity and schema fields are immutable, and delete transforms are rejected. A properties
patch is `{ remove: string[], set: Record<string,
JsonValue> }`: names are unique, set/remove cannot overlap, removal runs before set, and an empty
patch is invalid. The kernel applies accepted patches in hook order, projects that updated request for
the next policy, keeps operation, scope, and target identity fixed, and validates the final draft with
its AppSchema before writing.
Numeric `AppSchema.normalize` remains schema decoding behavior; hooks must not round the properties
they receive or pass through. A hook that derives values may round its computation inputs and results
to the declared property scales so that derived values and comparisons match what the schema stores;
share those scales with the property definitions instead of repeating literals.

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

After-hook `frequency` defaults to `"item"`; `"batch"` requires entity/event/relationship targets.
Item and batch hooks match separate triggers. A batch matches when any item matches, but receives
projected `payload.items` with `operation: "batch"` and must filter the items itself. Large writes
produce deterministic chunks, so processing must remain idempotent per item. `batchMaxItems` may be
1–1000; the lowest matching pinned hook/global limit applies, not limits from unmatched hooks.
Projected invocations must also fit 64 KiB and may be chunked smaller. Complete evidence remains
retained independently of the projection.

Omitted `retry` means `{ maxAttempts: 1, initialDelayMs: 1000, maxDelayMs: 60000,
externalIdempotency: "none" }`. Attempts include the first attempt and are bounded to 1–10.
Exponential delays double from `initialDelayMs` (1–3,600,000) to `maxDelayMs` (1–86,400,000), which
must be at least the initial delay. Only kernel-classified infrastructure failures are retryable;
schema failures, missing retained artifacts, and business failures are terminal. HTTP uncertain
outcomes are terminal unless the hook declares `externalIdempotency: "run-id"`. Automatic retries
require this declaration when the hook's reachable executable dependencies use `httpCall` or
`sendNotification`, including delegated effects. Declare it only if the external operation supports
deduplication and receives `automation.runId` as its idempotency key. All attempts share that logical
run ID; external exactly-once delivery is not guaranteed.

`causationSources` optionally allows `api`, `import`, `integration`, `bootstrap`, `provider-refresh`,
or `automation`. Kernel-owned causation carries execution/root/parent attribution, depth, lane, and
source context. Child writes preserve the root, derive parents from the trusted run, and increment
depth; plugin input cannot choose parentage. Budget-blocked policies reject writes; blocked after-hook
planning preserves committed mutations.

## Configuration Access And Ingestion

`getPluginConfig({ required: ["token"], optional: ["threshold"] })` reads only the requested keys
from the pinned configuration revision. The compiler derives required and optional keys from the
used calls, including calls reached through local helpers; keys must be literals or finite typed
values. Values retain their exact `JsonValue` shape, so declared defaults such as `false` and `0` are
returned rather than treated as missing. Missing required values fail with `missing-required-config`
in SDK error `data`; unavailable optional values are omitted. Unrequested keys are not available to
the script. The compiler records key metadata, not generated files for the full configuration schema;
scripts do not author per-script key lists. Configuration is never copied into automation input or
history. `emitSignal` returns `{ triggerId, wasCreated }`.
Notification subscriptions remain portable user configuration; triggers, runs, attempts, retry
state, logs, mutation receipts, pending batch evidence, and encryption keys are not account-backup data.

Create executable references with `defineScriptReference` and `defineWorkflowReference` from
`@ryot-app/plugin-backend-sdk/workflow`. `defineExecutableAlternatives({ id, stage, references })` and
`selectExecutable(alternatives, key)` constrain selection to registered targets. Use `stage: "settings"`
for setup choices and `stage: "record"` for choices refined from collected records. Configuration and
executable SDK methods must be called directly; method aliases are unsupported.

An import source can declare `plan.selections`: each selection has a fixed `value`, or a top-level
settings `field` and finite `cases` mapping setting values to alternative keys. These selections are
validated against compiled dependencies. Plan selection is pure and returns an ingestion operation
and selection map; it performs no source requests or writes.

Ingestion setup uses `importSourcesRecipe({ selected: { reference, settings }, limit })` and
`integrationProvidersRecipe({ selected: { reference, settings, integrationId? }, limit })` from
`@ryot-app/ryotql-recipes`. Their structured `readiness` contains `ready`, the selected `plan`, and
`blockReasons`; installation metadata scopes configuration to the exact system or private plugin.
Picker readiness covers unconditional requirements. Selected settings refine branch and account
connection requirements; backend admission rechecks them. Presence does not validate remote credentials.

Run reports use `@ryot-app/contract/modules/imports/ingestion`: each activity has its own ID, real unit,
completed count, optional exact total, last advancement, and wait. Batch outcomes count committed
records, never transport partitions or provider preparation. Issues retain structured reasons and
source/operation attribution without credentials, capture locators, raw bodies, or execution pins.
Run/issue recipes expose these reports and setup blocking directly. See
[imports](../../kernel/backend/src/modules/imports/README.md) for capture, expiry, cancellation, and
recovery lifetimes.

Mutation receipts replay commands even with no matching hooks. Batch candidates pin code/config
before writing; sealed committed chunks determine their runs. Later plugin changes cannot add hooks
to an already committed command. See [automations](../../kernel/backend/src/modules/automations/README.md).

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
[sandbox runtime reference](../../kernel/backend/src/modules/scripts/README.md#durable-ownership).

## Installation Lifecycle

Ingestion validates a complete prospective registry, persists immutable precompiled content-addressed
scripts, and atomically swaps the active snapshot. It does not start compiler workers. Readers see a
complete old or new snapshot. Existing durable workflows retain pinned versions; new resolution uses
the active snapshot.

System plugins are deployment-controlled. Accepted hook runs keep pinned package, configuration,
and script revisions through their retry window. Disablement and uninstall exclude new planning but
do not cancel accepted runs. The kernel retains compact revision attribution for history after
executable artifacts expire.

## Configuration And Data Contracts

`configSchema` is strict top-level `AppSchema` data with string, number, integer, boolean, or enum
fields. It supports labels, descriptions, secrets, defaults, and ordinary validation, but not nested
values, arrays, dates, translation, normalization, or schema rules. Compiler-derived script keys and
import-source configuration requirements must name declared fields. Script configuration access is
derived from `getPluginConfig` calls, not authored as a separate list.

Numeric `normalize.round.scale` in other manifest property schemas applies half-up rounding before
validation.

`mergeIdentityProperties` names unique top-level entity properties whose persisted JSON values must
match before user state can merge. Omission means no property-based merge restriction.

`editor: { relationships }` opts an entity schema into the kernel entity editor. Users can then
create and edit their own entities of that schema, together with the listed outgoing relationships,
through `EntityEditorScreen` and the kernel editor save; no plugin operation is involved. Each listed
slug must be a unique relationship schema declared in the same manifest whose source is this entity
schema. Omission means the schema has no editor. Adding, changing, or removing an editor is an
allowed evolution.

Crons target one script and use either `{ cron }` or `{ tier: "infrequent" }`. Boot entries target one
script and run once per server start. Both run with system subject through durable execution; dispatch
is skipped when `scheduler.disableDispatchers` is enabled. Boot scripts must be idempotent.

Operations map a public slug and `user` or `integration` auth to an `operation`-kind script. Import
sources map strict input schemas to workflows. Uploads are top-level string fields with upload format;
the kernel validates each file and exposes it by field name for `readNamedArtifact(key)`. Payload-only
sources use ordinary fields.

## Recipes

`@ryot-app/plugin-kit/operations` provides an Effect-based typed operation invoker.
`defineOperationRecipe` pins the package ID, operation slug, and input/output Effect Schemas;
`invokeOperationRecipe` encodes input, calls the supplied transport, and decodes output.
