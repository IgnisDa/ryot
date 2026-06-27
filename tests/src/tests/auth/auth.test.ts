import { describe, expect, it } from "bun:test";

import { createTestAuthClient, createTestUser, getBackendClient } from "~/fixtures";

describe("GET /system/config auth block defaults", () => {
	it("returns correct auth defaults", async () => {
		const client = getBackendClient();
		const data = await client.run((c) => c.system.config());
		expect(data.auth.oidcEnabled).toBe(false);
		expect(data.auth.signupAllowed).toBe(true);
		expect(data.auth.localAuthDisabled).toBe(false);
		expect(data.auth.oidcButtonLabel).toBeUndefined();
	});
});

describe("Email sign-up", () => {
	it("bootstraps a new user with tracker rows after sign-up", async () => {
		const { cookies } = await createTestUser();
		const trackers = await getBackendClient().run(
			(c) => c.trackers.list({ urlParams: { includeDisabled: true } }),
			{ Cookie: cookies },
		);
		expect(trackers.length).toBeGreaterThan(0);
	});

	it("returns an error for a duplicate email sign-up", async () => {
		const { email } = await createTestUser();
		const { error } = await createTestAuthClient().signUp.email({
			email,
			name: "Test User",
			password: "password123",
		});
		expect(error).toBeDefined();
	});
});
