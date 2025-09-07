import type { Where } from "better-auth";

import { type ServiceResult, serviceData, serviceError } from "~/lib/result";

import type { AuthState, UserListItem, UserListQuery } from "./schemas";

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
