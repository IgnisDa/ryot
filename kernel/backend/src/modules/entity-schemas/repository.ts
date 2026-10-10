import { EntitySchemaSlug, type UserId } from "@ryot-app/contract/schema/brands";
import { Context, Effect, Layer } from "effect";

import { DefinitionRepository } from "#modules/definition-registry/repository";
import type { EntitySchemaSnapshot } from "#modules/definition-registry/snapshot";

const listed = (definition: EntitySchemaSnapshot) => ({
	isBuiltin: true,
	name: definition.name,
	icon: definition.icon,
	slug: definition.slug,
	id: EntitySchemaSlug.make(definition.slug),
	propertiesSchema: definition.propertiesSchema,
});

export class EntitySchemasRepository extends Context.Service<EntitySchemasRepository>()(
	"EntitySchemasRepository",
	{
		make: Effect.gen(function* () {
			const definitions = yield* DefinitionRepository;
			const getBuiltinBySlug = (slug: string) =>
				definitions
					.findGlobalEntitySchema(slug)
					.pipe(
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
				Effect.forEach(slugs, definitions.findGlobalEntitySchema).pipe(
					Effect.map((found) =>
						found.flatMap((definition) => (definition ? [listed(definition)] : [])),
					),
				);
			const getBuiltinDetailsBySlug = (slug: string) =>
				definitions
					.findGlobalEntitySchema(slug)
					.pipe(Effect.map((definition) => (definition ? listed(definition) : null)));

			return { getBuiltinBySlug, listVisibleBySlugs, getBuiltinDetailsBySlug };
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make);
}
