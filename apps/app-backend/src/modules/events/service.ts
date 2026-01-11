import { type AppSchema, chunk, resolveRequiredString } from "@ryot/ts-utils";
import { checkReadAccess } from "~/lib/access";
import { parseAppSchemaProperties } from "~/lib/app/schema-validation";
import {
	type ServiceResult,
	serviceData,
	serviceError,
	wrapServiceValidator,
} from "~/lib/result";
import {
	createEventForUser,
	getEntityScopeForUser,
	getEventCreateScopeForUser,
	listEventsByEntityForUser,
} from "./repository";
import type {
	CreateEventBody,
	CreateEventBulkBody,
	ListedEvent,
} from "./schemas";

export type EventPropertiesShape = Record<string, unknown>;

type EventMutationError = "not_found" | "validation";

export type EventServiceDeps = {
	createEventForUser: typeof createEventForUser;
	getEntityScopeForUser: typeof getEntityScopeForUser;
	listEventsByEntityForUser: typeof listEventsByEntityForUser;
	getEventCreateScopeForUser: typeof getEventCreateScopeForUser;
};

export type EventServiceResult<T> = ServiceResult<T, EventMutationError>;

const entityNotFoundError = "Entity not found";
const eventSchemaNotFoundError = "Event schema not found";
const eventSchemaMismatchError =
	"Event schema does not belong to the entity schema";

const eventServiceDeps: EventServiceDeps = {
	createEventForUser,
	getEntityScopeForUser,
	getEventCreateScopeForUser,
	listEventsByEntityForUser,
};

const resolveEventEntityIdResult = (entityId: string) =>
	wrapServiceValidator(
		() => resolveEventEntityId(entityId),
		"Entity id is required",
	);

const resolveEventSchemaIdResult = (eventSchemaId: string) =>
	wrapServiceValidator(
		() => resolveEventSchemaId(eventSchemaId),
		"Event schema id is required",
	);

export const resolveEventEntityId = (entityId: string) =>
	resolveRequiredString(entityId, "Entity id");

export const resolveEventSchemaId = (eventSchemaId: string) =>
	resolveRequiredString(eventSchemaId, "Event schema id");

export const parseEventProperties = (input: {
	properties: unknown;
	propertiesSchema: AppSchema;
}) =>
	parseAppSchemaProperties({
		kind: "Event",
		properties: input.properties,
		propertiesSchema: input.propertiesSchema,
	}) as EventPropertiesShape;

export const resolveEventCreateInput = (
	input: CreateEventBody & {
		propertiesSchema: AppSchema;
	},
) => {
	const entityId = resolveEventEntityId(input.entityId);
	const eventSchemaId = resolveEventSchemaId(input.eventSchemaId);
	const parsedProperties = parseEventProperties({
		properties: input.properties,
		propertiesSchema: input.propertiesSchema,
	});

	return { entityId, properties: parsedProperties, eventSchemaId };
};

const resolveEventCreateInputResult = (
	input: CreateEventBody & {
		propertiesSchema: AppSchema;
	},
) =>
	wrapServiceValidator(
		() => resolveEventCreateInput(input),
		"Event payload is invalid",
	);

export const listEntityEvents = async (
	input: { entityId: string; userId: string },
	deps: EventServiceDeps = eventServiceDeps,
): Promise<EventServiceResult<ListedEvent[]>> => {
	const entityIdResult = resolveEventEntityIdResult(input.entityId);
	if ("error" in entityIdResult) {
		return entityIdResult;
	}

	const entityResult = checkReadAccess(
		await deps.getEntityScopeForUser({
			userId: input.userId,
			entityId: entityIdResult.data,
		}),
		{ not_found: entityNotFoundError },
	);
	if ("error" in entityResult) {
		return serviceError("not_found", entityResult.message);
	}

	const events = await deps.listEventsByEntityForUser({
		userId: input.userId,
		entityId: entityIdResult.data,
	});

	return serviceData(events);
};

export const createEvent = async (
	input: { body: CreateEventBody; userId: string },
	deps: EventServiceDeps = eventServiceDeps,
): Promise<EventServiceResult<ListedEvent>> => {
	const entityIdResult = resolveEventEntityIdResult(input.body.entityId);
	if ("error" in entityIdResult) {
		return entityIdResult;
	}

	const eventSchemaIdResult = resolveEventSchemaIdResult(
		input.body.eventSchemaId,
	);
	if ("error" in eventSchemaIdResult) {
		return eventSchemaIdResult;
	}

	const eventScope = await deps.getEventCreateScopeForUser({
		userId: input.userId,
		entityId: entityIdResult.data,
		eventSchemaId: eventSchemaIdResult.data,
	});

	// scope === undefined means the entity itself was not found (INNER JOIN anchor)
	if (!eventScope) {
		return serviceError("not_found", entityNotFoundError);
	}

	// eventSchemaId is null when the LEFT JOIN missed — event schema not found or not visible.
	// When the join succeeds, the DB NOT NULL constraints on the event_schema table guarantee
	// that name, slug, propertiesSchema, and eventSchemaEntitySchemaId are also non-null.
	if (
		!eventScope.eventSchemaId ||
		!eventScope.eventSchemaName ||
		!eventScope.eventSchemaSlug ||
		!eventScope.propertiesSchema ||
		!eventScope.eventSchemaEntitySchemaId
	) {
		return serviceError("not_found", eventSchemaNotFoundError);
	}

	if (eventScope.eventSchemaEntitySchemaId !== eventScope.entitySchemaId) {
		return serviceError("validation", eventSchemaMismatchError);
	}

	const eventInput = resolveEventCreateInputResult({
		entityId: input.body.entityId,
		properties: input.body.properties,
		eventSchemaId: input.body.eventSchemaId,
		propertiesSchema: eventScope.propertiesSchema,
	});
	if ("error" in eventInput) {
		return eventInput;
	}

	const createdEvent = await deps.createEventForUser({
		userId: input.userId,
		entityId: eventInput.data.entityId,
		properties: eventInput.data.properties,
		eventSchemaName: eventScope.eventSchemaName,
		eventSchemaSlug: eventScope.eventSchemaSlug,
		eventSchemaId: eventInput.data.eventSchemaId,
	});

	return serviceData(createdEvent);
};

const BULK_CHUNK_SIZE = 1000;

export const createEvents = async (
	input: { body: CreateEventBulkBody; userId: string },
	deps: EventServiceDeps = eventServiceDeps,
): Promise<EventServiceResult<{ count: number }>> => {
	const chunks = chunk(input.body, BULK_CHUNK_SIZE);
	let count = 0;

	for (const chunk of chunks) {
		for (const item of chunk) {
			const result = await createEvent(
				{ body: item, userId: input.userId },
				deps,
			);
			if ("error" in result) {
				return result;
			}
			count++;
		}
	}

	return serviceData({ count });
};
