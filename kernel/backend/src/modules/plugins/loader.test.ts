import { expect, it } from "@effect/vitest";
import type { PluginManifest } from "@ryot-app/contract/modules/plugins/manifest";
import { Effect, Fiber, Layer, Ref } from "effect";
import { assert } from "vitest";

import { databaseLayer } from "#lib/test-utils/effect";
import { makeDefinitionRegistry } from "#modules/definition-registry/service";
import { RelationshipSchemasRepository } from "#modules/relationship-schemas/repository";

import { makePluginLoader, PluginLoader } from "./loader";
import { PluginRuntimeResolverLive } from "./runtime-resolver";
import { fixtureManifest, fixturePluginIdentity } from "./test-support";

const emptySource = {
	savedViews: [],
	entitySchemas: [],
	signalSchemas: [],
	relationshipSchemas: [],
};

const normalizedPlugin = (version: string) => {
	const manifest = fixtureManifest();
	manifest.metadata.version = version;
	const entity = manifest.entitySchemas[0];
	const script = manifest.scripts[0];
	assert(entity);
	assert(script);
	entity.name = `Fixture ${version}`;
	const { entry, ...metadata } = script;
	return {
		manifest,
		...fixturePluginIdentity(),
		sourceHash: `source-${version}`,
		scripts: [
			{
				entry,
				metadata,
				source: "source",
				slug: script.slug,
				name: script.name,
				compiledFormat: 1,
				compiledCode: "compiled",
				contentHash: `compiled-${version}`,
			},
		],
	};
};

it.effect("atomically replaces an immutable snapshot under concurrent reads", () =>
	Effect.gen(function* () {
		const registry = makeDefinitionRegistry(emptySource);
		const loader = makePluginLoader(registry);
		loader.load(normalizedPlugin("1"));
		const original = loader.getSnapshot();
		const observations = yield* Ref.make<ReadonlyArray<string>>([]);
		const reader = Effect.gen(function* () {
			for (let index = 0; index < 100; index += 1) {
				const snapshot = loader.getSnapshot();
				const plugin = snapshot.plugins["fixture"];
				const entity = snapshot.definitions.entitySchemas["fixture-entity"];
				if (plugin && entity) {
					yield* Ref.update(observations, (values) => [
						...values,
						`${plugin.manifest.metadata.version}:${entity.name}`,
					]);
				}
				yield* Effect.yieldNow;
			}
		});
		const fibers = yield* Effect.all(Array.from({ length: 10 }, () => Effect.forkChild(reader)));
		yield* Effect.yieldNow;
		loader.load(normalizedPlugin("2"));
		expect(loader.getSnapshot().definitions.entitySchemas["fixture-entity"]?.pluginId).toBe(
			"fixture-plugin-id",
		);
		yield* Effect.forEach(fibers, Fiber.join);

		const values = yield* Ref.get(observations);
		expect(values.every((value) => value === "1:Fixture 1" || value === "2:Fixture 2")).toBe(true);
		expect(loader.getSnapshot()).not.toBe(original);
		expect(Object.isFrozen(loader.getSnapshot().plugins["fixture"])).toBe(true);
		expect(registry.getEntitySchema("fixture-entity")?.name).toBe("Fixture 2");
	}),
);

it("rejects definition collisions without replacing the current snapshot", () => {
	const loader = makePluginLoader(makeDefinitionRegistry(emptySource));
	loader.load(normalizedPlugin("1"));
	const original = loader.getSnapshot();
	const plugin = normalizedPlugin("2");
	const collision = {
		...plugin,
		...fixturePluginIdentity("other-plugin"),
		scripts: plugin.scripts.map((script) => ({ ...script, slug: "other.automation" })),
		manifest: {
			...plugin.manifest,
			metadata: { ...plugin.manifest.metadata, slug: "other-plugin" },
			scripts: plugin.manifest.scripts.map((script) =>
				Object.assign({}, script, { slug: "other.automation" }),
			),
		},
	};

	expect(() => loader.load(collision)).toThrow(/Duplicate entity schema slug/);
	expect(loader.getSnapshot()).toBe(original);
});

it("materializes portable saved-view page exports to stable plugin ids", () => {
	const loader = makePluginLoader(makeDefinitionRegistry(emptySource));
	const plugin = normalizedPlugin("1");
	const client = {
		homeView: "summary",
		apiVersion: 1 as const,
		exports: {
			summary: {
				kind: "page" as const,
				entry: "client/summary.tsx",
				automaticEntityPresentations: false,
				settingsSchema: {
					unknownKeys: "strict" as const,
					fields: {
						title: {
							label: "Title",
							type: "string" as const,
							description: "Summary title",
							validation: { required: true as const },
						},
					},
				},
			},
		},
	};
	const savedView = {
		icon: "box",
		sortOrder: 0,
		name: "Summary",
		slug: "summary",
		dataSources: null,
		pluginSlug: "fixture",
		settings: { title: "Fixture" },
		renderer: { exportName: "summary", kind: "plugin" as const },
	};
	loader.load({ ...plugin, manifest: { ...plugin.manifest, client, savedViews: [savedView] } });

	expect(loader.getSnapshot().definitions.savedViews["summary"]?.renderer).toEqual({
		kind: "plugin",
		exportName: "summary",
		pluginId: "fixture-plugin-id",
	});
	expect(() =>
		loader.preview({
			...plugin,
			manifest: { ...plugin.manifest, client, savedViews: [{ ...savedView, settings: {} }] },
		}),
	).toThrow(/Invalid saved view summary/);
});

it("rejects plugin config environment collisions across active plugins", () => {
	const loader = makePluginLoader(makeDefinitionRegistry(emptySource));
	const firstBase = normalizedPlugin("1");
	const first = {
		...firstBase,
		...fixturePluginIdentity("fixture-one"),
		manifest: {
			...firstBase.manifest,
			metadata: { ...firstBase.manifest.metadata, slug: "fixture-one" },
			configSchema: {
				unknownKeys: "strict" as const,
				fields: { token: { label: "Token", description: "Token", type: "string" as const } },
			},
		},
	};
	const secondBase = normalizedPlugin("2");
	const second = {
		...secondBase,
		...fixturePluginIdentity("fixture_one"),
		manifest: {
			...secondBase.manifest,
			metadata: { ...secondBase.manifest.metadata, slug: "fixture_one" },
			configSchema: {
				unknownKeys: "strict" as const,
				fields: { token: { label: "Token", description: "Token", type: "string" as const } },
			},
		},
	};

	expect(() => loader.previewAll([first, second])).toThrow(
		/Duplicate plugin config environment variable 'RYOT_PLUGIN_FIXTURE_ONE_TOKEN'/,
	);
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
		const loader = makePluginLoader(makeDefinitionRegistry(emptySource));
		const plugin = normalizedPlugin("1");
		const entitySchema = plugin.manifest.entitySchemas[0];
		assert(entitySchema);

		expect(() =>
			loader.load({
				...plugin,
				manifest: {
					...plugin.manifest,
					entitySchemas: [{ ...entitySchema, mergeIdentityProperties }],
				},
			}),
		).toThrow(expected);
	}
});

it("rejects script slug collisions across active plugins", () => {
	const loader = makePluginLoader(makeDefinitionRegistry(emptySource));
	loader.load(normalizedPlugin("1"));
	const original = loader.getSnapshot();
	const plugin = normalizedPlugin("2");
	const collision = {
		...plugin,
		...fixturePluginIdentity("other-plugin"),
		manifest: {
			...plugin.manifest,
			metadata: { ...plugin.manifest.metadata, slug: "other-plugin" },
		},
	};

	expect(() => loader.load(collision)).toThrow(/Duplicate script slug 'fixture\.automation'/);
	expect(loader.getSnapshot()).toBe(original);
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
		const loader = makePluginLoader(makeDefinitionRegistry(emptySource));
		const first = normalizedPlugin("1");
		loader.load({ ...first, manifest: { ...first.manifest, ...section } });
		const original = loader.getSnapshot();
		const second = normalizedPlugin("2");

		expect(() =>
			loader.load({
				...second,
				...fixturePluginIdentity("other-plugin"),
				scripts: second.scripts.map((script) => ({ ...script, slug: "other.automation" })),
				manifest: {
					...second.manifest,
					...section,
					metadata: { ...second.manifest.metadata, slug: "other-plugin" },
					scripts: second.manifest.scripts.map((script) =>
						Object.assign({}, script, { slug: "other.automation" }),
					),
				},
			}),
		).toThrow(expected);
		expect(loader.getSnapshot()).toBe(original);
	}
});

it("preserves provider membership for custom scripts in the loader snapshot", () => {
	const loader = makePluginLoader(makeDefinitionRegistry(emptySource));
	const plugin = normalizedPlugin("1");
	const declared = plugin.manifest.scripts[0];
	const normalized = plugin.scripts[0];
	assert(declared);
	assert(normalized);
	const details = {
		...declared,
		name: "Fixture details",
		slug: "fixture.details",
		kind: "provider" as const,
		providerSlug: "fixture-provider",
		providerOperation: "details" as const,
	};
	const custom = {
		...declared,
		kind: "script" as const,
		name: "Fixture preload",
		slug: "fixture.preload",
		providerSlug: "fixture-provider",
	};
	const { entry: _detailsEntry, ...detailsMetadata } = details;
	const { entry: _customEntry, ...customMetadata } = custom;
	loader.load({
		...plugin,
		scripts: [
			...plugin.scripts,
			{ ...normalized, slug: details.slug, name: details.name, metadata: detailsMetadata },
			{ ...normalized, slug: custom.slug, name: custom.name, metadata: customMetadata },
		],
		manifest: {
			...plugin.manifest,
			scripts: [...plugin.manifest.scripts, details, custom],
			providers: [
				{
					name: "Fixture provider",
					slug: "fixture-provider",
					information: { source: "fixture" },
					operations: { details: details.slug },
					rootEntitySchemaSlug: "fixture-entity",
				},
			],
		},
	});

	expect(loader.getSnapshot().plugins["fixture"]?.scripts[2]).toMatchObject({
		slug: "fixture.preload",
		metadata: { kind: "script", providerSlug: "fixture-provider" },
	});
});

it.effect("shares boot-loaded definitions with runtime repositories", () => {
	const layer = RelationshipSchemasRepository.layer.pipe(
		Layer.provideMerge(PluginRuntimeResolverLive),
		Layer.provide(databaseLayer),
	);

	return Effect.gen(function* () {
		const loader = yield* PluginLoader;
		const relationshipSchemas = yield* RelationshipSchemasRepository;
		loader.load(normalizedPlugin("1"));

		expect(yield* relationshipSchemas.findBuiltinBySlug("fixture-link")).toMatchObject({
			isBuiltin: true,
			slug: "fixture-link",
		});
	}).pipe(Effect.provide(layer));
});

it("orders plugin relationship definitions before kernel source-zero definitions", () => {
	const loader = makePluginLoader(makeDefinitionRegistry());
	loader.load(normalizedPlugin("1"));

	expect(Object.keys(loader.getSnapshot().definitions.relationshipSchemas)).toEqual([
		"fixture-link",
		"member-of",
	]);
});
