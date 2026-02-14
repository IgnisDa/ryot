import { WorkflowEngine } from "@effect/workflow/WorkflowEngine";
import { badRequest, internalError } from "@ryot/contract/errors";
import type { ProvisionUserBody } from "@ryot/contract/modules/god-mode/contract";
import { UserId } from "@ryot/contract/schema/brands";
import { generateId } from "better-auth";
import { DateTime, Effect, Either } from "effect";

import { AppConfig } from "#lib/infrastructure/config/service";
import { DbRunner } from "#lib/infrastructure/db/service";
import { redisKeys, RedisService } from "#lib/infrastructure/redis";
import { AuthService } from "#modules/auth/service";
import { defaultUserPreferences } from "#modules/builtins/bootstrap";
import { InfrequentCronWorkflow } from "#modules/scheduler/cron-workflow";

import { GodModeRepository } from "./repository";

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
		const repository = yield* GodModeRepository;
		const engine = yield* WorkflowEngine;
		const { auth, createAuthUser, deleteUserSessions, linkAuthAccount } = yield* AuthService;

		const listUsers = Effect.fn("GodModeService.listUsers")(function* (input: {
			limit: number;
			offset: number;
			search?: string;
		}) {
			return yield* runWithDb(
				Effect.gen(function* () {
					const [total, userRows] = yield* Effect.all([
						repository.countUsers(input.search),
						repository.listUserRows(input),
					]);

					if (userRows.length === 0) {
						return { total, users: [] };
					}

					const userIds = userRows.map((u) => u.id);
					const accountRows = yield* repository.listAccountsForUsers(userIds);

					const accountsByUser = new Map<string, Array<{ providerId: string }>>();
					for (const row of accountRows) {
						const existing = accountsByUser.get(row.userId) ?? [];
						accountsByUser.set(row.userId, [...existing, { providerId: row.providerId }]);
					}

					const users = userRows.map((u) => ({
						id: u.id,
						name: u.name,
						email: u.email,
						disabledAt: u.disabledAt,
						createdAt: u.createdAt,
						twoFactorEnabled: u.twoFactorEnabled,
						authState: classifyAuthState(accountsByUser.get(u.id) ?? []),
					}));

					return { total, users };
				}),
			);
		});

		const provisionUser = Effect.fn("GodModeService.provisionUser")(function* (
			input: ProvisionUserBody,
		) {
			const existing = yield* runWithDb(repository.findUserIdByEmail(input.email));

			if (existing) {
				return yield* badRequest(`User with email '${input.email}' already exists`);
			}

			const userId = UserId.make(crypto.randomUUID());

			yield* createAuthUser({
				id: userId,
				name: input.name,
				email: input.email,
				emailVerified: true,
				preferences: defaultUserPreferences,
			});

			if (input.provider === "oidc") {
				yield* linkAuthAccount({
					userId,
					providerId: "oidc",
					id: crypto.randomUUID(),
					accountId: input.oidcIssuerId,
				});
			}

			return { userId };
		});

		const setUserDisabled = Effect.fn("GodModeService.setUserDisabled")(function* (
			userId: UserId,
			disabled: boolean,
		) {
			const user = yield* runWithDb(repository.findUserDisabledState(userId));

			if (!user) {
				return yield* badRequest(`User with id '${userId}' not found`);
			}

			const updatedAt = yield* DateTime.nowAsDate;
			const disabledAt = disabled ? (user.disabledAt ?? updatedAt) : null;

			yield* runWithDb(repository.updateUserDisabled({ userId, disabledAt, updatedAt }));

			if (disabled) {
				yield* deleteUserSessions(userId);
			}

			return { id: userId, disabledAt: disabledAt?.toISOString() ?? null };
		});

		const resetUserPassword = Effect.fn("GodModeService.resetUserPassword")(function* (
			userId: UserId,
		) {
			if (config.users.disableLocalAuth) {
				return yield* badRequest("Local authentication is disabled on this instance");
			}

			const userData = yield* runWithDb(
				Effect.gen(function* () {
					const userRow = yield* repository.findUserById(userId);
					if (!userRow) {
						return null;
					}
					const accountRows = yield* repository.listAccountsForUsers([userId]);
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
							.then(() => auth.api.requestPasswordReset({ body: { email: userData.user.email } }))
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
							Effect.tryPromise(() => subscriber.quit()).pipe(Effect.catchAll(() => Effect.void)),
						],
						{ discard: true },
					),
			);

			if (!resetResult?.resetUrl) {
				return yield* internalError("Reset link capture timed out — please try again");
			}

			return { email: resetResult.email, resetUrl: resetResult.resetUrl };
		});

		const triggerInfrequentCron = () =>
			Effect.gen(function* () {
				const executionId = `infrequent-cron-manual-${generateId()}`;
				yield* engine
					.execute(InfrequentCronWorkflow, {
						executionId,
						discard: true,
						payload: { executionId },
					})
					.pipe(Effect.orDie);
				return { executionId };
			});

		return {
			listUsers,
			setUserDisabled,
			provisionUser,
			resetUserPassword,
			triggerInfrequentCron,
		};
	}),
}) {}
