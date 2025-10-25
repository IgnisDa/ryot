import { apiKey } from "@better-auth/api-key";
import { redisStorage } from "@better-auth/redis-storage";
import { HttpApiMiddleware, HttpApiSecurity, HttpServerRequest } from "@effect/platform";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { APIError } from "better-auth/api";
import { genericOAuth, twoFactor } from "better-auth/plugins";
import { eq } from "drizzle-orm";
import { Context, Effect, Layer, Option, Redacted, Runtime, Schema } from "effect";

import { bootstrapNewUser, defaultUserPreferences } from "./builtins/bootstrap";
import { AppConfig, type AppConfigValue, isOidcEnabled } from "./config";
import { DbService, schema } from "./db";
import { rateLimited, RateLimited, unauthorized, Unauthorized } from "./errors";
import { RedisService } from "./redis";

export type CurrentUserValue = {
	readonly id: string;
	readonly name: string;
	readonly email: string;
};

export class CurrentUser extends Context.Tag("CurrentUser")<CurrentUser, CurrentUserValue>() {}

export class AdminAccess extends Context.Tag("AdminAccess")<
	AdminAccess,
	{ readonly authorized: true }
>() {}

// @effect-diagnostics-next-line leakingRequirements:off
export class AuthMiddleware extends HttpApiMiddleware.Tag<AuthMiddleware>()("AuthMiddleware", {
	provides: CurrentUser,
	failure: Schema.Union(Unauthorized, RateLimited),
	security: {
		apiKey: HttpApiSecurity.apiKey({ in: "header", key: "x-api-key" }),
		cookie: HttpApiSecurity.apiKey({ in: "cookie", key: "better-auth.session_token" }),
	},
}) {}

export class AdminMiddleware extends HttpApiMiddleware.Tag<AdminMiddleware>()("AdminMiddleware", {
	failure: Unauthorized,
	provides: AdminAccess,
	security: { adminToken: HttpApiSecurity.apiKey({ in: "header", key: "Admin-Access-Token" }) },
}) {}

const makeAuthInstance = (args: {
	readonly config: AppConfigValue;
	readonly db: DbService["Type"]["db"];
	readonly redis: RedisService["Type"]["client"];
	readonly runtime: Runtime.Runtime<DbService | RedisService>;
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
		},
		databaseHooks: {
			session: {
				create: {
					// @effect-diagnostics-next-line asyncFunction:off
					before: async (session) => {
						const [foundUser] = await args.db
							.select({ bannedAt: schema.user.bannedAt })
							.from(schema.user)
							.where(eq(schema.user.id, session.userId))
							.limit(1);
						if (foundUser?.bannedAt) {
							throw APIError.from("FORBIDDEN", {
								code: "USER_DISABLED",
								message: "This user has been disabled.",
							});
						}
					},
				},
			},
			user: {
				create: {
					// @effect-diagnostics-next-line asyncFunction:off
					after: async (user) => {
						try {
							await Runtime.runPromise(args.runtime)(bootstrapNewUser(user.id));
						} catch (error) {
							// Do not re-throw: the user row is already committed at this point.
							// Re-throwing cannot roll back user creation and only surfaces a
							// spurious failure to the caller while leaving bootstrap incomplete.
							console.error("[auth] bootstrapNewUser failed for user", user.id, error);
						}
					},
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
					enabled: process.env.NODE_ENV === "production",
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

export class AuthService extends Context.Tag("AuthService")<
	AuthService,
	{
		readonly auth: AuthInstance;
		readonly currentUser: (
			headers: Headers,
		) => Effect.Effect<CurrentUserValue, Unauthorized | RateLimited>;
	}
>() {}

const isAPIError = (
	error: unknown,
): error is { body?: { code?: string; details?: { tryAgainIn?: number } } } =>
	typeof error === "object" && error !== null && "body" in error;

export const AuthLive = Layer.effect(
	AuthService,
	Effect.gen(function* () {
		const db = yield* DbService;
		const config = yield* AppConfig;
		const redis = yield* RedisService;
		const runtime = yield* Effect.runtime<DbService | RedisService>();
		const auth = makeAuthInstance({ config, db: db.db, redis: redis.client, runtime });

		return {
			auth,
			currentUser: (headers) =>
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
);

export const AuthMiddlewareLive = Layer.effect(
	AuthMiddleware,
	Effect.gen(function* () {
		const auth = yield* AuthService;

		const resolveFromRequest = Effect.gen(function* () {
			const request = yield* HttpServerRequest.HttpServerRequest;
			return yield* auth.currentUser(new Headers(request.headers));
		});

		return {
			cookie: (token) =>
				Redacted.value(token) === "" ? Effect.fail(unauthorized()) : resolveFromRequest,
			apiKey: (token) =>
				Redacted.value(token) === "" ? Effect.fail(unauthorized()) : resolveFromRequest,
		};
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
