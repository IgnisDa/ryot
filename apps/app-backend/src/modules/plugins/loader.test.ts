import { expect, it } from "@effect/vitest";
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
				yield* Effect.yieldNow();
			}
		});
		const fibers = yield* Effect.all(Array.from({ length: 10 }, () => Effect.fork(reader)));
		yield* Effect.yieldNow();
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

it("preserves provider membership for custom scripts in the loader snapshot", () => {
	const loader = makePluginLoader(makeDefinitionRegistry(emptySource));
	const plugin = normalizedPlugin("1");
	const declared = plugin.manifest.scripts[0];
	const normalized = plugin.scripts[0];
	assert(declared);
	assert(normalized);
	const details = {
		...declared,
		kind: "provider" as const,
		name: "Fixture details",
		slug: "fixture.details",
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
	const layer = RelationshipSchemasRepository.Default.pipe(
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
