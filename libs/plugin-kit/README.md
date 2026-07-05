# Plugin Kit

`@ryot/plugin-kit/manifest` provides the schemas and types used to declare plugins.

## Crons

The `crons` manifest section declares scheduled sandbox drivers:

```ts
crons: [
	{
		slug: "refresh-trending",
		schedule: "0 * * * *",
		driverRef: "refresh-trending",
		description: "Refresh trending data",
	},
];
```

`slug` and `driverRef` use sandbox manifest slug syntax. `schedule` and `description` must be
non-empty strings without surrounding whitespace. `driverRef` is the slug of a script declared in
the manifest's `scripts` section; the plugin loader verifies that its compiled definition exposes
a `cron` driver.

## Operations

The `operations` manifest section declares invocable sandbox drivers exposed through
`plugins.invoke`:

```ts
operations: [
	{
		auth: "user",
		slug: "resolve-episodes",
		driverRef: "resolve-episodes",
		description: "Resolve show and podcast episode references to entity ids",
	},
];
```

`slug` and `driverRef` use sandbox manifest slug syntax. `auth` is one of `"user"`, `"admin"`, or
`"integration"` and declares who may invoke the operation. `driverRef` is the slug of an
`operation`-kind script declared in the manifest's `scripts` section; the operation exposes a
single driver under the conventional name `operation`. Author the driver module with the
`defineOperation` helper from `@ryot/sandbox-sdk/core` wrapping generic `defineDriver` drivers.

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
