import {
	EntitySchemaSlug,
	RelationshipSchemaSlug,
	type UserId,
} from "@ryot/contract/schema/brands";
import type { AppSchema } from "@ryot/contract/schema/property-schema";
import { Context, Effect, Layer } from "effect";

import { DefinitionRegistry } from "#modules/definition-registry/service";

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

export class RelationshipSchemasRepository extends Context.Service<RelationshipSchemasRepository>()(
	"RelationshipSchemasRepository",
	{
		make: Effect.gen(function* () {
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
) {
	static readonly layer = Layer.effect(this, this.make);
}

const toScope = (
	definition: NonNullable<ReturnType<DefinitionRegistry["Service"]["getRelationshipSchema"]>>,
): RelationshipSchemaScope => ({
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
