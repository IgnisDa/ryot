import { describe, expect, it } from "bun:test";

import { checkResetEligibility, classifyAuthState, listUsers } from "./service";

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
