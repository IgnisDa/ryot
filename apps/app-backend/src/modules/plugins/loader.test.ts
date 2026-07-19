import { expect, it } from "@effect/vitest";
import type { PluginManifest } from "@ryot/plugin-kit/manifest";
import { Effect, Fiber, Layer, Ref } from "effect";
import { assert } from "vitest";

import { makeDefinitionRegistry } from "#modules/definition-registry/service";
import { RelationshipSchemasRepository } from "#modules/relationship-schemas/repository";

import { makePluginLoader, PluginLoader } from "./loader";
import { PluginRuntimeResolverLive } from "./runtime-resolver";
import { fixtureManifest } from "./test-support";
import type { NormalizedPlugin } from "./types";

const emptySource = {
	savedViews: [],
	entitySchemas: [],
	signalSchemas: [],
	relationshipSchemas: [],
};

const normalizedPlugin = (version: string): NormalizedPlugin => {
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
		scripts: plugin.scripts.map((script) => ({ ...script, slug: "other.automation" })),
		manifest: {
			...plugin.manifest,
			scripts: plugin.manifest.scripts.map((script) => ({
				...script,
				slug: "other.automation",
			})),
			metadata: { ...plugin.manifest.metadata, slug: "other-plugin" },
		},
	};

	expect(() => loader.load(collision)).toThrow(/Duplicate entity schema slug/);
	expect(loader.getSnapshot()).toBe(original);
});

it("rejects plugin config environment collisions across active plugins", () => {
	const loader = makePluginLoader(makeDefinitionRegistry(emptySource));
	const firstBase = normalizedPlugin("1");
	const first = {
		...firstBase,
		manifest: {
			...firstBase.manifest,
			metadata: { ...firstBase.manifest.metadata, slug: "fixture-one" },
			configSchema: {
				unknownKeys: "strict" as const,
				fields: { token: { type: "string" as const, label: "Token", description: "Token" } },
			},
		},
	};
	const secondBase = normalizedPlugin("2");
	const second = {
		...secondBase,
		manifest: {
			...secondBase.manifest,
			metadata: { ...secondBase.manifest.metadata, slug: "fixture_one" },
			configSchema: {
				unknownKeys: "strict" as const,
				fields: { token: { type: "string" as const, label: "Token", description: "Token" } },
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
			expected: /merge identity property 'missing' is not defined/,
			mergeIdentityProperties: ["missing"],
		},
		{
			expected: /duplicate merge identity properties/,
			mergeIdentityProperties: ["kind", "kind"],
		},
		{
			expected: /merge identity property names cannot be empty/,
			mergeIdentityProperties: [""],
		},
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
		fields: { token: { type: "string", label: "Token", description: "API token", secret: true } },
	} satisfies PluginManifest["integrationProviders"][number]["settingsSchema"];
	const cases = [
		{
			expected: /Duplicate integration provider slug 'plex'/,
			section: {
				integrationProviders: [
					{
						slug: "plex",
						name: "Plex",
						settingsSchema,
						lot: "yank" as const,
						description: "Plex yank",
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
						lot: "single" as const,
						input: "file" as const,
						description: "Hevy CSV",
						requiredPluginConfigKeys: [],
						allowedFileExtensions: ["csv"],
						workflowSlug: "fixture.workflow",
					},
				],
			},
		},
	];

	for (const { expected, section } of cases) {
		const loader = makePluginLoader(makeDefinitionRegistry(emptySource));
		const first = normalizedPlugin("1");
		loader.load({ ...first, manifest: { ...first.manifest, ...section } });
		const original = loader.getSnapshot();
		const second = normalizedPlugin("2");

		expect(() =>
			loader.load({
				...second,
				scripts: second.scripts.map((script) => ({ ...script, slug: "other.automation" })),
				manifest: {
					...second.manifest,
					...section,
					scripts: second.manifest.scripts.map((script) => ({
						...script,
						slug: "other.automation",
					})),
					metadata: { ...second.manifest.metadata, slug: "other-plugin" },
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
		manifest: {
			...plugin.manifest,
			scripts: [...plugin.manifest.scripts, details, custom],
			providers: [
				{
					name: "Fixture provider",
					slug: "fixture-provider",
					information: { source: "fixture" },
					operations: { details: details.slug },
				},
			],
		},
		scripts: [
			...plugin.scripts,
			{ ...normalized, slug: details.slug, name: details.name, metadata: detailsMetadata },
			{ ...normalized, slug: custom.slug, name: custom.name, metadata: customMetadata },
		],
	});

	expect(loader.getSnapshot().plugins["fixture"]?.scripts[2]).toMatchObject({
		slug: "fixture.preload",
		metadata: { kind: "script", providerSlug: "fixture-provider" },
	});
});

it.effect("shares boot-loaded definitions with runtime repositories", () => {
	const layer = RelationshipSchemasRepository.layer.pipe(
		Layer.provideMerge(PluginRuntimeResolverLive),
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
