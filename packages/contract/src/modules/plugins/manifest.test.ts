import { Schema } from "effect";
import { assert, describe, expect, it } from "vitest";

import { definePlugin, PluginManifest } from "./manifest";

const manifest = definePlugin({
	savedViews: [],
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
			lot: "single",
			input: "file",
			slug: "import.test",
			name: "Test import source",
			allowedFileExtensions: ["json"],
			workflowSlug: "refresh.workflow",
			requiredPluginConfigKeys: ["TEST_KEY"],
			description: "Import test data from a file",
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
			information: { source: "Test source", canonicalLanguage: "en" },
			operations: { details: "provider.test.details", search: "provider.test.search" },
		},
	],
	metadata: {
		icon: "box",
		name: "Test",
		slug: "test",
		version: "1.0.0",
		accentColor: "blue",
		description: "Test plugin",
	},
	bindings: {
		eventAutomations: [],
		entityAutomations: [],
		signalAutomations: [],
		schemaProviderLinks: [{ entitySchemaSlug: "entity.test", providerSlug: "provider.test" }],
		relationshipAutomations: [],
	},
	scripts: [
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
			kind: "operation",
			name: "Test operation",
			slug: "operation.test",
			requiredPluginConfigKeys: [],
			requiredSystemConfigKeys: [],
			capabilities: [],
			entry: "scripts/operation.sandbox.ts",
		},
		{
			kind: "provider",
			name: "Test provider details",
			slug: "provider.test.details",
			providerSlug: "provider.test",
			providerOperation: "details",
			requiredPluginConfigKeys: [],
			requiredSystemConfigKeys: [],
			capabilities: [],
			entry: "scripts/provider-details.sandbox.ts",
		},
		{
			kind: "provider",
			name: "Test provider search",
			slug: "provider.test.search",
			providerSlug: "provider.test",
			providerOperation: "search",
			requiredPluginConfigKeys: [],
			requiredSystemConfigKeys: [],
			capabilities: [],
			entry: "scripts/provider-search.sandbox.ts",
		},
		{
			kind: "script",
			name: "Test provider preload",
			slug: "provider.test.preload",
			providerSlug: "provider.test",
			requiredPluginConfigKeys: [],
			requiredSystemConfigKeys: [],
			capabilities: [],
			entry: "scripts/provider-preload.sandbox.ts",
		},
		{
			kind: "workflow",
			name: "Test workflow",
			slug: "workflow.test",
			capabilities: [],
			requiredPluginConfigKeys: [],
			requiredSystemConfigKeys: [],
			entry: "scripts/workflow.sandbox.ts",
		},
	],
});

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
				Schema.decodeUnknownSync(PluginManifest)({
					...manifest,
					httpRateLimits: [candidate],
				}),
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
					accentColor: "blue",
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
					accentColor: "blue",
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
					accentColor: "blue",
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
						description: "A transformed value",
						transform: { round: { scale: 1, mode: "half_up" } },
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
				type: "enum-array",
				label: "Value",
				options: ["one"],
				description: "An enum array value",
			},
			{
				type: "array",
				label: "Value",
				description: "An array value",
				items: { type: "string", label: "Item", description: "An item" },
			},
			{
				type: "object",
				label: "Value",
				properties: {},
				description: "An object value",
			},
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
				scripts: manifest.scripts.map((script) => ({
					...script,
					requiredPluginConfigKeys: [],
				})),
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
						operations: {
							details: "provider.test.details",
							search: "provider.test.details",
						},
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
					{
						...provider,
						slug: "provider.other",
						operations: { details: otherDetailsScript.slug },
					},
				],
				scripts: [
					...manifest.scripts,
					otherDetailsScript,
					{ ...preloadScript, providerSlug: "provider.other" },
				],
			}),
		).toThrow();
	});

	it("strictly validates provider bindings and removed provider aliases", () => {
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
						{
							operation: "create",
							scriptSlug: "missing.script",
							entitySchemaSlug: "entity.test",
						},
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

	it("strictly validates import source declarations", () => {
		const importSource = manifest.importSources[0];
		const decoded = Schema.decodeUnknownSync(PluginManifest)(manifest);
		expect(decoded.importSources[0]).toMatchObject({
			lot: "single",
			input: "file",
			slug: "import.test",
			workflowSlug: "refresh.workflow",
		});
		expect(() =>
			Schema.decodeUnknownSync(PluginManifest)({
				...manifest,
				importSources: [{ ...importSource, workflowSlug: "missing.workflow" }],
			}),
		).toThrow();
		expect(() =>
			Schema.decodeUnknownSync(PluginManifest)({
				...manifest,
				importSources: [{ ...importSource, workflowSlug: "workflow.test" }],
			}),
		).toThrow();
		expect(() =>
			Schema.decodeUnknownSync(PluginManifest)({
				...manifest,
				importSources: [{ ...importSource, input: "stream" }],
			}),
		).toThrow();
		expect(() =>
			Schema.decodeUnknownSync(PluginManifest)({
				...manifest,
				importSources: [importSource, { ...importSource }],
			}),
		).toThrow();
		expect(() =>
			Schema.decodeUnknownSync(PluginManifest)({
				...manifest,
				importSources: [{ ...importSource, allowedFileExtensions: [""] }],
			}),
		).toThrow();
		expect(() =>
			Schema.decodeUnknownSync(PluginManifest)({
				...manifest,
				importSources: [{ ...importSource, maxFileSizeBytes: 1024 }],
			}),
		).toThrow();
		const namedSource = {
			input: "file",
			lot: "named",
			slug: "import.named",
			name: "Named import source",
			workflowSlug: "refresh.workflow",
			requiredPluginConfigKeys: [],
			description: "Import named files",
			artifacts: [
				{
					key: "historyFilePath",
					required: true,
					allowedFileExtensions: ["csv"],
					uploadTokenField: "historyUploadToken",
				},
			],
		};
		expect(
			Schema.decodeUnknownSync(PluginManifest)({ ...manifest, importSources: [namedSource] })
				.importSources[0],
		).toEqual(namedSource);
		for (const artifacts of [
			[],
			[namedSource.artifacts[0], namedSource.artifacts[0]],
			[namedSource.artifacts[0], { ...namedSource.artifacts[0], key: "ratingsFilePath" }],
			[
				namedSource.artifacts[0],
				{ ...namedSource.artifacts[0], uploadTokenField: "ratingsUploadToken" },
			],
		]) {
			expect(() =>
				Schema.decodeUnknownSync(PluginManifest)({
					...manifest,
					importSources: [{ ...namedSource, artifacts }],
				}),
			).toThrow();
		}
	});
});
