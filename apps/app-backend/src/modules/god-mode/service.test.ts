import { describe, expect, it } from "bun:test";

import {
	checkResetEligibility,
	classifyAuthState,
	listUsers,
	provisionUser,
	setUserBan,
} from "./service";

describe("classifyAuthState", () => {
	it("returns none when there are no accounts", () => {
		expect(classifyAuthState([])).toBe("none");
	});

	it("returns credential when there is only a credential account", () => {
		expect(classifyAuthState([{ providerId: "credential" }])).toBe("credential");
	});

	it("returns oidc when there is only an OIDC account", () => {
		expect(classifyAuthState([{ providerId: "oidc" }])).toBe("oidc");
	});

	it("returns mixed when there are both credential and OIDC accounts", () => {
		expect(classifyAuthState([{ providerId: "credential" }, { providerId: "oidc" }])).toBe("mixed");
	});

	it("returns mixed regardless of account order", () => {
		expect(classifyAuthState([{ providerId: "oidc" }, { providerId: "credential" }])).toBe("mixed");
	});

	it("ignores unknown provider IDs", () => {
		expect(classifyAuthState([{ providerId: "credential" }, { providerId: "unknown" }])).toBe(
			"credential",
		);
	});
});

describe("listUsers", () => {
	const baseUser = {
		id: "user_1",
		bannedAt: null,
		name: "Test User",
		twoFactorEnabled: false,
		email: "test@example.com",
		createdAt: new Date("2024-01-01T00:00:00Z"),
	};

	it("returns users with their auth states and total count", () => {
		return expect(
			listUsers(
				{ limit: 50, offset: 0 },
				{
					countTotalUsers: () => Promise.resolve(1),
					listUsers: () => Promise.resolve([baseUser]),
					findAccounts: () => Promise.resolve([{ providerId: "credential" }]),
				},
			),
		).resolves.toEqual({
			data: {
				total: 1,
				users: [
					{
						id: "user_1",
						bannedAt: null,
						name: "Test User",
						twoFactorEnabled: false,
						authState: "credential",
						email: "test@example.com",
						createdAt: "2024-01-01T00:00:00.000Z",
					},
				],
			},
		});
	});

	it("classifies users with no accounts as none", async () => {
		const result = await listUsers(
			{ limit: 50, offset: 0 },
			{
				findAccounts: () => Promise.resolve([]),
				countTotalUsers: () => Promise.resolve(1),
				listUsers: () => Promise.resolve([baseUser]),
			},
		);

		if (!("data" in result)) {
			throw new Error("Expected data");
		}
		expect(result.data.users[0]?.authState).toBe("none");
	});

	it("classifies users with OIDC accounts correctly", async () => {
		const result = await listUsers(
			{ limit: 50, offset: 0 },
			{
				countTotalUsers: () => Promise.resolve(1),
				listUsers: () => Promise.resolve([baseUser]),
				findAccounts: () => Promise.resolve([{ providerId: "oidc" }]),
			},
		);

		if (!("data" in result)) {
			throw new Error("Expected data");
		}
		expect(result.data.users[0]?.authState).toBe("oidc");
	});

	it("classifies users with both credential and OIDC accounts as mixed", async () => {
		const result = await listUsers(
			{ limit: 50, offset: 0 },
			{
				countTotalUsers: () => Promise.resolve(1),
				listUsers: () => Promise.resolve([baseUser]),
				findAccounts: () => Promise.resolve([{ providerId: "credential" }, { providerId: "oidc" }]),
			},
		);

		if (!("data" in result)) {
			throw new Error("Expected data");
		}
		expect(result.data.users[0]?.authState).toBe("mixed");
	});

	it("returns internal error when listUsers throws", async () => {
		const result = await listUsers(
			{ limit: 50, offset: 0 },
			{
				findAccounts: () => Promise.resolve([]),
				countTotalUsers: () => Promise.resolve(1),
				listUsers: () => Promise.reject(new Error("db down")),
			},
		);

		expect(result).toEqual({ error: "internal", message: "db down" });
	});

	it("passes search filter to the adapter", async () => {
		let capturedWhere: unknown;
		await listUsers(
			{ limit: 10, offset: 5, search: "john" },
			{
				countTotalUsers: () => Promise.resolve(1),
				findAccounts: () => Promise.resolve([{ providerId: "credential" }]),
				listUsers: (_l, _o, _s, where) => {
					capturedWhere = where;
					return Promise.resolve([baseUser]);
				},
			},
		);

		expect(capturedWhere).toEqual([{ field: "email", value: "john", operator: "contains" }]);
	});

	it("trims whitespace from search input", async () => {
		let capturedWhere: unknown;
		await listUsers(
			{ limit: 10, offset: 0, search: "  john  " },
			{
				countTotalUsers: () => Promise.resolve(1),
				findAccounts: () => Promise.resolve([{ providerId: "credential" }]),
				listUsers: (_l, _o, _s, where) => {
					capturedWhere = where;
					return Promise.resolve([baseUser]);
				},
			},
		);

		expect(capturedWhere).toEqual([{ field: "email", value: "john", operator: "contains" }]);
	});

	it("returns the banned timestamp for disabled users", async () => {
		const result = await listUsers(
			{ limit: 50, offset: 0 },
			{
				countTotalUsers: () => Promise.resolve(1),
				findAccounts: () => Promise.resolve([{ providerId: "credential" }]),
				listUsers: () =>
					Promise.resolve([{ ...baseUser, bannedAt: new Date("2024-02-03T04:05:06Z") }]),
			},
		);

		if (!("data" in result)) {
			throw new Error("Expected data");
		}
		expect(result.data.users[0]?.bannedAt).toBe("2024-02-03T04:05:06.000Z");
	});
});

describe("setUserBan", () => {
	const now = new Date("2024-03-04T05:06:07Z");
	const baseUser = {
		id: "user_1",
		bannedAt: null,
		name: "Test User",
		twoFactorEnabled: false,
		email: "test@example.com",
		createdAt: new Date("2024-01-01T00:00:00Z"),
	};

	it("bans an unbanned user and deletes sessions", async () => {
		let deletedUserId = "";
		let updatedInput: unknown;

		const result = await setUserBan(
			"user_1",
			{ banned: true },
			{
				now: () => now,
				findUserById: () => Promise.resolve(baseUser),
				deleteSessions: (id) => {
					deletedUserId = id;
					return Promise.resolve();
				},
				updateUser: (_id, input) => {
					updatedInput = input;
					return Promise.resolve({});
				},
			},
		);

		expect(result).toEqual({ data: { id: "user_1", bannedAt: "2024-03-04T05:06:07.000Z" } });
		expect(deletedUserId).toBe("user_1");
		expect(updatedInput).toEqual({ updatedAt: now, bannedAt: now });
	});

	it("preserves existing bannedAt when banning an already-banned user", async () => {
		const existingBannedAt = new Date("2024-01-02T00:00:00Z");
		let deleted = false;

		const result = await setUserBan(
			"user_1",
			{ banned: true },
			{
				now: () => now,
				updateUser: () => Promise.resolve({}),
				findUserById: () => Promise.resolve({ ...baseUser, bannedAt: existingBannedAt }),
				deleteSessions: () => {
					deleted = true;
					return Promise.resolve();
				},
			},
		);

		expect(result).toEqual({ data: { id: "user_1", bannedAt: "2024-01-02T00:00:00.000Z" } });
		expect(deleted).toBe(false);
	});

	it("unbans a banned user without deleting sessions", async () => {
		let deleted = false;
		let updatedInput: unknown;

		const result = await setUserBan(
			"user_1",
			{ banned: false },
			{
				now: () => now,
				findUserById: () =>
					Promise.resolve({ ...baseUser, bannedAt: new Date("2024-01-02T00:00:00Z") }),
				deleteSessions: () => {
					deleted = true;
					return Promise.resolve();
				},
				updateUser: (_id, input) => {
					updatedInput = input;
					return Promise.resolve({});
				},
			},
		);

		expect(result).toEqual({ data: { id: "user_1", bannedAt: null } });
		expect(deleted).toBe(false);
		expect(updatedInput).toEqual({ updatedAt: now, bannedAt: null });
	});

	it("unbanning an already-unbanned user is a no-op (no sessions deleted)", async () => {
		let deleted = false;

		const result = await setUserBan(
			"user_1",
			{ banned: false },
			{
				now: () => now,
				updateUser: () => Promise.resolve({}),
				findUserById: () => Promise.resolve(baseUser),
				deleteSessions: () => {
					deleted = true;
					return Promise.resolve();
				},
			},
		);

		expect(result).toEqual({ data: { id: "user_1", bannedAt: null } });
		expect(deleted).toBe(false);
	});

	it("returns validation error when user is not found", () => {
		return expect(
			setUserBan(
				"missing",
				{ banned: true },
				{
					now: () => now,
					deleteSessions: () => Promise.resolve(),
					updateUser: () => Promise.resolve({}),
					findUserById: () => Promise.resolve(null),
				},
			),
		).resolves.toEqual({ error: "validation", message: "User with id 'missing' not found" });
	});

	it("returns internal error when persistence fails", () => {
		return expect(
			setUserBan(
				"user_1",
				{ banned: true },
				{
					now: () => now,
					deleteSessions: () => Promise.resolve(),
					findUserById: () => Promise.resolve(baseUser),
					updateUser: () => Promise.reject(new Error("db down")),
				},
			),
		).resolves.toEqual({ error: "internal", message: "db down" });
	});
});

const makeProvisionDeps = (overrides?: {
	findUserByEmail?: () => Promise<{ user: { id: string } } | null>;
	createAccount?: (data: {
		userId: string;
		accountId: string;
		providerId: string;
	}) => Promise<{ id: string }>;
	createUser?: (data: {
		email: string;
		name: string;
		emailVerified: boolean;
		preferences: unknown;
	}) => Promise<{ id: string }>;
}) => ({
	findUserByEmail: () => Promise.resolve(null),
	createUser: () => Promise.resolve({ id: "user_new" }),
	createAccount: () => Promise.resolve({ id: "acct_new" }),
	...overrides,
});

describe("provisionUser", () => {
	it("creates a credential user with no account row", async () => {
		let createdUser: unknown = null;
		let createdAccount: unknown = null;

		const result = await provisionUser(
			{ provider: "credential", email: "new@example.com", name: "new@example.com" },
			makeProvisionDeps({
				createUser: (data) => {
					createdUser = data;
					return Promise.resolve({ id: "user_new" });
				},
				createAccount: (data) => {
					createdAccount = data;
					return Promise.resolve({ id: "acct_new" });
				},
			}),
		);

		expect(result).toEqual({ data: { userId: "user_new" } });
		expect(createdUser).toMatchObject({ email: "new@example.com", emailVerified: true });
		expect(createdAccount).toBeNull();
	});

	it("creates an OIDC user with an account stub", async () => {
		let createdAccount: unknown = null;

		const result = await provisionUser(
			{
				provider: "oidc",
				name: "oidc@example.com",
				email: "oidc@example.com",
				oidcIssuerId: "google|123",
			},
			makeProvisionDeps({
				createAccount: (data) => {
					createdAccount = data;
					return Promise.resolve({ id: "acct_new" });
				},
			}),
		);

		expect(result).toEqual({ data: { userId: "user_new" } });
		expect(createdAccount).toEqual({
			userId: "user_new",
			providerId: "oidc",
			accountId: "google|123",
		});
	});

	it("returns validation error when user already exists", async () => {
		const result = await provisionUser(
			{ provider: "credential", email: "exists@example.com", name: "exists@example.com" },
			makeProvisionDeps({ findUserByEmail: () => Promise.resolve({ user: { id: "existing" } }) }),
		);

		expect(result).toEqual({
			error: "validation",
			message: "User with email 'exists@example.com' already exists",
		});
	});

	it("returns internal error when user creation fails", async () => {
		const result = await provisionUser(
			{ provider: "credential", email: "new@example.com", name: "new@example.com" },
			makeProvisionDeps({ createUser: () => Promise.reject(new Error("db down")) }),
		);

		expect(result).toEqual({ error: "internal", message: "db down" });
	});

	it("returns internal error when OIDC account creation fails", async () => {
		const result = await provisionUser(
			{
				provider: "oidc",
				name: "oidc@example.com",
				email: "oidc@example.com",
				oidcIssuerId: "google|123",
			},
			makeProvisionDeps({ createAccount: () => Promise.reject(new Error("db down")) }),
		);

		expect(result).toEqual({ error: "internal", message: "db down" });
	});
});

describe("checkResetEligibility", () => {
	const baseUser = {
		id: "user_1",
		name: "Test User",
		twoFactorEnabled: false,
		email: "test@example.com",
		createdAt: new Date("2024-01-01T00:00:00Z"),
	};

	it("allows credential users to reset", async () => {
		const result = await checkResetEligibility(baseUser, {
			findAccounts: () => Promise.resolve([{ providerId: "credential" }]),
		});

		expect(result).toEqual({ data: { authState: "credential" } });
	});

	it("allows users with no accounts (none) to reset", async () => {
		const result = await checkResetEligibility(baseUser, {
			findAccounts: () => Promise.resolve([]),
		});

		expect(result).toEqual({ data: { authState: "none" } });
	});

	it("blocks OIDC users from reset", async () => {
		const result = await checkResetEligibility(baseUser, {
			findAccounts: () => Promise.resolve([{ providerId: "oidc" }]),
		});

		expect(result).toEqual({
			error: "validation",
			message:
				"Cannot generate reset link for user with auth state 'oidc'. Only 'credential' and 'none' users are eligible.",
		});
	});

	it("blocks mixed users from reset", async () => {
		const result = await checkResetEligibility(baseUser, {
			findAccounts: () => Promise.resolve([{ providerId: "credential" }, { providerId: "oidc" }]),
		});

		expect(result).toEqual({
			error: "validation",
			message:
				"Cannot generate reset link for user with auth state 'mixed'. Only 'credential' and 'none' users are eligible.",
		});
	});
});
