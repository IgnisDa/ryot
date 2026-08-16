import { PgClient } from "@effect/sql-pg";
import { DbError } from "@ryot-app/contract/errors";
import {
	AutomationEventDraft,
	type AutomationEventChangePayload,
	type AutomationEventSnapshot,
	type AutomationRequestPayload,
	type AutomationWarning,
} from "@ryot-app/contract/modules/automations/lifecycle";
import type { CreateEventItem } from "@ryot-app/contract/modules/events/schemas";
import type { EventId, UserId } from "@ryot-app/contract/schema/brands";
import { stableStringify } from "@ryot-app/ts-utils/json";
import { Cause, Context, DateTime, Effect, Layer, Option, Schema } from "effect";
import { WorkflowEngine } from "effect/unstable/workflow/WorkflowEngine";

import {
	type CommittedLifecycleWork,
	LifecyclePersistenceError,
	LifecyclePlanner,
	type LifecyclePlan,
	toLifecycleDispatchPlan,
} from "#lib/domain/lifecycle";
import { lifecycleTrigger, LifecycleCommand } from "#lib/domain/lifecycle-command";
import { LifecycleExecution } from "#lib/domain/lifecycle-execution";
import { Database, mapDatabaseErrors, retryOnDeadlock } from "#lib/infrastructure/db/service";

import { enqueueEventCreate } from "./event-create-workflow";
import {
	EventsRepository,
	type EventIdentityInput,
	type UpdateEventEntityReferencesInput,
} from "./repository";

type EventRequest = Extract<
	AutomationRequestPayload,
	{ resource: "event"; operation: "update" | "delete" }
>;
type PreparedEventMutationData = {
	readonly before: AutomationEventSnapshot;
	readonly command: LifecycleCommand;
	readonly input: EventIdentityInput;
	readonly requestId: LifecyclePlan["trigger"]["id"];
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

const same = (left: unknown, right: unknown) => stableStringify(left) === stableStringify(right);
const transaction = <A, E, R>(work: Effect.Effect<A, E, R>) =>
	Effect.gen(function* () {
		const database = yield* Database;
		return yield* retryOnDeadlock(
			mapDatabaseErrors(
				database.transaction((tx) => work.pipe(Effect.provideService(Database, tx))),
			),
		);
	});
const eventDraft = ({
	id: _id,
	createdAt: _createdAt,
	updatedAt: _updatedAt,
	...draft
}: AutomationEventSnapshot) => draft;

export class EventsService extends Context.Service<EventsService>()("EventsService", {
	make: Effect.gen(function* () {
		const engine = yield* WorkflowEngine;
		const repository = yield* EventsRepository;
		const assertRootTransaction = Effect.gen(function* () {
			const client = yield* PgClient.PgClient;
			if (Option.isSome(yield* Effect.serviceOption(client.transactionService))) {
				return yield* new DbError({
					message: "Event lifecycle mutations require a root transaction boundary",
				});
			}
			return undefined;
		});
		const assertActiveTransaction = Effect.gen(function* () {
			const client = yield* PgClient.PgClient;
			if (Option.isNone(yield* Effect.serviceOption(client.transactionService))) {
				return yield* new LifecyclePersistenceError({ code: "active-transaction-required" });
			}
			return undefined;
		});
		const create = Effect.fn("EventsService.create")(function* (
			input: { readonly userId: UserId; readonly payload: ReadonlyArray<CreateEventItem> },
			command: LifecycleCommand,
		) {
			if (input.payload.length === 0) {
				return { count: 0, outcomes: [], warnings: [], failure: null };
			}
			return yield* enqueueEventCreate({ ...input, command }).pipe(
				Effect.provideService(WorkflowEngine, engine),
			);
		});

		const prepare = Effect.fnUntraced(function* (
			input: EventIdentityInput,
			commandInput: LifecycleCommand,
			move?: UpdateEventEntityReferencesInput,
		) {
			yield* assertRootTransaction;
			const planner = yield* LifecyclePlanner;
			const execution = yield* LifecycleExecution;
			const command = yield* Schema.decodeEffect(LifecycleCommand)(commandInput).pipe(
				Effect.mapError(() => new DbError({ message: "Invalid event lifecycle command" })),
			);
			const planned = yield* transaction(
				Effect.gen(function* () {
					const before = yield* repository.getEventSnapshot(input);
					if (!before) {
						return null;
					}
					let request: EventRequest;
					if (move) {
						if (
							move.mergeFrom === move.mergeInto ||
							(before.entityId !== move.mergeFrom && before.sessionEntityId !== move.mergeFrom)
						) {
							return null;
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
					return { plan, input, before, command, request };
				}),
			);
			if (!planned) {
				return null;
			}
			if (planned.plan.trigger.blockedReason !== null) {
				return yield* new DbError({ message: "Event request exceeds automation limits" });
			}
			yield* Effect.gen(function* () {
				for (const policy of planned.plan.policies) {
					const output = yield* execution
						.executePolicy({ runId: policy.runId, payload: planned.request })
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
					if (output.action === "transform" && !same(output.payload, planned.request)) {
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
						execution
							.skipQueuedPolicies({ triggerId: planned.plan.trigger.id })
							.pipe(Effect.andThen(Effect.failCause(cause)), Effect.uninterruptible),
				),
			);
			return {
				input: planned.input,
				before: planned.before,
				command: planned.command,
				requestId: planned.plan.trigger.id,
				...(move ? { move, operation: "update" as const } : { operation: "delete" as const }),
			};
		});

		const prepareUpdate = Effect.fn("EventsService.prepareUpdate")(function* (
			input: UpdateEventEntityReferencesInput,
			command: LifecycleCommand,
		) {
			const value = yield* prepare(input, command, input);
			return value?.operation === "update" ? Object.freeze({ [preparedEventUpdate]: value }) : null;
		});
		const prepareDelete = Effect.fn("EventsService.prepareDelete")(function* (
			input: EventIdentityInput,
			command: LifecycleCommand,
		) {
			const value = yield* prepare(input, command);
			return value?.operation === "delete" ? Object.freeze({ [preparedEventDelete]: value }) : null;
		});

		const persist = Effect.fnUntraced(function* (prepared: PreparedEventMutationData) {
			yield* assertActiveTransaction;
			const planner = yield* LifecyclePlanner;
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
						causation: { ...prepared.command.causation, parentTriggerId: prepared.requestId },
					},
					prepared.input.userId,
					change,
				),
			});
			return { plans: [plan], result: eventId } satisfies CommittedLifecycleWork<EventId>;
		});

		const persistPreparedUpdate = Effect.fn("EventsService.persistPreparedUpdate")(function* (
			prepared: PreparedEventUpdate,
		) {
			return yield* persist(prepared[preparedEventUpdate]);
		});
		const persistPreparedDelete = Effect.fn("EventsService.persistPreparedDelete")(function* (
			prepared: PreparedEventDelete,
		) {
			return yield* persist(prepared[preparedEventDelete]);
		});
		const withBatch = Effect.fnUntraced(function* (
			command: LifecycleCommand,
			persisted: Effect.Effect<
				CommittedLifecycleWork<EventId>,
				Effect.Error<ReturnType<typeof persist>>,
				Effect.Services<ReturnType<typeof persist>>
			>,
		) {
			const planner = yield* LifecyclePlanner;
			const work = yield* persisted;
			const batch = yield* planner.planBatch({
				command,
				plans: work.plans,
				resource: "event",
				identity: [command.itemIdentity],
			});
			return { ...work, plans: [...work.plans, ...batch] };
		});
		const mutate = Effect.fn("EventsService.mutate")(function* (
			input: EventIdentityInput,
			command: LifecycleCommand,
			move?: UpdateEventEntityReferencesInput,
		) {
			const work = move
				? yield* Effect.gen(function* () {
						const prepared = yield* prepareUpdate(move, command);
						return prepared
							? yield* transaction(withBatch(command, persistPreparedUpdate(prepared)))
							: null;
					})
				: yield* Effect.gen(function* () {
						const prepared = yield* prepareDelete(input, command);
						return prepared
							? yield* transaction(withBatch(command, persistPreparedDelete(prepared)))
							: null;
					});
			if (!work) {
				return { eventId: null, warnings: [] as AutomationWarning[] };
			}
			const execution = yield* LifecycleExecution;
			return {
				eventId: work.result,
				warnings: yield* execution.dispatch(work.plans.map(toLifecycleDispatchPlan)),
			};
		});

		return {
			create,
			prepareUpdate,
			prepareDelete,
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
