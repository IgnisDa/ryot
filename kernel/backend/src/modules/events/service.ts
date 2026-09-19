import { DbError } from "@ryot-app/contract/errors";
import {
	AutomationEventDraft,
	type AutomationEventChangePayload,
	type AutomationEventSnapshot,
	type AutomationRequestPayload,
	type AutomationWarning,
	LifecycleCommand,
} from "@ryot-app/contract/modules/automations/lifecycle";
import {
	type CreateEventItem,
	EventOperationNotFound,
	type EventCreateOperation,
} from "@ryot-app/contract/modules/events/schemas";
import type { EventId, AutomationTriggerId, UserId } from "@ryot-app/contract/schema/brands";
import {
	Cause,
	Clock,
	Context,
	DateTime,
	Duration,
	Effect,
	Layer,
	Option,
	Redacted,
	Schema,
} from "effect";
import { WorkflowEngine } from "effect/unstable/workflow/WorkflowEngine";

import {
	type CommittedLifecycleWork,
	LifecyclePersistenceError,
	LifecyclePlanner,
	toLifecycleDispatchPlan,
} from "#lib/domain/lifecycle";
import { lifecycleTrigger } from "#lib/domain/lifecycle-command";
import { LifecycleExecution } from "#lib/domain/lifecycle-execution";
import { AppConfig } from "#lib/infrastructure/config/service";
import { DatabaseSession } from "#lib/infrastructure/db/session";
import {
	createWorkflowJobId,
	deriveJobIdSecret,
	resolveWorkflowExecutionId,
} from "#lib/shared/job-id";
import { toWorkflowRunResult } from "#lib/shared/workflow-result";
import { MutationReceipts } from "#modules/mutations/receipts";
import { dispatchAdmittedWorkflow } from "#modules/mutations/workflow-dispatch";

import { enqueueEventCreate, EventCreateWorkflow } from "./event-create-workflow";
import {
	EventMutationReceiptResult,
	eventMutationReceiptIdentity,
	eventCreateBatchInput,
	eventReceiptError,
} from "./mutation-receipts";
import {
	EventsRepository,
	type EventIdentityInput,
	type UpdateEventEntityReferencesInput,
} from "./repository";
import { eventRootTransaction } from "./transaction";

type EventRequest = Extract<
	AutomationRequestPayload,
	{ resource: "event"; operation: "update" | "delete" }
>;
type PreparedEventMutationData = {
	readonly before: AutomationEventSnapshot;
	readonly command: LifecycleCommand;
	readonly input: EventIdentityInput;
	readonly requestId: AutomationTriggerId | null;
} & (
	| { readonly operation: "delete" }
	| { readonly operation: "update"; readonly move: UpdateEventEntityReferencesInput }
);
const preparedEventUpdate = Symbol("PreparedEventUpdate");
const preparedEventDelete = Symbol("PreparedEventDelete");
export type PreparedEventUpdate = {
	readonly [preparedEventUpdate]: Extract<PreparedEventMutationData, { operation: "update" }>;
};
export type PreparedEventDelete = {
	readonly [preparedEventDelete]: Extract<PreparedEventMutationData, { operation: "delete" }>;
};

const eventDraft = ({
	id: _id,
	createdAt: _createdAt,
	updatedAt: _updatedAt,
	...draft
}: AutomationEventSnapshot) => draft;

export class EventsService extends Context.Service<EventsService>()("EventsService", {
	make: Effect.gen(function* () {
		const engine = yield* WorkflowEngine;
		const config = yield* AppConfig;
		const operationSecret = deriveJobIdSecret(
			Redacted.value(config.server.adminAccessToken),
			"events-operation-id",
		);
		const repository = yield* EventsRepository;
		const session = yield* DatabaseSession;
		const planner = yield* LifecyclePlanner;
		const receipts = yield* MutationReceipts.make;
		const lookupReceipt = (
			input: EventIdentityInput,
			command: LifecycleCommand,
			move?: UpdateEventEntityReferencesInput,
			lock = true,
		) =>
			(lock ? receipts.lookup : receipts.peek)(
				eventMutationReceiptIdentity(input, command, move),
				EventMutationReceiptResult,
			).pipe(Effect.mapError(eventReceiptError));
		const execution = yield* LifecycleExecution;
		const verifyCreateBatchInput = (
			input: { userId: UserId; payload: ReadonlyArray<CreateEventItem> },
			command: LifecycleCommand,
		) =>
			receipts
				.peekBatch(
					receipts.batchIdentity({
						...eventCreateBatchInput({ ...input, command }),
						ownerUserId: input.userId,
					}),
				)
				.pipe(Effect.mapError(eventReceiptError));
		const transaction = eventRootTransaction(
			session,
			"Event lifecycle mutations require a root transaction boundary",
		);
		const assertRootTransaction = session.requireRoot.pipe(
			Effect.mapError(
				() =>
					new DbError({ message: "Event lifecycle mutations require a root transaction boundary" }),
			),
		);
		const assertActiveTransaction = session.requireTransaction.pipe(
			Effect.mapError(() => new LifecyclePersistenceError({ code: "active-transaction-required" })),
		);
		const create = Effect.fn("EventsService.create")(function* (
			input: {
				readonly userId: UserId;
				readonly payload: ReadonlyArray<CreateEventItem>;
				readonly itemIdentities?: ReadonlyArray<string>;
			},
			command: LifecycleCommand,
		) {
			if (input.payload.length === 0) {
				return { count: 0, outcomes: [], warnings: [], failure: null };
			}
			yield* verifyCreateBatchInput(input, command);
			const result = yield* enqueueEventCreate({ ...input, command }).pipe(
				Effect.provideService(WorkflowEngine, engine),
				Effect.provideService(DatabaseSession, session),
			);
			yield* verifyCreateBatchInput(input, command);
			return result;
		});
		const operationState = Effect.fn("EventsService.operationState")(function* (
			userId: UserId,
			executionId: string,
			totalItems: number,
		): Effect.fn.Return<Schema.Schema.Type<typeof EventCreateOperation>, DbError> {
			const operationId = createWorkflowJobId(
				operationSecret,
				`${executionId}:${totalItems}`,
				userId,
			);
			const result = toWorkflowRunResult(
				Option.getOrUndefined(yield* engine.poll(EventCreateWorkflow, executionId)),
				{ onSuccess: (value) => ({ result: value }) },
			);
			if (result.status === "failed") {
				return { operationId, status: "failed", reason: "unexpected-error" };
			}
			const progress = yield* repository.getCreateProgress(userId, executionId);
			if (result.status === "completed" && !progress.requiredPending) {
				return { operationId, status: "completed", result: result.result };
			}
			return progress.writtenCount > 0
				? {
						operationId,
						writtenCount: progress.writtenCount,
						status: "committed-follow-up-pending",
						writesPending: result.status !== "completed" && progress.writtenCount < totalItems,
					}
				: { operationId, writtenCount: 0, status: "accepted", writesPending: true };
		});
		const createHttp = Effect.fn("EventsService.createHttp")(function* (
			input: { readonly userId: UserId; readonly payload: ReadonlyArray<CreateEventItem> },
			command: LifecycleCommand,
		) {
			if (input.payload.length === 0) {
				return { count: 0, outcomes: [], warnings: [], failure: null };
			}
			yield* verifyCreateBatchInput(input, command);
			const started = yield* Clock.currentTimeMillis;
			const executionId = command.causation.executionId;
			yield* dispatchAdmittedWorkflow(
				receipts,
				engine,
				EventCreateWorkflow,
				command.accountGeneration,
				{ executionId, discard: true, payload: { ...input, command } },
				(admission) => admission,
				(dispatch) => dispatch.pipe(Effect.uninterruptible),
			);
			const remaining = Math.max(0, 35_000 - ((yield* Clock.currentTimeMillis) - started));
			const observed = yield* Effect.gen(function* () {
				for (;;) {
					const state = yield* operationState(input.userId, executionId, input.payload.length);
					if (state.status === "completed" || state.status === "failed") {
						return state;
					}
					yield* Effect.sleep(Duration.millis(500));
				}
			}).pipe(Effect.timeoutOption(Duration.millis(remaining)));
			const state = Option.isSome(observed)
				? observed.value
				: yield* operationState(input.userId, executionId, input.payload.length);
			yield* verifyCreateBatchInput(input, command);
			if (state.status === "completed") {
				return state.result;
			}
			if (state.status === "failed") {
				return yield* new DbError({ message: "Event creation failed" });
			}
			return state;
		});
		const getCreateOperation = Effect.fn("EventsService.getCreateOperation")(function* (
			userId: UserId,
			operationId: string,
		) {
			const identity = resolveWorkflowExecutionId(operationSecret, userId, operationId);
			const separator = identity?.lastIndexOf(":") ?? -1;
			const executionId = identity?.slice(0, separator);
			const totalItems = Number(identity?.slice(separator + 1));
			if (!executionId || !Number.isSafeInteger(totalItems) || totalItems < 1) {
				return yield* new EventOperationNotFound({ reason: { code: "operation-not-found" } });
			}
			return yield* operationState(userId, executionId, totalItems);
		});

		const prepare = Effect.fnUntraced(function* (
			input: EventIdentityInput,
			commandInput: LifecycleCommand,
			move?: UpdateEventEntityReferencesInput,
			inline = false,
		) {
			yield* assertRootTransaction;
			const command = yield* Schema.decodeEffect(LifecycleCommand)(commandInput).pipe(
				Effect.mapError(() => new DbError({ message: "Invalid event lifecycle command" })),
			);
			const recordNoop = Effect.gen(function* () {
				yield* receipts.insert({
					dispatch: [],
					result: { eventId: null },
					identity: eventMutationReceiptIdentity(input, command, move),
				});
				return { _tag: "Committed" as const, work: { result: null, dispatch: [] } };
			});
			const planned = yield* transaction(
				Effect.gen(function* () {
					if (inline) {
						const replay = yield* lookupReceipt(input, command, move);
						if (replay) {
							const batch =
								replay.result.eventId === null
									? []
									: yield* planner.planBatch({
											command,
											resource: "event",
											identity: [command.itemIdentity],
										});
							return {
								_tag: "Committed" as const,
								work: { result: replay.result.eventId, dispatch: [...replay.dispatch, ...batch] },
							};
						}
					}
					const before = yield* repository.getEventSnapshot(input);
					if (!before) {
						return inline ? yield* recordNoop : null;
					}
					let request: EventRequest;
					if (move) {
						if (
							move.mergeFrom === move.mergeInto ||
							(before.entityId !== move.mergeFrom && before.sessionEntityId !== move.mergeFrom)
						) {
							return inline ? yield* recordNoop : null;
						}
						const draft = yield* Schema.decodeEffect(AutomationEventDraft)({
							...eventDraft(before),
							entityId: before.entityId === move.mergeFrom ? move.mergeInto : before.entityId,
							sessionEntityId:
								before.sessionEntityId === move.mergeFrom ? move.mergeInto : before.sessionEntityId,
						}).pipe(Effect.mapError(() => new DbError({ message: "Invalid event update draft" })));
						request = {
							draft,
							before,
							resource: "event",
							category: "request",
							operation: "update",
						};
					} else {
						request = {
							draft: before,
							resource: "event",
							category: "request",
							operation: "delete",
						};
					}
					const plan = yield* planner.plan({
						trigger: lifecycleTrigger(command, input.userId, request),
					});
					if (inline && plan.policies.length === 0 && !plan.trigger?.blockedReason) {
						const prepared: PreparedEventMutationData = {
							input,
							before,
							command,
							requestId: plan.trigger?.id ?? null,
							...(move ? { move, operation: "update" as const } : { operation: "delete" as const }),
						};
						return {
							_tag: "Committed" as const,
							work: yield* withBatch(command, persist(prepared, undefined, true)),
						};
					}
					return { plan, input, before, command, request, _tag: "Planned" as const };
				}),
			);
			if (!planned) {
				return null;
			}
			if (planned._tag === "Committed") {
				return planned;
			}
			if (planned.plan.trigger?.blockedReason) {
				return yield* new DbError({ message: "Event request exceeds automation limits" });
			}
			yield* Effect.gen(function* () {
				for (const policy of planned.plan.policies) {
					const output = yield* execution
						.executePolicy({ runId: policy.runId, acceptedPatches: [] })
						.pipe(
							Effect.catchTag("AutomationPolicyExecutionError", (error) =>
								Effect.fail(
									new DbError({ message: `Event policy execution failed: ${error.runId}` }),
								),
							),
						);
					if (output.action === "reject") {
						return yield* new DbError({
							message: `Event policy rejected mutation: ${policy.runId}`,
						});
					}
					if (output.action === "transform") {
						return yield* new DbError({
							message: `Event policy cannot transform a reference or delete mutation: ${policy.runId}`,
						});
					}
				}
				return undefined;
			}).pipe(
				Effect.catchCauseIf(
					(cause) => !Cause.hasInterruptsOnly(cause),
					(cause) =>
						planned.plan.trigger === null
							? Effect.failCause(cause)
							: execution
									.skipQueuedPolicies({ triggerId: planned.plan.trigger.id })
									.pipe(Effect.andThen(Effect.failCause(cause)), Effect.uninterruptible),
				),
			);
			return {
				input: planned.input,
				before: planned.before,
				command: planned.command,
				requestId: planned.plan.trigger?.id ?? null,
				...(move ? { move, operation: "update" as const } : { operation: "delete" as const }),
			};
		});

		const prepareUpdate = Effect.fn("EventsService.prepareUpdate")(function* (
			input: UpdateEventEntityReferencesInput,
			command: LifecycleCommand,
		) {
			const value = yield* prepare(input, command, input);
			return value && "operation" in value && value.operation === "update"
				? Object.freeze({ [preparedEventUpdate]: value })
				: null;
		});
		const prepareDelete = Effect.fn("EventsService.prepareDelete")(function* (
			input: EventIdentityInput,
			command: LifecycleCommand,
		) {
			const value = yield* prepare(input, command);
			return value && "operation" in value && value.operation === "delete"
				? Object.freeze({ [preparedEventDelete]: value })
				: null;
		});

		const persist = Effect.fnUntraced(function* (
			prepared: PreparedEventMutationData,
			batchInput?: { command: LifecycleCommand; identity: ReadonlyArray<string>; index: number },
			receiptCheckedInTransaction = false,
		) {
			yield* assertActiveTransaction;
			const identity = eventMutationReceiptIdentity(
				prepared.input,
				prepared.command,
				prepared.operation === "update" ? prepared.move : undefined,
			);
			const batchScope = {
				resource: "event" as const,
				command: batchInput?.command ?? prepared.command,
				identity: batchInput?.identity ?? [prepared.command.itemIdentity],
			};
			const batch = yield* planner.prepareBatch({ ...batchScope, scopes: [prepared.input.userId] });
			const replay = receiptCheckedInTransaction
				? null
				: yield* lookupReceipt(
						prepared.input,
						prepared.command,
						prepared.operation === "update" ? prepared.move : undefined,
					);
			if (replay) {
				if (replay.result.eventId === null) {
					return yield* new DbError({ message: "Event command was already recorded as a no-op" });
				}
				return {
					dispatch: replay.dispatch,
					result: replay.result.eventId,
				} satisfies CommittedLifecycleWork<EventId>;
			}
			let eventId: EventId;
			let change: AutomationEventChangePayload;
			if (prepared.operation === "update") {
				const updated = yield* repository.updatePreparedEventEntityReferences({
					...prepared.move,
					before: prepared.before,
					updatedAt: DateTime.toDate(DateTime.makeUnsafe(prepared.command.occurredAt)),
				});
				if (!updated) {
					return yield* new DbError({ message: "Event changed while lifecycle policies ran" });
				}
				const after = yield* repository.getEventSnapshot(prepared.input);
				if (!after) {
					return yield* new DbError({ message: "Updated event disappeared" });
				}
				eventId = updated;
				change = {
					after,
					resource: "event",
					category: "change",
					operation: "update",
					before: prepared.before,
				};
			} else {
				const deleted = yield* repository.deletePreparedEvent({
					...prepared.input,
					before: prepared.before,
				});
				if (!deleted) {
					return yield* new DbError({ message: "Event changed while lifecycle policies ran" });
				}
				eventId = deleted;
				change = {
					resource: "event",
					category: "change",
					operation: "delete",
					before: prepared.before,
				};
			}
			const plan = yield* planner.plan({
				trigger: lifecycleTrigger(
					{
						...prepared.command,
						causation: {
							...prepared.command.causation,
							parentTriggerId: prepared.requestId ?? prepared.command.causation.parentTriggerId,
						},
					},
					prepared.input.userId,
					change,
				),
			});
			const dispatch = plan.trigger === null ? [] : [toLifecycleDispatchPlan(plan)];
			yield* receipts.insert({
				identity,
				dispatch,
				batchId: batch.id,
				result: { eventId },
				batchIndex: batchInput?.index ?? 0,
				...(batch.hasCandidates ? { evidence: change } : {}),
			});
			return { dispatch, result: eventId } satisfies CommittedLifecycleWork<EventId>;
		});

		const persistPreparedUpdate = Effect.fn("EventsService.persistPreparedUpdate")(function* (
			prepared: PreparedEventUpdate,
			batch?: { command: LifecycleCommand; identity: ReadonlyArray<string>; index: number },
		) {
			return yield* persist(prepared[preparedEventUpdate], batch);
		});
		const persistPreparedDelete = Effect.fn("EventsService.persistPreparedDelete")(function* (
			prepared: PreparedEventDelete,
			batch?: { command: LifecycleCommand; identity: ReadonlyArray<string>; index: number },
		) {
			return yield* persist(prepared[preparedEventDelete], batch);
		});
		const withBatch = Effect.fnUntraced(function* (
			command: LifecycleCommand,
			persisted: Effect.Effect<
				CommittedLifecycleWork<EventId>,
				Effect.Error<ReturnType<typeof persist>>
			>,
		) {
			const work = yield* persisted;
			const batch = yield* planner.planBatch({
				command,
				resource: "event",
				identity: [command.itemIdentity],
			});
			return { ...work, dispatch: [...work.dispatch, ...batch] };
		});
		const mutate = Effect.fn("EventsService.mutate")(function* (
			input: EventIdentityInput,
			command: LifecycleCommand,
			move?: UpdateEventEntityReferencesInput,
		) {
			yield* assertRootTransaction;
			const recorded = yield* lookupReceipt(input, command, move, false);
			if (recorded) {
				const batch =
					recorded.result.eventId === null
						? []
						: yield* transaction(
								planner.planBatch({ command, resource: "event", identity: [command.itemIdentity] }),
							);
				return {
					eventId: recorded.result.eventId,
					warnings: yield* execution.dispatch([...recorded.dispatch, ...batch]),
				};
			}
			const prepared = yield* prepare(input, command, move, true);
			let work: CommittedLifecycleWork<EventId | null> | null = null;
			if (prepared) {
				work =
					"work" in prepared
						? prepared.work
						: yield* transaction(withBatch(command, persist(prepared)));
			}
			if (!work) {
				return { eventId: null, warnings: [] as AutomationWarning[] };
			}
			return { eventId: work.result, warnings: yield* execution.dispatch(work.dispatch) };
		});

		return {
			create,
			createHttp,
			prepareUpdate,
			prepareDelete,
			getCreateOperation,
			persistPreparedUpdate,
			persistPreparedDelete,
			delete: (input: EventIdentityInput, command: LifecycleCommand) => mutate(input, command),
			update: (input: UpdateEventEntityReferencesInput, command: LifecycleCommand) =>
				mutate(input, command, input),
		};
	}),
}) {
	static readonly layer = Layer.effect(this, this.make);
}
