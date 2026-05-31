import { WorkflowEngine } from "@effect/workflow/WorkflowEngine";
import { generateId } from "better-auth";
import { DateTime, Effect, Option, Schema } from "effect";

import { DbRunner } from "#lib/db";
import type { BadRequest, DbError, NotFound, SandboxRunError, TimeoutError } from "#lib/errors";
import { badRequest, notFound, unknownToMessage } from "#lib/errors";
import type { SandboxRunInput, SandboxRunOutput } from "#lib/sandbox/service";
import { EntityId, EventSchemaId } from "#lib/schema/brands";
import type { EntitySchemaId, ImportRunId, IntegrationId, UserId } from "#lib/schema/brands";
import { parseAppSchemaProperties } from "#lib/schema/property-schema-runtime";
import { requireText } from "#lib/validation";
import { EntitiesRepository } from "#modules/entities/repository";
import { EventSchemasRepository } from "#modules/event-schemas/repository";
import { SandboxRepository } from "#modules/sandbox/repository";
import { RunSandboxWorkflow } from "#modules/sandbox/workflow-definitions";

import {
	EventsRepository,
	type AfterCreateTriggerRow,
	type BeforeCreateTriggerRow,
} from "./repository";
import { BeforeTriggerResult } from "./schemas";
import type { CreateEventItem, EventCreateOrigin, ListedEvent } from "./schemas";

const entityNotFoundError = "Entity not found";
const eventSchemaNotFoundError = "Event schema not found";
const sessionEntityNotFoundError = "Session entity not found";
const invalidOccurredAtError = "occurredAt must be a valid date";
const eventSchemaMismatchError = "Event schema does not belong to the entity schema";

const decodeBeforeTriggerResult = Schema.decodeUnknown(BeforeTriggerResult);
export type RunSandboxScript = (
	input: SandboxRunInput,
) => Effect.Effect<SandboxRunOutput, SandboxRunError | TimeoutError>;

export type CreatedEventWithContext = ListedEvent & {
	readonly entitySchemaId: EntitySchemaId;
	readonly entitySchemaSlug: string;
};

type CreateEventsCoreServices = {
	readonly dbRunner: DbRunner["Type"];
	readonly eventsRepository: EventsRepository;
	readonly sandboxRepository: SandboxRepository;
	readonly workflowEngine: WorkflowEngine["Type"];
	readonly entitiesRepository: EntitiesRepository;
	readonly eventSchemasRepository: EventSchemasRepository;
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

const validateEventCreateItem = (input: {
	readonly item: CreateEventItem;
	readonly userId: UserId;
}): ValidateEventEffect =>
	Effect.gen(function* () {
		const runWithDb = yield* DbRunner;
		const eventSchemasRepository = yield* EventSchemasRepository;
		const entityId = EntityId.make(
			yield* requireText(input.item.entityId, "Entity id is required"),
		);
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

		if (input.item.sessionEntityId) {
			yield* requireReadableEntity(
				input.userId,
				input.item.sessionEntityId,
				sessionEntityNotFoundError,
			);
		}

		yield* resolveOccurredAt(input.item.occurredAt);
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
	runSandboxScript: RunSandboxScript,
) {
	const runWithDb = yield* DbRunner;
	const sandboxRepository = yield* SandboxRepository;
	const script = yield* runWithDb(
		sandboxRepository.getScriptForUser({ userId, scriptId: trigger.sandboxScriptId }),
	);
	if (!script) {
		return yield* badRequest("Before trigger script not found");
	}

	const result = yield* runSandboxScript({
		userId,
		context,
		code: script.code,
		scriptId: script.id,
		driverName: "trigger",
		executionId: generateId(),
		scriptIsBuiltin: script.isBuiltin,
		allowedHostFunctions: script.metadata.allowedHostFunctions ?? [],
	}).pipe(Effect.mapError((error) => badRequest(`Before trigger failed: ${error.message}`)));

	if (!result.success) {
		return yield* badRequest(`Before trigger failed: ${result.error ?? "Execution failed"}`);
	}

	return yield* decodeBeforeTriggerResult(result.value).pipe(
		Effect.mapError(() => badRequest("Before trigger returned invalid shape")),
	);
});

const dispatchAfterCreateTriggers = (
	userId: UserId,
	createdEvents: CreatedEventWithContext[],
	triggers: AfterCreateTriggerRow[],
) =>
	Effect.gen(function* () {
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

export const provideCreateEventsContext = <A, E, R>(
	effect: Effect.Effect<A, E, R>,
	services: CreateEventsCoreServices,
) =>
	effect.pipe(
		Effect.provideService(DbRunner, services.dbRunner),
		Effect.provideService(WorkflowEngine, services.workflowEngine),
		Effect.provideService(EventsRepository, services.eventsRepository),
		Effect.provideService(SandboxRepository, services.sandboxRepository),
		Effect.provideService(EntitiesRepository, services.entitiesRepository),
		Effect.provideService(EventSchemasRepository, services.eventSchemasRepository),
	);

export const validateEventCreateSubmission = (input: {
	readonly userId: UserId;
	readonly payload: ReadonlyArray<CreateEventItem>;
}): ValidateEventEffect =>
	Effect.forEach(input.payload, (item) => validateEventCreateItem({ item, userId: input.userId }), {
		discard: true,
	});

export const createEventsForUser = Effect.fn("createEventsForUser")(function* (
	input: {
		readonly userId: UserId;
		readonly importRunId?: ImportRunId;
		readonly integrationId?: IntegrationId;
		readonly origin: EventCreateOrigin;
		readonly payload: ReadonlyArray<CreateEventItem>;
	},
	runSandboxScript: RunSandboxScript,
) {
	const runWithDb = yield* DbRunner;
	const eventsRepository = yield* EventsRepository;
	const createdEvents: CreatedEventWithContext[] = [];
	const referencedGlobalEntityIds = new Set<EntityId>();
	const eventSchemasRepository = yield* EventSchemasRepository;
	const { userId, origin, payload, importRunId, integrationId } = input;

	for (const item of payload) {
		const entityId = EntityId.make(yield* requireText(item.entityId, "Entity id is required"));
		const eventSchemaId = EventSchemaId.make(
			yield* requireText(item.eventSchemaId, "Event schema id is required"),
		);

		const entityScope = yield* requireReadableEntity(userId, entityId, entityNotFoundError);

		const eventSchemaScope = yield* runWithDb(
			eventSchemasRepository.getScopeForUser({ userId, eventSchemaId }),
		);
		if (!eventSchemaScope) {
			return yield* notFound(eventSchemaNotFoundError);
		}

		if (eventSchemaScope.entitySchemaId !== entityScope.entitySchemaId) {
			return yield* badRequest(eventSchemaMismatchError);
		}

		let sessionEntityId: EntityId | undefined;
		if (item.sessionEntityId) {
			const sessionScope = yield* requireReadableEntity(
				userId,
				item.sessionEntityId,
				sessionEntityNotFoundError,
			);
			sessionEntityId = sessionScope.entityId;
		}

		let rawOccurredAt = yield* resolveOccurredAt(item.occurredAt);
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
				runSandboxScript,
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
