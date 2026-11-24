import { expect } from "bun:test";

import { UserId } from "@ryot-app/contract/schema/brands";
import { InstanceAdminInternalFailure } from "@ryot-app/instance-contract/account-admin";
import { testTimeout } from "@ryot-app/testing/test-timeout";
import { layer } from "@voila.dev/effect-bun-test";
import { Context, Effect, Layer, Ref } from "effect";
import { TestClock } from "effect/testing";

import { AuthService } from "#modules/accounts/auth/service";
import { DatabaseSession } from "#platform/db/session";
import { JobQueue } from "#platform/jobs/queue";
import { databaseLayer, makeAppConfigLayer } from "#testing/effect";

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
		readonly queuedKeys: Effect.Effect<ReadonlyArray<string>>;
	}
>()("@ryot-app/kernel-backend/modules/accounts/lifecycle/service.test/FakeLifecycleDependencies") {}

const lifecycleServiceLayer = (options: {
	readonly failedSessionDeletions?: number;
	readonly repository: (
		record: (call: string) => Effect.Effect<void>,
	) => Effect.Effect<RepositoryMock>;
}) =>
	Layer.unwrap(
		Effect.gen(function* () {
			const calls = yield* Ref.make<ReadonlyArray<string>>([]);
			const queuedKeys = yield* Ref.make<ReadonlyArray<string>>([]);
			const sessionDeletions = yield* Ref.make(0);
			const record = (call: string) => Ref.update(calls, (all) => [...all, call]);
			const repository = yield* options.repository(record);
			return UserLifecycleService.layer.pipe(
				Layer.provideMerge(
					Layer.mergeAll(
						makeAppConfigLayer(),
						mockRepository(repository),
						Layer.mock(AuthService)({
							revokeUserOAuthTokens: () => record("oauth"),
							updateAuthUserDisabled: () => record("disable"),
							handler: () => Promise.reject(new Error("unused")),
							revokePasswordResetLinks: () => record("reset-links"),
							purgeApiKeyCaches: (_userId, apiKeys) =>
								record(`keys:${apiKeys.map(({ id }) => id).join(",")}`).pipe(Effect.as(undefined)),
							deleteUserSessions: () =>
								Ref.updateAndGet(sessionDeletions, (count) => count + 1).pipe(
									Effect.flatMap((count) =>
										count <= (options.failedSessionDeletions ?? 0)
											? Effect.die("session store unavailable")
											: record("sessions"),
									),
								),
						}),
						Layer.effect(
							JobQueue,
							Effect.gen(function* () {
								const session = yield* DatabaseSession;
								return JobQueue.of({
									pruneFailed: () => Effect.void,
									enqueue: (kind, _payload, enqueueOptions = {}) =>
										session.isTransactionActive.pipe(
											Effect.flatMap((active) =>
												active
													? Ref.update(queuedKeys, (all) => [
															...all,
															`${kind.name}:${enqueueOptions.key ?? ""}`,
														])
													: Effect.die("Lifecycle jobs are queued in the operation transaction"),
											),
											Effect.as(true),
										),
								});
							}),
						),
						Layer.succeed(FakeLifecycleDependencies, {
							calls: Ref.get(calls),
							queuedKeys: Ref.get(queuedKeys),
						}),
					),
				),
				Layer.provideMerge(databaseLayer),
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
	test.effect(
		"returns one active operation without repeating completed access revocation",
		() =>
			Effect.gen(function* () {
				const service = yield* UserLifecycleService;
				const operations = yield* Effect.all(
					[service.deleteUser(userId), service.deleteUser(userId)],
					{ concurrency: "unbounded" },
				);
				const fake = yield* FakeLifecycleDependencies;
				expect(operations).toEqual([{ operationId: operation.id }, { operationId: operation.id }]);
				expect(yield* fake.calls).toEqual([]);
				expect(yield* fake.queuedKeys).toEqual([
					"user-lifecycle:operation-1",
					"user-lifecycle:operation-1",
				]);
			}),
		testTimeout,
	);
});

const unrevoked = { ...prepared, metadata, accessRevokedAt: null };
const revokedOperation = {
	...prepared,
	metadata: { ...metadata, apiKeys: [] },
	accessRevokedAt: new Date("2026-08-24T00:00:01.000Z"),
};

const revokingRepository =
	(claimAccessRevocation: UserLifecycleRepository["Service"]["claimAccessRevocation"]) =>
	(record: (call: string) => Effect.Effect<void>) =>
		Effect.gen(function* () {
			const revoked = yield* Ref.make(false);
			const current = Effect.map(Ref.get(revoked), (isRevoked) =>
				isRevoked ? revokedOperation : unrevoked,
			);
			return {
				claimAccessRevocation,
				getInternalById: () => current,
				userExists: () => Effect.succeed(true),
				releaseAccessRevocation: () => Effect.void,
				loadPreparationForUpdate: () =>
					Effect.map(current, (active) => ({ active, retryable: null, metadata: active.metadata })),
				markAccessRevoked: () =>
					Ref.set(revoked, true).pipe(
						Effect.andThen(record("record")),
						Effect.as(revokedOperation),
					),
			};
		});

layer(lifecycleServiceLayer({ repository: revokingRepository(() => Effect.succeed(unrevoked)) }))(
	(test) => {
		test.effect(
			"revokes access once and clears persisted API-key cache lookup metadata",
			() =>
				Effect.gen(function* () {
					const service = yield* UserLifecycleService;
					yield* service.deleteUser(userId);
					yield* service.deleteUser(userId);
					expect(yield* (yield* FakeLifecycleDependencies).calls).toEqual([
						"disable",
						"sessions",
						"oauth",
						"keys:key-1",
						"reset-links",
						"record",
					]);
					expect(revokedOperation.metadata.apiKeys).toEqual([]);
				}),
			testTimeout,
		);
	},
);

layer(
	lifecycleServiceLayer({
		repository: revokingRepository((_operationId, staleBefore) =>
			Effect.succeed(staleBefore.getTime() >= 0 ? unrevoked : null),
		),
	}),
)((test) => {
	test.effect(
		"conflicts while another revocation claim is fresh, still queues the job, and reclaims it once stale",
		() =>
			Effect.gen(function* () {
				const service = yield* UserLifecycleService;
				const fake = yield* FakeLifecycleDependencies;
				expect(yield* Effect.flip(service.deleteUser(userId))).toEqual(
					new InstanceAdminInternalFailure({ reason: { code: "lifecycle-state-conflict" } }),
				);
				expect(yield* fake.calls).toEqual([]);
				expect(yield* fake.queuedKeys).toEqual(["user-lifecycle:operation-1"]);
				yield* TestClock.adjust("60 seconds");
				expect(yield* service.deleteUser(userId)).toEqual({ operationId: operation.id });
				expect((yield* fake.calls).at(-1)).toBe("record");
			}),
		testTimeout,
	);
});

layer(
	lifecycleServiceLayer({
		failedSessionDeletions: 1,
		repository: revokingRepository(() => Effect.succeed(unrevoked)),
	}),
)((test) => {
	test.effect(
		"leaves the operation's job queued when revocation fails, and the job's revocation completes it",
		() =>
			Effect.gen(function* () {
				const service = yield* UserLifecycleService;
				const fake = yield* FakeLifecycleDependencies;
				expect(yield* Effect.flip(service.deleteUser(userId))).toEqual(
					new InstanceAdminInternalFailure({ reason: { code: "access-revocation-failed" } }),
				);
				expect(yield* fake.queuedKeys).toEqual(["user-lifecycle:operation-1"]);
				expect(yield* fake.calls).toEqual(["disable"]);
				yield* service.revokeAccess(operation.id);
				expect(yield* fake.calls).toEqual([
					"disable",
					"disable",
					"sessions",
					"oauth",
					"keys:key-1",
					"reset-links",
					"record",
				]);
			}),
		testTimeout,
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
		"reactivates and requeues the same failed operation",
		() =>
			Effect.gen(function* () {
				const service = yield* UserLifecycleService;
				expect(yield* service.deleteUser(userId)).toEqual({ operationId: retried.operation.id });
				expect(yield* (yield* FakeLifecycleDependencies).queuedKeys).toEqual([
					"user-lifecycle:operation-1",
				]);
			}),
		testTimeout,
	);
});
