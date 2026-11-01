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
	literal,
	selectedField,
	selectedRows,
	table,
} from "@ryot-app/ryotql";
import { Result, Schema } from "effect";

import { IsoDateString } from "./codecs";

export const entityWatchRecipe = defineRecipe(
	(input: { readonly entityIds: readonly [string, ...string[]] }) => {
		const entity = table("entity", "entity");
		return {
			map: ({ entities }) => Result.succeed(entities.items),
			queries: {
				entities: selectedRows(entity, {
					limit: input.entityIds.length,
					orderBy: [ascending(column(entity, "id"))],
					where: inArray(
						column(entity, "id"),
						input.entityIds.map((entityId) => literal(entityId)),
					),
					selection: {
						id: selectedField(column(entity, "id"), EntityId),
						properties: selectedField(column(entity, "properties"), JsonValue),
						userId: selectedField(column(entity, "userId"), Schema.NullOr(UserId)),
						populationStatus: selectedField(column(entity, "populationStatus"), EnrichmentState),
						externalId: selectedField(column(entity, "externalId"), Schema.NullOr(Schema.String)),
						entitySchemaSlug: selectedField(column(entity, "entitySchemaSlug"), EntitySchemaSlug),
						translationStatus: selectedField(column(entity, "translationStatus"), EnrichmentState),
						populatedAt: selectedField(column(entity, "populatedAt"), Schema.NullOr(IsoDateString)),
						providerId: selectedField(
							column(entity, "providerId"),
							Schema.NullOr(SandboxProviderId),
						),
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
		};
	},
);

export type EntityWatchResult = Recipe.Success<typeof entityWatchRecipe>;
