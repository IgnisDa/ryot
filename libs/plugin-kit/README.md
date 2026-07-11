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
