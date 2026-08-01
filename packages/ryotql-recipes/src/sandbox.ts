import { ascending, column, document, field, inArray, literal, rows, table } from "@ryot/ryotql";

import { buildEventHistoryDocument } from "./events";

export const buildEntityReadDocument = (input: {
	readonly entityIds: readonly [string, ...string[]];
}) => {
	const entity = table("entity", "entity");
	return document({
		entities: rows(entity, {
			limit: 100,
			orderBy: [ascending(column(entity, "id"))],
			where: inArray(
				column(entity, "id"),
				input.entityIds.map((entityId) => literal(entityId)),
			),
			fields: [
				field("id", column(entity, "id")),
				field("name", column(entity, "name")),
				field("createdAt", column(entity, "createdAt")),
				field("updatedAt", column(entity, "updatedAt")),
				field("properties", column(entity, "properties")),
				field("entitySchemaSlug", column(entity, "entitySchemaSlug")),
				field("providerId", column(entity, "providerId")),
				field("externalId", column(entity, "externalId")),
				field("populatedAt", column(entity, "populatedAt")),
			],
		}),
	});
};

export const buildEventReadDocument = (input: {
	readonly eventSchemaSlug: string;
	readonly entitySchemaSlug: string;
	readonly after?: string | undefined;
	readonly entityId?: string | undefined;
	readonly sessionEntityId?: string | undefined;
}) =>
	buildEventHistoryDocument({
		after: input.after,
		entityId: input.entityId,
		sessionEntityId: input.sessionEntityId,
		eventSchemaSlugs: [input.eventSchemaSlug],
		entitySchemaSlugs: [input.entitySchemaSlug],
	});
