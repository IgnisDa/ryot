import { and, asc, eq, isNull, or } from "drizzle-orm";
import { db } from "~/db";
import { entitySchema, eventSchema } from "~/db/schema";
import type { EventSchemaPropertiesShape } from "./service";

const entitySchemaVisibleToUserClause = (userId: string) => {
	return or(isNull(entitySchema.userId), eq(entitySchema.userId, userId));
};

export const getEntitySchemaScopeForUser = async (input: {
	userId: string;
	entitySchemaId: string;
}) => {
	const [foundEntitySchema] = await db
		.select({
			id: entitySchema.id,
			userId: entitySchema.userId,
			isBuiltin: entitySchema.isBuiltin,
		})
		.from(entitySchema)
		.where(
			and(
				eq(entitySchema.id, input.entitySchemaId),
				entitySchemaVisibleToUserClause(input.userId),
			),
		)
		.limit(1);

	return foundEntitySchema;
};

export const listEventSchemasByEntitySchemaForUser = async (input: {
	userId: string;
	entitySchemaId: string;
}) => {
	const rows = await db
		.select({
			id: eventSchema.id,
			name: eventSchema.name,
			slug: eventSchema.slug,
			entitySchemaId: eventSchema.entitySchemaId,
			propertiesSchema: eventSchema.propertiesSchema,
		})
		.from(eventSchema)
		.where(
			and(
				eq(eventSchema.userId, input.userId),
				eq(eventSchema.entitySchemaId, input.entitySchemaId),
			),
		)
		.orderBy(asc(eventSchema.name), asc(eventSchema.createdAt));

	return rows.map((row) => ({
		...row,
		propertiesSchema: row.propertiesSchema as EventSchemaPropertiesShape,
	}));
};

export const getEventSchemaBySlugForUser = async (input: {
	userId: string;
	entitySchemaId: string;
	slug: string;
}) => {
	const [foundEventSchema] = await db
		.select({ id: eventSchema.id })
		.from(eventSchema)
		.where(
			and(
				eq(eventSchema.userId, input.userId),
				eq(eventSchema.entitySchemaId, input.entitySchemaId),
				eq(eventSchema.slug, input.slug),
			),
		)
		.limit(1);

	return foundEventSchema;
};

export const createEventSchemaForUser = async (input: {
	name: string;
	slug: string;
	userId: string;
	entitySchemaId: string;
	propertiesSchema: EventSchemaPropertiesShape;
}) => {
	const [createdEventSchema] = await db
		.insert(eventSchema)
		.values({
			name: input.name,
			slug: input.slug,
			userId: input.userId,
			entitySchemaId: input.entitySchemaId,
			propertiesSchema: input.propertiesSchema,
		})
		.returning({
			id: eventSchema.id,
			name: eventSchema.name,
			slug: eventSchema.slug,
			entitySchemaId: eventSchema.entitySchemaId,
			propertiesSchema: eventSchema.propertiesSchema,
		});

	if (!createdEventSchema) throw new Error("Could not persist event schema");

	return {
		...createdEventSchema,
		propertiesSchema:
			createdEventSchema.propertiesSchema as EventSchemaPropertiesShape,
	};
};
