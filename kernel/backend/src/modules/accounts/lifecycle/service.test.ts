import { expect } from "bun:test";

import { UserId } from "@ryot-app/contract/schema/brands";
import { InstanceAdminInternalFailure } from "@ryot-app/instance-contract/account-admin";
import { testTimeout } from "@ryot-app/testing/test-timeout";
import { layer } from "@voila.dev/effect-bun-test";
import { Context, DateTime, Duration, Effect, Fiber, Layer, Ref } from "effect";
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
	readonly sessionDeletionDelay?: Duration.Input;
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
									Effect.tap(() => Effect.sleep(options.sessionDeletionDelay ?? Duration.zero)),
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
	(heldClaimStartedAt: Date | null = null) =>
	(record: (call: string) => Effect.Effect<void>) =>
		Effect.gen(function* () {
			const state = yield* Ref.make({ revoked: false, claimStartedAt: heldClaimStartedAt });
			const current = Effect.map(Ref.get(state), ({ revoked }) =>
				revoked ? revokedOperation : unrevoked,
			);
			return {
				getInternalById: () => current,
				userExists: () => Effect.succeed(true),
				releaseAccessRevocation: () =>
					Ref.update(state, (claim) => ({ ...claim, claimStartedAt: null })),
				loadPreparationForUpdate: () =>
					Effect.map(current, (active) => ({ active, retryable: null, metadata: active.metadata })),
				markAccessRevoked: () =>
					Ref.set(state, { revoked: true, claimStartedAt: null }).pipe(
						Effect.andThen(record("record")),
						Effect.as(revokedOperation),
					),
				claimAccessRevocation: (_operationId: string, staleBefore: Date) =>
					Effect.flatMap(DateTime.nowAsDate, (now) =>
						Ref.modify(state, (claim) =>
							claim.revoked ||
							(claim.claimStartedAt !== null && claim.claimStartedAt >= staleBefore)
								? [null, claim]
								: [unrevoked, { ...claim, claimStartedAt: now }],
						),
					),
			};
		});

layer(lifecycleServiceLayer({ repository: revokingRepository() }))((test) => {
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
});

layer(
	lifecycleServiceLayer({ sessionDeletionDelay: "1 second", repository: revokingRepository() }),
)((test) => {
	test.effect(
		"waits for a concurrent caller's fresh revocation claim instead of conflicting, and revokes once",
		() =>
			Effect.gen(function* () {
				const service = yield* UserLifecycleService;
				const revocations = yield* Effect.forkChild(
					Effect.all([service.revokeAccess(operation.id), service.revokeAccess(operation.id)], {
						concurrency: "unbounded",
					}),
				);
				yield* TestClock.adjust("2 seconds");
				expect(yield* Fiber.join(revocations)).toEqual([revokedOperation, revokedOperation]);
				expect(yield* (yield* FakeLifecycleDependencies).calls).toEqual([
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

layer(lifecycleServiceLayer({ repository: revokingRepository(new Date(0)) }))((test) => {
	test.effect(
		"waits while another revocation claim is fresh and reclaims it once stale",
		() =>
			Effect.gen(function* () {
				const service = yield* UserLifecycleService;
				const fake = yield* FakeLifecycleDependencies;
				const revocation = yield* Effect.forkChild(service.revokeAccess(operation.id));
				yield* TestClock.adjust("60 seconds");
				expect(revocation.pollUnsafe()).toBeUndefined();
				expect(yield* fake.calls).toEqual([]);
				yield* TestClock.adjust("1 second");
				expect(yield* Fiber.join(revocation)).toEqual(revokedOperation);
				expect((yield* fake.calls).at(-1)).toBe("record");
			}),
		testTimeout,
	);
});

layer(lifecycleServiceLayer({ failedSessionDeletions: 1, repository: revokingRepository() }))(
	(test) => {
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
	},
);

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
