import type { PluginManifest } from "@ryot/plugin-kit/manifest";

export const fixturePackageRoot = (kind: "diagnostic" | "valid" = "valid") =>
	new URL(`./test-fixtures/${kind}`, import.meta.url).pathname;

export const fixtureManifest = () =>
	({
		metadata: {
			icon: "box",
			name: "Fixture",
			slug: "fixture",
			version: "1.0.0",
			accentColor: "blue",
			description: "Fixture plugin",
		},
		savedViews: [],
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
				requiredAppConfigKeys: [],
				name: "Fixture Automation",
				slug: "fixture.automation",
				entry: "scripts/fixture.sandbox.ts",
			},
		],
		bindings: {
			eventAutomations: [],
			signalAutomations: [],
			schemaScriptLinks: [],
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
