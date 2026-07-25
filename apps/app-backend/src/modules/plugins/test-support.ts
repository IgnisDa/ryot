import type { PluginManifest } from "@ryot/contract/modules/plugins/manifest";

export const fixturePackageRoot = (kind: "diagnostic" | "valid" = "valid") =>
	new URL(`./test-fixtures/${kind}`, import.meta.url).pathname;

export const fixtureManifest = () =>
	({
		savedViews: [],
		httpRateLimits: [],
		boot: [] as PluginManifest["boot"],
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
			accentColor: "blue",
			description: "Fixture plugin",
		},
		entitySchemas: [
			{
				icon: "box",
				name: "Fixture",
				accentColor: "blue",
				slug: "fixture-entity",
				propertiesSchema: {
					fields: {
						name: { type: "string", label: "Name", description: "Fixture name" },
						kind: {
							type: "enum",
							label: "Kind",
							options: ["one", "two"],
							description: "Fixture kind",
						},
					},
				},
				eventSchemas: [
					{
						name: "Changed",
						slug: "changed",
						propertiesSchema: {
							fields: { value: { type: "string", label: "Value", description: "Changed value" } },
						},
					},
				],
			},
		],
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
				notificationScriptSlug: "fixture.automation",
			},
		],
		scripts: [
			{
				capabilities: [],
				kind: "automation",
				name: "Fixture Automation",
				slug: "fixture.automation",
				requiredPluginConfigKeys: [],
				requiredSystemConfigKeys: [],
				entry: "scripts/fixture.sandbox.ts",
			},
		],
		bindings: {
			eventAutomations: [],
			signalAutomations: [],
			schemaProviderLinks: [],
			relationshipAutomations: [],
			entityAutomations: [
				{
					operation: "create",
					scriptSlug: "fixture.automation",
					entitySchemaSlug: "fixture-entity",
				},
			],
		},
	}) satisfies PluginManifest;
