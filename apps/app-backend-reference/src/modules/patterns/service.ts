import { Context, Effect, Layer } from "effect";

import type { CurrentUserValue } from "../../lib/auth";
import { TransactionRunner } from "../../lib/db";
import type { DbError, PatternsDuplicateItem } from "../../lib/errors";
import { PatternsRejected } from "../../lib/errors";
import { PatternsRepository } from "./repository";
import type {
	DbTransactionPayload,
	FilterConditionPayload,
	FilterResult,
	RunUniqueConstraintPayload,
	PatternsResult,
	UniqueConstraintResult,
} from "./schemas";

export class PatternsService extends Context.Tag("PatternsService")<
	PatternsService,
	{
		readonly dbTransaction: (
			user: CurrentUserValue,
			payload: DbTransactionPayload,
		) => Effect.Effect<PatternsResult, DbError | PatternsRejected>;
		readonly uniqueConstraint: (
			user: CurrentUserValue,
			payload: RunUniqueConstraintPayload,
		) => Effect.Effect<UniqueConstraintResult, DbError | PatternsDuplicateItem>;
		readonly filterCondition: (payload: FilterConditionPayload) => Effect.Effect<FilterResult>;
	}
>() {}

export const PatternsServiceLive = Layer.effect(
	PatternsService,
	Effect.gen(function* () {
		const runInTransaction = yield* TransactionRunner;
		const repository = yield* PatternsRepository;

		return {
			dbTransaction: (user, payload) =>
				runInTransaction(
					Effect.gen(function* () {
						const run = yield* repository.createRun(user.id);
						const step = yield* repository.createStep(run.id);

						if (payload.mode === "rollback") {
							return yield* new PatternsRejected({
								runId: run.id,
								message: "Patterns rollback requested",
							});
						}

						return { runId: run.id, stepId: step.id };
					}),
				),
			uniqueConstraint: (user, payload) =>
				runInTransaction(
					Effect.gen(function* () {
						const run = yield* repository.createRun(user.id);
						const item = yield* repository.createItem(run.id, payload.query);

						if (payload.duplicate) {
							yield* repository.createItem(run.id, payload.query);
						}

						return {
							query: item.query,
							runId: run.id,
							itemId: item.id,
						};
					}),
				),
			filterCondition: (_payload) => Effect.succeed({ status: true as const }),
		};
	}),
);
