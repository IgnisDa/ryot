import type { Where } from "better-auth";

import { type ServiceResult, serviceData, serviceError } from "~/lib/result";
import { defaultUserPreferences } from "~/modules/builtins";

import type {
	AuthState,
	ProvisionUserBody,
	SetUserBanBody,
	UserListItem,
	UserListQuery,
} from "./schemas";

type GodModeServiceError = "internal" | "validation";

export type GodModeServiceResult<T> = ServiceResult<T, GodModeServiceError>;

interface AccountLike {
	providerId: string;
}

interface UserLike {
	id: string;
	name: string;
	email: string;
	createdAt: Date;
	bannedAt?: Date | null;
	twoFactorEnabled?: boolean | null;
}

export const classifyAuthState = (accounts: AccountLike[]): AuthState => {
	const hasCredential = accounts.some((a) => a.providerId === "credential");
	const hasOidc = accounts.some((a) => a.providerId === "oidc");

	if (hasCredential && hasOidc) {
		return "mixed";
	}
	if (hasCredential) {
		return "credential";
	}
	if (hasOidc) {
		return "oidc";
	}
	return "none";
};

export interface ListUsersDeps {
	countTotalUsers: (where?: Where[]) => Promise<number>;
	findAccounts: (userId: string) => Promise<AccountLike[]>;
	listUsers: (
		limit?: number,
		offset?: number,
		sortBy?: { field: string; direction: "asc" | "desc" },
		where?: Where[],
	) => Promise<UserLike[]>;
}

export const listUsers = async (
	input: UserListQuery,
	deps: ListUsersDeps,
): Promise<GodModeServiceResult<{ users: UserListItem[]; total: number }>> => {
	const where: Where[] | undefined = input.search
		? [{ field: "email", value: input.search.trim(), operator: "contains" } satisfies Where]
		: undefined;

	try {
		const [rawUsers, total] = await Promise.all([
			deps.listUsers(input.limit, input.offset, undefined, where),
			deps.countTotalUsers(where),
		]);

		const users = await Promise.all(
			rawUsers.map(async (u) => {
				const accounts = await deps.findAccounts(u.id);
				return {
					id: u.id,
					name: u.name,
					email: u.email,
					createdAt: u.createdAt.toISOString(),
					authState: classifyAuthState(accounts),
					bannedAt: u.bannedAt?.toISOString() ?? null,
					twoFactorEnabled: u.twoFactorEnabled ?? null,
				};
			}),
		);

		return serviceData({ users, total });
	} catch (error) {
		const message = error instanceof Error ? error.message : "Failed to list users";
		return serviceError("internal", message);
	}
};

export interface CheckResetEligibilityDeps {
	findAccounts: (userId: string) => Promise<AccountLike[]>;
}

export const checkResetEligibility = async (
	user: UserLike,
	deps: CheckResetEligibilityDeps,
): Promise<GodModeServiceResult<{ authState: AuthState }>> => {
	const accounts = await deps.findAccounts(user.id);
	const authState = classifyAuthState(accounts);

	if (authState !== "credential" && authState !== "none") {
		return serviceError(
			"validation",
			`Cannot generate reset link for user with auth state '${authState}'. Only 'credential' and 'none' users are eligible.`,
		);
	}

	return serviceData({ authState });
};

export interface ProvisionUserDeps {
	findUserByEmail: (email: string) => Promise<{ user: { id: string } } | null>;
	createAccount: (data: {
		userId: string;
		accountId: string;
		providerId: string;
	}) => Promise<{ id: string }>;
	createUser: (data: {
		name: string;
		email: string;
		preferences: unknown;
		emailVerified: boolean;
	}) => Promise<{ id: string }>;
}

export const provisionUser = async (
	input: ProvisionUserBody,
	deps: ProvisionUserDeps,
): Promise<GodModeServiceResult<{ userId: string }>> => {
	try {
		const existing = await deps.findUserByEmail(input.email);
		if (existing) {
			return serviceError("validation", `User with email '${input.email}' already exists`);
		}

		const user = await deps.createUser({
			name: input.name,
			email: input.email,
			emailVerified: true,
			preferences: defaultUserPreferences,
		});

		if (input.provider === "oidc") {
			await deps.createAccount({
				userId: user.id,
				providerId: "oidc",
				accountId: input.oidcIssuerId,
			});
		}

		return serviceData({ userId: user.id });
	} catch (error) {
		const message = error instanceof Error ? error.message : "Failed to provision user";
		return serviceError("internal", message);
	}
};

export interface SetUserBanDeps {
	now: () => Date;
	deleteSessions: (userId: string) => Promise<void>;
	findUserById: (userId: string) => Promise<UserLike | null>;
	updateUser: (
		userId: string,
		input: { bannedAt: Date | null; updatedAt: Date },
	) => Promise<unknown>;
}

export const setUserBan = async (
	userId: string,
	input: SetUserBanBody,
	deps: SetUserBanDeps,
): Promise<GodModeServiceResult<{ id: string; bannedAt: string | null }>> => {
	try {
		const foundUser = await deps.findUserById(userId);
		if (!foundUser) {
			return serviceError("validation", `User with id '${userId}' not found`);
		}

		const updatedAt = deps.now();
		const bannedAt = input.banned ? (foundUser.bannedAt ?? updatedAt) : null;
		await deps.updateUser(foundUser.id, { updatedAt, bannedAt });

		if (input.banned && !foundUser.bannedAt) {
			await deps.deleteSessions(foundUser.id);
		}

		return serviceData({ id: foundUser.id, bannedAt: bannedAt?.toISOString() ?? null });
	} catch (error) {
		const message = error instanceof Error ? error.message : "Failed to set user ban";
		return serviceError("internal", message);
	}
};
