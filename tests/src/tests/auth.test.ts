import { describe, expect, it } from "bun:test";

import { createTestUser } from "../fixtures/auth";
import { getBackendClient, getBackendUrl, getPgClient } from "../setup";

describe("GET /system/config auth block defaults", () => {
	it("returns correct auth defaults", async () => {
		const client = getBackendClient();
		const { data } = await client.GET("/system/config");
		expect(data?.data.auth.oidcEnabled).toBe(false);
		expect(data?.data.auth.signupAllowed).toBe(true);
		expect(data?.data.auth.localAuthDisabled).toBe(false);
		expect(data?.data.auth.oidcButtonLabel).toBeUndefined();
	});
});

describe("Email sign-up", () => {
	it("bootstraps a new user with tracker rows after sign-up", async () => {
		const { email } = await createTestUser();
		const result = await getPgClient().query<{ count: string }>(
			`SELECT count(*) FROM tracker WHERE user_id = (SELECT id FROM "user" WHERE email = $1 LIMIT 1)`,
			[email],
		);
		expect(Number(result.rows[0]?.count)).toBeGreaterThan(0);
	});

	it("returns a non-200 status for a duplicate email sign-up", async () => {
		const { email } = await createTestUser();
		const baseUrl = getBackendUrl();
		const second = await fetch(`${baseUrl}/authentication/email`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ email, name: "Test User", password: "password123" }),
		});
		expect(second.ok).toBe(false);
	});
});
