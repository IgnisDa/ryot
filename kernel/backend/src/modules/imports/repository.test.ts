import { expect, layer } from "@effect/vitest";
import { DbError } from "@ryot-app/contract/errors";
import { ImportRunId, IntegrationId, UserId } from "@ryot-app/contract/schema/brands";
import { Context, Effect, Layer, Ref } from "effect";

import { DatabaseSession } from "#lib/infrastructure/db/session";
import { assertExitFails } from "#lib/test-utils/assertions";

import { ImportsRepository } from "./repository";

const userId = UserId.make("user-id");
const integrationId = IntegrationId.make("integration-id");

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
						Layer.mock(DatabaseSession)({
							current: Effect.succeed(Object.assign(Object.create(null), db)),
						}),
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
					repository.createRunForIntegrationIfIdle(admission),
					repository.createRunForIntegrationIfIdle(admission),
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
				yield* Effect.exit(repository.createRunForIntegrationIfIdle(admission)),
				otherConstraintFailure,
			);
		}),
	);
});
