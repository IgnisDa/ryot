import { and, asc, eq, isNull, or } from "drizzle-orm";
import { db } from "~/db";
import { entity, entitySchema, event, eventSchema } from "~/db/schema";

export const listEventSchemasByUser = async (userId: string) => {
	const rows = await db
		.select({
			id: eventSchema.id,
			slug: eventSchema.slug,
			name: eventSchema.name,
			createdAt: eventSchema.createdAt,
			updatedAt: eventSchema.updatedAt,
			entitySchemaName: entitySchema.name,
			entitySchemaId: eventSchema.entitySchemaId,
		})
		.from(eventSchema)
		.innerJoin(entitySchema, eq(eventSchema.entitySchemaId, entitySchema.id))
		.where(or(isNull(eventSchema.userId), eq(eventSchema.userId, userId)))
		.orderBy(asc(eventSchema.name), asc(entitySchema.name));

	return rows;
};

export const getEventSchemaByIdForUser = async (input: {
	userId: string;
	eventSchemaId: string;
}) => {
	const [foundSchema] = await db
		.select({
			id: eventSchema.id,
			entitySchemaId: eventSchema.entitySchemaId,
			propertiesSchema: eventSchema.propertiesSchema,
		})
		.from(eventSchema)
		.where(
			and(
				eq(eventSchema.id, input.eventSchemaId),
				or(isNull(eventSchema.userId), eq(eventSchema.userId, input.userId)),
			),
		)
		.limit(1);

	return foundSchema;
};

export const getEntityByIdForUser = async (input: {
	userId: string;
	entityId: string;
	entitySchemaId?: string;
}) => {
	const [foundEntity] = await db
		.select({ id: entity.id })
		.from(entity)
		.where(
			input.entitySchemaId
				? and(
						eq(entity.id, input.entityId),
						eq(entity.userId, input.userId),
						eq(entity.entitySchemaId, input.entitySchemaId),
					)
				: and(eq(entity.id, input.entityId), eq(entity.userId, input.userId)),
		)
		.limit(1);

	return foundEntity;
};

export const createEventForSchema = async (input: {
	userId: string;
	entityId: string;
	occurredAt?: Date;
	eventSchemaId: string;
	sessionEntityId?: string;
	properties: Record<string, unknown>;
}) => {
	const [createdEvent] = await db
		.insert(event)
		.values({
			userId: input.userId,
			entityId: input.entityId,
			properties: input.properties,
			occurredAt: input.occurredAt,
			eventSchemaId: input.eventSchemaId,
			sessionEntityId: input.sessionEntityId,
		})
		.returning({ id: event.id });

	return createdEvent;
};
