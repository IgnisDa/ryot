import { describe, expect, it } from "bun:test";

import { createTestAuthClient, createTestUser, getBackendClient } from "~/fixtures";
import { getPgClient } from "~/setup";

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

	it("sets bootstrap_completed_at after sign-up", async () => {
		const { email } = await createTestUser();
		const result = await getPgClient().query<{ bootstrap_completed_at: string | null }>(
			`select bootstrap_completed_at from "user" where email = $1 limit 1`,
			[email],
		);
		expect(result.rows[0]?.bootstrap_completed_at).not.toBeNull();
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
