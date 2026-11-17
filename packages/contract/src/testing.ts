import type { CompiledMessage } from "@ryot-app/i18n/catalog";

import type { SandboxExecutionMetadata } from "./modules/plugins/execution-metadata";
import {
	type AuthoredPluginManifest,
	manifestTexts,
	type PluginManifest,
} from "./modules/plugins/manifest";
import { PluginPackageId } from "./schema/brands";

export const emptySandboxExecutionMetadata = {
	capabilities: [],
	runtimeImports: [],
	oauthConnectionFields: [],
	executableDependencies: [],
	optionalPluginConfigKeys: [],
	requiredPluginConfigKeys: [],
} as const satisfies SandboxExecutionMetadata;

/**
 * An `en` catalog covering every display text of `manifest`: each message renders `texts[key]`, or
 * the key itself, then its declared arguments.
 */
export const manifestCatalogs = (
	manifest: AuthoredPluginManifest,
	texts: Readonly<Record<string, string>> = {},
) => ({
	en: Object.fromEntries(
		manifestTexts(manifest).map(({ text, arguments: names = [] }): [string, CompiledMessage] => [
			text.key,
			[
				{ type: 0, value: texts[text.key] ?? text.key },
				...names.map((name) => ({ value: name, type: 1 as const })),
			],
		]),
	),
});

const fixturePackageId = PluginPackageId.make("test/fixture");

export const testPluginPackageId = () => PluginPackageId.make(`test/${crypto.randomUUID()}`);

export const fixturePluginIdentity = (name = "fixture", packageId = fixturePackageId) =>
	({ packageId, ownerId: null, scope: "system", id: `${name}-plugin-id` }) as const;

export const fixtureManifest = (packageId = fixturePackageId) =>
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
			packageId,
			icon: "box",
			version: "1.0.0",
			name: { key: "test.fixture" },
			description: { key: "test.fixture-plugin" },
		},
		relationshipSchemas: [
			{
				slug: "fixture-link",
				propertiesSchema: { fields: {} },
				name: { key: "test.fixture-link" },
				sourceEntitySchemaSlug: "fixture-entity",
				targetEntitySchemaSlug: "fixture-entity",
			},
		],
		signalSchemas: [
			{
				slug: "fixture.signal",
				catalogState: "active",
				propertiesSchema: { fields: {} },
				audiencePolicy: { kind: "actor" },
				name: { key: "test.fixture-signal" },
				notificationHookSlug: "fixture.automation",
			},
		],
		scripts: [
			{
				...emptySandboxExecutionMetadata,
				kind: "automation",
				name: "Fixture Automation",
				slug: "fixture.automation",
				automationType: "automation",
				entry: "backend/automations/fixture.sandbox.ts",
				inputProjection: {
					signal: { properties: [] },
					entity: { properties: [], compareProperties: [], parentEntityProperties: [] },
				},
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
		entitySchemas: [
			{
				icon: "box",
				slug: "fixture-entity",
				name: { key: "test.fixture" },
				eventSchemas: [
					{
						slug: "changed",
						name: { key: "test.changed" },
						propertiesSchema: {
							fields: {
								value: {
									type: "string",
									label: { key: "test.value" },
									description: "Changed value",
								},
							},
						},
					},
				],
				propertiesSchema: {
					fields: {
						name: { type: "string", label: { key: "test.name" }, description: "Fixture name" },
						kind: {
							type: "enum",
							label: { key: "test.kind" },
							description: "Fixture kind",
							choices: { kind: "static", values: [{ value: "one" }, { value: "two" }] },
						},
					},
				},
			},
		],
	}) satisfies PluginManifest;
