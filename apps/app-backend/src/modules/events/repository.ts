import type { AppSchema } from "@ryot/ts-utils";
import { and, desc, eq, isNull, or } from "drizzle-orm";
import { assertPersisted, db } from "~/lib/db";
import {
	entity,
	entityAccessScopeWithSchemaJoinSelection,
	entitySchema,
	event,
	eventSchema,
} from "~/lib/db/schema";
import type { ListedEvent } from "./schemas";
import type { EventPropertiesShape } from "./service";

type EventRow = Omit<ListedEvent, "properties"> & {
	properties: unknown;
};

const listedEventSelection = {
	id: event.id,
	entityId: event.entityId,
	createdAt: event.createdAt,
	updatedAt: event.updatedAt,
	properties: event.properties,
	eventSchemaName: eventSchema.name,
	eventSchemaSlug: eventSchema.slug,
	eventSchemaId: event.eventSchemaId,
};

const createdEventSelection = {
	id: event.id,
	entityId: event.entityId,
	createdAt: event.createdAt,
	updatedAt: event.updatedAt,
	properties: event.properties,
	eventSchemaId: event.eventSchemaId,
};

const toListedEvent = (row: EventRow): ListedEvent => ({
	...row,
	properties: row.properties as EventPropertiesShape,
});

const eventSchemaVisibleToUserClause = (userId: string) => {
	return or(isNull(eventSchema.userId), eq(eventSchema.userId, userId));
};

export const getEntityScopeForUser = async (input: {
	userId: string;
	entityId: string;
}) => {
	const [foundEntity] = await db
		.select(entityAccessScopeWithSchemaJoinSelection)
		.from(entity)
		.innerJoin(entitySchema, eq(entity.entitySchemaId, entitySchema.id))
		.where(
			and(
				eq(entity.id, input.entityId),
				or(isNull(entity.userId), eq(entity.userId, input.userId)),
			),
		)
		.limit(1);

	return foundEntity;
};

export const getEventCreateScopeForUser = async (input: {
	userId: string;
	entityId: string;
	eventSchemaId: string;
}) => {
	const [foundScope] = await db
		.select({
			entityId: entity.id,
			entityUserId: entity.userId,
			eventSchemaId: eventSchema.id,
			isBuiltin: entitySchema.isBuiltin,
			eventSchemaName: eventSchema.name,
			eventSchemaSlug: eventSchema.slug,
			entitySchemaSlug: entitySchema.slug,
			entitySchemaId: entity.entitySchemaId,
			propertiesSchema: eventSchema.propertiesSchema,
			eventSchemaEntitySchemaId: eventSchema.entitySchemaId,
		})
		.from(entity)
		.innerJoin(entitySchema, eq(entity.entitySchemaId, entitySchema.id))
		.leftJoin(
			eventSchema,
			and(
				eq(eventSchema.id, input.eventSchemaId),
				eventSchemaVisibleToUserClause(input.userId),
			),
		)
		.where(
			and(
				eq(entity.id, input.entityId),
				or(isNull(entity.userId), eq(entity.userId, input.userId)),
			),
		)
		.limit(1);

	return foundScope
		? {
				...foundScope,
				propertiesSchema: foundScope.propertiesSchema as AppSchema | null,
			}
		: foundScope;
};

export const listEventsByEntityForUser = async (input: {
	userId: string;
	entityId: string;
}) => {
	const rows = await db
		.select(listedEventSelection)
		.from(event)
		.innerJoin(eventSchema, eq(event.eventSchemaId, eventSchema.id))
		.where(
			and(eq(event.userId, input.userId), eq(event.entityId, input.entityId)),
		)
		.orderBy(desc(event.createdAt));

	return rows.map(toListedEvent);
};

export const createEventForUser = async (input: {
	userId: string;
	entityId: string;
	eventSchemaId: string;
	eventSchemaName: string;
	eventSchemaSlug: string;
	properties: EventPropertiesShape;
}) => {
	const [createdEvent] = await db
		.insert(event)
		.values({
			userId: input.userId,
			sessionEntityId: null,
			entityId: input.entityId,
			properties: input.properties,
			eventSchemaId: input.eventSchemaId,
		})
		.returning(createdEventSelection);

	return toListedEvent({
		...assertPersisted(createdEvent, "event"),
		eventSchemaName: input.eventSchemaName,
		eventSchemaSlug: input.eventSchemaSlug,
	});
};
