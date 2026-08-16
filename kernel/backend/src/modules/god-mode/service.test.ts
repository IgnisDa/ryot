import { expect, it } from "@effect/vitest";
import { defaultUserPreferences } from "@ryot-app/contract/auth-middleware";
import { DbError } from "@ryot-app/contract/errors";
import {
	GodModeNotFound,
	GodModeRequestFailure,
} from "@ryot-app/contract/modules/god-mode/contract";
import { UserId } from "@ryot-app/contract/schema/brands";
import { Effect, Layer } from "effect";
import { describe, it as vitestIt } from "vitest";

import { Database } from "#lib/infrastructure/db/service";
import { RedisService } from "#lib/infrastructure/redis";
import { assertExitFails } from "#lib/test-utils/assertions";
import { makeAppConfigLayer, makeRedisService } from "#lib/test-utils/effect";
import { AuthService } from "#modules/auth/service";
import { NotificationSubscriptionsService } from "#modules/automations/notification-subscriptions-service";
import { EntitiesService } from "#modules/entities/service";
import { SavedViewsService } from "#modules/saved-views/service";
import { PluginUserBootstrapDispatcher } from "#modules/user-bootstrap/plugin-dispatch";
import { classifyAuthState } from "#modules/user-lifecycle/auth-state";
import { UserLifecycleService } from "#modules/user-lifecycle/service";

import { GodModeRepository } from "./repository";
import { checkResetEligibility, GodModeService } from "./service";

const makeAuthMock = (state?: {
	deleteUserSessionsCalled: boolean;
	updateAuthUserDisabledError?: Error;
	updateInput?: { disabledAt: Date | null; updatedAt: Date } | undefined;
}) =>
	Object.assign(Object.create(null), {
		currentUser: () => Effect.die("unused"),
		createAuthUser: () => Effect.die("unused"),
		linkAuthAccount: () => Effect.die("unused"),
		purgeApiKeyCaches: () => Effect.die("unused"),
		auth: { api: { requestPasswordReset: () => Promise.resolve(undefined) } },
		deleteUserSessions: () => {
			if (state) {
				state.deleteUserSessionsCalled = true;
			}
			return Effect.void;
		},
		updateAuthUserDisabled: (
			_userId: UserId,
			input: { disabledAt: Date | null; updatedAt: Date },
		) => {
			if (state) {
				state.updateInput = input;
			}
			return state?.updateAuthUserDisabledError
				? Effect.fail(new DbError({ message: state.updateAuthUserDisabledError.message }))
				: Effect.void;
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
			get: () => Promise.resolve(null),
			set: () => Promise.resolve("OK"),
			duplicate: () => Object.create(null),
		}),
	});

const makeBootstrapDb = () =>
	Object.assign(Object.create(null), {
		execute: () => Effect.succeed({}),
		update: () => ({ set: () => ({ where: () => Effect.succeed({}) }) }),
		insert: () => ({
			values: () =>
				Object.assign(Effect.succeed({}), {
					onConflictDoUpdate: () => Effect.succeed({}),
					onConflictDoNothing: () => Effect.succeed({}),
				}),
		}),
		select: () => ({
			from: () => ({
				where: () =>
					Object.assign(Effect.succeed([]), {
						for: () => Effect.succeed([]),
						limit: () => Effect.succeed([]),
					}),
			}),
		}),
	});

const makeDatabaseLayer = (db: object, transactionDb = db) =>
	Layer.succeed(
		Database,
		Object.assign(Object.create(null), db, {
			transaction: (callback: (database: Database["Service"]) => Effect.Effect<unknown>) =>
				callback(Object.assign(Object.create(null), transactionDb)),
		}),
	);

const bootstrapEntitiesServiceLayer = Layer.mock(EntitiesService)({
	create: () => Effect.succeed(Object.create(null)),
});
const bootstrapNotificationSubscriptionsServiceLayer = Layer.mock(NotificationSubscriptionsService)(
	{ ensureDefaultRules: () => Effect.void },
);
const bootstrapSavedViewsServiceLayer = Layer.mock(SavedViewsService)({});
const pluginUserBootstrapDispatcherLayer = Layer.mock(PluginUserBootstrapDispatcher)({
	dispatchAll: () => Effect.void,
});
const defaultUserLifecycleServiceLayer = Layer.mock(UserLifecycleService)({
	resetUser: () => Effect.die("unused"),
	deleteUser: () => Effect.die("unused"),
});

const makeServiceLayer = (
	db: object,
	disableLocalAuth = false,
	authState?: Parameters<typeof makeAuthMock>[0],
	transactionDb = makeBootstrapDb(),
	auth: ReturnType<typeof makeAuthMock> = makeAuthMock(authState),
	lifecycleLayer = defaultUserLifecycleServiceLayer,
) =>
	GodModeService.layer.pipe(
		Layer.provideMerge(
			Layer.mergeAll(
				makeDatabaseLayer(db, transactionDb),
				GodModeRepository.layer,
				makeAppConfigLayer({ users: { disableLocalAuth } }),
				Layer.succeed(
					AuthService,
					Object.assign(auth, {
						transaction: <A, E>(
							callback: (operations: {
								createAuthUser: typeof auth.createAuthUser;
							}) => Effect.Effect<A, E, Database>,
						) =>
							callback({ createAuthUser: auth.createAuthUser }).pipe(
								Effect.provideService(Database, Object.assign(Object.create(null), transactionDb)),
							),
					}),
				),
				Layer.succeed(RedisService, makeRedisMock()),
				bootstrapEntitiesServiceLayer,
				bootstrapNotificationSubscriptionsServiceLayer,
				bootstrapSavedViewsServiceLayer,
				pluginUserBootstrapDispatcherLayer,
				lifecycleLayer,
			),
		),
	);

const makeProvisionLayer = (db: object, auth: ReturnType<typeof makeProvisionAuthMock>) =>
	GodModeService.layer.pipe(
		Layer.provideMerge(
			Layer.mergeAll(
				makeDatabaseLayer(db, makeBootstrapDb()),
				GodModeRepository.layer,
				makeAppConfigLayer(),
				Layer.succeed(AuthService, auth),
				Layer.succeed(RedisService, makeRedisMock()),
				bootstrapEntitiesServiceLayer,
				bootstrapNotificationSubscriptionsServiceLayer,
				bootstrapSavedViewsServiceLayer,
				pluginUserBootstrapDispatcherLayer,
				defaultUserLifecycleServiceLayer,
			),
		),
	);

const makeSetUserDisabledDb = (options: {
	user: { id: string; disabledAt: Date | null } | null;
}) => {
	const db = Object.assign(Object.create(null), {
		select: () => ({
			from: () => ({
				where: () =>
					Object.assign(Effect.succeed(options.user ? [options.user] : []), {
						limit: () => Effect.succeed(options.user ? [options.user] : []),
					}),
			}),
		}),
	});

	return { db };
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
						Effect.succeed(options?.existingUserId ? [{ id: options.existingUserId }] : []),
						{
							limit: () =>
								Effect.succeed(options?.existingUserId ? [{ id: options.existingUserId }] : []),
						},
					),
			}),
		}),
	});

	return { db, state, auth: makeProvisionAuthMock(state, options) };
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
		expect(checkResetEligibility("oidc")).toEqual({
			authState: "oidc",
			code: "password-reset-unsupported",
		});
	});

	vitestIt("blocks mixed users from reset", () => {
		expect(checkResetEligibility("mixed")).toEqual({
			authState: "mixed",
			code: "password-reset-unsupported",
		});
	});
});

it.effect("blocks password reset when local auth is disabled", () => {
	const { db } = makeSetUserDisabledDb({ user: null });

	return Effect.gen(function* () {
		const service = yield* GodModeService;
		const exit = yield* Effect.exit(service.resetUserPassword(UserId.make("user_1")));
		assertExitFails(exit, new GodModeRequestFailure({ reason: { code: "local-auth-disabled" } }));
	}).pipe(Effect.provide(makeServiceLayer(db, true)));
});

it.effect("disables an enabled user and deletes sessions", () => {
	const { db } = makeSetUserDisabledDb({ user: { id: "user_1", disabledAt: null } });
	const authState = {
		deleteUserSessionsCalled: false,
		updateInput: undefined as { disabledAt: Date | null; updatedAt: Date } | undefined,
	};

	return Effect.gen(function* () {
		const service = yield* GodModeService;
		const result = yield* service.setUserDisabled(UserId.make("user_1"), true);

		expect(result).toEqual({ id: UserId.make("user_1") });
		expect(authState.deleteUserSessionsCalled).toBe(true);
		expect(authState.updateInput?.disabledAt).toBeInstanceOf(Date);
		expect(authState.updateInput?.updatedAt).toEqual(authState.updateInput?.disabledAt);
	}).pipe(Effect.provide(makeServiceLayer(db, false, authState)));
});

it.effect("preserves an existing disabledAt when disabling an already-disabled user", () => {
	const existingDisabledAt = new Date("2024-01-02T00:00:00Z");
	const { db } = makeSetUserDisabledDb({ user: { id: "user_1", disabledAt: existingDisabledAt } });
	const authState = {
		deleteUserSessionsCalled: false,
		updateInput: undefined as { disabledAt: Date | null; updatedAt: Date } | undefined,
	};

	return Effect.gen(function* () {
		const service = yield* GodModeService;
		const result = yield* service.setUserDisabled(UserId.make("user_1"), true);

		expect(result).toEqual({ id: UserId.make("user_1") });
		expect(authState.deleteUserSessionsCalled).toBe(true);
		expect(authState.updateInput?.disabledAt).toBe(existingDisabledAt);
	}).pipe(Effect.provide(makeServiceLayer(db, false, authState)));
});

it.effect("enables a disabled user without deleting sessions", () => {
	const { db } = makeSetUserDisabledDb({
		user: { id: "user_1", disabledAt: new Date("2024-01-02T00:00:00Z") },
	});
	const authState = {
		deleteUserSessionsCalled: false,
		updateInput: undefined as { disabledAt: Date | null; updatedAt: Date } | undefined,
	};

	return Effect.gen(function* () {
		const service = yield* GodModeService;
		const result = yield* service.setUserDisabled(UserId.make("user_1"), false);

		expect(result).toEqual({ id: UserId.make("user_1") });
		expect(authState.deleteUserSessionsCalled).toBe(false);
		expect(authState.updateInput).toMatchObject({ disabledAt: null });
	}).pipe(Effect.provide(makeServiceLayer(db, false, authState)));
});

it.effect("enabling an already-enabled user does not delete sessions", () => {
	const { db } = makeSetUserDisabledDb({ user: { id: "user_1", disabledAt: null } });
	const authState = {
		deleteUserSessionsCalled: false,
		updateInput: undefined as { disabledAt: Date | null; updatedAt: Date } | undefined,
	};

	return Effect.gen(function* () {
		const service = yield* GodModeService;
		const result = yield* service.setUserDisabled(UserId.make("user_1"), false);

		expect(result).toEqual({ id: UserId.make("user_1") });
		expect(authState.deleteUserSessionsCalled).toBe(false);
	}).pipe(Effect.provide(makeServiceLayer(db, false, authState)));
});

it.effect("returns a bad request when the user is not found while setting disabled state", () => {
	const { db } = makeSetUserDisabledDb({ user: null });

	return Effect.gen(function* () {
		const service = yield* GodModeService;
		const exit = yield* Effect.exit(service.setUserDisabled(UserId.make("missing"), true));
		assertExitFails(
			exit,
			new GodModeNotFound({ reason: { code: "user-not-found", userId: UserId.make("missing") } }),
		);
	}).pipe(Effect.provide(makeServiceLayer(db)));
});

it.effect("returns a db error when persisting disabled state fails", () => {
	const { db } = makeSetUserDisabledDb({ user: { id: "user_1", disabledAt: null } });
	const authState = {
		deleteUserSessionsCalled: false,
		updateAuthUserDisabledError: new Error("db down"),
	};

	return Effect.gen(function* () {
		const service = yield* GodModeService;
		const exit = yield* Effect.exit(service.setUserDisabled(UserId.make("user_1"), true));
		assertExitFails(exit, new DbError({ message: "db down" }));
	}).pipe(Effect.provide(makeServiceLayer(db, false, authState)));
});

it.effect("delegates deletion to the durable lifecycle service", () => {
	const { db } = makeSetUserDisabledDb({ user: null });
	const operation = { operationId: "operation-1" };
	const lifecycle = Layer.mock(UserLifecycleService)({
		resetUser: () => Effect.die("unused"),
		deleteUser: () => Effect.succeed(operation),
	});

	return Effect.gen(function* () {
		const service = yield* GodModeService;
		expect(yield* service.deleteUser(UserId.make("user_1"))).toEqual(operation);
	}).pipe(
		Effect.provide(
			makeServiceLayer(db, false, undefined, makeBootstrapDb(), makeAuthMock(), lifecycle),
		),
	);
});

vitestIt("creates a credential user without an account row", () => {
	const { db, auth, state } = makeProvisionUserDb();

	return Effect.runPromise(
		Effect.gen(function* () {
			const service = yield* GodModeService;
			const result = yield* service.provisionUser({
				provider: "credential",
				name: "new@example.com",
				email: "new@example.com",
			});

			expect(result.userId).toBe(state.createdUser?.["id"]);
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
	const { db, auth, state } = makeProvisionUserDb();

	return Effect.runPromise(
		Effect.gen(function* () {
			const service = yield* GodModeService;
			const result = yield* service.provisionUser({
				provider: "oidc",
				name: "oidc@example.com",
				email: "oidc@example.com",
				oidcIssuerId: "google|123",
			});

			expect(result.userId).toBe(state.createdUser?.["id"]);
			expect(state.createdAccount).toMatchObject({
				providerId: "oidc",
				userId: result.userId,
				accountId: "google|123",
			});
		}).pipe(Effect.provide(makeProvisionLayer(db, auth))),
	);
});

vitestIt("returns a bad request when provisioning a user that already exists", () => {
	const { db, auth } = makeProvisionUserDb({ existingUserId: "existing" });

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

			assertExitFails(
				exit,
				new GodModeRequestFailure({
					reason: { code: "user-already-exists", email: "exists@example.com" },
				}),
			);
		}).pipe(Effect.provide(makeProvisionLayer(db, auth))),
	);
});

vitestIt("returns a db error when user creation fails during provisioning", () => {
	const { db, auth } = makeProvisionUserDb({ createUserError: new Error("db down") });

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

			assertExitFails(exit, new DbError({ message: "db down" }));
		}).pipe(Effect.provide(makeProvisionLayer(db, auth))),
	);
});

vitestIt("returns a db error when oidc account creation fails during provisioning", () => {
	const { db, auth } = makeProvisionUserDb({ createAccountError: new Error("db down") });

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

			assertExitFails(exit, new DbError({ message: "db down" }));
		}).pipe(Effect.provide(makeProvisionLayer(db, auth))),
	);
});
