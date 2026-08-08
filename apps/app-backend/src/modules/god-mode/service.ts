import { createOAuthAccountIssuer } from "@better-auth/core/db";
import { defaultUserPreferences } from "@ryot/contract/auth-middleware";
import { badRequest } from "@ryot/contract/errors";
import type { ProvisionUserBody } from "@ryot/contract/modules/god-mode/contract";
import { UserId } from "@ryot/contract/schema/brands";
import { Context, DateTime, Effect, Layer } from "effect";

import { AppConfig } from "#lib/infrastructure/config/service";
import { AuthService } from "#modules/auth/service";
import { classifyAuthState } from "#modules/user-lifecycle/auth-state";
import { UserLifecycleService } from "#modules/user-lifecycle/service";

import { GodModeRepository } from "./repository";

export const checkResetEligibility = (authState: ReturnType<typeof classifyAuthState>) => {
	if (authState !== "credential" && authState !== "none") {
		return `Cannot generate reset link for user with auth state '${authState}'. Only 'credential' and 'none' users are eligible.`;
	}

	return null;
};

export class GodModeService extends Context.Service<GodModeService>()("GodModeService", {
	make: Effect.gen(function* () {
		const config = yield* AppConfig;
		const repository = yield* GodModeRepository;
		const lifecycle = yield* UserLifecycleService;
		const {
			createAuthUser,
			linkAuthAccount,
			deleteUserSessions,
			updateAuthUserDisabled,
			requestPasswordResetLink,
		} = yield* AuthService;

		const listUsers = Effect.fn("GodModeService.listUsers")(function* (input: {
			limit: number;
			offset: number;
			search?: string | undefined;
		}) {
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
				createdAt: u.createdAt,
				disabledAt: u.disabledAt,
				twoFactorEnabled: u.twoFactorEnabled,
				authState: classifyAuthState(accountsByUser.get(u.id) ?? []),
			}));

			return { total, users };
		});

		const provisionUser = Effect.fn("GodModeService.provisionUser")(function* (
			input: ProvisionUserBody,
		) {
			const existing = yield* repository.findUserIdByEmail(input.email);

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
					issuer: createOAuthAccountIssuer("oidc"),
				});
			}

			return { userId };
		});

		const setUserDisabled = Effect.fn("GodModeService.setUserDisabled")(function* (
			userId: UserId,
			disabled: boolean,
		) {
			const user = yield* repository.findUserDisabledState(userId);

			if (!user) {
				return yield* badRequest(`User with id '${userId}' not found`);
			}

			const updatedAt = yield* DateTime.nowAsDate;
			const disabledAt = disabled ? (user.disabledAt ?? updatedAt) : null;

			yield* updateAuthUserDisabled(userId, { disabledAt, updatedAt });

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

			const userRow = yield* repository.findUserById(userId);
			const userData = userRow
				? { user: userRow, accounts: yield* repository.listAccountsForUsers([userId]) }
				: null;

			if (!userData) {
				return yield* badRequest(`User with id '${userId}' not found`);
			}

			const authState = classifyAuthState(userData.accounts);
			const eligibilityError = checkResetEligibility(authState);
			if (eligibilityError) {
				return yield* badRequest(eligibilityError);
			}

			return yield* requestPasswordResetLink(userData.user.email);
		});

		return {
			listUsers,
			provisionUser,
			setUserDisabled,
			resetUserPassword,
			resetUser: lifecycle.resetUser,
			deleteUser: lifecycle.deleteUser,
			getUserLifecycleOperation: lifecycle.getOperation,
		};
	}),
}) {
	static readonly layer = Layer.effect(this, this.make);
}
