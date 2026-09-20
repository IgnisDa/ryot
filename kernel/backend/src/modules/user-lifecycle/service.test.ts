import { expect, layer } from "@effect/vitest";
import { UserId } from "@ryot-app/contract/schema/brands";
import { Context, Effect, Layer, Ref } from "effect";
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

const mockRepository = Layer.mock(UserLifecycleRepository);
type RepositoryMock = Parameters<typeof mockRepository>[0];

class FakeLifecycleDependencies extends Context.Service<
	FakeLifecycleDependencies,
	{
		readonly calls: Effect.Effect<ReadonlyArray<string>>;
		readonly executionIds: Effect.Effect<ReadonlyArray<string>>;
	}
>()("test/FakeLifecycleDependencies") {}

const lifecycleServiceLayer = (options: {
	readonly execute?: Effect.Effect<void, string>;
	readonly repository: (
		record: (call: string) => Effect.Effect<void>,
	) => Effect.Effect<RepositoryMock>;
}) =>
	Layer.unwrap(
		Effect.gen(function* () {
			const calls = yield* Ref.make<ReadonlyArray<string>>([]);
			const executionIds = yield* Ref.make<ReadonlyArray<string>>([]);
			const record = (call: string) => Ref.update(calls, (all) => [...all, call]);
			const repository = yield* options.repository(record);
			return UserLifecycleService.layer.pipe(
				Layer.provideMerge(
					Layer.mergeAll(
						databaseLayer,
						makeAppConfigLayer(),
						mockRepository(repository),
						Layer.mock(AuthService)({
							deleteUserSessions: () => record("sessions"),
							revokeUserOAuthTokens: () => record("oauth"),
							updateAuthUserDisabled: () => record("disable"),
							handler: () => Effect.die("unused").pipe(Effect.runPromise),
							purgeApiKeyCaches: (_userId, apiKeys) =>
								record(`keys:${apiKeys.map(({ id }) => id).join(",")}`).pipe(Effect.as(undefined)),
						}),
						Layer.succeed(
							WorkflowEngine,
							makeWorkflowEngine({
								execute: (_workflow, executeOptions) =>
									Ref.update(executionIds, (all) => [...all, executeOptions.executionId]).pipe(
										Effect.andThen(options.execute ?? Effect.void),
									),
							}),
						),
						Layer.succeed(FakeLifecycleDependencies, {
							calls: Ref.get(calls),
							executionIds: Ref.get(executionIds),
						}),
					),
				),
			);
		}),
	);

layer(
	lifecycleServiceLayer({
		repository: () =>
			Effect.succeed({
				markFailed: () => Effect.void,
				getInternalById: () => Effect.succeed(prepared),
				loadPreparationForUpdate: () =>
					Effect.succeed({ retryable: null, active: prepared, metadata: prepared.metadata }),
			}),
	}),
)((test) => {
	test.effect("returns one active operation without repeating completed access revocation", () =>
		Effect.gen(function* () {
			const service = yield* UserLifecycleService;
			const operations = yield* Effect.all(
				[service.deleteUser(userId), service.deleteUser(userId)],
				{ concurrency: "unbounded" },
			);
			const fake = yield* FakeLifecycleDependencies;
			expect(operations).toEqual([{ operationId: operation.id }, { operationId: operation.id }]);
			expect(yield* fake.calls).toEqual([]);
			expect(yield* fake.executionIds).toEqual([
				"user-lifecycle-operation-1-0",
				"user-lifecycle-operation-1-0",
			]);
		}),
	);
});

const unrevoked = { ...prepared, metadata, accessRevokedAt: null };
const revokedOperation = {
	...prepared,
	metadata: { ...metadata, apiKeys: [] },
	accessRevokedAt: new Date("2026-08-24T00:00:01.000Z"),
};

layer(
	lifecycleServiceLayer({
		repository: (record) =>
			Effect.gen(function* () {
				const revoked = yield* Ref.make(false);
				const current = Effect.map(Ref.get(revoked), (isRevoked) =>
					isRevoked ? revokedOperation : unrevoked,
				);
				return {
					getInternalById: () => current,
					userExists: () => Effect.succeed(true),
					releaseAccessRevocation: () => Effect.void,
					claimAccessRevocation: () => Effect.succeed(unrevoked),
					markAccessRevoked: () =>
						Ref.set(revoked, true).pipe(
							Effect.andThen(record("record")),
							Effect.as(revokedOperation),
						),
					loadPreparationForUpdate: () =>
						Effect.map(current, (active) => ({
							active,
							retryable: null,
							metadata: active.metadata,
						})),
				};
			}),
	}),
)((test) => {
	test.effect("revokes access once and clears persisted API-key cache lookup metadata", () =>
		Effect.gen(function* () {
			const service = yield* UserLifecycleService;
			yield* service.deleteUser(userId);
			yield* service.deleteUser(userId);
			expect(yield* (yield* FakeLifecycleDependencies).calls).toEqual([
				"disable",
				"sessions",
				"oauth",
				"keys:key-1",
				"record",
			]);
			expect(revokedOperation.metadata.apiKeys).toEqual([]);
		}),
	);
});

layer(
	lifecycleServiceLayer({
		execute: Effect.fail("redis unavailable"),
		repository: () =>
			Effect.succeed({
				getInternalById: () => Effect.succeed(prepared),
				loadPreparationForUpdate: () =>
					Effect.succeed({ retryable: null, active: prepared, metadata: prepared.metadata }),
			}),
	}),
)((test) => {
	test.effect(
		"returns an internal failure and leaves a pending operation retryable when dispatch fails",
		() =>
			Effect.gen(function* () {
				const service = yield* UserLifecycleService;
				expect(yield* service.deleteUser(userId).pipe(Effect.flip)).toMatchObject({
					_tag: "GodModeInternalFailure",
					reason: { code: "lifecycle-dispatch-failed" },
				});
				expect(prepared.operation.status).toBe("pending");
			}),
	);
});

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

layer(
	lifecycleServiceLayer({
		repository: () =>
			Effect.succeed({
				getInternalById: () => Effect.succeed(retried),
				reactivateFailed: () => Effect.succeed(retried),
				loadPreparationForUpdate: () =>
					Effect.succeed({ active: null, retryable: failed, metadata: failed.metadata }),
			}),
	}),
)((test) => {
	test.effect(
		"reactivates and redispatches the same failed operation with a new deterministic attempt",
		() =>
			Effect.gen(function* () {
				const service = yield* UserLifecycleService;
				expect(yield* service.deleteUser(userId)).toEqual({ operationId: retried.operation.id });
				expect(yield* (yield* FakeLifecycleDependencies).executionIds).toEqual([
					"user-lifecycle-operation-1-1",
				]);
			}),
	);
});
