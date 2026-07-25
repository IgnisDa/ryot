import {
	and,
	ascending,
	column,
	document,
	eq,
	field,
	inArray,
	literal,
	rows,
	table,
} from "@ryot/ryotql";

export const buildEntityDetailDocument = (input: {
	readonly entityId: string;
	readonly entitySchemaSlug: string;
}) => {
	const entity = table("entity", "entity");
	return document({
		entity: rows(entity, {
			limit: 1,
			orderBy: [ascending(column(entity, "id"))],
			where: and(
				eq(column(entity, "id"), literal(input.entityId)),
				eq(column(entity, "entitySchemaSlug"), literal(input.entitySchemaSlug)),
			),
			fields: [
				field("id", column(entity, "id")),
				field("name", column(entity, "name")),
				field("createdAt", column(entity, "createdAt")),
				field("updatedAt", column(entity, "updatedAt")),
				field("properties", column(entity, "properties")),
				field("externalId", column(entity, "externalId")),
				field("populatedAt", column(entity, "populatedAt")),
				field("entitySchemaSlug", column(entity, "entitySchemaSlug")),
				field("providerId", column(entity, "providerId")),
				field("translationStatus", column(entity, "translationStatus")),
			],
		}),
	});
};

export const buildEntityInterestDocument = (input: {
	readonly entityIds: readonly [string, ...string[]];
}) => {
	const entity = table("entity", "entity");
	return document({
		entities: rows(entity, {
			limit: input.entityIds.length,
			orderBy: [ascending(column(entity, "id"))],
			where: inArray(
				column(entity, "id"),
				input.entityIds.map((entityId) => literal(entityId)),
			),
			fields: [
				field("id", column(entity, "id")),
				field("properties", column(entity, "properties")),
				field("externalId", column(entity, "externalId")),
				field("populatedAt", column(entity, "populatedAt")),
				field("entitySchemaSlug", column(entity, "entitySchemaSlug")),
				field("providerId", column(entity, "providerId")),
				field("translationStatus", column(entity, "translationStatus")),
			],
		}),
	});
};
