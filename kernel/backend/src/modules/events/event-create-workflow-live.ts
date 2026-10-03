import { DbError } from "@ryot-app/contract/errors";
import {
	AutomationEventDraft,
	AutomationEventSnapshot,
	AutomationRun,
	AutomationTrigger,
	type AutomationHookIdentity,
	type AutomationWarning,
} from "@ryot-app/contract/modules/automations/lifecycle";
import {
	EventCreateItemError,
	type EventCreateFailureReason,
	type EventCreateItemOutcome,
} from "@ryot-app/contract/modules/events/schemas";
import { AutomationRunId, EventId } from "@ryot-app/contract/schema/brands";
import { AppSchema } from "@ryot-app/contract/schema/property-schema";
import { sha256Base64Url } from "@ryot-app/ts-utils/crypto";
import { stableStringify } from "@ryot-app/ts-utils/json";
import { DateTime, Effect, Ref, Schema } from "effect";
import { Workflow } from "effect/workflow";
import { WorkflowInstance } from "effect/workflow/WorkflowEngine";

import {
	LifecycleDispatchPlan,
	LifecyclePlanner,
	toLifecycleDispatchPlan,
} from "#lib/domain/lifecycle";
import { lifecycleTrigger } from "#lib/domain/lifecycle-command";
import { LifecycleExecution } from "#lib/domain/lifecycle-execution";
import { DatabaseSession } from "#lib/infrastructure/db/session";
import type { DurableSchema } from "#lib/infrastructure/workflow";
import { implementWorkflow, makeActivity } from "#lib/infrastructure/workflow-scope";
import { parseAppSchemaProperties } from "#lib/property-schema/property-schema-runtime";
import { EntitiesRepository } from "#modules/entities/repository";
import { EventSchemasRepository } from "#modules/event-schemas/repository";
import { type MutationReceiptIdentity, MutationReceipts } from "#modules/mutations/receipts";
import { admitWorkflow } from "#modules/mutations/workflow-dispatch";
import {
	CatalogDefinitionFingerprint,
	catalogDefinitionFingerprint,
} from "#modules/plugins/runtime-resolver";

import {
	EventCreateWorkflow,
	EventCreateWorkflowError,
	type EventCreateWorkflowPayload,
} from "./event-create-workflow";
import {
	CapturedEventReferences,
	capturedEventReferences,
	resolveEventCreateItemScopes,
	validateCapturedEventReferences,
} from "./event-creation";
import { runEventCreatePolicies } from "./event-policy-engine";
import {
	EventCreateReceiptResult,
	eventCreateBatchInput,
	eventCreateItemCommand,
	eventCreateReceiptIdentity,
	eventReceiptError,
} from "./mutation-receipts";
import { EventsRepository } from "./repository";
import { eventRootTransaction } from "./transaction";

const Plan = Schema.Struct({
	wasCreated: Schema.Boolean,
	trigger: AutomationTrigger,
	runs: Schema.Array(AutomationRun),
	policies: Schema.Array(
		Schema.Struct({
			runId: AutomationRunId,
			position: Schema.Finite,
			batchFrequency: Schema.optional(Schema.Literals(["item", "once-per-subject"])),
		}),
	),
});
const PreparedItem = Schema.Union([
	Schema.TaggedStruct("Committed", {
		result: EventCreateReceiptResult,
		dispatch: Schema.Array(LifecycleDispatchPlan),
	}),
	Schema.TaggedStruct("Pending", {
		plan: Schema.NullOr(Plan),
		draft: AutomationEventDraft,
		propertiesSchema: AppSchema,
		eventSchemaName: Schema.String,
		capturedReferences: CapturedEventReferences,
		eventSchemaPluginId: Schema.NullOr(Schema.String),
		eventSchemaFingerprint: CatalogDefinitionFingerprint,
	}),
]);

const prepareItem = Effect.fn("prepareEventCreateItem")(function* (
	payload: EventCreateWorkflowPayload,
	index: number,
	excluded: ReadonlyArray<AutomationHookIdentity>,
) {
	const planner = yield* LifecyclePlanner;
	const session = yield* DatabaseSession;
	const receipts = yield* MutationReceipts.make;
	const item = payload.payload[index];
	if (!item) {
		return yield* Effect.die("Missing event batch item");
	}
	return yield* makeActivity({
		name: `prepare-item-${index}`,
		success: PreparedItem satisfies DurableSchema,
		error: EventCreateWorkflowError satisfies DurableSchema,
		execute: eventRootTransaction(
			session,
			"Event workflow transaction already active",
		)(
			Effect.gen(function* () {
				const batch = yield* planner.prepareBatch({
					...eventCreateBatchInput(payload),
					scopes: [payload.userId],
				});
				const identity = eventCreateReceiptIdentity(payload, index, item);
				const replay = yield* receipts
					.lookup(identity, EventCreateReceiptResult)
					.pipe(Effect.mapError(eventReceiptError));
				if (replay) {
					return { _tag: "Committed" as const, ...replay };
				}
				const scope = yield* resolveEventCreateItemScopes({
					userId: payload.userId,
					item: {
						...item,
						occurredAt:
							item.occurredAt === undefined || item.occurredAt === ""
								? payload.command.occurredAt
								: item.occurredAt,
					},
				});
				const draft = yield* Schema.decodeUnknownEffect(AutomationEventDraft)({
					entityId: scope.entityId,
					properties: item.properties,
					occurredAt: scope.occurredAt.toISOString(),
					eventSchemaSlug: scope.eventSchemaScope.id,
					sessionEntityId: scope.sessionEntityId ?? null,
					entitySchemaSlug: scope.entityScope.entitySchemaSlug,
				}).pipe(
					Effect.mapError(
						() => new EventCreateItemError({ reason: { code: "invalid-properties" } }),
					),
				);
				const capturedReferences = yield* capturedEventReferences(payload.userId, draft);
				const plan = yield* planner.plan({
					excludedOncePerSubjectPolicies: excluded,
					trigger: lifecycleTrigger(
						eventCreateItemCommand(payload.command, index, payload.itemIdentities?.[index]),
						payload.userId,
						{ draft, resource: "event", category: "request", operation: "create" },
					),
				});
				const pending = {
					draft,
					capturedReferences,
					_tag: "Pending" as const,
					eventSchemaName: scope.eventSchemaScope.name,
					propertiesSchema: scope.eventSchemaScope.propertiesSchema,
					eventSchemaPluginId: scope.eventSchemaScope.pluginId ?? null,
					eventSchemaFingerprint: catalogDefinitionFingerprint(scope.eventSchemaScope),
					plan:
						plan.trigger === null
							? null
							: {
									...plan,
									policies: plan.policies.map((policy) => ({
										runId: policy.runId,
										position: policy.position,
										batchFrequency: policy.batchFrequency,
									})),
								},
				} satisfies Extract<typeof PreparedItem.Type, { _tag: "Pending" }>;
				if (plan.trigger !== null) {
					return pending;
				}
				const properties = yield* parseAppSchemaProperties({
					kind: "Event",
					properties: draft.properties,
					propertiesSchema: scope.eventSchemaScope.propertiesSchema,
				}).pipe(
					Effect.mapError(
						() => new EventCreateItemError({ reason: { code: "invalid-properties" } }),
					),
				);
				const validated = yield* Schema.decodeUnknownEffect(AutomationEventDraft)({
					...draft,
					properties,
				}).pipe(
					Effect.mapError(
						() => new EventCreateItemError({ reason: { code: "invalid-properties" } }),
					),
				);
				const committed = yield* writeEvent(payload, index, pending, validated, [], {
					batch,
					identity,
				});
				return {
					_tag: "Committed" as const,
					dispatch: committed.dispatch,
					result: { eventId: committed.eventId, processed: committed.processed },
				};
			}),
		),
	});
});

const writeEvent = Effect.fn("writeEventCreateItem")(function* (
	payload: EventCreateWorkflowPayload,
	index: number,
	prepared: Extract<typeof PreparedItem.Type, { _tag: "Pending" }>,
	draft: AutomationEventDraft,
	processed: ReadonlyArray<AutomationHookIdentity>,
	inline?: {
		batch: Effect.Success<ReturnType<LifecyclePlanner["Service"]["prepareBatch"]>>;
		identity: MutationReceiptIdentity;
	},
) {
	const repository = yield* EventsRepository;
	const entities = yield* EntitiesRepository;
	const eventSchemas = yield* EventSchemasRepository;
	const planner = yield* LifecyclePlanner;
	const session = yield* DatabaseSession;
	const receipts = yield* MutationReceipts.make;
	const command = eventCreateItemCommand(payload.command, index, payload.itemIdentities?.[index]);
	const item = payload.payload[index];
	if (!item) {
		return yield* Effect.die("Missing event batch item");
	}
	const work = Effect.gen(function* () {
		// Inline preparation still owns this transaction's pinned decision and receipt lock.
		const batch = inline
			? inline.batch
			: yield* planner.prepareBatch({
					...eventCreateBatchInput(payload),
					scopes: [payload.userId],
				});
		const identity = inline?.identity ?? eventCreateReceiptIdentity(payload, index, item);
		if (!inline) {
			const replay = yield* receipts
				.lookup(identity, EventCreateReceiptResult)
				.pipe(Effect.mapError(eventReceiptError));
			if (replay) {
				return { ...replay.result, dispatch: replay.dispatch };
			}
		}
		const eventId = EventId.make(
			`event_${sha256Base64Url(stableStringify([command.causation.executionId, command.itemIdentity]))}`,
		);
		yield* eventSchemas.lockCatalog();
		yield* entities.lockEntityReferencesByIds(
			[
				...new Set([
					draft.entityId,
					...(draft.sessionEntityId === null ? [] : [draft.sessionEntityId]),
				]),
			].sort(),
		);
		const currentScope = yield* resolveEventCreateItemScopes({
			userId: payload.userId,
			item: { ...draft, sessionEntityId: draft.sessionEntityId ?? undefined },
		});
		if (
			stableStringify(catalogDefinitionFingerprint(currentScope.eventSchemaScope)) !==
			stableStringify(prepared.eventSchemaFingerprint)
		) {
			return yield* new EventCreateItemError({
				reason: { code: "event-schema-not-found", eventSchemaSlug: draft.eventSchemaSlug },
			});
		}
		yield* validateCapturedEventReferences(payload.userId, draft, prepared.capturedReferences);
		const event = yield* repository.createEvent({
			...draft,
			id: eventId,
			userId: payload.userId,
			properties: { ...draft.properties },
			eventSchemaName: prepared.eventSchemaName,
			eventSchemaPluginId: prepared.eventSchemaPluginId,
			sessionEntityId: draft.sessionEntityId ?? undefined,
			occurredAt: DateTime.toDate(DateTime.makeUnsafe(draft.occurredAt)),
		});
		const after = yield* Schema.decodeUnknownEffect(AutomationEventSnapshot)({
			...draft,
			id: event.id,
			entityId: event.entityId,
			createdAt: event.createdAt,
			updatedAt: event.updatedAt,
			properties: event.properties,
			occurredAt: event.occurredAt,
			eventSchemaSlug: event.eventSchemaSlug,
			sessionEntityId: event.sessionEntityId ?? null,
		}).pipe(Effect.mapError(() => new DbError({ message: "Invalid persisted event snapshot" })));
		const plan = yield* planner.plan({
			trigger: lifecycleTrigger(
				{
					...command,
					causation: {
						...command.causation,
						parentTriggerId: prepared.plan?.trigger.id ?? command.causation.parentTriggerId,
					},
				},
				payload.userId,
				{ after, resource: "event", category: "change", operation: "create" },
			),
		});
		const dispatch = plan.trigger === null ? [] : [toLifecycleDispatchPlan(plan)];
		yield* receipts.insert({
			identity,
			dispatch,
			batchId: batch.id,
			batchIndex: index,
			result: { eventId: event.id, processed: [...processed] },
			evidence: batch.hasCandidates
				? { after, resource: "event", category: "change", operation: "create" }
				: undefined,
		});
		return { dispatch, eventId: event.id, processed: [...processed] };
	});
	if (inline) {
		return yield* work;
	}
	return yield* makeActivity({
		name: `write-event-${index}`,
		error: EventCreateWorkflowError satisfies DurableSchema,
		execute: eventRootTransaction(session, "Event workflow transaction already active")(work),
		success: Schema.Struct({
			dispatch: Schema.Array(LifecycleDispatchPlan),
			...EventCreateReceiptResult.fields,
		}) satisfies DurableSchema,
	});
});

const planEventBatch = Effect.fn("planEventCreateBatch")(function* (
	payload: EventCreateWorkflowPayload,
) {
	const planner = yield* LifecyclePlanner;
	const session = yield* DatabaseSession;
	return yield* makeActivity({
		name: "plan-event-batch",
		error: EventCreateWorkflowError satisfies DurableSchema,
		success: Schema.Array(LifecycleDispatchPlan) satisfies DurableSchema,
		execute: eventRootTransaction(
			session,
			"Event workflow transaction already active",
		)(planner.planBatch(eventCreateBatchInput(payload))),
	});
});

const hasPreparedEventBatch = Effect.fnUntraced(function* (payload: EventCreateWorkflowPayload) {
	const receipts = yield* MutationReceipts.make;
	return yield* receipts
		.peekBatch(
			receipts.batchIdentity({
				...eventCreateBatchInput(payload),
				ownerUserId:
					payload.command.causation.initiator.kind === "user"
						? payload.command.causation.initiator.id
						: null,
			}),
		)
		.pipe(Effect.mapError(eventReceiptError));
});

export const runEventCreateWorkflow = Effect.fn("EventCreateWorkflow")(function* (
	payload: EventCreateWorkflowPayload,
	executionId: string,
) {
	yield* Effect.annotateCurrentSpan({ executionId, userId: payload.userId });
	const receipts = yield* MutationReceipts.make;
	yield* admitWorkflow(
		receipts,
		EventCreateWorkflow,
		payload.command.accountGeneration,
		executionId,
	);
	const execution = yield* LifecycleExecution;
	yield* Workflow.addFinalizer(() =>
		Effect.gen(function* () {
			const instance = yield* WorkflowInstance;
			if (!instance.interrupted) {
				return;
			}
			if (yield* hasPreparedEventBatch(payload)) {
				// Queued runs are recovered by reconciliation after this parent is cancelled.
				yield* planEventBatch(payload);
			}
		}).pipe(
			Effect.catchCause((cause) => Effect.logError("event batch cancellation failed", cause)),
		),
	);
	const outcomes: EventCreateItemOutcome[] = [];
	const warnings: AutomationWarning[] = [];
	const subjects = new Map<string, AutomationHookIdentity[]>();
	let count = 0;
	const preparedAny = yield* Ref.make(false);
	let failure: { index: number; reason: EventCreateFailureReason } | null = null;
	for (const [index, item] of payload.payload.entries()) {
		const processed = subjects.get(item.entityId.trim()) ?? [];
		subjects.set(item.entityId.trim(), processed);
		const attempt = yield* Effect.gen(function* () {
			const prepared = yield* prepareItem(payload, index, [...processed]);
			yield* Ref.set(preparedAny, true);
			if (prepared._tag === "Committed") {
				return {
					kind: "written" as const,
					committed: { ...prepared.result, dispatch: prepared.dispatch },
				};
			}
			const policy =
				prepared.plan === null
					? {
							draft: prepared.draft,
							kind: "ready" as const,
							capturedReferences: prepared.capturedReferences,
						}
					: yield* runEventCreatePolicies(
							payload,
							index,
							prepared.plan,
							prepared.propertiesSchema,
							processed,
							prepared.capturedReferences,
						);
			if (policy.kind === "skipped") {
				return policy;
			}
			return {
				kind: "written" as const,
				committed: yield* writeEvent(
					payload,
					index,
					{ ...prepared, capturedReferences: policy.capturedReferences },
					policy.draft,
					processed,
				),
			};
		}).pipe(
			Effect.catchTag("EventCreateItemError", (error) =>
				Effect.succeed({ reason: error.reason, kind: "failed" as const }),
			),
		);
		if (attempt.kind === "failed") {
			failure = { index, reason: attempt.reason };
			break;
		}
		if (attempt.kind === "skipped") {
			outcomes.push({ index, reason: attempt.reason, status: "skipped_by_policy" });
			continue;
		}
		const { eventId, dispatch, processed: recordedPolicies } = attempt.committed;
		subjects.set(item.entityId.trim(), [...recordedPolicies]);
		outcomes.push({ index, eventId, status: "written" });
		count += 1;
		warnings.push(
			...(yield* execution
				.dispatch(dispatch)
				.pipe(Effect.catchTag("LifecyclePersistenceError", Effect.die))),
		);
	}
	if (
		(yield* Ref.get(preparedAny)) ||
		(failure !== null && (yield* hasPreparedEventBatch(payload)))
	) {
		warnings.push(
			...(yield* execution
				.dispatch(yield* planEventBatch(payload))
				.pipe(Effect.catchTag("LifecyclePersistenceError", Effect.die))),
		);
	}
	return { count, failure, outcomes, warnings };
});

export const EventCreateWorkflowDefinitionsLive = implementWorkflow(
	EventCreateWorkflow,
	runEventCreateWorkflow,
);
