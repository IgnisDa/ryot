import { EnrichmentState } from "@ryot-app/contract/modules/entities/schemas";
import {
	EntityId,
	EntitySchemaSlug,
	PluginId,
	SandboxProviderId,
	UserId,
} from "@ryot-app/contract/schema/brands";
import { JsonValue } from "@ryot-app/contract/schema/json";
import type { Recipe } from "@ryot-app/ryotql";
import {
	ascending,
	column,
	defineRecipe,
	inArray,
	selectedField,
	selectedRows,
	table,
} from "@ryot-app/ryotql";
import { parameters } from "@ryot-app/ryotql/authoring";
import { Array as Arr, Effect, Result, Schema } from "effect";

import { IsoDateString } from "./codecs";

export const entityWatchRecipe = (() => {
	const recipeParameters = parameters({
		fields: {
			entityIds: {
				type: "array",
				label: "entityIds",
				description: "Query argument",
				validation: { required: true },
				items: {
					type: "string",
					label: "Value",
					validation: { required: true },
					description: "Query argument value",
				},
			},
		},
	});

	const entity = table("entity", "entity");
	return defineRecipe({
		parameters: recipeParameters.schema,
		map: ({ entities }) => Result.succeed(entities.items),
		queries: {
			entities: selectedRows(entity, {
				limit: 100,
				maxLimit: 100,
				orderBy: [ascending(column(entity, "id"))],
				where: inArray(column(entity, "id"), recipeParameters.list("entityIds")),
				selection: {
					id: selectedField(column(entity, "id"), EntityId),
					properties: selectedField(column(entity, "properties"), JsonValue),
					userId: selectedField(column(entity, "userId"), Schema.NullOr(UserId)),
					populationStatus: selectedField(column(entity, "populationStatus"), EnrichmentState),
					externalId: selectedField(column(entity, "externalId"), Schema.NullOr(Schema.String)),
					entitySchemaSlug: selectedField(column(entity, "entitySchemaSlug"), EntitySchemaSlug),
					translationStatus: selectedField(column(entity, "translationStatus"), EnrichmentState),
					populatedAt: selectedField(column(entity, "populatedAt"), Schema.NullOr(IsoDateString)),
					providerId: selectedField(column(entity, "providerId"), Schema.NullOr(SandboxProviderId)),
					relatedPopulationStatus: selectedField(
						column(entity, "relatedPopulationStatus"),
						EnrichmentState,
					),
					entitySchemaPluginId: selectedField(
						column(entity, "entitySchemaPluginId"),
						Schema.NullOr(PluginId),
					),
				},
			}),
		},
	});
})();

export type EntityWatchResult = Recipe.Success<typeof entityWatchRecipe>;

export const loadEntityWatches = Effect.fn("loadEntityWatches")(function* <E, R>(
	entityIds: readonly string[],
	query: (entityIds: readonly string[]) => Effect.Effect<EntityWatchResult, E, R>,
) {
	const results = yield* Effect.forEach(Arr.chunksOf(Arr.dedupe(entityIds), 100), query);
	return results.flat();
});
