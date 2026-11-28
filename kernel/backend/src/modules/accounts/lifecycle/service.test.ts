import { expect } from "bun:test";

import { DbError } from "@ryot-app/contract/errors";
import { UserId } from "@ryot-app/contract/schema/brands";
import { assertExitFails } from "@ryot-app/testing/effect-assertions";
import { anyOf } from "@ryot-app/testing/matchers";
import { testTimeout } from "@ryot-app/testing/test-timeout";
import { sortBy } from "@ryot-app/ts-utils/lodash";
import { layer } from "@voila.dev/effect-bun-test";
import { eq, isNotNull } from "drizzle-orm";
import { Effect, Layer } from "effect";

import { AuthRepository } from "#modules/accounts/auth/repository";
import { AuthService } from "#modules/accounts/auth/service";
import { DatabaseSession } from "#platform/db/session";
import { JobQueue } from "#platform/jobs/queue";
import { oauthClient, oauthRefreshToken, session, user, verification } from "#schema/tables/auth";
import { job } from "#schema/tables/jobs";
import { userLifecycleOperation } from "#schema/tables/user-lifecycle";
import { makeAppConfigLayer } from "#testing/effect";
import { isolatedDatabaseLayer } from "#testing/isolated-database";

import { UserLifecycleRepository } from "./repository";
import { UserLifecycleJob, UserLifecycleService } from "./service";

const owner = UserId.make("owner");
const other = UserId.make("other");
const expiresAt = new Date("2100-01-01T00:00:00.000Z");
const issuedAt = new Date("2026-08-24T00:00:00.000Z");
const earlierDisabledAt = new Date("2026-08-24T00:00:00.000Z");

const ids = (rows: ReadonlyArray<{ readonly id: string }>) => sortBy(rows.map(({ id }) => id));

const authLayer = Layer.unwrap(
	Effect.gen(function* () {
		const repository = yield* AuthRepository;
		return Layer.mock(AuthService)({
			handler: () => Promise.reject(new Error("unused")),
			updateAuthUserDisabled: repository.updateUserDisabled,
			revokeUserOAuthTokens: repository.revokeUserOAuthTokens,
			revokePasswordResetLinks: repository.revokeUserPasswordResetLinks,
			deleteUserSessions: (userId) => Effect.asVoid(repository.deleteUserSessions(userId)),
		});
	}),
).pipe(Layer.provide(AuthRepository.layer));

const lifecycleLayer = (jobs: Layer.Layer<JobQueue, never, DatabaseSession>) =>
	UserLifecycleService.layer.pipe(
		Layer.provideMerge(
			Layer.mergeAll(makeAppConfigLayer(), UserLifecycleRepository.layer, authLayer, jobs),
		),
		Layer.provideMerge(isolatedDatabaseLayer("lifecycle_revocation")),
	);

const seedAccess = Effect.fnUntraced(function* (disabledAt: Date | null) {
	const database = yield* DatabaseSession;
	yield* database.run((db) =>
		db.insert(user).values([
			{ id: owner, disabledAt, name: "Owner", email: "owner@example.test" },
			{ id: other, name: "Other", email: "other@example.test" },
		]),
	);
	yield* database.run((db) =>
		db
			.insert(oauthClient)
			.values({
				id: "client",
				clientId: "client",
				redirectUris: ["https://client.example/callback"],
			}),
	);
	yield* database.run((db) =>
		db
			.insert(session)
			.values(
				[owner, other].map((userId) => ({
					userId,
					expiresAt,
					id: `${userId}-session`,
					token: `${userId}-session`,
				})),
			),
	);
	yield* database.run((db) =>
		db
			.insert(oauthRefreshToken)
			.values(
				[owner, other].map((userId) => ({
					userId,
					expiresAt,
					scopes: [],
					clientId: "client",
					createdAt: issuedAt,
					id: `${userId}-refresh`,
					token: `${userId}-refresh`,
				})),
			),
	);
	yield* database.run((db) =>
		db
			.insert(verification)
			.values(
				[owner, other].map((userId) => ({
					expiresAt,
					value: userId,
					id: `${userId}-reset`,
					identifier: `reset-password:${userId}`,
				})),
			),
	);
});

const accessState = Effect.gen(function* () {
	const database = yield* DatabaseSession;
	const [account] = yield* database.run((db) =>
		db
			.select({ disabledAt: user.disabledAt, retiringAt: user.retiringAt })
			.from(user)
			.where(eq(user.id, owner)),
	);
	return {
		retiring: account?.retiringAt !== null,
		disabledAt: account?.disabledAt ?? null,
		sessions: ids(yield* database.run((db) => db.select({ id: session.id }).from(session))),
		resetLinks: ids(
			yield* database.run((db) => db.select({ id: verification.id }).from(verification)),
		),
		jobs: yield* database.run((db) =>
			db.select({ key: job.key }).from(job).where(eq(job.kind, UserLifecycleJob.name)),
		),
		operations: yield* database.run((db) =>
			db
				.select({ id: userLifecycleOperation.id, status: userLifecycleOperation.status })
				.from(userLifecycleOperation),
		),
		revokedTokens: ids(
			yield* database.run((db) =>
				db
					.select({ id: oauthRefreshToken.id })
					.from(oauthRefreshToken)
					.where(isNotNull(oauthRefreshToken.revoked)),
			),
		),
	};
});

layer(lifecycleLayer(JobQueue.layer))((test) => {
	test.effect(
		"revokes access in the transaction that creates the operation and queues its job",
		() =>
			Effect.gen(function* () {
				yield* seedAccess(null);
				const service = yield* UserLifecycleService;
				const { operationId } = yield* service.deleteUser(owner);
				const revoked = yield* accessState;
				expect(revoked).toEqual<unknown>({
					retiring: true,
					disabledAt: anyOf(Date),
					resetLinks: ["other-reset"],
					sessions: ["other-session"],
					jobs: [{ key: operationId }],
					revokedTokens: ["owner-refresh"],
					operations: [{ id: operationId, status: "pending" }],
				});
				expect(yield* service.deleteUser(owner)).toEqual({ operationId });
				expect(yield* accessState).toEqual(revoked);
			}),
		testTimeout,
	);
});

layer(
	lifecycleLayer(
		Layer.mock(JobQueue)({
			enqueue: () => Effect.fail(new DbError({ message: "queue unavailable" })),
		}),
	),
)((test) => {
	test.effect(
		"keeps every access when the operation's transaction rolls back",
		() =>
			Effect.gen(function* () {
				yield* seedAccess(null);
				const service = yield* UserLifecycleService;
				assertExitFails(
					yield* Effect.exit(service.deleteUser(owner)),
					new DbError({ message: "queue unavailable" }),
				);
				expect(yield* accessState).toEqual({
					jobs: [],
					operations: [],
					retiring: false,
					disabledAt: null,
					revokedTokens: [],
					resetLinks: ["other-reset", "owner-reset"],
					sessions: ["other-session", "owner-session"],
				});
			}),
		testTimeout,
	);
});

layer(lifecycleLayer(JobQueue.layer))((test) => {
	test.effect(
		"revokes access again when it reactivates a failed operation, keeping an earlier disable time",
		() =>
			Effect.gen(function* () {
				yield* seedAccess(earlierDisabledAt);
				const database = yield* DatabaseSession;
				yield* database.run((db) =>
					db
						.insert(userLifecycleOperation)
						.values({
							userId: owner,
							kind: "reset",
							status: "failed",
							id: "failed-operation",
							failure: { code: "object-cleanup-failed" },
							metadata: {
								locators: [],
								accounts: [],
								usesLocalAuth: true,
								recreatedAccountId: "account",
								user: {
									id: owner,
									name: "Owner",
									emailVerified: true,
									email: "owner@example.test",
									disabledAt: earlierDisabledAt.toISOString(),
								},
							},
						}),
				);
				const service = yield* UserLifecycleService;
				expect(yield* service.resetUser(owner)).toEqual({ operationId: "failed-operation" });
				expect(yield* accessState).toEqual({
					retiring: false,
					resetLinks: ["other-reset"],
					sessions: ["other-session"],
					disabledAt: earlierDisabledAt,
					revokedTokens: ["owner-refresh"],
					jobs: [{ key: "failed-operation" }],
					operations: [{ status: "pending", id: "failed-operation" }],
				});
			}),
		testTimeout,
	);
});
