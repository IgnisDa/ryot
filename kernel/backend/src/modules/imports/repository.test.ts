import { expect, it } from "@effect/vitest";
import { DbError } from "@ryot-app/contract/errors";
import { ImportRunId, IntegrationId, UserId } from "@ryot-app/contract/schema/brands";
import { Effect, Layer } from "effect";

import { Database } from "#lib/infrastructure/db/service";
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
	status: "pending" as const,
	createdAt: new Date(0),
	updatedAt: new Date(0),
	id: ImportRunId.make("run-id"),
};

const admission = {
	userId,
	integrationId,
	source: "theta",
	inputSummary: {},
	pluginInstallationId: "example-installation-id",
};

const repositoryLayer = (db: unknown) =>
	Layer.mergeAll(
		ImportsRepository.layer,
		Layer.succeed(Database, Object.assign(Object.create(null), db)),
	);

const insertingDatabase = (
	onInsert: (values: Record<string, unknown>) => Effect.Effect<ReadonlyArray<typeof row>, DbError>,
) => ({
	insert: () => ({
		values: (values: Record<string, unknown>) => ({
			returning: () => Effect.suspend(() => onInsert(values)),
		}),
	}),
});

it.effect("admits a single yank run and refuses the concurrent loser", () => {
	let admitted = false;
	const insertedValues: Array<Record<string, unknown>> = [];
	const db = insertingDatabase((values) => {
		insertedValues.push(values);
		if (admitted) {
			return Effect.fail(
				new DbError({
					code: "23505",
					message: "duplicate key",
					constraint: "import_run_integration_active_unique",
				}),
			);
		}
		admitted = true;
		return Effect.succeed([row]);
	});

	return Effect.gen(function* () {
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
		for (const values of insertedValues) {
			expect(values).toMatchObject({ integrationId, integrationLot: "yank" });
		}
	}).pipe(Effect.provide(repositoryLayer(db)));
});

it.effect("propagates unique violations from other constraints", () => {
	const failure = new DbError({
		code: "23505",
		message: "duplicate key",
		constraint: "import_run_pkey",
	});
	const db = insertingDatabase(() => Effect.fail(failure));

	return Effect.gen(function* () {
		const repository = yield* ImportsRepository;
		assertExitFails(
			yield* Effect.exit(repository.createRunForIntegrationIfIdle(admission)),
			failure,
		);
	}).pipe(Effect.provide(repositoryLayer(db)));
});
