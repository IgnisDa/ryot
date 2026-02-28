import { EntitySchemaSlug, type UserId } from "@ryot/contract/schema/brands";
import { Effect } from "effect";

import { DefinitionRegistry } from "#modules/definition-registry/service";

const listed = (definition: NonNullable<ReturnType<DefinitionRegistry["getEntitySchema"]>>) => ({
	isBuiltin: true,
	name: definition.name,
	icon: definition.icon,
	slug: definition.slug,
	accentColor: definition.accentColor,
	id: EntitySchemaSlug.make(definition.slug),
	propertiesSchema: definition.propertiesSchema,
});

export class EntitySchemasRepository extends Effect.Service<EntitySchemasRepository>()(
	"EntitySchemasRepository",
	{
		effect: Effect.gen(function* () {
			const definitions = yield* DefinitionRegistry;
			const getBuiltinBySlug = (slug: string) =>
				Effect.succeed(definitions.getEntitySchema(slug)).pipe(
					Effect.map((definition) =>
						definition
							? {
									id: EntitySchemaSlug.make(definition.slug),
									propertiesSchema: definition.propertiesSchema,
								}
							: null,
					),
				);
			const listVisibleBySlugs = (_userId: UserId, slugs: ReadonlyArray<string>) =>
				Effect.succeed(
					slugs.flatMap((slug) => {
						const definition = definitions.getEntitySchema(slug);
						return definition ? [listed(definition)] : [];
					}),
				);
			const getBuiltinDetailsBySlug = (slug: string) =>
				Effect.succeed(definitions.getEntitySchema(slug)).pipe(
					Effect.map((definition) => (definition ? listed(definition) : null)),
				);

			return { getBuiltinBySlug, listVisibleBySlugs, getBuiltinDetailsBySlug };
		}),
	},
) {}
