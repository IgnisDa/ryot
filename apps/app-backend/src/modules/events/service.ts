import { type AppSchema, chunk, resolveRequiredString } from "@ryot/ts-utils";
import { checkReadAccess } from "~/lib/access";
import { parseAppSchemaProperties } from "~/lib/app/schema-validation";
import { getQueues } from "~/lib/queue";
import {
	type ServiceResult,
	serviceData,
	serviceError,
	wrapServiceValidator,
} from "~/lib/result";
import { sandboxRunJobName } from "~/lib/sandbox/jobs";
import {
	getUserLibraryEntityId,
	upsertInLibraryIfGlobal,
	upsertInLibraryRelationship,
} from "~/modules/entities";
import {
	createEventForUser,
	getActiveEventSchemaTriggersForEventSchemas,
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

export type CreatedEventData = ListedEvent & {
	entitySchemaId: string;
	entitySchemaSlug: string;
};

type EventMutationError = "not_found" | "validation";

export type EventServiceDeps = {
	createEventForUser: typeof createEventForUser;
	getEntityScopeForUser: typeof getEntityScopeForUser;
	getUserLibraryEntityId: typeof getUserLibraryEntityId;
	getSessionEntityScopeForUser: typeof getEntityScopeForUser;
	listEventsByEntityForUser: typeof listEventsByEntityForUser;
	getEventCreateScopeForUser: typeof getEventCreateScopeForUser;
	upsertInLibraryRelationship: typeof upsertInLibraryRelationship;
	enqueueEventSchemaTriggerJob: typeof enqueueEventSchemaTriggerJob;
	getActiveEventSchemaTriggersForEventSchemas: typeof getActiveEventSchemaTriggersForEventSchemas;
};

export type EventServiceResult<T> = ServiceResult<T, EventMutationError>;

const entityNotFoundError = "Entity not found";
const eventSchemaNotFoundError = "Event schema not found";
const eventSchemaMismatchError =
	"Event schema does not belong to the entity schema";
const sessionEntityNotFoundError = "Session entity not found";

const enqueueEventSchemaTriggerJob = async (input: {
	jobId: string;
	userId: string;
	scriptId: string;
	context: {
		trigger: {
			eventId: string;
			entityId: string;
			eventSchemaId: string;
			entitySchemaId: string;
			entitySchemaSlug: string;
			eventSchemaSlug: string;
			properties: Record<string, unknown>;
		};
	};
}) => {
	await getQueues().sandboxQueue.add(
		sandboxRunJobName,
		{
			userId: input.userId,
			driverName: "trigger",
			context: input.context,
			scriptId: input.scriptId,
		},
		{
			attempts: 3,
			jobId: input.jobId,
			backoff: { type: "exponential", delay: 5000 },
		},
	);
};

const eventServiceDeps: EventServiceDeps = {
	createEventForUser,
	getEntityScopeForUser,
	getUserLibraryEntityId,
	listEventsByEntityForUser,
	getEventCreateScopeForUser,
	upsertInLibraryRelationship,
	enqueueEventSchemaTriggerJob,
	getActiveEventSchemaTriggersForEventSchemas,
	getSessionEntityScopeForUser: getEntityScopeForUser,
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

const resolveSessionEntityIdResult = (sessionEntityId: string) =>
	wrapServiceValidator(
		() => resolveSessionEntityId(sessionEntityId),
		"Session entity id is required",
	);

export const resolveEventEntityId = (entityId: string) =>
	resolveRequiredString(entityId, "Entity id");

export const resolveEventSchemaId = (eventSchemaId: string) =>
	resolveRequiredString(eventSchemaId, "Event schema id");

export const resolveSessionEntityId = (sessionEntityId: string) =>
	resolveRequiredString(sessionEntityId, "Session entity id");

const resolveReadableSessionEntityId = async (
	input: { userId: string; sessionEntityId: string },
	deps: Pick<EventServiceDeps, "getSessionEntityScopeForUser">,
): Promise<EventServiceResult<string>> => {
	const sessionEntityIdResult = resolveSessionEntityIdResult(
		input.sessionEntityId,
	);
	if ("error" in sessionEntityIdResult) {
		return sessionEntityIdResult;
	}

	const sessionEntityResult = checkReadAccess(
		await deps.getSessionEntityScopeForUser({
			userId: input.userId,
			entityId: sessionEntityIdResult.data,
		}),
		{ not_found: sessionEntityNotFoundError },
	);
	if ("error" in sessionEntityResult) {
		return serviceError("not_found", sessionEntityResult.message);
	}

	return serviceData(sessionEntityIdResult.data);
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

export const resolveEventCreateInput = (
	input: CreateEventBody & {
		propertiesSchema: AppSchema;
	},
) => {
	const entityId = resolveEventEntityId(input.entityId);
	const eventSchemaId = resolveEventSchemaId(input.eventSchemaId);
	const sessionEntityId = input.sessionEntityId
		? resolveSessionEntityId(input.sessionEntityId)
		: undefined;
	const parsedProperties = parseEventProperties({
		properties: input.properties,
		propertiesSchema: input.propertiesSchema,
	});

	return {
		entityId,
		eventSchemaId,
		sessionEntityId,
		properties: parsedProperties,
	};
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
	input: {
		userId: string;
		entityId?: string;
		sessionEntityId?: string;
		eventSchemaSlug?: string;
	},
	deps: EventServiceDeps = eventServiceDeps,
): Promise<EventServiceResult<ListedEvent[]>> => {
	if (input.entityId) {
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

		if (input.sessionEntityId) {
			const sessionEntityIdResult = await resolveReadableSessionEntityId(
				{ userId: input.userId, sessionEntityId: input.sessionEntityId },
				deps,
			);
			if ("error" in sessionEntityIdResult) {
				return sessionEntityIdResult;
			}

			const events = await deps.listEventsByEntityForUser({
				userId: input.userId,
				eventSchemaSlug: input.eventSchemaSlug,
				entityId: entityIdResult.data,
				sessionEntityId: sessionEntityIdResult.data,
			});

			return serviceData(events);
		}

		const events = await deps.listEventsByEntityForUser({
			userId: input.userId,
			entityId: entityIdResult.data,
			eventSchemaSlug: input.eventSchemaSlug,
		});

		return serviceData(events);
	}

	if (input.sessionEntityId) {
		const sessionEntityIdResult = await resolveReadableSessionEntityId(
			{ userId: input.userId, sessionEntityId: input.sessionEntityId },
			deps,
		);
		if ("error" in sessionEntityIdResult) {
			return sessionEntityIdResult;
		}

		const events = await deps.listEventsByEntityForUser({
			userId: input.userId,
			eventSchemaSlug: input.eventSchemaSlug,
			sessionEntityId: sessionEntityIdResult.data,
		});

		return serviceData(events);
	}

	return serviceError(
		"validation",
		"Either entityId or sessionEntityId is required",
	);
};

export const createEvent = async (
	input: { body: CreateEventBody; userId: string },
	deps: EventServiceDeps = eventServiceDeps,
): Promise<EventServiceResult<CreatedEventData>> => {
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

	let sessionEntityId: string | undefined;
	if (input.body.sessionEntityId) {
		const sessionEntityIdResult = await resolveReadableSessionEntityId(
			{ userId: input.userId, sessionEntityId: input.body.sessionEntityId },
			deps,
		);
		if ("error" in sessionEntityIdResult) {
			return sessionEntityIdResult;
		}

		sessionEntityId = sessionEntityIdResult.data;
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
		sessionEntityId,
		eventSchemaId: input.body.eventSchemaId,
		propertiesSchema: eventScope.propertiesSchema,
	});
	if ("error" in eventInput) {
		return eventInput;
	}

	const libraryError = await upsertInLibraryIfGlobal(
		{
			userId: input.userId,
			entityId: eventScope.entityId,
			entityUserId: eventScope.entityUserId,
		},
		deps,
	);
	if (libraryError) {
		return libraryError;
	}

	const createdEvent = await deps.createEventForUser({
		userId: input.userId,
		entityId: eventInput.data.entityId,
		properties: eventInput.data.properties,
		eventSchemaName: eventScope.eventSchemaName,
		eventSchemaSlug: eventScope.eventSchemaSlug,
		eventSchemaId: eventInput.data.eventSchemaId,
		sessionEntityId: eventInput.data.sessionEntityId,
	});

	return serviceData({
		...createdEvent,
		entitySchemaId: eventScope.entitySchemaId,
		entitySchemaSlug: eventScope.entitySchemaSlug,
	});
};

const BULK_CHUNK_SIZE = 1000;

export const createEvents = async (
	input: { body: CreateEventBulkBody; userId: string },
	deps: EventServiceDeps = eventServiceDeps,
): Promise<
	EventServiceResult<{ count: number; createdEvents: CreatedEventData[] }>
> => {
	const chunks = chunk(input.body, BULK_CHUNK_SIZE);
	const createdEvents: CreatedEventData[] = [];

	for (const chunk of chunks) {
		for (const item of chunk) {
			const result = await createEvent(
				{ body: item, userId: input.userId },
				deps,
			);
			if ("error" in result) {
				return result;
			}
			createdEvents.push(result.data);
		}
	}

	return serviceData({ count: createdEvents.length, createdEvents });
};

export const processEventSchemaTriggers = async (
	input: {
		userId: string;
		createdEvents: CreatedEventData[];
	},
	deps: EventServiceDeps = eventServiceDeps,
): Promise<void> => {
	if (input.createdEvents.length === 0) {
		return;
	}

	const uniqueSchemaIds = [
		...new Set(input.createdEvents.map((event) => event.eventSchemaId)),
	];

	let triggers: Awaited<
		ReturnType<typeof getActiveEventSchemaTriggersForEventSchemas>
	>;
	try {
		triggers = await deps.getActiveEventSchemaTriggersForEventSchemas({
			userId: input.userId,
			eventSchemaIds: uniqueSchemaIds,
		});
	} catch (error) {
		console.warn("processEventSchemaTriggers: failed to query triggers", error);
		return;
	}

	if (triggers.length === 0) {
		return;
	}

	for (const createdEvent of input.createdEvents) {
		const matchingTriggers = triggers.filter(
			(trigger) => trigger.eventSchemaId === createdEvent.eventSchemaId,
		);

		for (const trigger of matchingTriggers) {
			const jobId = `event-schema-trigger-${trigger.id}-${createdEvent.id}`;
			const context = {
				trigger: {
					eventId: createdEvent.id,
					entityId: createdEvent.entityId,
					properties: createdEvent.properties,
					eventSchemaId: createdEvent.eventSchemaId,
					entitySchemaId: createdEvent.entitySchemaId,
					eventSchemaSlug: createdEvent.eventSchemaSlug,
					entitySchemaSlug: createdEvent.entitySchemaSlug,
				},
			};

			try {
				await deps.enqueueEventSchemaTriggerJob({
					jobId,
					context,
					userId: input.userId,
					scriptId: trigger.sandboxScriptId,
				});
			} catch (error) {
				console.warn(
					`processEventSchemaTriggers: failed to enqueue trigger ${trigger.id} for event ${createdEvent.id}`,
					error,
				);
			}
		}
	}
};
