import { expect, it } from "@effect/vitest";
import { WorkflowEngine } from "@effect/workflow/WorkflowEngine";
import { BadRequest, DbError } from "@ryot/contract/errors";
import { UserId } from "@ryot/contract/schema/brands";
import type { ilike } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { Effect, Exit, Layer } from "effect";
import { assert, describe, it as vitestIt } from "vitest";

import { AuthService } from "#lib/auth";
import { defaultUserPreferences } from "#lib/builtins/bootstrap";
import * as schema from "#lib/db/schema/tables/auth";
import { CurrentDb, DbRunner, DbService, TransactionRunner } from "#lib/db/service";
import { RedisService } from "#lib/redis";
import { makeAppConfigLayer, makeRedisService, makeWorkflowEngine } from "#lib/test-support/effect";

import { GodModeRepository } from "./repository";
import { checkResetEligibility, classifyAuthState, GodModeService } from "./service";

type SearchWhere = ReturnType<typeof ilike>;
type UserRow = {
	id: string;
	name: string;
	email: string;
	createdAt: Date;
	disabledAt: Date | null;
	twoFactorEnabled: boolean | null;
};

const baseUser = {
	id: "user_1",
	disabledAt: null,
	name: "Test User",
	twoFactorEnabled: false,
	email: "test@example.com",
	createdAt: new Date("2024-01-01T00:00:00Z"),
} satisfies UserRow;

const dialect = new PgDialect();

const makeAuthMock = (state?: { deleteUserSessionsCalled: boolean }) =>
	Object.assign(Object.create(null), {
		currentUser: () => Effect.die("unused"),
		createAuthUser: () => Effect.die("unused"),
		linkAuthAccount: () => Effect.die("unused"),
		auth: { api: { requestPasswordReset: () => Promise.resolve(undefined) } },
		deleteUserSessions: () => {
			if (state) {
				state.deleteUserSessionsCalled = true;
			}
			return Effect.void;
		},
	});

const makeProvisionAuthMock = (
	state: {
		createdUser: null | Record<string, unknown>;
		createdAccount: null | Record<string, unknown>;
	},
	options?: { createUserError?: Error; createAccountError?: Error },
) =>
	Object.assign(Object.create(null), makeAuthMock(), {
		createAuthUser: (user: Record<string, unknown>) => {
			state.createdUser = user;
			return options?.createUserError
				? Effect.fail(new DbError({ message: options.createUserError.message }))
				: Effect.succeed(user);
		},
		linkAuthAccount: (account: Record<string, unknown>) => {
			state.createdAccount = account;
			return options?.createAccountError
				? Effect.fail(new DbError({ message: options.createAccountError.message }))
				: Effect.succeed(account);
		},
	});

const makeRedisMock = () =>
	makeRedisService({
		client: Object.assign(Object.create(null), {
			del: () => Promise.resolve(0),
			eval: () => Promise.resolve(0),
			duplicate: () => Object.create(null),
			get: () => Promise.resolve(null),
			set: () => Promise.resolve("OK"),
		}),
	});

const makeBootstrapDb = () =>
	Object.assign(Object.create(null), {
		insert: () => ({
			values: () =>
				Object.assign(Promise.resolve({}), {
					onConflictDoNothing: () => Promise.resolve({}),
				}),
		}),
		select: () => ({
			from: () => ({
				where: () =>
					Object.assign(Promise.resolve([]), {
						limit: () => Promise.resolve([]),
					}),
			}),
		}),
	});

const makeDbRunnerLayer = (db: object) =>
	Layer.succeed(DbRunner, <A, E, R>(effect: Effect.Effect<A, E, R>) =>
		Effect.provideService(effect, CurrentDb, Object.assign(Object.create(null), db)),
	);

const makeDbServiceLayer = (db: object) =>
	Layer.succeed(
		DbService,
		Object.assign(Object.create(null), { db: Object.assign(Object.create(null), db), pool: {} }),
	);

const transactionLayer = Layer.succeed(
	TransactionRunner,
	<A, E, R>(effect: Effect.Effect<A, E, R>) =>
		Effect.provideService(effect, CurrentDb, makeBootstrapDb()),
);

const workflowEngineLayer = Layer.succeed(
	WorkflowEngine,
	makeWorkflowEngine({ execute: () => Effect.void.pipe(Effect.as(undefined)) }),
);

const makeServiceLayer = (
	db: object,
	disableLocalAuth = false,
	authState?: { deleteUserSessionsCalled: boolean },
): Layer.Layer<GodModeService> =>
	GodModeService.Default.pipe(
		Layer.provide(
			Layer.mergeAll(
				makeDbRunnerLayer(db),
				makeDbServiceLayer(db),
				transactionLayer,
				GodModeRepository.Default,
				makeAppConfigLayer({ users: { allowRegistration: true, disableLocalAuth } }),
				Layer.succeed(AuthService, makeAuthMock(authState)),
				Layer.succeed(RedisService, makeRedisMock()),
				workflowEngineLayer,
			),
		),
	);

const makeProvisionLayer = (
	db: object,
	auth: ReturnType<typeof makeProvisionAuthMock>,
): Layer.Layer<GodModeService> =>
	GodModeService.Default.pipe(
		Layer.provide(
			Layer.mergeAll(
				makeDbRunnerLayer(db),
				makeDbServiceLayer(db),
				transactionLayer,
				GodModeRepository.Default,
				makeAppConfigLayer({ users: { allowRegistration: true, disableLocalAuth: false } }),
				Layer.succeed(AuthService, auth),
				Layer.succeed(RedisService, makeRedisMock()),
				workflowEngineLayer,
			),
		),
	);

const makeListUsersDb = (options: {
	total: number;
	listError?: Error;
	accountError?: Error;
	users: ReadonlyArray<UserRow>;
	accounts: ReadonlyArray<{ providerId: string; userId: string }>;
}) => {
	const state = { limit: 0, offset: 0, userWhere: undefined as SearchWhere | undefined };

	const db = Object.assign(Object.create(null), {
		select: (fields: Record<string, unknown>) => ({
			from: (table: unknown) => {
				if (table === schema.user) {
					const isCountQuery = "count" in fields;
					return {
						where: (condition: SearchWhere | undefined) => {
							state.userWhere = condition;
							if (isCountQuery) {
								return Promise.resolve([{ count: options.total }]);
							}

							return Object.assign(Promise.resolve(options.users), {
								limit: (limit: number) => {
									state.limit = limit;
									return Object.assign(Promise.resolve(options.users), {
										offset: (offset: number) => {
											state.offset = offset;
											return Object.assign(Promise.resolve(options.users), {
												orderBy: () =>
													options.listError
														? Promise.reject(options.listError)
														: Promise.resolve(options.users),
											});
										},
									});
								},
							});
						},
					};
				}

				if (table === schema.account) {
					return {
						where: () =>
							options.accountError
								? Promise.reject(options.accountError)
								: Promise.resolve(options.accounts),
					};
				}

				throw new Error("unexpected table");
			},
		}),
	});

	return { db, state };
};

const makeSetUserDisabledDb = (options: {
	updateError?: Error;
	user: Pick<UserRow, "disabledAt" | "id"> | null;
}) => {
	const state = {
		updateInput: null as null | { disabledAt: Date | null; updatedAt: Date },
	};

	const db = Object.assign(Object.create(null), {
		select: () => ({
			from: () => ({
				where: () =>
					Object.assign(Promise.resolve(options.user ? [options.user] : []), {
						limit: () => Promise.resolve(options.user ? [options.user] : []),
					}),
			}),
		}),
		update: () => ({
			set: (input: { disabledAt: Date | null; updatedAt: Date }) => {
				state.updateInput = input;
				return {
					where: () =>
						options.updateError ? Promise.reject(options.updateError) : Promise.resolve({}),
				};
			},
		}),
	});

	return { db, state };
};

const makeProvisionUserDb = (options?: {
	existingUserId?: string;
	createUserError?: Error;
	createAccountError?: Error;
}) => {
	const state = {
		createdUser: null as null | Record<string, unknown>,
		createdAccount: null as null | Record<string, unknown>,
	};

	const db = Object.assign(Object.create(null), {
		select: () => ({
			from: () => ({
				where: () =>
					Object.assign(
						Promise.resolve(options?.existingUserId ? [{ id: options.existingUserId }] : []),
						{
							limit: () =>
								Promise.resolve(options?.existingUserId ? [{ id: options.existingUserId }] : []),
						},
					),
			}),
		}),
	});

	return { auth: makeProvisionAuthMock(state, options), db, state };
};

describe("classifyAuthState", () => {
	vitestIt("returns none when there are no accounts", () => {
		expect(classifyAuthState([])).toBe("none");
	});

	vitestIt("returns credential when there is only a credential account", () => {
		expect(classifyAuthState([{ providerId: "credential" }])).toBe("credential");
	});

	vitestIt("returns oidc when there is only an oidc account", () => {
		expect(classifyAuthState([{ providerId: "oidc" }])).toBe("oidc");
	});

	vitestIt("returns mixed when there are both credential and oidc accounts", () => {
		expect(classifyAuthState([{ providerId: "credential" }, { providerId: "oidc" }])).toBe("mixed");
	});

	vitestIt("returns mixed regardless of account order", () => {
		expect(classifyAuthState([{ providerId: "oidc" }, { providerId: "credential" }])).toBe("mixed");
	});

	vitestIt("ignores unknown provider ids", () => {
		expect(classifyAuthState([{ providerId: "credential" }, { providerId: "unknown" }])).toBe(
			"credential",
		);
	});
});

describe("checkResetEligibility", () => {
	vitestIt("allows credential users to reset", () => {
		expect(checkResetEligibility("credential")).toBeNull();
	});

	vitestIt("allows users with no accounts to reset", () => {
		expect(checkResetEligibility("none")).toBeNull();
	});

	vitestIt("blocks oidc users from reset", () => {
		expect(checkResetEligibility("oidc")).toBe(
			"Cannot generate reset link for user with auth state 'oidc'. Only 'credential' and 'none' users are eligible.",
		);
	});

	vitestIt("blocks mixed users from reset", () => {
		expect(checkResetEligibility("mixed")).toBe(
			"Cannot generate reset link for user with auth state 'mixed'. Only 'credential' and 'none' users are eligible.",
		);
	});
});

it.effect("blocks password reset when local auth is disabled", () => {
	const { db } = makeListUsersDb({ total: 0, users: [], accounts: [] });

	return Effect.gen(function* () {
		const service = yield* GodModeService;
		const exit = yield* Effect.exit(service.resetUserPassword(UserId.make("user_1")));
		expect(exit).toEqual(
			Exit.fail(new BadRequest({ message: "Local authentication is disabled on this instance" })),
		);
	}).pipe(Effect.provide(makeServiceLayer(db, true)));
});

it.effect("returns users with total count and auth states", () => {
	const { db } = makeListUsersDb({
		total: 1,
		users: [baseUser],
		accounts: [{ userId: baseUser.id, providerId: "credential" }],
	});

	return Effect.gen(function* () {
		const service = yield* GodModeService;
		const result = yield* service.listUsers({ limit: 50, offset: 0 });

		expect(result).toEqual({
			total: 1,
			users: [
				{
					id: "user_1",
					disabledAt: null,
					name: "Test User",
					twoFactorEnabled: false,
					authState: "credential",
					email: "test@example.com",
					createdAt: "2024-01-01T00:00:00.000Z",
				},
			],
		});
	}).pipe(Effect.provide(makeServiceLayer(db)));
});

it.effect("classifies users with no accounts as none", () => {
	const { db } = makeListUsersDb({ total: 1, users: [baseUser], accounts: [] });

	return Effect.gen(function* () {
		const service = yield* GodModeService;
		const result = yield* service.listUsers({ limit: 50, offset: 0 });
		expect(result.users[0]?.authState).toBe("none");
	}).pipe(Effect.provide(makeServiceLayer(db)));
});

it.effect("classifies users with oidc accounts correctly", () => {
	const { db } = makeListUsersDb({
		total: 1,
		users: [baseUser],
		accounts: [{ userId: baseUser.id, providerId: "oidc" }],
	});

	return Effect.gen(function* () {
		const service = yield* GodModeService;
		const result = yield* service.listUsers({ limit: 50, offset: 0 });
		expect(result.users[0]?.authState).toBe("oidc");
	}).pipe(Effect.provide(makeServiceLayer(db)));
});

it.effect("classifies users with both credential and oidc accounts as mixed", () => {
	const { db } = makeListUsersDb({
		total: 1,
		users: [baseUser],
		accounts: [
			{ userId: baseUser.id, providerId: "credential" },
			{ userId: baseUser.id, providerId: "oidc" },
		],
	});

	return Effect.gen(function* () {
		const service = yield* GodModeService;
		const result = yield* service.listUsers({ limit: 50, offset: 0 });
		expect(result.users[0]?.authState).toBe("mixed");
	}).pipe(Effect.provide(makeServiceLayer(db)));
});

it.effect("returns a db error when listing users fails", () => {
	const { db } = makeListUsersDb({
		total: 1,
		accounts: [],
		users: [baseUser],
		listError: new Error("db down"),
	});

	return Effect.gen(function* () {
		const service = yield* GodModeService;
		const exit = yield* Effect.exit(service.listUsers({ limit: 50, offset: 0 }));
		expect(exit).toEqual(Exit.fail(new DbError({ message: "db down" })));
	}).pipe(Effect.provide(makeServiceLayer(db)));
});

it.effect("applies the search filter to user queries", () => {
	const { db, state } = makeListUsersDb({ total: 1, users: [baseUser], accounts: [] });

	return Effect.gen(function* () {
		const service = yield* GodModeService;
		yield* service.listUsers({ limit: 10, offset: 5, search: "john" });

		expect(state.limit).toBe(10);
		expect(state.offset).toBe(5);
		assert(state.userWhere !== undefined, "Expected user query filter");
		const query = dialect.sqlToQuery(state.userWhere);
		expect(query.sql.toLowerCase()).toContain(" ilike ");
		expect(query.params).toContain("%john%");
	}).pipe(Effect.provide(makeServiceLayer(db)));
});

it.effect("trims whitespace from the search input", () => {
	const { db, state } = makeListUsersDb({ total: 1, users: [baseUser], accounts: [] });

	return Effect.gen(function* () {
		const service = yield* GodModeService;
		yield* service.listUsers({ limit: 10, offset: 0, search: "  john  " });

		assert(state.userWhere !== undefined, "Expected user query filter");
		const query = dialect.sqlToQuery(state.userWhere);
		expect(query.params).toContain("%john%");
	}).pipe(Effect.provide(makeServiceLayer(db)));
});

it.effect("returns the disabled timestamp for disabled users", () => {
	const { db } = makeListUsersDb({
		total: 1,
		accounts: [{ userId: baseUser.id, providerId: "credential" }],
		users: [{ ...baseUser, disabledAt: new Date("2024-02-03T04:05:06Z") }],
	});

	return Effect.gen(function* () {
		const service = yield* GodModeService;
		const result = yield* service.listUsers({ limit: 50, offset: 0 });
		expect(result.users[0]?.disabledAt).toBe("2024-02-03T04:05:06.000Z");
	}).pipe(Effect.provide(makeServiceLayer(db)));
});

it.effect("disables an enabled user and deletes sessions", () => {
	const { db, state } = makeSetUserDisabledDb({ user: { id: "user_1", disabledAt: null } });
	const authState = { deleteUserSessionsCalled: false };

	return Effect.gen(function* () {
		const service = yield* GodModeService;
		const result = yield* service.setUserDisabled(UserId.make("user_1"), true);

		expect(result.id).toBe("user_1");
		expect(typeof result.disabledAt).toBe("string");
		expect(authState.deleteUserSessionsCalled).toBe(true);
		expect(state.updateInput?.disabledAt?.toISOString()).toBe(result.disabledAt);
		expect(state.updateInput?.updatedAt.toISOString()).toBe(result.disabledAt);
	}).pipe(Effect.provide(makeServiceLayer(db, false, authState)));
});

it.effect("preserves an existing disabledAt when disabling an already-disabled user", () => {
	const existingDisabledAt = new Date("2024-01-02T00:00:00Z");
	const { db, state } = makeSetUserDisabledDb({
		user: { id: "user_1", disabledAt: existingDisabledAt },
	});
	const authState = { deleteUserSessionsCalled: false };

	return Effect.gen(function* () {
		const service = yield* GodModeService;
		const result = yield* service.setUserDisabled(UserId.make("user_1"), true);

		expect(result).toEqual({ id: "user_1", disabledAt: "2024-01-02T00:00:00.000Z" });
		expect(authState.deleteUserSessionsCalled).toBe(true);
		expect(state.updateInput?.disabledAt).toBe(existingDisabledAt);
	}).pipe(Effect.provide(makeServiceLayer(db, false, authState)));
});

it.effect("enables a disabled user without deleting sessions", () => {
	const { db, state } = makeSetUserDisabledDb({
		user: { id: "user_1", disabledAt: new Date("2024-01-02T00:00:00Z") },
	});
	const authState = { deleteUserSessionsCalled: false };

	return Effect.gen(function* () {
		const service = yield* GodModeService;
		const result = yield* service.setUserDisabled(UserId.make("user_1"), false);

		expect(result).toEqual({ id: "user_1", disabledAt: null });
		expect(authState.deleteUserSessionsCalled).toBe(false);
		expect(state.updateInput).toMatchObject({ disabledAt: null });
	}).pipe(Effect.provide(makeServiceLayer(db, false, authState)));
});

it.effect("enabling an already-enabled user does not delete sessions", () => {
	const { db } = makeSetUserDisabledDb({ user: { id: "user_1", disabledAt: null } });
	const authState = { deleteUserSessionsCalled: false };

	return Effect.gen(function* () {
		const service = yield* GodModeService;
		const result = yield* service.setUserDisabled(UserId.make("user_1"), false);

		expect(result).toEqual({ id: "user_1", disabledAt: null });
		expect(authState.deleteUserSessionsCalled).toBe(false);
	}).pipe(Effect.provide(makeServiceLayer(db, false, authState)));
});

it.effect("returns a bad request when the user is not found while setting disabled state", () => {
	const { db } = makeSetUserDisabledDb({ user: null });

	return Effect.gen(function* () {
		const service = yield* GodModeService;
		const exit = yield* Effect.exit(service.setUserDisabled(UserId.make("missing"), true));
		expect(exit).toEqual(
			Exit.fail(new BadRequest({ message: "User with id 'missing' not found" })),
		);
	}).pipe(Effect.provide(makeServiceLayer(db)));
});

it.effect("returns a db error when persisting disabled state fails", () => {
	const { db } = makeSetUserDisabledDb({
		user: { id: "user_1", disabledAt: null },
		updateError: new Error("db down"),
	});

	return Effect.gen(function* () {
		const service = yield* GodModeService;
		const exit = yield* Effect.exit(service.setUserDisabled(UserId.make("user_1"), true));
		expect(exit).toEqual(Exit.fail(new DbError({ message: "db down" })));
	}).pipe(Effect.provide(makeServiceLayer(db)));
});

vitestIt("creates a credential user without an account row", () => {
	const { auth, db, state } = makeProvisionUserDb();

	return Effect.runPromise(
		Effect.gen(function* () {
			const service = yield* GodModeService;
			const result = yield* service.provisionUser({
				provider: "credential",
				name: "new@example.com",
				email: "new@example.com",
			});

			expect(result.userId).toBe(state.createdUser?.id);
			expect(state.createdUser).toMatchObject({
				emailVerified: true,
				name: "new@example.com",
				email: "new@example.com",
				preferences: defaultUserPreferences,
			});
			expect(state.createdAccount).toBeNull();
		}).pipe(Effect.provide(makeProvisionLayer(db, auth))),
	);
});

vitestIt("creates an oidc user with an account stub", () => {
	const { auth, db, state } = makeProvisionUserDb();

	return Effect.runPromise(
		Effect.gen(function* () {
			const service = yield* GodModeService;
			const result = yield* service.provisionUser({
				provider: "oidc",
				name: "oidc@example.com",
				email: "oidc@example.com",
				oidcIssuerId: "google|123",
			});

			expect(result.userId).toBe(state.createdUser?.id);
			expect(state.createdAccount).toMatchObject({
				providerId: "oidc",
				userId: result.userId,
				accountId: "google|123",
			});
		}).pipe(Effect.provide(makeProvisionLayer(db, auth))),
	);
});

vitestIt("returns a bad request when provisioning a user that already exists", () => {
	const { auth, db } = makeProvisionUserDb({ existingUserId: "existing" });

	return Effect.runPromise(
		Effect.gen(function* () {
			const service = yield* GodModeService;
			const exit = yield* Effect.exit(
				service.provisionUser({
					provider: "credential",
					name: "exists@example.com",
					email: "exists@example.com",
				}),
			);

			expect(exit).toEqual(
				Exit.fail(
					new BadRequest({ message: "User with email 'exists@example.com' already exists" }),
				),
			);
		}).pipe(Effect.provide(makeProvisionLayer(db, auth))),
	);
});

vitestIt("returns a db error when user creation fails during provisioning", () => {
	const { auth, db } = makeProvisionUserDb({ createUserError: new Error("db down") });

	return Effect.runPromise(
		Effect.gen(function* () {
			const service = yield* GodModeService;
			const exit = yield* Effect.exit(
				service.provisionUser({
					provider: "credential",
					name: "new@example.com",
					email: "new@example.com",
				}),
			);

			expect(exit).toEqual(Exit.fail(new DbError({ message: "db down" })));
		}).pipe(Effect.provide(makeProvisionLayer(db, auth))),
	);
});

vitestIt("returns a db error when oidc account creation fails during provisioning", () => {
	const { auth, db } = makeProvisionUserDb({ createAccountError: new Error("db down") });

	return Effect.runPromise(
		Effect.gen(function* () {
			const service = yield* GodModeService;
			const exit = yield* Effect.exit(
				service.provisionUser({
					provider: "oidc",
					name: "oidc@example.com",
					email: "oidc@example.com",
					oidcIssuerId: "google|123",
				}),
			);

			expect(exit).toEqual(Exit.fail(new DbError({ message: "db down" })));
		}).pipe(Effect.provide(makeProvisionLayer(db, auth))),
	);
});
