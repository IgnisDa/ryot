import { describe, expect, it } from "bun:test";

import { Schema } from "effect";

import { definePlugin, PluginManifest } from "./manifest";

const manifest = definePlugin({
	crons: [
		{
			slug: "refresh.test",
			schedule: "0 * * * *",
			driverRef: "automation.test",
			description: "Refresh test data",
		},
	],
	savedViews: [],
	entitySchemas: [],
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
	relationshipSchemas: [],
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
		schemaScriptLinks: [],
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
	],
});

describe("definePlugin", () => {
	it("preserves manifest literals", () => {
		const slug: "test" = manifest.metadata.slug;
		const scriptKind: "automation" = manifest.scripts[0].kind;
		const driverRef: "automation.test" = manifest.crons[0].driverRef;

		expect(slug).toBe("test");
		expect(driverRef).toBe("automation.test");
		expect(scriptKind).toBe("automation");
	});

	it("contains only the supported manifest sections", () => {
		type HasCapabilities = "capabilities" extends keyof PluginManifest ? true : false;
		type HasCrons = "crons" extends keyof PluginManifest ? true : false;
		type HasOperations = "operations" extends keyof PluginManifest ? true : false;
		type HasWorkflows = "workflows" extends keyof PluginManifest ? true : false;

		const optionalSections: [HasCapabilities, HasCrons, HasOperations, HasWorkflows] = [
			false,
			true,
			false,
			false,
		];

		expect(optionalSections).toEqual([false, true, false, false]);
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

	it("rejects sections and script kinds outside the v1 contract", () => {
		expect(() =>
			Schema.decodeUnknownSync(PluginManifest)({ ...manifest, capabilities: [] }),
		).toThrow();
		expect(() =>
			Schema.decodeUnknownSync(PluginManifest)({
				...manifest,
				scripts: [{ ...manifest.scripts[0], kind: "script" }],
			}),
		).toThrow();
	});

	it("enforces the existing sandbox driver manifest constraints", () => {
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
				crons: [{ ...cron, schedule: "" }],
			}),
		).toThrow();
		expect(() =>
			Schema.decodeUnknownSync(PluginManifest)({
				...manifest,
				crons: [{ ...cron, driverRef: "Invalid/Slug" }],
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
});
