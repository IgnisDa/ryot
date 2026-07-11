import { expect, it } from "@effect/vitest";
import { UserId } from "@ryot-app/contract/schema/brands";
import { Effect, Layer } from "effect";
import { WorkflowEngine } from "effect/unstable/workflow/WorkflowEngine";

import { makeAppConfigLayer, makeWorkflowEngine, databaseLayer } from "#lib/test-utils/effect";
import { AuthService } from "#modules/auth/service";

import { UserLifecycleRepository } from "./repository";
import { UserLifecycleService } from "./service";

const userId = UserId.make("user-1");
const operation = {
	userId,
	failure: null,
	startedAt: null,
	finishedAt: null,
	resetResult: null,
	id: "operation-1",
	kind: "delete" as const,
	status: "pending" as const,
	createdAt: "2026-08-24T00:00:00.000Z",
};
const metadata = {
	accounts: [],
	usesLocalAuth: true,
	recreatedAccountId: "account-1",
	apiKeys: [{ id: "key-1", key: "secret-key" }],
	locators: [{ type: "s3" as const, key: "permanent/image.png" }],
	user: {
		id: userId,
		name: "User",
		disabledAt: null,
		emailVerified: true,
		email: "user@example.com",
	},
};
const prepared = {
	operation,
	workflowAttempt: 0,
	databaseCleanupCompletedAt: null,
	metadata: { ...metadata, apiKeys: [] },
	accessRevokedAt: new Date("2026-08-24T00:00:00.000Z"),
};

it.effect("returns one active operation without repeating completed access revocation", () => {
	const calls: string[] = [];
	const executionIds: string[] = [];
	const auth = Layer.mock(AuthService)({
		auth: Object.create(null),
		deleteUserSessions: () => Effect.sync(() => void calls.push("sessions")),
		revokeUserOAuthTokens: () => Effect.sync(() => void calls.push("oauth")),
		updateAuthUserDisabled: () => Effect.sync(() => void calls.push("disable")),
		purgeApiKeyCaches: (_userId, apiKeys) =>
			Effect.sync(() => {
				calls.push(`keys:${apiKeys.map(({ id }) => id).join(",")}`);
				return undefined;
			}),
	});
	const repository = Layer.mock(UserLifecycleRepository)({
		markFailed: () => Effect.void,
		getById: () => Effect.succeed(operation),
		getInternalById: () => Effect.succeed(prepared),
		loadPreparationForUpdate: () =>
			Effect.succeed({ retryable: null, active: prepared, metadata: prepared.metadata }),
	});
	const engine = makeWorkflowEngine({
		execute: (_workflow, options) =>
			Effect.sync(() => {
				executionIds.push(options.executionId);
			}),
	});
	const serviceLayer = UserLifecycleService.layer.pipe(
		Layer.provide(
			Layer.mergeAll(
				auth,
				repository,
				databaseLayer,
				makeAppConfigLayer(),
				Layer.succeed(WorkflowEngine, engine),
			),
		),
	);
	const layer = Layer.merge(serviceLayer, databaseLayer);

	return Effect.gen(function* () {
		const service = yield* UserLifecycleService;
		const operations = yield* Effect.all([service.deleteUser(userId), service.deleteUser(userId)], {
			concurrency: "unbounded",
		});
		expect(operations).toEqual([operation, operation]);
		expect(calls).toEqual([]);
		expect(executionIds).toEqual(["user-lifecycle-operation-1-0", "user-lifecycle-operation-1-0"]);
	}).pipe(Effect.provide(layer));
});

it.effect("revokes access once and clears persisted API-key cache lookup metadata", () => {
	const calls: string[] = [];
	let revoked = false;
	const unrevoked = { ...prepared, metadata, accessRevokedAt: null };
	const revokedOperation = {
		...prepared,
		metadata: { ...metadata, apiKeys: [] },
		accessRevokedAt: new Date("2026-08-24T00:00:01.000Z"),
	};
	const repository = Layer.mock(UserLifecycleRepository)({
		userExists: () => Effect.succeed(true),
		getById: () => Effect.succeed(operation),
		releaseAccessRevocation: () => Effect.void,
		claimAccessRevocation: () => Effect.succeed(unrevoked),
		getInternalById: () => Effect.succeed(revoked ? revokedOperation : unrevoked),
		markAccessRevoked: () =>
			Effect.sync(() => {
				revoked = true;
				calls.push("record");
				return revokedOperation;
			}),
		loadPreparationForUpdate: () =>
			Effect.succeed({
				retryable: null,
				active: revoked ? revokedOperation : unrevoked,
				metadata: revoked ? revokedOperation.metadata : metadata,
			}),
	});
	const serviceLayer = UserLifecycleService.layer.pipe(
		Layer.provide(
			Layer.mergeAll(
				databaseLayer,
				repository,
				makeAppConfigLayer(),
				Layer.mock(AuthService)({
					auth: Object.create(null),
					deleteUserSessions: () => Effect.sync(() => void calls.push("sessions")),
					revokeUserOAuthTokens: () => Effect.sync(() => void calls.push("oauth")),
					updateAuthUserDisabled: () => Effect.sync(() => void calls.push("disable")),
					purgeApiKeyCaches: (_userId, apiKeys) =>
						Effect.sync(() => void calls.push(`keys:${apiKeys.map(({ id }) => id).join(",")}`)),
				}),
				Layer.succeed(WorkflowEngine, makeWorkflowEngine({ execute: () => Effect.void })),
			),
		),
	);
	return Effect.gen(function* () {
		const service = yield* UserLifecycleService;
		yield* service.deleteUser(userId);
		yield* service.deleteUser(userId);
		expect(calls).toEqual(["disable", "sessions", "oauth", "keys:key-1", "record"]);
		expect(revokedOperation.metadata.apiKeys).toEqual([]);
	}).pipe(Effect.provide(Layer.merge(serviceLayer, databaseLayer)));
});

it.effect(
	"returns an internal failure and leaves a pending operation retryable when dispatch fails",
	() => {
		const serviceLayer = UserLifecycleService.layer.pipe(
			Layer.provide(
				Layer.mergeAll(
					databaseLayer,
					makeAppConfigLayer(),
					Layer.mock(AuthService)({ auth: Object.create(null) }),
					Layer.mock(UserLifecycleRepository)({
						getInternalById: () => Effect.succeed(prepared),
						loadPreparationForUpdate: () =>
							Effect.succeed({ retryable: null, active: prepared, metadata: prepared.metadata }),
					}),
					Layer.succeed(
						WorkflowEngine,
						makeWorkflowEngine({ execute: () => Effect.fail("redis unavailable") }),
					),
				),
			),
		);
		return Effect.gen(function* () {
			const service = yield* UserLifecycleService;
			expect(yield* service.deleteUser(userId).pipe(Effect.flip)).toMatchObject({
				_tag: "GodModeInternalFailure",
				reason: { code: "lifecycle-dispatch-failed" },
			});
			expect(prepared.operation.status).toBe("pending");
		}).pipe(Effect.provide(Layer.merge(serviceLayer, databaseLayer)));
	},
);

it.effect(
	"reactivates and redispatches the same failed operation with a new deterministic attempt",
	() => {
		const executionIds: string[] = [];
		const failed = {
			...prepared,
			operation: {
				...operation,
				status: "failed" as const,
				failure: { code: "object-cleanup-failed" as const },
			},
		};
		const retried = {
			...failed,
			workflowAttempt: 1,
			operation: { ...failed.operation, finishedAt: null, status: "pending" as const },
		};
		const serviceLayer = UserLifecycleService.layer.pipe(
			Layer.provide(
				Layer.mergeAll(
					databaseLayer,
					makeAppConfigLayer(),
					Layer.mock(AuthService)({ auth: Object.create(null) }),
					Layer.mock(UserLifecycleRepository)({
						getInternalById: () => Effect.succeed(retried),
						reactivateFailed: () => Effect.succeed(retried),
						getById: () => Effect.succeed(retried.operation),
						loadPreparationForUpdate: () =>
							Effect.succeed({ active: null, retryable: failed, metadata: failed.metadata }),
					}),
					Layer.succeed(
						WorkflowEngine,
						makeWorkflowEngine({
							execute: (_workflow, options) =>
								Effect.sync(() => void executionIds.push(options.executionId)),
						}),
					),
				),
			),
		);
		return Effect.gen(function* () {
			const service = yield* UserLifecycleService;
			expect(yield* service.deleteUser(userId)).toEqual(retried.operation);
			expect(executionIds).toEqual(["user-lifecycle-operation-1-1"]);
		}).pipe(Effect.provide(Layer.merge(serviceLayer, databaseLayer)));
	},
);

it.effect("returns lifecycle operation status without exposing cleanup metadata", () => {
	const serviceLayer = UserLifecycleService.layer.pipe(
		Layer.provide(
			Layer.mergeAll(
				databaseLayer,
				makeAppConfigLayer(),
				Layer.mock(AuthService)({ auth: Object.create(null) }),
				Layer.succeed(WorkflowEngine, makeWorkflowEngine()),
				Layer.mock(UserLifecycleRepository)({ getById: () => Effect.succeed(operation) }),
			),
		),
	);
	const layer = Layer.merge(serviceLayer, databaseLayer);

	return Effect.gen(function* () {
		const service = yield* UserLifecycleService;
		const status = yield* service.getOperation("operation-1");
		expect(status).toEqual(operation);
		expect(status).not.toHaveProperty("metadata");
	}).pipe(Effect.provide(layer));
});
