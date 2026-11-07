import { expect } from "bun:test";

import { BunServices } from "@effect/platform-bun";
import { PgClient } from "@effect/sql-pg";
import { UserId } from "@ryot-app/contract/schema/brands";
import { randomUuid } from "@ryot-app/testing/random";
import { layer } from "@voila.dev/effect-bun-test";
import {
	Cause,
	Duration,
	Effect,
	Exit,
	Fiber,
	Layer,
	Option,
	Predicate,
	Schedule,
	Schema,
} from "effect";
import { DurableClock, DurableDeferred, Workflow } from "effect/workflow";
import { layerMemory, type WorkflowEngine, WorkflowInstance } from "effect/workflow/WorkflowEngine";

import { CurrentJobId } from "#platform/jobs/worker";
import { isolatedDatabaseLayer } from "#testing/isolated-database";

import { WorkflowAccountRejected, WorkflowAccounts, WorkflowAdmissionAccount } from "./account";
import { PostgresWorkflowEngine } from "./engine";
import { WorkflowExecutionNotifications } from "./execution-notifications";
import {
	forgetWorkflowSteps,
	implementWorkflow,
	inWorkflowStepScope,
	makeActivity,
} from "./scope";

const activityRuns = new Map<string, number>();
const finalizerExits = new Map<string, Array<Exit.Exit<unknown, unknown>>>();

const retry = Schedule.spaced(Duration.millis(20));
const Signal = DurableDeferred.make("signal", { success: Schema.String });
const ChildSignal = DurableDeferred.make("child-signal", { success: Schema.String });

const Waiting = Workflow.make("EngineConformanceWaiting", {
	success: Schema.String,
	suspendedRetrySchedule: retry,
	payload: { id: Schema.String },
	idempotencyKey: ({ id }) => id,
});
const Child = Workflow.make("EngineConformanceChild", {
	success: Schema.String,
	suspendedRetrySchedule: retry,
	payload: { id: Schema.String },
	idempotencyKey: ({ id }) => id,
});
const Parent = Workflow.make("EngineConformanceParent", {
	success: Schema.String,
	suspendedRetrySchedule: retry,
	payload: { id: Schema.String },
	idempotencyKey: ({ id }) => id,
});
const Sleeper = Workflow.make("EngineConformanceSleeper", {
	success: Schema.String,
	suspendedRetrySchedule: retry,
	payload: { id: Schema.String },
	idempotencyKey: ({ id }) => id,
});

const LongSleeper = Workflow.make("EngineConformanceLongSleeper", {
	success: Schema.String,
	suspendedRetrySchedule: retry,
	payload: { id: Schema.String },
	idempotencyKey: ({ id }) => id,
});

const Ordered = Workflow.make("EngineConformanceOrdered", {
	success: Schema.String,
	suspendedRetrySchedule: retry,
	payload: { id: Schema.String },
	idempotencyKey: ({ id }) => id,
});

const Counted = Workflow.make("EngineConformanceCounted", {
	success: Schema.String,
	suspendedRetrySchedule: retry,
	payload: { id: Schema.String },
	idempotencyKey: ({ id }) => id,
});

const Joining = Workflow.make("EngineConformanceJoining", {
	success: Schema.String,
	suspendedRetrySchedule: retry,
	payload: { id: Schema.String },
	idempotencyKey: ({ id }) => id,
});

const Adopter = Workflow.make("EngineConformanceAdopter", {
	success: Schema.String,
	suspendedRetrySchedule: retry,
	idempotencyKey: ({ id }) => id,
	payload: { userId: UserId, id: Schema.String },
});

const TwinSleeper = Workflow.make("EngineConformanceTwinSleeper", {
	success: Schema.String,
	suspendedRetrySchedule: retry,
	payload: { id: Schema.String },
	idempotencyKey: ({ id }) => id,
});

const Jobless = Workflow.make("EngineConformanceJobless", {
	success: Schema.String,
	suspendedRetrySchedule: retry,
	payload: { id: Schema.String },
	idempotencyKey: ({ id }) => id,
});

const Scoped = Workflow.make("EngineConformanceScoped", {
	success: Schema.String,
	suspendedRetrySchedule: retry,
	payload: { id: Schema.String },
	idempotencyKey: ({ id }) => id,
});

const ScopedParent = Workflow.make("EngineConformanceScopedParent", {
	success: Schema.String,
	suspendedRetrySchedule: retry,
	payload: { id: Schema.String },
	idempotencyKey: ({ id }) => id,
});

const workflowsLive = Layer.mergeAll(
	implementWorkflow(Waiting, ({ id }) =>
		Effect.gen(function* () {
			const runs = yield* makeActivity({
				name: "load",
				success: Schema.Int,
				execute: Effect.sync(() => {
					const next = (activityRuns.get(id) ?? 0) + 1;
					activityRuns.set(id, next);
					return next;
				}),
			});
			yield* Workflow.addFinalizer((exit) =>
				Effect.sync(() => finalizerExits.set(id, [...(finalizerExits.get(id) ?? []), exit])),
			);
			return `${yield* DurableDeferred.await(Signal)}:${runs}`;
		}),
	),
	implementWorkflow(Child, () =>
		DurableDeferred.await(ChildSignal).pipe(Effect.map((value) => `child:${value}`)),
	),
	implementWorkflow(Parent, ({ id }) =>
		Child.execute({ id: `${id}-child` }).pipe(Effect.map((value) => `parent:${value}`)),
	),
	implementWorkflow(Ordered, () =>
		Effect.gen(function* () {
			const value = yield* makeActivity({
				name: "ordered",
				success: Schema.Unknown,
				execute: Effect.succeed({ a: 2, zz: 1 }),
			});
			yield* DurableDeferred.await(Signal);
			return Predicate.isObject(value) ? Object.keys(value).join(",") : "";
		}),
	),
	implementWorkflow(Counted, ({ id }) =>
		makeActivity({
			name: "count",
			success: Schema.Int,
			execute: Effect.sync(() => {
				const next = (activityRuns.get(id) ?? 0) + 1;
				activityRuns.set(id, next);
				return next;
			}),
		}).pipe(Effect.map((runs) => `counted:${runs}`)),
	),
	implementWorkflow(Joining, ({ id }) =>
		Effect.gen(function* () {
			yield* DurableDeferred.await(Signal);
			return `joined:${yield* Counted.execute({ id: `${id}-counted` })}`;
		}),
	),
	implementWorkflow(LongSleeper, () =>
		DurableClock.sleep({
			name: "long-nap",
			duration: "1 second",
			inMemoryThreshold: Duration.zero,
		}).pipe(Effect.as("woke later")),
	),
	implementWorkflow(Sleeper, () =>
		DurableClock.sleep({
			name: "nap",
			duration: "100 millis",
			inMemoryThreshold: Duration.zero,
		}).pipe(Effect.as("woke")),
	),
);

const adopterLive = implementWorkflow(Adopter, ({ userId }) =>
	Effect.gen(function* () {
		yield* (yield* WorkflowAccounts).adopt(userId).pipe(Effect.orDie);
		return yield* DurableDeferred.await(Signal);
	}),
);

const twinLive = implementWorkflow(TwinSleeper, () =>
	Effect.forEach(
		["a", "b"],
		(item, offset) =>
			Effect.gen(function* () {
				for (let round = 0; round < 3; round += 1) {
					yield* DurableClock.sleep({
						name: `${item}:${round}`,
						inMemoryThreshold: Duration.zero,
						duration: Duration.millis(200 * (round + 1) + offset * 20),
					});
				}
			}),
		{ discard: true, concurrency: 2 },
	).pipe(Effect.as("both woke")),
);

const joblessLive = implementWorkflow(Jobless, () =>
	Effect.gen(function* () {
		return (yield* CurrentJobId) ?? "no job";
	}),
);

const scopedLive = Layer.mergeAll(
	implementWorkflow(Scoped, ({ id }) =>
		Effect.gen(function* () {
			const count = (name: string) =>
				makeActivity({
					name,
					success: Schema.Int,
					execute: Effect.sync(() => {
						const key = `${id}:${name}`;
						const next = (activityRuns.get(key) ?? 0) + 1;
						activityRuns.set(key, next);
						return next;
					}),
				});
			yield* count("kept");
			const forgotten = inWorkflowStepScope("chunk")(count("forgotten"));
			yield* forgotten;
			yield* forgetWorkflowSteps("chunk");
			yield* count("kept");
			return `${yield* forgotten}`;
		}),
	),
	implementWorkflow(ScopedParent, ({ id }) =>
		Waiting.execute({ id: `${id}-child` }).pipe(inWorkflowStepScope("chunk")),
	),
);

const postgresEngine = () =>
	Layer.mergeAll(workflowsLive, adopterLive, joblessLive, twinLive, scopedLive).pipe(
		Layer.provideMerge(
			PostgresWorkflowEngine.pipe(Layer.provide(WorkflowExecutionNotifications.layer)),
		),
		Layer.fresh,
	);

const engines = [
	{ name: "memory", make: () => workflowsLive.pipe(Layer.provideMerge(layerMemory), Layer.fresh) },
	{ name: "postgres", make: postgresEngine },
];

const withEngine =
	<ROut, RIn>(engine: Layer.Layer<ROut, never, RIn>) =>
	<A, E, R>(effect: Effect.Effect<A, E, R>) =>
		Effect.scoped(
			Effect.flatMap(Layer.build(engine), (context) => Effect.provideContext(effect, context)),
		);

const untilResult = <A, E>(
	poll: Effect.Effect<Option.Option<Workflow.Result<A, E>>, never, WorkflowEngine>,
	tag: "Complete" | "Suspended",
) =>
	poll.pipe(
		Effect.flatMap((result) =>
			Option.isSome(result) && result.value._tag === tag
				? Effect.succeed(result.value)
				: Effect.fail("pending" as const),
		),
		Effect.retry(retry),
		Effect.timeout("10 seconds"),
		Effect.orDie,
	);

const complete = <A, E>(
	poll: Effect.Effect<Option.Option<Workflow.Result<A, E>>, never, WorkflowEngine>,
) =>
	untilResult(poll, "Complete").pipe(
		Effect.flatMap((result) =>
			result._tag === "Complete" ? Effect.succeed(result.exit) : Effect.die("suspended"),
		),
	);

const signal = (
	deferred: typeof Signal,
	workflow: Workflow.Any,
	executionId: string,
	value: string,
) =>
	DurableDeferred.done(deferred, {
		exit: Exit.succeed(value),
		token: DurableDeferred.tokenFromExecutionId(deferred, { workflow, executionId }),
	});

const isolatedDatabase = isolatedDatabaseLayer("workflow_engine");

const insertUser = Effect.gen(function* () {
	const sql = yield* PgClient.PgClient;
	const userId = UserId.make(yield* randomUuid);
	yield* sql`insert into "user" (id, name, email)
			values (${userId}, ${"Engine account"}, ${`${userId}@example.test`})`;
	return userId;
}).pipe(Effect.orDie);

const accountColumns = (workflow: Workflow.Any, executionId: string) =>
	Effect.gen(function* () {
		const sql = yield* PgClient.PgClient;
		return yield* sql<{ accountUserId: null | string }>`
			select account_user_id as "accountUserId"
			from workflow_execution where workflow_name = ${workflow._tag} and execution_id = ${executionId}`;
	}).pipe(Effect.orDie);

const rejection = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
	Effect.map(Effect.exit(effect), (exit) => {
		const defect = Exit.isFailure(exit) ? Cause.squash(exit.cause) : undefined;
		return defect instanceof WorkflowAccountRejected ? defect.message : "admitted";
	});

layer(Layer.mergeAll(BunServices.layer, isolatedDatabase), { excludeTestServices: true })(
	(test) => {
		for (const engine of engines) {
			test.effect(`${engine.name}: replays a resumed workflow without rerunning activities`, () =>
				Effect.gen(function* () {
					const id = yield* randomUuid;
					const executionId = yield* Waiting.executionId({ id });
					yield* Waiting.execute({ id }, { discard: true });
					yield* untilResult(Waiting.poll(executionId), "Suspended");
					yield* signal(Signal, Waiting, executionId, "go");
					expect(yield* complete(Waiting.poll(executionId))).toEqual(Exit.succeed("go:1"));
					expect(activityRuns.get(id)).toBe(1);
				}).pipe(withEngine(engine.make())),
			);

			test.effect(`${engine.name}: wakes an awaiting parent when its child completes`, () =>
				Effect.gen(function* () {
					const id = yield* randomUuid;
					const childId = yield* Child.executionId({ id: `${id}-child` });
					yield* Parent.execute({ id }, { discard: true });
					yield* untilResult(Child.poll(childId), "Suspended");
					yield* signal(ChildSignal, Child, childId, "done");
					expect(yield* complete(Parent.poll(yield* Parent.executionId({ id })))).toEqual(
						Exit.succeed("parent:child:done"),
					);
				}).pipe(withEngine(engine.make())),
			);

			test.effect(`${engine.name}: fires a durable clock`, () =>
				Effect.gen(function* () {
					const id = yield* randomUuid;
					expect(yield* Sleeper.execute({ id })).toBe("woke");
				}).pipe(withEngine(engine.make())),
			);

			test.effect(`${engine.name}: interrupts a suspended workflow and runs its finalizer`, () =>
				Effect.gen(function* () {
					const id = yield* randomUuid;
					const executionId = yield* Waiting.executionId({ id });
					yield* Waiting.execute({ id }, { discard: true });
					yield* untilResult(Waiting.poll(executionId), "Suspended");
					yield* Waiting.interrupt(executionId);
					const exit = yield* complete(Waiting.poll(executionId));
					expect(Exit.isFailure(exit) && Cause.hasInterruptsOnly(exit.cause)).toBe(true);
					expect(activityRuns.get(id)).toBe(1);
					expect(finalizerExits.get(id)?.filter(Exit.isFailure)).toHaveLength(1);
				}).pipe(withEngine(engine.make())),
			);
		}

		test.effect("postgres: a parent joins the child a caller outside it ran on its behalf", () =>
			Effect.gen(function* () {
				const id = yield* randomUuid;
				const countedId = `${id}-counted`;
				const executionId = yield* Joining.executionId({ id });
				yield* Joining.execute({ id }, { discard: true });
				yield* untilResult(Joining.poll(executionId), "Suspended");
				const outside = yield* Counted.execute({ id: countedId }).pipe(
					Effect.provideService(WorkflowInstance, WorkflowInstance.initial(Joining, executionId)),
					Effect.forkChild,
				);
				expect(yield* Fiber.join(outside)).toBe("counted:1");
				yield* signal(Signal, Joining, executionId, "go");
				expect(yield* complete(Joining.poll(executionId))).toEqual(
					Exit.succeed("joined:counted:1"),
				);
				expect(activityRuns.get(countedId)).toBe(1);
				const sql = yield* PgClient.PgClient;
				expect(
					yield* sql`select root_execution_id as "root" from workflow_execution
						where workflow_name = ${Counted._tag}
						and execution_id = ${yield* Counted.executionId({ id: countedId })}`,
				).toEqual([{ root: executionId }]);
			}).pipe(withEngine(postgresEngine())),
		);

		test.effect("postgres: forgets only the activities of a finished step scope", () =>
			Effect.gen(function* () {
				const id = yield* randomUuid;
				const executionId = yield* Scoped.executionId({ id });
				yield* Scoped.execute({ id }, { discard: true });
				expect(yield* complete(Scoped.poll(executionId))).toEqual(Exit.succeed("2"));
				expect(activityRuns.get(`${id}:kept`)).toBe(1);
				expect(activityRuns.get(`${id}:forgotten`)).toBe(2);
			}).pipe(withEngine(postgresEngine())),
		);

		test.effect("postgres: a child's steps stay outside its parent's step scope", () =>
			Effect.gen(function* () {
				const id = yield* randomUuid;
				const childId = `${id}-child`;
				const childExecutionId = yield* Waiting.executionId({ id: childId });
				yield* Effect.scoped(
					Effect.gen(function* () {
						yield* ScopedParent.execute({ id }, { discard: true });
						yield* untilResult(Waiting.poll(childExecutionId), "Suspended");
					}).pipe(withEngine(postgresEngine())),
				);
				yield* Effect.gen(function* () {
					yield* signal(Signal, Waiting, childExecutionId, "go");
					expect(yield* complete(Waiting.poll(childExecutionId))).toEqual(Exit.succeed("go:1"));
					expect(activityRuns.get(childId)).toBe(1);
				}).pipe(withEngine(postgresEngine()));
			}),
		);

		test.effect("postgres: a new process resumes a released execution from its stored steps", () =>
			Effect.gen(function* () {
				const id = yield* randomUuid;
				const executionId = yield* Waiting.executionId({ id });
				yield* Effect.scoped(
					Effect.gen(function* () {
						yield* Waiting.execute({ id }, { discard: true });
						yield* untilResult(Waiting.poll(executionId), "Suspended");
					}).pipe(withEngine(postgresEngine())),
				);
				yield* Effect.gen(function* () {
					yield* signal(Signal, Waiting, executionId, "after-restart");
					expect(yield* complete(Waiting.poll(executionId))).toEqual(
						Exit.succeed("after-restart:1"),
					);
					expect(activityRuns.get(id)).toBe(1);
				}).pipe(withEngine(postgresEngine()));
			}),
		);

		test.effect(
			"postgres: a new process takes over an orphaned execution and fires its clock",
			() =>
				Effect.gen(function* () {
					const id = yield* randomUuid;
					const executionId = yield* LongSleeper.executionId({ id });
					yield* Effect.scoped(
						Effect.gen(function* () {
							yield* LongSleeper.execute({ id }, { discard: true });
							yield* untilResult(LongSleeper.poll(executionId), "Suspended");
						}).pipe(withEngine(postgresEngine())),
					);
					expect(
						yield* complete(LongSleeper.poll(executionId)).pipe(withEngine(postgresEngine())),
					).toEqual(Exit.succeed("woke later"));
				}),
		);

		test.effect("postgres: records the admitting account for an execution and its children", () =>
			Effect.gen(function* () {
				const account = yield* insertUser;
				const id = yield* randomUuid;
				const executionId = yield* Parent.executionId({ id });
				const childId = yield* Child.executionId({ id: `${id}-child` });
				yield* Parent.execute({ id }, { discard: true }).pipe(
					Effect.provideService(WorkflowAdmissionAccount, account),
				);
				yield* untilResult(Child.poll(childId), "Suspended");
				const owned = { accountUserId: account };
				expect(yield* accountColumns(Parent, executionId)).toEqual([owned]);
				expect(yield* accountColumns(Child, childId)).toEqual([owned]);
				expect(
					[...(yield* (yield* WorkflowAccounts).listActive(account))].sort((left, right) =>
						left.workflowName.localeCompare(right.workflowName),
					),
				).toEqual([
					{ executionId: childId, workflowName: Child._tag },
					{ executionId, workflowName: Parent._tag },
				]);
			}).pipe(withEngine(postgresEngine())),
		);

		test.effect("postgres: wakes a run for each of two concurrent durable sleeps", () =>
			Effect.gen(function* () {
				const id = yield* randomUuid;
				yield* TwinSleeper.execute({ id }, { discard: true });
				expect(yield* complete(TwinSleeper.poll(yield* TwinSleeper.executionId({ id })))).toEqual(
					Exit.succeed("both woke"),
				);
			}).pipe(withEngine(postgresEngine())),
		);

		test.effect("postgres: runs a workflow started by a job outside that job", () =>
			Effect.gen(function* () {
				const id = yield* randomUuid;
				yield* Jobless.execute({ id }, { discard: true }).pipe(
					Effect.provideService(CurrentJobId, "job-1"),
				);
				expect(yield* complete(Jobless.poll(yield* Jobless.executionId({ id })))).toEqual(
					Exit.succeed("no job"),
				);
			}).pipe(withEngine(postgresEngine())),
		);

		test.effect("postgres: refuses admission for a retiring account", () =>
			Effect.gen(function* () {
				const sql = yield* PgClient.PgClient;
				const account = yield* insertUser;
				const id = yield* randomUuid;
				const admit = rejection(
					Waiting.execute({ id }, { discard: true }).pipe(
						Effect.provideService(WorkflowAdmissionAccount, account),
					),
				);
				yield* sql`update "user" set retiring_at = now() where id = ${account}`.pipe(Effect.orDie);
				expect(yield* admit).toBe("Mutation command belongs to a retired account");
				expect(yield* Waiting.poll(yield* Waiting.executionId({ id }))).toEqual(Option.none());
			}).pipe(withEngine(postgresEngine())),
		);

		test.effect("postgres: binds an unowned execution to one account only", () =>
			Effect.gen(function* () {
				const account = yield* insertUser;
				const other = yield* insertUser;
				const id = yield* randomUuid;
				const executionId = yield* Adopter.executionId({ id, userId: account });
				yield* Adopter.execute({ id, userId: account }, { discard: true });
				yield* untilResult(Adopter.poll(executionId), "Suspended");
				expect(yield* accountColumns(Adopter, executionId)).toEqual([{ accountUserId: account }]);
				expect(
					yield* rejection(
						Adopter.execute({ id, userId: account }, { discard: true }).pipe(
							Effect.provideService(WorkflowAdmissionAccount, other),
						),
					),
				).toBe("Workflow belongs to another account");
			}).pipe(withEngine(postgresEngine())),
		);

		test.effect("postgres: an interrupt written by another process interrupts the owner", () =>
			Effect.gen(function* () {
				const id = yield* randomUuid;
				const executionId = yield* Waiting.executionId({ id });
				const owner = yield* Layer.build(postgresEngine());
				const other = yield* Layer.build(postgresEngine());
				yield* Waiting.execute({ id }, { discard: true }).pipe(Effect.provideContext(owner));
				yield* untilResult(Waiting.poll(executionId), "Suspended").pipe(
					Effect.provideContext(owner),
				);
				yield* Waiting.interrupt(executionId).pipe(Effect.provideContext(other));
				const exit = yield* complete(Waiting.poll(executionId)).pipe(Effect.provideContext(owner));
				expect(Exit.isFailure(exit) && Cause.hasInterruptsOnly(exit.cause)).toBe(true);
				expect(finalizerExits.get(id)?.filter(Exit.isFailure)).toHaveLength(1);
			}),
		);

		test.effect("postgres: a completion written by another process wakes the owner", () =>
			Effect.gen(function* () {
				const id = yield* randomUuid;
				const executionId = yield* Waiting.executionId({ id });
				const owner = yield* Layer.build(postgresEngine());
				const other = yield* Layer.build(postgresEngine());
				yield* Waiting.execute({ id }, { discard: true }).pipe(Effect.provideContext(owner));
				yield* untilResult(Waiting.poll(executionId), "Suspended").pipe(
					Effect.provideContext(owner),
				);
				yield* signal(Signal, Waiting, executionId, "remote").pipe(Effect.provideContext(other));
				expect(
					yield* complete(Waiting.poll(executionId)).pipe(Effect.provideContext(owner)),
				).toEqual(Exit.succeed("remote:1"));
				expect(
					yield* complete(Waiting.poll(executionId)).pipe(Effect.provideContext(other)),
				).toEqual(Exit.succeed("remote:1"));
			}),
		);
	},
);
