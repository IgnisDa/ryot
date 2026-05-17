import { describe, expect, it } from "bun:test";

import { setInternalRequestAuth } from "~/app/internal-auth";

import type { MaybeAuthType } from ".";
import { resolveAuthenticatedUser } from "./middleware";

const authUser: NonNullable<MaybeAuthType["user"]> = {
	id: "user_1",
	preferences: {},
	image: undefined,
	name: "Test User",
	createdAt: new Date(),
	updatedAt: new Date(),
	emailVerified: false,
	twoFactorEnabled: false,
	email: "test@example.com",
};

describe("resolveAuthenticatedUser", () => {
	it("returns the internal request user when present", async () => {
		const request = setInternalRequestAuth(new Request("http://ryot.internal/a"), {
			userId: "user_1",
		});

		const result = await resolveAuthenticatedUser(request, {
			getSession: (_input) => {
				throw new Error("should not be called");
			},
			getInternalRequestAuth: () => ({ userId: "user_1" }),
			getUserById: (userId: string) => {
				expect(userId).toBe("user_1");
				return Promise.resolve(authUser);
			},
		});

		expect(result).toEqual(authUser);
	});

	it("returns null when internal auth has a blank userId", async () => {
		const request = new Request("http://ryot.internal/a");

		const result = await resolveAuthenticatedUser(request, {
			getSession: (_input) => {
				throw new Error("should not be called");
			},
			getInternalRequestAuth: () => ({ userId: "   " }),
			getUserById: () => Promise.resolve(authUser),
		});

		expect(result).toBeNull();
	});

	it("returns null when the internal auth userId is not found in the database", async () => {
		const request = new Request("http://ryot.internal/a");

		const result = await resolveAuthenticatedUser(request, {
			getUserById: () => Promise.resolve(null),
			getInternalRequestAuth: () => ({ userId: "deleted-user" }),
			getSession: (_input) => {
				throw new Error("should not be called");
			},
		});

		expect(result).toBeNull();
	});

	it("falls back to session auth when request is not internal", async () => {
		const request = new Request("http://ryot.internal/a", {
			headers: { cookie: "session=1" },
		});

		const result = await resolveAuthenticatedUser(request, {
			getSession: ({ headers }) => {
				expect(headers.get("cookie")).toBe("session=1");
				return Promise.resolve({ user: authUser });
			},
			getInternalRequestAuth: () => null,
			getUserById: () => {
				throw new Error("should not be called");
			},
		});

		expect(result).toEqual(authUser);
	});
});
