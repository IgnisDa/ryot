import { Result, Schema } from "@ryot-app/sandbox-sdk/effect";
import {
	and,
	ascending,
	column,
	defineRecipe,
	eq,
	exists,
	inArray,
	isNotNull,
	isNull,
	literal,
	selectedField,
	selectedInclude,
	selectedRows,
	table,
	type Recipe,
} from "@ryot-app/sandbox-sdk/ryotql";

import { builtinMediaEntitySchemaSlugs } from "./schemas/media-schema-slugs";

const mediaMonitorableEntitySchemaSlugs = [
	"company",
	"person",
	...builtinMediaEntitySchemaSlugs,
] as const;

const providerBackedFilter = (entity: ReturnType<typeof table>) =>
	and(
		isNull(column(entity, "userId")),
		isNotNull(column(entity, "externalId")),
		isNotNull(column(entity, "providerId")),
		inArray(
			column(entity, "entitySchemaSlug"),
			mediaMonitorableEntitySchemaSlugs.map((slug) => literal(slug)),
		),
	);

const targetSelection = (entity: ReturnType<typeof table>) => ({
	entityId: selectedField(column(entity, "id"), Schema.String),
	externalId: selectedField(column(entity, "externalId"), Schema.String),
	providerId: selectedField(column(entity, "providerId"), Schema.String),
	entitySchemaSlug: selectedField(column(entity, "entitySchemaSlug"), Schema.String),
});

const monitoringRelationshipFilter = (
	entity: ReturnType<typeof table>,
	relationship: ReturnType<typeof table>,
) =>
	and(
		eq(column(relationship, "sourceEntityId"), column(entity, "id")),
		isNotNull(column(relationship, "userId")),
		eq(column(relationship, "relationshipSchemaSlug"), literal("media-monitoring")),
	);

export const mediaMonitoringTargetsRecipe = defineRecipe((entityIds: readonly string[]) => {
	if (entityIds.length === 0) {
		throw new Error("At least one entity id is required");
	}
	const entity = table("entity", "entity");
	const relationship = table("relationship", "monitoringRelationship");
	return {
		queries: {
			targets: selectedRows(entity, {
				limit: entityIds.length,
				selection: targetSelection(entity),
				orderBy: [ascending(column(entity, "id"))],
				where: and(
					providerBackedFilter(entity),
					inArray(
						column(entity, "id"),
						entityIds.map((entityId) => literal(entityId)),
					),
				),
				include: {
					monitoringLibraries: selectedInclude(relationship, {
						limit: 1,
						where: monitoringRelationshipFilter(entity, relationship),
						orderBy: [ascending(column(relationship, "targetEntityId"))],
						selection: {
							libraryEntityId: selectedField(column(relationship, "targetEntityId"), Schema.String),
						},
					}),
				},
			}),
		},
		map: ({ targets }) =>
			Result.succeed(
				targets.items.map((target) => ({
					entityId: target.entityId,
					externalId: target.externalId,
					providerId: target.providerId,
					entitySchemaSlug: target.entitySchemaSlug,
					monitoringLibraryId: target.monitoringLibraries.items[0]?.libraryEntityId ?? null,
				})),
			),
	};
});

export const mediaMonitoringSweepRecipe = defineRecipe(
	(after: string | undefined, limit: number) => {
		const entity = table("entity", "entity");
		const relationship = table("relationship", "monitoringRelationship");
		return {
			queries: {
				targets: selectedRows(entity, {
					after,
					limit,
					selection: targetSelection(entity),
					orderBy: [ascending(column(entity, "id"))],
					where: and(
						providerBackedFilter(entity),
						exists(relationship, {
							where: monitoringRelationshipFilter(entity, relationship),
						}),
					),
				}),
			},
			map: ({ targets }) =>
				Result.succeed({ items: targets.items, nextCursor: targets.pageInfo.nextCursor }),
		};
	},
);

export type MediaMonitoringTarget = Recipe.Success<typeof mediaMonitoringTargetsRecipe>[number];
export type MediaMonitoringSweep = Recipe.Success<typeof mediaMonitoringSweepRecipe>;
