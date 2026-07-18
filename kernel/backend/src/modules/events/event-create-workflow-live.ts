import type { SandboxRunError } from "@ryot-app/contract/errors";
import { AutomationProperties } from "@ryot-app/contract/modules/automations/schemas";
import {
	EventCreateItemError,
	type EventCreateFailureReason,
	type EventCreateItemOutcome,
} from "@ryot-app/contract/modules/events/schemas";
import type { SandboxExecutionPayload } from "@ryot-app/contract/modules/sandbox/schemas";
import {
	EntityId,
	EntitySchemaSlug,
	EventId,
	EventSchemaSlug,
} from "@ryot-app/contract/schema/brands";
import { AppSchema } from "@ryot-app/contract/schema/property-schema";
import { Context, DateTime, Effect, Layer, Schema } from "effect";
import { Activity } from "effect/unstable/workflow";

import type { DurableSchema } from "#lib/infrastructure/workflow";
import { parseAppSchemaProperties } from "#lib/property-schema/property-schema-runtime";
import { AutomationsService } from "#modules/automations/service";
import {
	LifecycleDispatch,
	type LifecycleDispatchValue,
} from "#modules/entities/lifecycle-dispatch";
import type { SandboxExecutionResult } from "#modules/sandbox/execution-result";
import { SandboxExecutionService } from "#modules/sandbox/service";

import {
	EventCreateWorkflow,
	EventCreateWorkflowError,
	type EventCreateWorkflowPayload,
} from "./event-create-workflow";
import { resolveEventCreateItemScopes } from "./event-creation";
import type { EventPolicyDraft } from "./event-policy-engine";
import {
	decodeEventPolicyProperties,
	isAutomationMetadataObject,
	PreparedEventPolicy,
	runEventCreatePolicies,
} from "./event-policy-engine";
import { EventsRepository } from "./repository";

const PreparedItem = Schema.Struct({
	entityId: EntityId,
	occurredAt: Schema.String,
	subjectName: Schema.String,
	propertiesSchema: AppSchema,
	eventSchemaName: Schema.String,
	eventSchemaSlug: EventSchemaSlug,
	properties: AutomationProperties,
	entitySchemaSlug: EntitySchemaSlug,
	sessionEntityId: Schema.optional(EntityId),
	policies: Schema.Array(PreparedEventPolicy),
	eventSchemaPluginId: Schema.NullOr(Schema.String),
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
	sessionEntityId: Schema.optional(EntityId),
	properties: Schema.Record(Schema.String, Schema.Unknown),
});

type CreatedEvent = typeof CreatedEvent.Type;

const runsOncePerSubject = (policy: PreparedItem["policies"][number]) =>
	isAutomationMetadataObject(policy.metadata) && policy.metadata["batchMode"] === "subject";

const subjectBatchKey = (prepared: PreparedItem, policy: PreparedItem["policies"][number]) =>
	`${prepared.entityId}:${policy.id}`;

export type EventCreateWorkflowOperationsValue = {
	dispatchLifecycleOccurrence: LifecycleDispatchValue["dispatch"];
	executeSandboxScript: (
		payload: SandboxExecutionPayload,
	) => Effect.Effect<SandboxExecutionResult, SandboxRunError>;
};

export class EventCreateWorkflowOperations extends Context.Service<
	EventCreateWorkflowOperations,
	EventCreateWorkflowOperationsValue
>()("EventCreateWorkflowOperations") {}

export const EventCreateWorkflowOperationsLive = Layer.effect(
	EventCreateWorkflowOperations,
	Effect.gen(function* () {
		const sandbox = yield* SandboxExecutionService;
		const lifecycleDispatch = yield* LifecycleDispatch;
		return {
			dispatchLifecycleOccurrence: lifecycleDispatch.dispatch,
			executeSandboxScript: (payload) =>
				sandbox.executeScript({
					input: payload.context,
					subject: payload.subject,
					scriptId: payload.scriptId,
					executionId: payload.executionId,
				}),
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
		success: PreparedItem satisfies DurableSchema,
		name: `prepare-item-${itemIndex}`,
		error: EventCreateWorkflowError satisfies DurableSchema,
		execute: Effect.gen(function* () {
			const { entityId, entityScope, eventSchemaScope, sessionEntityId, occurredAt } =
				yield* resolveEventCreateItemScopes({ item, userId: payload.userId });
			const parsedProperties = yield* parseAppSchemaProperties({
				kind: "Event",
				properties: item.properties,
				propertiesSchema: eventSchemaScope.propertiesSchema,
			}).pipe(
				Effect.tapError((error) =>
					Effect.logWarning("invalid event properties", { issues: error.issues }),
				),
				Effect.mapError(() => new EventCreateItemError({ reason: { code: "invalid-properties" } })),
			);
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
				eventSchemaPluginId: eventSchemaScope.pluginId ?? null,
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
	const eventsRepository = yield* EventsRepository;

	return yield* Activity.make({
		success: CreatedEvent satisfies DurableSchema,
		error: EventCreateWorkflowError satisfies DurableSchema,
		name: `write-event-${itemIndex}`,
		execute: Effect.gen(function* () {
			const createdEvent = yield* eventsRepository.createEvent({
				userId: payload.userId,
				entityId: prepared.entityId,
				properties: draft.properties,
				sessionEntityId: draft.sessionEntityId,
				eventSchemaSlug: prepared.eventSchemaSlug,
				eventSchemaName: prepared.eventSchemaName,
				eventSchemaPluginId: prepared.eventSchemaPluginId,
				id: EventId.make(`${payload.executionId}-event-${itemIndex}`),
				occurredAt: DateTime.toDate(DateTime.makeUnsafe(draft.occurredAt)),
			});

			return {
				id: createdEvent.id,
				entityId: createdEvent.entityId,
				createdAt: createdEvent.createdAt,
				subjectName: prepared.subjectName,
				occurredAt: createdEvent.occurredAt,
				properties: createdEvent.properties,
				entitySchemaSlug: prepared.entitySchemaSlug,
				eventSchemaSlug: createdEvent.eventSchemaSlug,
				...(createdEvent.sessionEntityId ? { sessionEntityId: createdEvent.sessionEntityId } : {}),
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
				createdAt: event.createdAt,
				properties: event.properties,
				occurredAt: event.occurredAt,
				eventSchemaSlug: event.eventSchemaSlug,
				...(event.sessionEntityId ? { sessionEntityId: event.sessionEntityId } : {}),
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
		const completedSubjectPolicies = new Set<string>();
		let failure: { index: number; reason: EventCreateFailureReason } | null = null;

		for (const [itemIndex, item] of payload.payload.entries()) {
			const attempt = yield* Effect.gen(function* () {
				const initial = yield* prepareItem(payload, itemIndex, item);
				const prepared = {
					...initial,
					policies: initial.policies.filter(
						(policy) =>
							!runsOncePerSubject(policy) ||
							!completedSubjectPolicies.has(subjectBatchKey(initial, policy)),
					),
				};
				const policyResult = yield* runEventCreatePolicies(
					payload,
					itemIndex,
					prepared,
					operations.executeSandboxScript,
				);
				return { policyResult, prepared, kind: "prepared" as const };
			}).pipe(
				Effect.catchTag("EventCreateItemError", (error) =>
					Effect.succeed({ kind: "failed" as const, reason: error.reason }),
				),
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
			for (const policy of attempt.prepared.policies.filter(runsOncePerSubject)) {
				completedSubjectPolicies.add(subjectBatchKey(attempt.prepared, policy));
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
