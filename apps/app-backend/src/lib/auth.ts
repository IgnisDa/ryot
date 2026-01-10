import { apiKey } from "@better-auth/api-key";
import { redisStorage } from "@better-auth/redis-storage";
import { HttpServerRequest } from "@effect/platform";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { APIError } from "better-auth/api";
import { genericOAuth, twoFactor } from "better-auth/plugins";
import { eq } from "drizzle-orm";
import { Effect, Layer, Option, Redacted, Runtime, Schema } from "effect";
import type Redis from "ioredis";

import { AdminMiddleware, AuthMiddleware } from "./auth-middleware";
import { bootstrapNewUser, defaultUserPreferences } from "./builtins/bootstrap";
import { AppConfig, type AppConfigValue, isOidcEnabled } from "./config";
import type { DbRoot, TransactionRunner } from "./db";
import { DbService } from "./db";
import * as schemaAuth from "./db/schema/auth";
import * as schemaRelations from "./db/schema/relations";
import * as schemaTables from "./db/schema/tables";
import { rateLimited, unauthorized } from "./errors";
import { redisKeys, RedisService } from "./redis";

const schema = { ...schemaAuth, ...schemaTables, ...schemaRelations };

const makeAuthInstance = (args: {
	readonly db: DbRoot;
	readonly redis: Redis;
	readonly config: AppConfigValue;
	readonly runtime: Runtime.Runtime<DbService | RedisService | TransactionRunner>;
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
				bannedAt: { type: "date", required: false, input: false },
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
						Effect.tapErrorCause((cause) =>
							Effect.logError("[auth] sendResetPassword failed", user.email, cause),
						),
						Effect.catchAllCause(() => Effect.void),
					),
				),
		},
		databaseHooks: {
			session: {
				create: {
					before: (session) =>
						args.db
							.select({ bannedAt: schema.user.bannedAt })
							.from(schema.user)
							.where(eq(schema.user.id, session.userId))
							.limit(1)
							.then(([foundUser]) => {
								if (foundUser?.bannedAt) {
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
							bootstrapNewUser(user.id).pipe(
								Effect.tapErrorCause((cause) =>
									Effect.logError("[auth] bootstrapNewUser failed for user", user.id, cause),
								),
								Effect.catchAllCause(() => Effect.void),
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

const isAPIError = (
	error: unknown,
): error is { body?: { code?: string; details?: { tryAgainIn?: number } } } =>
	typeof error === "object" && error !== null && "body" in error;

export class AuthService extends Effect.Service<AuthService>()("AuthService", {
	effect: Effect.gen(function* () {
		const db = yield* DbService;
		const config = yield* AppConfig;
		const redis = yield* RedisService;
		const runtime = yield* Effect.runtime<DbService | RedisService | TransactionRunner>();
		const auth = makeAuthInstance({ config, db: db.db, redis: redis.client, runtime });

		return {
			auth,
			deleteUserSessions: (userId: string) =>
				Effect.promise(() =>
					auth.$context.then((ctx) => ctx.internalAdapter.deleteUserSessions(userId)),
				).pipe(Effect.orDie),
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
					Effect.flatMap((session) =>
						session
							? session.user.bannedAt
								? Effect.fail(unauthorized())
								: Effect.succeed({
										id: session.user.id,
										name: session.user.name,
										email: session.user.email,
									})
							: Effect.fail(unauthorized()),
					),
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
