import { Effect } from "effect";

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

export class PatternsService extends Effect.Service<PatternsService>()("PatternsService", {
	effect: Effect.gen(function* () {
		const runInTransaction = yield* TransactionRunner;
		const repository = yield* PatternsRepository;

		return {
			dbTransaction: (
				user: CurrentUserValue,
				payload: DbTransactionPayload,
			): Effect.Effect<PatternsResult, DbError | PatternsRejected> =>
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
			uniqueConstraint: (
				user: CurrentUserValue,
				payload: RunUniqueConstraintPayload,
			): Effect.Effect<UniqueConstraintResult, DbError | PatternsDuplicateItem> =>
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
			filterCondition: (_payload: FilterConditionPayload): Effect.Effect<FilterResult> =>
				Effect.succeed({ status: true as const }),
		};
	}),
}) {}
