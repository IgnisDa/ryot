import { expect, layer } from "@effect/vitest";
import { DbError } from "@ryot-app/contract/errors";
import type { ImportRunStatus } from "@ryot-app/contract/modules/imports/schemas";
import { ImportRunId, IntegrationId, UserId } from "@ryot-app/contract/schema/brands";
import type { SQLWrapper } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { Context, Effect, Layer, Ref } from "effect";

import { assertExitFails } from "#lib/test-utils/assertions";
import { fakeDatabaseSession } from "#lib/test-utils/effect";

import { ImportsRepository } from "./repository";

const userId = UserId.make("user-id");
const integrationId = IntegrationId.make("integration-id");
const transitionAt = new Date(1);

const row = {
	userId,
	progress: 0,
	failedItems: 0,
	startedAt: null,
	source: "theta",
	inputSummary: {},
	totalItems: null,
	finishedAt: null,
	importedItems: 0,
	processedItems: 0,
	failureReason: null,
	createdAt: new Date(0),
	updatedAt: new Date(0),
	status: "pending" as const,
	id: ImportRunId.make("run-id"),
};

const admission = {
	userId,
	integrationId,
	source: "theta",
	inputSummary: {},
	pluginInstallationId: "example-installation-id",
};

class FakeImportRunInserts extends Context.Service<
	FakeImportRunInserts,
	{ readonly insertedValues: Effect.Effect<ReadonlyArray<Record<string, unknown>>> }
>()("test/FakeImportRunInserts") {}

const makeRepositoryLayer = (
	onInsert: (admitted: boolean) => Effect.Effect<ReadonlyArray<typeof row>, DbError>,
) =>
	ImportsRepository.layer.pipe(
		Layer.provideMerge(
			Layer.unwrap(
				Effect.gen(function* () {
					const admitted = yield* Ref.make(false);
					const insertedValues = yield* Ref.make<ReadonlyArray<Record<string, unknown>>>([]);
					const db = {
						insert: () => ({
							values: (values: Record<string, unknown>) => ({
								returning: () =>
									Ref.update(insertedValues, (all) => [...all, values]).pipe(
										Effect.andThen(Ref.getAndSet(admitted, true)),
										Effect.flatMap(onInsert),
									),
							}),
						}),
					};
					return Layer.merge(
						Layer.succeed(FakeImportRunInserts, { insertedValues: Ref.get(insertedValues) }),
						fakeDatabaseSession(db),
					);
				}),
			),
		),
	);

const activeRunConflict = new DbError({
	code: "23505",
	message: "duplicate key",
	constraint: "import_run_integration_active_unique",
});

layer(
	makeRepositoryLayer((alreadyAdmitted) =>
		alreadyAdmitted ? Effect.fail(activeRunConflict) : Effect.succeed([row]),
	),
)((test) => {
	test.effect("admits a single yank run and refuses the concurrent loser", () =>
		Effect.gen(function* () {
			const repository = yield* ImportsRepository;
			const runs = yield* Effect.all(
				[
					repository.createIntegrationRunIfIdle(admission),
					repository.createIntegrationRunIfIdle(admission),
				],
				{ concurrency: "unbounded" },
			);

			expect(runs.filter((run) => run !== null)).toHaveLength(1);
			expect(runs.filter((run) => run === null)).toHaveLength(1);
			for (const values of yield* (yield* FakeImportRunInserts).insertedValues) {
				expect(values).toMatchObject({ integrationId, integrationLot: "yank" });
			}
		}),
	);
});

const otherConstraintFailure = new DbError({
	code: "23505",
	message: "duplicate key",
	constraint: "import_run_pkey",
});

layer(makeRepositoryLayer(() => Effect.fail(otherConstraintFailure)))((test) => {
	test.effect("propagates unique violations from other constraints", () =>
		Effect.gen(function* () {
			const repository = yield* ImportsRepository;
			assertExitFails(
				yield* Effect.exit(repository.createIntegrationRunIfIdle(admission)),
				otherConstraintFailure,
			);
		}),
	);
});

type Predicate = { readonly sql: string; readonly params: ReadonlyArray<unknown> };

class FakeImportRunTransitions extends Context.Service<
	FakeImportRunTransitions,
	{
		readonly updatePredicates: Effect.Effect<ReadonlyArray<Predicate>>;
		readonly selectPredicates: Effect.Effect<ReadonlyArray<Predicate>>;
	}
>()("test/FakeImportRunTransitions") {}

const dialect = new PgDialect();
const makeTransitionLayer = (selectedStatus: ImportRunStatus | null) =>
	ImportsRepository.layer.pipe(
		Layer.provideMerge(
			Layer.unwrap(
				Effect.gen(function* () {
					const updatePredicates = yield* Ref.make<ReadonlyArray<Predicate>>([]);
					const selectPredicates = yield* Ref.make<ReadonlyArray<Predicate>>([]);
					const record = (ref: Ref.Ref<ReadonlyArray<Predicate>>, condition: SQLWrapper) =>
						Ref.update(ref, (all) => [...all, dialect.sqlToQuery(condition.getSQL())]);
					const selectedRows =
						selectedStatus === null
							? []
							: [{ id: row.id, integrationId: null, status: selectedStatus }];
					const db = {
						update: () => ({
							set: () => ({
								where: (condition: SQLWrapper) => ({
									returning: () => record(updatePredicates, condition).pipe(Effect.as([])),
								}),
							}),
						}),
						select: () => ({
							from: () => ({
								where: (condition: SQLWrapper) => ({
									limit: () => record(selectPredicates, condition).pipe(Effect.as(selectedRows)),
								}),
							}),
						}),
					};
					return Layer.merge(
						Layer.succeed(FakeImportRunTransitions, {
							updatePredicates: Ref.get(updatePredicates),
							selectPredicates: Ref.get(selectPredicates),
						}),
						fakeDatabaseSession(db),
					);
				}),
			),
		),
	);

layer(makeTransitionLayer("cancelling"))((test) => {
	test.effect("preserves cancellation when completion or failure loses the transition", () =>
		Effect.gen(function* () {
			const repository = yield* ImportsRepository;
			expect(yield* repository.finishCompleted({ runId: row.id, finishedAt: transitionAt })).toBe(
				"cancellation-requested",
			);
			expect(
				yield* repository.finishFailed({
					runId: row.id,
					finishedAt: transitionAt,
					failureReason: { operation: "test", code: "unexpected-failure" },
				}),
			).toBe("cancellation-requested");

			const predicates = yield* (yield* FakeImportRunTransitions).updatePredicates;
			expect(predicates[0]?.params).toEqual([row.id, "running"]);
			expect(predicates[1]?.params).toEqual([row.id, "pending", "running"]);
		}),
	);
});

for (const status of ["completed", "failed"] as const) {
	layer(makeTransitionLayer(status))((test) => {
		test.effect(`preserves ${status} when cancellation loses the transition`, () =>
			Effect.gen(function* () {
				expect(
					yield* (yield* ImportsRepository).requestCancellation({ userId, runId: row.id }),
				).toBe("not-cancellable");
				const [predicate] = yield* (yield* FakeImportRunTransitions).updatePredicates;
				expect(predicate?.params).toEqual([row.id, userId, "pending", "running"]);
			}),
		);
	});
}

for (const status of ["cancelling", "cancelled"] as const) {
	layer(makeTransitionLayer(status))((test) => {
		test.effect(`treats repeated cancellation of a ${status} run as already requested`, () =>
			Effect.gen(function* () {
				expect(
					yield* (yield* ImportsRepository).requestCancellation({ userId, runId: row.id }),
				).toBe("already-requested");
			}),
		);
	});
}

layer(makeTransitionLayer("cancelled"))((test) => {
	test.effect("does not start a run after cancellation", () =>
		Effect.gen(function* () {
			expect(
				yield* (yield* ImportsRepository).markStarted({ runId: row.id, startedAt: transitionAt }),
			).toBe("cancellation-requested");
			const [predicate] = yield* (yield* FakeImportRunTransitions).updatePredicates;
			expect(predicate?.params).toEqual([row.id, "pending"]);
		}),
	);
});

layer(makeTransitionLayer(null))((test) => {
	test.effect("scopes cancellation transitions and fallback reads to the owning user", () =>
		Effect.gen(function* () {
			expect(
				yield* (yield* ImportsRepository).requestCancellation({ userId, runId: row.id }),
			).toBeNull();
			const fake = yield* FakeImportRunTransitions;
			const [updatePredicate] = yield* fake.updatePredicates;
			const [selectPredicate] = yield* fake.selectPredicates;
			expect(updatePredicate?.params).toEqual([row.id, userId, "pending", "running"]);
			expect(selectPredicate?.params).toEqual([row.id, userId]);
			expect(updatePredicate?.sql).toContain('"user_id"');
			expect(selectPredicate?.sql).toContain('"user_id"');
		}),
	);
});
