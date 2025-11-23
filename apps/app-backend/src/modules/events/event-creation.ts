import { WorkflowEngine } from "@effect/workflow/WorkflowEngine";
import type { BadRequest, DbError, NotFound } from "@ryot/contract/errors";
import { badRequest, notFound, unknownToMessage } from "@ryot/contract/errors";
import { BeforeTriggerResult } from "@ryot/contract/modules/events/schemas";
import type {
	CreateEventItem,
	EventCreateOrigin,
	ListedEvent,
} from "@ryot/contract/modules/events/schemas";
import { EntityId, EventId, EventSchemaId } from "@ryot/contract/schema/brands";
import type {
	EntitySchemaId,
	ImportRunId,
	IntegrationId,
	UserId,
} from "@ryot/contract/schema/brands";
import { DateTime, Effect, Option, Schema } from "effect";

import { DbRunner } from "#lib/db/service";
import { parseAppSchemaProperties } from "#lib/schema/property-schema-runtime";
import { requireText } from "#lib/validation";
import { EntitiesRepository } from "#modules/entities/repository";
import { EventSchemasRepository } from "#modules/event-schemas/repository";
import { RunSandboxWorkflow } from "#modules/sandbox/workflow-definitions";

import {
	EventsRepository,
	type AfterCreateTriggerRow,
	type BeforeCreateTriggerRow,
} from "./repository";

const entityNotFoundError = "Entity not found";
const eventSchemaNotFoundError = "Event schema not found";
const sessionEntityNotFoundError = "Session entity not found";
const invalidOccurredAtError = "occurredAt must be a valid date";
const eventSchemaMismatchError = "Event schema does not belong to the entity schema";

const decodeBeforeTriggerResult = Schema.decodeUnknown(BeforeTriggerResult);

export type CreatedEventWithContext = ListedEvent & {
	readonly entitySchemaId: EntitySchemaId;
	readonly entitySchemaSlug: string;
};

type EventValidationError = BadRequest | DbError | NotFound;

type ValidateEventEffect = Effect.Effect<
	void,
	EventValidationError,
	DbRunner | EntitiesRepository | EventSchemasRepository
>;

const resolveOccurredAt = (occurredAt?: string): Effect.Effect<Date, BadRequest> => {
	if (!occurredAt) {
		return DateTime.nowAsDate;
	}

	const parsed = DateTime.make(occurredAt);
	if (Option.isNone(parsed)) {
		return badRequest(invalidOccurredAtError);
	}

	return Effect.succeed(DateTime.toDate(parsed.value));
};

const requireReadableEntity = Effect.fn(function* (
	userId: UserId,
	entityId: EntityId,
	notFoundMessage: string,
) {
	const runWithDb = yield* DbRunner;
	const entitiesRepository = yield* EntitiesRepository;
	const scope = yield* runWithDb(entitiesRepository.getEntityScopeForUser({ userId, entityId }));
	if (!scope) {
		return yield* notFound(notFoundMessage);
	}

	return scope;
});

const resolveEventCreateItemScopes = Effect.fn("resolveEventCreateItemScopes")(function* (input: {
	readonly item: CreateEventItem;
	readonly userId: UserId;
}) {
	const runWithDb = yield* DbRunner;
	const eventSchemasRepository = yield* EventSchemasRepository;
	const entityId = EntityId.make(yield* requireText(input.item.entityId, "Entity id is required"));
	const eventSchemaId = EventSchemaId.make(
		yield* requireText(input.item.eventSchemaId, "Event schema id is required"),
	);

	const entityScope = yield* requireReadableEntity(input.userId, entityId, entityNotFoundError);
	const eventSchemaScope = yield* runWithDb(
		eventSchemasRepository.getScopeForUser({ userId: input.userId, eventSchemaId }),
	);
	if (!eventSchemaScope) {
		return yield* notFound(eventSchemaNotFoundError);
	}

	if (eventSchemaScope.entitySchemaId !== entityScope.entitySchemaId) {
		return yield* badRequest(eventSchemaMismatchError);
	}

	let sessionEntityId: EntityId | undefined;
	if (input.item.sessionEntityId) {
		const sessionScope = yield* requireReadableEntity(
			input.userId,
			input.item.sessionEntityId,
			sessionEntityNotFoundError,
		);
		sessionEntityId = sessionScope.entityId;
	}

	const occurredAt = yield* resolveOccurredAt(input.item.occurredAt);

	return { entityId, eventSchemaId, entityScope, eventSchemaScope, sessionEntityId, occurredAt };
});

const validateEventCreateItem = Effect.fn("validateEventCreateItem")(function* (input: {
	readonly item: CreateEventItem;
	readonly userId: UserId;
}) {
	const { eventSchemaScope } = yield* resolveEventCreateItemScopes(input);
	yield* parseAppSchemaProperties({
		kind: "Event",
		properties: input.item.properties,
		propertiesSchema: eventSchemaScope.propertiesSchema,
	}).pipe(Effect.mapError((error) => badRequest(error.message)));

	return yield* Effect.void;
});

const runBeforeCreateTrigger = Effect.fn(function* (
	userId: UserId,
	trigger: BeforeCreateTriggerRow,
	context: unknown,
	executionId: string,
) {
	const workflowEngine = yield* WorkflowEngine;

	const result = yield* workflowEngine
		.execute(RunSandboxWorkflow, {
			executionId,
			payload: {
				userId,
				context,
				executionId,
				driverName: "trigger",
				scriptId: trigger.sandboxScriptId,
			},
		})
		.pipe(
			Effect.mapError((error) => badRequest(`Before trigger failed: ${unknownToMessage(error)}`)),
		);

	if (result.error) {
		return yield* badRequest(`Before trigger failed: ${result.error}`);
	}

	return yield* decodeBeforeTriggerResult(result.value).pipe(
		Effect.mapError(() => badRequest("Before trigger returned invalid shape")),
	);
});

const dispatchAfterCreateTriggers = Effect.fn("dispatchAfterCreateTriggers")(function* (
	userId: UserId,
	createdEvents: CreatedEventWithContext[],
	triggers: AfterCreateTriggerRow[],
) {
	const workflowEngine = yield* WorkflowEngine;
	const pairs = createdEvents.flatMap((event) => {
		const matching = triggers.filter((trigger) => trigger.eventSchemaId === event.eventSchemaId);
		return matching.map((trigger) => ({ event, trigger }));
	});

	yield* Effect.forEach(
		pairs,
		({ event, trigger }) => {
			const inheritedKeys = trigger.metadata.inheritedProperties ?? [];
			const inheritedProperties = Object.fromEntries(
				inheritedKeys
					.filter((key) => key in event.properties)
					.map((key) => [key, event.properties[key]]),
			);

			const executionId = `event-schema-trigger-${trigger.id}-${event.id}`;
			return workflowEngine
				.execute(RunSandboxWorkflow, {
					executionId,
					discard: true,
					payload: {
						userId,
						executionId,
						driverName: "trigger",
						scriptId: trigger.sandboxScriptId,
						context: {
							trigger: {
								eventId: event.id,
								inheritedProperties,
								entityId: event.entityId,
								createdAt: event.createdAt,
								updatedAt: event.updatedAt,
								occurredAt: event.occurredAt,
								properties: event.properties,
								eventSchemaId: event.eventSchemaId,
								entitySchemaId: event.entitySchemaId,
								eventSchemaSlug: event.eventSchemaSlug,
								entitySchemaSlug: event.entitySchemaSlug,
							},
						},
					},
				})
				.pipe(
					Effect.catchAll((error) =>
						Effect.logWarning(
							`Failed to dispatch after-create trigger: ${unknownToMessage(error)}`,
						),
					),
				);
		},
		{ discard: true },
	);
});

export const validateEventCreateSubmission = (input: {
	readonly userId: UserId;
	readonly payload: ReadonlyArray<CreateEventItem>;
}): ValidateEventEffect =>
	Effect.forEach(input.payload, (item) => validateEventCreateItem({ item, userId: input.userId }), {
		discard: true,
	});

export const createEventsForUser = Effect.fn("createEventsForUser")(function* (input: {
	readonly userId: UserId;
	readonly executionId: string;
	readonly origin: EventCreateOrigin;
	readonly importRunId?: ImportRunId;
	readonly integrationId?: IntegrationId;
	readonly payload: ReadonlyArray<CreateEventItem>;
}) {
	const runWithDb = yield* DbRunner;
	const eventsRepository = yield* EventsRepository;
	const createdEvents: CreatedEventWithContext[] = [];
	const referencedGlobalEntityIds = new Set<EntityId>();
	const { userId, origin, payload, executionId, importRunId, integrationId } = input;

	for (const [itemIndex, item] of payload.entries()) {
		const { entityScope, eventSchemaScope, sessionEntityId, occurredAt } =
			yield* resolveEventCreateItemScopes({ item, userId });

		let rawOccurredAt = occurredAt;
		let rawProperties: unknown = item.properties;
		let rawSessionEntityId = sessionEntityId;

		const beforeTriggers = yield* runWithDb(
			eventsRepository.getActiveBeforeCreateTriggers({
				userId,
				eventSchemaIds: [eventSchemaScope.id],
			}),
		);

		let skipped = false;
		for (const trigger of beforeTriggers) {
			const triggerContext = {
				trigger: {
					userId,
					origin,
					phase: "before_create",
					properties: rawProperties,
					entityId: entityScope.entityId,
					eventSchemaId: eventSchemaScope.id,
					sessionEntityId: rawSessionEntityId,
					eventSchemaSlug: eventSchemaScope.slug,
					occurredAt: rawOccurredAt.toISOString(),
					...(importRunId ? { importRunId } : {}),
					entitySchemaId: entityScope.entitySchemaId,
					...(integrationId ? { integrationId } : {}),
					entitySchemaSlug: entityScope.entitySchemaSlug,
				},
			};

			const triggerResult = yield* runBeforeCreateTrigger(
				userId,
				trigger,
				triggerContext,
				`${executionId}-before-${itemIndex}-${trigger.id}`,
			);

			if (triggerResult.action === "skip") {
				skipped = true;
				break;
			}

			if (triggerResult.action === "replace") {
				if (triggerResult.body.properties !== undefined) {
					rawProperties = triggerResult.body.properties;
				}
				if (triggerResult.body.occurredAt !== undefined) {
					const replaced = DateTime.make(triggerResult.body.occurredAt);
					if (Option.isSome(replaced)) {
						rawOccurredAt = DateTime.toDate(replaced.value);
					}
				}
				if (triggerResult.body.sessionEntityId !== undefined) {
					rawSessionEntityId = triggerResult.body.sessionEntityId ?? undefined;
				}
			}
		}

		if (skipped) {
			continue;
		}

		const properties = yield* parseAppSchemaProperties({
			kind: "Event",
			properties: rawProperties,
			propertiesSchema: eventSchemaScope.propertiesSchema,
		}).pipe(Effect.mapError((error) => badRequest(error.message)));

		const createdEvent = yield* runWithDb(
			eventsRepository.createEvent({
				userId,
				properties,
				occurredAt: rawOccurredAt,
				entityId: entityScope.entityId,
				eventSchemaId: eventSchemaScope.id,
				sessionEntityId: rawSessionEntityId,
				eventSchemaName: eventSchemaScope.name,
				eventSchemaSlug: eventSchemaScope.slug,
				id: EventId.make(`${executionId}-event-${itemIndex}`),
			}),
		);

		if (entityScope.entityUserId === null) {
			referencedGlobalEntityIds.add(entityScope.entityId);
		}

		createdEvents.push({
			...createdEvent,
			entitySchemaId: entityScope.entitySchemaId,
			entitySchemaSlug: entityScope.entitySchemaSlug,
		});
	}

	if (createdEvents.length > 0) {
		const uniqueSchemaIds = [...new Set(createdEvents.map((event) => event.eventSchemaId))];
		const afterTriggers = yield* runWithDb(
			eventsRepository.getActiveAfterCreateTriggers({
				userId,
				eventSchemaIds: uniqueSchemaIds,
			}),
		);

		if (afterTriggers.length > 0) {
			yield* dispatchAfterCreateTriggers(userId, createdEvents, afterTriggers);
		}
	}

	return {
		count: createdEvents.length,
		referencedGlobalEntityIds: [...referencedGlobalEntityIds],
	};
});
