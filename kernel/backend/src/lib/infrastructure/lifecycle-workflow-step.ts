import { Effect, Schema } from "effect";

import { LifecycleDispatchPlan } from "#lib/domain/lifecycle";
import { LifecycleExecution } from "#lib/domain/lifecycle-execution";

import { makeActivity } from "./workflow-scope";

type DurableCodec<T> = Schema.Codec<T, unknown>;

export const LifecycleCommittedStep = <Result>(result: DurableCodec<Result>) =>
	Schema.TaggedStruct("Committed", { result, dispatch: Schema.Array(LifecycleDispatchPlan) });

export const LifecyclePreparedStep = <Result, Pending>(
	result: DurableCodec<Result>,
	pending: DurableCodec<Pending>,
) =>
	Schema.Union([
		LifecycleCommittedStep(result),
		Schema.TaggedStruct("PoliciesRequired", { pending }),
	]);

export type LifecycleCommittedStep<Result> = {
	readonly _tag: "Committed";
	readonly result: Result;
	readonly dispatch: ReadonlyArray<LifecycleDispatchPlan>;
};

export type LifecyclePreparedStep<Result, Pending> =
	| LifecycleCommittedStep<Result>
	| { readonly _tag: "PoliciesRequired"; readonly pending: Pending };

export const mapCommittedResult = <Result, Mapped, Pending>(
	step: LifecyclePreparedStep<Result, Pending>,
	map: (result: Result) => Mapped,
): LifecyclePreparedStep<Mapped, Pending> =>
	step._tag === "Committed" ? { ...step, result: map(step.result) } : step;

const dispatchCommitted = <Result>(
	execution: LifecycleExecution["Service"],
	committed: LifecycleCommittedStep<Result>,
) =>
	execution.dispatch(committed.dispatch).pipe(
		Effect.catchTag("LifecyclePersistenceError", Effect.die),
		Effect.map((warnings) => ({ warnings, result: committed.result })),
	);

export type LifecycleWriteStep<
	Result,
	Pending,
	EPrepare,
	EPolicies,
	ECommit,
	RPrepare,
	RPolicies,
	RCommit,
> = {
	readonly prepare: Effect.Effect<LifecyclePreparedStep<Result, Pending>, EPrepare, RPrepare>;
	readonly applyPolicies: (pending: Pending) => Effect.Effect<Pending, EPolicies, RPolicies>;
	readonly commit: (
		pending: Pending,
	) => Effect.Effect<LifecyclePreparedStep<Result, Pending>, ECommit, RCommit>;
};

export const runLifecycleWriteInline = <
	Result,
	Pending,
	EPrepare,
	EPolicies,
	ECommit,
	RPrepare,
	RPolicies,
	RCommit,
>(
	execution: LifecycleExecution["Service"],
	step: LifecycleWriteStep<
		Result,
		Pending,
		EPrepare,
		EPolicies,
		ECommit,
		RPrepare,
		RPolicies,
		RCommit
	>,
) =>
	Effect.gen(function* () {
		let prepared = yield* step.prepare;
		while (prepared._tag === "PoliciesRequired") {
			prepared = yield* step.commit(yield* step.applyPolicies(prepared.pending));
		}
		return yield* dispatchCommitted(execution, prepared);
	});

export const runLifecycleWriteStep = <Result, Pending, Failure, RPrepare, RPolicies, RCommit>(
	options: LifecycleWriteStep<
		Result,
		Pending,
		NoInfer<Failure>,
		NoInfer<Failure>,
		NoInfer<Failure>,
		RPrepare,
		RPolicies,
		RCommit
	> & {
		readonly name: string;
		readonly result: DurableCodec<Result>;
		readonly pending: DurableCodec<Pending>;
		readonly error: DurableCodec<Failure>;
	},
) =>
	Effect.gen(function* () {
		const execution = yield* LifecycleExecution;
		const success = LifecyclePreparedStep(options.result, options.pending);
		let prepared = yield* makeActivity({
			success,
			error: options.error,
			execute: options.prepare,
			name: `${options.name}:prepare`,
		});
		for (let round = 0; prepared._tag === "PoliciesRequired"; round += 1) {
			const suffix = round === 0 ? "" : `-${round}`;
			const outcome = yield* options.applyPolicies(prepared.pending).pipe(
				Effect.map((pending) => ({ pending, _tag: "Accepted" as const })),
				Effect.catch((error) => Effect.succeed({ error, _tag: "Rejected" as const })),
			);
			const recorded = yield* makeActivity({
				execute: Effect.succeed(outcome),
				name: `${options.name}:policy-outcome${suffix}`,
				success: Schema.Union([
					Schema.TaggedStruct("Accepted", { pending: options.pending }),
					Schema.TaggedStruct("Rejected", { error: options.error }),
				]),
			});
			if (recorded._tag === "Rejected") {
				return yield* Effect.fail(recorded.error);
			}
			prepared = yield* makeActivity({
				success,
				error: options.error,
				name: `${options.name}:commit${suffix}`,
				execute: options.commit(recorded.pending),
			});
		}
		return yield* dispatchCommitted(execution, prepared);
	});
