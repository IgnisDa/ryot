import { Effect } from "effect";

import { CurrentDb, dbEffect, isUniqueConstraintError, schema } from "../../lib/db";
import { DbError, PatternsDuplicateItem } from "../../lib/errors";
import type { PatternsItem, PatternsRun, PatternsStep } from "./schemas";

const audibleItemRunQueryConstraint = "reference_audible_item_run_query_idx";

const duplicateItem = (query: string) =>
	new PatternsDuplicateItem({
		query,
		message: "Audible item query already exists for this run",
	});

export class PatternsRepository extends Effect.Service<PatternsRepository>()("PatternsRepository", {
	sync: () => ({
		createItem: (
			runId: string,
			query: string,
		): Effect.Effect<PatternsItem, DbError | PatternsDuplicateItem, CurrentDb> =>
			Effect.gen(function* () {
				const db = yield* CurrentDb;
				const [row] = yield* dbEffect(() =>
					db
						.insert(schema.audibleItem)
						.values({
							runId,
							query,
							status: "created",
							details: { source: "patterns" },
						})
						.returning({
							id: schema.audibleItem.id,
							query: schema.audibleItem.query,
						}),
				).pipe(
					Effect.catchIf(isUniqueConstraintError(audibleItemRunQueryConstraint), () =>
						Effect.fail(duplicateItem(query)),
					),
				);

				if (!row) {
					return yield* new DbError({ message: "Patterns item insert returned no row" });
				}

				return row;
			}),
		createRun: (userId: string): Effect.Effect<PatternsRun, DbError, CurrentDb> =>
			Effect.gen(function* () {
				const db = yield* CurrentDb;
				const [row] = yield* dbEffect(() =>
					db
						.insert(schema.audibleRun)
						.values({
							userId,
							status: "queued",
							query: "patterns",
						})
						.returning({ id: schema.audibleRun.id }),
				);

				if (!row) {
					return yield* new DbError({ message: "Patterns run insert returned no row" });
				}

				return row;
			}),
		createStep: (runId: string): Effect.Effect<PatternsStep, DbError, CurrentDb> =>
			Effect.gen(function* () {
				const db = yield* CurrentDb;
				const [row] = yield* dbEffect(() =>
					db
						.insert(schema.workflowStep)
						.values({
							runId,
							status: "created",
							name: "patterns",
							details: { source: "patterns" },
						})
						.returning({ id: schema.workflowStep.id }),
				);

				if (!row) {
					return yield* new DbError({ message: "Patterns step insert returned no row" });
				}

				return row;
			}),
	}),
}) {}
