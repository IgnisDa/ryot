import { asc, eq, isNull, or } from "drizzle-orm";
import { db } from "~/db";
import { entitySchema, eventSchema } from "~/db/schema";

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
