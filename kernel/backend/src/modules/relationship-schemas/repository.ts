import {
	EntitySchemaSlug,
	RelationshipSchemaSlug,
	type UserId,
} from "@ryot-app/contract/schema/brands";
import type { AppSchema } from "@ryot-app/contract/schema/property-schema";
import { Context, Effect, Layer } from "effect";

import { Database } from "#lib/infrastructure/db/service";
import {
	DefinitionRegistry,
	type RelationshipSchemaDefinition,
} from "#modules/definition-registry/service";
import { PluginRuntimeResolver } from "#modules/plugins/runtime-resolver";

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
			const database = yield* Database;
			const definitions = yield* DefinitionRegistry;
			const pluginRuntime = yield* PluginRuntimeResolver;
			const findBuiltinBySlug = (slug: string) => {
				const definition = definitions.getRelationshipSchema(slug);
				return Effect.succeed(definition ? toScope(definition) : null);
			};
			const findById = (slug: RelationshipSchemaSlug, userId: UserId | null) =>
				userId === null
					? findBuiltinBySlug(slug)
					: pluginRuntime.getEffectiveDefinitions(userId).pipe(
							Effect.map((effective) => {
								const definition = effective.relationshipSchemas[slug];
								return definition ? toScope(definition) : null;
							}),
							Effect.provideService(Database, database),
						);
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
