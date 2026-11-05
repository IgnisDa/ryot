import { DbError } from "@ryot-app/contract/errors";
import {
	CreateEventItem,
	CreateEventsResponse,
	EventCreateFailureReason,
	EventCreateItemError,
	EventCreateItemOutcome,
} from "@ryot-app/contract/modules/events/schemas";
import { type EventId, UserId } from "@ryot-app/contract/schema/brands";
import { Effect, Schema } from "effect";

import { LifecycleExecution } from "#modules/automations/lifecycle/execution";
import {
	type LifecycleDispatchPlan,
	LifecyclePlanner,
} from "#modules/automations/lifecycle/planning";
import {
	planPolicyBatch,
	type PolicyBatchResult,
	runPolicyBatchDirect,
} from "#modules/automations/lifecycle/policy-batch";
import type { EntitiesRepository } from "#modules/entities/repository";
import { DomainLifecycleCommand } from "#modules/entities/write-context";
import { mutationReceiptIdentity, MutationReceipts } from "#modules/mutations/receipts";

import { eventCreateBatchInput, eventCreateReceiptIdentity } from "./mutation-receipts";
import { EventMutations, type PreparedEventChanges } from "./mutations";

export const EventCreateInput = Schema.Struct({
	userId: UserId,
	command: DomainLifecycleCommand,
	payload: Schema.Array(CreateEventItem),
	writeCommand: Schema.optional(DomainLifecycleCommand),
	itemIdentities: Schema.optional(Schema.Array(Schema.NonEmptyString)),
}).pipe(
	Schema.check(
		Schema.makeFilter(
			(input) =>
				input.itemIdentities === undefined ||
				(input.itemIdentities.length === input.payload.length &&
					new Set(input.itemIdentities).size === input.itemIdentities.length) ||
				"Event operation identities must be unique and match the event payload",
		),
	),
);
export type EventCreateInput = typeof EventCreateInput.Type;

type Written = {
	readonly dispatch: ReadonlyArray<LifecycleDispatchPlan>;
	readonly results: ReadonlyArray<{ readonly eventId: EventId; readonly itemIdentity: string }>;
};

const nothingWritten: Written = { results: [], dispatch: [] };

/** Nothing was committed: `kept` outcomes stand and every other item fails with `reason`. */
class EventCreateRejected extends Schema.TaggedError<
	EventCreateRejected,
	{ readonly brand: unique symbol }
>()("EventCreateRejected", {
	reason: EventCreateFailureReason,
	kept: Schema.Array(EventCreateItemOutcome),
}) {}

const operationReceiptOf = (
	input: EventCreateInput,
	batch: ReturnType<typeof eventCreateBatchInput>,
) =>
	mutationReceiptIdentity({
		input: batch.commandInput,
		ownerUserId: input.userId,
		scopeUserId: input.userId,
		commandKind: "event:create-operation",
		command: { ...input.command, itemIdentity: `${input.command.itemIdentity}:operation` },
	});

const changesOf = (input: EventCreateInput) =>
	input.payload.map((item, index) => ({
		item,
		kind: "create" as const,
		itemIdentity: input.itemIdentities?.[index] ?? `event:${index}`,
	}));

const policyBatchOf = (input: EventCreateInput, prepared: PreparedEventChanges) => ({
	userId: input.userId,
	resource: "event" as const,
	references: prepared.references,
	propertiesSchemas: prepared.propertiesSchemas,
	command: { ...input.command, itemIdentity: `${input.command.itemIdentity}:policies:0` },
	items: prepared.items.map((item) => ({
		itemIdentity: item.change.itemIdentity,
		schemaKey: item.schemaFingerprint.digest,
		request: {
			draft: item.draft,
			resource: "event" as const,
			category: "request" as const,
			operation: "create" as const,
			excludedOncePerSubjectPolicies: [],
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

const createResult = (outcomes: ReadonlyArray<EventCreateItemOutcome>) => {
	const sorted = [...outcomes].sort((left, right) => left.index - right.index);
	const failed = sorted.find((outcome) => outcome.status === "failed");
	return {
		warnings: [],
		outcomes: sorted,
		count: sorted.filter((outcome) => outcome.status === "written").length,
		failure: failed ? { index: failed.index, reason: failed.reason } : null,
	};
};

const commitRejection = (error: { readonly _tag: string; readonly reason?: unknown }) => ({
	code:
		error._tag === "EventBadRequest" &&
		typeof error.reason === "object" &&
		error.reason !== null &&
		"code" in error.reason &&
		error.reason.code === "asset-forbidden"
			? ("asset-forbidden" as const)
			: ("mutation-conflict" as const),
});

/**
 * Creates events and returns their final outcome. Preparation, policy planning and, when no policy
 * matches, the write share one transaction; matching before-policies run in the sandbox between it and
 * the commit. A replayed command returns its recorded result.
 */
export const makeEventCreate = Effect.gen(function* () {
	const receipts = yield* MutationReceipts.make;
	const execution = yield* LifecycleExecution;
	const mutations = yield* EventMutations;
	const planner = yield* LifecyclePlanner;
	const policyContext = yield* Effect.context<EntitiesRepository | LifecycleExecution>();
	return Effect.fn("EventCreate")(
		function* (input: EventCreateInput) {
			if (input.payload.length === 0) {
				return { count: 0, outcomes: [], warnings: [], failure: null };
			}
			const batch = eventCreateBatchInput(input);
			const identity = operationReceiptOf(input, batch);
			const changes = changesOf(input);
			const indexes = new Map(changes.map((change, index) => [change.itemIdentity, index]));
			const indexOf = (itemIdentity: string) => indexes.get(itemIdentity) ?? -1;
			const command = input.writeCommand ?? input.command;
			const admitBatch = planner.prepareBatch({ ...batch, scopes: [input.userId] });

			const record = Effect.fnUntraced(function* (
				outcomes: ReadonlyArray<EventCreateItemOutcome>,
				written: Written,
			) {
				const dispatch = [...written.dispatch, ...(yield* planner.planBatch(batch))];
				const result = createResult([
					...outcomes,
					...written.results.map((row) => ({
						eventId: row.eventId,
						status: "written" as const,
						index: indexOf(row.itemIdentity),
					})),
				]);
				yield* receipts.insert({ result, dispatch, identity });
				return { result, dispatch };
			});

			const prepareFailures = (prepared: PreparedEventChanges) =>
				prepared.failures.map(({ reason, itemIdentity }) => ({
					reason,
					status: "failed" as const,
					index: indexOf(itemIdentity),
				}));

			const applyPolicies = (
				policyBatch: Parameters<typeof runPolicyBatchDirect>[0],
				plan: Parameters<typeof runPolicyBatchDirect>[1],
				prepared: PreparedEventChanges,
			) =>
				runPolicyBatchDirect(policyBatch, plan).pipe(
					Effect.provideContext(policyContext),
					Effect.catchTags({
						PolicyBatchBlocked: (error) =>
							Effect.fail(
								new EventCreateRejected({
									kept: prepareFailures(prepared),
									reason: { triggerId: error.triggerId, code: "automation-limit-reached" },
								}),
							),
						AutomationPolicyExecutionError: (error) =>
							Effect.fail(
								new EventCreateRejected({
									kept: prepareFailures(prepared),
									reason: { runId: error.runId, code: "policy-execution-failed" },
								}),
							),
					}),
				);

			const commit = Effect.fnUntraced(function* (
				prepared: PreparedEventChanges,
				validated: PolicyBatchResult,
			) {
				const policy = policyOutcomes(validated, indexOf);
				const kept = [...prepareFailures(prepared), ...policy.outcomes];
				const written =
					policy.accepted.size === 0
						? nothingWritten
						: yield* mutations
								.persist({
									batch,
									command,
									validated,
									sealBatch: false,
									userId: input.userId,
									prepared: {
										...prepared,
										items: prepared.items.filter((item) =>
											policy.accepted.has(item.change.itemIdentity),
										),
									},
								})
								.pipe(
									Effect.mapError((error) =>
										error._tag === "DbError"
											? error
											: new EventCreateRejected({ kept, reason: commitRejection(error) }),
									),
								);
				return yield* record(kept, written);
			});

			const reject = (rejection: EventCreateRejected, readmit: boolean) =>
				mutations
					.transaction(
						Effect.gen(function* () {
							if (readmit) {
								yield* admitBatch;
							}
							const settled = new Set(rejection.kept.map((outcome) => outcome.index));
							const recorded = yield* record(
								[
									...rejection.kept,
									...changes.flatMap((_change, index) =>
										settled.has(index)
											? []
											: [{ index, reason: rejection.reason, status: "failed" as const }],
									),
								],
								nothingWritten,
							);
							return { ...recorded, replayed: false, kind: "written" as const };
						}),
					)
					.pipe(
						Effect.catchTag("EventBadRequest", () =>
							Effect.fail(new DbError({ message: "Event creation failure could not be recorded" })),
						),
					);

			const started = yield* mutations
				.transaction(
					Effect.gen(function* () {
						const replay = yield* receipts.peek(identity, CreateEventsResponse);
						if (replay) {
							return { replayed: true, kind: "written" as const, ...replay };
						}
						yield* admitBatch;
						const prepared = yield* mutations
							.prepare({ changes, command, independent: true, userId: input.userId })
							.pipe(
								Effect.mapBoth({
									onFailure: (error) =>
										error._tag === "DbError"
											? error
											: new EventCreateRejected({
													kept: [],
													reason:
														error._tag === "EventCreateItemError"
															? error.reason
															: { code: "invalid-properties" },
												}),
									onSuccess: (value) => ({
										...value,
										items: value.items.map((item) => ({
											...item,
											receipt:
												item.change.kind === "create"
													? eventCreateReceiptIdentity(
															input,
															indexOf(item.change.itemIdentity),
															item.change.item,
														)
													: item.receipt,
										})),
									}),
								}),
							);
						const policyBatch = policyBatchOf(input, prepared);
						const plan = yield* planPolicyBatch(policyBatch).pipe(
							Effect.provideService(LifecyclePlanner, planner),
						);
						if (plan.trigger === null) {
							const written = yield* commit(
								prepared,
								yield* applyPolicies(policyBatch, plan, prepared),
							);
							return { replayed: false, kind: "written" as const, ...written };
						}
						if (plan.trigger.blockedReason) {
							return yield* new EventCreateRejected({
								kept: prepareFailures(prepared),
								reason: { triggerId: plan.trigger.id, code: "automation-limit-reached" },
							});
						}
						return { plan, prepared, policyBatch, kind: "policies" as const };
					}),
				)
				.pipe(
					Effect.catchTag("EventBadRequest", (error) =>
						Effect.fail(new EventCreateRejected({ kept: [], reason: commitRejection(error) })),
					),
					Effect.catchTag("EventCreateRejected", (rejection) => reject(rejection, true)),
				);

			const written =
				started.kind === "policies"
					? yield* applyPolicies(started.policyBatch, started.plan, started.prepared).pipe(
							Effect.flatMap((validated) =>
								mutations
									.transaction(commit(started.prepared, validated))
									.pipe(
										Effect.catchTag("EventBadRequest", (error) =>
											Effect.fail(
												new EventCreateRejected({
													reason: commitRejection(error),
													kept: prepareFailures(started.prepared),
												}),
											),
										),
									),
							),
							Effect.map((value) => ({ ...value, replayed: false })),
							Effect.catchTag("EventCreateRejected", (rejection) => reject(rejection, false)),
						)
					: started;
			const warnings = yield* execution
				.dispatch(written.dispatch)
				.pipe(Effect.catchTag("LifecyclePersistenceError", Effect.die));
			return written.replayed
				? written.result
				: { ...written.result, warnings: [...written.result.warnings, ...warnings] };
		},
		Effect.catchTags({
			DatabaseSessionStateError: Effect.die,
			MutationReceiptIdentityConflict: () =>
				Effect.fail(new EventCreateItemError({ reason: { code: "mutation-conflict" } })),
		}),
	);
});
