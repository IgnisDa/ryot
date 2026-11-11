import { Result, Schema } from "@ryot-app/plugin-backend-sdk/effect";
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
	parameters,
	type Recipe,
	schemaOwnerPredicate,
	selectedField,
	selectedInclude,
	selectedRows,
	table,
} from "@ryot-app/plugin-backend-sdk/ryotql";
import type { PluginIdentityReference } from "@ryot-app/plugin-kit/schema";

import { builtinMediaEntitySchemaSlugs } from "../../shared/media-schema-slugs";

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
		eq(column(relationship, "relationshipSchemaPluginId"), column(entity, "entitySchemaPluginId")),
		isNotNull(column(relationship, "userId")),
		eq(column(relationship, "relationshipSchemaSlug"), literal("media-monitoring")),
	);

const targetParameters = parameters({
	fields: {
		entityIds: {
			type: "array",
			label: "Titles",
			validation: { minItems: 1, required: true },
			description: "Media entities whose monitoring state to read",
			items: { type: "string", label: "Title", description: "Media entity ID" },
		},
	},
});
export const mediaMonitoringTargetsRecipe = (reference: PluginIdentityReference) => {
	const entity = table("entity", "entity");
	const relationship = table("relationship", "monitoringRelationship");
	return defineRecipe({
		parameters: targetParameters.schema,
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
		queries: {
			targets: selectedRows(entity, {
				limit: 100,
				selection: targetSelection(entity),
				orderBy: [ascending(column(entity, "id"))],
				where: and(
					schemaOwnerPredicate(entity, "entitySchemaPluginId", reference),
					providerBackedFilter(entity),
					inArray(column(entity, "id"), targetParameters.list("entityIds")),
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
	});
};

export const mediaMonitoringSweepRecipe = (reference: PluginIdentityReference) => {
	const entity = table("entity", "entity");
	const relationship = table("relationship", "monitoringRelationship");
	return defineRecipe({
		map: ({ targets }) =>
			Result.succeed({ items: targets.items, nextCursor: targets.pageInfo.nextCursor }),
		queries: {
			targets: selectedRows(entity, {
				limit: 100,
				selection: targetSelection(entity),
				orderBy: [ascending(column(entity, "id"))],
				where: and(
					schemaOwnerPredicate(entity, "entitySchemaPluginId", reference),
					providerBackedFilter(entity),
					exists(relationship, { where: monitoringRelationshipFilter(entity, relationship) }),
				),
			}),
		},
	});
};

export type MediaMonitoringSweep = Recipe.Success<ReturnType<typeof mediaMonitoringSweepRecipe>>;
export type MediaMonitoringTarget = Recipe.Success<
	ReturnType<typeof mediaMonitoringTargetsRecipe>
>[number];
