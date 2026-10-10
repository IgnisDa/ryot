import { PopulationStatus, TranslationStatus } from "@ryot-app/contract/modules/entities/schemas";
import { JsonValue } from "@ryot-app/contract/modules/ryotql/language";
import { EntityId, EntitySchemaSlug, SandboxProviderId } from "@ryot-app/contract/schema/brands";
import type { Recipe } from "@ryot-app/ryotql";
import {
	ascending,
	column,
	defineRecipe,
	eq,
	inArray,
	literal,
	selectedField,
	selectedOptionalRow,
	selectedRows,
	table,
} from "@ryot-app/ryotql";
import { Result, Schema } from "effect";

export const entityInterestRecipe = defineRecipe(
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
						externalId: selectedField(column(entity, "externalId"), Schema.NullOr(Schema.String)),
						entitySchemaSlug: selectedField(column(entity, "entitySchemaSlug"), EntitySchemaSlug),
						populationStatus: selectedField(column(entity, "populationStatus"), PopulationStatus),
						translationStatus: selectedField(
							column(entity, "translationStatus"),
							TranslationStatus,
						),
						providerId: selectedField(
							column(entity, "providerId"),
							Schema.NullOr(SandboxProviderId),
						),
					},
				}),
			},
		};
	},
);

export type EntityInterestResult = Recipe.Success<typeof entityInterestRecipe>;

export const entityRouteProvenanceRecipe = defineRecipe((input: { readonly entityId: string }) => {
	const entity = table("entity", "entity");
	return {
		map: ({ entity: provenance }) => Result.succeed(provenance ?? null),
		queries: {
			entity: selectedOptionalRow(entity, {
				orderBy: [ascending(column(entity, "id"))],
				where: eq(column(entity, "id"), literal(input.entityId)),
				selection: {
					entitySchemaSlug: selectedField(column(entity, "entitySchemaSlug"), EntitySchemaSlug),
					entitySchemaPluginId: selectedField(
						column(entity, "entitySchemaPluginId"),
						Schema.NullOr(Schema.String),
					),
				},
			}),
		},
	};
});

export type EntityRouteProvenance = Recipe.Success<typeof entityRouteProvenanceRecipe>;
