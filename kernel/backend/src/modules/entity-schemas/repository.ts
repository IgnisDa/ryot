import {
	definitionKey,
	type EntitySchemaReference,
} from "@ryot-app/contract/modules/plugins/references";
import type { UserId } from "@ryot-app/contract/schema/brands";
import { Context, Effect, Layer } from "effect";

import { DefinitionRepository } from "#modules/definition-registry/repository";
import type { EntitySchemaSnapshot } from "#modules/definition-registry/snapshot";

const listed = (definition: EntitySchemaSnapshot) => ({
	name: definition.name,
	icon: definition.icon,
	slug: definition.slug,
	pluginId: definition.pluginId,
	propertiesSchema: definition.propertiesSchema,
});

export class EntitySchemasRepository extends Context.Service<EntitySchemasRepository>()(
	"EntitySchemasRepository",
	{
		make: Effect.gen(function* () {
			const definitions = yield* DefinitionRepository;
			const getGlobalByReference = (reference: EntitySchemaReference) =>
				definitions
					.findGlobalEntitySchema(reference)
					.pipe(
						Effect.map((definition) =>
							definition
								? {
										slug: definition.slug,
										pluginId: definition.pluginId,
										propertiesSchema: definition.propertiesSchema,
									}
								: null,
						),
					);
			const listVisibleByReferences = (
				userId: UserId,
				references: ReadonlyArray<EntitySchemaReference>,
			) =>
				definitions.findUserEntitySchemas(userId, references).pipe(
					Effect.map((found) =>
						references.flatMap((reference) => {
							const definition = found[definitionKey("entity", reference.owner, reference.slug)];
							return definition ? [listed(definition)] : [];
						}),
					),
				);
			const getGlobalDetailsByReference = (reference: EntitySchemaReference) =>
				definitions
					.findGlobalEntitySchema(reference)
					.pipe(Effect.map((definition) => (definition ? listed(definition) : null)));

			return { getGlobalByReference, listVisibleByReferences, getGlobalDetailsByReference };
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make);
}
