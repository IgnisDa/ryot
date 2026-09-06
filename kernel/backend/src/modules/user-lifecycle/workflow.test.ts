import { PgClient } from "@effect/sql-pg";
import { expect, layer } from "@effect/vitest";
import { BadRequest, internalError } from "@ryot-app/contract/errors";
import { UserId } from "@ryot-app/contract/schema/brands";
import { sql } from "drizzle-orm";
import { Context, Effect, Layer, Redacted, Ref } from "effect";
import { WorkflowEngine, WorkflowInstance } from "effect/unstable/workflow/WorkflowEngine";

import { DatabaseSession } from "#lib/infrastructure/db/session";
import { testDatabaseUrl } from "#lib/test-utils/database";
import { databaseLayer, makeWorkflowActivityEngine } from "#lib/test-utils/effect";
import { AuthService } from "#modules/auth/service";
import { NotificationSubscriptionsService } from "#modules/automations/notification-subscriptions-service";
import { ClientSurfaceMaterializer } from "#modules/plugins/client-surface-materializer";
import { PluginInstallationService } from "#modules/plugins/installation-service";
import { ObjectStorageService } from "#modules/uploads/object-storage/service";
import { UserBootstrap } from "#modules/user-bootstrap/bootstrap";
import { PluginUserBootstrapDispatcher } from "#modules/user-bootstrap/plugin-dispatch";

import { UserLifecycleRepository } from "./repository";
import {
	runUserLifecycleWorkflow,
	UserLifecycleWorkflow,
	UserLifecycleWorkflowOperations,
	UserLifecycleWorkflowOperationsLive,
} from "./workflow";

const userId = UserId.make("user-1");

class RecordedWorkflowOperations extends Context.Service<
	RecordedWorkflowOperations,
	{
		readonly calls: Effect.Effect<ReadonlyArray<string>>;
		readonly failures: Effect.Effect<ReadonlyArray<unknown>>;
	}
>()("test/RecordedWorkflowOperations") {}

type OperationRecorder = {
	readonly record: (call: string) => Effect.Effect<void>;
	readonly recordFailure: (failure: unknown) => Effect.Effect<void>;
};

const scriptedOperationsLayer = (
	operations: (
		recorder: OperationRecorder,
	) => Effect.Effect<UserLifecycleWorkflowOperations["Service"]>,
) =>
	Layer.unwrap(
		Effect.gen(function* () {
			const calls = yield* Ref.make<ReadonlyArray<string>>([]);
			const failures = yield* Ref.make<ReadonlyArray<unknown>>([]);
			const scripted = yield* operations({
				record: (call) => Ref.update(calls, (all) => [...all, call]),
				recordFailure: (failure) => Ref.update(failures, (all) => [...all, failure]),
			});
			const instance = WorkflowInstance.initial(UserLifecycleWorkflow, "operation-1");
			return Layer.mergeAll(
				Layer.succeed(WorkflowInstance, instance),
				Layer.succeed(WorkflowEngine, makeWorkflowActivityEngine(instance)),
				Layer.mock(UserLifecycleWorkflowOperations, scripted),
				Layer.succeed(RecordedWorkflowOperations, {
					calls: Ref.get(calls),
					failures: Ref.get(failures),
				}),
			);
		}),
	);

layer(
	scriptedOperationsLayer(({ record }) =>
		Effect.succeed({
			fail: () => record("fail"),
			complete: () => record("complete"),
			cleanupObjects: () => record("objects"),
			deleteDatabaseUser: () => record("database"),
			recreateResetUser: () => Effect.die("unused"),
			begin: () => record("begin").pipe(Effect.as("delete" as const)),
		}),
	),
)((test) => {
	test.effect("deletes database ownership only after physical cleanup", () =>
		Effect.gen(function* () {
			yield* runUserLifecycleWorkflow({ operationId: "operation-1" }, "execution-1");
			expect(yield* (yield* RecordedWorkflowOperations).calls).toEqual([
				"begin",
				"objects",
				"database",
				"complete",
			]);
		}),
	);
});

layer(
	scriptedOperationsLayer(({ record }) =>
		Effect.gen(function* () {
			const cleanupAttempts = yield* Ref.make(0);
			return {
				fail: () => record("fail"),
				complete: () => record("complete"),
				deleteDatabaseUser: () => record("database"),
				recreateResetUser: () => Effect.die("unused"),
				begin: () => Effect.succeed("delete" as const),
				cleanupObjects: () =>
					Ref.updateAndGet(cleanupAttempts, (count) => count + 1).pipe(
						Effect.tap((attempt) => record(`objects-${attempt}`)),
						Effect.flatMap((attempt) =>
							attempt === 1 ? Effect.fail(internalError("s3 unavailable")) : Effect.void,
						),
					),
			};
		}),
	),
)((test) => {
	test.effect("retries partial object cleanup before deleting the user", () =>
		Effect.gen(function* () {
			yield* runUserLifecycleWorkflow({ operationId: "operation-1" }, "execution-1");
			expect(yield* (yield* RecordedWorkflowOperations).calls).toEqual([
				"objects-1",
				"objects-2",
				"database",
				"complete",
			]);
		}),
	);
});

layer(
	scriptedOperationsLayer(({ recordFailure }) =>
		Effect.succeed({
			complete: () => Effect.die("unused"),
			cleanupObjects: () => Effect.die("unused"),
			recreateResetUser: () => Effect.die("unused"),
			deleteDatabaseUser: () => Effect.die("unused"),
			fail: (_operationId, failure) => recordFailure(failure),
			begin: () => Effect.fail(internalError("database password leaked")),
		}),
	),
)((test) => {
	test.effect("persists a safe stage failure instead of the internal cause", () =>
		Effect.gen(function* () {
			yield* runUserLifecycleWorkflow({ operationId: "operation-1" }, "execution-1");
			const persisted = (yield* (yield* RecordedWorkflowOperations).failures).at(-1);
			expect(persisted).toEqual({ code: "operation-start-failed" });
			expect(persisted).not.toHaveProperty("message");
		}),
	);
});

const resetResult = { userId, resetUrl: null, email: "user@example.com" };

layer(
	scriptedOperationsLayer(({ record }) =>
		Effect.succeed({
			fail: () => Effect.die("unused"),
			cleanupObjects: () => record("objects"),
			deleteDatabaseUser: () => record("database"),
			begin: () => Effect.succeed("reset" as const),
			recreateResetUser: () => record("recreate").pipe(Effect.as(resetResult)),
			complete: (_operationId, completed) =>
				record("complete").pipe(
					Effect.andThen(Effect.sync(() => expect(completed).toEqual(resetResult))),
				),
		}),
	),
)((test) => {
	test.effect("recreates the same reset identity after cleanup", () =>
		Effect.gen(function* () {
			yield* runUserLifecycleWorkflow({ operationId: "operation-1" }, "execution-1");
			expect(yield* (yield* RecordedWorkflowOperations).calls).toEqual([
				"objects",
				"database",
				"recreate",
				"complete",
			]);
		}),
	);
});

const liveOperationsLayer = <R, E>(dependencies: {
	readonly database: Layer.Layer<DatabaseSession, E>;
	readonly overrides: Layer.Layer<R, never, DatabaseSession>;
}) =>
	UserLifecycleWorkflowOperationsLive.pipe(
		Layer.provideMerge(
			Layer.mergeAll(
				UserBootstrap.layer.pipe(
					Layer.provide(
						Layer.mergeAll(
							Layer.succeed(ClientSurfaceMaterializer, {
								materializeRenderer: () => Effect.void,
								assertUserCompositions: () => Effect.void,
								materializeSystemCompositions: Effect.void,
								materializeUserCompositions: () => Effect.void,
								materializePendingInstallation: () => Effect.void,
							}),
							Layer.mock(PluginUserBootstrapDispatcher)({}),
							Layer.mock(PluginInstallationService)({}),
							Layer.mock(NotificationSubscriptionsService)({}),
						),
					),
				),
				dependencies.overrides,
			),
		),
		Layer.provideMerge(dependencies.database),
	);

const deleteOperation = {
	workflowAttempt: 0,
	databaseCleanupCompletedAt: null,
	accessRevokedAt: new Date("2026-08-24T00:00:00.000Z"),
	operation: {
		userId,
		failure: null,
		finishedAt: null,
		id: "operation-1",
		resetResult: null,
		kind: "delete" as const,
		status: "running" as const,
		createdAt: "2026-08-24T00:00:00.000Z",
		startedAt: "2026-08-24T00:00:01.000Z",
	},
	metadata: {
		apiKeys: [],
		accounts: [],
		usesLocalAuth: true,
		recreatedAccountId: "account-1",
		user: {
			id: userId,
			name: "User",
			disabledAt: null,
			emailVerified: true,
			email: "user@example.com",
		},
		locators: [
			{ type: "local" as const, key: "permanent/local.png" },
			{ type: "s3" as const, key: "permanent/s3.png" },
		],
	},
};

class RecordedObjectDeletions extends Context.Service<
	RecordedObjectDeletions,
	{ readonly deleted: Effect.Effect<ReadonlyArray<string>> }
>()("test/RecordedObjectDeletions") {}

const flakyObjectStorageLayer = Layer.unwrap(
	Effect.gen(function* () {
		const deleted = yield* Ref.make<ReadonlyArray<string>>([]);
		const failed = yield* Ref.make(false);
		return Layer.merge(
			Layer.mock(ObjectStorageService)({
				deleteObject: (locator) =>
					Effect.gen(function* () {
						yield* Ref.update(deleted, (all) => [...all, locator.key]);
						const shouldFail = locator.type === "s3" && !(yield* Ref.getAndSet(failed, true));
						return yield* shouldFail
							? Effect.fail(new BadRequest({ message: "temporary s3 failure" }))
							: Effect.void;
					}),
			}),
			Layer.succeed(RecordedObjectDeletions, { deleted: Ref.get(deleted) }),
		);
	}),
);

layer(
	liveOperationsLayer({
		database: databaseLayer,
		overrides: Layer.mergeAll(
			Layer.mock(AuthService)({ auth: Object.create(null) }),
			Layer.mock(UserLifecycleRepository)({
				getInternalById: () => Effect.succeed(deleteOperation),
			}),
			flakyObjectStorageLayer,
		),
	}),
)((test) => {
	test.effect(
		"retains all locators across a partial deletion retry and accepts missing objects",
		() =>
			Effect.gen(function* () {
				const operations = yield* UserLifecycleWorkflowOperations;
				expect((yield* Effect.exit(operations.cleanupObjects("operation-1")))._tag).toBe("Failure");
				yield* operations.cleanupObjects("operation-1");
				expect(yield* (yield* RecordedObjectDeletions).deleted).toEqual([
					"permanent/local.png",
					"permanent/s3.png",
					"permanent/local.png",
					"permanent/s3.png",
				]);
			}),
	);
});

const resetOperation = {
	workflowAttempt: 0,
	accessRevokedAt: new Date("2026-08-24T00:00:00.000Z"),
	databaseCleanupCompletedAt: new Date("2026-08-24T00:00:01.000Z"),
	metadata: {
		apiKeys: [],
		locators: [],
		accounts: [],
		usesLocalAuth: true,
		recreatedAccountId: "account-1",
		user: {
			id: userId,
			name: "User",
			disabledAt: null,
			emailVerified: true,
			email: "user@example.com",
		},
	},
	operation: {
		userId,
		failure: null,
		finishedAt: null,
		id: "operation-1",
		resetResult: null,
		kind: "reset" as const,
		status: "running" as const,
		createdAt: "2026-08-24T00:00:00.000Z",
		startedAt: "2026-08-24T00:00:01.000Z",
	},
};

class RecordedResetIdentity extends Context.Service<
	RecordedResetIdentity,
	{ readonly calls: Effect.Effect<ReadonlyArray<string>> }
>()("test/RecordedResetIdentity") {}

const resetIdentityLayer = Layer.unwrap(
	Effect.gen(function* () {
		const calls = yield* Ref.make<ReadonlyArray<string>>([]);
		const identityExists = yield* Ref.make(false);
		const record = (call: string) => Ref.update(calls, (all) => [...all, call]);
		return Layer.mergeAll(
			Layer.mock(UserLifecycleRepository)({
				getInternalById: () => Effect.succeed(resetOperation),
				loadRecreatedIdentity: () =>
					Effect.map(Ref.get(identityExists), (exists) =>
						exists ? { accounts: [], user: { id: userId, email: "user@example.com" } } : null,
					),
			}),
			Layer.mock(AuthService)({
				auth: Object.create(null),
				updateAuthUserDisabled: (_id, data) =>
					record(data.disabledAt === null ? "enabled" : "disabled"),
				requestPasswordResetLink: () =>
					record("reset-link").pipe(
						Effect.as({ email: "user@example.com", resetUrl: "https://example.com/reset" }),
					),
				createAuthUser: (input) =>
					Ref.set(identityExists, true).pipe(
						Effect.andThen(
							record(
								input.disabledAt === null || input.disabledAt === undefined
									? "created-enabled"
									: "created-disabled",
							),
						),
						Effect.as(Object.create(null)),
					),
			}),
			Layer.mock(ObjectStorageService)({}),
			Layer.succeed(RecordedResetIdentity, { calls: Ref.get(calls) }),
		);
	}),
);

const singleConnection = Layer.effect(DatabaseSession, DatabaseSession.make).pipe(
	Layer.provideMerge(
		Layer.unwrap(
			Effect.sync(() =>
				PgClient.layer({ maxConnections: 1, url: Redacted.make(testDatabaseUrl()) }),
			),
		),
	),
);

layer(liveOperationsLayer({ database: singleConnection, overrides: resetIdentityLayer }))(
	(test) => {
		test.effect("keeps a recreated reset user disabled until completion", () => {
			const bootstrapCompletedAt = new Date("2026-08-24T00:00:02.000Z");
			return Effect.gen(function* () {
				const session = yield* DatabaseSession;
				yield* session.run((db) =>
					db.execute(
						sql`create temporary table "user" (id text primary key, image text, bootstrap_completed_at timestamptz)`,
					),
				);
				yield* session.run((db) =>
					db.execute(
						sql`insert into "user" (id, bootstrap_completed_at) values (${userId}, ${bootstrapCompletedAt})`,
					),
				);
				const operations = yield* UserLifecycleWorkflowOperations;
				expect(yield* operations.recreateResetUser("operation-1")).toEqual({
					userId,
					email: "user@example.com",
					resetUrl: "https://example.com/reset",
				});
				expect(yield* (yield* RecordedResetIdentity).calls).toEqual([
					"created-disabled",
					"disabled",
					"reset-link",
				]);
			});
		});
	},
);

class RecordedCompletionTransaction extends Context.Service<
	RecordedCompletionTransaction,
	{ readonly usedTransaction: Effect.Effect<boolean> }
>()("test/RecordedCompletionTransaction") {}

const transactionProbeLayer = Layer.unwrap(
	Effect.gen(function* () {
		const session = yield* DatabaseSession;
		const usedTransaction = yield* Ref.make(false);
		return Layer.mergeAll(
			Layer.mock(UserLifecycleRepository)({
				markCompleted: () =>
					session.isTransactionActive.pipe(
						Effect.flatMap((active) => Ref.set(usedTransaction, active)),
						Effect.as(undefined),
					),
			}),
			Layer.mock(AuthService)({ auth: Object.create(null) }),
			Layer.mock(ObjectStorageService)({}),
			Layer.succeed(RecordedCompletionTransaction, { usedTransaction: Ref.get(usedTransaction) }),
		);
	}),
);

layer(liveOperationsLayer({ database: databaseLayer, overrides: transactionProbeLayer }))(
	(test) => {
		test.effect("uses one database transaction for reset enablement and completion", () =>
			Effect.gen(function* () {
				const operations = yield* UserLifecycleWorkflowOperations;
				yield* operations.complete("operation-1", {
					userId,
					email: "user@example.com",
					resetUrl: "https://example.com/reset",
				});
				expect(yield* (yield* RecordedCompletionTransaction).usedTransaction).toBe(true);
			}),
		);
	},
);
