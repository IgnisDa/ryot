import { Schema } from "@ryot/sandbox-sdk/effect";
import {
	and,
	ascending,
	column,
	decodeRyotqlQuery,
	document,
	eq,
	exists,
	field,
	inArray,
	include,
	isNotNull,
	isNull,
	literal,
	rows,
	ryotqlIncludeResultSchema,
	ryotqlRowsResultSchema,
	ryotqlTextFieldValueSchema,
	table,
} from "@ryot/sandbox-sdk/ryotql";

import { builtinMediaEntitySchemaSlugs } from "./schemas/media-schema-slugs";
import type { MediaMonitoringTarget as MediaMonitoringTargetSchema } from "./workflows/schemas";

const mediaMonitorableEntitySchemaSlugs = [
	"company",
	"person",
	...builtinMediaEntitySchemaSlugs,
] as const;

const strictStruct = <Fields extends Schema.Struct.Fields>(fields: Fields) =>
	Schema.Struct(fields).annotate({ parseOptions: { onExcessProperty: "error" as const } });

const targetRowSchema = strictStruct({
	entityId: ryotqlTextFieldValueSchema,
	externalId: ryotqlTextFieldValueSchema,
	providerId: ryotqlTextFieldValueSchema,
	entitySchemaSlug: ryotqlTextFieldValueSchema,
	monitoringLibraries: ryotqlIncludeResultSchema(
		strictStruct({ libraryEntityId: ryotqlTextFieldValueSchema }),
	),
});

const sweepRowSchema = strictStruct({
	entityId: ryotqlTextFieldValueSchema,
	externalId: ryotqlTextFieldValueSchema,
	providerId: ryotqlTextFieldValueSchema,
	entitySchemaSlug: ryotqlTextFieldValueSchema,
});

const libraryRowSchema = strictStruct({ entityId: ryotqlTextFieldValueSchema });

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

const targetFields = (entity: ReturnType<typeof table>) => [
	field("entityId", column(entity, "id")),
	field("externalId", column(entity, "externalId")),
	field("providerId", column(entity, "providerId")),
	field("entitySchemaSlug", column(entity, "entitySchemaSlug")),
];

const monitoringRelationshipFilter = (
	entity: ReturnType<typeof table>,
	relationship: ReturnType<typeof table>,
) =>
	and(
		eq(column(relationship, "sourceEntityId"), column(entity, "id")),
		isNotNull(column(relationship, "userId")),
		eq(column(relationship, "relationshipSchemaSlug"), literal("media-monitoring")),
	);

export const buildMediaMonitoringTargetsDocument = (entityIds: readonly string[]) => {
	if (entityIds.length === 0) {
		throw new Error("At least one entity id is required");
	}
	const entity = table("entity", "entity");
	const relationship = table("relationship", "monitoringRelationship");
	return document({
		targets: rows(entity, {
			limit: entityIds.length,
			fields: targetFields(entity),
			orderBy: [ascending(column(entity, "id"))],
			where: and(
				providerBackedFilter(entity),
				inArray(
					column(entity, "id"),
					entityIds.map((entityId) => literal(entityId)),
				),
			),
			include: [
				include(relationship, {
					limit: 1,
					key: "monitoringLibraries",
					where: monitoringRelationshipFilter(entity, relationship),
					orderBy: [ascending(column(relationship, "targetEntityId"))],
					fields: [field("libraryEntityId", column(relationship, "targetEntityId"))],
				}),
			],
		}),
	});
};

export const buildUserLibraryDocument = () => {
	const library = table("entity", "library");
	return document({
		library: rows(library, {
			limit: 1,
			fields: [field("entityId", column(library, "id"))],
			orderBy: [ascending(column(library, "id"))],
			where: and(
				eq(column(library, "entitySchemaSlug"), literal("library")),
				isNotNull(column(library, "userId")),
			),
		}),
	});
};

export const buildMediaMonitoringSweepDocument = (page: number, limit: number) => {
	const entity = table("entity", "entity");
	const relationship = table("relationship", "monitoringRelationship");
	return document({
		targets: rows(entity, {
			page,
			limit,
			fields: targetFields(entity),
			orderBy: [ascending(column(entity, "id"))],
			where: and(
				providerBackedFilter(entity),
				exists(relationship, {
					where: monitoringRelationshipFilter(entity, relationship),
				}),
			),
		}),
	});
};

export type MediaMonitoringTarget = typeof MediaMonitoringTargetSchema.Type & {
	readonly monitoringLibraryId: string | null;
};

export const decodeMediaMonitoringTargets = (response: unknown): MediaMonitoringTarget[] =>
	decodeRyotqlQuery(response, "targets", ryotqlRowsResultSchema(targetRowSchema)).items.map(
		(row) => ({
			entityId: row.entityId.value,
			externalId: row.externalId.value,
			providerId: row.providerId.value,
			entitySchemaSlug: row.entitySchemaSlug.value,
			monitoringLibraryId: row.monitoringLibraries.items[0]?.libraryEntityId.value ?? null,
		}),
	);

export const decodeMediaMonitoringSweep = (response: unknown) => {
	const result = decodeRyotqlQuery(response, "targets", ryotqlRowsResultSchema(sweepRowSchema));
	return {
		items: result.items.map((row) => ({
			entityId: row.entityId.value,
			externalId: row.externalId.value,
			providerId: row.providerId.value,
			entitySchemaSlug: row.entitySchemaSlug.value,
		})),
		hasMore: result.pageInfo.hasMore,
	};
};

export const decodeUserLibraryId = (response: unknown) =>
	decodeRyotqlQuery(response, "library", ryotqlRowsResultSchema(libraryRowSchema)).items[0]
		?.entityId.value ?? null;
