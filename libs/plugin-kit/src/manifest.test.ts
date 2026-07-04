import { describe, expect, it } from "bun:test";

import { Schema } from "effect";

import { definePlugin, PluginManifest } from "./manifest";

const manifest = definePlugin({
	savedViews: [],
	entitySchemas: [],
	signalSchemas: [],
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

		expect(slug).toBe("test");
		expect(scriptKind).toBe("automation");
	});

	it("contains only the v1 manifest sections", () => {
		type HasCapabilities = "capabilities" extends keyof PluginManifest ? true : false;
		type HasCrons = "crons" extends keyof PluginManifest ? true : false;
		type HasOperations = "operations" extends keyof PluginManifest ? true : false;
		type HasWorkflows = "workflows" extends keyof PluginManifest ? true : false;

		const phaseThreeSections: [HasCapabilities, HasCrons, HasOperations, HasWorkflows] = [
			false,
			false,
			false,
			false,
		];

		expect(phaseThreeSections).toEqual([false, false, false, false]);
	});

	it("decodes the manifest with the canonical Effect schema", () => {
		expect(Schema.decodeUnknownSync(PluginManifest)(manifest)).toEqual(manifest);
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
});
