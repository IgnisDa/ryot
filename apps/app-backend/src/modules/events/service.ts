import { type AppSchema, resolveRequiredString } from "@ryot/ts-utils";
import { z } from "zod";
import { resolveCustomEntitySchemaAccess } from "~/lib/app/entity-schema-access";
import { parseAppSchemaProperties } from "~/lib/app/schema-validation";
import {
	createEventForUser,
	getEntityScopeForUser,
	getEventCreateScopeForUser,
	listEventsByEntityForUser,
} from "./repository";
import type { CreateEventBody, ListedEvent } from "./schemas";

export type EventPropertiesShape = Record<string, unknown>;

export const occurredAtStringSchema = z.string().trim().pipe(z.iso.datetime());

type EntityEventScope = {
	entityId: string;
	isBuiltin: boolean;
	entitySchemaId: string;
};

export type EventCreateScope = EntityEventScope & {
	eventSchemaId: string | null;
	eventSchemaName: string | null;
	eventSchemaSlug: string | null;
	propertiesSchema: AppSchema | null;
	eventSchemaEntitySchemaId: string | null;
};

type EntityEventAccess =
	| { error: "builtin" | "not_found" }
	| { access: EntityEventScope };

type EventCreateAccess =
	| {
			error:
				| "builtin"
				| "not_found"
				| "event_schema_mismatch"
				| "event_schema_not_found";
	  }
	| {
			access: {
				entityId: string;
				eventSchemaId: string;
				entitySchemaId: string;
				eventSchemaName: string;
				eventSchemaSlug: string;
				propertiesSchema: AppSchema;
			};
	  };

type EventMutationError = "not_found" | "validation";

export type EventServiceDeps = {
	createEventForUser: typeof createEventForUser;
	getEntityScopeForUser: typeof getEntityScopeForUser;
	listEventsByEntityForUser: typeof listEventsByEntityForUser;
	getEventCreateScopeForUser: typeof getEventCreateScopeForUser;
};

export type EventServiceResult<T> =
	| { data: T }
	| { error: EventMutationError; message: string };

const customEntitySchemaError =
	"Built-in entity schemas do not support generated event logging";
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

const createDataResult = <T>(data: T): EventServiceResult<T> => ({ data });

const createErrorResult = <T>(input: {
	error: EventMutationError;
	message: string;
}): EventServiceResult<T> => ({
	error: input.error,
	message: input.message,
});

const resolveEventEntityIdResult = (
	entityId: string,
): EventServiceResult<string> => {
	try {
		return createDataResult(resolveEventEntityId(entityId));
	} catch (error) {
		const message =
			error instanceof Error ? error.message : "Entity id is required";
		return createErrorResult({ error: "validation", message });
	}
};

const resolveEventSchemaIdResult = (
	eventSchemaId: string,
): EventServiceResult<string> => {
	try {
		return createDataResult(resolveEventSchemaId(eventSchemaId));
	} catch (error) {
		const message =
			error instanceof Error ? error.message : "Event schema id is required";
		return createErrorResult({ error: "validation", message });
	}
};

export const resolveEventEntityId = (entityId: string) =>
	resolveRequiredString(entityId, "Entity id");

export const resolveEventSchemaId = (eventSchemaId: string) =>
	resolveRequiredString(eventSchemaId, "Event schema id");

export const resolveOccurredAt = (occurredAt: unknown) => {
	const parsedOccurredAt = occurredAtStringSchema.safeParse(occurredAt);
	if (!parsedOccurredAt.success) {
		throw new Error("Occurred at must be a valid datetime");
	}

	return new Date(parsedOccurredAt.data);
};

export const parseEventProperties = (input: {
	properties: unknown;
	propertiesSchema: AppSchema;
}) =>
	parseAppSchemaProperties({
		kind: "Event",
		properties: input.properties,
		propertiesSchema: input.propertiesSchema,
	}) as EventPropertiesShape;

export const resolveEntityEventAccess = (
	scope: EntityEventScope | undefined,
): EntityEventAccess => {
	const entityAccess = resolveCustomEntitySchemaAccess(scope);
	if (!("entitySchema" in entityAccess)) {
		return { error: entityAccess.error };
	}

	return { access: entityAccess.entitySchema };
};

export const resolveEventCreateAccess = (
	scope: EventCreateScope | undefined,
): EventCreateAccess => {
	const entityAccess = resolveEntityEventAccess(scope);
	if ("error" in entityAccess) {
		return entityAccess;
	}

	const scopedEvent = scope;

	if (
		!scopedEvent?.eventSchemaId ||
		!scopedEvent.eventSchemaName ||
		!scopedEvent.eventSchemaSlug ||
		!scopedEvent.propertiesSchema
	) {
		return { error: "event_schema_not_found" as const };
	}

	if (scopedEvent.eventSchemaEntitySchemaId !== scopedEvent.entitySchemaId) {
		return { error: "event_schema_mismatch" as const };
	}

	return {
		access: {
			entityId: scopedEvent.entityId,
			eventSchemaId: scopedEvent.eventSchemaId,
			entitySchemaId: scopedEvent.entitySchemaId,
			eventSchemaName: scopedEvent.eventSchemaName,
			eventSchemaSlug: scopedEvent.eventSchemaSlug,
			propertiesSchema: scopedEvent.propertiesSchema,
		},
	};
};

export const resolveEventCreateInput = (
	input: CreateEventBody & { propertiesSchema: AppSchema },
) => {
	const entityId = resolveEventEntityId(input.entityId);
	const occurredAt = resolveOccurredAt(input.occurredAt);
	const eventSchemaId = resolveEventSchemaId(input.eventSchemaId);
	const properties = parseEventProperties({
		properties: input.properties,
		propertiesSchema: input.propertiesSchema,
	});

	return { entityId, occurredAt, properties, eventSchemaId };
};

const resolveEventCreateInputResult = (
	input: CreateEventBody & { propertiesSchema: AppSchema },
): EventServiceResult<ReturnType<typeof resolveEventCreateInput>> => {
	try {
		return createDataResult(resolveEventCreateInput(input));
	} catch (error) {
		const message =
			error instanceof Error ? error.message : "Event payload is invalid";
		return createErrorResult({ error: "validation", message });
	}
};

const resolveCreateAccessMessage = (
	error:
		| "builtin"
		| "not_found"
		| "event_schema_not_found"
		| "event_schema_mismatch",
): { error: EventMutationError; message: string } => {
	if (error === "not_found") {
		return { error: "not_found", message: entityNotFoundError };
	}
	if (error === "builtin") {
		return { error: "validation", message: customEntitySchemaError };
	}
	if (error === "event_schema_not_found") {
		return { error: "not_found", message: eventSchemaNotFoundError };
	}

	return { error: "validation", message: eventSchemaMismatchError };
};

export const listEntityEvents = async (
	input: { entityId: string; userId: string },
	deps: EventServiceDeps = eventServiceDeps,
): Promise<EventServiceResult<ListedEvent[]>> => {
	const entityIdResult = resolveEventEntityIdResult(input.entityId);
	if ("error" in entityIdResult) {
		return entityIdResult;
	}

	const foundEntity = resolveEntityEventAccess(
		await deps.getEntityScopeForUser({
			userId: input.userId,
			entityId: entityIdResult.data,
		}),
	);
	if ("error" in foundEntity) {
		return createErrorResult(resolveCreateAccessMessage(foundEntity.error));
	}

	const events = await deps.listEventsByEntityForUser({
		userId: input.userId,
		entityId: entityIdResult.data,
	});

	return createDataResult(events);
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

	const foundScope = resolveEventCreateAccess(
		await deps.getEventCreateScopeForUser({
			userId: input.userId,
			entityId: entityIdResult.data,
			eventSchemaId: eventSchemaIdResult.data,
		}),
	);
	if ("error" in foundScope) {
		return createErrorResult(resolveCreateAccessMessage(foundScope.error));
	}

	const eventInput = resolveEventCreateInputResult({
		entityId: input.body.entityId,
		occurredAt: input.body.occurredAt,
		properties: input.body.properties,
		eventSchemaId: input.body.eventSchemaId,
		propertiesSchema: foundScope.access.propertiesSchema,
	});
	if ("error" in eventInput) {
		return eventInput;
	}

	const createdEvent = await deps.createEventForUser({
		userId: input.userId,
		entityId: eventInput.data.entityId,
		occurredAt: eventInput.data.occurredAt,
		properties: eventInput.data.properties,
		eventSchemaId: eventInput.data.eventSchemaId,
		eventSchemaName: foundScope.access.eventSchemaName,
		eventSchemaSlug: foundScope.access.eventSchemaSlug,
	});

	return createDataResult(createdEvent);
};
