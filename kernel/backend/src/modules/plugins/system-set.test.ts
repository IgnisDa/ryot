import type { PluginManifest } from "@ryot-app/contract/modules/plugins/manifest";
import { assert, expect, it } from "vitest";

import { kernelDefinitionSource } from "#modules/definition-registry/kernel-source";

import { validateSystemPluginSet } from "./system-set";
import { fixtureManifest, fixturePluginIdentity } from "./test-support";

const emptySource = {
	savedViews: [],
	entitySchemas: [],
	signalSchemas: [],
	relationshipSchemas: [],
};

const systemPlugin = (slug = "fixture", manifest: PluginManifest = fixtureManifest()) => {
	const scripts =
		slug === "fixture"
			? manifest.scripts
			: manifest.scripts.map((script) => Object.assign({}, script, { slug: `${slug}.automation` }));
	return {
		...fixturePluginIdentity(slug),
		scripts,
		manifest: { ...manifest, scripts, metadata: { ...manifest.metadata, slug } },
	};
};

it("rejects entity schema collisions across active plugins", () => {
	expect(() =>
		validateSystemPluginSet(emptySource, [systemPlugin(), systemPlugin("other-plugin")]),
	).toThrow(/Duplicate entity schema slug/);
});

it("rejects plugin config environment collisions across active plugins", () => {
	const configSchema = {
		unknownKeys: "strict" as const,
		fields: { token: { label: "Token", description: "Token", type: "string" as const } },
	};
	const withConfig = (slug: string) => {
		const manifest = fixtureManifest();
		return systemPlugin(slug, {
			...manifest,
			configSchema,
			signalSchemas: [],
			entitySchemas: [],
			relationshipSchemas: [],
		});
	};

	expect(() =>
		validateSystemPluginSet(emptySource, [withConfig("fixture-one"), withConfig("fixture_one")]),
	).toThrow(/Duplicate plugin config environment variable 'RYOT_PLUGIN_FIXTURE_ONE_TOKEN'/);
});

it("rejects invalid entity merge identity properties", () => {
	const cases = [
		{
			mergeIdentityProperties: ["missing"],
			expected: /merge identity property 'missing' is not defined/,
		},
		{ mergeIdentityProperties: ["kind", "kind"], expected: /duplicate merge identity properties/ },
		{ mergeIdentityProperties: [""], expected: /merge identity property names cannot be empty/ },
	];

	for (const { expected, mergeIdentityProperties } of cases) {
		const manifest = fixtureManifest();
		const entitySchema = manifest.entitySchemas[0];
		assert(entitySchema);

		expect(() =>
			validateSystemPluginSet(emptySource, [
				systemPlugin("fixture", {
					...manifest,
					entitySchemas: [{ ...entitySchema, mergeIdentityProperties }],
				}),
			]),
		).toThrow(expected);
	}
});

it("rejects script slug collisions across active plugins", () => {
	const manifest = fixtureManifest();
	const other = {
		...fixturePluginIdentity("other-plugin"),
		scripts: manifest.scripts,
		manifest: {
			...manifest,
			signalSchemas: [],
			entitySchemas: [],
			relationshipSchemas: [],
			metadata: { ...manifest.metadata, slug: "other-plugin" },
		},
	};

	expect(() => validateSystemPluginSet(emptySource, [systemPlugin(), other])).toThrow(
		/Duplicate script slug 'fixture\.automation'/,
	);
});

it("rejects integration provider and import source slug collisions across active plugins", () => {
	const settingsSchema = {
		fields: { token: { secret: true, type: "string", label: "Token", description: "API token" } },
	} satisfies PluginManifest["integrationProviders"][number]["settingsSchema"];
	const cases = [
		{
			expected: /Duplicate integration provider slug 'lambda'/,
			section: {
				integrationProviders: [
					{
						slug: "lambda",
						name: "Lambda",
						settingsSchema,
						lot: "yank" as const,
						description: "Lambda yank",
						scriptSlug: "fixture.automation",
					},
				],
			},
		},
		{
			expected: /Duplicate import source slug 'hevy'/,
			section: {
				importSources: [
					{
						slug: "hevy",
						name: "Hevy",
						description: "Hevy CSV",
						requiredPluginConfigKeys: [],
						workflowSlug: "fixture.workflow",
						inputSchema: {
							unknownKeys: "strict" as const,
							fields: {
								uploadToken: {
									position: 1,
									label: "Upload token",
									type: "string" as const,
									description: "Upload token",
									validation: { required: true as const },
									format: { kind: "upload" as const, allowedFileExtensions: ["csv"] },
								},
							},
						},
					},
				],
			},
		},
	];

	for (const { section, expected } of cases) {
		const manifest = fixtureManifest();
		const withoutDefinitions = {
			...manifest,
			...section,
			signalSchemas: [],
			entitySchemas: [],
			relationshipSchemas: [],
		};

		expect(() =>
			validateSystemPluginSet(emptySource, [
				systemPlugin("fixture", { ...manifest, ...section }),
				systemPlugin("other-plugin", withoutDefinitions),
			]),
		).toThrow(expected);
	}
});

it("orders plugin relationship definitions before kernel source-zero definitions", () => {
	expect(
		Object.keys(
			validateSystemPluginSet(kernelDefinitionSource(), [systemPlugin()]).relationshipSchemas,
		),
	).toEqual(["fixture-link", "member-of"]);
});
