import { assert, describe, expect, it } from "@effect/vitest";
import { Effect, Result, Schema } from "effect";

import { EntitySchemaSlug, PluginPackageId } from "../../schema/brands";
import { emptySandboxExecutionMetadata } from "../../testing";
import { uploadContentTypeExtensions } from "../assets/upload-policy";
import {
	CLIENT_API_VERSION,
	definePlugin,
	type PluginClientEntry,
	PluginManifest,
} from "./manifest";

const packageId = PluginPackageId.make("test/contract");

const queryDocument = {
	queries: {
		entities: {
			from: { alias: "entity", table: "entity" },
			output: {
				orderBy: [],
				type: "rows",
				pagination: { limit: 20 },
				fields: [
					{ key: "entityId", expr: { field: "id", type: "column", tableAlias: "entity" } },
					{ key: "title", expr: { field: "name", type: "column", tableAlias: "entity" } },
				],
			},
		},
	},
} as const;

const authoredManifest = definePlugin({
	httpRateLimits: [],
	relationshipSchemas: [],
	workflows: [{ slug: "refresh.workflow", scriptSlug: "workflow.test" }],
	metadata: { packageId, icon: "box", name: "Test", version: "1.0.0", description: "Test plugin" },
	userBootstrap: [
		{
			slug: "bootstrap.test",
			description: "Bootstrap user data",
			scriptSlug: "provider.test.preload",
		},
	],
	entitySchemas: [
		{
			icon: "box",
			name: "Entity",
			eventSchemas: [],
			slug: "entity.test",
			propertiesSchema: { fields: {} },
		},
	],
	crons: [
		{
			slug: "refresh.test",
			scriptSlug: "automation.test",
			schedule: { cron: "0 * * * *" },
			description: "Refresh test data",
		},
	],
	operations: [
		{
			auth: "user",
			slug: "resolve.test",
			demoAccess: "allowed",
			scriptSlug: "operation.test",
			description: "Resolve test references",
		},
	],
	providers: [
		{
			slug: "provider.test",
			name: "Test provider",
			rootEntitySchemaSlug: "entity.test",
			information: { source: "Test source", canonicalLanguage: "en" },
		},
	],
	signalSchemas: [
		{
			name: "Test signal",
			slug: "test.signal",
			catalogState: "active",
			propertiesSchema: { fields: {} },
			audiencePolicy: { kind: "actor" },
			notificationHookSlug: "test.notify",
		},
	],
	configSchema: {
		unknownKeys: "strict",
		fields: {
			TEST_KEY: {
				secret: true,
				type: "string",
				label: "Test key",
				description: "Test plugin key",
				validation: { minLength: 1, required: true },
			},
		},
	},
	hooks: [
		{
			stage: "after",
			delivery: "async",
			slug: "test.notify",
			name: "Test notification",
			scriptSlug: "automation.test",
			targets: [{ operation: "emit", resource: "signal", signalSchemaSlug: "test.signal" }],
		},
	],
	savedViews: [
		{
			sortOrder: 0,
			icon: "bookmark",
			name: "All entities",
			slug: "all-entities",
			dataSources: queryDocument,
			renderer: { kind: "kernel", name: "results-table" },
			settings: {
				pageSize: 20,
				sourceName: "entities",
				rowKeyFields: ["entityId"],
				entityLink: { entityIdField: "entityId" },
				columns: [{ label: "Title", field: "title", displayKind: "text" }],
			},
		},
	],
	integrationProviders: [
		{
			lot: "yank",
			name: "Test yank",
			slug: "integration.yank",
			scriptSlug: "automation.test",
			description: "Yank test data",
			settingsSchema: {
				fields: {
					apiKey: {
						secret: true,
						type: "string",
						label: "API key",
						description: "Provider API key",
					},
				},
			},
		},
		{
			lot: "push",
			name: "Test push",
			slug: "integration.push",
			description: "Push test data",
			settingsSchema: { fields: {} },
		},
	],
	importSources: [
		{
			slug: "import.test",
			name: "Test import source",
			workflowSlug: "refresh.workflow",
			description: "Import test data from a file",
			exportHelp: {
				docsUrl: "https://example.com/export",
				steps: ["Export the data as JSON", "Upload the exported file"],
			},
			inputSchema: {
				unknownKeys: "strict",
				fields: {
					file: {
						label: "File",
						type: "string",
						validation: { required: true },
						description: "Exported JSON file",
						format: { kind: "upload", allowedFileExtensions: ["json"] },
					},
				},
			},
		},
	],
});

const scripts = [
	{
		kind: "automation",
		runtimeImports: [],
		name: "Test automation",
		slug: "automation.test",
		oauthConnectionFields: [],
		executableDependencies: [],
		automationType: "automation",
		requiredPluginConfigKeys: [],
		optionalPluginConfigKeys: [],
		capabilities: ["emitSignal"],
		entry: "scripts/test.sandbox.ts",
		inputProjection: {
			signal: { properties: [] },
			providerEntityImport: true,
			event: { properties: [], compareProperties: [] },
			entity: { properties: [], compareProperties: [], parentEntityProperties: [] },
			relationship: { properties: [], compareProperties: [], parentEntityProperties: [] },
		},
	},
	{
		...emptySandboxExecutionMetadata,
		kind: "operation",
		name: "Test operation",
		slug: "operation.test",
		entry: "scripts/operation.sandbox.ts",
	},
	{
		kind: "provider",
		...emptySandboxExecutionMetadata,
		providerOperation: "details",
		name: "Test provider details",
		slug: "provider.test.details",
		providerSlug: "provider.test",
		entry: "scripts/provider-details.sandbox.ts",
	},
	{
		kind: "provider",
		...emptySandboxExecutionMetadata,
		providerOperation: "search",
		name: "Test provider search",
		slug: "provider.test.search",
		providerSlug: "provider.test",
		entry: "scripts/provider-search.sandbox.ts",
		searchOptionsSchema: {
			unknownKeys: "strict",
			fields: {
				passRawQuery: {
					type: "boolean",
					label: "Pass raw query",
					description: "Pass the query without modification",
				},
			},
		},
	},
	{
		kind: "script",
		...emptySandboxExecutionMetadata,
		name: "Test provider preload",
		slug: "provider.test.preload",
		providerSlug: "provider.test",
		entry: "scripts/provider-preload.sandbox.ts",
	},
	{
		kind: "workflow",
		...emptySandboxExecutionMetadata,
		name: "Test workflow",
		slug: "workflow.test",
		entry: "scripts/workflow.sandbox.ts",
	},
] as const;

const manifest = { ...authoredManifest, scripts };

type DeclaredEditorRelationship = {
	readonly slug: string;
	readonly direction: "parent" | "outgoing" | "incoming";
};
const outgoing = (slug: string): DeclaredEditorRelationship => ({ slug, direction: "outgoing" });
const incoming = (slug: string): DeclaredEditorRelationship => ({ slug, direction: "incoming" });

const editorRelationship = (slug: string, sourceEntitySchemaSlug: null | string) => ({
	slug,
	name: slug,
	sourceEntitySchemaSlug,
	propertiesSchema: { fields: {} },
	targetEntitySchemaSlug: "target.test",
});

describe("definePlugin", () => {
	it.effect("accepts explicit root and child translation selections from the same plugin", () =>
		Effect.gen(function* () {
			const translated = {
				...emptySandboxExecutionMetadata,
				kind: "provider",
				name: "Translate",
				providerSlug: "provider.test",
				providerOperation: "translate",
				slug: "provider.test.translate",
				entry: "scripts/translate.sandbox.ts",
				translationInputs: { "entity.test": [], "entity.child": ["parentExternalId"] },
			};
			const candidate = {
				...manifest,
				scripts: [...manifest.scripts, translated],
				entitySchemas: [
					...manifest.entitySchemas,
					{
						icon: "box",
						name: "Child",
						eventSchemas: [],
						slug: "entity.child",
						propertiesSchema: {
							fields: {
								parentExternalId: { type: "string", label: "Parent", description: "Parent ID" },
							},
						},
					},
				],
			};
			expect(
				(yield* Schema.decodeUnknownEffect(PluginManifest)(candidate)).scripts.at(-1),
			).toMatchObject({ translationInputs: translated.translationInputs });
			for (const translationInputs of [
				{ "foreign.entity": [] },
				{ "entity.child": ["undeclared"] },
				{ "entity.child": ["parentExternalId", "parentExternalId"] },
				{},
			]) {
				expect(
					Schema.decodeUnknownResult(PluginManifest)({
						...candidate,
						scripts: [...manifest.scripts, { ...translated, translationInputs }],
					}),
				).toSatisfy(Result.isFailure);
			}
			expect(
				Schema.decodeUnknownResult(PluginManifest)({
					...candidate,
					scripts: [...manifest.scripts, { ...translated, providerOperation: "resolve" }],
				}),
			).toSatisfy(Result.isFailure);
		}),
	);

	it.effect("accepts after hooks on plugin-owned collection reviews and membership", () =>
		Effect.gen(function* () {
			const decoded = yield* Schema.decodeUnknownEffect(PluginManifest)({
				...manifest,
				relationshipSchemas: [
					...manifest.relationshipSchemas,
					{
						slug: "member-of",
						name: "Member of",
						propertiesSchema: { fields: {} },
						sourceEntitySchemaSlug: "collection",
						targetEntitySchemaSlug: "collection",
					},
				],
				entitySchemas: [
					...manifest.entitySchemas,
					{
						icon: "box",
						name: "Collection",
						slug: "collection",
						propertiesSchema: { fields: {} },
						eventSchemas: [{ slug: "review", name: "Review", propertiesSchema: { fields: {} } }],
					},
				],
				hooks: [
					...manifest.hooks,
					{
						stage: "after",
						delivery: "async",
						slug: "collection.review",
						name: "Review collection",
						scriptSlug: "automation.test",
						targets: [
							{
								resource: "event",
								operation: "create",
								eventSchemaSlug: "review",
								entitySchemaSlug: "collection",
							},
						],
					},
					...(["radarr", "sonarr"] as const).map((provider) => ({
						stage: "after",
						delivery: "async",
						slug: `${provider}.push`,
						name: `Push to ${provider}`,
						scriptSlug: "automation.test",
						targets: [
							{
								operation: "create",
								resource: "relationship",
								relationshipSchemaSlug: "member-of",
							},
						],
					})),
				],
			});
			expect(decoded.entitySchemas.map(({ slug }) => slug)).toEqual(["entity.test", "collection"]);
			expect(decoded.relationshipSchemas.map(({ slug }) => slug)).toEqual(["member-of"]);
			expect(decoded.hooks.map(({ slug }) => slug)).toEqual([
				"test.notify",
				"collection.review",
				"radarr.push",
				"sonarr.push",
			]);
		}),
	);

	it("preserves manifest literals", () => {
		const scriptKind: "automation" = manifest.scripts[0].kind;
		const cron = manifest.crons[0];
		const scriptSlug: "automation.test" = cron.scriptSlug;

		expect(scriptSlug).toBe("automation.test");
		expect(scriptKind).toBe("automation");
	});

	it("contains only the supported manifest sections", () => {
		type HasCrons = "crons" extends keyof PluginManifest ? true : false;
		type HasWorkflows = "workflows" extends keyof PluginManifest ? true : false;
		type HasOperations = "operations" extends keyof PluginManifest ? true : false;
		type HasCapabilities = "capabilities" extends keyof PluginManifest ? true : false;
		type HasUserBootstrap = "userBootstrap" extends keyof PluginManifest ? true : false;
		type HasImportSources = "importSources" extends keyof PluginManifest ? true : false;
		type HasIntegrationProviders = "integrationProviders" extends keyof PluginManifest
			? true
			: false;

		const optionalSections: [
			HasCapabilities,
			HasCrons,
			HasOperations,
			HasWorkflows,
			HasImportSources,
			HasUserBootstrap,
			HasIntegrationProviders,
		] = [false, true, true, true, true, true, true];

		expect(optionalSections).toEqual([false, true, true, true, true, true, true]);
	});

	it.effect("decodes the manifest with the canonical Effect schema", () =>
		Effect.gen(function* () {
			expect(yield* Schema.decodeEffect(PluginManifest)(manifest)).toEqual(manifest);
			expect((yield* Schema.decodeEffect(PluginManifest)(manifest)).scripts[3]).toMatchObject({
				searchOptionsSchema: { unknownKeys: "strict" },
			});
		}),
	);

	it.effect("accepts a declarative client manifest", () =>
		Effect.gen(function* () {
			const client = {
				homeView: null,
				apiVersion: CLIENT_API_VERSION,
				exports: {
					page: {
						kind: "page" as const,
						settingsSchema: { fields: {} },
						entry: "client/pages/index.tsx",
						automaticEntityPresentations: false,
					},
				},
			};
			const decoded = yield* Schema.decodeEffect(PluginManifest)({ ...manifest, client });

			expect(decoded.client).toEqual(client);
		}),
	);

	it.effect("decodes declarative public client exports by kind", () =>
		Effect.gen(function* () {
			const pluginDependencies: NonNullable<PluginClientEntry["pluginDependencies"]> = {
				fixture: { scope: "system", packageId: PluginPackageId.make("test/dependency") },
				"private-fixture": { scope: "user", packageId: PluginPackageId.make("test/second") },
			};
			const client = {
				homeView: null,
				pluginDependencies,
				notFoundPage: "dashboard",
				apiVersion: CLIENT_API_VERSION,
				routes: { "/": "dashboard", "/things/$thingId": "dashboard" },
				entities: { thing: { createRoute: "/", detailPage: "dashboard", gridPresentation: "row" } },
				exports: {
					card: {
						entry: "client/card.tsx",
						kind: "component" as const,
						automaticEntityPresentations: false,
					},
					row: {
						entry: "client/row.tsx",
						kind: "presentation" as const,
						automaticEntityPresentations: false,
					},
					dashboard: {
						kind: "page" as const,
						entry: "client/dashboard.tsx",
						automaticEntityPresentations: true,
						settingsSchema: {
							fields: {
								title: { label: "Title", type: "string" as const, description: "Page title" },
							},
						},
					},
				},
			};

			const manifestWithEntity = {
				...manifest,
				entitySchemas: [
					...manifest.entitySchemas,
					{
						icon: "box",
						name: "Thing",
						slug: "thing",
						eventSchemas: [],
						propertiesSchema: { fields: {} },
					},
				],
			};
			expect(
				(yield* Schema.decodeEffect(PluginManifest)({ ...manifestWithEntity, client })).client,
			).toEqual(client);
			const invalidClients = [
				{ ...client, entry: "client/index.tsx" },
				{ ...client, homeView: "missing-view" },
				{
					...client,
					exports: { dashboard: { ...client.exports.dashboard, settingsSchema: undefined } },
				},
				{
					...client,
					exports: { card: { ...client.exports.card, settingsSchema: { fields: {} } } },
				},
				{ ...client, exports: { ...client.exports, "../card": client.exports.card } },
				{ ...client, exports: { card: { ...client.exports.card, entry: "backend/card.tsx" } } },
				{ ...client, pluginDependencies: { fixture: { scope: "system", packageId: "fixture" } } },
				{
					...client,
					pluginDependencies: { "Fixture Alias": { scope: "system", packageId: "ryot/fixture" } },
				},
				{ ...client, entities: { missing: { gridPresentation: "row" } } },
				{ ...client, entities: { thing: { gridPresentation: "card" } } },
				{ ...client, entities: { thing: { createRoute: "/things/new" } } },
				{ ...client, routes: { "/": "card" } },
				{ ...client, notFoundPage: "missing" },
			];
			expect(
				invalidClients.map((invalidClient) =>
					Result.isFailure(
						Schema.decodeUnknownResult(PluginManifest)({
							...manifestWithEntity,
							client: invalidClient,
						}),
					),
				),
			).toEqual([true, true, true, true, true, true, true, true, true, true, true, true, true]);
		}),
	);

	it.effect("accepts plugin-owned default homes and portable plugin renderers", () =>
		Effect.gen(function* () {
			const client = {
				homeView: "plugin-page",
				apiVersion: CLIENT_API_VERSION,
				exports: {
					page: {
						kind: "page" as const,
						entry: "client/page.tsx",
						settingsSchema: { fields: {} },
						automaticEntityPresentations: false,
					},
				},
			};
			const pluginView = {
				icon: "box",
				sortOrder: 1,
				settings: {},
				dataSources: null,
				name: "Plugin page",
				slug: "plugin-page",
				renderer: { exportName: "page", kind: "plugin" as const },
			};

			expect(
				(yield* Schema.decodeEffect(PluginManifest)({
					...manifest,
					client,
					savedViews: [...manifest.savedViews, pluginView],
				})).savedViews[1]?.renderer,
			).toEqual({ kind: "plugin", exportName: "page" });
			for (const renderer of [
				{ kind: "custom", rendererId: "runtime-id" },
				{ kind: "plugin", exportName: "page", pluginId: "runtime-plugin-id" },
			]) {
				yield* Effect.flip(
					Schema.decodeUnknownEffect(PluginManifest)({
						...manifest,
						client,
						savedViews: [{ ...pluginView, renderer }],
					}),
				);
			}
		}),
	);

	it.effect(
		"rejects non-TypeScript export entries outside client/ or with noncanonical paths",
		() =>
			Effect.gen(function* () {
				for (const entry of [
					"index.tsx",
					"backend/index.ts",
					"client/index.js",
					"client/index.css",
					"client/../index.tsx",
					"client//index.tsx",
					"client\\index.tsx",
				]) {
					yield* Effect.flip(
						Schema.decodeEffect(PluginManifest)({
							...manifest,
							client: {
								homeView: null,
								apiVersion: CLIENT_API_VERSION,
								exports: {
									page: {
										entry,
										kind: "page",
										settingsSchema: { fields: {} },
										automaticEntityPresentations: false,
									},
								},
							},
						}),
					);
				}
			}),
	);

	it.effect("rejects speculative client capabilities", () =>
		Effect.flip(
			Schema.decodeUnknownEffect(PluginManifest)({
				...manifest,
				client: {
					homeView: null,
					capabilities: [],
					apiVersion: CLIENT_API_VERSION,
					exports: {
						card: {
							kind: "component",
							entry: "client/card.tsx",
							automaticEntityPresentations: false,
						},
					},
				},
			}),
		),
	);

	it.effect("keeps backend-only manifests valid", () =>
		Effect.gen(function* () {
			expect(yield* Schema.decodeEffect(PluginManifest)(manifest)).toEqual(manifest);
		}),
	);

	it.effect("accepts import upload extensions from the supported upload policy", () =>
		Effect.gen(function* () {
			const [source] = manifest.importSources;
			assert(source);
			const extensions = [...new Set(Object.values(uploadContentTypeExtensions).flat())];
			const decoded = yield* Schema.decodeEffect(PluginManifest)({
				...manifest,
				importSources: [
					{
						...source,
						inputSchema: {
							...source.inputSchema,
							fields: {
								file: {
									...source.inputSchema.fields.file,
									format: { kind: "upload", allowedFileExtensions: extensions },
								},
							},
						},
					},
				],
			});

			expect(decoded.importSources[0]?.inputSchema.fields.file).toMatchObject({
				format: { kind: "upload", allowedFileExtensions: extensions },
			});
		}),
	);

	it.effect("rejects unsupported import upload extensions clearly", () =>
		Effect.gen(function* () {
			const [source] = manifest.importSources;
			assert(source);
			expect(
				(yield* Effect.flip(
					Schema.decodeEffect(PluginManifest)({
						...manifest,
						importSources: [
							{
								...source,
								inputSchema: {
									...source.inputSchema,
									fields: {
										file: {
											...source.inputSchema.fields.file,
											format: { kind: "upload", allowedFileExtensions: ["exe"] },
										},
									},
								},
							},
						],
					}),
				)).message,
			).toContain("Unsupported import upload file extension: exe");
		}),
	);

	it.effect("requires and decodes saved-view renderer settings and data sources", () =>
		Effect.gen(function* () {
			const [savedView] = (yield* Schema.decodeEffect(PluginManifest)(manifest)).savedViews;
			assert(savedView);

			expect(savedView.renderer).toEqual({ kind: "kernel", name: "results-table" });
			expect(savedView.dataSources).toEqual(queryDocument);
			expect(savedView.settings["sourceName"]).toBe("entities");
		}),
	);

	it.effect("requires saved-view renderer settings", () =>
		Effect.gen(function* () {
			const [savedView] = manifest.savedViews;
			assert(savedView);
			yield* Effect.flip(
				Schema.decodeUnknownEffect(PluginManifest)({
					...manifest,
					savedViews: [{ ...savedView, settings: undefined }],
				}),
			);
		}),
	);

	it.effect("rejects a plugin saved view rendered by the kernel calendar", () =>
		Effect.gen(function* () {
			const [savedView] = manifest.savedViews;
			assert(savedView);
			yield* Effect.flip(
				Schema.decodeUnknownEffect(PluginManifest)({
					...manifest,
					savedViews: [
						{
							...savedView,
							settings: {},
							dataSources: null,
							renderer: { kind: "kernel", name: "calendar" },
						},
					],
				}),
			);
		}),
	);

	it.effect("rejects removed saved-view sandbox scripts", () =>
		Effect.gen(function* () {
			const [savedView] = manifest.savedViews;
			assert(savedView);
			yield* Effect.flip(
				Schema.decodeUnknownEffect(PluginManifest)({
					...manifest,
					savedViews: [{ ...savedView, sandboxScripts: {} }],
				}),
			);
		}),
	);

	it.effect("normalizes strict HTTP rate limit declarations", () =>
		Effect.gen(function* () {
			const decoded = yield* Schema.decodeEffect(PluginManifest)({
				...manifest,
				httpRateLimits: [
					{
						requests: 90,
						intervalMs: 60_000,
						key: "catalog.example-service",
						origins: ["HTTPS://API.EXAMPLE.COM:443/"],
					},
				],
			});

			expect(decoded.httpRateLimits).toEqual([
				{
					requests: 90,
					intervalMs: 60_000,
					key: "catalog.example-service",
					origins: ["https://api.example.com"],
				},
			]);
			yield* Effect.flip(
				Schema.decodeUnknownEffect(PluginManifest)({
					...manifest,
					httpRateLimits: [
						{
							requests: 90,
							unsupported: true,
							intervalMs: 60_000,
							key: "catalog.example-service",
							origins: ["https://api.example.com"],
						},
					],
				}),
			);
		}),
	);

	it.effect("rejects invalid HTTP rate limit declaration forms", () =>
		Effect.gen(function* () {
			const declaration = {
				requests: 1,
				intervalMs: 1_000,
				key: "catalog.test",
				origins: ["https://example.com"],
			};
			for (const candidate of [
				{ ...declaration, key: "Catalog Test" },
				{ ...declaration, origins: [] },
				{ ...declaration, requests: 0 },
				{ ...declaration, requests: 1.5 },
				{ ...declaration, intervalMs: Number.MAX_SAFE_INTEGER + 1 },
				{ ...declaration, origins: ["ftp://example.com"] },
				{ ...declaration, origins: ["https://example.com/path"] },
				{ ...declaration, origins: ["https://example.com?"] },
				{ ...declaration, origins: ["https://example.com?query=true"] },
				{ ...declaration, origins: ["https://example.com#"] },
				{ ...declaration, origins: ["https://example.com#fragment"] },
				{ ...declaration, origins: ["https://user:pass@example.com"] },
				{ ...declaration, origins: ["https://*.example.com"] },
			]) {
				yield* Effect.flip(
					Schema.decodeEffect(PluginManifest)({ ...manifest, httpRateLimits: [candidate] }),
				);
			}
			const { httpRateLimits: _httpRateLimits, ...missing } = manifest;
			yield* Effect.flip(Schema.decodeUnknownEffect(PluginManifest)(missing));
		}),
	);

	it.effect("rejects duplicate normalized HTTP rate limit keys and origins", () =>
		Effect.gen(function* () {
			const declaration = {
				requests: 1,
				intervalMs: 1_000,
				key: "catalog.test",
				origins: ["https://example.com"],
			};
			for (const httpRateLimits of [
				[declaration, { ...declaration, origins: ["https://other.example.com"] }],
				[
					declaration,
					{ ...declaration, key: "catalog.other", origins: ["HTTPS://EXAMPLE.COM:443/"] },
				],
				[{ ...declaration, origins: ["https://example.com", "HTTPS://EXAMPLE.COM:443/"] }],
			]) {
				yield* Effect.flip(Schema.decodeEffect(PluginManifest)({ ...manifest, httpRateLimits }));
			}
		}),
	);

	it.effect("rejects excess properties throughout the manifest", () =>
		Effect.gen(function* () {
			yield* Effect.flip(
				Schema.decodeUnknownEffect(PluginManifest)({
					...manifest,
					metadata: { ...manifest.metadata, unsupported: true },
				}),
			);
			yield* Effect.flip(
				Schema.decodeUnknownEffect(PluginManifest)({
					...manifest,
					providers: [
						{
							...manifest.providers[0],
							information: { ...manifest.providers[0].information, unsupported: true },
						},
					],
				}),
			);
		}),
	);

	it.effect("decodes optional entity merge identity properties", () =>
		Effect.gen(function* () {
			const decoded = yield* Schema.decodeEffect(PluginManifest)({
				...manifest,
				entitySchemas: [
					{
						icon: "box",
						name: "Entity",
						eventSchemas: [],
						slug: "entity.test",
						mergeIdentityProperties: ["kind"],
						propertiesSchema: {
							fields: { kind: { label: "Kind", type: "string", description: "Entity kind" } },
						},
					},
				],
			});

			expect(decoded.entitySchemas[0]?.mergeIdentityProperties).toEqual(["kind"]);
		}),
	);

	it.effect("accepts editors naming relationships at their schema and rejects others", () =>
		Effect.gen(function* () {
			const target = {
				icon: "box",
				name: "Target",
				eventSchemas: [],
				slug: "target.test",
				propertiesSchema: { fields: {} },
			};
			const withEditor = (
				relationships: readonly DeclaredEditorRelationship[],
				targetRelationships: readonly DeclaredEditorRelationship[] = [],
			) => ({
				...manifest,
				entitySchemas: [
					{ ...manifest.entitySchemas[0], editor: { relationships } },
					{ ...target, editor: { deletable: true, relationships: targetRelationships } },
				],
				relationshipSchemas: [
					editorRelationship("entity-targets", "entity.test"),
					editorRelationship("target-links", "target.test"),
					editorRelationship("loose-targets", null),
				],
			});

			const decoded = yield* Schema.decodeEffect(PluginManifest)(
				withEditor([outgoing("entity-targets")], [incoming("entity-targets")]),
			);
			expect(
				(yield* Schema.decodeEffect(PluginManifest)(
					withEditor([], [{ direction: "parent", slug: "entity-targets" }]),
				)).entitySchemas[1]?.editor?.relationships,
			).toEqual([{ direction: "parent", slug: "entity-targets" }]);
			expect(decoded.entitySchemas[0]?.editor).toEqual({
				relationships: [outgoing("entity-targets")],
			});
			expect(decoded.entitySchemas[1]?.editor).toEqual({
				deletable: true,
				relationships: [incoming("entity-targets")],
			});
			expect(
				(yield* Schema.decodeEffect(PluginManifest)(withEditor([]))).entitySchemas[0]?.editor,
			).toEqual({ relationships: [] });
			for (const relationships of [
				[outgoing("undeclared")],
				[outgoing("target-links")],
				[outgoing("loose-targets")],
				[incoming("entity-targets")],
				[outgoing("entity-targets"), outgoing("entity-targets")],
				[outgoing("")],
			]) {
				yield* Effect.flip(Schema.decodeEffect(PluginManifest)(withEditor(relationships)));
			}
			yield* Effect.flip(
				Schema.decodeEffect(PluginManifest)(withEditor([], [outgoing("entity-targets")])),
			);
		}),
	);

	it.effect("decodes optional entity entity-user-data restrictions with permissive absence", () =>
		Effect.gen(function* () {
			const decoded = yield* Schema.decodeEffect(PluginManifest)({
				...manifest,
				entitySchemas: [
					{
						icon: "box",
						eventSchemas: [],
						name: "Protected Entity",
						slug: "protected-entity",
						propertiesSchema: { fields: {} },
						userState: { deniedOperations: ["clear", "merge"] },
					},
					{
						icon: "box",
						name: "Entity",
						eventSchemas: [],
						slug: "entity.test",
						propertiesSchema: { fields: {} },
					},
				],
			});

			expect(decoded.entitySchemas[0]?.userState?.deniedOperations).toEqual(["clear", "merge"]);
			expect(decoded.entitySchemas[1]?.userState).toBeUndefined();
		}),
	);

	it.effect("requires signal notification hook references", () =>
		Effect.gen(function* () {
			const signalSchema = manifest.signalSchemas[0];
			yield* Effect.flip(
				Schema.decodeUnknownEffect(PluginManifest)({
					...manifest,
					signalSchemas: [{ ...signalSchema, notificationHookSlug: undefined }],
				}),
			);
		}),
	);

	it.effect("rejects notification references that do not name a declared signal hook", () =>
		Effect.gen(function* () {
			const signalSchema = manifest.signalSchemas[0];
			yield* Effect.flip(
				Schema.decodeEffect(PluginManifest)({
					...manifest,
					signalSchemas: [{ ...signalSchema, notificationHookSlug: "automation.test" }],
				}),
			);
		}),
	);

	it.effect("accepts direct scripts and rejects kinds outside the v1 contract", () =>
		Effect.gen(function* () {
			const customScript = (yield* Schema.decodeEffect(PluginManifest)(manifest)).scripts[4];
			assert(customScript);
			expect(customScript).toMatchObject({
				kind: "script",
				providerSlug: "provider.test",
				slug: "provider.test.preload",
			});
			yield* Effect.flip(
				Schema.decodeUnknownEffect(PluginManifest)({ ...manifest, capabilities: [] }),
			);
			yield* Effect.flip(
				Schema.decodeUnknownEffect(PluginManifest)({
					...manifest,
					scripts: [{ ...manifest.scripts[0], kind: "legacy" }],
				}),
			);
		}),
	);

	it.effect(
		"requires unique user bootstrap entries targeting direct scripts in the same package",
		() =>
			Effect.gen(function* () {
				const entry = manifest.userBootstrap[0];
				assert(entry);
				expect((yield* Schema.decodeEffect(PluginManifest)(manifest)).userBootstrap).toEqual([
					entry,
				]);
				for (const userBootstrap of [
					[{ ...entry }, { ...entry }],
					[{ ...entry, scriptSlug: "missing.script" }],
					[{ ...entry, scriptSlug: "automation.test" }],
				]) {
					yield* Effect.flip(Schema.decodeEffect(PluginManifest)({ ...manifest, userBootstrap }));
				}
			}),
	);

	it.effect("accepts operation scripts and validates operation declarations", () =>
		Effect.gen(function* () {
			const operation = manifest.operations[0];
			const operationScript = (yield* Schema.decodeEffect(PluginManifest)(manifest)).scripts[1];
			assert(operationScript);
			expect(operationScript.kind).toBe("operation");
			expect(operation).toMatchObject({ auth: "user", demoAccess: "allowed" });
			yield* Effect.flip(
				Schema.decodeUnknownEffect(PluginManifest)({
					...manifest,
					operations: [{ ...operation, demoAccess: undefined }],
				}),
			);
			yield* Effect.flip(
				Schema.decodeUnknownEffect(PluginManifest)({
					...manifest,
					operations: [{ ...operation, demoAccess: "invalid" }],
				}),
			);
			yield* Effect.flip(
				Schema.decodeUnknownEffect(PluginManifest)({
					...manifest,
					operations: [{ ...operation, auth: "integration", demoAccess: "allowed" }],
				}),
			);
			expect(
				(yield* Schema.decodeEffect(PluginManifest)({
					...manifest,
					operations: [
						{
							auth: "integration",
							slug: operation.slug,
							scriptSlug: operation.scriptSlug,
							description: operation.description,
						},
					],
				})).operations[0],
			).not.toHaveProperty("demoAccess");
			yield* Effect.flip(
				Schema.decodeEffect(PluginManifest)({
					...manifest,
					operations: [{ ...operation, slug: "Invalid/Slug" }],
				}),
			);
			yield* Effect.flip(
				Schema.decodeUnknownEffect(PluginManifest)({
					...manifest,
					operations: [{ ...operation, auth: "public" }],
				}),
			);
			yield* Effect.flip(
				Schema.decodeEffect(PluginManifest)({
					...manifest,
					operations: [{ ...operation, description: "" }],
				}),
			);
		}),
	);

	it.effect("accepts workflow declarations only for capability-free workflow scripts", () =>
		Effect.gen(function* () {
			const workflow = manifest.workflows[0];
			const workflowScript = manifest.scripts[5];
			expect(workflowScript.kind).toBe("workflow");
			yield* Effect.flip(
				Schema.decodeEffect(PluginManifest)({
					...manifest,
					workflows: [{ ...workflow, scriptSlug: manifest.scripts[1].slug }],
				}),
			);
			yield* Effect.flip(
				Schema.decodeUnknownEffect(PluginManifest)({
					...manifest,
					scripts: [
						...manifest.scripts.slice(0, 5),
						{ ...workflowScript, capabilities: ["httpCall"] },
					],
				}),
			);
			yield* Effect.flip(
				Schema.decodeEffect(PluginManifest)({
					...manifest,
					workflows: [...manifest.workflows, { ...workflow }],
				}),
			);
		}),
	);

	it.effect("enforces sandbox script manifest constraints", () =>
		Effect.gen(function* () {
			yield* Effect.flip(
				Schema.decodeEffect(PluginManifest)({
					...manifest,
					scripts: [{ ...manifest.scripts[0], slug: "Invalid/Slug" }],
				}),
			);
			yield* Effect.flip(
				Schema.decodeEffect(PluginManifest)({
					...manifest,
					scripts: [{ ...manifest.scripts[0], requiredPluginConfigKeys: [""] }],
				}),
			);
		}),
	);

	it.effect("restricts plugin config schemas to environment-safe top-level fields", () =>
		Effect.gen(function* () {
			for (const configSchema of [
				{ ...manifest.configSchema, unknownKeys: "strip" },
				{ ...manifest.configSchema, rules: [] },
				{
					...manifest.configSchema,
					fields: {
						...manifest.configSchema.fields,
						value: {
							type: "string",
							label: "Value",
							translatable: true,
							description: "A translated value",
						},
					},
				},
				{
					...manifest.configSchema,
					fields: {
						...manifest.configSchema.fields,
						value: {
							type: "number",
							label: "Value",
							description: "A normalized value",
							normalize: { round: { scale: 1 } },
						},
					},
				},
			]) {
				yield* Effect.flip(
					Schema.decodeUnknownEffect(PluginManifest)({ ...manifest, configSchema }),
				);
			}

			for (const field of [
				{ type: "date", label: "Value", description: "A date value" },
				{ label: "Value", type: "datetime", description: "A datetime value" },
				{
					label: "Value",
					type: "enum-array",
					description: "An enum array value",
					choices: { kind: "static", values: [{ value: "one" }] },
				},
				{
					type: "array",
					label: "Value",
					description: "An array value",
					items: { label: "Item", type: "string", description: "An item" },
				},
				{ type: "object", label: "Value", properties: {}, description: "An object value" },
			]) {
				yield* Effect.flip(
					Schema.decodeUnknownEffect(PluginManifest)({
						...manifest,
						configSchema: {
							...manifest.configSchema,
							fields: { ...manifest.configSchema.fields, value: field },
						},
					}),
				);
			}
		}),
	);

	it.effect("requires declared plugin config keys to exist in the config schema", () =>
		Effect.gen(function* () {
			yield* Effect.flip(
				Schema.decodeEffect(PluginManifest)({
					...manifest,
					scripts: [
						{ ...manifest.scripts[0], requiredPluginConfigKeys: ["MISSING_KEY"] },
						...manifest.scripts.slice(1),
					],
				}),
			);
			yield* Effect.flip(
				Schema.decodeEffect(PluginManifest)({
					...manifest,
					importSources: [
						{
							...manifest.importSources[0],
							plan: { selections: { missing: { value: "missing" } } },
						},
					],
				}),
			);
		}),
	);

	it.effect("rejects plugin config keys that normalize to the same environment variable", () =>
		Effect.flip(
			Schema.decodeEffect(PluginManifest)({
				...manifest,
				importSources: [],
				scripts: manifest.scripts.map((script) => ({ ...script, requiredPluginConfigKeys: [] })),
				configSchema: {
					unknownKeys: "strict",
					fields: {
						api_token: { type: "string", label: "API token", description: "Token" },
						"api-token": { type: "string", label: "API token", description: "Token" },
					},
				},
			}),
		),
	);

	it.effect("rejects duplicate script slugs within and across script kinds", () =>
		Effect.gen(function* () {
			yield* Effect.flip(
				Schema.decodeEffect(PluginManifest)({
					...manifest,
					scripts: [...manifest.scripts, { ...manifest.scripts[0] }],
				}),
			);
			yield* Effect.flip(
				Schema.decodeEffect(PluginManifest)({
					...manifest,
					scripts: [
						...manifest.scripts,
						{ ...manifest.scripts[1], slug: manifest.scripts[0].slug },
					],
				}),
			);
		}),
	);

	it.effect("accepts dynamic search choices only with a search-options binding", () =>
		Effect.gen(function* () {
			const provider = manifest.providers[0];
			const search = manifest.scripts[3];
			assert(provider);
			const searchOptions = {
				...manifest.scripts[2],
				kind: "provider" as const,
				providerSlug: provider.slug,
				name: "Test provider search options",
				slug: "provider.test.search-options",
				providerOperation: "search-options" as const,
			};
			const dynamicSearch = {
				...search,
				searchOptionsSchema: {
					...search.searchOptionsSchema,
					fields: {
						...search.searchOptionsSchema.fields,
						status: {
							label: "Status",
							type: "enum" as const,
							description: "Status",
							choices: { source: "statuses", kind: "dynamic" as const },
						},
					},
				},
			};
			const dynamicManifest = {
				...manifest,
				scripts: [
					...manifest.scripts.filter(({ slug }) => slug !== search.slug),
					dynamicSearch,
					searchOptions,
				],
			};

			expect(yield* Schema.decodeEffect(PluginManifest)(dynamicManifest)).toBeTruthy();
			yield* Effect.flip(
				Schema.decodeEffect(PluginManifest)({
					...dynamicManifest,
					scripts: dynamicManifest.scripts.filter(({ slug }) => slug !== searchOptions.slug),
				}),
			);
			yield* Effect.flip(
				Schema.decodeEffect(PluginManifest)({
					...dynamicManifest,
					providers: [...manifest.providers, { ...provider, slug: "other.provider" }],
					scripts: [
						...dynamicManifest.scripts.filter(({ slug }) => slug !== searchOptions.slug),
						{ ...manifest.scripts[2], slug: "other.details", providerSlug: "other.provider" },
						{ ...searchOptions, providerSlug: "other.provider" },
					],
				}),
			);
			expect(
				yield* Schema.decodeEffect(PluginManifest)({
					...manifest,
					scripts: [...manifest.scripts, searchOptions],
				}),
			).toBeTruthy();
		}),
	);

	it.effect("binds related operations from generated script metadata alone", () =>
		Effect.gen(function* () {
			const provider = manifest.providers[0];
			assert(provider);
			const related = {
				...manifest.scripts[2],
				kind: "provider" as const,
				providerSlug: provider.slug,
				name: "Test provider related",
				slug: "provider.test.related",
				providerOperation: "related" as const,
			};
			const relatedManifest = { ...manifest, scripts: [...manifest.scripts, related] };

			expect(yield* Schema.decodeEffect(PluginManifest)(relatedManifest)).toBeTruthy();
			yield* Effect.flip(
				Schema.decodeEffect(PluginManifest)({
					...manifest,
					scripts: [...manifest.scripts, related, { ...related, slug: "another.related" }],
				}),
			);
		}),
	);

	it.effect("strictly validates providers and their standard operation assignments", () =>
		Effect.gen(function* () {
			const provider = manifest.providers[0];
			const detailsScript = manifest.scripts[2];
			const preloadScript = manifest.scripts[4];
			yield* Effect.flip(
				Schema.decodeUnknownEffect(PluginManifest)({
					...manifest,
					providers: [{ ...provider, rootEntitySchemaSlug: undefined }],
				}),
			);
			yield* Effect.flip(
				Schema.decodeUnknownEffect(PluginManifest)({
					...manifest,
					scripts: [
						...manifest.scripts.slice(0, 2),
						{ ...detailsScript, providerOperation: undefined },
						...manifest.scripts.slice(3),
					],
				}),
			);
			yield* Effect.flip(
				Schema.decodeUnknownEffect(PluginManifest)({
					...manifest,
					scripts: [
						...manifest.scripts.slice(0, 2),
						{ ...detailsScript, searchOptionsSchema: { fields: {} } },
						...manifest.scripts.slice(3),
					],
				}),
			);
			yield* Effect.flip(
				Schema.decodeEffect(PluginManifest)({
					...manifest,
					providers: [...manifest.providers, provider],
				}),
			);
			yield* Effect.flip(
				Schema.decodeEffect(PluginManifest)({
					...manifest,
					scripts: manifest.scripts.filter(({ slug }) => slug !== detailsScript.slug),
				}),
			);
			yield* Effect.flip(
				Schema.decodeEffect(PluginManifest)({
					...manifest,
					scripts: [...manifest.scripts, { ...detailsScript, slug: "another.details" }],
				}),
			);
			yield* Effect.flip(
				Schema.decodeEffect(PluginManifest)({
					...manifest,
					scripts: [
						...manifest.scripts.slice(0, 2),
						{ ...detailsScript, providerSlug: "missing.provider" },
						...manifest.scripts.slice(3),
					],
				}),
			);
			yield* Effect.flip(
				Schema.decodeEffect(PluginManifest)({
					...manifest,
					scripts: [
						...manifest.scripts.slice(0, 2),
						{ ...detailsScript, providerOperation: "search" },
						...manifest.scripts.slice(3),
					],
				}),
			);
			yield* Effect.flip(
				Schema.decodeEffect(PluginManifest)({
					...manifest,
					scripts: [
						...manifest.scripts.slice(0, 4),
						{ ...preloadScript, providerSlug: "missing.provider" },
					],
				}),
			);
			yield* Effect.flip(
				Schema.decodeEffect(PluginManifest)({
					...manifest,
					scripts: manifest.scripts.map((script) =>
						script.slug === detailsScript.slug ? { ...script, kind: "script" as const } : script,
					),
				}),
			);
			yield* Effect.flip(
				Schema.decodeUnknownEffect(PluginManifest)({
					...manifest,
					scripts: [{ ...manifest.scripts[0], providerSlug: provider.slug }],
				}),
			);
			expect(
				yield* Schema.decodeEffect(PluginManifest)({
					...manifest,
					providers: [...manifest.providers, { ...provider, slug: "provider.other" }],
					scripts: [
						...manifest.scripts,
						{ ...detailsScript, slug: "provider.other.details", providerSlug: "provider.other" },
					],
				}),
			).toBeTruthy();
		}),
	);

	it.effect("rejects removed provider links and aliases", () =>
		Effect.gen(function* () {
			const providerScript = manifest.scripts[2];
			yield* Effect.flip(
				Schema.decodeUnknownEffect(PluginManifest)({
					...manifest,
					bindings: {
						schemaProviderLinks: [{ providerSlug: "missing", entitySchemaSlug: "entity.test" }],
					},
				}),
			);
			yield* Effect.flip(
				Schema.decodeUnknownEffect(PluginManifest)({
					...manifest,
					bindings: {
						schemaProviderLinks: [{ scriptSlug: "provider.test", entitySchemaSlug: "entity.test" }],
					},
				}),
			);
			yield* Effect.flip(
				Schema.decodeUnknownEffect(PluginManifest)({
					...manifest,
					scripts: [
						...manifest.scripts.slice(0, 2),
						{ ...providerScript, providerInformation: { source: "Old source" } },
						...manifest.scripts.slice(3),
					],
				}),
			);
		}),
	);

	it.effect("requires hooks to reference existing automation scripts", () =>
		Effect.gen(function* () {
			yield* Effect.flip(
				Schema.decodeEffect(PluginManifest)({
					...manifest,
					hooks: [{ ...manifest.hooks[0], scriptSlug: "missing.script" }],
				}),
			);
			yield* Effect.flip(
				Schema.decodeEffect(PluginManifest)({
					...manifest,
					hooks: [{ ...manifest.hooks[0], scriptSlug: "provider.test.details" }],
				}),
			);
			yield* Effect.flip(
				Schema.decodeUnknownEffect(PluginManifest)({
					...manifest,
					bindings: {
						eventAutomations: [],
						entityAutomations: [],
						signalAutomations: [],
						relationshipAutomations: [],
						providerEntityImportAutomations: [],
					},
				}),
			);
		}),
	);

	it.effect("strictly validates cron declarations", () =>
		Effect.gen(function* () {
			const cron = manifest.crons[0];
			yield* Effect.flip(
				Schema.decodeEffect(PluginManifest)({
					...manifest,
					crons: [{ ...cron, slug: "Invalid/Slug" }],
				}),
			);
			yield* Effect.flip(
				Schema.decodeEffect(PluginManifest)({
					...manifest,
					crons: [
						{
							slug: cron.slug,
							schedule: cron.schedule,
							scriptSlug: "missing.script",
							description: cron.description,
						},
					],
				}),
			);
			yield* Effect.flip(
				Schema.decodeEffect(PluginManifest)({
					...manifest,
					crons: [{ ...cron, schedule: { cron: "" } }],
				}),
			);
			yield* Effect.flip(
				Schema.decodeEffect(PluginManifest)({
					...manifest,
					crons: [{ ...cron, scriptSlug: "Invalid/Slug" }],
				}),
			);
			yield* Effect.flip(
				Schema.decodeEffect(PluginManifest)({
					...manifest,
					crons: [{ ...cron, description: " " }],
				}),
			);
			yield* Effect.flip(
				Schema.decodeUnknownEffect(PluginManifest)({
					...manifest,
					crons: [{ ...cron, timezone: "UTC" }],
				}),
			);
		}),
	);

	it.effect("discriminates integration providers on their lot", () =>
		Effect.gen(function* () {
			const [yank, push] = manifest.integrationProviders;
			const decoded = yield* Schema.decodeEffect(PluginManifest)({
				...manifest,
				integrationProviders: [{ ...yank, supportsOwnershipSync: true }, push],
			});
			const sink = yield* Schema.decodeEffect(PluginManifest)({
				...manifest,
				integrationProviders: [{ ...yank, lot: "sink", slug: "integration.sink" }, push],
			});

			expect(decoded.integrationProviders[0]).toMatchObject({
				lot: "yank",
				supportsOwnershipSync: true,
				scriptSlug: "automation.test",
			});
			expect(sink.integrationProviders[0]).toMatchObject({
				lot: "sink",
				scriptSlug: "automation.test",
			});
			expect(sink.integrationProviders[1]).not.toHaveProperty("scriptSlug");
			yield* Effect.flip(
				Schema.decodeEffect(PluginManifest)({
					...manifest,
					integrationProviders: [
						{ ...yank, lot: "sink", slug: "integration.sink", supportsOwnershipSync: true },
						push,
					],
				}),
			);
			yield* Effect.flip(
				Schema.decodeUnknownEffect(PluginManifest)({
					...manifest,
					integrationProviders: [yank, { ...push, scriptSlug: "automation.test" }],
				}),
			);
			yield* Effect.flip(
				Schema.decodeUnknownEffect(PluginManifest)({
					...manifest,
					integrationProviders: [{ ...yank, scriptSlug: undefined }, push],
				}),
			);
			yield* Effect.flip(
				Schema.decodeUnknownEffect(PluginManifest)({
					...manifest,
					integrationProviders: [{ ...yank, lot: "webhook" }, push],
				}),
			);
		}),
	);

	it.effect("strictly validates integration provider declarations", () =>
		Effect.gen(function* () {
			const [yank, push] = manifest.integrationProviders;
			yield* Effect.flip(
				Schema.decodeEffect(PluginManifest)({
					...manifest,
					integrationProviders: [yank, push, { ...push }],
				}),
			);
			yield* Effect.flip(
				Schema.decodeEffect(PluginManifest)({
					...manifest,
					integrationProviders: [{ ...yank, scriptSlug: "missing.script" }, push],
				}),
			);
			yield* Effect.flip(
				Schema.decodeEffect(PluginManifest)({
					...manifest,
					integrationProviders: [{ ...yank, description: " " }, push],
				}),
			);
			yield* Effect.flip(
				Schema.decodeUnknownEffect(PluginManifest)({
					...manifest,
					integrationProviders: [{ ...yank, webhookPath: "/hook" }, push],
				}),
			);
		}),
	);

	it.effect("validates OAuth providers and the integration settings that reference them", () =>
		Effect.gen(function* () {
			const [yank, push] = manifest.integrationProviders;
			const oauthProvider = {
				pkce: "S256",
				slug: "account",
				name: "Account",
				clientIdConfigKey: "CLIENT_ID",
				clientSecretConfigKey: "TEST_KEY",
				scopes: ["user-read-recently-played"],
				accessTokenLifetimeSeconds: 31_536_000,
				tokenEndpointAuth: "client_secret_basic",
				tokenUrl: "https://accounts.example.com/api/token",
				authorizeUrl: "https://accounts.example.com/authorize?show_dialog=true",
			} as const;
			const accountField = {
				type: "string",
				label: "Account",
				description: "Linked account",
				format: { provider: "account", kind: "oauth-connection" },
			} as const;
			const withOAuth = (
				overrides: {
					readonly provider?: Record<string, unknown>;
					readonly settingsFields?: Record<string, unknown>;
				} = {},
			) => ({
				...manifest,
				oauthProviders: [{ ...oauthProvider, ...overrides.provider }],
				integrationProviders: [
					{
						...yank,
						settingsSchema: { fields: overrides.settingsFields ?? { account: accountField } },
					},
					push,
				],
				configSchema: {
					...manifest.configSchema,
					fields: {
						...manifest.configSchema.fields,
						CLIENT_ID: { type: "string", label: "Client ID", description: "OAuth client ID" },
					},
				},
			});

			expect(
				(yield* Schema.decodeUnknownEffect(PluginManifest)(withOAuth())).oauthProviders,
			).toEqual([oauthProvider]);
			expect(
				(yield* Schema.decodeUnknownEffect(PluginManifest)(
					withOAuth({ provider: { pkce: "none" } }),
				)).oauthProviders?.[0]?.pkce,
			).toBe("none");
			for (const invalid of [
				withOAuth({ provider: { tokenUrl: "http://accounts.example.com/api/token" } }),
				withOAuth({ provider: { pkce: undefined } }),
				withOAuth({ provider: { pkce: "plain" } }),
				withOAuth({ provider: { accessTokenLifetimeSeconds: 0 } }),
				withOAuth({ provider: { accessTokenLifetimeSeconds: 1.5 } }),
				withOAuth({ provider: { accessTokenLifetimeSeconds: Number.MAX_SAFE_INTEGER + 1 } }),
				withOAuth({ provider: { authorizeUrl: "https://accounts.example.com/authorize?state=x" } }),
				withOAuth({
					provider: { authorizeUrl: "https://user:pass@accounts.example.com/authorize" },
				}),
				withOAuth({ provider: { scopes: ["two scopes"] } }),
				withOAuth({ provider: { clientSecretConfigKey: "CLIENT_ID" } }),
				withOAuth({ provider: { clientIdConfigKey: "MISSING" } }),
				withOAuth({ provider: { tokenEndpointAuth: "none" } }),
				withOAuth({
					settingsFields: {
						account: { ...accountField, format: { provider: "missing", kind: "oauth-connection" } },
					},
				}),
				withOAuth({ settingsFields: { account: { ...accountField, defaultValue: "connection" } } }),
				withOAuth({
					settingsFields: {
						nested: {
							type: "object",
							label: "Nested",
							description: "Nested",
							properties: { account: accountField },
						},
					},
				}),
				{ ...withOAuth(), oauthProviders: [oauthProvider, oauthProvider] },
				{
					...withOAuth(),
					importSources: [
						{
							...manifest.importSources[0],
							inputSchema: {
								unknownKeys: "strict",
								fields: { ...manifest.importSources[0].inputSchema.fields, account: accountField },
							},
						},
					],
				},
				{
					...withOAuth(),
					signalSchemas: [
						{
							...manifest.signalSchemas[0],
							propertiesSchema: { fields: { account: accountField } },
						},
					],
				},
			]) {
				yield* Effect.flip(Schema.decodeUnknownEffect(PluginManifest)(invalid));
			}
		}),
	);

	it.effect("strictly validates schema-driven import source declarations", () =>
		Effect.gen(function* () {
			const importSource = manifest.importSources[0];
			const decoded = yield* Schema.decodeEffect(PluginManifest)(manifest);
			expect(decoded.importSources[0]).toMatchObject({
				slug: "import.test",
				workflowSlug: "refresh.workflow",
				exportHelp: { docsUrl: "https://example.com/export" },
				inputSchema: {
					unknownKeys: "strict",
					fields: { file: { format: { kind: "upload", allowedFileExtensions: ["json"] } } },
				},
			});

			for (const source of [
				{ ...importSource, workflowSlug: "missing.workflow" },
				{ ...importSource, workflowSlug: "workflow.test" },
				{ ...importSource, input: "file" },
				{ ...importSource, lot: "single" },
				{ ...importSource, artifacts: [] },
				{ ...importSource, exportHelp: {} },
				{ ...importSource, maxFileSizeBytes: 1024 },
			]) {
				yield* Effect.flip(
					Schema.decodeEffect(PluginManifest)({ ...manifest, importSources: [source] }),
				);
			}

			yield* Effect.flip(
				Schema.decodeEffect(PluginManifest)({
					...manifest,
					importSources: [importSource, { ...importSource }],
				}),
			);
		}),
	);

	it.effect("requires strict import inputs with resolved choices and only top-level uploads", () =>
		Effect.gen(function* () {
			const importSource = manifest.importSources[0];
			const nestedUpload = {
				type: "object",
				label: "Options",
				description: "Import options",
				properties: {
					file: {
						label: "File",
						type: "string",
						description: "Import file",
						format: { kind: "upload", allowedFileExtensions: ["json"] },
					},
				},
			};
			const dynamicChoice = {
				type: "enum",
				label: "Account",
				description: "Import account",
				choices: { kind: "dynamic", source: "accounts" },
			};

			for (const inputSchema of [
				{ fields: {} },
				{ fields: {}, unknownKeys: "strip" },
				{ unknownKeys: "strict", fields: { options: nestedUpload } },
				{ unknownKeys: "strict", fields: { account: dynamicChoice } },
			]) {
				yield* Effect.flip(
					Schema.decodeUnknownEffect(PluginManifest)({
						...manifest,
						importSources: [{ ...importSource, inputSchema }],
					}),
				);
			}
		}),
	);

	it.effect("rejects upload fields in non-import plugin schemas", () =>
		Effect.gen(function* () {
			const uploadSchema = {
				fields: {
					options: {
						type: "object",
						label: "Options",
						description: "Options",
						properties: {
							file: {
								label: "File",
								type: "string",
								description: "File",
								format: { kind: "upload", allowedFileExtensions: ["json"] },
							},
						},
					},
				},
			};
			const entitySchema = {
				icon: "box",
				name: "Entity",
				slug: "entity",
				eventSchemas: [],
				propertiesSchema: { fields: {} },
			};
			const eventSchema = { name: "Event", slug: "event", propertiesSchema: uploadSchema };
			const relationshipSchema = {
				name: "Relationship",
				slug: "relationship",
				sourceEntitySchemaSlug: null,
				targetEntitySchemaSlug: null,
				propertiesSchema: uploadSchema,
			};
			const integrationProvider = manifest.integrationProviders[0];
			const searchScript = manifest.scripts[3];

			for (const candidate of [
				{
					...manifest,
					entitySchemas: [
						...manifest.entitySchemas,
						{ ...entitySchema, propertiesSchema: uploadSchema },
					],
				},
				{
					...manifest,
					entitySchemas: [
						...manifest.entitySchemas,
						{ ...entitySchema, eventSchemas: [eventSchema] },
					],
				},
				{
					...manifest,
					signalSchemas: [{ ...manifest.signalSchemas[0], propertiesSchema: uploadSchema }],
				},
				{ ...manifest, relationshipSchemas: [relationshipSchema] },
				{
					...manifest,
					configSchema: {
						unknownKeys: "strict",
						fields: { file: uploadSchema.fields.options.properties.file },
					},
				},
				{
					...manifest,
					integrationProviders: [
						{ ...integrationProvider, settingsSchema: uploadSchema },
						manifest.integrationProviders[1],
					],
				},
				{
					...manifest,
					scripts: [
						...manifest.scripts.slice(0, 3),
						{ ...searchScript, searchOptionsSchema: uploadSchema },
						...manifest.scripts.slice(4),
					],
				},
			]) {
				yield* Effect.flip(Schema.decodeUnknownEffect(PluginManifest)(candidate));
			}
		}),
	);
});

const withSources = (calendarSources: ReadonlyArray<unknown>) => ({ ...manifest, calendarSources });

describe("calendar sources", () => {
	const calendarSource = {
		icon: "calendar",
		precision: "date",
		startAt: "startAt",
		caption: "caption",
		name: "Entity dates",
		slug: "entity-dates",
		subject: {
			entityAlias: "entity",
			schemas: [{ owner: { kind: "self" }, slug: EntitySchemaSlug.make("entity.test") }],
		},
		query: {
			from: { alias: "entity", table: "entity" },
			output: {
				type: "rows",
				fields: [
					{ key: "startAt", expr: { type: "column", field: "createdAt", tableAlias: "entity" } },
					{ key: "caption", expr: { field: "name", type: "column", tableAlias: "entity" } },
				],
			},
		},
	} as const;

	it.effect("decodes declared sources and keeps manifests without sources valid", () =>
		Effect.gen(function* () {
			expect(
				(yield* Schema.decodeEffect(PluginManifest)(manifest)).calendarSources,
			).toBeUndefined();
			expect(
				(yield* Schema.decodeUnknownEffect(PluginManifest)(withSources([calendarSource])))
					.calendarSources,
			).toEqual([calendarSource]);
			expect(
				definePlugin({ ...authoredManifest, calendarSources: [calendarSource] }).calendarSources,
			).toEqual([calendarSource]);
		}),
	);

	it.effect("rejects named fields the query does not project", () =>
		Effect.gen(function* () {
			for (const field of ["startAt", "caption", "art", "done"] as const) {
				yield* Effect.flip(
					Schema.decodeUnknownEffect(PluginManifest)(
						withSources([{ ...calendarSource, [field]: "missing" }]),
					),
				);
			}
		}),
	);

	it.effect("rejects a subject alias that is not in the query", () =>
		Effect.flip(
			Schema.decodeUnknownEffect(PluginManifest)(
				withSources([
					{ ...calendarSource, subject: { ...calendarSource.subject, entityAlias: "other" } },
				]),
			),
		),
	);

	it.effect("rejects duplicate source slugs", () =>
		Effect.gen(function* () {
			yield* Effect.flip(
				Schema.decodeUnknownEffect(PluginManifest)(withSources([calendarSource, calendarSource])),
			);
			expect(
				Result.isSuccess(
					Schema.decodeUnknownResult(PluginManifest)(
						withSources([calendarSource, { ...calendarSource, slug: "other-dates" }]),
					),
				),
			).toBe(true);
		}),
	);

	it.effect("rejects authored ordering, pagination, and cursors", () =>
		Effect.gen(function* () {
			for (const output of [
				{ orderBy: [] },
				{ pagination: { limit: 20 } },
				{ pagination: { limit: 20, after: "cursor" } },
			]) {
				yield* Effect.flip(
					Schema.decodeUnknownEffect(PluginManifest)(
						withSources([
							{
								...calendarSource,
								query: {
									...calendarSource.query,
									output: { ...calendarSource.query.output, ...output },
								},
							},
						]),
					),
				);
			}
		}),
	);

	it.effect("rejects unknown precisions and other output kinds", () =>
		Effect.gen(function* () {
			yield* Effect.flip(
				Schema.decodeUnknownEffect(PluginManifest)(
					withSources([{ ...calendarSource, precision: "week" }]),
				),
			);
			yield* Effect.flip(
				Schema.decodeUnknownEffect(PluginManifest)(
					withSources([
						{
							...calendarSource,
							query: {
								...calendarSource.query,
								output: {
									type: "aggregate",
									measures: [{ key: "count", aggregation: { function: "count" } }],
								},
							},
						},
					]),
				),
			);
		}),
	);
});

const withSchedules = (signalSchedules: ReadonlyArray<unknown>) => ({
	...manifest,
	signalSchedules,
});

describe("signal schedules", () => {
	const schedule = {
		dueAt: "dueAt",
		precision: "date",
		slug: "entity-due",
		signal: "test.signal",
		occurrence: "occurrence",
		properties: { entityName: "name" },
		subject: {
			entityAlias: "entity",
			schemas: [{ owner: { kind: "self" }, slug: EntitySchemaSlug.make("entity.test") }],
		},
		query: {
			from: { alias: "entity", table: "entity" },
			output: {
				type: "rows",
				fields: [
					{ key: "dueAt", expr: { type: "column", field: "createdAt", tableAlias: "entity" } },
					{ key: "occurrence", expr: { field: "id", type: "column", tableAlias: "entity" } },
					{ key: "name", expr: { field: "name", type: "column", tableAlias: "entity" } },
				],
			},
		},
	} as const;

	it.effect("decodes schedules over projected fields of an actor signal", () =>
		Effect.gen(function* () {
			expect(
				(yield* Schema.decodeUnknownEffect(PluginManifest)(
					withSchedules([{ ...schedule, delayDays: 7, requiresProKey: true }]),
				)).signalSchedules,
			).toEqual([{ ...schedule, delayDays: 7, requiresProKey: true }]);
		}),
	);

	it.effect("rejects unprojected fields, foreign subjects, unknown signals and bad delays", () =>
		Effect.gen(function* () {
			for (const candidate of [
				{ ...schedule, dueAt: "missing" },
				{ ...schedule, occurrence: "missing" },
				{ ...schedule, properties: { entityName: "missing" } },
				{ ...schedule, freshness: { maxAgeHours: 1, confirmedAt: "missing" } },
				{ ...schedule, subject: { ...schedule.subject, entityAlias: "other" } },
				{ ...schedule, signal: "other.signal" },
				{ ...schedule, delayDays: 0 },
			]) {
				yield* Effect.flip(Schema.decodeUnknownEffect(PluginManifest)(withSchedules([candidate])));
			}
			yield* Effect.flip(
				Schema.decodeUnknownEffect(PluginManifest)(withSchedules([schedule, schedule])),
			);
		}),
	);

	it.effect("rejects schedules for signals delivered to other audiences", () =>
		Effect.flip(
			Schema.decodeUnknownEffect(PluginManifest)({
				...withSchedules([schedule]),
				signalSchemas: [
					{
						...manifest.signalSchemas[0],
						audiencePolicy: {
							kind: "related_users",
							subjectSide: "source",
							relationshipSchemaSlug: "test.relationship",
						},
					},
				],
			}),
		),
	);
});
