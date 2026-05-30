import { and, desc, eq, inArray, isNull, or } from "drizzle-orm";

import { assertPersisted, db, type DbClient } from "~/lib/db";
import {
	entity,
	entityAccessScopeWithSchemaJoinSelection,
	entitySchema,
	event,
	eventSchema,
	eventSchemaTrigger,
} from "~/lib/db/schema";

import type { EventPropertiesShape } from "./service";

const listedEventSelection = {
	id: event.id,
	entityId: event.entityId,
	createdAt: event.createdAt,
	updatedAt: event.updatedAt,
	occurredAt: event.occurredAt,
	properties: event.properties,
	eventSchemaName: eventSchema.name,
	eventSchemaSlug: eventSchema.slug,
	eventSchemaId: event.eventSchemaId,
	sessionEntityId: event.sessionEntityId,
};

const createdEventSelection = {
	id: event.id,
	entityId: event.entityId,
	createdAt: event.createdAt,
	updatedAt: event.updatedAt,
	occurredAt: event.occurredAt,
	properties: event.properties,
	eventSchemaId: event.eventSchemaId,
	sessionEntityId: event.sessionEntityId,
};

const eventSchemaVisibleToUserClause = (userId: string) => {
	return or(isNull(eventSchema.userId), eq(eventSchema.userId, userId));
};

export const getEntityScopeForUser = async (input: { userId: string; entityId: string }) => {
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
			and(eq(eventSchema.id, input.eventSchemaId), eventSchemaVisibleToUserClause(input.userId)),
		)
		.where(
			and(
				eq(entity.id, input.entityId),
				or(isNull(entity.userId), eq(entity.userId, input.userId)),
			),
		)
		.limit(1);

	return foundScope;
};

export const listEventsByEntityForUser = async (input: {
	userId: string;
	entityId?: string;
	sessionEntityId?: string;
	eventSchemaSlug?: string;
}) => {
	const whereClauses = [eq(event.userId, input.userId)];
	if (input.entityId) {
		whereClauses.push(eq(event.entityId, input.entityId));
	}
	if (input.sessionEntityId) {
		whereClauses.push(eq(event.sessionEntityId, input.sessionEntityId));
	}

	const rows = await db
		.select(listedEventSelection)
		.from(event)
		.innerJoin(eventSchema, eq(event.eventSchemaId, eventSchema.id))
		.where(
			and(
				...whereClauses,
				input.eventSchemaSlug ? eq(eventSchema.slug, input.eventSchemaSlug) : undefined,
			),
		)
		.orderBy(desc(event.occurredAt), desc(event.createdAt), desc(event.id));

	return rows;
};

export const getEventSchemaForEntityBySlug = async (input: {
	userId: string;
	entityId: string;
	eventSchemaSlug: string;
}) => {
	const [found] = await db
		.select({
			entityUserId: entity.userId,
			eventSchemaId: eventSchema.id,
			entitySchemaId: entitySchema.id,
			eventSchemaName: eventSchema.name,
			entitySchemaSlug: entitySchema.slug,
			propertiesSchema: eventSchema.propertiesSchema,
			eventSchemaEntitySchemaId: eventSchema.entitySchemaId,
		})
		.from(entity)
		.innerJoin(entitySchema, eq(entity.entitySchemaId, entitySchema.id))
		.innerJoin(
			eventSchema,
			and(
				eq(eventSchema.entitySchemaId, entitySchema.id),
				eq(eventSchema.slug, input.eventSchemaSlug),
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

	return found;
};

export const createEventForUser = async (
	input: {
		userId: string;
		entityId: string;
		occurredAt: Date;
		eventSchemaId: string;
		eventSchemaName: string;
		eventSchemaSlug: string;
		sessionEntityId?: string;
		properties: EventPropertiesShape;
	},
	database: DbClient = db,
) => {
	const [createdEvent] = await database
		.insert(event)
		.values({
			userId: input.userId,
			entityId: input.entityId,
			properties: input.properties,
			occurredAt: input.occurredAt,
			eventSchemaId: input.eventSchemaId,
			sessionEntityId: input.sessionEntityId ?? null,
		})
		.returning(createdEventSelection);

	return {
		...assertPersisted(createdEvent, "event"),
		eventSchemaName: input.eventSchemaName,
		eventSchemaSlug: input.eventSchemaSlug,
	};
};

export type ActiveEventSchemaTriggerRow = {
	id: string;
	eventSchemaId: string;
	sandboxScriptId: string;
	metadata: (typeof eventSchemaTrigger.$inferSelect)["metadata"];
};

export type ActiveBeforeCreateTriggerRow = {
	id: string;
	position: number;
	eventSchemaId: string;
	sandboxScriptId: string;
};

export const getActiveEventSchemaTriggersForEventSchemas = async (input: {
	userId: string;
	eventSchemaIds: string[];
}): Promise<ActiveEventSchemaTriggerRow[]> => {
	if (input.eventSchemaIds.length === 0) {
		return [];
	}

	return db
		.select({
			id: eventSchemaTrigger.id,
			metadata: eventSchemaTrigger.metadata,
			eventSchemaId: eventSchemaTrigger.eventSchemaId,
			sandboxScriptId: eventSchemaTrigger.sandboxScriptId,
		})
		.from(eventSchemaTrigger)
		.where(
			and(
				inArray(eventSchemaTrigger.eventSchemaId, input.eventSchemaIds),
				eq(eventSchemaTrigger.isActive, true),
				eq(eventSchemaTrigger.phase, "after_create"),
				or(isNull(eventSchemaTrigger.userId), eq(eventSchemaTrigger.userId, input.userId)),
			),
		);
};

export const getActiveBeforeCreateTriggersForEventSchemas = async (input: {
	userId: string;
	eventSchemaIds: string[];
}): Promise<ActiveBeforeCreateTriggerRow[]> => {
	if (input.eventSchemaIds.length === 0) {
		return [];
	}

	return db
		.select({
			id: eventSchemaTrigger.id,
			position: eventSchemaTrigger.position,
			eventSchemaId: eventSchemaTrigger.eventSchemaId,
			sandboxScriptId: eventSchemaTrigger.sandboxScriptId,
		})
		.from(eventSchemaTrigger)
		.where(
			and(
				inArray(eventSchemaTrigger.eventSchemaId, input.eventSchemaIds),
				eq(eventSchemaTrigger.isActive, true),
				eq(eventSchemaTrigger.phase, "before_create"),
				or(isNull(eventSchemaTrigger.userId), eq(eventSchemaTrigger.userId, input.userId)),
			),
		)
		.orderBy(eventSchemaTrigger.position);
};
