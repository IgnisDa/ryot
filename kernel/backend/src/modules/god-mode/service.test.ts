import { expect, layer } from "@effect/vitest";
import { DbError } from "@ryot-app/contract/errors";
import {
	GodModeNotFound,
	GodModeRequestFailure,
} from "@ryot-app/contract/modules/god-mode/contract";
import { UserId } from "@ryot-app/contract/schema/brands";
import { Context, Effect, Layer, Ref } from "effect";
import { describe, it as vitestIt } from "vitest";

import { RedisService } from "#lib/infrastructure/redis";
import { assertExitFails } from "#lib/test-utils/assertions";
import { makeAppConfigLayer, makeRedisService, fakeDatabaseSession } from "#lib/test-utils/effect";
import { AuthService } from "#modules/auth/service";
import { NotificationSubscriptionsService } from "#modules/automations/notification-subscriptions-service";
import { EntitiesService } from "#modules/entities/service";
import { SavedViewsService } from "#modules/saved-views/service";
import { PluginUserBootstrapDispatcher } from "#modules/user-bootstrap/plugin-dispatch";
import { classifyAuthState } from "#modules/user-lifecycle/auth-state";
import { UserLifecycleService } from "#modules/user-lifecycle/service";

import { GodModeRepository } from "./repository";
import { checkResetEligibility, GodModeService } from "./service";

type DisabledUpdate = { disabledAt: Date | null; updatedAt: Date };

class FakeGodModeAuth extends Context.Service<
	FakeGodModeAuth,
	{
		readonly sessionsDeleted: Effect.Effect<boolean>;
		readonly lastDisabledUpdate: Effect.Effect<DisabledUpdate | undefined>;
		readonly createdUser: Effect.Effect<Record<string, unknown> | null>;
		readonly createdAccount: Effect.Effect<Record<string, unknown> | null>;
	}
>()("test/FakeGodModeAuth") {}

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

const failWith = (message: string | undefined) =>
	message === undefined ? Effect.void : Effect.fail(new DbError({ message }));

const fakeAuthLayer = (errors: {
	readonly updateAuthUserDisabled?: string;
	readonly createUser?: string;
	readonly createAccount?: string;
}) =>
	Layer.effectContext(
		Effect.gen(function* () {
			const sessionsDeleted = yield* Ref.make(false);
			const lastDisabledUpdate = yield* Ref.make<DisabledUpdate | undefined>(undefined);
			const createdUser = yield* Ref.make<Record<string, unknown> | null>(null);
			const createdAccount = yield* Ref.make<Record<string, unknown> | null>(null);
			return Context.make(
				AuthService,
				Object.assign(Object.create(null), {
					currentUser: () => Effect.die("unused"),
					purgeApiKeyCaches: () => Effect.die("unused"),
					deleteUserSessions: () => Ref.set(sessionsDeleted, true),
					auth: { api: { requestPasswordReset: () => Promise.resolve(undefined) } },
					createAuthUser: (user: Record<string, unknown>) =>
						Ref.set(createdUser, user).pipe(
							Effect.andThen(failWith(errors.createUser)),
							Effect.as(user),
						),
					updateAuthUserDisabled: (_userId: UserId, input: DisabledUpdate) =>
						Ref.set(lastDisabledUpdate, input).pipe(
							Effect.andThen(failWith(errors.updateAuthUserDisabled)),
						),
					linkAuthAccount: (account: Record<string, unknown>) =>
						Ref.set(createdAccount, account).pipe(
							Effect.andThen(failWith(errors.createAccount)),
							Effect.as(account),
						),
				}),
			).pipe(
				Context.add(FakeGodModeAuth, {
					createdUser: Ref.get(createdUser),
					createdAccount: Ref.get(createdAccount),
					sessionsDeleted: Ref.get(sessionsDeleted),
					lastDisabledUpdate: Ref.get(lastDisabledUpdate),
				}),
			);
		}),
	);

const selectingDatabaseLayer = (rows: ReadonlyArray<object>) =>
	fakeDatabaseSession(
		Object.assign(Object.create(null), {
			select: () => ({
				from: () => ({
					where: () => Object.assign(Effect.succeed(rows), { limit: () => Effect.succeed(rows) }),
				}),
			}),
		}),
	);

const defaultUserLifecycleServiceLayer = Layer.mock(UserLifecycleService)({
	resetUser: () => Effect.die("unused"),
	deleteUser: () => Effect.die("unused"),
});

const godModeLayer = (options: {
	readonly rows: ReadonlyArray<object>;
	readonly disableLocalAuth?: boolean;
	readonly lifecycle?: Layer.Layer<UserLifecycleService>;
	readonly errors?: Parameters<typeof fakeAuthLayer>[0];
}) =>
	GodModeService.layer.pipe(
		Layer.provideMerge(
			Layer.mergeAll(
				GodModeRepository.layer,
				makeAppConfigLayer({ users: { disableLocalAuth: options.disableLocalAuth ?? false } }),
				fakeAuthLayer(options.errors ?? {}),
				Layer.succeed(RedisService, makeRedisMock()),
				Layer.mock(EntitiesService)({ create: () => Effect.succeed(Object.create(null)) }),
				Layer.mock(NotificationSubscriptionsService)({ ensureDefaultRules: () => Effect.void }),
				Layer.mock(SavedViewsService)({}),
				Layer.mock(PluginUserBootstrapDispatcher)({ dispatchAll: () => Effect.void }),
				options.lifecycle ?? defaultUserLifecycleServiceLayer,
			).pipe(Layer.provideMerge(selectingDatabaseLayer(options.rows))),
		),
	);

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

layer(godModeLayer({ rows: [], disableLocalAuth: true }))((test) => {
	test.effect("blocks password reset when local auth is disabled", () =>
		Effect.gen(function* () {
			const service = yield* GodModeService;
			const exit = yield* Effect.exit(service.resetUserPassword(UserId.make("user_1")));
			assertExitFails(exit, new GodModeRequestFailure({ reason: { code: "local-auth-disabled" } }));
		}),
	);
});

layer(godModeLayer({ rows: [{ id: "user_1", disabledAt: null }] }))((test) => {
	test.effect("disables an enabled user and deletes sessions", () =>
		Effect.gen(function* () {
			const service = yield* GodModeService;
			const result = yield* service.setUserDisabled(UserId.make("user_1"), true);

			const auth = yield* FakeGodModeAuth;
			const updateInput = yield* auth.lastDisabledUpdate;
			expect(result).toEqual({ id: UserId.make("user_1") });
			expect(yield* auth.sessionsDeleted).toBe(true);
			expect(updateInput?.disabledAt).toBeInstanceOf(Date);
			expect(updateInput?.updatedAt).toEqual(updateInput?.disabledAt);
		}),
	);
});

const existingDisabledAt = new Date("2024-01-02T00:00:00Z");

layer(godModeLayer({ rows: [{ id: "user_1", disabledAt: existingDisabledAt }] }))((test) => {
	test.effect("preserves an existing disabledAt when disabling an already-disabled user", () =>
		Effect.gen(function* () {
			const service = yield* GodModeService;
			const result = yield* service.setUserDisabled(UserId.make("user_1"), true);

			const auth = yield* FakeGodModeAuth;
			expect(result).toEqual({ id: UserId.make("user_1") });
			expect(yield* auth.sessionsDeleted).toBe(true);
			expect((yield* auth.lastDisabledUpdate)?.disabledAt).toBe(existingDisabledAt);
		}),
	);
});

layer(godModeLayer({ rows: [{ id: "user_1", disabledAt: new Date("2024-01-02T00:00:00Z") }] }))(
	(test) => {
		test.effect("enables a disabled user without deleting sessions", () =>
			Effect.gen(function* () {
				const service = yield* GodModeService;
				const result = yield* service.setUserDisabled(UserId.make("user_1"), false);

				const auth = yield* FakeGodModeAuth;
				expect(result).toEqual({ id: UserId.make("user_1") });
				expect(yield* auth.sessionsDeleted).toBe(false);
				expect(yield* auth.lastDisabledUpdate).toMatchObject({ disabledAt: null });
			}),
		);
	},
);

layer(godModeLayer({ rows: [{ id: "user_1", disabledAt: null }] }))((test) => {
	test.effect("enabling an already-enabled user does not delete sessions", () =>
		Effect.gen(function* () {
			const service = yield* GodModeService;
			const result = yield* service.setUserDisabled(UserId.make("user_1"), false);

			expect(result).toEqual({ id: UserId.make("user_1") });
			expect(yield* (yield* FakeGodModeAuth).sessionsDeleted).toBe(false);
		}),
	);
});

layer(godModeLayer({ rows: [] }))((test) => {
	test.effect("returns a bad request when the user is not found while setting disabled state", () =>
		Effect.gen(function* () {
			const service = yield* GodModeService;
			const exit = yield* Effect.exit(service.setUserDisabled(UserId.make("missing"), true));
			assertExitFails(
				exit,
				new GodModeNotFound({ reason: { code: "user-not-found", userId: UserId.make("missing") } }),
			);
		}),
	);
});

layer(
	godModeLayer({
		rows: [{ id: "user_1", disabledAt: null }],
		errors: { updateAuthUserDisabled: "db down" },
	}),
)((test) => {
	test.effect("returns a db error when persisting disabled state fails", () =>
		Effect.gen(function* () {
			const service = yield* GodModeService;
			const exit = yield* Effect.exit(service.setUserDisabled(UserId.make("user_1"), true));
			assertExitFails(exit, new DbError({ message: "db down" }));
		}),
	);
});

const deleteOperation = { operationId: "operation-1" };

layer(
	godModeLayer({
		rows: [],
		lifecycle: Layer.mock(UserLifecycleService)({
			resetUser: () => Effect.die("unused"),
			deleteUser: () => Effect.succeed(deleteOperation),
		}),
	}),
)((test) => {
	test.effect("delegates deletion to the durable lifecycle service", () =>
		Effect.gen(function* () {
			const service = yield* GodModeService;
			expect(yield* service.deleteUser(UserId.make("user_1"))).toEqual(deleteOperation);
		}),
	);
});

layer(godModeLayer({ rows: [] }))((test) => {
	test.effect("creates a credential user without an account row", () =>
		Effect.gen(function* () {
			const service = yield* GodModeService;
			const result = yield* service.provisionUser({
				provider: "credential",
				name: "new@example.com",
				email: "new@example.com",
			});

			const auth = yield* FakeGodModeAuth;
			const createdUser = yield* auth.createdUser;
			expect(result.userId).toBe(createdUser?.["id"]);
			expect(createdUser).toMatchObject({
				emailVerified: true,
				name: "new@example.com",
				email: "new@example.com",
			});
			expect(yield* auth.createdAccount).toBeNull();
		}),
	);
});

layer(godModeLayer({ rows: [] }))((test) => {
	test.effect("creates an oidc user with an account stub", () =>
		Effect.gen(function* () {
			const service = yield* GodModeService;
			const result = yield* service.provisionUser({
				provider: "oidc",
				name: "oidc@example.com",
				email: "oidc@example.com",
				oidcIssuerId: "google|123",
			});

			const auth = yield* FakeGodModeAuth;
			expect(result.userId).toBe((yield* auth.createdUser)?.["id"]);
			expect(yield* auth.createdAccount).toMatchObject({
				providerId: "oidc",
				userId: result.userId,
				accountId: "google|123",
			});
		}),
	);
});

layer(godModeLayer({ rows: [{ id: "existing" }] }))((test) => {
	test.effect("returns a bad request when provisioning a user that already exists", () =>
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
		}),
	);
});

layer(godModeLayer({ rows: [], errors: { createUser: "db down" } }))((test) => {
	test.effect("returns a db error when user creation fails during provisioning", () =>
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
		}),
	);
});

layer(godModeLayer({ rows: [], errors: { createAccount: "db down" } }))((test) => {
	test.effect("returns a db error when oidc account creation fails during provisioning", () =>
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
		}),
	);
});
