import { asc, eq, ilike, inArray, sql } from "drizzle-orm";
import { DateTime, Effect, Either } from "effect";

import { AuthService } from "#lib/auth";
import { bootstrapNewUser, defaultUserPreferences } from "#lib/builtins/bootstrap";
import { AppConfig } from "#lib/config";
import { CurrentDb, DbRunner, dbEffect, schema } from "#lib/db";
import { badRequest, internalError } from "#lib/errors";
import { redisKeys, RedisService } from "#lib/redis";

import type { ProvisionUserBody } from "./contract";

const RESET_LINK_TIMEOUT_MS = 10_000;

export const classifyAuthState = (accounts: ReadonlyArray<{ providerId: string }>) => {
	const hasCredential = accounts.some((a) => a.providerId === "credential");
	const hasOidc = accounts.some((a) => a.providerId === "oidc");
	if (hasCredential && hasOidc) {
		return "mixed" as const;
	}
	if (hasCredential) {
		return "credential" as const;
	}
	if (hasOidc) {
		return "oidc" as const;
	}
	return "none" as const;
};

export const checkResetEligibility = (authState: ReturnType<typeof classifyAuthState>) => {
	if (authState !== "credential" && authState !== "none") {
		return `Cannot generate reset link for user with auth state '${authState}'. Only 'credential' and 'none' users are eligible.`;
	}

	return null;
};

const parseResetLinkMessage = (message: string) => {
	const parsed = Either.try(() => JSON.parse(message));
	if (Either.isLeft(parsed)) {
		return null;
	}
	const value = parsed.right;
	if (value !== null && typeof value === "object") {
		const email = Reflect.get(value, "email");
		const resetUrl = Reflect.get(value, "resetUrl");
		if (typeof email === "string" && typeof resetUrl === "string") {
			return { email, resetUrl };
		}
	}
	return null;
};

export class GodModeService extends Effect.Service<GodModeService>()("GodModeService", {
	effect: Effect.gen(function* () {
		const config = yield* AppConfig;
		const redis = yield* RedisService;
		const runWithDb = yield* DbRunner;
		const { auth, deleteUserSessions } = yield* AuthService;

		return {
			listUsers: (input: { search?: string; offset: number; limit: number }) =>
				runWithDb(
					Effect.gen(function* () {
						const db = yield* CurrentDb;
						const whereCondition = input.search
							? ilike(schema.user.email, `%${input.search.trim()}%`)
							: undefined;

						const [total, userRows] = yield* Effect.all([
							dbEffect(() =>
								db
									.select({ count: sql<string>`count(*)` })
									.from(schema.user)
									.where(whereCondition),
							).pipe(Effect.map((rows) => Number(rows[0]?.count ?? 0))),
							dbEffect(() =>
								db
									.select({
										id: schema.user.id,
										name: schema.user.name,
										email: schema.user.email,
										bannedAt: schema.user.bannedAt,
										createdAt: schema.user.createdAt,
										twoFactorEnabled: schema.user.twoFactorEnabled,
									})
									.from(schema.user)
									.where(whereCondition)
									.limit(input.limit)
									.offset(input.offset)
									.orderBy(asc(schema.user.createdAt)),
							),
						]);

						if (userRows.length === 0) {
							return { total, users: [] };
						}

						const userIds = userRows.map((u) => u.id);
						const accountRows = yield* dbEffect(() =>
							db
								.select({ userId: schema.account.userId, providerId: schema.account.providerId })
								.from(schema.account)
								.where(inArray(schema.account.userId, userIds)),
						);

						const accountsByUser = new Map<string, Array<{ providerId: string }>>();
						for (const row of accountRows) {
							const existing = accountsByUser.get(row.userId) ?? [];
							accountsByUser.set(row.userId, [...existing, { providerId: row.providerId }]);
						}

						const users = userRows.map((u) => ({
							id: u.id,
							name: u.name,
							email: u.email,
							createdAt: u.createdAt.toISOString(),
							bannedAt: u.bannedAt?.toISOString() ?? null,
							twoFactorEnabled: u.twoFactorEnabled ?? null,
							authState: classifyAuthState(accountsByUser.get(u.id) ?? []),
						}));

						return { total, users };
					}),
				),

			provisionUser: (input: ProvisionUserBody) =>
				Effect.gen(function* () {
					const existing = yield* runWithDb(
						Effect.gen(function* () {
							const db = yield* CurrentDb;
							const [row] = yield* dbEffect(() =>
								db
									.select({ id: schema.user.id })
									.from(schema.user)
									.where(eq(schema.user.email, input.email))
									.limit(1),
							);
							return row ?? null;
						}),
					);

					if (existing) {
						return yield* badRequest(`User with email '${input.email}' already exists`);
					}

					const userId = crypto.randomUUID();

					yield* runWithDb(
						Effect.gen(function* () {
							const db = yield* CurrentDb;
							yield* dbEffect(() =>
								db.insert(schema.user).values({
									id: userId,
									name: input.name,
									email: input.email,
									emailVerified: true,
									preferences: defaultUserPreferences as Record<string, unknown>,
								}),
							);

							if (input.provider === "oidc") {
								yield* dbEffect(() =>
									db.insert(schema.account).values({
										userId,
										providerId: "oidc",
										id: crypto.randomUUID(),
										accountId: input.oidcIssuerId,
									}),
								);
							}
						}),
					);

					yield* bootstrapNewUser(userId).pipe(
						Effect.tapErrorCause((cause) =>
							Effect.logError("[god-mode] bootstrapNewUser failed for user", userId, cause),
						),
						Effect.catchAllCause(() => Effect.void),
					);

					return { userId };
				}),

			setUserBan: (userId: string, banned: boolean) =>
				Effect.gen(function* () {
					const user = yield* runWithDb(
						Effect.gen(function* () {
							const db = yield* CurrentDb;
							const [row] = yield* dbEffect(() =>
								db
									.select({ id: schema.user.id, bannedAt: schema.user.bannedAt })
									.from(schema.user)
									.where(eq(schema.user.id, userId))
									.limit(1),
							);
							return row ?? null;
						}),
					);

					if (!user) {
						return yield* badRequest(`User with id '${userId}' not found`);
					}

					const updatedAt = yield* DateTime.nowAsDate;
					const bannedAt = banned ? (user.bannedAt ?? updatedAt) : null;

					yield* runWithDb(
						Effect.gen(function* () {
							const db = yield* CurrentDb;
							yield* dbEffect(() =>
								db
									.update(schema.user)
									.set({ bannedAt, updatedAt })
									.where(eq(schema.user.id, userId)),
							);
						}),
					);

					if (banned) {
						yield* deleteUserSessions(userId);
					}

					return { id: userId, bannedAt: bannedAt?.toISOString() ?? null };
				}),

			resetUserPassword: (userId: string) =>
				Effect.gen(function* () {
					if (config.users.disableLocalAuth) {
						return yield* badRequest("Local authentication is disabled on this instance");
					}

					const userData = yield* runWithDb(
						Effect.gen(function* () {
							const db = yield* CurrentDb;
							const [userRow] = yield* dbEffect(() =>
								db
									.select({ id: schema.user.id, email: schema.user.email })
									.from(schema.user)
									.where(eq(schema.user.id, userId))
									.limit(1),
							);
							if (!userRow) {
								return null;
							}
							const accountRows = yield* dbEffect(() =>
								db
									.select({ providerId: schema.account.providerId })
									.from(schema.account)
									.where(eq(schema.account.userId, userId)),
							);
							return { user: userRow, accounts: accountRows };
						}),
					);

					if (!userData) {
						return yield* badRequest(`User with id '${userId}' not found`);
					}

					const authState = classifyAuthState(userData.accounts);
					const eligibilityError = checkResetEligibility(authState);
					if (eligibilityError) {
						return yield* badRequest(eligibilityError);
					}

					const correlationId = crypto.randomUUID();
					const pendingKey = redisKeys.godModePendingReset(userData.user.email);
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
							Effect.async<{ email: string; resetUrl: string } | null>((resume) => {
								let settled = false;

								const onMessage = (_channel: string, message: string) => {
									if (_channel !== channel) {
										return;
									}
									settle(parseResetLinkMessage(message));
								};

								const settle = (value: { email: string; resetUrl: string } | null) => {
									if (settled) {
										return;
									}
									settled = true;
									clearTimeout(timeout);
									subscriber.off("message", onMessage);
									resume(Effect.succeed(value));
								};

								subscriber.on("message", onMessage);
								const timeout = setTimeout(() => settle(null), RESET_LINK_TIMEOUT_MS);

								void subscriber
									.subscribe(channel)
									.then(() =>
										auth.api.requestPasswordReset({ body: { email: userData.user.email } }),
									)
									.catch(() => settle(null));

								return Effect.sync(() => {
									clearTimeout(timeout);
									subscriber.off("message", onMessage);
								});
							}),
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
									).pipe(Effect.catchAll(() => Effect.void)),
									Effect.tryPromise(() => subscriber.unsubscribe(channel)).pipe(
										Effect.catchAll(() => Effect.void),
									),
									Effect.tryPromise(() => subscriber.quit()).pipe(
										Effect.catchAll(() => Effect.void),
									),
								],
								{ discard: true },
							),
					);

					if (!resetResult?.resetUrl) {
						return yield* internalError("Reset link capture timed out — please try again");
					}

					return { email: resetResult.email, resetUrl: resetResult.resetUrl };
				}),
		};
	}),
}) {}
