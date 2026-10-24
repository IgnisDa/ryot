import { expect, layer } from "@effect/vitest";
import { DbError } from "@ryot-app/contract/errors";
import { ImportRunId, IntegrationId, UserId } from "@ryot-app/contract/schema/brands";
import { assertExitFails } from "@ryot-app/testing/effect-assertions";
import { Effect, Layer, Ref } from "effect";

import { DatabaseSession } from "#platform/db/session";
import * as tables from "#schema/tables/combined";
import { fakeDatabaseSession } from "#testing/effect";
import { isolatedDatabaseLayer } from "#testing/isolated-database";

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
const activeRunConflict = new DbError({
	code: "23505",
	message: "duplicate key",
	constraint: "import_run_integration_active_unique",
});
const otherConstraintFailure = new DbError({
	code: "23505",
	message: "duplicate key",
	constraint: "import_run_pkey",
});
const makeRepositoryLayer = (conflict: DbError) =>
	ImportsRepository.layer.pipe(
		Layer.provideMerge(
			Layer.unwrap(
				Effect.gen(function* () {
					const admitted = yield* Ref.make(false);
					return fakeDatabaseSession({
						execute: () => Effect.void,
						select: () => ({
							from: () => ({
								where: () => ({
									for: () => Effect.succeed([{ id: userId }]),
									limit: () => Effect.succeed([{ id: userId }]),
								}),
							}),
						}),
						insert: () => ({
							values: () => ({
								returning: () =>
									Ref.getAndSet(admitted, true).pipe(
										Effect.flatMap((alreadyAdmitted) =>
											alreadyAdmitted ? Effect.fail(conflict) : Effect.succeed([row]),
										),
									),
							}),
						}),
					});
				}),
			),
		),
	);
layer(makeRepositoryLayer(activeRunConflict))((test) => {
	test.effect("admits a single yank run and refuses the concurrent loser", () =>
		Effect.gen(function* () {
			const repository = yield* ImportsRepository;
			const database = yield* DatabaseSession;
			const runs = yield* Effect.all(
				[
					database.transaction(repository.createIntegrationRunIfIdle(admission)),
					database.transaction(repository.createIntegrationRunIfIdle(admission)),
				],
				{ concurrency: 2 },
			);
			expect(runs.filter((run) => run !== null)).toHaveLength(1);
			expect(runs.filter((run) => run === null)).toHaveLength(1);
		}),
	);
});
layer(makeRepositoryLayer(otherConstraintFailure))((test) => {
	test.effect("propagates unique violations from other constraints", () =>
		Effect.gen(function* () {
			const repository = yield* ImportsRepository;
			const database = yield* DatabaseSession;
			yield* database.transaction(repository.createIntegrationRunIfIdle(admission));
			assertExitFails(
				yield* Effect.exit(database.transaction(repository.createIntegrationRunIfIdle(admission))),
				otherConstraintFailure,
			);
		}),
	);
});

layer(
	ImportsRepository.layer.pipe(
		Layer.provideMerge(isolatedDatabaseLayer("imports_disabled_yank_admission")),
	),
)((test) => {
	test.effect("rejects yank run admission for a disabled user", () =>
		Effect.gen(function* () {
			const repository = yield* ImportsRepository;
			const database = yield* DatabaseSession;
			const disabledUserId = UserId.make("disabled-admission-user");
			const disabledIntegrationId = IntegrationId.make("disabled-admission-integration");
			yield* database.run((db) =>
				db
					.insert(tables.user)
					.values({
						name: "Disabled",
						id: disabledUserId,
						email: "disabled-admission@example.test",
						disabledAt: new Date("2026-09-23T00:00:00.000Z"),
					}),
			);
			yield* database.run((db) =>
				db
					.insert(tables.integration)
					.values({
						lot: "sink",
						isDisabled: false,
						provider: "data-json",
						providerSpecifics: {},
						userId: disabledUserId,
						id: disabledIntegrationId,
						pluginInstallationId: null,
						clientProviderSpecifics: {},
						webhookToken: "disabled-admission-webhook",
						extraSettings: { disableOnContinuousErrors: false },
					}),
			);

			const run = yield* database.transaction(
				repository.createIntegrationRunIfIdle({
					source: "theta",
					inputSummary: {},
					userId: disabledUserId,
					integrationId: disabledIntegrationId,
					pluginInstallationId: "unused-installation",
				}),
			);
			expect(run).toBeNull();
			expect(
				yield* database.run((db) => db.select({ id: tables.importRun.id }).from(tables.importRun)),
			).toEqual([]);
		}),
	);
});
