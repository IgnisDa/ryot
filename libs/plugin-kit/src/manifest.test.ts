import { Schema } from "effect";
import { assert, describe, expect, it } from "vitest";

import { definePlugin, PluginManifest } from "./manifest";

const manifest = definePlugin({
	savedViews: [],
	entitySchemas: [],
	relationshipSchemas: [],
	boot: [{ slug: "boot.test", scriptSlug: "automation.test", description: "Boot test data" }],
	crons: [
		{
			slug: "refresh.test",
			schedule: "0 * * * *",
			scriptSlug: "automation.test",
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
			requiredAppConfigKeys: [],
			capabilities: ["emitSignal"],
			entry: "scripts/test.sandbox.ts",
		},
		{
			kind: "operation",
			name: "Test operation",
			slug: "operation.test",
			requiredAppConfigKeys: [],
			capabilities: [],
			entry: "scripts/operation.sandbox.ts",
		},
		{
			kind: "provider",
			name: "Test provider details",
			slug: "provider.test.details",
			providerSlug: "provider.test",
			providerOperation: "details",
			requiredAppConfigKeys: [],
			capabilities: [],
			entry: "scripts/provider-details.sandbox.ts",
		},
		{
			kind: "provider",
			name: "Test provider search",
			slug: "provider.test.search",
			providerSlug: "provider.test",
			providerOperation: "search",
			requiredAppConfigKeys: [],
			capabilities: [],
			entry: "scripts/provider-search.sandbox.ts",
		},
		{
			kind: "script",
			name: "Test provider preload",
			slug: "provider.test.preload",
			providerSlug: "provider.test",
			requiredAppConfigKeys: [],
			capabilities: [],
			entry: "scripts/provider-preload.sandbox.ts",
		},
		{
			kind: "workflow",
			name: "Test workflow",
			slug: "workflow.test",
			capabilities: [],
			requiredAppConfigKeys: [],
			entry: "scripts/workflow.sandbox.ts",
		},
		{
			kind: "activity",
			name: "Test activity",
			slug: "activity.test",
			providerSlug: "provider.test",
			capabilities: ["httpCall"],
			requiredAppConfigKeys: [],
			entry: "scripts/activity.sandbox.ts",
		},
	],
});

describe("definePlugin", () => {
	it("preserves manifest literals", () => {
		const slug: "test" = manifest.metadata.slug;
		const scriptKind: "automation" = manifest.scripts[0].kind;
		const scriptSlug: "automation.test" = manifest.crons[0].scriptSlug;

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

		const optionalSections: [HasCapabilities, HasCrons, HasBoot, HasOperations, HasWorkflows] = [
			false,
			true,
			true,
			true,
			true,
		];

		expect(optionalSections).toEqual([false, true, true, true, true]);
	});

	it("decodes the manifest with the canonical Effect schema", () => {
		expect(Schema.decodeUnknownSync(PluginManifest)(manifest)).toEqual(manifest);
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

	it("accepts capable activities without treating them as workflows", () => {
		const activity = Schema.decodeUnknownSync(PluginManifest)(manifest).scripts[6];
		assert(activity);
		expect(activity).toMatchObject({
			kind: "activity",
			capabilities: ["httpCall"],
			providerSlug: "provider.test",
		});
		expect(() =>
			Schema.decodeUnknownSync(PluginManifest)({
				...manifest,
				workflows: [{ slug: "invalid", scriptSlug: activity.slug }],
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
				scripts: [{ ...manifest.scripts[0], requiredAppConfigKeys: [""] }],
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
			Schema.decodeUnknownSync(PluginManifest)({ ...manifest, crons: [{ ...cron, schedule: "" }] }),
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
});
