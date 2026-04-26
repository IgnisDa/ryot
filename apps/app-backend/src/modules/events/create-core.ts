import type { WorkflowEngine } from "@effect/workflow/WorkflowEngine";
import { generateId } from "better-auth";
import { DateTime, Effect, Option, Schema } from "effect";

import type { DbRunner } from "~/lib/db";
import type { BadRequest, DbError, NotFound, SandboxRunError, TimeoutError } from "~/lib/errors";
import { badRequest, notFound, unknownToMessage } from "~/lib/errors";
import { parseAppSchemaProperties } from "~/lib/property-schema-runtime";
import type { SandboxRunInput, SandboxRunOutput } from "~/lib/sandbox";
import { requireText } from "~/lib/validation";
import type { EntitiesRepository } from "~/modules/entities/repository";
import type { EventSchemasRepository } from "~/modules/event-schemas/repository";
import type { SandboxRepository } from "~/modules/sandbox/repository";
import { RunSandboxWorkflow } from "~/modules/sandbox/workflow-definitions";

import type { AfterCreateTriggerRow, BeforeCreateTriggerRow, EventsRepository } from "./repository";
import { BeforeTriggerResult } from "./schemas";
import type { CreateEventItem, ListedEvent } from "./schemas";

const entityNotFoundError = "Entity not found";
const eventSchemaNotFoundError = "Event schema not found";
const sessionEntityNotFoundError = "Session entity not found";
const invalidOccurredAtError = "occurredAt must be a valid date";
const eventSchemaMismatchError = "Event schema does not belong to the entity schema";

const decodeBeforeTriggerResult = Schema.decodeUnknown(BeforeTriggerResult);

export type EventCreateOrigin = "api" | "sandbox" | "import" | "integration";

export type CreatedEventWithContext = ListedEvent & {
	readonly entitySchemaId: string;
	readonly entitySchemaSlug: string;
};

export type CreateEventsCoreDependencies = {
	readonly runWithDb: DbRunner["Type"];
	readonly eventsRepository: EventsRepository;
	readonly sandboxRepository: SandboxRepository;
	readonly workflowEngine: WorkflowEngine["Type"];
	readonly entitiesRepository: EntitiesRepository;
	readonly eventSchemasRepository: EventSchemasRepository;
	readonly runSandboxScript: (
		input: SandboxRunInput,
	) => Effect.Effect<SandboxRunOutput, SandboxRunError | TimeoutError>;
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

const requireReadableEntity = (
	deps: CreateEventsCoreDependencies,
	userId: string,
	entityId: string,
	notFoundMessage: string,
) =>
	Effect.gen(function* () {
		const scope = yield* deps.runWithDb(
			deps.entitiesRepository.getEntityScopeForUser({ userId, entityId }),
		);
		if (!scope) {
			return yield* notFound(notFoundMessage);
		}

		return scope;
	});

const runBeforeCreateTrigger = (
	deps: CreateEventsCoreDependencies,
	userId: string,
	trigger: BeforeCreateTriggerRow,
	context: unknown,
) =>
	Effect.gen(function* () {
		const script = yield* deps.runWithDb(
			deps.sandboxRepository.getScriptForUser({ userId, scriptId: trigger.sandboxScriptId }),
		);
		if (!script) {
			return yield* badRequest("Before trigger script not found");
		}

		const result = yield* deps
			.runSandboxScript({
				userId,
				context,
				code: script.code,
				scriptId: script.id,
				driverName: "trigger",
				executionId: generateId(),
				allowedHostFunctions: script.metadata.allowedHostFunctions ?? [],
			})
			.pipe(Effect.mapError((error) => badRequest(`Before trigger failed: ${error.message}`)));

		if (!result.success) {
			return yield* badRequest(`Before trigger failed: ${result.error ?? "Execution failed"}`);
		}

		return yield* decodeBeforeTriggerResult(result.value).pipe(
			Effect.mapError(() => badRequest("Before trigger returned invalid shape")),
		);
	});

const dispatchAfterCreateTriggers = (
	deps: CreateEventsCoreDependencies,
	userId: string,
	createdEvents: CreatedEventWithContext[],
	triggers: AfterCreateTriggerRow[],
) =>
	Effect.gen(function* () {
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
				return deps.workflowEngine
					.execute(RunSandboxWorkflow, {
						executionId,
						discard: true,
						payload: {
							executionId,
							userId,
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

export const createEventsForUser = (
	deps: CreateEventsCoreDependencies,
	input: {
		readonly userId: string;
		readonly origin: EventCreateOrigin;
		readonly payload: ReadonlyArray<CreateEventItem>;
	},
): Effect.Effect<{ count: number }, BadRequest | NotFound | DbError> =>
	Effect.gen(function* () {
		const { userId, origin, payload } = input;
		const createdEvents: CreatedEventWithContext[] = [];

		for (const item of payload) {
			const entityId = yield* requireText(item.entityId, "Entity id is required");
			const eventSchemaId = yield* requireText(item.eventSchemaId, "Event schema id is required");

			const entityScope = yield* requireReadableEntity(deps, userId, entityId, entityNotFoundError);

			const eventSchemaScope = yield* deps.runWithDb(
				deps.eventSchemasRepository.getScopeForUser({ userId, eventSchemaId }),
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
					deps,
					userId,
					item.sessionEntityId,
					sessionEntityNotFoundError,
				);
				sessionEntityId = sessionScope.entityId;
			}

			let rawOccurredAt = yield* resolveOccurredAt(item.occurredAt);
			let rawProperties: unknown = item.properties;
			let rawSessionEntityId = sessionEntityId;

			const beforeTriggers = yield* deps.runWithDb(
				deps.eventsRepository.getActiveBeforeCreateTriggers({
					userId,
					eventSchemaIds: [eventSchemaScope.id],
				}),
			);

			let skipped = false;
			for (const trigger of beforeTriggers) {
				// TODO(Task 26/27): (effect-migration) when "import"/"integration" origins are wired, thread the legacy
				// EventWriteContext fields (importRunId, integrationId) into this trigger context —
				// the integration-progress-policy script reads `trigger.integrationId`.
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
						entitySchemaId: entityScope.entitySchemaId,
						entitySchemaSlug: entityScope.entitySchemaSlug,
					},
				};

				const triggerResult = yield* runBeforeCreateTrigger(deps, userId, trigger, triggerContext);

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

			const createdEvent = yield* deps.runWithDb(
				deps.eventsRepository.createEvent({
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

			createdEvents.push({
				...createdEvent,
				entitySchemaId: entityScope.entitySchemaId,
				entitySchemaSlug: entityScope.entitySchemaSlug,
			});
		}

		if (createdEvents.length > 0) {
			const uniqueSchemaIds = [...new Set(createdEvents.map((event) => event.eventSchemaId))];
			const afterTriggers = yield* deps.runWithDb(
				deps.eventsRepository.getActiveAfterCreateTriggers({
					userId,
					eventSchemaIds: uniqueSchemaIds,
				}),
			);

			if (afterTriggers.length > 0) {
				yield* dispatchAfterCreateTriggers(deps, userId, createdEvents, afterTriggers);
			}
		}

		return { count: createdEvents.length };
	});
