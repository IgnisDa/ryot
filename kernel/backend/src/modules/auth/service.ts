import { AsyncLocalStorage } from "node:async_hooks";

import { apiKey } from "@better-auth/api-key";
import { createOAuthAccountIssuer } from "@better-auth/core/db";
import { oauthProvider } from "@better-auth/oauth-provider";
import { redisStorage } from "@better-auth/redis-storage";
import {
	AdminAccess,
	AdminMiddleware,
	AuthRateLimited,
	AuthMiddleware,
	AuthUnauthorized,
	AuthorizationContext,
	CurrentUser,
	DemoOperationProtected,
	UserInitializing,
} from "@ryot-app/contract/auth-middleware";
import { DbError, unknownToDbError } from "@ryot-app/contract/errors";
import { DemoAccessPolicy } from "@ryot-app/contract/http-annotations";
import {
	type AccessClass,
	getOAuthEndpoint,
	getOAuthIssuer,
	getOAuthResource,
	OAUTH_API_SCOPE,
	OAUTH_DEMO_WEB_CLIENT_ID,
	OAUTH_LOGIN_PATH,
	OAUTH_NATIVE_CLIENT_ID,
	OAUTH_SCOPES,
	OAUTH_WEB_CLIENT_ID,
	type AuthorizationContext as AuthorizationContextValue,
} from "@ryot-app/contract/oauth";
import { UserId } from "@ryot-app/contract/schema/brands";
import {
	UserPreferences,
	type UserPreferencesPatch,
} from "@ryot-app/contract/schema/user-preferences";
import { createSha256Hasher } from "@ryot-app/ts-utils/crypto";
import { betterAuth, type BetterAuthPlugin } from "better-auth";
import { APIError, createAuthMiddleware, getSessionFromCtx } from "better-auth/api";
import { verifyBearerToken } from "better-auth/oauth2";
import { genericOAuth, jwt, twoFactor } from "better-auth/plugins";
import { eq } from "drizzle-orm";
import { Cause, Context, Effect, Layer, Option, Redacted, Schema } from "effect";
import { HttpServerRequest, type HttpServerResponse } from "effect/unstable/http";
import type { HttpApiEndpoint } from "effect/unstable/httpapi";
import type Redis from "ioredis";

import { AppConfig, type AppConfigValue, isOidcEnabled } from "#lib/infrastructure/config/service";
import * as authSchema from "#lib/infrastructure/db/schema/tables/auth";
import { DatabaseSession } from "#lib/infrastructure/db/session";
import { logHttpResponse } from "#lib/infrastructure/http-response-logger";
import { ImpersonationEndedMessage, redisKeys, RedisService } from "#lib/infrastructure/redis";

import { demoAccessPlugin } from "./demo-access-plugin";
import { effectPostgresAuthAdapter } from "./effect-postgres-adapter";
import { ImpersonationHandoffs } from "./impersonation-handoffs";
import { impersonationOAuthExtension, isImpersonationClient } from "./impersonation-oauth";
import { impersonationPlugin } from "./impersonation-plugin";
import { ImpersonationSessions } from "./impersonation-sessions";
import { LifecycleWriteGuard } from "./lifecycle-write-guard";
import { AuthRepository } from "./repository";
import { captureResetLink, deliverResetLink, type ResetCaptureTransport } from "./reset-capture";
import { SessionCreationGate } from "./session-gate";
import { userInitializationPlugin } from "./user-initialization-plugin";

const RESET_LINK_TIMEOUT_MS = 10_000;
const RESET_PASSWORD_TOKEN_TTL_SECONDS = 30 * 60;

const TrackedResetReply = Schema.Union([Schema.Literals([0, 1]), Schema.String]);

// Better Auth reads its current adapter from AsyncLocalStorage, and Effect resumes a fiber in the
// async context that woke it, so a store set during one request's Better Auth transaction reaches
// fibers of unrelated requests. Captured before any store exists, this starts every call into
// Better Auth with empty stores.
// TODO: https://github.com/Effect-TS/effect/issues/8581 — once an Effect release resumes woken
// fibers in their own async context, upgrade `effect`, delete `withoutAsyncContext` and the
// `node:async_hooks` import, and call `auth.api.verifyApiKey`, `auth.api.requestPasswordReset`,
// `operation(context)` in `withInternalAdapter`, and `auth.handler` directly.
const withoutAsyncContext = AsyncLocalStorage.snapshot();

const lifecycleProtectedAuthPaths = new Set([
	"/api-key/create",
	"/api-key/delete",
	"/api-key/update",
	"/change-email",
	"/change-password",
	"/delete-user",
	"/link-social",
	"/set-password",
	"/revoke-other-sessions",
	"/revoke-session",
	"/revoke-sessions",
	"/two-factor/disable",
	"/two-factor/enable",
	"/two-factor/generate-backup-codes",
	"/unlink-account",
	"/update-session",
	"/update-user",
]);

export const isLifecycleProtectedAuthPath = (path: string) => lifecycleProtectedAuthPaths.has(path);

const demoProtectedAuthPaths = new Set([
	...lifecycleProtectedAuthPaths,
	"/account-info",
	"/api-key/get",
	"/api-key/list",
	"/get-access-token",
	"/list-accounts",
	"/list-sessions",
	"/refresh-token",
	"/two-factor/get-totp-uri",
	"/two-factor/verify-totp",
]);

export const isDemoProtectedAuthRequest = (path: string, accessClass: unknown, clientId?: string) =>
	accessClass === "demo" &&
	(demoProtectedAuthPaths.has(path) ||
		(path === "/oauth2/authorize" &&
			typeof clientId === "string" &&
			clientId !== OAUTH_DEMO_WEB_CLIENT_ID));

const requestClientId = (ctx: {
	readonly query?: unknown;
	readonly body?: unknown;
	readonly request?: Request | undefined;
}) => {
	for (const value of [ctx.query, ctx.body]) {
		if (value !== null && typeof value === "object") {
			const clientId = Reflect.get(value, "client_id");
			if (typeof clientId === "string") {
				return clientId;
			}
		}
	}
	return ctx.request
		? (new URL(ctx.request.url).searchParams.get("client_id") ?? undefined)
		: undefined;
};

const makeResetCaptureTransport = (redis: Redis): ResetCaptureTransport => ({
	reserve: (email, id) =>
		Effect.tryPromise({
			catch: unknownToDbError,
			try: () => redis.set(redisKeys.godModePendingReset(email), id, "EX", 60, "NX"),
		}).pipe(Effect.map((value) => value === "OK")),
	release: (email, id) =>
		Effect.tryPromise({
			catch: unknownToDbError,
			try: () =>
				redis.eval(
					"if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end",
					1,
					redisKeys.godModePendingReset(email),
					id,
				),
		}),
	deliver: (email, id, message) =>
		Effect.tryPromise({
			catch: unknownToDbError,
			try: () =>
				redis.eval(
					"if redis.call('get', KEYS[1]) == ARGV[1] then redis.call('publish', ARGV[2], ARGV[3]); return redis.call('del', KEYS[1]) else return 0 end",
					1,
					redisKeys.godModePendingReset(email),
					id,
					redisKeys.godModeResetChannel(id),
					message,
				),
		}),
	track: (email, id, userId, token) =>
		Effect.tryPromise({
			catch: unknownToDbError,
			try: () =>
				redis.eval(
					"if redis.call('get', KEYS[1]) ~= ARGV[1] then return 0 end; local previous = redis.call('set', KEYS[2], ARGV[2], 'EX', ARGV[3], 'GET'); if previous then return previous end; return 1",
					2,
					redisKeys.godModePendingReset(email),
					redisKeys.passwordResetToken(userId),
					id,
					token,
					String(RESET_PASSWORD_TOKEN_TTL_SECONDS),
				),
		}).pipe(
			Effect.flatMap((reply) =>
				Schema.decodeUnknownEffect(TrackedResetReply)(reply).pipe(
					Effect.mapError(unknownToDbError),
				),
			),
			Effect.map((reply) => ({
				tracked: reply !== 0,
				previous: typeof reply === "string" ? reply : null,
			})),
		),
	subscriber: () => {
		const subscriber = redis.duplicate();
		let onMessage: ((channel: string, message: string) => void) | undefined;
		let activeId = "";
		return {
			quit: () => Effect.tryPromise({ catch: unknownToDbError, try: () => subscriber.quit() }),
			offMessage: () => {
				if (onMessage) {
					subscriber.off("message", onMessage);
				}
			},
			unsubscribe: (id) =>
				Effect.tryPromise({
					catch: unknownToDbError,
					try: () => subscriber.unsubscribe(redisKeys.godModeResetChannel(id)),
				}),
			subscribe: (id) => {
				activeId = id;
				return Effect.tryPromise({
					catch: unknownToDbError,
					try: () => subscriber.subscribe(redisKeys.godModeResetChannel(id)),
				});
			},
			onMessage: (listener) => {
				onMessage = (channel, message) =>
					listener(
						channel === redisKeys.godModeResetChannel(activeId) ? activeId : channel,
						message,
					);
				subscriber.on("message", onMessage);
			},
		};
	},
});

export class AuthUserBootstrapScheduler extends Context.Service<
	AuthUserBootstrapScheduler,
	{ schedule: (userId: string) => Effect.Effect<void, AuthBootstrapScheduleError> }
>()("AuthUserBootstrapScheduler") {}

export class AuthBootstrapScheduleError extends Schema.TaggedError<AuthBootstrapScheduleError>()(
	"AuthBootstrapScheduleError",
	{ message: Schema.String },
) {}

const makeOAuthProviderPlugin = (
	frontendUrl: string,
	requiresUserInitialization: (userId: string) => Promise<boolean>,
	impersonationSessions: ImpersonationSessions["Service"],
) => {
	const { endpoints, ...plugin } = oauthProvider({
		disableJwtPlugin: false,
		scopes: [...OAUTH_SCOPES],
		loginPage: OAUTH_LOGIN_PATH,
		consentPage: "/oauth/consent",
		clientPrivileges: () => false,
		enforcePerClientResources: true,
		allowDynamicClientRegistration: false,
		resources: [getOAuthResource(frontendUrl)],
		allowUnauthenticatedClientRegistration: false,
		grantTypes: ["authorization_code", "refresh_token"],
		extensions: [impersonationOAuthExtension(impersonationSessions)],
		postLogin: {
			page: "/oauth/initializing",
			consentReferenceId: () => undefined,
			shouldRedirect: ({ user }) => requiresUserInitialization(user.id),
		},
	});
	const compatiblePlugin: BetterAuthPlugin = plugin;
	Object.assign(compatiblePlugin, { endpoints });
	return compatiblePlugin;
};

const makeAuthInstance = (args: {
	readonly redis: Redis;
	readonly config: AppConfigValue;
	readonly session: DatabaseSession["Service"];
	readonly resetTransport: ResetCaptureTransport;
	readonly repository: AuthRepository["Service"];
	readonly lifecycle: LifecycleWriteGuard["Service"];
	readonly handoffs: ImpersonationHandoffs["Service"];
	readonly sessionGate: SessionCreationGate["Service"];
	readonly impersonationSessions: ImpersonationSessions["Service"];
	readonly runtime: Context.Context<DatabaseSession | RedisService>;
	readonly revokeResetToken: (token: string) => Effect.Effect<void, DbError>;
	readonly revokePasswordResetAccess: (userId: UserId) => Effect.Effect<void, DbError>;
	readonly scheduleUserBootstrap: (
		userId: string,
	) => Effect.Effect<void, AuthBootstrapScheduleError>;
}) => {
	const oidcEnabled = isOidcEnabled(args.config);

	const database = effectPostgresAuthAdapter({ session: args.session, context: args.runtime });
	const requiresUserInitialization = (userId: string) =>
		Effect.runPromiseWith(args.runtime)(
			args.session.run((db) =>
				db
					.select({ bootstrapCompletedAt: authSchema.user.bootstrapCompletedAt })
					.from(authSchema.user)
					.where(eq(authSchema.user.id, userId))
					.limit(1)
					.pipe(Effect.map((users) => !users[0]?.bootstrapCompletedAt)),
			),
		);
	const auth = betterAuth({
		appName: "Ryot",
		basePath: "/api/auth",
		database: database.adapter,
		baseURL: args.config.frontendUrl,
		advanced: { disableCSRFCheck: false },
		trustedOrigins: [args.config.frontendUrl],
		account: { accountLinking: { enabled: false } },
		secondaryStorage: redisStorage({ client: args.redis }),
		secret: Redacted.value(args.config.server.adminAccessToken),
		disabledPaths: args.config.users.disableLocalAuth ? ["/sign-in/email"] : [],
		user: {
			additionalFields: {
				disabledAt: { type: "date", input: false, required: false },
				bootstrapCompletedAt: { type: "date", input: false, required: false },
			},
		},
		session: {
			storeSessionInDatabase: true,
			additionalFields: {
				impersonationExpiresAt: { input: false, type: "date", required: false },
				accessClass: { input: false, type: "string", required: true, defaultValue: "standard" },
			},
		},
		emailAndPassword: {
			enabled: true,
			autoSignIn: true,
			revokeSessionsOnPasswordReset: true,
			resetPasswordTokenExpiresIn: RESET_PASSWORD_TOKEN_TTL_SECONDS,
			disableSignUp: !args.config.users.allowRegistration || args.config.users.disableLocalAuth,
			onPasswordReset: ({ user }) =>
				Effect.runPromiseWith(args.runtime)(args.revokePasswordResetAccess(UserId.make(user.id))),
			sendResetPassword: ({ user, token }, request) =>
				Effect.runPromiseWith(args.runtime)(
					deliverResetLink({
						token,
						request,
						userId: user.id,
						email: user.email,
						transport: args.resetTransport,
						revokeToken: args.revokeResetToken,
						frontendUrl: args.config.frontendUrl,
					}).pipe(
						Effect.catchCauseIf(
							(cause) => !Cause.hasInterruptsOnly(cause),
							() =>
								Effect.logError("reset password delivery failed").pipe(
									Effect.annotateLogs({ email: user.email }),
								),
						),
					),
				),
		},
		plugins: [
			jwt(),
			demoAccessPlugin(Option.getOrNull(args.config.users.demoAccountId)),
			impersonationPlugin(args.handoffs),
			userInitializationPlugin(),
			makeOAuthProviderPlugin(
				args.config.frontendUrl,
				requiresUserInitialization,
				args.impersonationSessions,
			),
			twoFactor({ allowPasswordless: true }),
			apiKey({
				fallbackToDatabase: true,
				storage: "secondary-storage",
				enableSessionForAPIKeys: false,
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
									accountIssuer: createOAuthAccountIssuer("oidc"),
									disableSignUp: !args.config.users.allowRegistration,
									clientId: Option.getOrElse(args.config.server.oidc.clientId, () => ""),
									clientSecret: Redacted.value(
										Option.getOrElse(args.config.server.oidc.clientSecret, () => Redacted.make("")),
									),
									discoveryUrl: `${Option.getOrElse(args.config.server.oidc.issuerUrl, () => "").replace(/\/$/, "")}/.well-known/openid-configuration`,
								},
							],
						}),
					]
				: []),
		],
		databaseHooks: {
			user: {
				create: {
					after: (user) =>
						Effect.runPromiseWith(args.runtime)(
							args
								.scheduleUserBootstrap(user.id)
								.pipe(
									Effect.catchCause((cause) =>
										Effect.logError("user bootstrap scheduling failed", cause).pipe(
											Effect.annotateLogs({ userId: user.id }),
										),
									),
								),
						),
				},
			},
			session: {
				create: {
					before: (session, context) =>
						database.runInCurrentContext(context, args.sessionGate.gate(session.userId)),
				},
				update: {
					before: (update, context) => {
						const current = context?.context.session?.session;
						const deadline = current ? Reflect.get(current, "impersonationExpiresAt") : undefined;
						if (!(deadline instanceof Date)) {
							return Promise.resolve({ data: update });
						}
						const requested =
							update.expiresAt instanceof Date ? update.expiresAt.getTime() : deadline.getTime();
						return Promise.resolve({
							data: { ...update, expiresAt: new Date(Math.min(requested, deadline.getTime())) },
						});
					},
				},
				delete: {
					before: (session, context) =>
						database.runInCurrentContext(
							context,
							Effect.gen(function* () {
								if (!Reflect.get(session, "impersonationExpiresAt")) {
									return;
								}
								yield* args.repository.revokeSessionOAuthTokens(session.id);
							}),
						),
					after: (session) =>
						Effect.runPromiseWith(args.runtime)(
							Effect.gen(function* () {
								if (!Reflect.get(session, "impersonationExpiresAt")) {
									return;
								}
								const message = yield* Schema.encodeEffect(ImpersonationEndedMessage)({
									sessionId: session.id,
								});
								yield* Effect.tryPromise(() =>
									args.redis.publish(redisKeys.impersonationEndedChannel, message),
								);
							}),
						),
				},
			},
		},
		hooks: {
			before: createAuthMiddleware((ctx) =>
				Effect.runPromiseWith(args.runtime)(
					Effect.gen(function* () {
						const needsSession =
							demoProtectedAuthPaths.has(ctx.path) ||
							ctx.path === "/oauth2/authorize" ||
							ctx.path === "/oauth2/continue" ||
							ctx.path === "/get-session" ||
							ctx.path === "/initialization-status";
						if (!needsSession) {
							return undefined;
						}
						const session = yield* Effect.promise(() =>
							getSessionFromCtx(ctx, { disableRefresh: true, disableCookieCache: true }),
						);
						if (!session) {
							if (
								isImpersonationClient(requestClientId(ctx) ?? "") &&
								ctx.path === "/oauth2/authorize"
							) {
								return yield* Effect.fail(
									APIError.from("FORBIDDEN", {
										code: "IMPERSONATION_REQUIRED",
										message: "An impersonation session is required.",
									}),
								);
							}
							return undefined;
						}
						const marked =
							Reflect.get(session.session, "impersonationExpiresAt") !== null &&
							Reflect.get(session.session, "impersonationExpiresAt") !== undefined;
						if (
							marked &&
							!(yield* args.impersonationSessions.getActive(session.session.id, session.user.id))
						) {
							return yield* Effect.fail(
								APIError.from("UNAUTHORIZED", {
									code: "IMPERSONATION_ENDED",
									message: "The impersonation session has ended.",
								}),
							);
						}
						if (
							ctx.path === "/oauth2/authorize" &&
							marked !== isImpersonationClient(requestClientId(ctx) ?? "")
						) {
							return yield* Effect.fail(
								APIError.from("FORBIDDEN", {
									code: "IMPERSONATION_CLIENT_MISMATCH",
									message: "This session cannot authorize the requested client.",
								}),
							);
						}
						if (
							isDemoProtectedAuthRequest(
								ctx.path,
								Reflect.get(session.session, "accessClass"),
								requestClientId(ctx),
							)
						) {
							return yield* Effect.fail(
								APIError.from("FORBIDDEN", {
									code: "DEMO_OPERATION_PROTECTED",
									message: "This operation is unavailable while using the shared demo account.",
								}),
							);
						}
						const currentUser =
							ctx.path === "/oauth2/continue"
								? yield* Effect.promise(() =>
										ctx.context.internalAdapter.findUserById(session.user.id),
									)
								: null;
						if (
							ctx.path === "/oauth2/continue" &&
							(!currentUser || !Reflect.get(currentUser, "bootstrapCompletedAt"))
						) {
							return yield* Effect.fail(
								APIError.from("SERVICE_UNAVAILABLE", {
									code: "USER_INITIALIZING",
									message: "Account initialization is still in progress.",
								}),
							);
						}
						if (!isLifecycleProtectedAuthPath(ctx.path)) {
							return undefined;
						}
						if (yield* args.lifecycle.isActive(UserId.make(session.user.id))) {
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
	});

	return auth;
};

type AuthInstance = ReturnType<typeof makeAuthInstance>;
type AuthContextValue = Awaited<AuthInstance["$context"]>;
type AuthUserRecord = Pick<
	typeof authSchema.user.$inferSelect,
	| "id"
	| "name"
	| "email"
	| "image"
	| "disabledAt"
	| "bootstrapCompletedAt"
	| "preferences"
	| "accountGeneration"
>;
export type AuthUserInput = {
	id: string;
	name: string;
	email: string;
	emailVerified: boolean;
	disabledAt?: Date | null;
};

const authenticationRequired = () =>
	new AuthUnauthorized({ reason: { code: "authentication-required" } });

export type ResolvedCredential = {
	readonly user: CurrentUser["Service"];
	readonly authorization: AuthorizationContextValue;
};

type CredentialInput =
	| { readonly kind: "oauth"; readonly token: string }
	| { readonly kind: "api-key"; readonly key: string };

export const credentialFromHeaders = (headers: Headers): CredentialInput | null => {
	const authorization = headers.get("authorization");
	if (authorization?.startsWith("Bearer ") && authorization.length > "Bearer ".length) {
		return { kind: "oauth", token: authorization.slice("Bearer ".length) };
	}
	const key = headers.get("x-api-key");
	return key ? { key, kind: "api-key" } : null;
};

type ApiKeyVerification = {
	readonly valid: boolean;
	readonly error: unknown;
	readonly key: { readonly id: string; readonly referenceId: string } | null;
};

type VerifiedCredential = Omit<AuthorizationContextValue, "accessClass">;

const rateLimitError = Schema.Struct({
	code: Schema.Literal("RATE_LIMITED"),
	details: Schema.optional(Schema.Struct({ tryAgainIn: Schema.Finite })),
});

const rateLimited = (error: unknown) => {
	const decoded = Schema.decodeUnknownOption(rateLimitError)(error);
	const tryAgainIn = Option.isSome(decoded) ? decoded.value.details?.tryAgainIn : undefined;
	return new AuthRateLimited({
		reason: {
			code: "api-key-rate-limited",
			retryAfterMs:
				typeof tryAgainIn === "number" && Number.isFinite(tryAgainIn) && tryAgainIn >= 0
					? tryAgainIn
					: null,
		},
	});
};

const resolveOAuthCredential = (
	token: string,
	verifyOAuth: (token: string) => Promise<unknown>,
): Effect.Effect<VerifiedCredential, AuthUnauthorized> =>
	Effect.tryPromise({ try: () => verifyOAuth(token), catch: authenticationRequired }).pipe(
		Effect.flatMap(
			Schema.decodeUnknownEffect(
				Schema.Struct({
					sub: Schema.String,
					client_id: Schema.String,
					sid: Schema.optional(Schema.String),
				}),
			),
		),
		Effect.mapError(authenticationRequired),
		Effect.map(({ sub, sid, client_id }) => ({
			userId: sub,
			credential: {
				kind: "oauth",
				clientId: client_id,
				...(sid === undefined ? {} : { sessionId: sid }),
			},
		})),
	);

const resolveApiKeyCredential = Effect.fn("resolveApiKeyCredential")(function* (
	key: string,
	verifyApiKey: (key: string) => Promise<ApiKeyVerification>,
): Effect.fn.Return<VerifiedCredential, AuthRateLimited | AuthUnauthorized> {
	const result = yield* Effect.tryPromise({
		try: () => verifyApiKey(key),
		catch: authenticationRequired,
	});
	if (Option.isSome(Schema.decodeUnknownOption(rateLimitError)(result.error))) {
		return yield* rateLimited(result.error);
	}
	if (!result.valid || !result.key) {
		return yield* authenticationRequired();
	}
	return { userId: result.key.referenceId, credential: { kind: "api-key", keyId: result.key.id } };
});

export const getOAuthVerificationOptions = (frontendUrl: string) => ({
	requiredScopes: [OAUTH_API_SCOPE],
	jwksUrl: getOAuthEndpoint(frontendUrl, "/api/auth/jwks"),
	verifyOptions: { issuer: getOAuthIssuer(frontendUrl), audience: getOAuthResource(frontendUrl) },
});

export const resolveCredential = <E>(
	credential: CredentialInput,
	verifyOAuth: (token: string) => Promise<unknown>,
	verifyApiKey: (key: string) => Promise<ApiKeyVerification>,
	findUserById: (userId: string) => Effect.Effect<AuthUserRecord | null, E>,
	demoAccountId: string | null = null,
	impersonationSessions?: ImpersonationSessions["Service"],
) =>
	Effect.gen(function* () {
		let verified: VerifiedCredential;
		if (credential.kind === "oauth") {
			verified = yield* resolveOAuthCredential(credential.token, verifyOAuth);
		} else {
			verified = yield* resolveApiKeyCredential(credential.key, verifyApiKey);
		}
		const user = yield* findUserById(verified.userId).pipe(Effect.mapError(authenticationRequired));
		if (!user || user.disabledAt) {
			return yield* authenticationRequired();
		}
		if (!user.bootstrapCompletedAt) {
			return yield* new UserInitializing({ reason: { code: "user-initializing" } });
		}
		const preferences = yield* Schema.decodeEffect(UserPreferences)(user.preferences).pipe(
			Effect.mapError(
				(error) => new DbError({ message: `Invalid stored user preferences: ${error.message}` }),
			),
			Effect.orDie,
		);
		let impersonation;
		if (
			verified.credential.kind === "oauth" &&
			isImpersonationClient(verified.credential.clientId)
		) {
			const sessionId = verified.credential.sessionId;
			impersonation =
				sessionId && impersonationSessions
					? yield* impersonationSessions
							.getActive(sessionId, user.id)
							.pipe(Effect.mapError(authenticationRequired))
					: null;
			if (!impersonation) {
				return yield* authenticationRequired();
			}
		}
		let accessClass: AccessClass = "standard";
		if (
			verified.credential.kind === "oauth" &&
			(verified.credential.clientId === OAUTH_DEMO_WEB_CLIENT_ID ||
				(verified.credential.clientId !== OAUTH_WEB_CLIENT_ID &&
					verified.credential.clientId !== OAUTH_NATIVE_CLIENT_ID &&
					!isImpersonationClient(verified.credential.clientId) &&
					user.id === demoAccountId))
		) {
			accessClass = "demo";
		} else if (verified.credential.kind === "api-key" && user.id === demoAccountId) {
			accessClass = "demo";
		}
		return {
			authorization: {
				accessClass,
				userId: user.id,
				credential: verified.credential,
				...(impersonation ? { impersonation } : {}),
			},
			user: {
				preferences,
				name: user.name,
				email: user.email,
				image: user.image,
				id: UserId.make(user.id),
				accountGeneration: { userId: UserId.make(user.id), token: user.accountGeneration },
			},
		};
	});

export class AuthService extends Context.Service<AuthService>()("AuthService", {
	make: Effect.gen(function* () {
		const session = yield* DatabaseSession;
		const config = yield* AppConfig;
		const redis = yield* RedisService;
		const resetTransport = makeResetCaptureTransport(redis.client);
		const repository = yield* AuthRepository;
		const userBootstrap = yield* AuthUserBootstrapScheduler;
		const lifecycle = yield* LifecycleWriteGuard;
		const sessionGate = yield* SessionCreationGate;
		const impersonationSessions = yield* ImpersonationSessions;
		const handoffs = yield* ImpersonationHandoffs;
		const runtime = yield* Effect.context<DatabaseSession | RedisService>();
		const auth = makeAuthInstance({
			config,
			session,
			runtime,
			handoffs,
			lifecycle,
			repository,
			sessionGate,
			resetTransport,
			redis: redis.client,
			impersonationSessions,
			scheduleUserBootstrap: userBootstrap.schedule,
			revokeResetToken: (token) => revokeResetToken(token),
			revokePasswordResetAccess: (userId) => revokePasswordResetAccess(userId),
		});
		const authenticate = (credential: CredentialInput) =>
			resolveCredential(
				credential,
				(token) => verifyBearerToken(token, getOAuthVerificationOptions(config.frontendUrl)),
				(key) => withoutAsyncContext(() => auth.api.verifyApiKey({ body: { key } })),
				repository.findUserById,
				Option.getOrNull(config.users.demoAccountId),
				impersonationSessions,
			);
		const withInternalAdapter = <A>(operation: (context: AuthContextValue) => Promise<A>) =>
			Effect.tryPromise({ catch: unknownToDbError, try: () => auth.$context }).pipe(
				Effect.flatMap((context) =>
					Effect.tryPromise({
						catch: unknownToDbError,
						try: () => withoutAsyncContext(() => operation(context)),
					}),
				),
			);
		// The api-key plugin caches keys in secondary storage but has no admin/server-side API to
		// invalidate another user's keys (deletion only works through the owning user's session), so
		// we purge the cache directly via Better Auth's secondaryStorage (its wrapper adds the
		// `better-auth:` prefix). The `api-key:*` shapes mirror the plugin's internal
		// getStorageKeyBy* helpers and are pinned to @better-auth/api-key.
		// TODO: drop this once upstream ships admin-managed api-key deletion.
		// https://github.com/better-auth/better-auth/discussions/7907
		const purgeApiKeyCaches = (
			userId: UserId,
			apiKeys: ReadonlyArray<{ id: string; key: string }>,
		) =>
			Effect.promise(() => auth.$context).pipe(
				Effect.flatMap((ctx) => {
					const storage = ctx.secondaryStorage;
					if (!storage) {
						return Effect.void;
					}
					return Effect.promise(() =>
						Promise.all([
							storage.delete(`api-key:by-ref:${userId}`),
							...apiKeys.flatMap((entry) => [
								storage.delete(`api-key:${entry.key}`),
								storage.delete(`api-key:by-id:${entry.id}`),
							]),
						]),
					);
				}),
			);
		const revokeResetToken = (token: string) =>
			withInternalAdapter(({ internalAdapter }) =>
				internalAdapter.deleteVerificationByIdentifier(`reset-password:${token}`),
			);
		const revokePasswordResetLinks = Effect.fn("AuthService.revokePasswordResetLinks")(function* (
			userId: UserId,
		) {
			const key = redisKeys.passwordResetToken(userId);
			const token = yield* Effect.tryPromise({
				catch: unknownToDbError,
				try: () => redis.client.get(key),
			});
			if (token === null) {
				return;
			}
			yield* revokeResetToken(token);
			yield* Effect.tryPromise({
				catch: unknownToDbError,
				try: () =>
					redis.client.eval(
						"if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end",
						1,
						key,
						token,
					),
			});
		});
		const revokePasswordResetAccess = Effect.fn("AuthService.revokePasswordResetAccess")(function* (
			userId: UserId,
		) {
			yield* repository.revokeUserOAuthTokens(userId);
			yield* purgeApiKeyCaches(userId, yield* repository.deleteUserApiKeys(userId));
			yield* revokePasswordResetLinks(userId);
		});
		const requestPasswordResetLink = Effect.fn("AuthService.requestPasswordResetLink")(function* (
			email: string,
		) {
			return yield* captureResetLink({
				email,
				transport: resetTransport,
				frontendUrl: config.frontendUrl,
				timeoutMs: RESET_LINK_TIMEOUT_MS,
				initiate: (request) => withoutAsyncContext(() => auth.handler(request)),
			});
		});

		return {
			purgeApiKeyCaches,
			requestPasswordResetLink,
			revokePasswordResetLinks,
			startUserImpersonation: handoffs.create,
			apiKeyUser: (key: string) => authenticate({ key, kind: "api-key" }),
			oauthUser: (token: string) => authenticate({ token, kind: "oauth" }),
			handler: (request: Request) => withoutAsyncContext(() => auth.handler(request)),
			revokeUserOAuthTokens: (userId: UserId) =>
				repository.revokeUserOAuthTokens(userId).pipe(Effect.orDie),
			updateUserPreferences: (userId: UserId, patch: UserPreferencesPatch) =>
				repository.patchUserPreferences(userId, patch).pipe(Effect.asVoid),
			deleteUserSessions: (userId: UserId) =>
				withInternalAdapter(({ internalAdapter }) =>
					internalAdapter.deleteUserSessions(userId),
				).pipe(Effect.orDie),
			updateUserImage: (userId: UserId, image: string) =>
				withInternalAdapter(({ internalAdapter }) =>
					internalAdapter.updateUser(userId, { image }),
				).pipe(Effect.asVoid),
			resolveRequestCredential: (headers: Headers) => {
				const credential = credentialFromHeaders(headers);
				return credential ? authenticate(credential) : Effect.fail(authenticationRequired());
			},
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
			currentUser: (headers: Headers) => {
				const credential = credentialFromHeaders(headers);
				return credential
					? authenticate(credential).pipe(Effect.map(({ user }) => user))
					: Effect.fail(authenticationRequired());
			},
		};
	}),
}) {
	static readonly layer = Layer.effect(this, this.make);
}

export const makeAuthMiddleware = (
	auth: Pick<AuthService["Service"], "apiKeyUser" | "oauthUser">,
	lifecycle: Pick<LifecycleWriteGuard["Service"], "isActive">,
) => {
	const authenticate = <E, R>(
		httpEffect: Effect.Effect<
			HttpServerResponse.HttpServerResponse,
			E,
			AuthorizationContext | CurrentUser | R
		>,
		resolved: Effect.Effect<
			ResolvedCredential,
			AuthRateLimited | AuthUnauthorized | UserInitializing,
			HttpServerRequest.HttpServerRequest
		>,
		endpoint: HttpApiEndpoint.Top,
	) =>
		Effect.gen(function* () {
			const request = yield* HttpServerRequest.HttpServerRequest;
			const { user, authorization } = yield* resolved;
			if (
				authorization.accessClass === "demo" &&
				Context.get(endpoint.annotations, DemoAccessPolicy) === "protected"
			) {
				return yield* new DemoOperationProtected({ reason: { code: "demo-operation-protected" } });
			}
			if (
				request.method !== "GET" &&
				request.method !== "HEAD" &&
				request.method !== "OPTIONS" &&
				(yield* lifecycle.isActive(user.id).pipe(Effect.orDie))
			) {
				return yield* new AuthUnauthorized({ reason: { code: "write-blocked" } });
			}
			const span = yield* Effect.catchNoSuchElement(Effect.currentSpan);
			const annotations = Option.isSome(span)
				? { userId: user.id, traceId: span.value.traceId }
				: { userId: user.id };
			const handler = httpEffect.pipe(
				Effect.provideService(CurrentUser, user),
				Effect.provideService(AuthorizationContext, authorization),
			);

			return yield* logHttpResponse(handler, endpoint.path, annotations, "Debug");
		});

	return {
		oauth: (
			httpEffect,
			{
				endpoint,
				credential,
			}: { readonly credential: Redacted.Redacted; readonly endpoint: HttpApiEndpoint.Top },
		) => authenticate(httpEffect, auth.oauthUser(Redacted.value(credential)), endpoint),
		apiKey: (
			httpEffect,
			{
				endpoint,
				credential,
			}: { readonly credential: Redacted.Redacted; readonly endpoint: HttpApiEndpoint.Top },
		) => {
			const key = Redacted.value(credential);
			const resolved = key
				? auth.apiKeyUser(key)
				: Effect.flatMap(HttpServerRequest.HttpServerRequest, (request) => {
						const requestCredential = credentialFromHeaders(new Headers(request.headers));
						return requestCredential?.kind === "oauth"
							? auth.oauthUser(requestCredential.token)
							: auth.apiKeyUser(key);
					});
			return authenticate(httpEffect, resolved, endpoint);
		},
	} satisfies AuthMiddleware["Service"];
};

export const AuthMiddlewareLive = Layer.effect(
	AuthMiddleware,
	Effect.gen(function* () {
		const auth = yield* AuthService;
		const lifecycle = yield* LifecycleWriteGuard;
		return makeAuthMiddleware(auth, lifecycle);
	}),
);

export const makeAdminMiddleware = (adminAccessToken: Redacted.Redacted) => {
	const adminTokenDigest = createSha256Hasher().update(Redacted.value(adminAccessToken)).digest();
	return {
		adminToken: (httpEffect, { credential }: { readonly credential: Redacted.Redacted }) => {
			const value = Redacted.value(credential);
			return value !== "" &&
				crypto.timingSafeEqual(createSha256Hasher().update(value).digest(), adminTokenDigest)
				? Effect.provideService(httpEffect, AdminAccess, { authorized: true })
				: Effect.fail(new AuthUnauthorized({ reason: { code: "admin-access-required" } }));
		},
	} satisfies AdminMiddleware["Service"];
};

export const AdminMiddlewareLive = Layer.effect(
	AdminMiddleware,
	Effect.gen(function* () {
		const config = yield* AppConfig;
		return makeAdminMiddleware(config.server.adminAccessToken);
	}),
);
