import {
	EntitySchemaSlug,
	RelationshipSchemaSlug,
	type UserId,
} from "@ryot-app/contract/schema/brands";
import type { AppSchema } from "@ryot-app/contract/schema/property-schema";
import { Context, Effect, Layer } from "effect";

import { DefinitionRepository } from "#modules/definition-registry/repository";
import type { RelationshipSchemaDefinition } from "#modules/definition-registry/snapshot";

export type RelationshipSchemaScope = {
	readonly name: string;
	readonly slug: string;
	readonly isBuiltin: boolean;
	readonly id: RelationshipSchemaSlug;
	readonly propertiesSchema: AppSchema;
	readonly pluginId?: string | null | undefined;
	readonly sourceEntitySchemaSlug: EntitySchemaSlug | null;
	readonly targetEntitySchemaSlug: EntitySchemaSlug | null;
};

const toNullableScope = (definition: RelationshipSchemaDefinition | null | undefined) =>
	definition ? toScope(definition) : null;

export class RelationshipSchemasRepository extends Context.Service<RelationshipSchemasRepository>()(
	"RelationshipSchemasRepository",
	{
		make: Effect.gen(function* () {
			const definitions = yield* DefinitionRepository;
			const findBuiltinBySlug = (slug: string) =>
				definitions.findGlobalRelationshipSchema(slug).pipe(Effect.map(toNullableScope));
			const findById = (slug: RelationshipSchemaSlug, userId: UserId | null) =>
				userId === null
					? findBuiltinBySlug(slug)
					: definitions
							.findUserRelationshipSchemas(userId, [slug])
							.pipe(Effect.map((found) => toNullableScope(found[slug])));
			const findGlobalBySchemaIds = (input: {
				sourceEntitySchemaSlug: EntitySchemaSlug;
				targetEntitySchemaSlug: EntitySchemaSlug;
			}) =>
				definitions.getGlobalSnapshot.pipe(
					Effect.map((snapshot) =>
						toNullableScope(
							Object.values(snapshot.relationshipSchemas).find(
								(item) =>
									item.sourceEntitySchemaSlug === input.sourceEntitySchemaSlug &&
									item.targetEntitySchemaSlug === input.targetEntitySchemaSlug,
							),
						),
					),
				);
			return { findById, findBuiltinBySlug, findGlobalBySchemaIds };
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make);
}

const toScope = (definition: RelationshipSchemaDefinition): RelationshipSchemaScope => ({
	isBuiltin: true,
	name: definition.name,
	slug: definition.slug,
	propertiesSchema: definition.propertiesSchema,
	id: RelationshipSchemaSlug.make(definition.slug),
	...(definition.pluginId == null ? {} : { pluginId: definition.pluginId }),
	sourceEntitySchemaSlug: definition.sourceEntitySchemaSlug
		? EntitySchemaSlug.make(definition.sourceEntitySchemaSlug)
		: null,
	targetEntitySchemaSlug: definition.targetEntitySchemaSlug
		? EntitySchemaSlug.make(definition.targetEntitySchemaSlug)
		: null,
});
