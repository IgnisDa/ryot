# Plugin Kit

`@ryot-app/plugin-kit/manifest` provides the schemas and types used to declare plugins.

The manifest is strict: every authored section is required, even when its value is an empty array,
and unknown fields are rejected. `definePlugin` preserves literal types while checking this contract.
It accepts the authored manifest; `scripts` is derived at build time and belongs only to the built
manifest inside the archive.
Sandbox slugs use lowercase letters and numbers separated by `.`, `_`, or `-`; `/` is reserved.

## Package Layout

A plugin package has four roots, split by who consumes the code:

| Root       | Archived | Contents                                                                                     |
| ---------- | -------- | -------------------------------------------------------------------------------------------- |
| `host/`    | No       | The manifest and everything the Ryot server or web client imports directly from the package. |
| `backend/` | Yes      | Sandbox sources. Every `*.sandbox.ts` is an entrypoint; sibling modules are its libraries.   |
| `client/`  | Yes      | The client bundle, present only when the manifest declares `client`.                         |
| `shared/`  | Yes      | Environment-neutral `.ts` sources importable from both `backend/` and `client/`.             |

`backend/` and `client/` are self-contained: they import workspace packages, their own siblings, and
`shared/`, never `host/`. `shared/` may import only `shared/` siblings and the environment-neutral
`@ryot-app/plugin-kit/{effect,ryotql,schema}` entry points — never `host/`, `backend/`, or `client/`.
Production `host/` code reaches into the sandbox tree only through `backend/contracts/**`, which holds
the sandbox-owned schemas, recipes, and helpers that host callers also need; tests are not archived
and may cross freely. Nothing host-only belongs under `backend/`, because the archive ships that tree
verbatim.

`host/` holds `plugin.ts` (the manifest, and the package's `.` export), `config.ts`, `saved-views.ts`,
`import-sources.ts`, `query-recipes.ts`, and `schemas/` for entity, property, relationship, and signal
declarations. Tests colocate with their subject in every root.

### Backend Areas

`backend/` groups entrypoints with the libraries they call, one directory per area — `automations/`,
`bootstrap/`, `imports/`, `integrations/`, `operations/`, `workflows/`, and `providers/`. Cross-area
helpers live in `backend/lib/`, and per-vendor HTTP and mapping helpers shared across providers live
in `backend/lib/vendors/<vendor>.ts`.

Provider entrypoints are addressed by path. The directory path under `backend/providers/` **is** the
provider slug, with `/` standing in for `.`, and the file name is the operation:

```
backend/providers/<provider slug path>/<operation>.sandbox.ts
```

So `backend/providers/movie/tmdb/details.sandbox.ts` is the `details` operation of provider
`movie.tmdb`, and a single-segment slug uses a single directory. A basename outside the operation set
(`details`, `search`, `search-options`, `resolve`, `translate`) is a provider-associated `script`
rather than a provider operation. Modules shared inside one provider directory use local names such as
`shared.ts`, since the directory already names the provider.

### Script Discovery

`scripts` is not authored. `definePlugin` rejects it: every `*.sandbox.ts` file under `backend/` is an
entrypoint, and `ryot plugin build` compiles each one, reads `slug`, `name`, `kind`, `capabilities`,
and the two config-key lists out of its `defineManifest`, takes `providerOperation` from its
`defineProvider` call, and derives `entry` and `providerSlug` from the file's path. The assembled
`scripts` array is written into the archive's `manifest.json` and validated against `PluginManifest`
along with the rest of the manifest, so a cron, binding, or provider operation naming a script that
does not exist fails the build.

Installation recomputes the same list from the archive's sources and rejects a package whose
`manifest.json` disagrees, so a hand-edited archive cannot widen what a script declares.

Everything else in the manifest still names scripts by slug, and a script's slug lives in its own
module — renaming a slug therefore means updating the manifest references to it.

## Shared Sources

`shared/**` accepts `.ts` only — no `.tsx`, since shared code runs in the sandbox as well as the
browser. Its only permitted bare imports are the environment-neutral entry points
`@ryot-app/plugin-kit/effect`, `@ryot-app/plugin-kit/ryotql`, and `@ryot-app/plugin-kit/schema`; a
relative import must stay inside `shared/`. Both `@ryot-app/sandbox-compiler` and
`@ryot-app/client-plugin-compiler` resolve these same three files when they check a plugin's shared
sources, so the two engines' enforcement cannot drift from each other, and each closes an explicit
root rule against the other's bare imports: a `shared/` file reaching for `@ryot-app/sandbox-sdk/*`
fails the client check, and one reaching for `@ryot-app/client-sdk/*` fails the sandbox check.

`@ryot-app/plugin-kit/ryotql` re-exports `@ryot-app/ryotql`, `IsoDateString`, and four event helpers
(`eventIsAfter`, `eventOrderAscending`, `eventOrderDescending`, `latestEventField`) — nothing more. It
must never widen to the `@ryot-app/ryotql-recipes` barrel; that barrel pulls in the contract runtime,
which is exactly why the event helpers live in their own `event-expressions.ts` module instead of
being re-exported from it. `@ryot-app/plugin-kit/schema` stays a few KB of brands and asset-locator
schemas, bundled directly into every consumer. `@ryot-app/plugin-kit/effect` re-exports only
`DateTime`, `Option`, `Result`, `Schema`, and `SchemaGetter` from `effect`, matching the narrow shim
the client bundler serves for plain `effect` imports.

On the sandbox side, `@ryot-app/plugin-kit/effect` and `@ryot-app/plugin-kit/ryotql` are aliased onto
the runtime modules the sandbox already ships (`effect-*.mjs` and `ryotql-workspace.mjs`) rather than
emitting a second copy; only `@ryot-app/plugin-kit/schema` is bundled into a backend script. This
matters for size: anything not aliased onto an existing runtime module gets bundled into every backend
script and charged against its 1 MiB budget, so aliasing here avoids inlining a second copy of RyotQL
into every backend artifact.

A plugin with no client entry never runs the client compiler, so a `shared/**` file reachable from no
declared sandbox entry either is checked by neither compiler engine — a known gap in coverage, not
something either engine closes on its own. A plugin with both a client entry and backend entries that
import the same shared modules has every shared file checked twice.

## Manifest Reference

| Section                | Purpose                                                                                                                        |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `metadata`             | Package `slug`, `name`, `description`, `version`, and `icon`.                                                                  |
| `configSchema`         | Plugin-owned environment configuration available to declared scripts and import sources.                                       |
| `scripts`              | Derived, not authored. Sandbox source entries, definition kinds, capabilities, and configuration requirements.                 |
| `providers`            | Logical provider identities and their required `details` plus optional `search`, `resolve`, and `translate` operation scripts. |
| `workflows`            | Public logical workflow slugs mapped to `workflow`-kind scripts.                                                               |
| `operations`           | Public operation slugs mapped to `operation`-kind scripts with `user` or `integration` auth.                                   |
| `boot`                 | Restart-time, system-subject script dispatches.                                                                                |
| `userBootstrap`        | Per-user bootstrap dispatches for system-scope plugins.                                                                        |
| `crons`                | Scheduled sandbox script dispatches.                                                                                           |
| `importSources`        | Payload, single-file, or named-file import inputs mapped to workflows.                                                         |
| `httpRateLimits`       | Deployment-global static request limits keyed by normalized external HTTP(S) origins.                                          |
| `integrationProviders` | `push`, `sink`, or `yank` integration definitions and settings schemas. `sink` and `yank` map to scripts; `push` does not.     |
| `entitySchemas`        | Entity definitions, nested event schemas, optional user-state restrictions, and optional merge identity properties.            |
| `relationshipSchemas`  | Typed source/target relationship definitions. A null endpoint is unconstrained.                                                |
| `signalSchemas`        | Signal definitions, audience policy, catalog state, and notification formatter script.                                         |
| `savedViews`           | Plugin-owned query documents and display configuration.                                                                        |
| `bindings`             | Entity, event, relationship, and signal automation bindings plus entity-schema/provider links.                                 |

Script, provider, workflow, user-bootstrap, import-source, and integration-provider slugs are unique
in the scopes enforced by `PluginManifest`. Every referenced script, workflow, provider, and config
key must exist. Active plugins additionally share global script, provider, import-source, and
integration-provider slug namespaces. Entity and relationship schema evolution is additive.

## HTTP Rate Limits

Every manifest includes `httpRateLimits`, using `[]` when it declares no constrained origin. Each
entry has this strict shape; extra fields are rejected:

```ts
httpRateLimits: [
	{
		requests: 90,
		intervalMs: 60_000,
		key: "anilist",
		origins: ["https://graphql.anilist.co"],
	},
];
```

`key` is a non-empty lowercase sandbox slug. `requests` and `intervalMs` are positive safe integers.
`origins` must be non-empty and contain only HTTP(S) URL origins: no path, query, fragment,
credentials, or wildcard hostname. Origins are normalized by the URL parser. Keys and normalized
origins must each be unique within one manifest.

Declarations are deployment-global, not scoped to a plugin script, provider row, user, credential,
or operation. At installation and reingestion, the complete active manifest set is validated:
identical canonical declarations from multiple plugins coexist, while declarations that share a key
or origin but differ in any field reject the prospective snapshot. A committed live manifest update
affects subsequent reservations, including calls from already-running workflows. Matching is by the
normalized origin of each `httpCall` URL; scripts neither select nor name policies at call sites.

The policy is an evenly spaced global schedule with no configurable burst, fairness, priority, or
reserved capacity guarantee. Unmatched origins remain unrestricted by this limiter. For matched
traffic only, a generic HTTP `429` uses `Retry-After` when valid, otherwise the declaration interval,
then durably retries. Other failures are returned without an automatic retry.

## Script Kinds And Entrypoints

Every derived `scripts` item carries `entry`, `slug`, `name`, `kind`, `capabilities`,
`requiredPluginConfigKeys`, and `requiredSystemConfigKeys`. A `script` under `backend/providers/`
also carries `providerSlug`; a `provider` carries both `providerSlug` and `providerOperation`.

| Kind         | Authoring helper   | Use                                                                       |
| ------------ | ------------------ | ------------------------------------------------------------------------- |
| `script`     | `defineScript`     | Direct boot, cron, bootstrap, or internal execution.                      |
| `operation`  | `defineOperation`  | Public `plugins.invoke` entrypoint.                                       |
| `workflow`   | `defineWorkflow`   | Deterministic durable orchestration; manifest capabilities must be empty. |
| `automation` | `defineAutomation` | Policy or subscription binding.                                           |
| `provider`   | `defineProvider`   | One logical provider operation.                                           |

Each entry is a complete ES module that default-exports exactly one direct definition containing its
static manifest, input schema, output schema, and Effect-returning `run`. That static manifest is the
single source of the script's metadata. There are no driver maps, conventional driver names, or runtime
selection inside a module. The matching `@ryot-app/sandbox-sdk` kind-specific entrypoint owns exact
input/output contracts.

### Logical Providers

A provider is logical identity, not executable module. Its `operations` object points each supported
operation at a distinct `provider`-kind script whose `providerSlug` and `providerOperation` agree.
`details` is mandatory; `search`, `resolve`, and `translate` are optional. Each provider script can be
versioned independently while callers continue addressing provider ID plus operation. A plain
`script` may join provider identity with `providerSlug`; omitting it makes that script
standalone within its plugin.

`rootEntitySchemaSlug` may reference an entity schema declared by the same plugin. For a user-installed
plugin, provider population resolves entity and relationship schemas from that owner's effective
installation set and writes user-scoped entities. Private definitions are not added to the process-wide
system definition registry and are not visible to other users. System plugin providers continue to
resolve system definitions and write global entities.

User-facing provider catalogs are also resolved from the caller's effective plugin installation set.
Ready, enabled private providers appear only for their owner; process-wide loader snapshots are not a
source of private provider metadata.

Authenticated imports and mutations resolve kernel, installed system-plugin, and ready private-plugin
definitions as one user-effective snapshot. They never fall back to the system registry. APIs without
user context may only resolve system definitions and write global entities. Persisted entity, event, and
relationship provenance uses the stable plugin ID, not the user's installation ID.

## Subject And Capabilities

Plugin scope is not declared in the manifest. Ingestion establishes `system` or `user`, and this is
the single plugin trust classification. `SandboxExecutionSubject` is separate: it describes whose
data and context an execution uses, not plugin privilege. User manifests cannot declare entries in
`boot`, `userBootstrap`, or `httpRateLimits`, and cannot use a system plugin slug.

Kernel dispatch chooses the execution subject; script input cannot choose or widen it.

| Entry path                                                   | Subject                                                                             |
| ------------------------------------------------------------ | ----------------------------------------------------------------------------------- |
| `boot` and crons                                             | System                                                                              |
| `userBootstrap`                                              | User being initialized                                                              |
| User and integration operations                              | Authenticated user; integration operations also carry validated integration context |
| Import workflows and provider work reached from user actions | Calling user                                                                        |
| Automation subscriptions                                     | Subscription subject with trusted run metadata                                      |
| Durable script requests and child workflows                  | Subject propagated by their durable parent                                          |

`capabilities` is an allowlist, not a grant by itself. The backend intersects it with implemented host
functions and one backend-owned capability policy keyed by definition kind, subject, plugin scope,
provider association, and bootstrap designation. Domain modules still enforce schema, provider, user,
and integration ownership. Declare only methods used by the module. `artifact-read` and `scratch`
request filesystem grants rather than bridge methods.
Workflow scripts declare `[]` and receive only durable replay primitives. Host-function scope,
filesystem behavior, and exact limits are owned by the
[sandbox runtime reference](../../kernel/backend/src/lib/infrastructure/sandbox-runtime/README.md).

## Cache Identity

Provider-associated `script` and `provider` entries use logical provider ID as cache
namespace, so all scripts for that provider share cache state. A standalone script uses its immutable
script ID instead. Both are further isolated by executing user, not plugin ownership. Exact cache key,
TTL, and restart semantics are owned by the
[sandbox runtime reference](../../kernel/backend/src/lib/infrastructure/sandbox-runtime/README.md#host-functions).

## Workflow Determinism

Workflow modules orchestrate only `activity`, `sleep`, and child-workflow durable calls. Keep call
order, call names, referenced slugs, and inputs deterministic across replay. Do not read ambient time,
randomness, network, filesystem, mutable globals, or ordinary host functions in a workflow; move that
work into an ordinary script invoked through `replay.activity`. Use `Effect.fail` for expected workflow
failures, not `throw`. When app-owned
workflows dispatch child workflows, deterministic execution-ID construction and single durable
ownership are specified in [the Effect workflow guide](../../docs/effect-workflow-guide.md).
Runtime pinning and replay behavior are owned by the
[sandbox runtime reference](../../kernel/backend/src/lib/infrastructure/sandbox-runtime/README.md#durable-workflow-semantics).

## Batch First

Prefer one bounded host call over per-item calls. Use array-oriented APIs such as `createEvents`,
`ensureUserEntities`, `changeUserRelationships`, `upsertGlobalEntities`, and
`upsertGlobalRelationships`; group query work where its contract permits. Chunk only at documented
SDK or runtime limits. Do not hide N+1 bridge traffic behind unbounded Effect concurrency: each call
consumes host-call budget and only four may be in flight per execution.

## Lifecycle And Hot Loading

Ingestion validates the full prospective registry, compiles every entry, persists immutable
content-addressed scripts, then atomically replaces the active in-memory snapshot. Reinstalling one
plugin slug hot-loads its new package without restart; readers observe either complete old snapshot
or complete new snapshot. Existing durable workflow executions retain pinned workflow/step versions,
while new resolution uses active snapshot.

System-scope plugins are deployment-controlled and cannot be uninstalled through the user
installation path. User-scope plugins can be uninstalled only when no running/suspended workflow,
entity, active schema, or binding still references them. Script rows and materialized modules remain live while active packages,
source-zero, or durable references need their content hashes; runtime reference owns GC details.
Callers may retry uninstall while a running or suspended workflow releases its reference after
terminal completion. Other conflicts require explicit removal of the reported persistent reference
and must not be treated as polling state.

This is package authoring and deployment-controlled system-install behavior only. Phase 5 owns user-level
installation, package-versus-installation identity, per-user visibility/state, assigned namespaces,
capability approval, quotas, SSRF hardening, scheduler scope, shared-global-data policy, package GC,
signing/attestation, marketplace concerns, and uninstall data policy beyond refusal while referenced.
There is no separate per-user standalone-script authoring path.

## Configuration

Every manifest declares a `configSchema` for plugin-owned environment configuration. It uses the
canonical `AppSchema` format with `unknownKeys: "strict"` and top-level string, number, integer,
boolean, or enum fields. Fields support labels, descriptions, secrets, defaults, and their ordinary
validation. Nested values, arrays, dates, translation, normalization, and schema rules are not allowed.
Every `requiredPluginConfigKeys` entry on a script or import source must name a declared field.

Other manifest property schemas may declare numeric `normalize.round.scale`; decoding applies
half-up rounding before validation.
Scripts separately declare `requiredSystemConfigKeys` for host-owned configuration.

## Entity Merge Identity

An entity schema may declare `mergeIdentityProperties`, listing top-level property names that must
have equal persisted JSON values before user state can be merged between two entities. Each name
must be non-empty, unique, and present in the entity's `propertiesSchema.fields`. Schemas that omit
the declaration have no property-based merge restriction.

## Crons

The `crons` manifest section declares scheduled sandbox scripts:

```ts
crons: [
	{
		slug: "refresh-trending",
		schedule: { cron: "0 * * * *" },
		scriptSlug: "refresh-trending",
		description: "Refresh trending data",
	},
	{
		slug: "sweep-monitoring",
		schedule: { tier: "infrequent" },
		scriptSlug: "media-monitoring-sweep",
		description: "Sweep monitored media",
	},
];
```

`slug` and the target slug use sandbox manifest slug syntax. `description` must be a non-empty
string without surrounding whitespace. `schedule` is an object: either `{ cron }` with an explicit
non-empty crontab expression, or `{ tier: "infrequent" }` to defer the interval to the host's
configured infrequent schedule. Each cron targets exactly one `scriptSlug` declared in `scripts`.
The scheduler runs every target through the universal sandbox workflow with system subject and
awaits its terminal durable result.

## Boot

The `boot` manifest section declares sandbox scripts the kernel dispatches once per server start —
one-time catalog seeding rather than periodic work:

```ts
boot: [
	{
		slug: "preload-catalog",
		scriptSlug: "preload-catalog",
		description: "Seed the built-in catalog",
	},
];
```

`slug` and `scriptSlug` use sandbox manifest slug syntax; `description` must be a non-empty string
without surrounding whitespace. A boot entry has no `schedule`. `scriptSlug` is the slug of a script
declared in the manifest's `scripts` section. Dispatch happens once per server start, after plugin
ingestion, with system subject. The dispatcher layer awaits every entry's durable execution while
it builds, but it is merged alongside the HTTP server layer rather than sequenced ahead of it, so the
server can begin serving while boot work is still in flight. A failing entry is logged without
failing the others. Dispatch is skipped entirely when `scheduler.disableDispatchers` is set (the same
flag the scheduler honors).
Idempotency (preserve-existing writes, a bound such as `maximumTotal`) stays with the script, since
a restart re-runs every boot entry.

## Operations

The `operations` manifest section declares invocable sandbox scripts exposed through
`plugins.invoke`:

```ts
operations: [
	{
		auth: "user",
		slug: "resolve-episodes",
		scriptSlug: "operation.resolve-episodes",
		description: "Resolve show and podcast episode references to entity ids",
	},
];
```

`slug` and `scriptSlug` use sandbox manifest slug syntax. `auth` is either `"user"` or
`"integration"` and declares who may invoke the operation. `scriptSlug` is the slug of an
`operation`-kind script declared in the manifest's `scripts` section. Author that script as one
direct definition — `{ manifest, input, output, run }` — with the `defineOperation` helper from
`@ryot-app/sandbox-sdk/operation`; there is no driver map and no conventional driver name.

## Import Sources

Import sources declare a strict `inputSchema`. Upload fields are top-level string fields with an
upload format. A source with one upload can use a field such as `uploadToken`:

```ts
importSources: [
	{
		slug: "goodreads",
		name: "Goodreads",
		workflowSlug: "import",
		description: "Import a Goodreads export",
		requiredPluginConfigKeys: [],
		inputSchema: {
			unknownKeys: "strict",
			fields: {
				uploadToken: {
					position: 0,
					type: "string",
					label: "Export file",
					description: "Goodreads library export CSV",
					validation: { minLength: 1, required: true },
					format: { kind: "upload", allowedFileExtensions: ["csv"] },
				},
			},
		},
	},
];
```

For multiple uploads, declare one top-level upload field per artifact in the same `inputSchema`:

```ts
inputSchema: {
	unknownKeys: "strict",
	fields: {
		historyUploadToken: {
			position: 0,
			type: "string",
			label: "History export",
			description: "History CSV",
			validation: { minLength: 1, required: true },
			format: { kind: "upload", allowedFileExtensions: ["csv"] },
		},
		ratingsUploadToken: {
			position: 1,
			type: "string",
			label: "Ratings export",
			description: "Ratings CSV",
			validation: { minLength: 1, required: true },
			format: { kind: "upload", allowedFileExtensions: ["csv"] },
		},
	},
},
```

The kernel validates each upload using its field declaration, then exposes the declared artifact
to the sandbox under the input-schema field name. Import scripts use `readNamedArtifact(key)` for
that field name. Payload-only sources use an `inputSchema` with ordinary non-upload fields and no
file fields.

## Recipes

`@ryot-app/plugin-kit/operations` provides a transport-agnostic, Effect-based typed invoker so callers
can invoke an operation without depending on a specific HTTP client. `defineOperationRecipe` pins
the `pluginSlug`, `operationSlug`, and the `input`/`output` Effect Schemas; `invokeOperationRecipe`
encodes the input, hands the payload to the supplied `transport`, and decodes the result against
the output schema:

```ts
const recipe = defineOperationRecipe({
	pluginSlug: "media",
	input: ResolveEpisodesInput,
	output: ResolveEpisodesOutput,
	operationSlug: "resolve-episodes",
});

const result = invokeOperationRecipe(recipe, { refs }, transport);
```
