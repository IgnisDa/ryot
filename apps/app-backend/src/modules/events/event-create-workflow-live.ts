import * as PersistedQueue from "@effect/experimental/PersistedQueue";
import { Activity, DurableQueue } from "@effect/workflow";
import { WorkflowEngine } from "@effect/workflow/WorkflowEngine";
import type { WorkflowInstance } from "@effect/workflow/WorkflowEngine";
import type { DbError, SandboxRunError } from "@ryot/contract/errors";
import { badRequest, unknownToMessage } from "@ryot/contract/errors";
import type {
	EventCreateFailureReason,
	EventCreateItemOutcome,
} from "@ryot/contract/modules/events/schemas";
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
import { Context, DateTime, Effect, Layer, Schema } from "effect";

import { DbRunner } from "#lib/infrastructure/db/service";
import { parseAppSchemaProperties } from "#lib/property-schema/property-schema-runtime";
import { AutomationsService } from "#modules/automations/service";
import { LifecycleDispatch } from "#modules/entities/lifecycle-dispatch";
import { SandboxExecutionQueue } from "#modules/sandbox/durable-queues";
import { RunSandboxWorkflow } from "#modules/sandbox/sandbox-run-workflow";

import { EnsureLibraryMembershipQueue } from "./durable-queues";
import {
	EventCreateWorkflow,
	EventCreateWorkflowError,
	type EventCreateWorkflowPayload,
} from "./event-create-workflow";
import { type CreatedEventWithContext, resolveEventCreateItemScopes } from "./event-creation";
import type { EventPolicyDraft } from "./event-policy-engine";
import {
	decodeEventPolicyProperties,
	EventPolicyProperties,
	PreparedEventPolicy,
	PreparedLegacyBeforeTrigger,
	runEventCreatePolicies,
} from "./event-policy-engine";
import { EventsRepository } from "./repository";

const PreparedItem = Schema.Struct({
	entityId: EntityId,
	occurredAt: Schema.String,
	subjectName: Schema.String,
	eventSchemaId: EventSchemaId,
	propertiesSchema: AppSchema,
	eventSchemaName: Schema.String,
	eventSchemaSlug: Schema.String,
	isGlobalEntity: Schema.Boolean,
	entitySchemaSlug: Schema.String,
	entitySchemaId: EntitySchemaId,
	sessionEntityId: Schema.optional(EntityId),
	properties: EventPolicyProperties,
	policies: Schema.Array(PreparedEventPolicy),
	beforeTriggers: Schema.Array(PreparedLegacyBeforeTrigger),
});

type PreparedItem = typeof PreparedItem.Type;

const CreatedEvent = Schema.Struct({
	id: EventId,
	entityId: EntityId,
	createdAt: Schema.String,
	updatedAt: Schema.String,
	occurredAt: Schema.String,
	subjectName: Schema.String,
	eventSchemaId: EventSchemaId,
	eventSchemaName: Schema.String,
	eventSchemaSlug: Schema.String,
	entitySchemaId: EntitySchemaId,
	entitySchemaSlug: Schema.String,
	isGlobalReference: Schema.Boolean,
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
	const automations = yield* AutomationsService;
	const eventsRepository = yield* EventsRepository;

	return yield* Activity.make({
		success: PreparedItem,
		name: `prepare-item-${itemIndex}`,
		error: EventCreateWorkflowError,
		execute: Effect.gen(function* () {
			const { entityId, entityScope, eventSchemaScope, sessionEntityId, occurredAt } =
				yield* resolveEventCreateItemScopes({ item, userId: payload.userId });
			const parsedProperties = yield* parseAppSchemaProperties({
				kind: "Event",
				properties: item.properties,
				propertiesSchema: eventSchemaScope.propertiesSchema,
			}).pipe(Effect.mapError((error) => badRequest(error.message)));
			const properties = yield* decodeEventPolicyProperties(parsedProperties);

			const [policies, beforeTriggers] = yield* Effect.all([
				automations.resolveActivePolicies({
					userId: payload.userId,
					target: { id: eventSchemaScope.id, kind: "event_schema" },
				}),
				runWithDb(
					eventsRepository.getActiveBeforeCreateTriggers({
						userId: payload.userId,
						eventSchemaIds: [eventSchemaScope.id],
					}),
				),
			]);

			return {
				entityId,
				properties,
				sessionEntityId,
				eventSchemaId: eventSchemaScope.id,
				subjectName: entityScope.entityName,
				occurredAt: occurredAt.toISOString(),
				eventSchemaName: eventSchemaScope.name,
				eventSchemaSlug: eventSchemaScope.slug,
				entitySchemaId: entityScope.entitySchemaId,
				entitySchemaSlug: entityScope.entitySchemaSlug,
				isGlobalEntity: entityScope.entityUserId === null,
				propertiesSchema: eventSchemaScope.propertiesSchema,
				beforeTriggers: beforeTriggers.map((trigger) => ({
					id: trigger.id,
					position: trigger.position,
					sandboxScriptId: trigger.sandboxScriptId,
				})),
				policies: policies.map((policy) => ({
					id: policy.id,
					metadata: policy.metadata,
					position: policy.position ?? 1000,
					sandboxScriptId: policy.sandboxScriptId,
				})),
			} satisfies PreparedItem;
		}),
	});
});

const writeEvent = Effect.fn("writeEventCreateItem")(function* (
	payload: EventCreateWorkflowPayload,
	itemIndex: number,
	prepared: PreparedItem,
	draft: EventPolicyDraft,
) {
	const runWithDb = yield* DbRunner;
	const eventsRepository = yield* EventsRepository;

	return yield* Activity.make({
		success: CreatedEvent,
		error: EventCreateWorkflowError,
		name: `write-event-${itemIndex}`,
		execute: Effect.gen(function* () {
			const createdEvent = yield* runWithDb(
				eventsRepository.createEvent({
					userId: payload.userId,
					entityId: prepared.entityId,
					properties: draft.properties,
					eventSchemaId: prepared.eventSchemaId,
					sessionEntityId: draft.sessionEntityId,
					eventSchemaName: prepared.eventSchemaName,
					eventSchemaSlug: prepared.eventSchemaSlug,
					id: EventId.make(`${payload.executionId}-event-${itemIndex}`),
					occurredAt: DateTime.toDate(DateTime.unsafeMake(draft.occurredAt)),
				}),
			);

			return {
				...createdEvent,
				subjectName: prepared.subjectName,
				entitySchemaId: prepared.entitySchemaId,
				isGlobalReference: prepared.isGlobalEntity,
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

const dispatchLifecycleOccurrence = Effect.fn("dispatchEventLifecycleOccurrence")(function* (
	payload: EventCreateWorkflowPayload,
	itemIndex: number,
	event: CreatedEvent,
) {
	if (!payload.lifecycleOrigin) {
		return;
	}
	const lifecycleDispatch = yield* LifecycleDispatch;
	yield* lifecycleDispatch.dispatch({
		recordId: event.id,
		rowUserId: payload.userId,
		occurredAt: event.createdAt,
		origin: payload.lifecycleOrigin,
		occurrenceId: `${payload.executionId}-lifecycle-${itemIndex}`,
		source: {
			kind: "event",
			after: {
				id: event.id,
				properties: event.properties,
				occurredAt: event.occurredAt,
				eventSchemaId: event.eventSchemaId,
				eventSchemaSlug: event.eventSchemaSlug,
				subject: {
					id: event.entityId,
					name: event.subjectName,
					entitySchemaSlug: event.entitySchemaSlug,
				},
			},
		},
	});
});

export const runEventCreateWorkflow = Effect.fn("runEventCreateWorkflow")(function* (
	payload: EventCreateWorkflowPayload,
) {
	const outcomes: EventCreateItemOutcome[] = [];
	const createdEvents: CreatedEventWithContext[] = [];
	const referencedGlobalEntityIds = new Set<EntityId>();
	const operations = yield* EventCreateWorkflowOperations;
	let failure: { index: number; reason: EventCreateFailureReason } | null = null;

	for (const [itemIndex, item] of payload.payload.entries()) {
		const attempt = yield* Effect.gen(function* () {
			const prepared = yield* prepareItem(payload, itemIndex, item);
			const policyResult = yield* runEventCreatePolicies(
				payload,
				itemIndex,
				prepared,
				operations.processSandboxExecution,
			);
			return { policyResult, prepared, kind: "prepared" as const };
		}).pipe(
			Effect.catchTags({
				BadRequest: (error) =>
					Effect.succeed({
						kind: "failed" as const,
						reason: { kind: "bad_request" as const, message: error.message },
					}),
				NotFound: (error) =>
					Effect.succeed({
						kind: "failed" as const,
						reason: { kind: "not_found" as const, message: error.message },
					}),
			}),
		);
		if (attempt.kind === "failed") {
			failure = { index: itemIndex, reason: attempt.reason };
			break;
		}
		if (attempt.policyResult.kind === "skipped") {
			outcomes.push({
				index: itemIndex,
				status: "skipped_by_policy",
				reason: attempt.policyResult.reason,
			});
			continue;
		}

		const createdEvent = yield* writeEvent(
			payload,
			itemIndex,
			attempt.prepared,
			attempt.policyResult.draft,
		);
		if (createdEvent.isGlobalReference) {
			referencedGlobalEntityIds.add(createdEvent.entityId);
		}
		outcomes.push({ index: itemIndex, eventId: createdEvent.id, status: "written" });
		createdEvents.push(toCreatedEventWithContext(createdEvent));
		yield* dispatchLifecycleOccurrence(payload, itemIndex, createdEvent);
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

	return { failure, outcomes, count: createdEvents.length };
});

const EventCreateWorkflowLive = EventCreateWorkflow.toLayer((payload) =>
	runEventCreateWorkflow(payload),
);

export const EventCreateWorkflowDefinitionsLive = Layer.mergeAll(EventCreateWorkflowLive);
