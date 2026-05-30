import { z } from "@hono/zod-openapi";
import type { AppSchema } from "@ryot/ts-utils/app-schema";
import { dayjs } from "@ryot/ts-utils/dayjs";
import { extractErrorMessage } from "@ryot/ts-utils/error";
import { resolveRequiredString } from "@ryot/ts-utils/slug";
import { QueueEvents } from "bullmq";

import { checkReadAccess } from "~/lib/access";
import { parseAppSchemaProperties } from "~/lib/app/schema-validation";
import { getQueues } from "~/lib/queue";
import { getRedisConnection } from "~/lib/queue/connection";
import { type ServiceResult, serviceData, serviceError, wrapServiceValidator } from "~/lib/result";
import { defaultTimeoutMs } from "~/lib/sandbox/constants";
import type { QueuedRunResult } from "~/lib/sandbox/jobs";
import { sandboxRunJobName } from "~/lib/sandbox/jobs";
import { ensureEntityInLibrary } from "~/modules/entities";

import {
	createEventForUser,
	getActiveBeforeCreateTriggersForEventSchemas,
	getActiveEventSchemaTriggersForEventSchemas,
	getEntityScopeForUser,
	getEventCreateScopeForUser,
	listEventsByEntityForUser,
} from "./repository";
import type { CreateEventBody, CreateEventBulkBody, ListedEvent } from "./schemas";

export type EventPropertiesShape = Record<string, unknown>;

export type EventWriteContext = {
	importRunId?: string;
	integrationId?: string;
	origin: "api" | "import" | "integration" | "sandbox";
};

export type CreatedEventData = ListedEvent & {
	entitySchemaId: string;
	entitySchemaSlug: string;
};

type EventMutationError = "not_found" | "validation";

export type CreateEventsBestEffortFailure = {
	message: string;
	itemIndex: number;
	error: EventMutationError;
};

export type CreateEventsBestEffortSkipped = {
	reason: string;
	entityId: string;
	itemIndex: number;
	eventSchemaSlug: string;
};

export type CreateEventsBestEffortData = {
	count: number;
	createdEvents: CreatedEventData[];
	skipped: CreateEventsBestEffortSkipped[];
	failures: CreateEventsBestEffortFailure[];
};

export type EventCreateSkipResult = {
	skipped: true;
	reason: string;
	entityId: string;
	eventSchemaSlug: string;
};

const beforeTriggerResultSchema = z.discriminatedUnion("action", [
	z.object({ action: z.literal("allow") }),
	z.object({ action: z.literal("skip"), reason: z.string() }),
	z.object({
		action: z.literal("replace"),
		body: z.object({
			occurredAt: z.string().optional(),
			sessionEntityId: z.string().nullish(),
			properties: z.record(z.string(), z.unknown()).optional(),
		}),
	}),
]);

type BeforeTriggerResult = z.infer<typeof beforeTriggerResultSchema>;

type RunBeforeCreateTriggerInput = {
	userId: string;
	scriptId: string;
	context: {
		trigger: {
			origin: string;
			userId: string;
			entityId: string;
			occurredAt: string;
			importRunId?: string;
			eventSchemaId: string;
			phase: "before_create";
			integrationId?: string;
			entitySchemaId: string;
			eventSchemaSlug: string;
			entitySchemaSlug: string;
			sessionEntityId?: string;
			properties: Record<string, unknown>;
		};
	};
};

type RunBeforeCreateTriggerOutput =
	| { outcome: "error"; error: string }
	| { outcome: "result"; result: BeforeTriggerResult };

export type EventServiceDeps = {
	createEventForUser: typeof createEventForUser;
	getEntityScopeForUser: typeof getEntityScopeForUser;
	ensureEntityInLibrary: typeof ensureEntityInLibrary;
	getSessionEntityScopeForUser: typeof getEntityScopeForUser;
	listEventsByEntityForUser: typeof listEventsByEntityForUser;
	getEventCreateScopeForUser: typeof getEventCreateScopeForUser;
	enqueueEventSchemaTriggerJob: typeof enqueueEventSchemaTriggerJob;
	getActiveEventSchemaTriggersForEventSchemas: typeof getActiveEventSchemaTriggersForEventSchemas;
	getActiveBeforeCreateTriggersForEventSchemas: typeof getActiveBeforeCreateTriggersForEventSchemas;
	runBeforeCreateTrigger: (
		input: RunBeforeCreateTriggerInput,
	) => Promise<RunBeforeCreateTriggerOutput>;
};

export type EventServiceResult<T> = ServiceResult<T, EventMutationError>;

const entityNotFoundError = "Entity not found";
const eventSchemaNotFoundError = "Event schema not found";
const eventSchemaMismatchError = "Event schema does not belong to the entity schema";
const sessionEntityNotFoundError = "Session entity not found";

export const resolveOccurredAt = (input: { occurredAt?: string }): Date => {
	if (input.occurredAt) {
		return dayjs(input.occurredAt).toDate();
	}
	return dayjs().toDate();
};

const enqueueEventSchemaTriggerJob = async (input: {
	jobId: string;
	userId: string;
	scriptId: string;
	context: {
		trigger: {
			eventId: string;
			entityId: string;
			createdAt: string;
			updatedAt: string;
			occurredAt: string;
			eventSchemaId: string;
			entitySchemaId: string;
			eventSchemaSlug: string;
			entitySchemaSlug: string;
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

const runBeforeCreateTrigger = async (
	input: RunBeforeCreateTriggerInput,
): Promise<RunBeforeCreateTriggerOutput> => {
	const { sandboxQueue } = getQueues();

	const job = await sandboxQueue.add(
		sandboxRunJobName,
		{
			userId: input.userId,
			driverName: "trigger",
			context: input.context,
			scriptId: input.scriptId,
		},
		{ attempts: 1 },
	);

	const queueEvents = new QueueEvents("sandbox", { connection: getRedisConnection() });

	try {
		// oxlint-disable-next-line no-unsafe-type-assertion
		const returnValue = (await job.waitUntilFinished(queueEvents, defaultTimeoutMs)) as
			| QueuedRunResult
			| undefined;

		if (!returnValue?.success) {
			return { outcome: "error", error: returnValue?.error ?? "Before trigger execution failed" };
		}

		const parsed = beforeTriggerResultSchema.safeParse(returnValue.value);
		if (!parsed.success) {
			return { outcome: "error", error: "Before trigger returned invalid shape" };
		}

		return { outcome: "result", result: parsed.data };
	} catch (error) {
		return { outcome: "error", error: extractErrorMessage(error, "Before trigger failed") };
	} finally {
		await queueEvents.close();
	}
};

const eventServiceDeps: EventServiceDeps = {
	createEventForUser,
	ensureEntityInLibrary,
	getEntityScopeForUser,
	runBeforeCreateTrigger,
	listEventsByEntityForUser,
	getEventCreateScopeForUser,
	enqueueEventSchemaTriggerJob,
	getActiveEventSchemaTriggersForEventSchemas,
	getActiveBeforeCreateTriggersForEventSchemas,
	getSessionEntityScopeForUser: getEntityScopeForUser,
};

const resolveEventEntityIdResult = (entityId: string) =>
	wrapServiceValidator(() => resolveEventEntityId(entityId), "Entity id is required");

const resolveEventSchemaIdResult = (eventSchemaId: string) =>
	wrapServiceValidator(() => resolveEventSchemaId(eventSchemaId), "Event schema id is required");

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
	const sessionEntityIdResult = resolveSessionEntityIdResult(input.sessionEntityId);
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

export const parseEventProperties = (input: { properties: unknown; propertiesSchema: AppSchema }) =>
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
) => wrapServiceValidator(() => resolveEventCreateInput(input), "Event payload is invalid");

export const validateEventCreateInputForUser = async (
	input: { body: CreateEventBody; userId: string },
	deps: EventServiceDeps = eventServiceDeps,
): Promise<EventServiceResult<void>> => {
	const entityIdResult = resolveEventEntityIdResult(input.body.entityId);
	if ("error" in entityIdResult) {
		return entityIdResult;
	}

	const eventSchemaIdResult = resolveEventSchemaIdResult(input.body.eventSchemaId);
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

	if (!eventScope) {
		return serviceError("not_found", entityNotFoundError);
	}

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
		sessionEntityId,
		entityId: input.body.entityId,
		properties: input.body.properties,
		eventSchemaId: input.body.eventSchemaId,
		propertiesSchema: eventScope.propertiesSchema,
	});
	if ("error" in eventInput) {
		return eventInput;
	}

	return serviceData(undefined);
};

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
				entityId: entityIdResult.data,
				eventSchemaSlug: input.eventSchemaSlug,
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

	return serviceError("validation", "Either entityId or sessionEntityId is required");
};

export const createEvent = async (
	input: { body: CreateEventBody; userId: string; writeContext?: EventWriteContext },
	deps: EventServiceDeps = eventServiceDeps,
): Promise<EventServiceResult<CreatedEventData> | EventCreateSkipResult> => {
	const entityIdResult = resolveEventEntityIdResult(input.body.entityId);
	if ("error" in entityIdResult) {
		return entityIdResult;
	}

	const eventSchemaIdResult = resolveEventSchemaIdResult(input.body.eventSchemaId);
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

	if (eventScope.entityUserId === null) {
		const libraryResult = await deps.ensureEntityInLibrary({
			userId: input.userId,
			entityId: eventScope.entityId,
		});
		if ("error" in libraryResult) {
			return libraryResult;
		}
	}

	const occurredAt = resolveOccurredAt({ occurredAt: input.body.occurredAt });
	const writeContext = input.writeContext ?? { origin: "api" };

	// Run before_create triggers in ascending position order before property validation.
	const beforeTriggers = await deps.getActiveBeforeCreateTriggersForEventSchemas({
		userId: input.userId,
		eventSchemaIds: [eventScope.eventSchemaId],
	});

	let rawOccurredAt: Date = occurredAt;
	let rawSessionEntityId: string | undefined = sessionEntityId;
	let rawProperties: Record<string, unknown> = input.body.properties;

	for (const trigger of beforeTriggers) {
		const triggerContext: RunBeforeCreateTriggerInput = {
			userId: input.userId,
			scriptId: trigger.sandboxScriptId,
			context: {
				trigger: {
					userId: input.userId,
					phase: "before_create",
					properties: rawProperties,
					origin: writeContext.origin,
					entityId: eventScope.entityId,
					sessionEntityId: rawSessionEntityId,
					importRunId: writeContext.importRunId,
					occurredAt: rawOccurredAt.toISOString(),
					eventSchemaId: eventScope.eventSchemaId,
					entitySchemaId: eventScope.entitySchemaId,
					integrationId: writeContext.integrationId,
					eventSchemaSlug: eventScope.eventSchemaSlug,
					entitySchemaSlug: eventScope.entitySchemaSlug,
				},
			},
		};

		// oxlint-disable-next-line no-await-in-loop
		const triggerOutput = await deps.runBeforeCreateTrigger(triggerContext);

		if (triggerOutput.outcome === "error") {
			return serviceError("validation", `Before trigger failed: ${triggerOutput.error}`);
		}

		const { result } = triggerOutput;

		if (result.action === "skip") {
			return {
				skipped: true,
				reason: result.reason,
				entityId: eventScope.entityId,
				eventSchemaSlug: eventScope.eventSchemaSlug,
			};
		}

		if (result.action === "replace") {
			if (result.body.properties !== undefined) {
				rawProperties = result.body.properties;
			}
			if (result.body.occurredAt !== undefined) {
				rawOccurredAt = dayjs(result.body.occurredAt).toDate();
			}
			if (result.body.sessionEntityId !== undefined) {
				rawSessionEntityId = result.body.sessionEntityId ?? undefined;
			}
		}
	}

	// Validate final (possibly replaced) event properties against the schema.
	const eventInput = resolveEventCreateInputResult({
		properties: rawProperties,
		entityId: input.body.entityId,
		sessionEntityId: rawSessionEntityId,
		eventSchemaId: input.body.eventSchemaId,
		propertiesSchema: eventScope.propertiesSchema,
	});
	if ("error" in eventInput) {
		return eventInput;
	}

	const createdEvent = await deps.createEventForUser({
		userId: input.userId,
		occurredAt: rawOccurredAt,
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

export const createEvents = async (
	input: { body: CreateEventBulkBody; userId: string; writeContext?: EventWriteContext },
	deps: EventServiceDeps = eventServiceDeps,
): Promise<EventServiceResult<{ count: number; createdEvents: CreatedEventData[] }>> => {
	for (const item of input.body) {
		// oxlint-disable-next-line no-await-in-loop
		const validationResult = await validateEventCreateInputForUser(
			{ body: item, userId: input.userId },
			deps,
		);
		if ("error" in validationResult) {
			return validationResult;
		}
	}

	const createdEvents: CreatedEventData[] = [];

	for (const item of input.body) {
		// oxlint-disable-next-line no-await-in-loop
		const result = await createEvent(
			{ body: item, userId: input.userId, writeContext: input.writeContext },
			deps,
		);
		if ("skipped" in result) {
			return serviceError("validation", `Event skipped by before-trigger: ${result.reason}`);
		}
		if ("error" in result) {
			return result;
		}
		createdEvents.push(result.data);
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

	const uniqueSchemaIds = [...new Set(input.createdEvents.map((event) => event.eventSchemaId))];

	let triggers: Awaited<ReturnType<typeof getActiveEventSchemaTriggersForEventSchemas>>;
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

	const enqueueJobs = input.createdEvents.flatMap((createdEvent) => {
		const matchingTriggers = triggers.filter(
			(trigger) => trigger.eventSchemaId === createdEvent.eventSchemaId,
		);

		return matchingTriggers.map(async (trigger) => {
			const jobId = `event-schema-trigger-${trigger.id}-${createdEvent.id}`;
			const inheritedKeys = trigger.metadata.inheritedProperties ?? [];
			const inheritedProperties = Object.fromEntries(
				inheritedKeys
					.filter((key) => key in createdEvent.properties)
					.map((key) => [key, createdEvent.properties[key]]),
			);
			const context = {
				trigger: {
					inheritedProperties,
					eventId: createdEvent.id,
					entityId: createdEvent.entityId,
					properties: createdEvent.properties,
					eventSchemaId: createdEvent.eventSchemaId,
					entitySchemaId: createdEvent.entitySchemaId,
					eventSchemaSlug: createdEvent.eventSchemaSlug,
					entitySchemaSlug: createdEvent.entitySchemaSlug,
					createdAt: createdEvent.createdAt.toISOString(),
					updatedAt: createdEvent.updatedAt.toISOString(),
					occurredAt: createdEvent.occurredAt.toISOString(),
				},
			};

			await deps.enqueueEventSchemaTriggerJob({
				jobId,
				context,
				userId: input.userId,
				scriptId: trigger.sandboxScriptId,
			});
		});
	});

	const results = await Promise.allSettled(enqueueJobs);
	for (const result of results) {
		if (result.status === "rejected") {
			console.warn("processEventSchemaTriggers: failed to enqueue trigger job", result.reason);
		}
	}
};

export const createEventsWithTriggers = async (
	input: { body: CreateEventBulkBody; userId: string; writeContext?: EventWriteContext },
	deps: EventServiceDeps = eventServiceDeps,
): Promise<EventServiceResult<{ count: number; createdEvents: CreatedEventData[] }>> => {
	const result = await createEvents(input, deps);
	if ("error" in result) {
		return result;
	}

	await processEventSchemaTriggers(
		{
			userId: input.userId,
			createdEvents: result.data.createdEvents,
		},
		deps,
	);

	return result;
};

export const createEventsBestEffortWithTriggers = async (
	input: { body: CreateEventBulkBody; userId: string; writeContext?: EventWriteContext },
	deps: EventServiceDeps = eventServiceDeps,
): Promise<{ data: CreateEventsBestEffortData }> => {
	const failures: CreateEventsBestEffortFailure[] = [];
	const createdEvents: CreatedEventData[] = [];
	const skipped: CreateEventsBestEffortSkipped[] = [];

	for (let itemIndex = 0; itemIndex < input.body.length; itemIndex++) {
		const item = input.body[itemIndex];
		if (!item) {
			continue;
		}

		// oxlint-disable-next-line no-await-in-loop
		const result = await createEvent(
			{ body: item, userId: input.userId, writeContext: input.writeContext },
			deps,
		);

		if ("skipped" in result) {
			skipped.push({
				itemIndex,
				reason: result.reason,
				entityId: result.entityId,
				eventSchemaSlug: result.eventSchemaSlug,
			});
		} else if ("error" in result) {
			failures.push({
				itemIndex,
				error: result.error,
				message: result.message,
			});
		} else {
			createdEvents.push(result.data);
		}
	}

	await processEventSchemaTriggers({ userId: input.userId, createdEvents }, deps);

	return serviceData({
		skipped,
		failures,
		createdEvents,
		count: createdEvents.length,
	});
};
