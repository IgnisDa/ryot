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
	EventCreateFailureReason,
	EventCreateItemError,
	type EventCreateItemOutcome,
} from "@ryot-app/contract/modules/events/schemas";
import { definitionOwner } from "@ryot-app/contract/modules/plugins/references";
import { AutomationRunId, EventId } from "@ryot-app/contract/schema/brands";
import { AppSchema } from "@ryot-app/contract/schema/property-schema";
import { sha256Base64Url } from "@ryot-app/ts-utils/crypto";
import { stableStringify } from "@ryot-app/ts-utils/json";
import { Data, DateTime, Effect, Schema } from "effect";
import { Workflow } from "effect/workflow";
import { WorkflowInstance } from "effect/workflow/WorkflowEngine";

import type { DurableSchema } from "#boot/workflow-engine";
import { lifecycleTrigger } from "#modules/automations/lifecycle/command";
import { LifecycleExecution } from "#modules/automations/lifecycle/execution";
import {
	LifecycleDispatchPlan,
	LifecyclePlanner,
	toLifecycleDispatchPlan,
} from "#modules/automations/lifecycle/planning";
import { EventSchemaReader } from "#modules/definitions/event-schemas";
import { parseAppSchemaProperties } from "#modules/definitions/properties/runtime";
import { EntitiesRepository } from "#modules/entities/repository";
import {
	assertStableUnder,
	type DomainLifecycleCommand,
	DomainWriteChecks,
	writerPropertiesSchema,
} from "#modules/entities/write-context";
import { type MutationReceiptIdentity, MutationReceipts } from "#modules/mutations/receipts";
import { admitWorkflow } from "#modules/mutations/workflow-dispatch";
import {
	CatalogDefinitionFingerprint,
	catalogDefinitionFingerprint,
} from "#modules/plugins/catalog/runtime-resolver";
import { principalOwner } from "#modules/scripts/authorization/principal";
import { DatabaseSession } from "#platform/db/session";
import { implementWorkflow, makeActivity } from "#platform/workflow/scope";

import {
	EventCreateWorkflow,
	EventCreateWorkflowError,
	type EventCreateWorkflowPayload,
} from "./event-create-workflow";
import {
	CapturedEventReferences,
	readEventCreateChunkScopes,
	resolveEventCreateItemScopes,
	validateCapturedEventReferences,
} from "./event-creation";
import { runEventCreatePolicies } from "./event-policy-engine";
import {
	EventCreateReceiptResult,
	eventCreateBatchInput,
	eventCreateWriteCommand,
	eventCreateReceiptIdentity,
	eventCreateReceiptError,
} from "./mutation-receipts";
import { EventsRepository } from "./repository";
import { eventRootTransaction } from "./transaction";

const EVENT_CREATE_CHUNK_SIZE = 50;

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
const PendingItem = Schema.Struct({
	plan: Plan,
	draft: AutomationEventDraft,
	propertiesSchema: AppSchema,
	eventSchemaName: Schema.String,
	capturedReferences: CapturedEventReferences,
	eventSchemaPluginId: Schema.NullOr(Schema.String),
	eventSchemaFingerprint: CatalogDefinitionFingerprint,
});
type PendingItem = typeof PendingItem.Type;
const WrittenItem = Schema.Struct({
	index: Schema.Int,
	dispatch: Schema.Array(LifecycleDispatchPlan),
	...EventCreateReceiptResult.fields,
});
const PreparedChunk = Schema.Union([
	Schema.TaggedStruct("Prepared", {
		written: Schema.Array(WrittenItem),
		pending: Schema.NullOr(Schema.Struct({ index: Schema.Int, ...PendingItem.fields })),
	}),
	Schema.TaggedStruct("Failed", { index: Schema.Int, reason: EventCreateFailureReason }),
]);

class EventCreateChunkItemError extends Data.TaggedError("EventCreateChunkItemError")<{
	readonly index: number;
	readonly reason: EventCreateFailureReason;
}> {}

const hasAfterHookRun = (dispatch: ReadonlyArray<LifecycleDispatchPlan>) =>
	dispatch.some((plan) => plan.runs.length > 0);

const eventPropertiesSchema = (
	command: DomainLifecycleCommand,
	scope: { readonly pluginId: string | null },
	propertiesSchema: AppSchema,
) =>
	command.writeContext?.pluginRevision && scope.pluginId !== null
		? writerPropertiesSchema(propertiesSchema)
		: propertiesSchema;

const commitEvent = Effect.fnUntraced(function* (
	payload: EventCreateWorkflowPayload,
	index: number,
	prepared: Pick<PendingItem, "eventSchemaName" | "eventSchemaPluginId"> & {
		readonly parentTriggerId: AutomationTrigger["id"] | null;
	},
	draft: AutomationEventDraft,
	entitySchemaPluginId: string | null,
) {
	const repository = yield* EventsRepository;
	const planner = yield* LifecyclePlanner;
	const command = eventCreateWriteCommand(payload, index);
	const event = yield* repository.createEvent({
		...draft,
		userId: payload.userId,
		properties: { ...draft.properties },
		eventSchemaName: prepared.eventSchemaName,
		eventSchemaPluginId: prepared.eventSchemaPluginId,
		sessionEntityId: draft.sessionEntityId ?? undefined,
		occurredAt: DateTime.toDate(DateTime.makeUnsafe(draft.occurredAt)),
		id: EventId.make(
			`event_${sha256Base64Url(stableStringify([command.causation.executionId, command.itemIdentity]))}`,
		),
	});
	const after = yield* Schema.decodeUnknownEffect(AutomationEventSnapshot)({
		...draft,
		id: event.id,
		entitySchemaPluginId,
		entityId: event.entityId,
		createdAt: event.createdAt,
		updatedAt: event.updatedAt,
		properties: event.properties,
		occurredAt: event.occurredAt,
		eventSchemaSlug: event.eventSchemaSlug,
		eventSchemaPluginId: event.eventSchemaPluginId,
		sessionEntityId: event.sessionEntityId ?? null,
	}).pipe(Effect.mapError(() => new DbError({ message: "Invalid persisted event snapshot" })));
	const plan = yield* planner.plan({
		trigger: lifecycleTrigger(
			{
				...command,
				causation: {
					...command.causation,
					parentTriggerId: prepared.parentTriggerId ?? command.causation.parentTriggerId,
				},
			},
			payload.userId,
			{ after, resource: "event", category: "change", operation: "create" },
		),
	});
	return {
		eventId: event.id,
		dispatch: plan.trigger === null ? [] : [toLifecycleDispatchPlan(plan)],
		evidence: {
			after,
			resource: "event" as const,
			category: "change" as const,
			operation: "create" as const,
		},
	};
});

const lookupChunkReceipts = Effect.fnUntraced(function* (
	identities: ReadonlyArray<MutationReceiptIdentity>,
) {
	const receipts = yield* MutationReceipts.make;
	return yield* receipts.lookupMany(identities, EventCreateReceiptResult).pipe(
		Effect.map((replays) => ({ replays, conflictAt: null })),
		Effect.catchTag("MutationReceiptIdentityConflict", ({ receiptId }) => {
			const conflictAt = identities.findIndex(({ id }) => id === receiptId);
			return receipts
				.lookupMany(identities.slice(0, conflictAt), EventCreateReceiptResult)
				.pipe(Effect.map((replays) => ({ replays, conflictAt })));
		}),
	);
});

const prepareChunk = Effect.fn("prepareEventCreateChunk")(function* (
	payload: EventCreateWorkflowPayload,
	first: number,
	subjects: ReadonlyMap<string, ReadonlyArray<AutomationHookIdentity>>,
) {
	const planner = yield* LifecyclePlanner;
	const session = yield* DatabaseSession;
	const writes = yield* DomainWriteChecks;
	const eventSchemas = yield* EventSchemaReader;
	const receipts = yield* MutationReceipts.make;
	const writeAuthority = payload.writeCommand ?? payload.command;
	const window = payload.payload
		.slice(first, first + EVENT_CREATE_CHUNK_SIZE)
		.map((item, offset) => ({ item, index: first + offset }));
	const work = Effect.gen(function* () {
		yield* eventSchemas.lockCatalog();
		yield* writes
			.check(payload.command, principalOwner(payload.command.writeContext), payload.userId, true)
			.pipe(Effect.mapError((error) => new DbError({ message: error.message })));
		const scopes = yield* readEventCreateChunkScopes({
			userId: payload.userId,
			writeCommand: writeAuthority,
			items: window.map(({ item }) => item),
			commands: [payload.command, writeAuthority],
		});
		const batch = yield* planner.prepareBatch({
			...eventCreateBatchInput(payload),
			scopes: [payload.userId],
		});
		const identities = window.map(({ item, index }) =>
			eventCreateReceiptIdentity(payload, index, item),
		);
		const { replays, conflictAt } = yield* lookupChunkReceipts(identities);
		const excluded = new Map(subjects);
		const written: Array<typeof WrittenItem.Type> = [];
		const records: Array<Parameters<typeof receipts.insertMany>[0][number]> = [];
		let pending: (PendingItem & { readonly index: number }) | null = null;
		for (const [offset, { item, index }] of window.entries()) {
			const subject = item.entityId.trim();
			const identity = identities[offset];
			if (!identity) {
				return yield* Effect.die("Missing event receipt identity");
			}
			const prepared = yield* Effect.gen(function* () {
				if (offset === conflictAt) {
					return yield* new EventCreateItemError({ reason: { code: "mutation-conflict" } });
				}
				const replay = replays[offset];
				if (replay) {
					return { _tag: "Written" as const, ...replay.result, dispatch: replay.dispatch };
				}
				const scope = yield* scopes.resolve(
					{
						...item,
						occurredAt:
							item.occurredAt === undefined || item.occurredAt === ""
								? writeAuthority.occurredAt
								: item.occurredAt,
					},
					payload.command,
				);
				const draft = yield* Schema.decodeUnknownEffect(AutomationEventDraft)({
					entityId: scope.entityId,
					properties: item.properties,
					occurredAt: scope.occurredAt.toISOString(),
					eventSchemaSlug: scope.eventSchemaScope.id,
					sessionEntityId: scope.sessionEntityId ?? null,
					entitySchemaSlug: scope.entityScope.entitySchemaSlug,
					eventSchemaPluginId: scope.eventSchemaScope.pluginId ?? null,
					entitySchemaPluginId: scope.entityScope.entitySchemaPluginId,
				}).pipe(
					Effect.mapError(
						() => new EventCreateItemError({ reason: { code: "invalid-properties" } }),
					),
				);
				const capturedReferences = yield* scopes.capture(draft);
				const plan = yield* planner.plan({
					excludedOncePerSubjectPolicies: [...(excluded.get(subject) ?? [])],
					trigger: lifecycleTrigger(eventCreateWriteCommand(payload, index), payload.userId, {
						draft,
						resource: "event",
						category: "request",
						operation: "create",
					}),
				});
				const propertiesSchema = eventPropertiesSchema(
					payload.command,
					scope.eventSchemaScope,
					scope.eventSchemaScope.propertiesSchema,
				);
				if (plan.trigger !== null) {
					return {
						draft,
						propertiesSchema,
						capturedReferences,
						_tag: "Pending" as const,
						eventSchemaName: scope.eventSchemaScope.name,
						eventSchemaPluginId: scope.eventSchemaScope.pluginId ?? null,
						eventSchemaFingerprint: catalogDefinitionFingerprint(scope.eventSchemaScope),
						plan: {
							...plan,
							policies: plan.policies.map((policy) => ({
								runId: policy.runId,
								position: policy.position,
								batchFrequency: policy.batchFrequency,
							})),
						},
					};
				}
				const properties = yield* parseAppSchemaProperties({
					kind: "Event",
					propertiesSchema,
					properties: draft.properties,
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
				const command = eventCreateWriteCommand(payload, index);
				yield* scopes
					.check(command, definitionOwner(scope.eventSchemaScope.pluginId ?? null))
					.pipe(Effect.mapError((error) => new DbError({ message: error.message })));
				const current = yield* scopes.resolve(
					{ ...validated, sessionEntityId: validated.sessionEntityId ?? undefined },
					command,
				);
				if (
					stableStringify(catalogDefinitionFingerprint(current.eventSchemaScope)) !==
					stableStringify(catalogDefinitionFingerprint(scope.eventSchemaScope))
				) {
					return yield* new EventCreateItemError({
						reason: { code: "event-schema-not-found", eventSchemaSlug: validated.eventSchemaSlug },
					});
				}
				yield* assertStableUnder(
					"Event",
					eventPropertiesSchema(command, current.eventSchemaScope, current.activePropertiesSchema),
					validated.properties,
					() => new EventCreateItemError({ reason: { code: "invalid-properties" } }),
				);
				const committed = yield* commitEvent(
					payload,
					index,
					{
						parentTriggerId: null,
						eventSchemaName: scope.eventSchemaScope.name,
						eventSchemaPluginId: scope.eventSchemaScope.pluginId ?? null,
					},
					validated,
					current.entityScope.entitySchemaPluginId,
				);
				records.push({
					identity,
					batchId: batch.id,
					batchIndex: index,
					dispatch: committed.dispatch,
					result: { processed: [], eventId: committed.eventId },
					evidence: batch.hasCandidates ? committed.evidence : undefined,
				});
				return {
					processed: [],
					_tag: "Written" as const,
					eventId: committed.eventId,
					dispatch: committed.dispatch,
				};
			}).pipe(
				Effect.catchTag("EventCreateItemError", ({ reason }) =>
					Effect.fail(new EventCreateChunkItemError({ index, reason })),
				),
			);
			if (prepared._tag === "Pending") {
				pending = { ...prepared, index };
				break;
			}
			excluded.set(subject, [...prepared.processed]);
			written.push({
				index,
				eventId: prepared.eventId,
				dispatch: prepared.dispatch,
				processed: prepared.processed,
			});
			if (hasAfterHookRun(prepared.dispatch)) {
				break;
			}
		}
		yield* receipts.insertMany(records);
		return { written, pending, _tag: "Prepared" as const };
	});
	return yield* makeActivity({
		name: `prepare-chunk-${first}`,
		success: PreparedChunk satisfies DurableSchema,
		error: EventCreateWorkflowError satisfies DurableSchema,
		execute: eventRootTransaction(
			session,
			"Event workflow transaction already active",
		)(work).pipe(
			Effect.catchTag("EventCreateChunkItemError", ({ index, reason }) =>
				Effect.succeed({ index, reason, _tag: "Failed" as const }),
			),
		),
	});
});

const writeEvent = Effect.fn("writeEventCreateItem")(function* (
	payload: EventCreateWorkflowPayload,
	index: number,
	prepared: PendingItem,
	draft: AutomationEventDraft,
	processed: ReadonlyArray<AutomationHookIdentity>,
) {
	const entities = yield* EntitiesRepository;
	const eventSchemas = yield* EventSchemaReader;
	const planner = yield* LifecyclePlanner;
	const session = yield* DatabaseSession;
	const writes = yield* DomainWriteChecks;
	const receipts = yield* MutationReceipts.make;
	const command = eventCreateWriteCommand(payload, index);
	const item = payload.payload[index];
	if (!item) {
		return yield* Effect.die("Missing event batch item");
	}
	return yield* makeActivity({
		name: `write-event-${index}`,
		error: EventCreateWorkflowError satisfies DurableSchema,
		success: Schema.Struct({
			dispatch: Schema.Array(LifecycleDispatchPlan),
			...EventCreateReceiptResult.fields,
		}) satisfies DurableSchema,
		execute: eventRootTransaction(
			session,
			"Event workflow transaction already active",
		)(
			Effect.gen(function* () {
				yield* eventSchemas.lockCatalog();
				yield* writes
					.check(command, definitionOwner(prepared.eventSchemaPluginId), payload.userId, true)
					.pipe(Effect.mapError((error) => new DbError({ message: error.message })));
				const batch = yield* planner.prepareBatch({
					...eventCreateBatchInput(payload),
					scopes: [payload.userId],
				});
				const identity = eventCreateReceiptIdentity(payload, index, item);
				const replay = yield* receipts
					.lookup(identity, EventCreateReceiptResult)
					.pipe(Effect.mapError(eventCreateReceiptError));
				if (replay) {
					return { ...replay.result, dispatch: replay.dispatch };
				}
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
					command,
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
				yield* assertStableUnder(
					"Event",
					eventPropertiesSchema(
						command,
						currentScope.eventSchemaScope,
						currentScope.activePropertiesSchema,
					),
					draft.properties,
					() => new EventCreateItemError({ reason: { code: "invalid-properties" } }),
				);
				yield* validateCapturedEventReferences(payload.userId, draft, prepared.capturedReferences);
				const committed = yield* commitEvent(
					payload,
					index,
					{ ...prepared, parentTriggerId: prepared.plan.trigger.id },
					draft,
					currentScope.entityScope.entitySchemaPluginId,
				);
				yield* receipts.insert({
					identity,
					batchId: batch.id,
					batchIndex: index,
					dispatch: committed.dispatch,
					evidence: batch.hasCandidates ? committed.evidence : undefined,
					result: { processed: [...processed], eventId: committed.eventId },
				});
				return {
					processed: [...processed],
					eventId: committed.eventId,
					dispatch: committed.dispatch,
				};
			}),
		),
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
		.pipe(Effect.mapError(eventCreateReceiptError));
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
	let preparedAny = false;
	let failure: { index: number; reason: EventCreateFailureReason } | null = null;
	let first = 0;
	while (first < payload.payload.length) {
		const chunk = yield* prepareChunk(payload, first, subjects);
		if (chunk._tag === "Failed") {
			failure = { index: chunk.index, reason: chunk.reason };
			break;
		}
		preparedAny = true;
		for (const { index, eventId, dispatch, processed } of chunk.written) {
			subjects.set(payload.payload[index]?.entityId.trim() ?? "", [...processed]);
			outcomes.push({ index, eventId, status: "written" });
			count += 1;
			warnings.push(
				...(yield* execution
					.dispatch(dispatch)
					.pipe(Effect.catchTag("LifecyclePersistenceError", Effect.die))),
			);
		}
		const pending = chunk.pending;
		if (pending === null) {
			first += chunk.written.length;
			continue;
		}
		first = pending.index + 1;
		const subject = payload.payload[pending.index]?.entityId.trim() ?? "";
		const processed = subjects.get(subject) ?? [];
		subjects.set(subject, processed);
		const attempt = yield* Effect.gen(function* () {
			const policy = yield* runEventCreatePolicies(
				payload,
				pending.index,
				pending.plan,
				pending.propertiesSchema,
				processed,
				pending.capturedReferences,
			);
			if (policy.kind === "skipped") {
				return policy;
			}
			return {
				kind: "written" as const,
				committed: yield* writeEvent(
					payload,
					pending.index,
					{ ...pending, capturedReferences: policy.capturedReferences },
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
			failure = { index: pending.index, reason: attempt.reason };
			break;
		}
		if (attempt.kind === "skipped") {
			outcomes.push({ index: pending.index, reason: attempt.reason, status: "skipped_by_policy" });
			continue;
		}
		subjects.set(subject, [...attempt.committed.processed]);
		outcomes.push({ status: "written", index: pending.index, eventId: attempt.committed.eventId });
		count += 1;
		warnings.push(
			...(yield* execution
				.dispatch(attempt.committed.dispatch)
				.pipe(Effect.catchTag("LifecyclePersistenceError", Effect.die))),
		);
	}
	if (preparedAny || (failure !== null && (yield* hasPreparedEventBatch(payload)))) {
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
