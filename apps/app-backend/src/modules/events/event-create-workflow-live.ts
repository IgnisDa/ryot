import * as PersistedQueue from "@effect/experimental/PersistedQueue";
import { Activity, DurableQueue } from "@effect/workflow";
import type { WorkflowEngine, WorkflowInstance } from "@effect/workflow/WorkflowEngine";
import type { DbError, SandboxRunError } from "@ryot/contract/errors";
import { badRequest } from "@ryot/contract/errors";
import { AutomationProperties } from "@ryot/contract/modules/automations/schemas";
import type {
	EventCreateFailureReason,
	EventCreateItemOutcome,
} from "@ryot/contract/modules/events/schemas";
import type {
	SandboxCompletedResult,
	SandboxExecutionPayload,
} from "@ryot/contract/modules/sandbox/schemas";
import { EntityId, EntitySchemaId, EventId, EventSchemaId } from "@ryot/contract/schema/brands";
import { AppSchema } from "@ryot/contract/schema/property-schema";
import { Context, DateTime, Effect, Layer, Schema } from "effect";

import { DbRunner } from "#lib/infrastructure/db/service";
import { parseAppSchemaProperties } from "#lib/property-schema/property-schema-runtime";
import { AutomationsService } from "#modules/automations/service";
import { LifecycleDispatch } from "#modules/entities/lifecycle-dispatch";
import { SandboxExecutionQueue } from "#modules/sandbox/durable-queues";

import { EnsureLibraryMembershipQueue } from "./durable-queues";
import {
	EventCreateWorkflow,
	EventCreateWorkflowError,
	type EventCreateWorkflowPayload,
} from "./event-create-workflow";
import { resolveEventCreateItemScopes } from "./event-creation";
import type { EventPolicyDraft } from "./event-policy-engine";
import {
	decodeEventPolicyProperties,
	PreparedEventPolicy,
	runEventCreatePolicies,
} from "./event-policy-engine";
import { EventsRepository } from "./repository";

const PreparedItem = Schema.Struct({
	entityId: EntityId,
	occurredAt: Schema.String,
	subjectName: Schema.String,
	propertiesSchema: AppSchema,
	eventSchemaId: EventSchemaId,
	eventSchemaName: Schema.String,
	eventSchemaSlug: Schema.String,
	isGlobalEntity: Schema.Boolean,
	entitySchemaSlug: Schema.String,
	entitySchemaId: EntitySchemaId,
	properties: AutomationProperties,
	sessionEntityId: Schema.optional(EntityId),
	policies: Schema.Array(PreparedEventPolicy),
});

type PreparedItem = typeof PreparedItem.Type;

const CreatedEvent = Schema.Struct({
	id: EventId,
	entityId: EntityId,
	createdAt: Schema.String,
	occurredAt: Schema.String,
	subjectName: Schema.String,
	eventSchemaId: EventSchemaId,
	eventSchemaSlug: Schema.String,
	entitySchemaSlug: Schema.String,
	isGlobalReference: Schema.Boolean,
	properties: Schema.Record({ key: Schema.String, value: Schema.Unknown }),
});

type CreatedEvent = typeof CreatedEvent.Type;

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
	const automations = yield* AutomationsService;

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

			const policies = yield* automations.resolveActivePolicies({
				userId: payload.userId,
				target: { id: eventSchemaScope.id, kind: "event_schema" },
			});

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
				id: createdEvent.id,
				entityId: createdEvent.entityId,
				createdAt: createdEvent.createdAt,
				occurredAt: createdEvent.occurredAt,
				properties: createdEvent.properties,
				eventSchemaId: createdEvent.eventSchemaId,
				subjectName: prepared.subjectName,
				eventSchemaSlug: prepared.eventSchemaSlug,
				isGlobalReference: prepared.isGlobalEntity,
				entitySchemaSlug: prepared.entitySchemaSlug,
			} satisfies CreatedEvent;
		}),
	});
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

export const runEventCreateWorkflow = Effect.fn("EventCreateWorkflow")(
	function* (payload: EventCreateWorkflowPayload, executionId: string) {
		yield* Effect.annotateCurrentSpan({
			executionId,
			userId: payload.userId,
			...(payload.importRunId ? { importRunId: payload.importRunId } : {}),
			...(payload.integrationId ? { integrationId: payload.integrationId } : {}),
		});
		let createdCount = 0;
		const outcomes: EventCreateItemOutcome[] = [];
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
			createdCount += 1;
			yield* dispatchLifecycleOccurrence(payload, itemIndex, createdEvent);
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

		return { failure, outcomes, count: createdCount };
	},
	(effect, _payload, executionId) =>
		Effect.annotateLogs(effect, { executionId, workflow: "EventCreateWorkflow" }),
);

const EventCreateWorkflowLive = EventCreateWorkflow.toLayer(runEventCreateWorkflow);

export const EventCreateWorkflowDefinitionsLive = Layer.mergeAll(EventCreateWorkflowLive);
