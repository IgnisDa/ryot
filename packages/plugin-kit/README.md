# Plugin Kit

`@ryot-app/contract/modules/plugins/manifest` owns plugin authoring schemas and types. `definePlugin` preserves
literal types while validating the strict authored manifest: required array sections use explicit
empty arrays, unknown fields are rejected, and `scripts` is not authored. Sandbox slugs use lowercase
letters and numbers separated by `.`, `_`, or `-`; `/` is reserved for path mapping.

## Declared queries

Optional `queries` maps names to `{ title, description, document }`. The title is a short
capitalized phrase, such as "Read workout", that assistants and approval screens show to people. Build each static authored document
from shared recipes; declare runtime inputs as parameters and send paging through request `pages`.
Ingestion validates all authored branches and control targets against effective definitions.
Runtime execution reads the persisted revision's query section and resolves parameter values and
source authority on the server. User calls identify the scoped package and declaration name; pinned
system scripts resolve their own declarations at their retained revision. See the
[RyotQL API](../ryotql/README.md) for authoring and binding.

## Review Content

`@ryot-app/plugin-kit/schema` exposes `ReviewContent`, `ReviewRating`, `requireReviewContent`,
`reviewProperties`, `reviewPropertiesPatch`, `reviewPropertyKeys`, `reviewRatingField`, and
`reviewPropertyFields`. Compose operation inputs from the content fields and apply the shared
content check, or reuse `ReviewRating` with a plugin-owned text rule. The mapper omits absent text
and rating and stores the spoiler flag only with text and only when the input carries one; the patch
sets those properties and removes every other review key. Ratings are stored 0–100 whatever scale
the user enters them in. Manifest fields accept plugin-owned descriptive copy. Plugins retain target
admission, lifecycle hooks, and operation execution.

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

Plugin dependencies are a top-level, importer-local alias map:

```ts
dependencies: {
  catalog: { packageId: PluginPackageId.make("ryot/catalog"), scope: "system" },
}
```

Every `package` reference in declared queries, saved views, browse fields, calendar sources, and
signal schedules must name a declared dependency. Client imports use
`@ryot-app/plugins/catalog/<export-name>`. Installation requires each dependency to be available, and
page composition includes dependencies that ship a client. `ryot plugin build` loads each dependency
from an installed npm package whose `exports["."].default` is its manifest. Dependencies do not grant
read or write authority, and contributors share one JavaScript realm, so identity bindings do not
isolate modules.

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

`client.assistantStarters` lists up to three example prompts that Ryo offers when a person starts
a new chat. Keep each prompt specific to the plugin's data.

Plugins can request a kernel-rendered fixed card through `client.iosLiveActivities`; the client SDK
documents its Effect API and lifecycle.

Backend areas group entrypoints under `automations/`, `bootstrap/`, `imports/`, `integrations/`,
`operations/`, `workflows/`, and `providers/`; cross-area code belongs in `backend/lib/`.

Provider entrypoints use:

```text
backend/providers/<provider slug path>/<operation>.sandbox.ts
```

The path is the provider slug with `/` replacing `.`, and the basename is `details`, `search`,
`search-options`, `related`, `resolve`, or `translate`. Other sandbox basenames in a provider directory are
provider-associated ordinary scripts.

Search results return `details.nextPage` independently of an optional `details.totalItems`. Omit the
total when the source does not provide it; a continuation does not prove an exact catalog count.

### Population levels

`details` receives `{ externalId, level? }`. `level` is `"base"` or `"full"`;
absent means `full`. The provider result is authoritative: the kernel does not pass existing
properties to `details` or preserve omitted old property keys when provider data is updated. At
`base`, return entity fields and child entities and skip fetching related data; the kernel ignores any
`relatedEntityGroups` returned at `base`. At `full`, return related groups as well.

An entity schema may declare `refreshIntervalDays`, a positive integer. When a page shows an entity of
that schema whose data is older than the interval, the kernel refreshes it from the provider, trying
at most once per day. Without it, data refreshes only on request or through monitoring. Instance
Admin can override the interval per schema.

### Paged related groups

Every `details` related-entity group and `related` result declares `coverage`:

- `{ status: "complete" }` means the declared inventory is exhausted, including an empty inventory.
- `{ status: "more", continuation }` carries the next page's JSON cursor, at most 4 KiB encoded.
- `{ status: "source-limited", reason }` means the source cannot supply the declared inventory.

A group with more pages requires a `related` script. It receives
`{ externalId, entitySchemaSlug, properties, relationshipSchemaSlug, direction, continuation }` and
returns `{ entities, coverage }`; `properties` is empty for root pages.
Each run is its own sandbox execution with its own host-call budget. The kernel writes each page as
it arrives, so a page must be self-contained. Only complete coverage permits an `authoritative` sweep;
a source-limited result fails explicitly without writing that page, deleting stale relationships, or
marking related data complete. Repeated cursors and exhausted execution/page budgets also fail.
Curated selections must have a defined scope: completing a recommendation selection does not imply
that a source's entire catalog was fetched. Do not disguise an arbitrary inventory cap as a selection.
A full population waits for all related pages and authoritative sweeps before marking related data
complete; root data is published earlier and pages remain visible while partial. See the
[provider population](../../kernel/backend/src/modules/entities/providers/README.md#paged-related-groups).

A `related` script may also declare `relatedInputs`, which gives child entity schemas their own
related level. Each entry names the child's addressing properties and its groups
(`relationshipSchemaSlug`, `direction`, `synchronization`); each group's relationship must anchor on
the child schema, and the provider root cannot be declared. A child's related level populates on
foreground interest or refresh: its first page receives a `null` continuation and the selected
properties. The parent's population still owns the child's canonical data. See
[child related groups](../../kernel/backend/src/modules/entities/providers/README.md#child-related-groups).

Each `translate` provider script declares `translationInputs`, a map from supported entity-schema
slugs to the canonical property keys the script needs. The kernel pins this declaration with the
provider script revision. Its required input is `{ name, externalId, entitySchemaSlug, language,
properties }`: `name` is the captured canonical name, and `properties` contains only the selected
canonical properties. The full input, including the name, is bounded. Missing selected data or
an oversized translation input fails closed; the kernel never falls back to the full properties
object. A successful empty translation result is a negative-cache result, distinct from workflow
failure.

## Script Discovery

`ryot plugin build` compiles every local `backend/**/*.sandbox.ts` entry and derives `scripts` in the
archive manifest. Archives contain compiled backend/client artifacts, not authored sources.
Installation validates structure and hashes without recompilation or source-provenance proof.
Renaming a script slug requires updating its manifest references. See the
[archive format](../plugin-archive/README.md).

Each entry default-exports exactly one direct definition with static manifest, input schema, output
schema, and Effect-returning `run`. `defineManifest` contains the script identity and kind plus its
kind-specific authored fields, such as an automation `inputProjection` or provider
`searchOptionsSchema`, `relatedInputs`, or `translationInputs`. It does not contain capabilities, configuration
requirements, OAuth fields, or executable dependencies. The compiler derives those from the entry's
used code and writes them to the build-derived script metadata. There are no driver maps or runtime
kind selection.

| Kind         | Helper                   | Use                                                                               |
| ------------ | ------------------------ | --------------------------------------------------------------------------------- |
| `script`     | `defineScript`           | Boot, cron, bootstrap, or internal execution                                      |
| `operation`  | `defineOperation`        | Public `plugins.invoke` entrypoint                                                |
| `workflow`   | `defineWorkflow`         | Bounded orchestration with explicit saved checkpoints; no local host capabilities |
| `automation` | `defineAutomation`       | After hook (`automationType: "automation"`)                                       |
| `automation` | `defineAutomationPolicy` | Before hook (`automationType: "policy"`)                                          |
| `provider`   | `defineProvider`         | One logical provider operation                                                    |

A logical provider requires `details` and may declare `search`, `search-options`, `related`, `resolve`,
and `translate`, each as a separate provider script. Generated `providerSlug`/`providerOperation`
script tuples are the sole operation bindings. Each tuple must be unique and reference a declared
provider. Dynamic choices in a search schema require that provider's `search-options` script.
Authored and archive `providers` contain only descriptive metadata, including `rootEntitySchemaSlug`,
which references an entity schema from the same plugin.
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

The `ryotql` shim exports query builders, `IsoDateString`, event expressions, `withinPeriod`
(a half-open reporting-period predicate that is empty for all time), and the projection-status
helpers, not application recipes. Measure helpers `countAll`, `sumOf`, `countIf` and the
`NullableNumber` codec cover the common aggregate measures. `projectionStatusMeasures` and
`projectionProcessingState` derive one `ProjectionProcessing` (`"ready" | "pending" | "failed"`)
from an aggregate over `event` or `eventStream` rows; `projectionProcessing` computes the same value
as a correlated expression for row selections. Read status from `eventStream` rows when a stream key
covers the scope, since one stream row stands for all of its events.
`defineRecipe` omits a query whose value is `undefined` from the document and maps it as `undefined`;
use that for disabled comparisons instead of always-false predicates. The `effect` shim exports `DateTime`, `Option`, `Result`, `Schema`, and `SchemaGetter`, not
`Effect`. The `schema` shim supplies shared schemas/brands, `roundHalfUp`, and `jsonValueEquals`; `compression` supplies
`deflateSync`/`inflateSync`. Backend compilation reuses runtime modules to avoid duplicate bundles.
Shared reporting recipes import the neutral helpers from `@ryot-app/plugin-kit/schema` and take the
`ResolvedReportingSelection` that the client query resolved with the supplied clock during execution. Compiled client code can use the reporting
exports from `@ryot-app/plugin-client-sdk/plugin`.

Only sources reachable from a declared client or sandbox entry are checked. A plugin with no client
entry can therefore leave otherwise unreachable shared files unchecked.

## Manifest Sections

| Section                | Purpose                                                                    |
| ---------------------- | -------------------------------------------------------------------------- |
| `metadata`             | Permanent package ID, name, description, version, and icon                 |
| `configSchema`         | Plugin-owned environment configuration                                     |
| `userSettingsSchema`   | Optional non-secret per-user preferences rendered by the kernel            |
| `scripts`              | Build-derived sandbox entries and requirements                             |
| `providers`            | Logical provider names, information, and root entity schemas               |
| `workflows`            | Public workflow slugs                                                      |
| `operations`           | Public user- or integration-authenticated operations                       |
| `userBootstrap`        | Per-user bootstrap entities or scripts for system and private plugins      |
| `memberships`          | Relationships the kernel keeps from member entities to a bootstrap entity  |
| `crons`                | Scheduled system-subject dispatches                                        |
| `importSources`        | Payload, single-file, or named-file workflow inputs                        |
| `httpRateLimits`       | Deployment-global limits by normalized HTTP(S) origin                      |
| `integrationProviders` | Push, sink, or yank integrations                                           |
| `oauthProviders`       | Optional kernel-managed OAuth clients for integration settings (system)    |
| `entitySchemas`        | Entities, events, editors, browse fields, user-data policy, merge identity |
| `relationshipSchemas`  | Relationship endpoints, user-write ownership, retention and projections    |
| `signalSchemas`        | Signal audience, catalog, and formatter definitions                        |
| `calendarSources`      | Optional dated occurrences listed by the kernel calendar                   |

Set `userWritePolicy: "source-owner"` on structural relationship schemas when user-scoped writes
must require ownership of the source entity. The target may be global and visible. The rule covers
creates, updates, and deletes through HTTP, editors, and sandbox writers; authorized global provider
writes retain their existing authority. Leave it omitted for personal annotations that may reference
global sources. Enforcement uses both the pinned and active schema, so an older execution cannot
bypass an active ownership restriction.

The kernel deletes unused provider entities. Set `retention` on a relationship schema to describe
how its global links affect that:

- `composition`: links an entity to its parts, such as seasons and episodes. All entities joined by
  these links are kept or deleted together.
- `root`: a link of this schema keeps both endpoints, such as a provider's trending marker.
- Omitted: a reference. A kept entity keeps the directly linked entity, but not that entity's
  other references or parts. When an unused neighbor is deleted, the kept entity's related data
  is marked incomplete so the next foreground interest refetches it.

User-scoped links, events, and `entity-id` properties in user-owned data always keep an entity.

Set `projection: { propertiesSchema }` on a relationship schema to keep derived, per-user values next to
each user-owned link, such as a library title's status. The output schema is strict, has at most 20
fields and shares none with the relationship properties. The fold of the link's source entity returns
them; see [folds](#folds). RyotQL reads the values through `relationship.projection` and
`relationship.projectionStatus`.

All referenced scripts, workflows, providers, and config keys must exist within the declaring package.
Local declaration names can repeat across packages. Entity and relationship schema evolution is additive.

Client exports are stable names with kind `page`, `component`, or `presentation`. Routes map URL
patterns to page exports; entity declarations map owned schema slugs to detail and grid/list
presentation exports and may name a `createRoute`, one of the declared routes, that the kernel library
picker offers for creation with the search text as the `name` search parameter (other picks, and schemas
without one but with a manifest `editor`, create inline); `homeView` names a plugin-owned saved view or is null. Saved views do not carry
legacy display mappings or sandbox scripts.

`collectionPages` adds actions to the More actions menu on kernel collection detail. Each entry names a `label`, `icon`,
owned `entitySchemaSlugs`, and a declared `route` containing a `$collectionId` segment. The action
appears only on collections that contain members of those schemas, and opens the route with the
collection's ID in that segment.

Entity-browser settings declare a `summary` for compact kernel lists such as command-center search:
`image` names a projected managed-asset field and `subtitle` names a projected field with a `text`,
`date`, `number`, `year`, or `boolean` display kind; either may be null. Table columns additionally support the `rating` display kind, a nullable stored
0-100 rating shown in the viewer's rating scale. Installation rejects search,
column, and summary fields that the source query does not project. Filters and sorts come from the
subject schemas' browse fields, not view settings; the view query's `orderBy` is the default order.

### Browse Fields

An entity schema may declare `browse: { fields }`, the filters and sorts every entity browser and
collection offers for its entities. Keys are unique per schema, match `/^[a-z][A-Za-z0-9]*$/`, and
avoid the reserved `collections` and `name`.

- `kind: "value"`: a typed filter (`text`, `number`, `rating`, `date`, `boolean`, `enum`,
  `enum-list`, or `text-list`; enum types list unique `choices`) with a RyotQL `expression`. A
  `rating` expression is a stored 0–100 number; browsers accept and summarize its bounds in the
  user's rating scale (a three-point choice covers its whole bucket) and offer range operators but
  not equality. Add
  `sort: { label, defaultDirection, ascending, descending }` to also offer it as a sort; list types
  cannot sort.
- `kind: "sort"`: a sort-only `expression` with the same `sort` metadata.
- `kind: "relationship"` or `"session-event"`: the existing linked-entity filter shapes.

`label` names the sort field independently of its filter label. `defaultDirection` is `"asc"` or
`"desc"`; `ascending` and `descending` are human-readable direction labels, such as "Lowest first"
and "Highest first". Each field contributes one sort choice with a separate direction control.

Expressions read the browsed entity through the table alias `subject` (`BROWSE_SUBJECT_ALIAS`)
and may use correlated subqueries; their kind must match the field type (lists are JSON).
Installation validates them with saved-view data-source access. Browsers rebase them onto their own
query alias.

Schemas of one plugin that declare the same key form one field, so declare it with the same type,
relationship direction, or event shape on each. Where expressions differ, each entity reads its own
schema's expression, and entities whose schema lacks the field never match it and sort last. The
same key from different plugins stays separate. Every browser also offers the Collections filter and
a Name sort.

System and private plugins may declare `userSettingsSchema` with primitive fields, primitive arrays,
and static enum choices. Labels, descriptions, ordering, defaults, validation, and rules use `AppSchema`.
Secrets, uploads, OAuth connections, objects, and dynamic choices are not supported. The schema must
validate an empty record after applying defaults, so initial preferences and reset are always valid.

Defaults apply to absent keys, not explicit nulls. A field with a default and `validation.required`
accepts an empty record after defaults while rejecting null choices.

Users edit these preferences under Settings → Plugin preferences. Values belong to the exact user's
installation, separate from `configSchema`, and are included in account backups. Reset removes stored
choices. Schema evolution is additive; incompatible changes are rejected. Property labels and
descriptions are display text and may change freely.

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
automation, projection, and system executions cannot write settings, and one execution may make
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

### Signal Schedules

`signalSchedules` is optional and emits one of the plugin's actor-audience signals when a dated row
becomes due for a subscribed user. Each schedule has a local `slug`, the `signal`, a `subject`, and
a RyotQL `query` body shaped like a Calendar source query; its `where` clause decides eligibility.
`dueAt` names a projected date field with `date` or `instant` `precision`, `occurrence` a projected
text key, and `properties` maps signal properties to projected fields (null values are omitted).
Optional `delayDays` makes a row due that many days after `dueAt`; optional `freshness` defers rows
whose `confirmedAt` is older than `maxAgeHours`; optional `requiresProKey` limits delivery to servers
with a validated Pro key.

The kernel delivers each occurrence at most once per user on the user's reporting-timezone day, with
two catch-up days; older rows are skipped. See
[`modules/signal-schedules/README.md`](../../kernel/backend/src/modules/signal-schedules/README.md).

## Execution Authority

Ingestion assigns plugin scope (`system` or `user`); manifests do not. Execution subject identifies
whose data an invocation uses and does not widen plugin privilege. Kernel dispatch selects it, never
script input. Private plugins may initialize their own user entities through `userBootstrap`; they
cannot write global domain data or declare deployment-owned `httpRateLimits` or `oauthProviders`.

A `userBootstrap` entry either names a direct script or lists `entities`, each with a name, one of
the plugin's own entity schemas, and properties valid for it. The kernel ensures declared entities
itself, one per schema and user, without running a script. Use a script only when setup needs logic.

A `memberships` rule links the plugin's member entities to a bootstrap-declared target through one of
its relationship schemas, without a hook. `join` chooses what adds a member: creating one of the
listed `entityCreate` schemas, completing a provider import, writing any of its events, or adding it
to a kernel collection. An event whose `silentEventProperty` is `true` does not join. The kernel
writes the relationship in the same transaction as the source write. An optional
`recordEventSchemaSlug` event, which must belong to every member schema, is written for every new
relationship of that schema from a member, whoever creates it. Hooks still see those writes.

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

### Folds

Set `fold: { scriptSlug, eventSchemaSlugs }` on an entity schema to derive values from its subjects'
events in the transaction that writes them. An event of a listed slug belongs to its session entity when
the session's schema folds that slug, and otherwise to its own entity. Set
`projection: { propertiesSchema }` on an event or relationship schema to receive a value per record.

The fold is a read-only script of the same plugin using `FoldInput` and `FoldOutput` from
`@ryot-app/plugin-backend-sdk/folds`. It receives `{ subjectEntityId, value, absorbed }` and returns its
next `value`. `absorbed` lists the values of subjects merged or restored into this one, each with `ids`
mapping the entity and event IDs it holds to their new ones; carry over whatever must survive. It also returns one `events` entry per subject event with a projection, one `relationships` entry per link from
the subject with a projection, and `changes`, which the kernel applies before running it a second time.
That second run must return no changes. Fold-owned events skip before-policies and after-hooks. A fold
can defer to a job when the sandbox is busy, so it must compute the same result however late it runs.
For changes that do not come from the subject's events, call `host.requestFolds({ entityIds })` from a
user execution; the owning plugin may call `host.requestFoldsForAllUsers` when shared data changes. See
[folds](../../kernel/backend/src/modules/events/README.md#folds).

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

Before hooks use `defineAutomationPolicy` and `automationType: "policy"`. They apply to submitted
mutations, never to provider population, whose data the provider's `details` script shapes. They execute sequentially
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
state, logs, idempotency keys, and encryption keys are not account-backup data.

Create executable references with `defineScriptReference` and `defineWorkflowReference` from
`@ryot-app/plugin-backend-sdk/workflow`. `defineExecutableAlternatives({ id, stage, references })` and
`selectExecutable(alternatives, key)` constrain selection to registered targets. Use `stage: "settings"`
for setup choices and `stage: "record"` for choices refined from collected records. Configuration and
executable SDK methods must be called directly; method aliases are unsupported.

Long-running workflows declare a `checkpoint` schema. The kernel calls
`run(input, step, checkpoint, execution)` with `null` on the first step and the last saved value on
subsequent steps. Return the final output to finish, or `yield* step.save(nextState)` to commit the
next checkpoint and end this step. Keep each step bounded; use cursors and artifact references rather
than accumulating source records. A saved checkpoint survives process restarts without rerunning
completed steps. Code, configuration, input, and start time stay pinned for the whole execution.

```ts
export default defineWorkflow({
  manifest,
  input: importInput,
  output: importSummary,
  checkpoint: Schema.Struct({ nextPage: Schema.Int }),
  run: (input, step, checkpoint) =>
    Effect.gen(function* () {
      const nextPage = checkpoint?.nextPage ?? 0;
      const batch = yield* step.activity("read-page", readPage, { ...input, page: nextPage });
      yield* step.child("apply-page", applyPage, batch);
      if (batch.done) return yield* step.child("summary", summary, input);
      return yield* step.save({ nextPage: nextPage + 1 });
    }),
});
```

`step.activity` and `step.child` invoke declared script and workflow references. Their names are local
to the current checkpoint. The kernel retains call outcomes only for an unfinished step, so it can
complete interrupted calls without guessing whether an external write succeeded. Calls within that
step must remain deterministic. There is no public replay journal or durable sleep API. A bounded
workflow that finishes in one step can omit `checkpoint`.

Import writes still use immutable captures, stable batch identities, and kernel receipts. Save the
next cursor only after applying the batch and its required confirmation. Cancellation preserves
committed records; ambiguous external deliveries retain their existing retry policy.

An import source can declare `plan.selections`: each selection has a fixed `value`, or a top-level
settings `field` and finite `cases` mapping setting values to alternative keys. These selections are
validated against compiled dependencies. Plan selection is pure and returns an ingestion operation
and selection map; it performs no source requests or writes.

Ingestion setup loads `importSourcesRecipe({ limit })` and
`integrationProvidersRecipe({ limit })` from `@ryot-app/ryotql-recipes`.
Use `evaluateImportSourceReadiness(item, settings)` or
`evaluateIntegrationProviderReadiness(item, settings, integrationId?)` with the selected catalog item.
Their structured `readiness` contains `ready`, the selected `plan`, and `blockReasons`;
installation metadata scopes configuration to the exact system or private plugin.
Picker readiness covers unconditional requirements. Selected settings refine branch and account
connection requirements; backend admission rechecks them. Refresh the catalog after OAuth success
or configuration changes. Presence does not validate remote credentials.

Run reports use `@ryot-app/contract/modules/imports/ingestion`: each activity has its own ID, real unit,
completed count, optional exact total, last advancement, and wait. Batch outcomes count committed
records, never transport partitions or provider preparation. Issues retain structured reasons and
source/operation attribution without credentials, capture locators, raw bodies, or execution pins.
Run/issue recipes expose these reports and setup blocking directly. See
[imports](../../kernel/backend/src/modules/imports/README.md) for capture, expiry, cancellation, and
recovery lifetimes.

Batch candidates pin code/config before writing; sealed committed chunks determine their runs. Later plugin changes cannot add hooks
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

## Checkpoint Workflows

Workflow modules call declared activities and child workflows within a bounded step, then save the
next checkpoint or return their final output. Keep call order, names, and inputs deterministic within
an unfinished step. Move ambient time, randomness, network, filesystem, and ordinary host functions
into activity scripts. Use `Effect.fail` for expected failures. Runtime pinning, checkpoint persistence,
and private call recovery are described in the
[sandbox runtime reference](../../kernel/backend/src/modules/scripts/README.md).

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

`occursAtProperty` names one top-level string or datetime property as the entity's date. The kernel
stores it as the indexed `occursAt` column of the `entity` table on every write, and a malformed or
missing value stores null. A query whose root filters `occursAt` on both sides starts from that date
range, so use the column instead of casting the property for date windows. A revision can add the
declaration, which fills existing rows when it activates, but cannot change or remove it.

`editor: { relationships }` opts an entity schema into the kernel entity editor. Users can then
create and edit their own entities of that schema, together with the listed outgoing relationships,
through `EntityEditorScreen` and the kernel editor save; no plugin operation is involved. Each listed
slug must be a unique relationship schema declared in the same manifest whose source is this entity
schema. Omission means the schema has no editor. Adding, changing, or removing an editor is an
allowed evolution.

Crons target one script and use either `{ cron }` or `{ tier: "infrequent" }`. Boot entries target one
script and run once per server start. Both run with system subject through durable execution; dispatch
is skipped when `scheduler.disableDispatchers` is enabled. Boot scripts must be idempotent.

Operations map a public slug and `user` or `integration` auth to an `operation`-kind script.
Every operation declares a `title`, `input` and `output` JSON Schema documents, a description of its
behavior, and `hints: { readOnly, destructive, idempotent }`. The title is a short imperative phrase,
such as "Log measurement", that Ryo shows when a person approves the operation. Generate each document with
`operationJsonSchema(sharedEffectSchema)` from `@ryot-app/plugin-kit/operations`, importing the same
shared schemas that the script uses. The helper rejects opaque declarations and non-JSON types,
retains referenced definitions, and describes the encoded wire values as draft 2020-12 JSON Schema.
It publishes representable structural constraints; custom business checks such as timestamp ordering
remain authoritative runtime Effect validation. Passing the published schema does not guarantee that
the script decoder or business validation will accept the input.

`readOnly` describes actual effects, independently of `demoAccess`. Read-only operations must be
non-destructive and idempotent. A writing operation may also be idempotent, including a destructive
write whose repetition has no additional effect. Descriptions should explain writes, deletes,
conflicts, and per-item misses so people and tool clients can choose operations safely.

Refuse a request that cannot succeed as submitted with `OperationRejectedError(message)`; the caller
receives the message (HTTP 422) instead of a generic runtime failure (HTTP 502). Import
sources map strict input schemas to workflows. Uploads are top-level string fields with upload format;
the kernel validates each file and exposes it by field name for `readNamedArtifact(key)`. Payload-only
sources use ordinary fields.

## Recipes

`@ryot-app/plugin-kit/operations` provides an Effect-based typed operation invoker.
`defineOperationRecipe` pins the package ID, operation slug, and input/output Effect Schemas;
`invokeOperationRecipe` encodes input, calls the supplied transport, and decodes output.
