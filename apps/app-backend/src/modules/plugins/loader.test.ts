import { expect, it } from "@effect/vitest";
import { Effect, Fiber, Ref } from "effect";
import { assert } from "vitest";

import { makeDefinitionRegistry } from "#modules/definition-registry/service";

import { makePluginLoader } from "./loader";
import { fixtureManifest } from "./test-support";
import type { NormalizedPlugin } from "./types";

const emptySource = {
	trackers: [],
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
		manifest: {
			...plugin.manifest,
			metadata: { ...plugin.manifest.metadata, slug: "other-plugin" },
		},
	};

	expect(() => loader.load(collision)).toThrow(/Duplicate entity schema slug/);
	expect(loader.getSnapshot()).toBe(original);
});
