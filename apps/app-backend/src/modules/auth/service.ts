import { apiKey } from "@better-auth/api-key";
import { expo } from "@better-auth/expo";
import { redisStorage } from "@better-auth/redis-storage";
import {
	AdminAccess,
	AdminMiddleware,
	AuthMiddleware,
	type CachedUserPreferences,
	CurrentUser,
	defaultUserPreferences,
	normalizeUserPreferences,
} from "@ryot/contract/auth-middleware";
import {
	badRequest,
	internalError,
	rateLimited,
	unauthorized,
	unknownToDbError,
} from "@ryot/contract/errors";
import { UserId } from "@ryot/contract/schema/brands";
import { betterAuth } from "better-auth";
import { APIError, createAuthMiddleware, getSessionFromCtx } from "better-auth/api";
import { genericOAuth, twoFactor } from "better-auth/plugins";
import { eq } from "drizzle-orm";
import { Context, Effect, Layer, Option, Redacted, Result, Schema } from "effect";
import { HttpMiddleware, HttpServerError, HttpServerRequest } from "effect/unstable/http";
import type Redis from "ioredis";

import { AppConfig, type AppConfigValue, isOidcEnabled } from "#lib/infrastructure/config/service";
import * as authSchema from "#lib/infrastructure/db/schema/tables/auth";
import { Database } from "#lib/infrastructure/db/service";
import { redisKeys, RedisService } from "#lib/infrastructure/redis";

import { effectPostgresAuthAdapter } from "./effect-postgres-adapter";
import { isUserLifecycleActive, LifecycleWriteGuard } from "./lifecycle-write-guard";
import { gateSessionCreation } from "./session-gate";

const RESET_LINK_TIMEOUT_MS = 10_000;

const lifecycleProtectedAuthPaths = new Set([
	"/api-key/create",
	"/api-key/delete",
	"/api-key/update",
	"/change-email",
	"/change-password",
	"/link-social",
	"/set-password",
	"/two-factor/disable",
	"/two-factor/enable",
	"/two-factor/generate-backup-codes",
	"/unlink-account",
	"/update-user",
]);

export const isLifecycleProtectedAuthPath = (path: string) => lifecycleProtectedAuthPaths.has(path);

const parseResetLinkMessage = (message: string) => {
	const parsed = Result.try(() => JSON.parse(message));
	if (Result.isFailure(parsed)) {
		return null;
	}
	const value = parsed.success;
	if (value !== null && typeof value === "object") {
		const email = Reflect.get(value, "email");
		const resetUrl = Reflect.get(value, "resetUrl");
		if (typeof email === "string" && typeof resetUrl === "string") {
			return { email, resetUrl };
		}
	}
	return null;
};

const stripSearchAndHash = (url: string) => {
	const queryIndex = url.indexOf("?");
	const hashIndex = url.indexOf("#");

	if (queryIndex === -1) {
		return hashIndex === -1 ? url : url.slice(0, hashIndex);
	}
	if (hashIndex === -1) {
		return url.slice(0, queryIndex);
	}
	return url.slice(0, Math.min(queryIndex, hashIndex));
};

export class AuthUserBootstrap extends Context.Service<
	AuthUserBootstrap,
	{ run: (userId: string) => Effect.Effect<void, unknown> }
>()("AuthUserBootstrap") {}

const makeAuthInstance = (args: {
	readonly redis: Redis;
	readonly config: AppConfigValue;
	readonly db: Database["Service"];
	readonly runtime: Context.Context<Database | RedisService>;
	readonly bootstrapNewUser: (userId: string) => Effect.Effect<void, unknown>;
}) => {
	const corsOrigins = Option.match(args.config.server.corsOrigins, {
		onNone: () => [],
		onSome: (value) =>
			value
				.split(",")
				.map((origin) => origin.trim())
				.filter(Boolean),
	});

	const oidcEnabled = isOidcEnabled(args.config);

	const database = effectPostgresAuthAdapter({ db: args.db, context: args.runtime });
	const auth = betterAuth({
		database,
		appName: "Ryot",
		basePath: "/api/auth",
		baseURL: args.config.frontendUrl,
		account: { accountLinking: { enabled: false } },
		secondaryStorage: redisStorage({ client: args.redis }),
		secret: Redacted.value(args.config.server.adminAccessToken),
		disabledPaths: args.config.users.disableLocalAuth ? ["/sign-in/email"] : [],
		trustedOrigins: [
			"ryot://",
			args.config.frontendUrl,
			...corsOrigins,
			...(args.config.nodeEnv === "development" ? ["exp://"] : []),
		],
		user: {
			additionalFields: {
				disabledAt: { type: "date", required: false, input: false },
				bootstrapCompletedAt: { type: "date", required: false, input: false },
				preferences: { type: "json", required: true, defaultValue: defaultUserPreferences },
			},
		},
		hooks: {
			before: createAuthMiddleware((ctx) =>
				Effect.runPromiseWith(args.runtime)(
					Effect.gen(function* () {
						if (!isLifecycleProtectedAuthPath(ctx.path)) {
							return undefined;
						}
						const session = yield* Effect.promise(() =>
							getSessionFromCtx(ctx, { disableCookieCache: true }),
						);
						if (!session) {
							return undefined;
						}
						if (yield* isUserLifecycleActive(UserId.make(session.user.id))) {
							return yield* Effect.fail(
								APIError.from("FORBIDDEN", {
									code: "USER_LIFECYCLE_ACTIVE",
									message: "This user is temporarily unavailable.",
								}),
							);
						}
						return undefined;
					}),
				),
			),
		},
		emailAndPassword: {
			enabled: true,
			autoSignIn: false,
			revokeSessionsOnPasswordReset: true,
			disableSignUp: !args.config.users.allowRegistration || args.config.users.disableLocalAuth,
			sendResetPassword: ({ user, token }) =>
				Effect.runPromiseWith(args.runtime)(
					Effect.gen(function* () {
						const pendingKey = redisKeys.godModePendingReset(user.email);
						const correlationId = yield* Effect.tryPromise(() => args.redis.get(pendingKey));
						if (!correlationId) {
							return;
						}
						const resetUrl = `${args.config.frontendUrl}/reset-password?token=${token}`;
						const channel = redisKeys.godModeResetChannel(correlationId);
						const message = yield* Schema.encodeUnknownEffect(
							Schema.fromJsonString(Schema.Unknown),
						)({
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
						Effect.catchCause((cause) =>
							Effect.logError("reset password delivery failed", cause).pipe(
								Effect.annotateLogs({ email: user.email }),
							),
						),
					),
				),
		},
		databaseHooks: {
			session: {
				create: {
					before: (session) =>
						Effect.runPromiseWith(args.runtime)(
							gateSessionCreation(session.userId, args.bootstrapNewUser),
						),
				},
			},
			user: {
				create: {
					after: (user) =>
						Effect.runPromiseWith(args.runtime)(
							args
								.bootstrapNewUser(user.id)
								.pipe(
									Effect.catchCause((cause) =>
										Effect.logError("user bootstrap failed", cause).pipe(
											Effect.annotateLogs({ userId: user.id }),
										),
									),
								),
						),
				},
			},
		},
		plugins: [
			expo(),
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

	return auth;
};

type AuthInstance = ReturnType<typeof makeAuthInstance>;
type AuthContextValue = Awaited<AuthInstance["$context"]>;
type AuthUserRecord = Pick<
	typeof authSchema.user.$inferSelect,
	"id" | "name" | "email" | "image" | "disabledAt" | "preferences"
>;
export type AuthUserInput = {
	id: string;
	name: string;
	email: string;
	emailVerified: boolean;
	disabledAt?: Date | null;
	preferences: Record<string, unknown>;
};

const isAPIError = (
	error: unknown,
): error is { body?: { code?: string; details?: { tryAgainIn?: number } } } =>
	typeof error === "object" && error !== null && "body" in error;

export const resolveCurrentUser = (
	headers: Headers,
	getSession: (options: {
		headers: Headers;
		query: { disableCookieCache: true };
	}) => Promise<{ user: { id: string } } | null>,
	findUserById: (userId: string) => Effect.Effect<AuthUserRecord | null, unknown>,
) =>
	Effect.tryPromise({
		try: () => getSession({ headers, query: { disableCookieCache: true } }),
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
			return findUserById(session.user.id).pipe(Effect.mapError(() => unauthorized()));
		}),
		Effect.flatMap((user) => {
			if (!user || user.disabledAt) {
				return Effect.fail(unauthorized());
			}
			return Effect.succeed({
				name: user.name,
				email: user.email,
				image: user.image,
				id: UserId.make(user.id),
				preferences: normalizeUserPreferences(user.preferences),
			});
		}),
	);

export class AuthService extends Context.Service<AuthService>()("AuthService", {
	make: Effect.gen(function* () {
		const db = yield* Database;
		const config = yield* AppConfig;
		const redis = yield* RedisService;
		const userBootstrap = yield* AuthUserBootstrap;
		const runtime = yield* Effect.context<Database | RedisService>();
		const auth = makeAuthInstance({
			db,
			config,
			runtime,
			redis: redis.client,
			bootstrapNewUser: userBootstrap.run,
		});
		const withInternalAdapter = <A>(operation: (context: AuthContextValue) => Promise<A>) =>
			Effect.tryPromise({ catch: unknownToDbError, try: () => auth.$context.then(operation) });
		const requestPasswordResetLink = Effect.fn("AuthService.requestPasswordResetLink")(function* (
			email: string,
		) {
			const correlationId = crypto.randomUUID();
			const pendingKey = redisKeys.godModePendingReset(email);
			const channel = redisKeys.godModeResetChannel(correlationId);
			const stored = yield* Effect.tryPromise(() =>
				redis.client.set(pendingKey, correlationId, "EX", 60, "NX"),
			).pipe(Effect.orDie);
			if (stored !== "OK") {
				return yield* badRequest(
					"A password reset link is already being generated for this user. Please try again shortly.",
				);
			}

			const resetResult = yield* Effect.acquireUseRelease(
				Effect.sync(() => redis.client.duplicate()),
				(subscriber) =>
					Effect.callback<{ email: string; resetUrl: string }>((resume) => {
						let settled = false;
						const settle = (value: { email: string; resetUrl: string }) => {
							if (settled) {
								return;
							}
							settled = true;
							subscriber.off("message", onMessage);
							resume(Effect.succeed(value));
						};
						const onMessage = (_channel: string, message: string) => {
							if (_channel !== channel) {
								return;
							}
							const value = parseResetLinkMessage(message);
							if (value !== null) {
								settle(value);
							}
						};
						subscriber.on("message", onMessage);
						void subscriber
							.subscribe(channel)
							.then(() => auth.api.requestPasswordReset({ body: { email } }))
							.catch(() => undefined);
						return Effect.sync(() => subscriber.off("message", onMessage));
					}).pipe(
						Effect.timeoutOrElse({
							duration: RESET_LINK_TIMEOUT_MS,
							orElse: () => Effect.succeed(null),
						}),
					),
				(subscriber, _exit) =>
					Effect.all(
						[
							Effect.tryPromise(() =>
								redis.client.eval(
									"if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end",
									1,
									pendingKey,
									correlationId,
								),
							).pipe(Effect.catch(() => Effect.void)),
							Effect.tryPromise(() => subscriber.unsubscribe(channel)).pipe(
								Effect.catch(() => Effect.void),
							),
							Effect.tryPromise(() => subscriber.quit()).pipe(Effect.catch(() => Effect.void)),
						],
						{ discard: true },
					),
			);
			if (!resetResult?.resetUrl) {
				return yield* internalError("Reset link capture timed out - please try again");
			}
			return resetResult;
		});

		return {
			auth,
			requestPasswordResetLink,
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
			updateUserImage: (userId: UserId, image: string) =>
				withInternalAdapter(({ internalAdapter }) =>
					internalAdapter.updateUser(userId, { image }),
				).pipe(Effect.asVoid),
			createAuthUser: (user: AuthUserInput) =>
				withInternalAdapter(({ internalAdapter }) =>
					internalAdapter.createUser(
						{ ...user, email: user.email.toLowerCase() },
						{ method: "admin" },
					),
				),
			linkAuthAccount: (account: {
				id: string;
				userId: string;
				issuer: string;
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
				resolveCurrentUser(
					headers,
					(options) => auth.api.getSession(options),
					(userId) =>
						db
							.select({
								id: authSchema.user.id,
								name: authSchema.user.name,
								email: authSchema.user.email,
								image: authSchema.user.image,
								disabledAt: authSchema.user.disabledAt,
								preferences: authSchema.user.preferences,
							})
							.from(authSchema.user)
							.where(eq(authSchema.user.id, userId))
							.limit(1)
							.pipe(Effect.map((users) => users[0] ?? null)),
				),
		};
	}),
}) {
	static readonly layer = Layer.effect(this, this.make);
}

export const makeAuthMiddleware = (
	auth: Pick<AuthService["Service"], "currentUser">,
	lifecycle: Pick<LifecycleWriteGuard["Service"], "isActive">,
) => {
	const authenticate = <A extends { readonly status: number }, E, R>(
		httpEffect: Effect.Effect<A, E, CurrentUser | R>,
	) =>
		Effect.gen(function* () {
			const request = yield* HttpServerRequest.HttpServerRequest;
			const user = yield* auth.currentUser(new Headers(request.headers));
			if (
				request.method !== "GET" &&
				request.method !== "HEAD" &&
				request.method !== "OPTIONS" &&
				(yield* lifecycle.isActive(user.id).pipe(Effect.orDie))
			) {
				return yield* unauthorized();
			}
			const span = yield* Effect.catchNoSuchElement(Effect.currentSpan);
			const annotations = Option.isSome(span)
				? { userId: user.id, traceId: span.value.traceId }
				: { userId: user.id };
			const handler = Effect.provideService(httpEffect, CurrentUser, user);

			return yield* Effect.withLogSpan(
				Effect.flatMap(Effect.exit(handler), (exit) => {
					if (exit._tag === "Failure") {
						const [response, cause] = HttpServerError.causeResponseStripped(exit.cause);
						const logResponse = (message: unknown) => {
							if (response.status >= 500) {
								return Effect.logError(message);
							}
							if (response.status === 429) {
								return Effect.logWarning(message);
							}
							return Effect.logDebug(message);
						};
						return Effect.andThen(
							Effect.annotateLogs(
								logResponse(Option.getOrElse(cause, () => "Sent HTTP Response")),
								{
									...annotations,
									"http.method": request.method,
									"http.status": response.status,
									"http.url": stripSearchAndHash(request.url),
								},
							),
							exit,
						);
					}
					return Effect.andThen(
						Effect.annotateLogs(Effect.logDebug("Sent HTTP response"), {
							...annotations,
							"http.method": request.method,
							"http.status": exit.value.status,
							"http.url": stripSearchAndHash(request.url),
						}),
						exit,
					);
				}),
				"http.span",
			);
		}).pipe(HttpMiddleware.withLoggerDisabled);

	return authenticate;
};

export const AuthMiddlewareLive = Layer.effect(
	AuthMiddleware,
	Effect.gen(function* () {
		const auth = yield* AuthService;
		const lifecycle = yield* LifecycleWriteGuard;
		return { apiKey: makeAuthMiddleware(auth, lifecycle) };
	}),
);

export const AdminMiddlewareLive = Layer.effect(
	AdminMiddleware,
	Effect.gen(function* () {
		const config = yield* AppConfig;

		return {
			adminToken: (httpEffect, { credential }) => {
				const value = Redacted.value(credential);
				return value !== "" && value === Redacted.value(config.server.adminAccessToken)
					? Effect.provideService(httpEffect, AdminAccess, { authorized: true })
					: Effect.fail(unauthorized());
			},
		};
	}),
);
