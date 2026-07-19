import {
	and,
	column,
	descending,
	document,
	eq,
	field,
	inArray,
	join,
	literal,
	rows,
	table,
} from "@ryot/ryotql";

export const buildEventHistoryDocument = (input: {
	readonly page: number;
	readonly limit?: number | undefined;
	readonly entityId?: string | undefined;
	readonly sessionEntityId?: string | undefined;
	readonly eventSchemaSlugs: readonly [string, ...string[]];
	readonly entitySchemaSlugs: readonly [string, ...string[]];
}) => {
	const event = table("event", "event");
	const entity = table("entity", "entity");
	const eventSchema = column(event, "eventSchemaSlug");
	const entitySchema = column(entity, "entitySchemaSlug");
	return document({
		events: rows(event, {
			page: input.page,
			limit: input.limit ?? 100,
			joins: [join("inner", entity, eq(column(event, "entityId"), column(entity, "id")))],
			where: and(
				input.eventSchemaSlugs.length === 1
					? eq(eventSchema, literal(input.eventSchemaSlugs[0]))
					: inArray(
							eventSchema,
							input.eventSchemaSlugs.map((slug) => literal(slug)),
						),
				input.entitySchemaSlugs.length === 1
					? eq(entitySchema, literal(input.entitySchemaSlugs[0]))
					: inArray(
							entitySchema,
							input.entitySchemaSlugs.map((slug) => literal(slug)),
						),
				...(input.entityId ? [eq(column(event, "entityId"), literal(input.entityId))] : []),
				...(input.sessionEntityId
					? [eq(column(event, "sessionEntityId"), literal(input.sessionEntityId))]
					: []),
			),
			orderBy: [
				descending(column(event, "occurredAt")),
				descending(column(event, "createdAt")),
				descending(column(event, "id")),
			],
			fields: [
				field("id", column(event, "id")),
				field("entityId", column(event, "entityId")),
				field("createdAt", column(event, "createdAt")),
				field("updatedAt", column(event, "updatedAt")),
				field("occurredAt", column(event, "occurredAt")),
				field("properties", column(event, "properties")),
				field("eventSchemaSlug", column(event, "eventSchemaSlug")),
				field("sessionEntityId", column(event, "sessionEntityId")),
				field("entitySchemaSlug", column(entity, "entitySchemaSlug")),
			],
		}),
	});
};
