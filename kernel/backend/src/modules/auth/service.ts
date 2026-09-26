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
	type CachedUserPreferences,
	CurrentUser,
	DemoOperationProtected,
	defaultUserPreferences,
	normalizeUserPreferences,
	UserInitializing,
} from "@ryot-app/contract/auth-middleware";
import type { DbError } from "@ryot-app/contract/errors";
import { badRequest, internalError, unknownToDbError } from "@ryot-app/contract/errors";
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
import { betterAuth, type BetterAuthPlugin } from "better-auth";
import { APIError, createAuthMiddleware, getSessionFromCtx } from "better-auth/api";
import { verifyBearerToken } from "better-auth/oauth2";
import { genericOAuth, jwt, twoFactor } from "better-auth/plugins";
import { eq } from "drizzle-orm";
import { Cause, Context, Effect, Layer, Option, Redacted, Result, Schema } from "effect";
import { HttpServerRequest, type HttpServerResponse } from "effect/unstable/http";
import type { HttpApiEndpoint } from "effect/unstable/httpapi";
import type Redis from "ioredis";

import { AppConfig, type AppConfigValue, isOidcEnabled } from "#lib/infrastructure/config/service";
import * as authSchema from "#lib/infrastructure/db/schema/tables/auth";
import { DatabaseSession } from "#lib/infrastructure/db/session";
import { logHttpResponse } from "#lib/infrastructure/http-response-logger";
import { redisKeys, RedisService } from "#lib/infrastructure/redis";

import { demoAccessPlugin } from "./demo-access-plugin";
import { effectPostgresAuthAdapter } from "./effect-postgres-adapter";
import { LifecycleWriteGuard } from "./lifecycle-write-guard";
import { AuthRepository } from "./repository";
import { SessionCreationGate } from "./session-gate";
import { userInitializationPlugin } from "./user-initialization-plugin";

const RESET_LINK_TIMEOUT_MS = 10_000;

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
	readonly runtime: Context.Context<DatabaseSession | RedisService>;
	readonly scheduleUserBootstrap: (
		userId: string,
	) => Effect.Effect<void, AuthBootstrapScheduleError>;
	readonly lifecycle: LifecycleWriteGuard["Service"];
	readonly sessionGate: SessionCreationGate["Service"];
	readonly revokeOAuthTokens: (userId: UserId) => Effect.Effect<void, DbError>;
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
		session: {
			storeSessionInDatabase: true,
			additionalFields: {
				accessClass: { input: false, type: "string", required: true, defaultValue: "standard" },
			},
		},
		user: {
			additionalFields: {
				disabledAt: { type: "date", input: false, required: false },
				bootstrapCompletedAt: { type: "date", input: false, required: false },
				preferences: { type: "json", required: true, defaultValue: defaultUserPreferences },
			},
		},
		databaseHooks: {
			session: {
				create: {
					before: (session, context) =>
						database.runInCurrentContext(context, args.sessionGate.gate(session.userId)),
				},
			},
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
		},
		plugins: [
			jwt(),
			demoAccessPlugin(Option.getOrNull(args.config.users.demoAccountId)),
			userInitializationPlugin(),
			makeOAuthProviderPlugin(args.config.frontendUrl, requiresUserInitialization),
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
		emailAndPassword: {
			enabled: true,
			autoSignIn: true,
			revokeSessionsOnPasswordReset: true,
			disableSignUp: !args.config.users.allowRegistration || args.config.users.disableLocalAuth,
			onPasswordReset: ({ user }) =>
				Effect.runPromiseWith(args.runtime)(args.revokeOAuthTokens(UserId.make(user.id))),
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
						)({ resetUrl, email: user.email });
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
						Effect.catchCauseIf(
							(cause) => !Cause.hasInterruptsOnly(cause),
							(cause) =>
								Effect.logError("reset password delivery failed", cause).pipe(
									Effect.annotateLogs({ email: user.email }),
								),
						),
					),
				),
		},
		hooks: {
			before: createAuthMiddleware((ctx) =>
				Effect.runPromiseWith(args.runtime)(
					Effect.gen(function* () {
						const needsSession =
							demoProtectedAuthPaths.has(ctx.path) ||
							ctx.path === "/oauth2/authorize" ||
							ctx.path === "/oauth2/continue";
						if (!needsSession) {
							return undefined;
						}
						const session = yield* Effect.promise(() =>
							getSessionFromCtx(ctx, { disableCookieCache: true }),
						);
						if (!session) {
							return undefined;
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
	"id" | "name" | "email" | "image" | "disabledAt" | "bootstrapCompletedAt" | "preferences"
>;
export type AuthUserInput = {
	id: string;
	name: string;
	email: string;
	emailVerified: boolean;
	disabledAt?: Date | null;
	preferences: Record<string, unknown>;
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
			Schema.decodeUnknownEffect(Schema.Struct({ sub: Schema.String, client_id: Schema.String })),
		),
		Effect.mapError(authenticationRequired),
		Effect.map(({ sub, client_id }) => ({
			userId: sub,
			credential: { kind: "oauth", clientId: client_id },
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
		let accessClass: AccessClass = "standard";
		if (
			verified.credential.kind === "oauth" &&
			(verified.credential.clientId === OAUTH_DEMO_WEB_CLIENT_ID ||
				(verified.credential.clientId !== OAUTH_WEB_CLIENT_ID &&
					verified.credential.clientId !== OAUTH_NATIVE_CLIENT_ID &&
					user.id === demoAccountId))
		) {
			accessClass = "demo";
		} else if (verified.credential.kind === "api-key" && user.id === demoAccountId) {
			accessClass = "demo";
		}
		return {
			authorization: { accessClass, userId: user.id, credential: verified.credential },
			user: {
				name: user.name,
				email: user.email,
				image: user.image,
				id: UserId.make(user.id),
				preferences: normalizeUserPreferences(user.preferences),
			},
		};
	});

export class AuthService extends Context.Service<AuthService>()("AuthService", {
	make: Effect.gen(function* () {
		const session = yield* DatabaseSession;
		const config = yield* AppConfig;
		const redis = yield* RedisService;
		const repository = yield* AuthRepository;
		const userBootstrap = yield* AuthUserBootstrapScheduler;
		const lifecycle = yield* LifecycleWriteGuard;
		const sessionGate = yield* SessionCreationGate;
		const runtime = yield* Effect.context<DatabaseSession | RedisService>();
		const auth = makeAuthInstance({
			config,
			session,
			runtime,
			lifecycle,
			sessionGate,
			redis: redis.client,
			scheduleUserBootstrap: userBootstrap.schedule,
			revokeOAuthTokens: repository.revokeUserOAuthTokens,
		});
		const findUserById = (userId: string) =>
			session.run((db) =>
				db
					.select({
						id: authSchema.user.id,
						name: authSchema.user.name,
						email: authSchema.user.email,
						image: authSchema.user.image,
						disabledAt: authSchema.user.disabledAt,
						preferences: authSchema.user.preferences,
						bootstrapCompletedAt: authSchema.user.bootstrapCompletedAt,
					})
					.from(authSchema.user)
					.where(eq(authSchema.user.id, userId))
					.limit(1)
					.pipe(Effect.map((users) => users[0] ?? null)),
			);
		const authenticate = (credential: CredentialInput) =>
			resolveCredential(
				credential,
				(token) => verifyBearerToken(token, getOAuthVerificationOptions(config.frontendUrl)),
				(key) => withoutAsyncContext(() => auth.api.verifyApiKey({ body: { key } })),
				findUserById,
				Option.getOrNull(config.users.demoAccountId),
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
						Effect.runForkWith(runtime)(
							Effect.tryPromise(() => subscriber.subscribe(channel)).pipe(
								Effect.andThen(
									Effect.tryPromise(() =>
										withoutAsyncContext(() => auth.api.requestPasswordReset({ body: { email } })),
									),
								),
								Effect.ignore,
							),
						);
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
			requestPasswordResetLink,
			apiKeyUser: (key: string) => authenticate({ key, kind: "api-key" }),
			oauthUser: (token: string) => authenticate({ token, kind: "oauth" }),
			handler: (request: Request) => withoutAsyncContext(() => auth.handler(request)),
			revokeUserOAuthTokens: (userId: UserId) =>
				repository.revokeUserOAuthTokens(userId).pipe(Effect.orDie),
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
			// Keep the hosted login session copies in secondary storage current.
			updateUserPreferences: (userId: UserId, preferences: CachedUserPreferences) =>
				withInternalAdapter(({ internalAdapter }) =>
					internalAdapter.updateUser(userId, { preferences }),
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
			currentUser: (headers: Headers) => {
				const credential = credentialFromHeaders(headers);
				return credential
					? authenticate(credential).pipe(Effect.map(({ user }) => user))
					: Effect.fail(authenticationRequired());
			},
			// The api-key plugin caches keys in secondary storage but has no admin/server-side API to
			// invalidate another user's keys (deletion only works through the owning user's session), so
			// we purge the cache directly via Better Auth's secondaryStorage (its wrapper adds the
			// `better-auth:` prefix). The `api-key:*` shapes mirror the plugin's internal
			// getStorageKeyBy* helpers and are pinned to @better-auth/api-key.
			// TODO: drop this once upstream ships admin-managed api-key deletion.
			// https://github.com/better-auth/better-auth/discussions/7907
			purgeApiKeyCaches: (userId: UserId, apiKeys: ReadonlyArray<{ id: string; key: string }>) =>
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
				),
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

export const AdminMiddlewareLive = Layer.effect(
	AdminMiddleware,
	Effect.gen(function* () {
		const config = yield* AppConfig;

		return {
			adminToken: (httpEffect, { credential }) => {
				const value = Redacted.value(credential);
				return value !== "" && value === Redacted.value(config.server.adminAccessToken)
					? Effect.provideService(httpEffect, AdminAccess, { authorized: true })
					: Effect.fail(new AuthUnauthorized({ reason: { code: "admin-access-required" } }));
			},
		};
	}),
);
