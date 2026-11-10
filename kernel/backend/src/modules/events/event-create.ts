import { DbError } from "@ryot-app/contract/errors";
import {
	CreateEventItem,
	type CreateEventsResponse,
	EventCreateFailureReason,
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

import { EventMutations, eventWriteIdentity, type PreparedEventChanges } from "./mutations";

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

const eventCreateBatchInput = (input: { command: DomainLifecycleCommand }) => ({
	identity: ["events"],
	command: input.command,
	resource: "event" as const,
});

const eventCreateWriteCommand = (
	payload: EventCreateInput,
	index: number,
): DomainLifecycleCommand => {
	const command = payload.writeCommand ?? payload.command;
	return {
		...command,
		itemIdentity: payload.itemIdentities?.[index] ?? `${command.itemIdentity}:event:${index}`,
	};
};

const changesOf = (input: EventCreateInput) =>
	input.payload.map((item, index) => ({
		item,
		kind: "create" as const,
		itemIdentity: input.itemIdentities?.[index] ?? `event:${index}`,
	}));

const policyChunkSize = 50;

// One policy invocation must fit the sandbox context limit. A subject's items share a chunk, so a
// once-per-subject policy still runs once for it.
const policyChunks = (prepared: PreparedEventChanges) => {
	const subjects = Map.groupBy(prepared.items, (item) => item.draft.entityId);
	const chunks: Array<PreparedEventChanges["items"][number][]> = [];
	for (const items of subjects.values()) {
		const last = chunks.at(-1);
		if (last && last.length + items.length <= policyChunkSize) {
			last.push(...items);
		} else {
			chunks.push([...items]);
		}
	}
	return chunks;
};

const policyBatchOf = (input: EventCreateInput, prepared: PreparedEventChanges, chunk: number) => ({
	userId: input.userId,
	resource: "event" as const,
	references: prepared.references,
	propertiesSchemas: prepared.propertiesSchemas,
	command: { ...input.command, itemIdentity: `${input.command.itemIdentity}:policies:${chunk}` },
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

const createResult = (outcomes: ReadonlyArray<EventCreateItemOutcome>): CreateEventsResponse => {
	const sorted = [...outcomes].sort((left, right) => left.index - right.index);
	const failed = sorted.find((outcome) => outcome.status === "failed");
	return {
		warnings: [],
		outcomes: sorted,
		count: sorted.filter((outcome) => outcome.status === "written").length,
		failure: failed ? { index: failed.index, reason: failed.reason } : null,
	};
};

const commitRejection = (error: { readonly _tag: string; readonly reason?: unknown }) => {
	const code =
		error._tag === "EventBadRequest" &&
		typeof error.reason === "object" &&
		error.reason !== null &&
		"code" in error.reason
			? error.reason.code
			: undefined;
	if (code === "asset-forbidden" || code === "invalid-properties") {
		return { code } as const;
	}
	return { code: "mutation-conflict" as const };
};

/**
 * Creates events and returns their final outcome. Preparation, policy planning and, when no policy
 * matches, the write share one transaction; matching before-policies run in the sandbox between it and
 * the commit.
 */
export const makeEventCreate = Effect.gen(function* () {
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
			const changes = changesOf(input);
			const indexes = new Map(changes.map((change, index) => [change.itemIdentity, index]));
			const indexOf = (itemIdentity: string) => indexes.get(itemIdentity) ?? -1;
			const command = input.writeCommand ?? input.command;
			const foldMode = command.causation.lane === "background" ? "queue" : "inline";
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
					Effect.catchTag("AutomationPolicyExecutionError", (error) =>
						Effect.fail(
							new EventCreateRejected({
								kept: prepareFailures(prepared),
								reason: { runId: error.runId, code: "policy-execution-failed" },
							}),
						),
					),
				);

			const commit = Effect.fnUntraced(function* (
				prepared: PreparedEventChanges,
				chunks: ReadonlyArray<{
					readonly chunk: PreparedEventChanges;
					readonly validated: PolicyBatchResult;
				}>,
			) {
				const policies = chunks.map(({ validated }) => policyOutcomes(validated, indexOf));
				const kept = [
					...prepareFailures(prepared),
					...policies.flatMap((policy) => policy.outcomes),
				];
				const results: Array<Written["results"][number]> = [];
				const dispatch: Array<LifecycleDispatchPlan> = [];
				for (const [index, { chunk, validated }] of chunks.entries()) {
					const accepted = chunk.items.filter((item) =>
						policies[index]?.accepted.has(item.change.itemIdentity),
					);
					if (accepted.length === 0) {
						continue;
					}
					const written = yield* mutations
						.persist({
							batch,
							command,
							validated,
							sealBatch: false,
							userId: input.userId,
							batchIndexOffset: results.length,
							prepared: { ...prepared, items: accepted },
						})
						.pipe(
							Effect.mapError((error) =>
								error._tag === "DbError"
									? error
									: new EventCreateRejected({ kept, reason: commitRejection(error) }),
							),
						);
					results.push(...written.results);
					dispatch.push(...written.dispatch);
				}
				return yield* record(kept, { results, dispatch });
			});

			const applyChunks = (
				planned: ReadonlyArray<{
					readonly chunk: PreparedEventChanges;
					readonly plan: Parameters<typeof runPolicyBatchDirect>[1];
					readonly policyBatch: Parameters<typeof runPolicyBatchDirect>[0];
				}>,
				prepared: PreparedEventChanges,
			) =>
				Effect.forEach(planned, ({ plan, chunk, policyBatch }) =>
					Effect.map(applyPolicies(policyBatch, plan, prepared), (validated) => ({
						chunk,
						validated,
					})),
				);

			const reject = (rejection: EventCreateRejected) =>
				mutations
					.transaction(
						Effect.gen(function* () {
							yield* admitBatch;
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
							return { ...recorded, kind: "written" as const };
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
											identity:
												item.change.kind === "create"
													? eventWriteIdentity(
															eventCreateWriteCommand(input, indexOf(item.change.itemIdentity)),
														)
													: item.identity,
										})),
									}),
								}),
							);
						const planned = yield* Effect.forEach(policyChunks(prepared), (items, index) =>
							Effect.gen(function* () {
								const chunk = { ...prepared, items };
								const policyBatch = policyBatchOf(input, chunk, index);
								const plan = yield* planPolicyBatch(policyBatch).pipe(
									Effect.provideService(LifecyclePlanner, planner),
								);
								return { plan, chunk, policyBatch };
							}),
						);
						if (planned.every(({ plan }) => plan.trigger === null)) {
							const written = yield* commit(prepared, yield* applyChunks(planned, prepared));
							return { kind: "written" as const, ...written };
						}
						const blocked = planned.find(({ plan }) => plan.trigger?.blockedReason);
						if (blocked?.plan.trigger) {
							return yield* new EventCreateRejected({
								kept: prepareFailures(prepared),
								reason: { code: "automation-limit-reached", triggerId: blocked.plan.trigger.id },
							});
						}
						return { planned, prepared, kind: "policies" as const };
					}),
					foldMode,
				)
				.pipe(
					Effect.catchTag("EventBadRequest", (error) =>
						Effect.fail(new EventCreateRejected({ kept: [], reason: commitRejection(error) })),
					),
					Effect.catchTag("EventCreateRejected", reject),
				);

			const written =
				started.kind === "policies"
					? yield* applyChunks(started.planned, started.prepared).pipe(
							Effect.flatMap((chunks) =>
								mutations
									.transaction(
										Effect.andThen(admitBatch, commit(started.prepared, chunks)),
										foldMode,
									)
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
							Effect.catchTag("EventCreateRejected", reject),
						)
					: started;
			const warnings = yield* execution
				.dispatch(written.dispatch)
				.pipe(Effect.catchTag("LifecyclePersistenceError", Effect.die));
			const response: CreateEventsResponse = {
				...written.result,
				warnings: [...written.result.warnings, ...warnings],
			};
			return response;
		},
		Effect.catchTag("DatabaseSessionStateError", Effect.die),
	);
});
