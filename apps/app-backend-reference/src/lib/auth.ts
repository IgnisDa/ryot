import { redisStorage } from "@better-auth/redis-storage";
import { HttpApiMiddleware, HttpApiSecurity, HttpServerRequest } from "@effect/platform";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { Context, Effect, Layer, Redacted, Runtime } from "effect";
import type Redis from "ioredis";

import { AppConfig, type AppConfigValue } from "./config";
import { DbService, type DbRoot, schema } from "./db";
import { unauthorized, Unauthorized } from "./errors";
import { RedisService } from "./redis";

export type CurrentUserValue = {
	readonly id: string;
	readonly name: string;
	readonly email: string;
};

export class CurrentUser extends Context.Tag("CurrentUser")<CurrentUser, CurrentUserValue>() {}

// Marker context provided to handlers on admin-protected routes.
export class AdminAccess extends Context.Tag("AdminAccess")<
	AdminAccess,
	{ readonly authorized: true }
>() {}

// Supports two equivalent credential paths that both resolve to a CurrentUser:
//   1. cookie — Better Auth session cookie (browser / web clients)
//   2. apiKey — X-Api-Key request header (programmatic / API clients)
// HttpApiBuilder tries schemes in key-declaration order and uses the first that succeeds.
//
// @effect-expect-leaking HttpServerRequest ParsedSearchParams RouteContext
// These are per-request context types; HttpApiBuilder provides them automatically for each call.
export class AuthMiddleware extends HttpApiMiddleware.Tag<AuthMiddleware>()("AuthMiddleware", {
	failure: Unauthorized,
	provides: CurrentUser,
	security: {
		cookie: HttpApiSecurity.apiKey({ in: "cookie", key: "better-auth.session_token" }),
		apiKey: HttpApiSecurity.apiKey({ in: "header", key: "x-api-key" }),
	},
}) {}

// Separate middleware for god-mode/admin routes; completely independent of AuthMiddleware.
// Uses the X-Admin-Access-Token header compared against the configured shared secret.
export class AdminMiddleware extends HttpApiMiddleware.Tag<AdminMiddleware>()("AdminMiddleware", {
	failure: Unauthorized,
	provides: AdminAccess,
	security: {
		adminToken: HttpApiSecurity.apiKey({ in: "header", key: "x-admin-access-token" }),
	},
}) {}

const bootstrapNewUser = (userId: string) => Effect.logInfo("reference auth bootstrap", { userId });

const makeAuthInstance = (args: {
	readonly db: DbRoot;
	readonly redis: Redis;
	readonly runtime: Runtime.Runtime<DbService | RedisService>;
	readonly config: AppConfigValue;
}) =>
	betterAuth({
		basePath: "/api/auth",
		appName: "Ryot Effect Reference",
		baseURL: args.config.frontendUrl,
		secret: Redacted.value(args.config.server.adminAccessToken),
		secondaryStorage: redisStorage({ client: args.redis }),
		database: drizzleAdapter(args.db, { provider: "pg", schema }),
		emailAndPassword: {
			enabled: true,
			autoSignIn: false,
		},
		databaseHooks: {
			user: {
				create: {
					after: async (user) => {
						await Runtime.runPromise(args.runtime)(bootstrapNewUser(user.id));
					},
				},
			},
		},
	});

export type AuthInstance = ReturnType<typeof makeAuthInstance>;

export class AuthService extends Effect.Service<AuthService>()("AuthService", {
	effect: Effect.gen(function* () {
		const config = yield* AppConfig;
		const redis = yield* RedisService;
		const db = yield* DbService;
		const runtime = yield* Effect.runtime<DbService | RedisService>();
		const auth = makeAuthInstance({ config, db: db.db, redis: redis.client, runtime });

		return {
			auth,
			currentUser: (headers: Headers) =>
				Effect.tryPromise({
					try: () => auth.api.getSession({ headers }),
					catch: () => unauthorized(),
				}).pipe(
					Effect.flatMap((session) =>
						session
							? Effect.succeed({
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

		// Both cookie and apiKey credential paths delegate to Better Auth's getSession,
		// which transparently handles session cookies and X-Api-Key headers (via the
		// Better Auth apiKey plugin).  The early-exit on empty Redacted prevents
		// unnecessary getSession calls when the credential was absent from the request.
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
