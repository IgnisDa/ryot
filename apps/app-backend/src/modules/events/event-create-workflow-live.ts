import type { SandboxRunError } from "@ryot/contract/errors";
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
import { EntityId, EntitySchemaSlug, EventId, EventSchemaSlug } from "@ryot/contract/schema/brands";
import { AppSchema } from "@ryot/contract/schema/property-schema";
import { Context, DateTime, Effect, Layer, Schema } from "effect";
import { PersistedQueue } from "effect/unstable/persistence";
import { Activity } from "effect/unstable/workflow";
import type { WorkflowEngine, WorkflowInstance } from "effect/unstable/workflow/WorkflowEngine";

import { DbRunner } from "#lib/infrastructure/db/service";
import { parseAppSchemaProperties } from "#lib/property-schema/property-schema-runtime";
import { withoutSchemaServices } from "#lib/shared/schema";
import { AutomationsService } from "#modules/automations/service";
import {
	LifecycleDispatch,
	type LifecycleDispatchValue,
} from "#modules/entities/lifecycle-dispatch";
import { processSandboxExecution } from "#modules/sandbox/durable-queues";
import { SandboxPluginScriptResolver } from "#modules/sandbox/plugin-script-resolver";
import { SandboxRepository } from "#modules/sandbox/repository";

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
	eventSchemaSlug: EventSchemaSlug,
	eventSchemaName: Schema.String,
	entitySchemaSlug: EntitySchemaSlug,
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
	eventSchemaSlug: EventSchemaSlug,
	entitySchemaSlug: EntitySchemaSlug,
	properties: Schema.Record(Schema.String, Schema.Unknown),
});

type CreatedEvent = typeof CreatedEvent.Type;

export type EventCreateWorkflowOperationsValue = {
	dispatchLifecycleOccurrence: LifecycleDispatchValue["dispatch"];
	processSandboxExecution: (
		payload: SandboxExecutionPayload,
	) => Effect.Effect<SandboxCompletedResult, SandboxRunError, WorkflowEngine | WorkflowInstance>;
};

/**
 * DurableQueue.process must run inside the calling workflow's own execution
 * context, so these requirements are intentionally pass-through.
 * @effect-expect-leaking WorkflowEngine WorkflowInstance
 */
export class EventCreateWorkflowOperations extends Context.Service<
	EventCreateWorkflowOperations,
	EventCreateWorkflowOperationsValue
>()("EventCreateWorkflowOperations") {}

export const EventCreateWorkflowOperationsLive = Layer.effect(
	EventCreateWorkflowOperations,
	Effect.gen(function* () {
		const runWithDb = yield* DbRunner;
		const repository = yield* SandboxRepository;
		const lifecycleDispatch = yield* LifecycleDispatch;
		const pluginScriptResolver = yield* SandboxPluginScriptResolver;
		const queueFactory = yield* PersistedQueue.PersistedQueueFactory;
		return {
			dispatchLifecycleOccurrence: lifecycleDispatch.dispatch,
			processSandboxExecution: (payload) =>
				processSandboxExecution(payload).pipe(
					Effect.provideService(DbRunner, runWithDb),
					Effect.provideService(SandboxRepository, repository),
					Effect.provideService(SandboxPluginScriptResolver, pluginScriptResolver),
					Effect.provideService(PersistedQueue.PersistedQueueFactory, queueFactory),
				),
		} satisfies EventCreateWorkflowOperationsValue;
	}),
);

const prepareItem = Effect.fn("prepareEventCreateItem")(function* (
	payload: EventCreateWorkflowPayload,
	itemIndex: number,
	item: EventCreateWorkflowPayload["payload"][number],
) {
	const automations = yield* AutomationsService;

	return yield* Activity.make({
		success: withoutSchemaServices(PreparedItem),
		name: `prepare-item-${itemIndex}`,
		error: withoutSchemaServices(EventCreateWorkflowError),
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
				target: {
					kind: "event_schema",
					id: EventSchemaSlug.make(`${entityScope.entitySchemaSlug}:${eventSchemaScope.id}`),
				},
			});

			return {
				entityId,
				properties,
				sessionEntityId,
				subjectName: entityScope.entityName,
				occurredAt: occurredAt.toISOString(),
				eventSchemaSlug: eventSchemaScope.id,
				eventSchemaName: eventSchemaScope.name,
				entitySchemaSlug: entityScope.entitySchemaSlug,
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
		success: withoutSchemaServices(CreatedEvent),
		error: withoutSchemaServices(EventCreateWorkflowError),
		name: `write-event-${itemIndex}`,
		execute: Effect.gen(function* () {
			const createdEvent = yield* runWithDb(
				eventsRepository.createEvent({
					userId: payload.userId,
					entityId: prepared.entityId,
					properties: draft.properties,
					sessionEntityId: draft.sessionEntityId,
					eventSchemaSlug: prepared.eventSchemaSlug,
					eventSchemaName: prepared.eventSchemaName,
					id: EventId.make(`${payload.executionId}-event-${itemIndex}`),
					occurredAt: DateTime.toDate(DateTime.makeUnsafe(draft.occurredAt)),
				}),
			);

			return {
				id: createdEvent.id,
				entityId: createdEvent.entityId,
				createdAt: createdEvent.createdAt,
				subjectName: prepared.subjectName,
				occurredAt: createdEvent.occurredAt,
				properties: createdEvent.properties,
				entitySchemaSlug: prepared.entitySchemaSlug,
				eventSchemaSlug: createdEvent.eventSchemaSlug,
			} satisfies CreatedEvent;
		}),
	});
});

const dispatchLifecycleOccurrence = Effect.fn("dispatchEventLifecycleOccurrence")(function* (
	payload: EventCreateWorkflowPayload,
	itemIndex: number,
	event: CreatedEvent,
	dispatch: LifecycleDispatchValue["dispatch"],
) {
	if (!payload.lifecycleOrigin) {
		return;
	}
	yield* dispatch({
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
			outcomes.push({ index: itemIndex, eventId: createdEvent.id, status: "written" });
			createdCount += 1;
			yield* dispatchLifecycleOccurrence(
				payload,
				itemIndex,
				createdEvent,
				operations.dispatchLifecycleOccurrence,
			);
		}
		return { failure, outcomes, count: createdCount };
	},
	(effect, _payload, executionId) =>
		Effect.annotateLogs(effect, { executionId, workflow: "EventCreateWorkflow" }),
);

const EventCreateWorkflowLive = EventCreateWorkflow.toLayer(runEventCreateWorkflow);

export const EventCreateWorkflowDefinitionsLive = Layer.mergeAll(EventCreateWorkflowLive);
