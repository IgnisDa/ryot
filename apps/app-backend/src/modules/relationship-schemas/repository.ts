import {
	EntitySchemaSlug,
	RelationshipSchemaSlug,
	type UserId,
} from "@ryot/contract/schema/brands";
import { Effect } from "effect";

import { DefinitionRegistry } from "#modules/definition-registry/service";

export class RelationshipSchemasRepository extends Effect.Service<RelationshipSchemasRepository>()(
	"RelationshipSchemasRepository",
	{
		effect: Effect.gen(function* () {
			const definitions = yield* DefinitionRegistry;
			const findBuiltinBySlug = (slug: string) => {
				const definition = definitions.getRelationshipSchema(slug);
				return Effect.succeed(definition ? toScope(definition) : null);
			};
			const findById = (slug: RelationshipSchemaSlug, _userId: UserId | null) =>
				findBuiltinBySlug(slug);
			const findGlobalBySchemaIds = (input: {
				sourceEntitySchemaSlug: EntitySchemaSlug;
				targetEntitySchemaSlug: EntitySchemaSlug;
			}) => {
				const definition = Object.values(definitions.getSnapshot().relationshipSchemas).find(
					(item) =>
						item.sourceEntitySchemaSlug === input.sourceEntitySchemaSlug &&
						item.targetEntitySchemaSlug === input.targetEntitySchemaSlug,
				);
				return Effect.succeed(definition ? toScope(definition) : null);
			};
			return { findById, findBuiltinBySlug, findGlobalBySchemaIds };
		}),
	},
) {}

const toScope = (
	definition: NonNullable<ReturnType<DefinitionRegistry["getRelationshipSchema"]>>,
) => ({
	isBuiltin: true,
	name: definition.name,
	slug: definition.slug,
	propertiesSchema: definition.propertiesSchema,
	id: RelationshipSchemaSlug.make(definition.slug),
	sourceEntitySchemaSlug: definition.sourceEntitySchemaSlug
		? EntitySchemaSlug.make(definition.sourceEntitySchemaSlug)
		: null,
	targetEntitySchemaSlug: definition.targetEntitySchemaSlug
		? EntitySchemaSlug.make(definition.targetEntitySchemaSlug)
		: null,
});
