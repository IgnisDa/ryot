import { and, asc, eq, isNull, or } from "drizzle-orm";
import { db } from "~/lib/db";
import {
	entitySchema,
	entitySchemaAccessScopeSelection,
	eventSchema,
} from "~/lib/db/schema";
import type { ListedEventSchema } from "./schemas";
import type { EventSchemaPropertiesShape } from "./service";

type EventSchemaRow = Omit<ListedEventSchema, "propertiesSchema"> & {
	propertiesSchema: unknown;
};

const listedEventSchemaSelection = {
	id: eventSchema.id,
	name: eventSchema.name,
	slug: eventSchema.slug,
	entitySchemaId: eventSchema.entitySchemaId,
	propertiesSchema: eventSchema.propertiesSchema,
};

const toListedEventSchema = (row: EventSchemaRow): ListedEventSchema => ({
	...row,
	propertiesSchema: row.propertiesSchema as EventSchemaPropertiesShape,
});

const entitySchemaVisibleToUserClause = (userId: string) => {
	return or(isNull(entitySchema.userId), eq(entitySchema.userId, userId));
};

export const getEntitySchemaScopeForUser = async (input: {
	userId: string;
	entitySchemaId: string;
}) => {
	const [foundEntitySchema] = await db
		.select(entitySchemaAccessScopeSelection)
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
		.select(listedEventSchemaSelection)
		.from(eventSchema)
		.where(
			and(
				or(isNull(eventSchema.userId), eq(eventSchema.userId, input.userId)),
				eq(eventSchema.entitySchemaId, input.entitySchemaId),
			),
		)
		.orderBy(asc(eventSchema.name), asc(eventSchema.createdAt));

	return rows.map(toListedEventSchema);
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
		.returning(listedEventSchemaSelection);

	if (!createdEventSchema) {
		throw new Error("Could not persist event schema");
	}

	return toListedEventSchema(createdEventSchema);
};
