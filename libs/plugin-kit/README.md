# Plugin Kit

`@ryot/plugin-kit/manifest` provides the schemas and types used to declare plugins.

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
		lot: "script",
		slug: "refresh-trending",
		schedule: { cron: "0 * * * *" },
		scriptSlug: "refresh-trending",
		description: "Refresh trending data",
	},
	{
		lot: "workflow",
		slug: "sweep-monitoring",
		schedule: { tier: "infrequent" },
		workflowSlug: "media-monitoring-sweep",
		description: "Sweep monitored media",
	},
];
```

`slug` and the target slug use sandbox manifest slug syntax. `description` must be a non-empty
string without surrounding whitespace. `schedule` is an object: either `{ cron }` with an explicit
non-empty crontab expression, or `{ tier: "infrequent" }` to defer the interval to the host's
configured infrequent schedule. A `lot: "script"` cron targets exactly one `scriptSlug` declared in
`scripts`. A `lot: "workflow"` cron instead targets exactly one `workflowSlug` declared in
`workflows`; the scheduler runs it with system authority and awaits its terminal durable result.

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
