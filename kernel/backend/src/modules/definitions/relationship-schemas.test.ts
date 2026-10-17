import { expect, layer } from "@effect/vitest";
import {
	definitionKey,
	type RelationshipSchemaReference,
} from "@ryot-app/contract/modules/plugins/references";
import { PluginId, RelationshipSchemaSlug, UserId } from "@ryot-app/contract/schema/brands";
import { Context, Effect, Layer, Ref } from "effect";

import { DefinitionRepository } from "#modules/definitions/repository";
import type { RelationshipSchemaDefinition } from "#modules/definitions/snapshot";

import { RelationshipSchemaReader } from "./relationship-schemas";

const pluginId = PluginId.make("schema-owner");
const relationshipSlug = RelationshipSchemaSlug.make("shared-relation");
const kernelDefinition: RelationshipSchemaDefinition = {
	pluginId: null,
	slug: relationshipSlug,
	name: "Kernel relation",
	sourceEntitySchemaSlug: null,
	targetEntitySchemaSlug: null,
	propertiesSchema: { fields: {} },
};
const pluginDefinition: RelationshipSchemaDefinition = {
	...kernelDefinition,
	pluginId,
	name: "Plugin relation",
};
const kernelReference: RelationshipSchemaReference = {
	slug: relationshipSlug,
	owner: { kind: "kernel" },
};
const pluginReference: RelationshipSchemaReference = {
	slug: relationshipSlug,
	owner: { pluginId, kind: "plugin" },
};

class RelationshipCalls extends Context.Service<
	RelationshipCalls,
	{ readonly globalReferences: Effect.Effect<ReadonlyArray<RelationshipSchemaReference>> }
>()("test/RelationshipCalls") {}

const repositoryLayer = Layer.unwrap(
	Effect.gen(function* () {
		const globalReferences = yield* Ref.make<ReadonlyArray<RelationshipSchemaReference>>([]);
		const definitions = Layer.mock(DefinitionRepository)({
			findUserRelationshipSchemas: (_userId, references) =>
				Effect.succeed(
					Object.fromEntries(
						references.map((reference) => [
							definitionKey("relationship", reference.owner, reference.slug),
							pluginDefinition,
						]),
					),
				),
			findGlobalRelationshipSchema: (reference) =>
				Ref.update(globalReferences, (all) => [
					...all,
					{ ...reference, slug: RelationshipSchemaSlug.make(reference.slug) },
				]).pipe(
					Effect.andThen(
						Effect.succeed(reference.owner.kind === "kernel" ? kernelDefinition : pluginDefinition),
					),
				),
		});
		return RelationshipSchemaReader.layer.pipe(
			Layer.provideMerge(definitions),
			Layer.provideMerge(
				Layer.succeed(RelationshipCalls, { globalReferences: Ref.get(globalReferences) }),
			),
		);
	}),
);

layer(repositoryLayer)((test) => {
	test.effect("resolves relationship references without crossing owners", () =>
		Effect.gen(function* () {
			const repository = yield* RelationshipSchemaReader;
			expect(yield* repository.findByReference(pluginReference, UserId.make("user"))).toMatchObject(
				{ pluginId, slug: relationshipSlug, name: "Plugin relation" },
			);
			expect(yield* repository.findByReference(kernelReference, null)).toMatchObject({
				pluginId: null,
				slug: relationshipSlug,
				name: "Kernel relation",
			});
			expect(yield* repository.findKernelBySlug("shared-relation")).toMatchObject({
				pluginId: null,
				name: "Kernel relation",
			});
			expect(yield* (yield* RelationshipCalls).globalReferences).toEqual([
				kernelReference,
				kernelReference,
			]);
		}),
	);
});
