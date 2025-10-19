import { describe, expect, it } from "bun:test";

import type { MaybeAuthType } from ".";
import { resolveAuthenticatedUser } from "./middleware";

const authUser: NonNullable<MaybeAuthType["user"]> = {
	id: "user_1",
	bannedAt: null,
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
	it("returns the session user when a session is present", async () => {
		const request = new Request("http://ryot.internal/a", {
			headers: { cookie: "session=1" },
		});

		const result = await resolveAuthenticatedUser(request, {
			getSession: ({ headers }) => {
				expect(headers.get("cookie")).toBe("session=1");
				return Promise.resolve({ user: authUser });
			},
		});

		expect(result).toEqual(authUser);
	});

	it("returns null when the session is missing", async () => {
		const request = new Request("http://ryot.internal/a");

		const result = await resolveAuthenticatedUser(request, {
			getSession: () => Promise.resolve(null),
		});

		expect(result).toBeNull();
	});
});
