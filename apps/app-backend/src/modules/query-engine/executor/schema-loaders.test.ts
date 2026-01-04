import { expect, it } from "@effect/vitest";
import { Effect, Layer } from "effect";

import {
	DefinitionRegistry,
	definitionSourceFromSnapshot,
	makeDefinitionRegistry,
} from "#modules/definition-registry/service";

import { loadVisibleEntitySchemas } from "./schema-loaders";

it.effect("reports registry provenance for entity schema metadata", () => {
	const definitions = makeDefinitionRegistry();
	const current = definitionSourceFromSnapshot(definitions.getSnapshot());
	const testDefinition = {
		icon: "book",
		pluginSlug: null,
		eventSchemas: [],
		name: "Test Book",
		slug: "test-book",
		accentColor: "blue",
		propertiesSchema: { fields: {} },
	} as const;
	definitions.replace(
		{ ...current, entitySchemas: [...current.entitySchemas, testDefinition] },
		{
			nonBuiltinEntitySchemaSlugs: new Set([testDefinition.slug]),
			nonBuiltinRelationshipSchemaSlugs: new Set(),
		},
	);
	const layer = Layer.succeed(DefinitionRegistry, { _tag: "DefinitionRegistry", ...definitions });

	return Effect.gen(function* () {
		expect(yield* loadVisibleEntitySchemas("user-id", ["collection", testDefinition.slug])).toEqual(
			[
				{ id: "collection", slug: "collection", name: "Collection", isBuiltin: true },
				{
					isBuiltin: false,
					id: testDefinition.slug,
					slug: testDefinition.slug,
					name: testDefinition.name,
				},
			],
		);
	}).pipe(Effect.provide(layer));
});
