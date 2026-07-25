# Plugin Kit

`@ryot/plugin-kit/manifest` provides the schemas and types used to declare plugins.

The manifest is strict: every top-level section is required, even when its value is an empty array,
and unknown fields are rejected. `definePlugin` preserves literal types while checking this contract.
Sandbox slugs use lowercase letters and numbers separated by `.`, `_`, or `-`; `/` is reserved.

## Manifest Reference

| Section                | Purpose                                                                                                                        |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `metadata`             | Package `slug`, `name`, `description`, `version`, `icon`, and `accentColor`.                                                   |
| `configSchema`         | Plugin-owned environment configuration available to declared scripts and import sources.                                       |
| `scripts`              | Sandbox source entries, definition kinds, capabilities, and configuration requirements.                                        |
| `providers`            | Logical provider identities and their required `details` plus optional `search`, `resolve`, and `translate` operation scripts. |
| `workflows`            | Public logical workflow slugs mapped to `workflow`-kind scripts.                                                               |
| `operations`           | Public operation slugs mapped to `operation`-kind scripts with `user` or `integration` auth.                                   |
| `boot`                 | Restart-time, system-authority script dispatches.                                                                              |
| `userBootstrap`        | Per-user bootstrap dispatches for trusted boot-configured plugins.                                                             |
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

Every `scripts` item declares `entry`, `slug`, `name`, `kind`, `capabilities`,
`requiredPluginConfigKeys`, and `requiredSystemConfigKeys`. `script` may optionally declare
`providerSlug`; `provider` must declare both `providerSlug` and `providerOperation`.

| Kind         | Authoring helper   | Use                                                                       |
| ------------ | ------------------ | ------------------------------------------------------------------------- |
| `script`     | `defineScript`     | Direct boot, cron, bootstrap, or internal execution.                      |
| `operation`  | `defineOperation`  | Public `plugins.invoke` entrypoint.                                       |
| `workflow`   | `defineWorkflow`   | Deterministic durable orchestration; manifest capabilities must be empty. |
| `automation` | `defineAutomation` | Policy or subscription binding.                                           |
| `provider`   | `defineProvider`   | One logical provider operation.                                           |

Each entry is a complete ES module that default-exports exactly one direct definition containing its
static manifest, input schema, output schema, and Effect-returning `run`. The entry's static manifest
must match its `scripts` metadata. There are no driver maps, conventional driver names, or runtime
selection inside a module. The matching `@ryot/sandbox-sdk` kind-specific entrypoint owns exact
input/output contracts.

### Logical Providers

A provider is logical identity, not executable module. Its `operations` object points each supported
operation at a distinct `provider`-kind script whose `providerSlug` and `providerOperation` agree.
`details` is mandatory; `search`, `resolve`, and `translate` are optional. Each provider script can be
versioned independently while callers continue addressing provider ID plus operation. A plain
`script` may join provider identity with `providerSlug`; omitting it makes that script
standalone within its plugin.

## Authority And Capabilities

Trusted kernel dispatch chooses execution authority; script input cannot choose or widen it.

| Entry path                                                   | Authority                                                                           |
| ------------------------------------------------------------ | ----------------------------------------------------------------------------------- |
| `boot` and crons                                             | System                                                                              |
| `userBootstrap`                                              | User being initialized                                                              |
| User and integration operations                              | Authenticated user; integration operations also carry validated integration context |
| Import workflows and provider work reached from user actions | Calling user                                                                        |
| Automation subscriptions                                     | Subscription authority with trusted run metadata                                    |
| Durable script requests and child workflows                  | Authority propagated by their durable parent                                        |

`capabilities` is an allowlist, not a grant by itself. Runtime intersects it with implemented host
functions, definition kind, authority, and trusted execution markers. Declare only methods used by
the module. `artifact-read` and `scratch` request filesystem grants rather than bridge methods.
Workflow scripts declare `[]` and receive only durable replay primitives. Host-function scope,
filesystem behavior, and exact limits are owned by the
[sandbox runtime reference](../../apps/app-backend/src/lib/infrastructure/sandbox-runtime/README.md).

## Cache Identity

Provider-associated `script` and `provider` entries use logical provider ID as cache
namespace, so all scripts for that provider share cache state. A standalone script uses its immutable
script ID instead. Both are further isolated by executing user, not plugin ownership. Exact cache key,
TTL, and restart semantics are owned by the
[sandbox runtime reference](../../apps/app-backend/src/lib/infrastructure/sandbox-runtime/README.md#host-functions).

## Workflow Determinism

Workflow modules orchestrate only `activity`, `sleep`, and child-workflow durable calls. Keep call
order, call names, referenced slugs, and inputs deterministic across replay. Do not read ambient time,
randomness, network, filesystem, mutable globals, or ordinary host functions in a workflow; move that
work into an ordinary script invoked through `replay.activity`. Use `Effect.fail` for expected workflow
failures, not `throw`. When app-owned
workflows dispatch child workflows, deterministic execution-ID construction and single durable
ownership are specified in [the Effect workflow guide](../../docs/effect-workflow-guide.md).
Runtime pinning and replay behavior are owned by the
[sandbox runtime reference](../../apps/app-backend/src/lib/infrastructure/sandbox-runtime/README.md#durable-workflow-semantics).

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

Boot-configured trusted plugins are global and cannot be uninstalled. Other globally installed
plugins can be uninstalled only when no running/suspended workflow, entity, active schema, or binding
still references them. Script rows and materialized modules remain live while active packages,
source-zero, or durable references need their content hashes; runtime reference owns GC details.

This is package authoring and global trusted-install behavior only. Phase 5 owns user-level
installation, package-versus-installation identity, per-user visibility/state, assigned namespaces,
capability approval, quotas, SSRF hardening, scheduler scope, shared-global-data policy, package GC,
signing/attestation, marketplace concerns, and uninstall data policy beyond refusal while referenced.
There is no separate per-user standalone-script authoring path.

## Configuration

Every manifest declares a `configSchema` for plugin-owned environment configuration. It uses the
canonical `AppSchema` format with `unknownKeys: "strict"` and top-level string, number, integer,
boolean, or enum fields. Fields support labels, descriptions, secrets, defaults, and their ordinary
validation. Nested values, arrays, dates, translation, transforms, and schema rules are not allowed.
Every `requiredPluginConfigKeys` entry on a script or import source must name a declared field.
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
The scheduler runs every target through the universal sandbox workflow with system authority and
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
ingestion, with system authority. The dispatcher layer awaits every entry's durable execution while
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
`@ryot/sandbox-sdk/operation`; there is no driver map and no conventional driver name.

## Import Sources

File-backed import sources declare either one artifact or a set of named artifacts:

```ts
importSources: [
	{
		input: "file",
		lot: "single",
		allowedFileExtensions: ["csv"],
		// slug, name, description, workflowSlug, requiredPluginConfigKeys
	},
	{
		input: "file",
		lot: "named",
		artifacts: [
			{
				key: "historyFilePath",
				required: true,
				allowedFileExtensions: ["csv"],
				uploadTokenField: "historyUploadToken",
			},
		],
		// slug, name, description, workflowSlug, requiredPluginConfigKeys
	},
];
```

The kernel claims and validates each upload using its declaration, then exposes only declared
artifacts to the sandbox. Single-file scripts use `readArtifact()`. Named-file scripts use
`readNamedArtifact(key)`, where `key` is also the stable source-payload path identity. Named keys
and upload-token fields must be unique within a source. Payload-only sources use `input: "payload"`
and have no file lot.

## Recipes

`@ryot/plugin-kit/operations` provides a transport-agnostic, Effect-based typed invoker so callers
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
