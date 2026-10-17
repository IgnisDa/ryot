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
import { Effect, Schema } from "effect";
import { Workflow } from "effect/workflow";
import { WorkflowInstance } from "effect/workflow/WorkflowEngine";

import { LifecycleExecution } from "#modules/automations/lifecycle/execution";
import { LifecycleDispatchPlan, LifecyclePlanner } from "#modules/automations/lifecycle/planning";
import { PolicyBatchWorkflow } from "#modules/automations/lifecycle/policy-batch";
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
	const mutations = yield* EventMutations;
	const session = yield* DatabaseSession;
	const planner = yield* LifecyclePlanner;
	const batch = eventCreateBatchInput(payload);
	const operationReceipt = mutationReceiptIdentity({
		input: batch.commandInput,
		ownerUserId: payload.userId,
		scopeUserId: payload.userId,
		commandKind: "event:create-operation",
		command: { ...payload.command, itemIdentity: `${payload.command.itemIdentity}:operation` },
	});
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
	let count = 0;
	for (let first = 0; first < payload.payload.length; first += chunkSize) {
		const writeCommand = payload.writeCommand ?? payload.command;
		const changes = payload.payload
			.slice(first, first + chunkSize)
			.map((item, offset) => ({
				item,
				kind: "create" as const,
				itemIdentity: payload.itemIdentities?.[first + offset] ?? `event:${first + offset}`,
			}));
		const indexOf = (itemIdentity: string) =>
			first + changes.findIndex((item) => item.itemIdentity === itemIdentity);
		yield* Effect.gen(function* () {
			const prepared = yield* makeActivity({
				success: PreparedEventChanges,
				name: `prepare-events-${first}`,
				error: EventCreateWorkflowError,
				execute: session
					.transaction(
						mutations
							.prepare({
								changes,
								independent: true,
								positionOffset: first,
								command: writeCommand,
								userId: payload.userId,
							})
							.pipe(
								Effect.map((batchPrepared) => ({
									...batchPrepared,
									items: batchPrepared.items.map((item) => ({
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
							),
					)
					.pipe(
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
			const validated = yield* PolicyBatchWorkflow.execute({
				resource: "event",
				userId: payload.userId,
				references: prepared.references,
				command: {
					...payload.command,
					itemIdentity: `${payload.command.itemIdentity}:policies:${first}`,
				},
				items: prepared.items.map((item) => ({
					itemIdentity: item.change.itemIdentity,
					propertiesSchema: item.propertiesSchema,
					request: {
						draft: item.draft,
						resource: "event" as const,
						category: "request" as const,
						operation: "create" as const,
						excludedOncePerSubjectPolicies: subjects.get(item.draft.entityId) ?? [],
					},
				})),
			}).pipe(
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
					const failed = { reason, index: indexOf(item.itemIdentity) };
					outcomes.push({ ...failed, status: "failed" });
				}
			}
			const accepted = new Set(
				validated.items
					.filter((item) => item.rejected === null && item.error === null)
					.map((item) => item.itemIdentity),
			);
			if (accepted.size === 0) {
				return undefined;
			}
			const committed = yield* makeActivity({
				success: CommittedChunk,
				name: `commit-events-${first}`,
				error: EventCreateWorkflowError,
				execute: session
					.transaction(
						mutations.persist({
							batch,
							validated,
							sealBatch: false,
							command: writeCommand,
							userId: payload.userId,
							batchIndexOffset: first,
							prepared: {
								...prepared,
								items: prepared.items.filter((item) => accepted.has(item.change.itemIdentity)),
							},
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
			for (const result of committed.results) {
				outcomes.push({
					status: "written",
					eventId: result.eventId,
					index: indexOf(result.itemIdentity),
				});
				count += 1;
			}
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
	outcomes.sort((left, right) => left.index - right.index);
	const failed = outcomes.find((outcome) => outcome.status === "failed");
	const result = {
		count,
		outcomes,
		warnings,
		failure: failed ? { index: failed.index, reason: failed.reason } : null,
	};
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
