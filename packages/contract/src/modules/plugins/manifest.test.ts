import { Result, Schema } from "effect";
import { assert, describe, expect, it } from "vitest";

import { ImportsGroup } from "../imports/contract";
import { ListedImportSource } from "../imports/schemas";
import { uploadContentTypeExtensions } from "../uploads/upload-policy";
import { CLIENT_API_VERSION, definePlugin, PluginManifest } from "./manifest";

const queryDocument = {
	queries: {
		entities: {
			from: { alias: "entity", table: "entity" },
			output: {
				orderBy: [],
				type: "rows",
				pagination: { limit: 20 },
				fields: [
					{ key: "entityId", expr: { field: "id", tableAlias: "entity", type: "column" } },
					{ key: "title", expr: { field: "name", tableAlias: "entity", type: "column" } },
				],
			},
		},
	},
} as const;

const authoredManifest = definePlugin({
	entitySchemas: [],
	httpRateLimits: [],
	relationshipSchemas: [],
	configSchema: {
		unknownKeys: "strict",
		fields: {
			TEST_KEY: {
				secret: true,
				type: "string",
				label: "Test key",
				description: "Test plugin key",
				validation: { required: true, minLength: 1 },
			},
		},
	},
	savedViews: [
		{
			sortOrder: 0,
			icon: "bookmark",
			pluginSlug: "test",
			name: "All entities",
			slug: "all-entities",
			renderer: { kind: "kernel", name: "results-table" },
			dataSources: queryDocument,
			settings: {
				pageSize: 20,
				sourceName: "entities",
				rowKeyFields: ["entityId"],
				entityLink: { entityIdField: "entityId" },
				columns: [{ label: "Title", field: "title", displayKind: "text" }],
			},
		},
	],
	boot: [{ slug: "boot.test", scriptSlug: "automation.test", description: "Boot test data" }],
	userBootstrap: [
		{
			slug: "bootstrap.test",
			description: "Bootstrap user data",
			scriptSlug: "provider.test.preload",
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
	signalSchemas: [
		{
			name: "Test signal",
			slug: "test.signal",
			catalogState: "active",
			propertiesSchema: { fields: {} },
			audiencePolicy: { kind: "actor" },
			notificationScriptSlug: "automation.test",
		},
	],
	operations: [
		{
			auth: "user",
			slug: "resolve.test",
			scriptSlug: "operation.test",
			description: "Resolve test references",
		},
	],
	workflows: [{ slug: "refresh.workflow", scriptSlug: "workflow.test" }],
	importSources: [
		{
			slug: "import.test",
			name: "Test import source",
			workflowSlug: "refresh.workflow",
			requiredPluginConfigKeys: ["TEST_KEY"],
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
	providers: [
		{
			slug: "provider.test",
			name: "Test provider",
			rootEntitySchemaSlug: "entity.test",
			information: { source: "Test source", canonicalLanguage: "en" },
			operations: { details: "provider.test.details", search: "provider.test.search" },
		},
	],
	metadata: {
		icon: "box",
		name: "Test",
		slug: "test",
		version: "1.0.0",
		description: "Test plugin",
	},
	bindings: {
		eventAutomations: [],
		entityAutomations: [],
		signalAutomations: [],
		relationshipAutomations: [],
		providerEntityImportAutomations: [],
	},
});

const scripts = [
	{
		kind: "automation",
		name: "Test automation",
		slug: "automation.test",
		requiredPluginConfigKeys: [],
		requiredSystemConfigKeys: [],
		capabilities: ["emitSignal"],
		entry: "scripts/test.sandbox.ts",
	},
	{
		capabilities: [],
		kind: "operation",
		name: "Test operation",
		slug: "operation.test",
		requiredPluginConfigKeys: [],
		requiredSystemConfigKeys: [],
		entry: "scripts/operation.sandbox.ts",
	},
	{
		kind: "provider",
		capabilities: [],
		providerOperation: "details",
		requiredPluginConfigKeys: [],
		requiredSystemConfigKeys: [],
		name: "Test provider details",
		slug: "provider.test.details",
		providerSlug: "provider.test",
		entry: "scripts/provider-details.sandbox.ts",
	},
	{
		kind: "provider",
		capabilities: [],
		providerOperation: "search",
		requiredPluginConfigKeys: [],
		requiredSystemConfigKeys: [],
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
		capabilities: [],
		requiredPluginConfigKeys: [],
		requiredSystemConfigKeys: [],
		name: "Test provider preload",
		slug: "provider.test.preload",
		providerSlug: "provider.test",
		entry: "scripts/provider-preload.sandbox.ts",
	},
	{
		kind: "workflow",
		capabilities: [],
		name: "Test workflow",
		slug: "workflow.test",
		requiredPluginConfigKeys: [],
		requiredSystemConfigKeys: [],
		entry: "scripts/workflow.sandbox.ts",
	},
] as const;

const manifest = { ...authoredManifest, scripts };

describe("definePlugin", () => {
	it("preserves manifest literals", () => {
		const slug: "test" = manifest.metadata.slug;
		const scriptKind: "automation" = manifest.scripts[0].kind;
		const cron = manifest.crons[0];
		const scriptSlug: "automation.test" = cron.scriptSlug;

		expect(slug).toBe("test");
		expect(scriptSlug).toBe("automation.test");
		expect(scriptKind).toBe("automation");
	});

	it("contains only the supported manifest sections", () => {
		type HasBoot = "boot" extends keyof PluginManifest ? true : false;
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
			HasBoot,
			HasOperations,
			HasWorkflows,
			HasImportSources,
			HasUserBootstrap,
			HasIntegrationProviders,
		] = [false, true, true, true, true, true, true, true];

		expect(optionalSections).toEqual([false, true, true, true, true, true, true, true]);
	});

	it("decodes the manifest with the canonical Effect schema", () => {
		expect(Schema.decodeUnknownSync(PluginManifest)(manifest)).toEqual(manifest);
		expect(Schema.decodeUnknownSync(PluginManifest)(manifest).scripts[3]).toMatchObject({
			searchOptionsSchema: { unknownKeys: "strict" },
		});
	});

	it("accepts a declarative client manifest", () => {
		const client = {
			homeView: null,
			apiVersion: CLIENT_API_VERSION,
			exports: {
				page: {
					kind: "page" as const,
					entry: "client/pages/index.tsx",
					settingsSchema: { fields: {} },
					automaticEntityPresentations: false,
				},
			},
		};
		const decoded = Schema.decodeUnknownSync(PluginManifest)({ ...manifest, client });

		expect(decoded.client).toEqual(client);
	});

	it("decodes declarative public client exports by kind", () => {
		const client = {
			apiVersion: CLIENT_API_VERSION,
			homeView: null,
			notFoundPage: "dashboard",
			pluginDependencies: ["media", "private-fixture"],
			routes: { "/": "dashboard", "/things/$thingId": "dashboard" },
			entities: { thing: { detailPage: "dashboard", gridPresentation: "row" } },
			exports: {
				dashboard: {
					kind: "page" as const,
					entry: "client/dashboard.tsx",
					automaticEntityPresentations: true,
					settingsSchema: {
						fields: {
							title: { type: "string" as const, label: "Title", description: "Page title" },
						},
					},
				},
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
			},
		};

		const manifestWithEntity = {
			...manifest,
			entitySchemas: [
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
			Schema.decodeUnknownSync(PluginManifest)({ ...manifestWithEntity, client }).client,
		).toEqual(client);
		const invalidClients = [
			{ ...client, entry: "client/index.tsx" },
			{ ...client, homeView: "missing-view" },
			{
				...client,
				exports: { dashboard: { ...client.exports.dashboard, settingsSchema: undefined } },
			},
			{ ...client, exports: { card: { ...client.exports.card, settingsSchema: { fields: {} } } } },
			{ ...client, exports: { "../card": client.exports.card } },
			{ ...client, exports: { card: { ...client.exports.card, entry: "backend/card.tsx" } } },
			{ ...client, pluginDependencies: ["media", "media"] },
			{ ...client, entities: { missing: { gridPresentation: "row" } } },
			{ ...client, entities: { thing: { gridPresentation: "card" } } },
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
		).toEqual([true, true, true, true, true, true, true, true, true, true, true]);
	});

	it("accepts plugin-owned default homes and portable plugin renderers", () => {
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
			name: "Plugin page",
			slug: "plugin-page",
			sortOrder: 1,
			pluginSlug: "test",
			dataSources: null,
			settings: {},
			renderer: { kind: "plugin" as const, exportName: "page" },
		};

		expect(
			Schema.decodeUnknownSync(PluginManifest)({
				...manifest,
				client,
				savedViews: [...manifest.savedViews, pluginView],
			}).savedViews[1]?.renderer,
		).toEqual({ kind: "plugin", exportName: "page" });
		for (const renderer of [
			{ kind: "custom", rendererId: "runtime-id" },
			{ kind: "plugin", pluginId: "runtime-plugin-id", exportName: "page" },
		]) {
			expect(() =>
				Schema.decodeUnknownSync(PluginManifest)({
					...manifest,
					client,
					savedViews: [{ ...pluginView, renderer }],
				}),
			).toThrow();
		}
	});

	it("rejects non-TypeScript export entries outside client/ or with noncanonical paths", () => {
		for (const entry of [
			"index.tsx",
			"backend/index.ts",
			"client/index.js",
			"client/index.css",
			"client/../index.tsx",
			"client//index.tsx",
			"client\\index.tsx",
		]) {
			expect(() =>
				Schema.decodeUnknownSync(PluginManifest)({
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
			).toThrow();
		}
	});

	it("rejects speculative client capabilities", () => {
		expect(() =>
			Schema.decodeUnknownSync(PluginManifest)({
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
		).toThrow();
	});

	it("keeps backend-only manifests valid", () => {
		expect(Schema.decodeUnknownSync(PluginManifest)(manifest)).toEqual(manifest);
	});

	it("accepts import upload extensions from the supported upload policy", () => {
		const [source] = manifest.importSources;
		assert(source);
		const extensions = [...new Set(Object.values(uploadContentTypeExtensions).flat())];
		const decoded = Schema.decodeUnknownSync(PluginManifest)({
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
	});

	it("rejects unsupported import upload extensions clearly", () => {
		const [source] = manifest.importSources;
		assert(source);
		expect(() =>
			Schema.decodeUnknownSync(PluginManifest)({
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
		).toThrow("Unsupported import upload file extension: exe");
	});

	it("exposes listed import sources from the authenticated imports endpoint", () => {
		const listedSource = {
			...manifest.importSources[0],
			pluginSlug: "test",
			isStartable: false,
			missingPluginConfigKeys: ["TEST_KEY"],
		};
		const endpoint = ImportsGroup.endpoints.listSources;

		expect(endpoint.method).toBe("GET");
		expect(endpoint.path).toBe("/imports/sources");
		expect(endpoint.middlewares.size).toBeGreaterThan(0);
		expect(Schema.decodeUnknownSync(ListedImportSource)(listedSource)).toEqual(listedSource);
		expect(() =>
			Schema.decodeUnknownSync(ListedImportSource)({
				...listedSource,
				lot: "single",
				input: "file",
				inputSchema: undefined,
				allowedFileExtensions: ["json"],
			}),
		).toThrow();
	});

	it("requires and decodes saved-view renderer settings and data sources", () => {
		const [savedView] = Schema.decodeUnknownSync(PluginManifest)(manifest).savedViews;
		assert(savedView);

		expect(savedView.renderer).toEqual({ kind: "kernel", name: "results-table" });
		expect(savedView.dataSources).toEqual(queryDocument);
		expect(savedView.settings["sourceName"]).toBe("entities");
	});

	it("requires saved-view renderer settings", () => {
		const [savedView] = manifest.savedViews;
		assert(savedView);
		expect(() =>
			Schema.decodeUnknownSync(PluginManifest)({
				...manifest,
				savedViews: [{ ...savedView, settings: undefined }],
			}),
		).toThrow();
	});

	it("rejects removed saved-view sandbox scripts", () => {
		const [savedView] = manifest.savedViews;
		assert(savedView);
		expect(() =>
			Schema.decodeUnknownSync(PluginManifest)({
				...manifest,
				savedViews: [{ ...savedView, sandboxScripts: {} }],
			}),
		).toThrow();
	});

	it("normalizes strict HTTP rate limit declarations", () => {
		const decoded = Schema.decodeUnknownSync(PluginManifest)({
			...manifest,
			httpRateLimits: [
				{
					requests: 90,
					intervalMs: 60_000,
					key: "catalog.anilist",
					origins: ["HTTPS://GRAPHQL.ANILIST.CO:443/"],
				},
			],
		});

		expect(decoded.httpRateLimits).toEqual([
			{
				requests: 90,
				intervalMs: 60_000,
				key: "catalog.anilist",
				origins: ["https://graphql.anilist.co"],
			},
		]);
		expect(() =>
			Schema.decodeUnknownSync(PluginManifest)({
				...manifest,
				httpRateLimits: [
					{
						requests: 90,
						unsupported: true,
						intervalMs: 60_000,
						key: "catalog.anilist",
						origins: ["https://graphql.anilist.co"],
					},
				],
			}),
		).toThrow();
	});

	it("rejects invalid HTTP rate limit declaration forms", () => {
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
			expect(() =>
				Schema.decodeUnknownSync(PluginManifest)({ ...manifest, httpRateLimits: [candidate] }),
			).toThrow();
		}
		expect(() => {
			const { httpRateLimits: _httpRateLimits, ...missing } = manifest;
			return Schema.decodeUnknownSync(PluginManifest)(missing);
		}).toThrow();
	});

	it("rejects duplicate normalized HTTP rate limit keys and origins", () => {
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
			expect(() =>
				Schema.decodeUnknownSync(PluginManifest)({ ...manifest, httpRateLimits }),
			).toThrow();
		}
	});

	it("rejects excess properties throughout the manifest", () => {
		expect(() =>
			Schema.decodeUnknownSync(PluginManifest)({
				...manifest,
				metadata: { ...manifest.metadata, unsupported: true },
			}),
		).toThrow();
		expect(() =>
			Schema.decodeUnknownSync(PluginManifest)({
				...manifest,
				providers: [
					{
						...manifest.providers[0],
						information: { ...manifest.providers[0].information, unsupported: true },
					},
				],
			}),
		).toThrow();
	});

	it("decodes optional entity merge identity properties", () => {
		const decoded = Schema.decodeUnknownSync(PluginManifest)({
			...manifest,
			entitySchemas: [
				{
					icon: "box",
					name: "Entity",
					slug: "entity",
					eventSchemas: [],
					mergeIdentityProperties: ["kind"],
					propertiesSchema: {
						fields: { kind: { type: "string", label: "Kind", description: "Entity kind" } },
					},
				},
			],
		});

		expect(decoded.entitySchemas[0]?.mergeIdentityProperties).toEqual(["kind"]);
	});

	it("decodes optional entity user-state restrictions with permissive absence", () => {
		const decoded = Schema.decodeUnknownSync(PluginManifest)({
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
					slug: "entity",
					eventSchemas: [],
					propertiesSchema: { fields: {} },
				},
			],
		});

		expect(decoded.entitySchemas[0]?.userState?.deniedOperations).toEqual(["clear", "merge"]);
		expect(decoded.entitySchemas[1]?.userState).toBeUndefined();
	});

	it("requires signal notification formatter references", () => {
		const signalSchema = manifest.signalSchemas[0];
		expect(() =>
			Schema.decodeUnknownSync(PluginManifest)({
				...manifest,
				signalSchemas: [{ ...signalSchema, notificationScriptSlug: undefined }],
			}),
		).toThrow();
	});

	it("allows signal notification formatters owned by another plugin", () => {
		const signalSchema = manifest.signalSchemas[0];
		const notificationScriptSlug = "kernel.notification-formatter";
		const decoded = Schema.decodeUnknownSync(PluginManifest)({
			...manifest,
			signalSchemas: [{ ...signalSchema, notificationScriptSlug }],
		});

		expect(decoded.signalSchemas[0]?.notificationScriptSlug).toBe(notificationScriptSlug);
	});

	it("accepts direct scripts and rejects kinds outside the v1 contract", () => {
		const customScript = Schema.decodeUnknownSync(PluginManifest)(manifest).scripts[4];
		assert(customScript);
		expect(customScript).toMatchObject({
			kind: "script",
			providerSlug: "provider.test",
			slug: "provider.test.preload",
		});
		expect(() =>
			Schema.decodeUnknownSync(PluginManifest)({ ...manifest, capabilities: [] }),
		).toThrow();
		expect(() =>
			Schema.decodeUnknownSync(PluginManifest)({
				...manifest,
				scripts: [{ ...manifest.scripts[0], kind: "legacy" }],
			}),
		).toThrow();
	});

	it("requires unique user bootstrap entries targeting direct scripts in the same package", () => {
		const entry = manifest.userBootstrap[0];
		assert(entry);
		expect(Schema.decodeUnknownSync(PluginManifest)(manifest).userBootstrap).toEqual([entry]);
		for (const userBootstrap of [
			[{ ...entry }, { ...entry }],
			[{ ...entry, scriptSlug: "missing.script" }],
			[{ ...entry, scriptSlug: "automation.test" }],
		]) {
			expect(() =>
				Schema.decodeUnknownSync(PluginManifest)({ ...manifest, userBootstrap }),
			).toThrow();
		}
	});

	it("accepts operation scripts and validates operation declarations", () => {
		const operation = manifest.operations[0];
		const operationScript = Schema.decodeUnknownSync(PluginManifest)(manifest).scripts[1];
		assert(operationScript);
		expect(operationScript.kind).toBe("operation");
		expect(() =>
			Schema.decodeUnknownSync(PluginManifest)({
				...manifest,
				operations: [{ ...operation, slug: "Invalid/Slug" }],
			}),
		).toThrow();
		expect(() =>
			Schema.decodeUnknownSync(PluginManifest)({
				...manifest,
				operations: [{ ...operation, auth: "public" }],
			}),
		).toThrow();
		expect(() =>
			Schema.decodeUnknownSync(PluginManifest)({
				...manifest,
				operations: [{ ...operation, description: "" }],
			}),
		).toThrow();
	});

	it("accepts workflow declarations only for capability-free workflow scripts", () => {
		const workflow = manifest.workflows[0];
		const workflowScript = manifest.scripts[5];
		expect(workflowScript.kind).toBe("workflow");
		expect(() =>
			Schema.decodeUnknownSync(PluginManifest)({
				...manifest,
				workflows: [{ ...workflow, scriptSlug: manifest.scripts[1].slug }],
			}),
		).toThrow();
		expect(() =>
			Schema.decodeUnknownSync(PluginManifest)({
				...manifest,
				scripts: [
					...manifest.scripts.slice(0, 5),
					{ ...workflowScript, capabilities: ["httpCall"] },
				],
			}),
		).toThrow();
		expect(() =>
			Schema.decodeUnknownSync(PluginManifest)({
				...manifest,
				workflows: [...manifest.workflows, { ...workflow }],
			}),
		).toThrow();
	});

	it("enforces sandbox script manifest constraints", () => {
		expect(() =>
			Schema.decodeUnknownSync(PluginManifest)({
				...manifest,
				scripts: [{ ...manifest.scripts[0], slug: "Invalid/Slug" }],
			}),
		).toThrow();
		expect(() =>
			Schema.decodeUnknownSync(PluginManifest)({
				...manifest,
				scripts: [{ ...manifest.scripts[0], requiredPluginConfigKeys: [""] }],
			}),
		).toThrow();
	});

	it("restricts plugin config schemas to environment-safe top-level fields", () => {
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
			expect(() =>
				Schema.decodeUnknownSync(PluginManifest)({ ...manifest, configSchema }),
			).toThrow();
		}

		for (const field of [
			{ type: "date", label: "Value", description: "A date value" },
			{ type: "datetime", label: "Value", description: "A datetime value" },
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
				items: { type: "string", label: "Item", description: "An item" },
			},
			{ type: "object", label: "Value", properties: {}, description: "An object value" },
		]) {
			expect(() =>
				Schema.decodeUnknownSync(PluginManifest)({
					...manifest,
					configSchema: {
						...manifest.configSchema,
						fields: { ...manifest.configSchema.fields, value: field },
					},
				}),
			).toThrow();
		}
	});

	it("requires declared plugin config keys to exist in the config schema", () => {
		expect(() =>
			Schema.decodeUnknownSync(PluginManifest)({
				...manifest,
				scripts: [
					{ ...manifest.scripts[0], requiredPluginConfigKeys: ["MISSING_KEY"] },
					...manifest.scripts.slice(1),
				],
			}),
		).toThrow();
		expect(() =>
			Schema.decodeUnknownSync(PluginManifest)({
				...manifest,
				importSources: [
					{ ...manifest.importSources[0], requiredPluginConfigKeys: ["MISSING_KEY"] },
				],
			}),
		).toThrow();
	});

	it("rejects plugin config keys that normalize to the same environment variable", () => {
		expect(() =>
			Schema.decodeUnknownSync(PluginManifest)({
				...manifest,
				configSchema: {
					unknownKeys: "strict",
					fields: {
						"api-token": { type: "string", label: "API token", description: "Token" },
						api_token: { type: "string", label: "API token", description: "Token" },
					},
				},
				importSources: [],
				scripts: manifest.scripts.map((script) => ({ ...script, requiredPluginConfigKeys: [] })),
			}),
		).toThrow();
	});

	it("rejects duplicate script slugs within and across script kinds", () => {
		expect(() =>
			Schema.decodeUnknownSync(PluginManifest)({
				...manifest,
				scripts: [...manifest.scripts, { ...manifest.scripts[0] }],
			}),
		).toThrow();
		expect(() =>
			Schema.decodeUnknownSync(PluginManifest)({
				...manifest,
				scripts: [...manifest.scripts, { ...manifest.scripts[1], slug: manifest.scripts[0].slug }],
			}),
		).toThrow();
	});

	it("accepts dynamic search choices only with a search-options binding", () => {
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
						choices: { kind: "dynamic" as const, source: "statuses" },
					},
				},
			},
		};
		const dynamicManifest = {
			...manifest,
			providers: [
				{ ...provider, operations: { ...provider.operations, searchOptions: searchOptions.slug } },
			],
			scripts: [
				...manifest.scripts.filter(({ slug }) => slug !== search.slug),
				dynamicSearch,
				searchOptions,
			],
		};

		expect(Schema.decodeUnknownSync(PluginManifest)(dynamicManifest)).toBeTruthy();
		expect(() =>
			Schema.decodeUnknownSync(PluginManifest)({
				...dynamicManifest,
				providers: [{ ...provider, operations: provider.operations }],
			}),
		).toThrow();
		expect(() =>
			Schema.decodeUnknownSync(PluginManifest)({
				...manifest,
				providers: [
					{ ...provider, operations: { ...provider.operations, searchOptions: "missing.script" } },
				],
			}),
		).toThrow();
		expect(() =>
			Schema.decodeUnknownSync(PluginManifest)({
				...manifest,
				scripts: [...manifest.scripts, searchOptions],
			}),
		).toThrow();
	});

	it("strictly validates providers and their standard operation assignments", () => {
		const provider = manifest.providers[0];
		const detailsScript = manifest.scripts[2];
		const preloadScript = manifest.scripts[4];
		const otherDetailsScript = {
			...detailsScript,
			slug: "provider.other.details",
			providerSlug: "provider.other",
		};
		expect(() =>
			Schema.decodeUnknownSync(PluginManifest)({
				...manifest,
				providers: [{ ...provider, rootEntitySchemaSlug: undefined }],
			}),
		).toThrow();
		expect(() =>
			Schema.decodeUnknownSync(PluginManifest)({
				...manifest,
				scripts: [
					...manifest.scripts.slice(0, 2),
					{ ...detailsScript, providerOperation: undefined },
					...manifest.scripts.slice(3),
				],
			}),
		).toThrow();
		expect(() =>
			Schema.decodeUnknownSync(PluginManifest)({
				...manifest,
				scripts: [
					...manifest.scripts.slice(0, 2),
					{ ...detailsScript, searchOptionsSchema: { fields: {} } },
					...manifest.scripts.slice(3),
				],
			}),
		).toThrow();
		expect(() =>
			Schema.decodeUnknownSync(PluginManifest)({
				...manifest,
				providers: [...manifest.providers, provider],
			}),
		).toThrow();
		expect(() =>
			Schema.decodeUnknownSync(PluginManifest)({
				...manifest,
				providers: [{ ...provider, operations: { details: "missing.script" } }],
			}),
		).toThrow();
		expect(() =>
			Schema.decodeUnknownSync(PluginManifest)({
				...manifest,
				providers: [
					{
						...provider,
						operations: { details: "provider.test.details", search: "provider.test.details" },
					},
				],
			}),
		).toThrow();
		expect(() =>
			Schema.decodeUnknownSync(PluginManifest)({
				...manifest,
				scripts: [
					...manifest.scripts.slice(0, 2),
					{ ...detailsScript, providerSlug: "missing.provider" },
					...manifest.scripts.slice(3),
				],
			}),
		).toThrow();
		expect(() =>
			Schema.decodeUnknownSync(PluginManifest)({
				...manifest,
				scripts: [
					...manifest.scripts.slice(0, 2),
					{ ...detailsScript, providerOperation: "search" },
					...manifest.scripts.slice(3),
				],
			}),
		).toThrow();
		expect(() =>
			Schema.decodeUnknownSync(PluginManifest)({
				...manifest,
				scripts: [
					...manifest.scripts.slice(0, 4),
					{ ...preloadScript, providerSlug: "missing.provider" },
				],
			}),
		).toThrow();
		expect(() =>
			Schema.decodeUnknownSync(PluginManifest)({
				...manifest,
				providers: [{ ...provider, operations: { details: preloadScript.slug } }],
			}),
		).toThrow();
		expect(() =>
			Schema.decodeUnknownSync(PluginManifest)({
				...manifest,
				scripts: [{ ...manifest.scripts[0], providerSlug: provider.slug }],
			}),
		).toThrow();
		expect(() =>
			Schema.decodeUnknownSync(PluginManifest)({
				...manifest,
				providers: [
					...manifest.providers,
					{ ...provider, slug: "provider.other", operations: { details: otherDetailsScript.slug } },
				],
				scripts: [
					...manifest.scripts,
					otherDetailsScript,
					{ ...preloadScript, providerSlug: "provider.other" },
				],
			}),
		).toThrow();
	});

	it("rejects removed provider links and aliases", () => {
		const providerScript = manifest.scripts[2];
		expect(() =>
			Schema.decodeUnknownSync(PluginManifest)({
				...manifest,
				bindings: {
					...manifest.bindings,
					schemaProviderLinks: [{ entitySchemaSlug: "entity.test", providerSlug: "missing" }],
				},
			}),
		).toThrow();
		expect(() =>
			Schema.decodeUnknownSync(PluginManifest)({
				...manifest,
				bindings: {
					...manifest.bindings,
					schemaProviderLinks: [{ entitySchemaSlug: "entity.test", scriptSlug: "provider.test" }],
				},
			}),
		).toThrow();
		expect(() =>
			Schema.decodeUnknownSync(PluginManifest)({
				...manifest,
				scripts: [
					...manifest.scripts.slice(0, 2),
					{ ...providerScript, providerInformation: { source: "Old source" } },
					...manifest.scripts.slice(3),
				],
			}),
		).toThrow();
	});

	it("requires direct and automation bindings to reference existing scripts", () => {
		expect(() =>
			Schema.decodeUnknownSync(PluginManifest)({
				...manifest,
				boot: [{ ...manifest.boot[0], scriptSlug: "missing.script" }],
			}),
		).toThrow();
		expect(() =>
			Schema.decodeUnknownSync(PluginManifest)({
				...manifest,
				bindings: {
					...manifest.bindings,
					entityAutomations: [
						{ operation: "create", scriptSlug: "missing.script", entitySchemaSlug: "entity.test" },
					],
				},
			}),
		).toThrow();
		expect(() =>
			Schema.decodeUnknownSync(PluginManifest)({
				...manifest,
				bindings: {
					...manifest.bindings,
					providerEntityImportAutomations: [
						{ entitySchemaSlug: "entity.test", scriptSlug: "missing.script" },
					],
				},
			}),
		).toThrow();
		expect(() =>
			Schema.decodeUnknownSync(PluginManifest)({
				...manifest,
				bindings: {
					...manifest.bindings,
					providerEntityImportAutomations: [
						{ entitySchemaSlug: "entity.test", scriptSlug: "provider.test.details" },
					],
				},
			}),
		).toThrow();
	});

	it("strictly validates cron declarations", () => {
		const cron = manifest.crons[0];
		expect(() =>
			Schema.decodeUnknownSync(PluginManifest)({
				...manifest,
				crons: [{ ...cron, slug: "Invalid/Slug" }],
			}),
		).toThrow();
		expect(() =>
			Schema.decodeUnknownSync(PluginManifest)({
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
		).toThrow();
		expect(() =>
			Schema.decodeUnknownSync(PluginManifest)({
				...manifest,
				crons: [{ ...cron, schedule: { cron: "" } }],
			}),
		).toThrow();
		expect(() =>
			Schema.decodeUnknownSync(PluginManifest)({
				...manifest,
				crons: [{ ...cron, scriptSlug: "Invalid/Slug" }],
			}),
		).toThrow();
		expect(() =>
			Schema.decodeUnknownSync(PluginManifest)({
				...manifest,
				crons: [{ ...cron, description: " " }],
			}),
		).toThrow();
		expect(() =>
			Schema.decodeUnknownSync(PluginManifest)({
				...manifest,
				crons: [{ ...cron, timezone: "UTC" }],
			}),
		).toThrow();
	});

	it("strictly validates boot declarations", () => {
		const boot = manifest.boot[0];
		expect(() =>
			Schema.decodeUnknownSync(PluginManifest)({
				...manifest,
				boot: [{ ...boot, slug: "Invalid/Slug" }],
			}),
		).toThrow();
		expect(() =>
			Schema.decodeUnknownSync(PluginManifest)({
				...manifest,
				boot: [{ ...boot, scriptSlug: "Invalid/Slug" }],
			}),
		).toThrow();
		expect(() =>
			Schema.decodeUnknownSync(PluginManifest)({
				...manifest,
				boot: [{ ...boot, description: " " }],
			}),
		).toThrow();
		expect(() =>
			Schema.decodeUnknownSync(PluginManifest)({
				...manifest,
				boot: [{ ...boot, schedule: "0 0 * * *" }],
			}),
		).toThrow();
	});

	it("discriminates integration providers on their lot", () => {
		const [yank, push] = manifest.integrationProviders;
		const decoded = Schema.decodeUnknownSync(PluginManifest)({
			...manifest,
			integrationProviders: [{ ...yank, lot: "sink", slug: "integration.sink" }, push],
		});

		expect(decoded.integrationProviders[0]).toMatchObject({
			lot: "sink",
			scriptSlug: "automation.test",
		});
		expect(decoded.integrationProviders[1]).not.toHaveProperty("scriptSlug");
		expect(() =>
			Schema.decodeUnknownSync(PluginManifest)({
				...manifest,
				integrationProviders: [yank, { ...push, scriptSlug: "automation.test" }],
			}),
		).toThrow();
		expect(() =>
			Schema.decodeUnknownSync(PluginManifest)({
				...manifest,
				integrationProviders: [{ ...yank, scriptSlug: undefined }, push],
			}),
		).toThrow();
		expect(() =>
			Schema.decodeUnknownSync(PluginManifest)({
				...manifest,
				integrationProviders: [{ ...yank, lot: "webhook" }, push],
			}),
		).toThrow();
	});

	it("strictly validates integration provider declarations", () => {
		const [yank, push] = manifest.integrationProviders;
		expect(() =>
			Schema.decodeUnknownSync(PluginManifest)({
				...manifest,
				integrationProviders: [yank, push, { ...push }],
			}),
		).toThrow();
		expect(() =>
			Schema.decodeUnknownSync(PluginManifest)({
				...manifest,
				integrationProviders: [{ ...yank, scriptSlug: "missing.script" }, push],
			}),
		).toThrow();
		expect(() =>
			Schema.decodeUnknownSync(PluginManifest)({
				...manifest,
				integrationProviders: [{ ...yank, description: " " }, push],
			}),
		).toThrow();
		expect(() =>
			Schema.decodeUnknownSync(PluginManifest)({
				...manifest,
				integrationProviders: [{ ...yank, webhookPath: "/hook" }, push],
			}),
		).toThrow();
	});

	it("strictly validates schema-driven import source declarations", () => {
		const importSource = manifest.importSources[0];
		const decoded = Schema.decodeUnknownSync(PluginManifest)(manifest);
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
			expect(() =>
				Schema.decodeUnknownSync(PluginManifest)({ ...manifest, importSources: [source] }),
			).toThrow();
		}

		expect(() =>
			Schema.decodeUnknownSync(PluginManifest)({
				...manifest,
				importSources: [importSource, { ...importSource }],
			}),
		).toThrow();
	});

	it("requires strict import inputs with resolved choices and only top-level uploads", () => {
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
			{ unknownKeys: "strip", fields: {} },
			{ unknownKeys: "strict", fields: { options: nestedUpload } },
			{ unknownKeys: "strict", fields: { account: dynamicChoice } },
		]) {
			expect(() =>
				Schema.decodeUnknownSync(PluginManifest)({
					...manifest,
					importSources: [{ ...importSource, inputSchema }],
				}),
			).toThrow();
		}
	});

	it("rejects upload fields in non-import plugin schemas", () => {
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
			{ ...manifest, entitySchemas: [{ ...entitySchema, propertiesSchema: uploadSchema }] },
			{ ...manifest, entitySchemas: [{ ...entitySchema, eventSchemas: [eventSchema] }] },
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
			expect(() => Schema.decodeUnknownSync(PluginManifest)(candidate)).toThrow();
		}
	});
});
