import type { PluginManifest } from "@ryot-app/contract/modules/plugins/manifest";

export const fixturePackageRoot = (kind: "diagnostic" | "valid" = "valid") =>
	new URL(`./test-fixtures/${kind}`, import.meta.url).pathname;

export const fixturePluginIdentity = (slug = "fixture") =>
	({ slug, ownerId: null, scope: "system", id: `${slug}-plugin-id` }) as const;

export const fixtureManifest = () =>
	({
		savedViews: [],
		httpRateLimits: [],
		crons: [] as PluginManifest["crons"],
		workflows: [] as PluginManifest["workflows"],
		providers: [] as PluginManifest["providers"],
		operations: [] as PluginManifest["operations"],
		configSchema: { fields: {}, unknownKeys: "strict" },
		userBootstrap: [] as PluginManifest["userBootstrap"],
		importSources: [] as PluginManifest["importSources"],
		integrationProviders: [] as PluginManifest["integrationProviders"],
		metadata: {
			icon: "box",
			name: "Fixture",
			slug: "fixture",
			version: "1.0.0",
			description: "Fixture plugin",
		},
		relationshipSchemas: [
			{
				name: "Fixture Link",
				slug: "fixture-link",
				propertiesSchema: { fields: {} },
				sourceEntitySchemaSlug: "fixture-entity",
				targetEntitySchemaSlug: "fixture-entity",
			},
		],
		signalSchemas: [
			{
				name: "Fixture Signal",
				slug: "fixture.signal",
				catalogState: "active",
				propertiesSchema: { fields: {} },
				audiencePolicy: { kind: "actor" },
				notificationHookSlug: "fixture.automation",
			},
		],
		hooks: [
			{
				stage: "after",
				delivery: "async",
				slug: "fixture.automation",
				name: "Fixture automation",
				scriptSlug: "fixture.automation",
				targets: [
					{ resource: "entity", operation: "create", entitySchemaSlug: "fixture-entity" },
					{ operation: "emit", resource: "signal", signalSchemaSlug: "fixture.signal" },
				],
			},
		] as PluginManifest["hooks"],
		scripts: [
			{
				capabilities: [],
				kind: "automation",
				name: "Fixture Automation",
				slug: "fixture.automation",
				automationType: "automation",
				requiredPluginConfigKeys: [],
				requiredSystemConfigKeys: [],
				entry: "backend/automations/fixture.sandbox.ts",
				inputProjection: {
					signal: { properties: [] },
					entity: { properties: [], compareProperties: [], parentEntityProperties: [] },
				},
			},
		],
		entitySchemas: [
			{
				icon: "box",
				name: "Fixture",
				slug: "fixture-entity",
				eventSchemas: [
					{
						name: "Changed",
						slug: "changed",
						propertiesSchema: {
							fields: { value: { type: "string", label: "Value", description: "Changed value" } },
						},
					},
				],
				propertiesSchema: {
					fields: {
						name: { label: "Name", type: "string", description: "Fixture name" },
						kind: {
							type: "enum",
							label: "Kind",
							description: "Fixture kind",
							choices: { kind: "static", values: [{ value: "one" }, { value: "two" }] },
						},
					},
				},
			},
		],
	}) satisfies PluginManifest;
