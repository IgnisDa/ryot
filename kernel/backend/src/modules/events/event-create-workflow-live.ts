import { DbError } from "@ryot-app/contract/errors";
import type {
	AutomationHookIdentity,
	AutomationWarning,
} from "@ryot-app/contract/modules/automations/lifecycle";
import {
	CreateEventsResponse,
	type EventCreateFailureReason,
	EventCreateItemError,
	type EventCreateItemOutcome,
} from "@ryot-app/contract/modules/events/schemas";
import { EventId } from "@ryot-app/contract/schema/brands";
import { Effect, Option, Schema } from "effect";
import { Workflow } from "effect/workflow";
import { WorkflowInstance } from "effect/workflow/WorkflowEngine";

import { LifecycleExecution } from "#modules/automations/lifecycle/execution";
import { LifecycleDispatchPlan, LifecyclePlanner } from "#modules/automations/lifecycle/planning";
import {
	planPolicyBatch,
	type PolicyBatchResult,
	PolicyBatchWorkflow,
	runPolicyBatchDirect,
	unchangedPolicyBatch,
} from "#modules/automations/lifecycle/policy-batch";
import type { EntitiesRepository } from "#modules/entities/repository";
import { mutationReceiptIdentity, MutationReceipts } from "#modules/mutations/receipts";
import { admitWorkflow } from "#modules/mutations/workflow-dispatch";
import { DatabaseSession } from "#platform/db/session";
import { implementWorkflow, makeActivity } from "#platform/workflow/scope";

import {
	EventCreateWorkflow,
	EventCreateWorkflowError,
	type EventCreateWorkflowPayload,
} from "./event-create-workflow";
import { eventCreateBatchInput, eventCreateReceiptIdentity } from "./mutation-receipts";
import { EventMutations, PreparedEventChanges } from "./mutations";

const chunkSize = 50;
const CommittedChunk = Schema.Struct({
	dispatch: Schema.Array(LifecycleDispatchPlan),
	results: Schema.Array(Schema.Struct({ eventId: EventId, itemIdentity: Schema.String })),
});

class DirectCreateDeclined extends Schema.TaggedError<
	DirectCreateDeclined,
	{ readonly brand: unique symbol }
>()("DirectCreateDeclined", {}) {}

const operationReceiptOf = (
	payload: EventCreateWorkflowPayload,
	batch: ReturnType<typeof eventCreateBatchInput>,
) =>
	mutationReceiptIdentity({
		input: batch.commandInput,
		ownerUserId: payload.userId,
		scopeUserId: payload.userId,
		commandKind: "event:create-operation",
		command: { ...payload.command, itemIdentity: `${payload.command.itemIdentity}:operation` },
	});

const chunkOf = (payload: EventCreateWorkflowPayload, first: number) => {
	const changes = payload.payload
		.slice(first, first + chunkSize)
		.map((item, offset) => ({
			item,
			kind: "create" as const,
			itemIdentity: payload.itemIdentities?.[first + offset] ?? `event:${first + offset}`,
		}));
	const indexOf = (itemIdentity: string) =>
		first + changes.findIndex((item) => item.itemIdentity === itemIdentity);
	return { changes, indexOf };
};

const prepareChunk = (
	mutations: EventMutations["Service"],
	payload: EventCreateWorkflowPayload,
	first: number,
) => {
	const { changes, indexOf } = chunkOf(payload, first);
	return mutations
		.prepare({
			changes,
			independent: true,
			positionOffset: first,
			userId: payload.userId,
			command: payload.writeCommand ?? payload.command,
		})
		.pipe(
			Effect.map((prepared) => ({
				...prepared,
				items: prepared.items.map((item) => ({
					...item,
					receipt:
						item.change.kind === "create"
							? eventCreateReceiptIdentity(
									payload,
									indexOf(item.change.itemIdentity),
									item.change.item,
								)
							: item.receipt,
				})),
			})),
		);
};

const policyBatchOf = (
	payload: EventCreateWorkflowPayload,
	prepared: PreparedEventChanges,
	first: number,
	subjects: ReadonlyMap<string, ReadonlyArray<AutomationHookIdentity>>,
) => ({
	userId: payload.userId,
	resource: "event" as const,
	references: prepared.references,
	propertiesSchemas: prepared.propertiesSchemas,
	command: {
		...payload.command,
		itemIdentity: `${payload.command.itemIdentity}:policies:${first}`,
	},
	items: prepared.items.map((item) => ({
		itemIdentity: item.change.itemIdentity,
		schemaKey: item.schemaFingerprint.digest,
		request: {
			draft: item.draft,
			resource: "event" as const,
			category: "request" as const,
			operation: "create" as const,
			excludedOncePerSubjectPolicies: [...(subjects.get(item.draft.entityId) ?? [])],
		},
	})),
});

const policyOutcomes = (
	validated: PolicyBatchResult,
	indexOf: (itemIdentity: string) => number,
) => {
	const outcomes: EventCreateItemOutcome[] = [];
	for (const item of validated.items) {
		if (item.rejected !== null) {
			outcomes.push({
				reason: item.rejected,
				status: "skipped_by_policy",
				index: indexOf(item.itemIdentity),
			});
		}
		if (item.error !== null) {
			const reason: EventCreateFailureReason =
				item.error.code === "reference-not-found" && item.error.entityId !== undefined
					? { entityId: item.error.entityId, code: "session-entity-not-found" }
					: { code: "invalid-properties" };
			outcomes.push({ reason, status: "failed", index: indexOf(item.itemIdentity) });
		}
	}
	const accepted = new Set(
		validated.items
			.filter((item) => item.rejected === null && item.error === null)
			.map((item) => item.itemIdentity),
	);
	return { outcomes, accepted };
};

const persistChunk = (
	mutations: EventMutations["Service"],
	payload: EventCreateWorkflowPayload,
	input: {
		first: number;
		validated: PolicyBatchResult;
		accepted: ReadonlySet<string>;
		prepared: PreparedEventChanges;
		batch: ReturnType<typeof eventCreateBatchInput>;
	},
) =>
	mutations.persist({
		sealBatch: false,
		batch: input.batch,
		userId: payload.userId,
		validated: input.validated,
		batchIndexOffset: input.first,
		command: payload.writeCommand ?? payload.command,
		prepared: {
			...input.prepared,
			items: input.prepared.items.filter((item) => input.accepted.has(item.change.itemIdentity)),
		},
	});

const writtenOutcomes = (
	committed: typeof CommittedChunk.Type,
	indexOf: (itemIdentity: string) => number,
): EventCreateItemOutcome[] =>
	committed.results.map((result) => ({
		status: "written",
		eventId: result.eventId,
		index: indexOf(result.itemIdentity),
	}));

const createResult = (
	outcomes: ReadonlyArray<EventCreateItemOutcome>,
	warnings: ReadonlyArray<AutomationWarning>,
) => {
	const sorted = [...outcomes].sort((left, right) => left.index - right.index);
	const failed = sorted.find((outcome) => outcome.status === "failed");
	return {
		warnings,
		outcomes: sorted,
		count: sorted.filter((outcome) => outcome.status === "written").length,
		failure: failed ? { index: failed.index, reason: failed.reason } : null,
	};
};

/**
 * Creates up to one chunk of events without `EventCreateWorkflow`: in one transaction when no policy matches, or
 * in two around the policies, run outside a workflow. Returns none when the create needs the workflow;
 * a decline leaves nothing the workflow would not find again under the same command identity.
 */
export const makeDirectEventCreate = Effect.gen(function* () {
	const receipts = yield* MutationReceipts.make;
	const execution = yield* LifecycleExecution;
	const mutations = yield* EventMutations;
	const planner = yield* LifecyclePlanner;
	const policyContext = yield* Effect.context<EntitiesRepository | LifecycleExecution>();
	return Effect.fn("EventCreate.direct")(function* (payload: EventCreateWorkflowPayload) {
		if (payload.payload.length > chunkSize) {
			return Option.none();
		}
		const batch = eventCreateBatchInput(payload);
		const identity = operationReceiptOf(payload, batch);
		const { indexOf } = chunkOf(payload, 0);
		const record = Effect.fnUntraced(function* (
			prepared: PreparedEventChanges,
			outcomes: ReadonlyArray<EventCreateItemOutcome>,
			written: typeof CommittedChunk.Type,
		) {
			const dispatch = [...written.dispatch, ...(yield* planner.planBatch(batch))];
			const result = createResult(
				[
					...prepared.failures.map(({ reason, itemIdentity }) => ({
						reason,
						status: "failed" as const,
						index: indexOf(itemIdentity),
					})),
					...outcomes,
					...writtenOutcomes(written, indexOf),
				],
				[],
			);
			yield* receipts.insert({ result, dispatch, identity });
			return { result, dispatch, replayed: false, kind: "written" as const };
		});
		const commit = Effect.fnUntraced(function* (
			prepared: PreparedEventChanges,
			validated: PolicyBatchResult,
		) {
			const policy = policyOutcomes(validated, indexOf);
			const written =
				policy.accepted.size === 0
					? { results: [], dispatch: [] }
					: yield* persistChunk(mutations, payload, {
							batch,
							prepared,
							first: 0,
							validated,
							accepted: policy.accepted,
						});
			return yield* record(prepared, policy.outcomes, written);
		});
		// Fails what the policies left, or every prepared item without a policy result, as the workflow does.
		const fail = (
			prepared: PreparedEventChanges,
			validated: null | PolicyBatchResult,
			reason: EventCreateFailureReason,
		) => {
			const policy = validated === null ? null : policyOutcomes(validated, indexOf);
			const failed = (policy?.accepted ?? prepared.items.map((item) => item.change.itemIdentity))
				.values()
				.map((itemIdentity) => ({
					reason,
					status: "failed" as const,
					index: indexOf(itemIdentity),
				}));
			return mutations
				.transaction(
					record(prepared, [...(policy?.outcomes ?? []), ...failed], { results: [], dispatch: [] }),
				)
				.pipe(
					Effect.catchIf(
						(error) => error._tag !== "DbError" && error._tag !== "DatabaseSessionStateError",
						() => new DbError({ message: "Event creation failed" }),
					),
				);
		};
		const started = yield* mutations
			.transaction(
				Effect.gen(function* () {
					const replay = yield* receipts.peek(identity, CreateEventsResponse);
					if (replay) {
						return {
							replayed: true,
							result: replay.result,
							kind: "written" as const,
							dispatch: replay.dispatch,
						};
					}
					yield* planner.prepareBatch({ ...batch, scopes: [payload.userId] });
					const prepared = yield* prepareChunk(mutations, payload, 0);
					const policyBatch = policyBatchOf(payload, prepared, 0, new Map());
					const plan = yield* planPolicyBatch(policyBatch).pipe(
						Effect.provideService(LifecyclePlanner, planner),
					);
					if (plan.trigger === null) {
						return yield* commit(prepared, unchangedPolicyBatch(policyBatch, null));
					}
					if (plan.trigger.blockedReason) {
						return yield* new DirectCreateDeclined();
					}
					return { plan, prepared, policyBatch, kind: "policies" as const };
				}),
			)
			.pipe(Effect.orElseSucceed(() => null));
		const written =
			started === null || started.kind === "written"
				? started
				: yield* runPolicyBatchDirect(started.policyBatch, started.plan).pipe(
						Effect.provideContext(policyContext),
						Effect.flatMap((validated) =>
							mutations.transaction(commit(started.prepared, validated)).pipe(
								Effect.catchIf(
									(error) => error._tag !== "DbError" && error._tag !== "DatabaseSessionStateError",
									(error) =>
										fail(started.prepared, validated, {
											code:
												error._tag === "EventBadRequest" && error.reason.code === "asset-forbidden"
													? "asset-forbidden"
													: "mutation-conflict",
										}),
								),
							),
						),
						Effect.catchTags({
							PolicyBatchBlocked: (error) =>
								fail(started.prepared, null, {
									triggerId: error.triggerId,
									code: "automation-limit-reached",
								}),
							AutomationPolicyExecutionError: (error) =>
								fail(started.prepared, null, {
									runId: error.runId,
									code: "policy-execution-failed",
								}),
						}),
						Effect.catchTag("DatabaseSessionStateError", Effect.die),
					);
		if (written === null) {
			return Option.none();
		}
		const warnings = yield* execution
			.dispatch(written.dispatch)
			.pipe(Effect.catchTag("LifecyclePersistenceError", Effect.die));
		return Option.some(
			written.replayed
				? written.result
				: { ...written.result, warnings: [...written.result.warnings, ...warnings] },
		);
	});
});

export const runEventCreateWorkflow = Effect.fn("EventCreateWorkflow")(function* (
	payload: EventCreateWorkflowPayload,
	executionId: string,
) {
	yield* Effect.annotateCurrentSpan({ executionId, userId: payload.userId });
	const receipts = yield* MutationReceipts.make;
	yield* admitWorkflow(payload.command.accountGeneration);
	const execution = yield* LifecycleExecution;
	const mutations = yield* EventMutations;
	const session = yield* DatabaseSession;
	const planner = yield* LifecyclePlanner;
	const batch = eventCreateBatchInput(payload);
	const operationReceipt = operationReceiptOf(payload, batch);
	const replay = yield* receipts
		.peek(operationReceipt, CreateEventsResponse)
		.pipe(
			Effect.catchTag(
				"MutationReceiptIdentityConflict",
				() => new EventCreateItemError({ reason: { code: "mutation-conflict" } }),
			),
		);
	if (replay) {
		yield* execution
			.dispatch(replay.dispatch)
			.pipe(Effect.catchTag("LifecyclePersistenceError", Effect.die));
		return replay.result;
	}
	yield* makeActivity({
		success: Schema.Void,
		name: "admit-event-batch",
		error: EventCreateWorkflowError,
		execute: session
			.transaction(planner.prepareBatch({ ...batch, scopes: [payload.userId] }))
			.pipe(Effect.asVoid, Effect.catchTag("DatabaseSessionStateError", Effect.die)),
	});
	yield* Workflow.addFinalizer(() =>
		Effect.gen(function* () {
			const instance = yield* WorkflowInstance;
			if (!instance.interrupted) {
				return;
			}
			yield* makeActivity({
				error: EventCreateWorkflowError,
				name: "seal-cancelled-event-batch",
				success: Schema.Array(LifecycleDispatchPlan),
				execute: session
					.transaction(planner.planBatch(batch))
					.pipe(Effect.catchTag("DatabaseSessionStateError", Effect.die)),
			});
		}).pipe(
			Effect.catchCause((cause) => Effect.logError("Event batch cancellation failed", cause)),
		),
	);
	const outcomes: EventCreateItemOutcome[] = [];
	const warnings: AutomationWarning[] = [];
	const dispatch: Array<LifecycleDispatchPlan> = [];
	const subjects = new Map<string, AutomationHookIdentity[]>();
	for (let first = 0; first < payload.payload.length; first += chunkSize) {
		const { changes, indexOf } = chunkOf(payload, first);
		yield* Effect.gen(function* () {
			const prepared = yield* makeActivity({
				success: PreparedEventChanges,
				name: `prepare-events-${first}`,
				error: EventCreateWorkflowError,
				execute: session.transaction(prepareChunk(mutations, payload, first)).pipe(
					Effect.catchTag("DatabaseSessionStateError", Effect.die),
					Effect.catchIf(
						(error) => error._tag !== "DbError" && error._tag !== "EventCreateItemError",
						() => new EventCreateItemError({ reason: { code: "invalid-properties" } }),
					),
				),
			});
			for (const failed of prepared.failures) {
				const index = indexOf(failed.itemIdentity);
				outcomes.push({ index, status: "failed", reason: failed.reason });
			}
			const validated = yield* PolicyBatchWorkflow.execute(
				policyBatchOf(payload, prepared, first, subjects),
			).pipe(
				Effect.catchTags({
					PolicyBatchBlocked: (error) =>
						new EventCreateItemError({
							reason: { triggerId: error.triggerId, code: "automation-limit-reached" },
						}),
					AutomationPolicyExecutionError: (error) =>
						new EventCreateItemError({
							reason: { runId: error.runId, code: "policy-execution-failed" },
						}),
				}),
			);
			for (const item of validated.items) {
				if (item.request.resource !== "event") {
					return yield* Effect.die("Invalid event policy batch");
				}
				const subject = item.request.draft.entityId;
				subjects.set(subject, [...(subjects.get(subject) ?? []), ...item.processed]);
			}
			const policy = policyOutcomes(validated, indexOf);
			outcomes.push(...policy.outcomes);
			if (policy.accepted.size === 0) {
				return undefined;
			}
			const committed = yield* makeActivity({
				success: CommittedChunk,
				name: `commit-events-${first}`,
				error: EventCreateWorkflowError,
				execute: mutations
					.transaction(
						persistChunk(mutations, payload, {
							batch,
							first,
							prepared,
							validated,
							accepted: policy.accepted,
						}),
					)
					.pipe(
						Effect.catchTag("DatabaseSessionStateError", Effect.die),
						Effect.catchIf(
							(error) => error._tag !== "DbError",
							(error) =>
								new EventCreateItemError({
									reason: {
										code:
											error._tag === "EventBadRequest" && error.reason.code === "asset-forbidden"
												? "asset-forbidden"
												: "mutation-conflict",
									},
								}),
						),
					),
			});
			outcomes.push(...writtenOutcomes(committed, indexOf));
			warnings.push(
				...(yield* execution
					.dispatch(committed.dispatch)
					.pipe(Effect.catchTag("LifecyclePersistenceError", Effect.die))),
			);
			dispatch.push(...committed.dispatch);
			return undefined;
		}).pipe(
			Effect.catchTag("EventCreateItemError", (error) =>
				Effect.sync(() => {
					for (const change of changes) {
						const index = indexOf(change.itemIdentity);
						if (outcomes.some((outcome) => outcome.index === index)) {
							continue;
						}
						outcomes.push({ index, status: "failed", reason: error.reason });
					}
				}),
			),
		);
	}
	const batchDispatch = yield* makeActivity({
		name: "seal-event-batch",
		error: EventCreateWorkflowError,
		success: Schema.Array(LifecycleDispatchPlan),
		execute: session
			.transaction(planner.planBatch(batch))
			.pipe(Effect.catchTag("DatabaseSessionStateError", Effect.die)),
	});
	dispatch.push(...batchDispatch);
	warnings.push(
		...(yield* execution
			.dispatch(batchDispatch)
			.pipe(Effect.catchTag("LifecyclePersistenceError", Effect.die))),
	);
	const result = createResult(outcomes, warnings);
	yield* makeActivity({
		success: Schema.Void,
		name: "record-event-operation",
		error: EventCreateWorkflowError,
		execute: session
			.transaction(receipts.insert({ result, dispatch, identity: operationReceipt }))
			.pipe(Effect.catchTag("DatabaseSessionStateError", Effect.die)),
	});
	return result;
});

export const EventCreateWorkflowDefinitionsLive = implementWorkflow(
	EventCreateWorkflow,
	runEventCreateWorkflow,
);
