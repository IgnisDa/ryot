import { apiKey } from "@better-auth/api-key";
import { runWithAdapter } from "@better-auth/core/context";
import { redisStorage } from "@better-auth/redis-storage";
import { HttpServerRequest } from "@effect/platform";
import {
	AdminMiddleware,
	AuthMiddleware,
	type CachedUserPreferences,
	defaultUserPreferences,
	normalizeUserPreferences,
} from "@ryot/contract/auth-middleware";
import { rateLimited, unauthorized, unknownToDbError } from "@ryot/contract/errors";
import { UserId } from "@ryot/contract/schema/brands";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { APIError } from "better-auth/api";
import { genericOAuth, twoFactor } from "better-auth/plugins";
import { eq } from "drizzle-orm";
import { Effect, Layer, Option, Redacted, Runtime, Schema } from "effect";
import type Redis from "ioredis";

import { AppConfig, type AppConfigValue, isOidcEnabled } from "#lib/infrastructure/config/service";
import * as schemaAuth from "#lib/infrastructure/db/schema/tables/auth";
import * as schemaTables from "#lib/infrastructure/db/schema/tables/combined";
import * as schemaRelations from "#lib/infrastructure/db/schema/tables/relations";
import type { DbRoot } from "#lib/infrastructure/db/service";
import { CurrentDb, DbService, TransactionRunner } from "#lib/infrastructure/db/service";
import { redisKeys, RedisService } from "#lib/infrastructure/redis";
import { bootstrapNewUser } from "#modules/builtins/bootstrap";
import { EntitiesService } from "#modules/entities/service";
import { SavedViewsService } from "#modules/saved-views/service";
import { TrackersService } from "#modules/trackers/service";

const schema = { ...schemaAuth, ...schemaTables, ...schemaRelations };

const makeAuthInstance = (args: {
	readonly db: DbRoot;
	readonly redis: Redis;
	readonly config: AppConfigValue;
	readonly runtime: Runtime.Runtime<DbService | RedisService | TransactionRunner>;
	readonly bootstrapNewUser: (userId: string) => Effect.Effect<void, unknown>;
}) => {
	const corsOrigins = Option.match(args.config.server.corsOrigins, {
		onNone: () => [] as string[],
		onSome: (value) =>
			value
				.split(",")
				.map((origin) => origin.trim())
				.filter(Boolean),
	});

	const oidcEnabled = isOidcEnabled(args.config);

	return betterAuth({
		appName: "Ryot",
		basePath: "/api/auth",
		baseURL: args.config.frontendUrl,
		secondaryStorage: redisStorage({ client: args.redis }),
		secret: Redacted.value(args.config.server.adminAccessToken),
		trustedOrigins: ["ryot://", args.config.frontendUrl, ...corsOrigins],
		database: drizzleAdapter(args.db, { provider: "pg", schema }),
		disabledPaths: args.config.users.disableLocalAuth ? ["/sign-in/email"] : [],
		account: {
			// TEMP(9179): Expo/native OAuth state cookie round-trip fails here.
			// https://github.com/better-auth/better-auth/issues/9179
			skipStateCookieCheck: true,
			accountLinking: { enabled: false },
		},
		user: {
			additionalFields: {
				disabledAt: { type: "date", required: false, input: false },
				preferences: { type: "json", required: true, defaultValue: defaultUserPreferences },
			},
		},
		emailAndPassword: {
			enabled: true,
			autoSignIn: false,
			revokeSessionsOnPasswordReset: true,
			disableSignUp: !args.config.users.allowRegistration || args.config.users.disableLocalAuth,
			sendResetPassword: ({ user, token }) =>
				Runtime.runPromise(args.runtime)(
					Effect.gen(function* () {
						const pendingKey = redisKeys.godModePendingReset(user.email);
						const correlationId = yield* Effect.tryPromise(() => args.redis.get(pendingKey));
						if (!correlationId) {
							return;
						}
						const resetUrl = `${args.config.frontendUrl}/reset-password?token=${token}`;
						const channel = redisKeys.godModeResetChannel(correlationId);
						const message = yield* Schema.encode(Schema.parseJson(Schema.Unknown))({
							email: user.email,
							resetUrl,
						});
						yield* Effect.tryPromise(() => args.redis.publish(channel, message));
						yield* Effect.tryPromise(() =>
							args.redis.eval(
								"if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end",
								1,
								pendingKey,
								correlationId,
							),
						);
					}).pipe(
						Effect.catchAllCause((cause) =>
							Effect.logError("[auth] sendResetPassword failed", user.email, cause),
						),
					),
				),
		},
		databaseHooks: {
			session: {
				create: {
					before: (session) =>
						args.db
							.select({ disabledAt: schema.user.disabledAt })
							.from(schema.user)
							.where(eq(schema.user.id, session.userId))
							.limit(1)
							.then(([foundUser]) => {
								if (foundUser?.disabledAt) {
									throw APIError.from("FORBIDDEN", {
										code: "USER_DISABLED",
										message: "This user has been disabled.",
									});
								}
								return undefined;
							}),
				},
			},
			user: {
				create: {
					after: (user) =>
						Runtime.runPromise(args.runtime)(
							args
								.bootstrapNewUser(user.id)
								.pipe(
									Effect.catchAllCause((cause) =>
										Effect.logError("[auth] bootstrapNewUser failed for user", user.id, cause),
									),
								),
						),
				},
			},
		},
		plugins: [
			twoFactor({ allowPasswordless: true }),
			apiKey({
				fallbackToDatabase: true,
				storage: "secondary-storage",
				enableSessionForAPIKeys: true,
				// All keys will have a rate limit of 60 RPS in production
				rateLimit: {
					maxRequests: 60,
					timeWindow: 60 * 1000,
					enabled: args.config.nodeEnv === "production",
				},
			}),
			...(oidcEnabled
				? [
						genericOAuth({
							config: [
								{
									providerId: "oidc",
									scopes: ["openid", "email", "profile"],
									disableSignUp: !args.config.users.allowRegistration,
									clientId: Option.getOrElse(args.config.server.oidc.clientId, () => ""),
									discoveryUrl: `${Option.getOrElse(args.config.server.oidc.issuerUrl, () => "").replace(/\/$/, "")}/.well-known/openid-configuration`,
									clientSecret: Redacted.value(
										Option.getOrElse(args.config.server.oidc.clientSecret, () => Redacted.make("")),
									),
								},
							],
						}),
					]
				: []),
		],
	});
};

export type AuthInstance = ReturnType<typeof makeAuthInstance>;
type AuthContextValue = Awaited<AuthInstance["$context"]>;

const isAPIError = (
	error: unknown,
): error is { body?: { code?: string; details?: { tryAgainIn?: number } } } =>
	typeof error === "object" && error !== null && "body" in error;

export class AuthService extends Effect.Service<AuthService>()("AuthService", {
	effect: Effect.gen(function* () {
		const db = yield* DbService;
		const config = yield* AppConfig;
		const redis = yield* RedisService;
		const entities = yield* EntitiesService;
		const trackers = yield* TrackersService;
		const savedViews = yield* SavedViewsService;
		const runInTransaction = yield* TransactionRunner;
		const runtime = yield* Effect.runtime<DbService | RedisService | TransactionRunner>();
		const runBootstrap = (userId: string) =>
			bootstrapNewUser(userId).pipe(
				Effect.provideService(EntitiesService, entities),
				Effect.provideService(SavedViewsService, savedViews),
				Effect.provideService(TrackersService, trackers),
				Effect.provideService(TransactionRunner, runInTransaction),
			);
		const auth = makeAuthInstance({
			config,
			runtime,
			db: db.db,
			redis: redis.client,
			bootstrapNewUser: runBootstrap,
		});
		const withInternalAdapter = <A>(operation: (context: AuthContextValue) => Promise<A>) =>
			Effect.gen(function* () {
				const currentDb = yield* Effect.serviceOption(CurrentDb);
				return yield* Effect.tryPromise({
					try: () =>
						auth.$context.then((context) => {
							if (Option.isNone(currentDb)) {
								return operation(context);
							}

							const adapter = drizzleAdapter(currentDb.value, {
								provider: "pg",
								schema,
							})(context.options);
							return runWithAdapter(adapter, () => operation(context)).then((result) => result);
						}),
					catch: unknownToDbError,
				});
			});

		return {
			auth,
			deleteUserSessions: (userId: UserId) =>
				withInternalAdapter(({ internalAdapter }) =>
					internalAdapter.deleteUserSessions(userId),
				).pipe(Effect.orDie),
			// The api-key plugin caches keys in secondary storage but has no admin/server-side API to
			// invalidate another user's keys (deletion only works through the owning user's session), so
			// we purge the cache directly via Better Auth's secondaryStorage (its wrapper adds the
			// `better-auth:` prefix). The `api-key:*` shapes mirror the plugin's internal
			// getStorageKeyBy* helpers and are pinned to @better-auth/api-key.
			// TODO: drop this once upstream ships admin-managed api-key deletion.
			// https://github.com/better-auth/better-auth/discussions/7907
			purgeApiKeyCaches: (userId: UserId, apiKeys: ReadonlyArray<{ id: string; key: string }>) =>
				Effect.promise(() =>
					auth.$context.then((ctx) => {
						const storage = ctx.secondaryStorage;
						if (!storage) {
							return undefined;
						}
						return Promise.all([
							storage.delete(`api-key:by-ref:${userId}`),
							...apiKeys.flatMap((entry) => [
								storage.delete(`api-key:${entry.key}`),
								storage.delete(`api-key:by-id:${entry.id}`),
							]),
						]);
					}),
				).pipe(Effect.orDie),
			// Writing preferences through better-auth refreshes the cached session copies in secondary
			// storage, so a later getSession (and thus CurrentUserValue) reflects the new value.
			updateUserPreferences: (userId: UserId, preferences: CachedUserPreferences) =>
				withInternalAdapter(({ internalAdapter }) =>
					internalAdapter.updateUser(userId, { preferences }),
				).pipe(Effect.asVoid),
			createAuthUser: (user: {
				id: string;
				name: string;
				email: string;
				emailVerified: boolean;
				preferences: Record<string, unknown>;
			}) =>
				Effect.gen(function* () {
					const currentDb = yield* Effect.serviceOption(CurrentDb);
					if (Option.isNone(currentDb)) {
						return yield* withInternalAdapter(({ internalAdapter }) =>
							internalAdapter.createUser(user),
						);
					}

					return yield* Effect.tryPromise({
						try: () =>
							auth.$context.then((context) => {
								const adapter = drizzleAdapter(currentDb.value, {
									provider: "pg",
									schema,
								})(context.options);
								// The user-create hook starts bootstrap in another transaction. Use the
								// caller's adapter here so God Mode can bootstrap atomically below.
								return runWithAdapter(adapter, () =>
									adapter.create({
										model: "user",
										forceAllowId: true,
										data: { ...user, email: user.email.toLowerCase() },
									}),
								).then((result) => result);
							}),
						catch: unknownToDbError,
					});
				}),
			linkAuthAccount: (account: {
				id: string;
				userId: string;
				accountId: string;
				providerId: string;
			}) => withInternalAdapter(({ internalAdapter }) => internalAdapter.linkAccount(account)),
			updateAuthUserDisabled: (
				userId: UserId,
				data: { disabledAt: Date | null; updatedAt: Date },
			) =>
				withInternalAdapter(({ internalAdapter }) => internalAdapter.updateUser(userId, data)).pipe(
					Effect.asVoid,
				),
			deleteAuthUser: (userId: UserId) =>
				withInternalAdapter(({ internalAdapter }) => internalAdapter.deleteUser(userId)).pipe(
					Effect.asVoid,
				),
			currentUser: (headers: Headers) =>
				Effect.tryPromise({
					try: () => auth.api.getSession({ headers }),
					catch: (error) => {
						if (isAPIError(error) && error.body?.code === "RATE_LIMITED") {
							const tryAgainIn = error.body.details?.tryAgainIn;
							return rateLimited(`Please try again in ${tryAgainIn}ms.`);
						}
						return unauthorized();
					},
				}).pipe(
					Effect.flatMap((session) => {
						if (!session) {
							return Effect.fail(unauthorized());
						}
						if (session.user.disabledAt) {
							return Effect.fail(unauthorized());
						}
						return Effect.succeed({
							id: UserId.make(session.user.id),
							name: session.user.name,
							email: session.user.email,
							preferences: normalizeUserPreferences(session.user.preferences),
						});
					}),
				),
		};
	}),
}) {}

export const AuthMiddlewareLive = Layer.effect(
	AuthMiddleware,
	Effect.gen(function* () {
		const auth = yield* AuthService;

		const resolveFromRequest = Effect.gen(function* () {
			const request = yield* HttpServerRequest.HttpServerRequest;
			return yield* auth.currentUser(new Headers(request.headers));
		});

		const resolveWithToken = (token: Redacted.Redacted) =>
			Redacted.value(token) === "" ? Effect.fail(unauthorized()) : resolveFromRequest;

		return { cookie: resolveWithToken, apiKey: resolveWithToken };
	}),
);

export const AdminMiddlewareLive = Layer.effect(
	AdminMiddleware,
	Effect.gen(function* () {
		const config = yield* AppConfig;

		return {
			adminToken: (token) => {
				const value = Redacted.value(token);
				return value !== "" && value === Redacted.value(config.server.adminAccessToken)
					? Effect.succeed({ authorized: true as const })
					: Effect.fail(unauthorized());
			},
		};
	}),
);
