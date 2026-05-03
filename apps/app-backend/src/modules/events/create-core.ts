import { WorkflowEngine } from "@effect/workflow/WorkflowEngine";
import { generateId } from "better-auth";
import { DateTime, Effect, Option, Schema } from "effect";

import { DbRunner } from "#lib/db";
import type { BadRequest, DbError, NotFound, SandboxRunError, TimeoutError } from "#lib/errors";
import { badRequest, notFound, unknownToMessage } from "#lib/errors";
import { parseAppSchemaProperties } from "#lib/property-schema-runtime";
import type { SandboxRunInput, SandboxRunOutput } from "#lib/sandbox";
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
	readonly entitySchemaId: string;
	readonly entitySchemaSlug: string;
};

type CreateEventsCoreContext =
	| DbRunner
	| WorkflowEngine
	| EventsRepository
	| SandboxRepository
	| EntitiesRepository
	| EventSchemasRepository;

type CreateEventsCoreServices = {
	readonly dbRunner: DbRunner["Type"];
	readonly eventsRepository: EventsRepository;
	readonly sandboxRepository: SandboxRepository;
	readonly workflowEngine: WorkflowEngine["Type"];
	readonly entitiesRepository: EntitiesRepository;
	readonly eventSchemasRepository: EventSchemasRepository;
};

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

const requireReadableEntity = (userId: string, entityId: string, notFoundMessage: string) =>
	Effect.gen(function* () {
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
	readonly userId: string;
}): Effect.Effect<
	void,
	BadRequest | DbError | NotFound,
	DbRunner | EntitiesRepository | EventSchemasRepository
> =>
	Effect.gen(function* () {
		const runWithDb = yield* DbRunner;
		const eventSchemasRepository = yield* EventSchemasRepository;
		const entityId = yield* requireText(input.item.entityId, "Entity id is required");
		const eventSchemaId = yield* requireText(
			input.item.eventSchemaId,
			"Event schema id is required",
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

const runBeforeCreateTrigger = (
	userId: string,
	trigger: BeforeCreateTriggerRow,
	context: unknown,
	runSandboxScript: RunSandboxScript,
) =>
	Effect.gen(function* () {
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
	userId: string,
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

type OnGlobalEntityReferenced = (userId: string, entityId: string) => Effect.Effect<void, DbError>;

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
	readonly userId: string;
	readonly payload: ReadonlyArray<CreateEventItem>;
}): Effect.Effect<
	void,
	BadRequest | DbError | NotFound,
	DbRunner | EntitiesRepository | EventSchemasRepository
> =>
	Effect.forEach(input.payload, (item) => validateEventCreateItem({ item, userId: input.userId }), {
		discard: true,
	});

export const createEventsForUser = (
	input: {
		readonly userId: string;
		readonly importRunId?: string;
		readonly integrationId?: string;
		readonly origin: EventCreateOrigin;
		readonly payload: ReadonlyArray<CreateEventItem>;
	},
	runSandboxScript: RunSandboxScript,
	onGlobalEntityReferenced?: OnGlobalEntityReferenced,
): Effect.Effect<{ count: number }, BadRequest | NotFound | DbError, CreateEventsCoreContext> =>
	Effect.gen(function* () {
		const runWithDb = yield* DbRunner;
		const eventsRepository = yield* EventsRepository;
		const createdEvents: CreatedEventWithContext[] = [];
		const eventSchemasRepository = yield* EventSchemasRepository;
		const { userId, origin, payload, importRunId, integrationId } = input;

		for (const item of payload) {
			const entityId = yield* requireText(item.entityId, "Entity id is required");
			const eventSchemaId = yield* requireText(item.eventSchemaId, "Event schema id is required");

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

			let sessionEntityId: string | undefined;
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

			if (entityScope.entityUserId === null && onGlobalEntityReferenced) {
				yield* onGlobalEntityReferenced(userId, entityScope.entityId);
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

		return { count: createdEvents.length };
	});
