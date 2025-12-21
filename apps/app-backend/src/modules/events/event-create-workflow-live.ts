import * as PersistedQueue from "@effect/experimental/PersistedQueue";
import { Activity, DurableQueue } from "@effect/workflow";
import { WorkflowEngine } from "@effect/workflow/WorkflowEngine";
import type { WorkflowInstance } from "@effect/workflow/WorkflowEngine";
import type { DbError, SandboxRunError } from "@ryot/contract/errors";
import { badRequest, unknownToMessage } from "@ryot/contract/errors";
import type {
	SandboxCompletedResult,
	SandboxExecutionPayload,
} from "@ryot/contract/modules/sandbox/schemas";
import {
	EntityId,
	EntitySchemaId,
	EventId,
	EventSchemaId,
	SandboxScriptId,
} from "@ryot/contract/schema/brands";
import { AppSchema } from "@ryot/contract/schema/property-schema";
import { Context, DateTime, Effect, Layer, Option, Schema } from "effect";

import { DbRunner } from "#lib/infrastructure/db/service";
import { parseAppSchemaProperties } from "#lib/property-schema/property-schema-runtime";
import { SandboxExecutionQueue } from "#modules/sandbox/durable-queues";
import { RunSandboxWorkflow } from "#modules/sandbox/sandbox-run-workflow";

import { EnsureLibraryMembershipQueue } from "./durable-queues";
import {
	EventCreateWorkflow,
	EventCreateWorkflowError,
	type EventCreateWorkflowPayload,
} from "./event-create-workflow";
import {
	type CreatedEventWithContext,
	decodeBeforeTriggerResult,
	resolveEventCreateItemScopes,
} from "./event-creation";
import { EventsRepository } from "./repository";

const beforeTriggerFailed = (detail: string) => badRequest(`Before trigger failed: ${detail}`);
const invalidBeforeTriggerShape = "Before trigger returned invalid shape";

const PreparedBeforeTrigger = Schema.Struct({
	id: Schema.String,
	sandboxScriptId: SandboxScriptId,
});

const PreparedItem = Schema.Struct({
	entityId: EntityId,
	occurredAt: Schema.String,
	eventSchemaId: EventSchemaId,
	propertiesSchema: AppSchema,
	eventSchemaName: Schema.String,
	eventSchemaSlug: Schema.String,
	isGlobalEntity: Schema.Boolean,
	entitySchemaSlug: Schema.String,
	entitySchemaId: EntitySchemaId,
	sessionEntityId: Schema.optional(EntityId),
	beforeTriggers: Schema.Array(PreparedBeforeTrigger),
});

type PreparedItem = typeof PreparedItem.Type;

const CreatedEvent = Schema.Struct({
	id: EventId,
	entityId: EntityId,
	createdAt: Schema.String,
	updatedAt: Schema.String,
	occurredAt: Schema.String,
	eventSchemaId: EventSchemaId,
	eventSchemaName: Schema.String,
	eventSchemaSlug: Schema.String,
	isGlobalReference: Schema.Boolean,
	entitySchemaId: EntitySchemaId,
	entitySchemaSlug: Schema.String,
	sessionEntityId: Schema.optional(EntityId),
	properties: Schema.Record({ key: Schema.String, value: Schema.Unknown }),
});

type CreatedEvent = typeof CreatedEvent.Type;

const AfterCreateTrigger = Schema.Struct({
	id: Schema.String,
	eventSchemaId: EventSchemaId,
	sandboxScriptId: SandboxScriptId,
	metadata: Schema.Struct({ inheritedProperties: Schema.optional(Schema.Array(Schema.String)) }),
});

type EnsureLibraryMembershipInput = {
	userId: EventCreateWorkflowPayload["userId"];
	entityId: EntityId;
	executionId: string;
};

export type EventCreateWorkflowOperationsValue = {
	ensureLibraryMembership: (
		input: EnsureLibraryMembershipInput,
	) => Effect.Effect<void, DbError, WorkflowEngine | WorkflowInstance>;
	processSandboxExecution: (
		payload: SandboxExecutionPayload,
	) => Effect.Effect<SandboxCompletedResult, SandboxRunError, WorkflowEngine | WorkflowInstance>;
};

/**
 * DurableQueue.process must run inside the calling workflow's own execution
 * context, so these requirements are intentional pass-throughs.
 * @effect-expect-leaking WorkflowEngine WorkflowInstance
 */
export class EventCreateWorkflowOperations extends Context.Tag("EventCreateWorkflowOperations")<
	EventCreateWorkflowOperations,
	EventCreateWorkflowOperationsValue
>() {}

export const EventCreateWorkflowOperationsLive = Layer.effect(
	EventCreateWorkflowOperations,
	Effect.map(
		PersistedQueue.PersistedQueueFactory,
		(queueFactory) =>
			({
				ensureLibraryMembership: (input) =>
					DurableQueue.process(EnsureLibraryMembershipQueue, input).pipe(
						Effect.asVoid,
						Effect.provideService(PersistedQueue.PersistedQueueFactory, queueFactory),
					),
				processSandboxExecution: (payload) =>
					DurableQueue.process(SandboxExecutionQueue, payload).pipe(
						Effect.provideService(PersistedQueue.PersistedQueueFactory, queueFactory),
					),
			}) satisfies EventCreateWorkflowOperationsValue,
	),
);

const prepareItem = Effect.fn("prepareEventCreateItem")(function* (
	payload: EventCreateWorkflowPayload,
	itemIndex: number,
	item: EventCreateWorkflowPayload["payload"][number],
) {
	const runWithDb = yield* DbRunner;
	const eventsRepository = yield* EventsRepository;

	return yield* Activity.make({
		success: PreparedItem,
		name: `prepare-item-${itemIndex}`,
		error: EventCreateWorkflowError,
		execute: Effect.gen(function* () {
			const { entityId, entityScope, eventSchemaScope, sessionEntityId, occurredAt } =
				yield* resolveEventCreateItemScopes({ item, userId: payload.userId });

			const beforeTriggers = yield* runWithDb(
				eventsRepository.getActiveBeforeCreateTriggers({
					userId: payload.userId,
					eventSchemaIds: [eventSchemaScope.id],
				}),
			);

			return {
				entityId,
				eventSchemaId: eventSchemaScope.id,
				eventSchemaName: eventSchemaScope.name,
				eventSchemaSlug: eventSchemaScope.slug,
				occurredAt: occurredAt.toISOString(),
				propertiesSchema: eventSchemaScope.propertiesSchema,
				entitySchemaId: entityScope.entitySchemaId,
				entitySchemaSlug: entityScope.entitySchemaSlug,
				isGlobalEntity: entityScope.entityUserId === null,
				sessionEntityId,
				beforeTriggers: beforeTriggers.map((trigger) => ({
					id: trigger.id,
					sandboxScriptId: trigger.sandboxScriptId,
				})),
			} satisfies PreparedItem;
		}),
	});
});

const writeEvent = Effect.fn("writeEventCreateItem")(function* (
	payload: EventCreateWorkflowPayload,
	itemIndex: number,
	prepared: PreparedItem,
	raw: { properties: unknown; occurredAt: string; sessionEntityId?: EntityId | undefined },
) {
	const runWithDb = yield* DbRunner;
	const eventsRepository = yield* EventsRepository;

	return yield* Activity.make({
		success: CreatedEvent,
		name: `write-event-${itemIndex}`,
		error: EventCreateWorkflowError,
		execute: Effect.gen(function* () {
			const properties = yield* parseAppSchemaProperties({
				kind: "Event",
				properties: raw.properties,
				propertiesSchema: prepared.propertiesSchema,
			}).pipe(Effect.mapError((error) => badRequest(error.message)));

			const createdEvent = yield* runWithDb(
				eventsRepository.createEvent({
					properties,
					userId: payload.userId,
					entityId: prepared.entityId,
					occurredAt: DateTime.toDate(DateTime.unsafeMake(raw.occurredAt)),
					eventSchemaId: prepared.eventSchemaId,
					sessionEntityId: raw.sessionEntityId,
					eventSchemaName: prepared.eventSchemaName,
					eventSchemaSlug: prepared.eventSchemaSlug,
					id: EventId.make(`${payload.executionId}-event-${itemIndex}`),
				}),
			);

			return {
				...createdEvent,
				isGlobalReference: prepared.isGlobalEntity,
				entitySchemaId: prepared.entitySchemaId,
				entitySchemaSlug: prepared.entitySchemaSlug,
			} satisfies CreatedEvent;
		}),
	});
});

const resolveAfterTriggers = Effect.fn("resolveEventCreateAfterTriggers")(function* (
	payload: EventCreateWorkflowPayload,
	eventSchemaIds: EventSchemaId[],
) {
	const runWithDb = yield* DbRunner;
	const eventsRepository = yield* EventsRepository;

	return yield* Activity.make({
		error: EventCreateWorkflowError,
		name: "resolve-after-triggers",
		success: Schema.Array(AfterCreateTrigger),
		execute: runWithDb(
			eventsRepository.getActiveAfterCreateTriggers({ userId: payload.userId, eventSchemaIds }),
		),
	});
});

const runBeforeTriggers = Effect.fn(function* (
	payload: EventCreateWorkflowPayload,
	itemIndex: number,
	item: EventCreateWorkflowPayload["payload"][number],
	prepared: PreparedItem,
) {
	const operations = yield* EventCreateWorkflowOperations;
	const { userId, origin, importRunId, integrationId } = payload;

	let skipped = false;
	let properties: unknown = item.properties;
	let occurredAt = prepared.occurredAt;
	let sessionEntityId = prepared.sessionEntityId;

	for (const trigger of prepared.beforeTriggers) {
		const context = {
			trigger: {
				userId,
				origin,
				properties,
				occurredAt,
				sessionEntityId,
				phase: "before_create",
				entityId: prepared.entityId,
				eventSchemaId: prepared.eventSchemaId,
				eventSchemaSlug: prepared.eventSchemaSlug,
				...(importRunId ? { importRunId } : {}),
				entitySchemaId: prepared.entitySchemaId,
				...(integrationId ? { integrationId } : {}),
				entitySchemaSlug: prepared.entitySchemaSlug,
			},
		};

		const sandboxResult = yield* operations
			.processSandboxExecution({
				userId,
				context,
				driverName: "trigger",
				scriptId: trigger.sandboxScriptId,
				executionId: `${payload.executionId}-before-${itemIndex}-${trigger.id}`,
			})
			.pipe(Effect.mapError((error) => beforeTriggerFailed(unknownToMessage(error))));

		if (sandboxResult.error) {
			return yield* beforeTriggerFailed(sandboxResult.error.message);
		}

		const triggerResult = yield* decodeBeforeTriggerResult(sandboxResult.value).pipe(
			Effect.mapError(() => badRequest(invalidBeforeTriggerShape)),
		);

		if (triggerResult.action === "skip") {
			skipped = true;
			break;
		}

		if (triggerResult.action === "replace") {
			if (triggerResult.body.properties !== undefined) {
				properties = triggerResult.body.properties;
			}
			if (triggerResult.body.occurredAt !== undefined) {
				const replaced = DateTime.make(triggerResult.body.occurredAt);
				if (Option.isSome(replaced)) {
					occurredAt = DateTime.toDate(replaced.value).toISOString();
				}
			}
			if (triggerResult.body.sessionEntityId !== undefined) {
				sessionEntityId = triggerResult.body.sessionEntityId ?? undefined;
			}
		}
	}

	return { skipped, raw: { properties, occurredAt, sessionEntityId } };
});

const dispatchAfterTriggers = Effect.fn(function* (
	payload: EventCreateWorkflowPayload,
	createdEvents: ReadonlyArray<CreatedEventWithContext>,
	triggers: ReadonlyArray<typeof AfterCreateTrigger.Type>,
) {
	const workflowEngine = yield* WorkflowEngine;
	const pairs = createdEvents.flatMap((event) =>
		triggers
			.filter((trigger) => trigger.eventSchemaId === event.eventSchemaId)
			.map((trigger) => ({ event, trigger })),
	);

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
						executionId,
						userId: payload.userId,
						driverName: "trigger",
						scriptId: trigger.sandboxScriptId,
						context: {
							trigger: {
								eventId: event.id,
								inheritedProperties,
								phase: "after_create",
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

const toCreatedEventWithContext = (event: CreatedEvent): CreatedEventWithContext => ({
	id: event.id,
	entityId: event.entityId,
	createdAt: event.createdAt,
	updatedAt: event.updatedAt,
	occurredAt: event.occurredAt,
	properties: event.properties,
	eventSchemaId: event.eventSchemaId,
	eventSchemaName: event.eventSchemaName,
	eventSchemaSlug: event.eventSchemaSlug,
	entitySchemaId: event.entitySchemaId,
	entitySchemaSlug: event.entitySchemaSlug,
	sessionEntityId: event.sessionEntityId,
});

export const runEventCreateWorkflow = Effect.fn("runEventCreateWorkflow")(function* (
	payload: EventCreateWorkflowPayload,
) {
	const operations = yield* EventCreateWorkflowOperations;
	const createdEvents: CreatedEventWithContext[] = [];
	const referencedGlobalEntityIds = new Set<EntityId>();

	for (const [itemIndex, item] of payload.payload.entries()) {
		const prepared = yield* prepareItem(payload, itemIndex, item);
		const { skipped, raw } = yield* runBeforeTriggers(payload, itemIndex, item, prepared);
		if (skipped) {
			continue;
		}

		const createdEvent = yield* writeEvent(payload, itemIndex, prepared, raw);
		if (createdEvent.isGlobalReference) {
			referencedGlobalEntityIds.add(createdEvent.entityId);
		}
		createdEvents.push(toCreatedEventWithContext(createdEvent));
	}

	if (createdEvents.length > 0) {
		const uniqueSchemaIds = [...new Set(createdEvents.map((event) => event.eventSchemaId))];
		const afterTriggers = yield* resolveAfterTriggers(payload, uniqueSchemaIds);
		if (afterTriggers.length > 0) {
			yield* dispatchAfterTriggers(payload, createdEvents, afterTriggers);
		}
	}

	yield* Effect.forEach(
		referencedGlobalEntityIds,
		(entityId) =>
			operations.ensureLibraryMembership({
				entityId,
				userId: payload.userId,
				executionId: `${payload.executionId}-libref-${entityId}`,
			}),
		{ discard: true },
	);

	return { count: createdEvents.length };
});

const EventCreateWorkflowLive = EventCreateWorkflow.toLayer((payload) =>
	runEventCreateWorkflow(payload),
);

export const EventCreateWorkflowDefinitionsLive = Layer.mergeAll(EventCreateWorkflowLive);
