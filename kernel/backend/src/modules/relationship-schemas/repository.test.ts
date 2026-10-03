import { expect, layer } from "@effect/vitest";
import {
	definitionKey,
	type DefinitionOwner,
	type EntitySchemaReference,
	type RelationshipSchemaReference,
} from "@ryot-app/contract/modules/plugins/references";
import {
	EntitySchemaSlug,
	PluginId,
	RelationshipSchemaSlug,
	UserId,
} from "@ryot-app/contract/schema/brands";
import { Context, Effect, Layer, Ref } from "effect";

import { DefinitionRepository } from "#modules/definition-registry/repository";
import type { RelationshipSchemaDefinition } from "#modules/definition-registry/snapshot";

import { RelationshipSchemasRepository } from "./repository";

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

type EndpointQuery = {
	readonly owner: DefinitionOwner;
	readonly sourceEntitySchemaSlug: EntitySchemaSlug;
	readonly targetEntitySchemaSlug: EntitySchemaSlug;
};

class RelationshipCalls extends Context.Service<
	RelationshipCalls,
	{
		readonly globalReferences: Effect.Effect<ReadonlyArray<RelationshipSchemaReference>>;
		readonly endpointQueries: Effect.Effect<ReadonlyArray<EndpointQuery>>;
	}
>()("test/RelationshipCalls") {}

const repositoryLayer = Layer.unwrap(
	Effect.gen(function* () {
		const globalReferences = yield* Ref.make<ReadonlyArray<RelationshipSchemaReference>>([]);
		const endpointQueries = yield* Ref.make<ReadonlyArray<EndpointQuery>>([]);
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
			findGlobalRelationshipSchemaByEndpoints: (
				owner,
				sourceEntitySchemaSlug,
				targetEntitySchemaSlug,
			) =>
				Ref.update(endpointQueries, (all) => [
					...all,
					{
						owner,
						sourceEntitySchemaSlug: EntitySchemaSlug.make(sourceEntitySchemaSlug),
						targetEntitySchemaSlug: EntitySchemaSlug.make(targetEntitySchemaSlug),
					},
				]).pipe(Effect.as(pluginDefinition)),
		});
		return RelationshipSchemasRepository.layer.pipe(
			Layer.provideMerge(definitions),
			Layer.provideMerge(
				Layer.succeed(RelationshipCalls, {
					endpointQueries: Ref.get(endpointQueries),
					globalReferences: Ref.get(globalReferences),
				}),
			),
		);
	}),
);

layer(repositoryLayer)((test) => {
	test.effect("resolves relationship references without crossing owners", () =>
		Effect.gen(function* () {
			const repository = yield* RelationshipSchemasRepository;
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

	test.effect("uses the supplied endpoint references and relationship owner", () =>
		Effect.gen(function* () {
			const repository = yield* RelationshipSchemasRepository;
			const sourceEntitySchema: EntitySchemaReference = {
				owner: { pluginId, kind: "plugin" },
				slug: EntitySchemaSlug.make("source"),
			};
			const targetEntitySchema: EntitySchemaReference = {
				owner: { pluginId, kind: "plugin" },
				slug: EntitySchemaSlug.make("target"),
			};
			expect(
				yield* repository.findGlobalBySchemaIds({
					sourceEntitySchema,
					targetEntitySchema,
					owner: { pluginId, kind: "plugin" },
				}),
			).toMatchObject({ pluginId });
			expect(yield* (yield* RelationshipCalls).endpointQueries).toEqual([
				{
					owner: { pluginId, kind: "plugin" },
					sourceEntitySchemaSlug: sourceEntitySchema.slug,
					targetEntitySchemaSlug: targetEntitySchema.slug,
				},
			]);
		}),
	);
});
