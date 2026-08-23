import { expect, it } from "@effect/vitest";
import { BadRequest, internalError } from "@ryot-app/contract/errors";
import { UserId } from "@ryot-app/contract/schema/brands";
import { Effect, Layer } from "effect";
import { WorkflowEngine, WorkflowInstance } from "effect/unstable/workflow/WorkflowEngine";

import { Database } from "#lib/infrastructure/db/service";
import { makeWorkflowActivityEngine } from "#lib/test-utils/effect";
import { AuthService } from "#modules/auth/service";
import { NotificationSubscriptionsService } from "#modules/automations/notification-subscriptions-service";
import { ClientSurfaceMaterializer } from "#modules/plugins/client-surface-materializer";
import { PluginInstallationService } from "#modules/plugins/installation-service";
import { SavedViewsService } from "#modules/saved-views/service";
import { ObjectStorageService } from "#modules/uploads/object-storage/service";
import { PluginUserBootstrapDispatcher } from "#modules/user-bootstrap/plugin-dispatch";

import { UserLifecycleRepository } from "./repository";
import {
	runUserLifecycleWorkflow,
	UserLifecycleWorkflow,
	UserLifecycleWorkflowOperations,
	UserLifecycleWorkflowOperationsLive,
} from "./workflow";

const userId = UserId.make("user-1");

const runWithOperations = (operations: UserLifecycleWorkflowOperations["Service"]) => {
	const instance = WorkflowInstance.initial(UserLifecycleWorkflow, "operation-1");
	const engine = makeWorkflowActivityEngine(instance);
	return Layer.mergeAll(
		Layer.succeed(WorkflowInstance, instance),
		Layer.succeed(WorkflowEngine, engine),
		Layer.mock(UserLifecycleWorkflowOperations, operations),
	);
};

it.effect("deletes database ownership only after physical cleanup", () => {
	const calls: string[] = [];
	const layer = runWithOperations({
		recreateResetUser: () => Effect.die("unused"),
		fail: () => Effect.sync(() => void calls.push("fail")),
		complete: () => Effect.sync(() => void calls.push("complete")),
		cleanupObjects: () => Effect.sync(() => void calls.push("objects")),
		begin: () => Effect.sync(() => (calls.push("begin"), "delete" as const)),
		deleteDatabaseUser: () => Effect.sync(() => void calls.push("database")),
	});

	return Effect.gen(function* () {
		yield* runUserLifecycleWorkflow({ operationId: "operation-1" }, "execution-1");
		expect(calls).toEqual(["begin", "objects", "database", "complete"]);
	}).pipe(Effect.provide(layer));
});

it.effect("retries partial object cleanup before deleting the user", () => {
	const calls: string[] = [];
	let cleanupAttempts = 0;
	const layer = runWithOperations({
		recreateResetUser: () => Effect.die("unused"),
		begin: () => Effect.succeed("delete" as const),
		fail: () => Effect.sync(() => void calls.push("fail")),
		complete: () => Effect.sync(() => void calls.push("complete")),
		deleteDatabaseUser: () => Effect.sync(() => void calls.push("database")),
		cleanupObjects: () =>
			Effect.suspend(() => {
				cleanupAttempts += 1;
				calls.push(`objects-${cleanupAttempts}`);
				return cleanupAttempts === 1 ? Effect.fail(internalError("s3 unavailable")) : Effect.void;
			}),
	});

	return Effect.gen(function* () {
		yield* runUserLifecycleWorkflow({ operationId: "operation-1" }, "execution-1");
		expect(calls).toEqual(["objects-1", "objects-2", "database", "complete"]);
	}).pipe(Effect.provide(layer));
});

it.effect("persists a safe stage failure instead of the internal cause", () => {
	let persisted: unknown;
	const layer = runWithOperations({
		complete: () => Effect.die("unused"),
		cleanupObjects: () => Effect.die("unused"),
		recreateResetUser: () => Effect.die("unused"),
		deleteDatabaseUser: () => Effect.die("unused"),
		begin: () => Effect.fail(internalError("database password leaked")),
		fail: (_operationId, failure) => Effect.sync(() => void (persisted = failure)),
	});

	return Effect.gen(function* () {
		yield* runUserLifecycleWorkflow({ operationId: "operation-1" }, "execution-1");
		expect(persisted).toEqual({ code: "operation-start-failed" });
		expect(persisted).not.toHaveProperty("message");
	}).pipe(Effect.provide(layer));
});

it.effect("recreates the same reset identity after cleanup", () => {
	const calls: string[] = [];
	const result = { userId, resetUrl: null, email: "user@example.com" };
	const layer = runWithOperations({
		fail: () => Effect.die("unused"),
		begin: () => Effect.succeed("reset" as const),
		cleanupObjects: () => Effect.sync(() => void calls.push("objects")),
		deleteDatabaseUser: () => Effect.sync(() => void calls.push("database")),
		recreateResetUser: () => Effect.sync(() => (calls.push("recreate"), result)),
		complete: (_operationId, completed) =>
			Effect.sync(() => {
				calls.push("complete");
				expect(completed).toEqual(result);
			}),
	});

	return Effect.gen(function* () {
		yield* runUserLifecycleWorkflow({ operationId: "operation-1" }, "execution-1");
		expect(calls).toEqual(["objects", "database", "recreate", "complete"]);
	}).pipe(Effect.provide(layer));
});

it.effect(
	"retains all locators across a partial deletion retry and accepts missing objects",
	() => {
		const deleted: string[] = [];
		let failed = false;
		const operation = {
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
		const layer = UserLifecycleWorkflowOperationsLive.pipe(
			Layer.provide(
				Layer.mergeAll(
					Layer.succeed(Database, Object.create(null)),
					Layer.mock(AuthService)({ auth: Object.create(null) }),
					Layer.mock(SavedViewsService)({}),
					Layer.succeed(ClientSurfaceMaterializer, {
						materializeUser: () => Effect.void,
						materializeRenderer: () => Effect.void,
						materializePendingInstallation: () => Effect.void,
					}),
					Layer.mock(PluginUserBootstrapDispatcher)({}),
					Layer.mock(PluginInstallationService)({}),
					Layer.mock(NotificationSubscriptionsService)({}),
					Layer.mock(UserLifecycleRepository)({ getInternalById: () => Effect.succeed(operation) }),
					Layer.mock(ObjectStorageService)({
						deleteObject: (locator) =>
							Effect.suspend(() => {
								deleted.push(locator.key);
								if (locator.type === "s3" && !failed) {
									failed = true;
									return Effect.fail(new BadRequest({ message: "temporary s3 failure" }));
								}
								return Effect.void;
							}),
					}),
				),
			),
		);

		return Effect.gen(function* () {
			const operations = yield* UserLifecycleWorkflowOperations;
			expect((yield* Effect.exit(operations.cleanupObjects("operation-1")))._tag).toBe("Failure");
			yield* operations.cleanupObjects("operation-1");
			expect(deleted).toEqual([
				"permanent/local.png",
				"permanent/s3.png",
				"permanent/local.png",
				"permanent/s3.png",
			]);
		}).pipe(Effect.provide(layer));
	},
);

it.effect("keeps a recreated reset user disabled until completion", () => {
	const calls: string[] = [];
	let identityExists = false;
	const operation = {
		workflowAttempt: 0,
		accessRevokedAt: new Date("2026-08-24T00:00:00.000Z"),
		databaseCleanupCompletedAt: new Date("2026-08-24T00:00:01.000Z"),
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
	};
	const transaction = Object.assign(Object.create(null), {
		execute: () => Effect.void,
		select: () => ({
			from: () => ({
				where: () => ({
					for: () =>
						Effect.succeed([
							{ image: null, bootstrapCompletedAt: new Date("2026-08-24T00:00:02.000Z") },
						]),
				}),
			}),
		}),
	});
	const database = Database.of(
		Object.assign(Object.create(null), {
			transaction: (run: (tx: typeof transaction) => Effect.Effect<unknown, unknown, unknown>) =>
				run(transaction),
		}),
	);
	const layer = UserLifecycleWorkflowOperationsLive.pipe(
		Layer.provide(
			Layer.mergeAll(
				Layer.succeed(Database, database),
				Layer.mock(UserLifecycleRepository)({
					getInternalById: () => Effect.succeed(operation),
					loadRecreatedIdentity: () =>
						Effect.succeed(
							identityExists
								? { accounts: [], user: { id: userId, email: "user@example.com" } }
								: null,
						),
				}),
				Layer.mock(AuthService)({
					auth: Object.create(null),
					updateAuthUserDisabled: (_id, data) =>
						Effect.sync(() => void calls.push(data.disabledAt === null ? "enabled" : "disabled")),
					requestPasswordResetLink: () =>
						Effect.sync(() => {
							calls.push("reset-link");
							return { email: "user@example.com", resetUrl: "https://example.com/reset" };
						}),
					createAuthUser: (input) =>
						Effect.sync(() => {
							identityExists = true;
							calls.push(
								input.disabledAt === null || input.disabledAt === undefined
									? "created-enabled"
									: "created-disabled",
							);
							return Object.create(null);
						}),
				}),
				Layer.mock(SavedViewsService)({}),
				Layer.succeed(ClientSurfaceMaterializer, {
					materializeUser: () => Effect.void,
					materializeRenderer: () => Effect.void,
					materializePendingInstallation: () => Effect.void,
				}),
				Layer.mock(PluginUserBootstrapDispatcher)({}),
				Layer.mock(PluginInstallationService)({}),
				Layer.mock(NotificationSubscriptionsService)({}),
				Layer.mock(ObjectStorageService)({}),
			),
		),
	);
	return Effect.gen(function* () {
		const operations = yield* UserLifecycleWorkflowOperations;
		expect(yield* operations.recreateResetUser("operation-1")).toEqual({
			userId,
			email: "user@example.com",
			resetUrl: "https://example.com/reset",
		});
		expect(calls).toEqual(["created-disabled", "disabled", "reset-link"]);
	}).pipe(Effect.provide(Layer.merge(layer, Layer.succeed(Database, database))));
});

it.effect("uses one database transaction for reset enablement and completion", () => {
	const transaction = Object.create(null);
	const database = Database.of(
		Object.assign(Object.create(null), {
			transaction: (run: (tx: typeof transaction) => Effect.Effect<unknown, unknown, unknown>) =>
				run(transaction),
		}),
	);
	let usedTransaction = false;
	const layer = UserLifecycleWorkflowOperationsLive.pipe(
		Layer.provide(
			Layer.mergeAll(
				Layer.succeed(Database, database),
				Layer.mock(UserLifecycleRepository)({
					markCompleted: () =>
						Effect.gen(function* () {
							usedTransaction = (yield* Database) === transaction;
							return undefined;
						}),
				}),
				Layer.mock(AuthService)({ auth: Object.create(null) }),
				Layer.mock(SavedViewsService)({}),
				Layer.succeed(ClientSurfaceMaterializer, {
					materializeUser: () => Effect.void,
					materializeRenderer: () => Effect.void,
					materializePendingInstallation: () => Effect.void,
				}),
				Layer.mock(PluginUserBootstrapDispatcher)({}),
				Layer.mock(PluginInstallationService)({}),
				Layer.mock(NotificationSubscriptionsService)({}),
				Layer.mock(ObjectStorageService)({}),
			),
		),
	);
	return Effect.gen(function* () {
		const operations = yield* UserLifecycleWorkflowOperations;
		yield* operations.complete("operation-1", {
			userId,
			email: "user@example.com",
			resetUrl: "https://example.com/reset",
		});
		expect(usedTransaction).toBe(true);
	}).pipe(Effect.provide(Layer.merge(layer, Layer.succeed(Database, database))));
});
