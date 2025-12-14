import { describe, expect, it } from "bun:test";

import { UserId } from "@ryot/contract/schema/brands";

import { getBackendClient } from "~/fixtures";
import { createAuthenticatedClient } from "~/fixtures/auth";
import { createTracker } from "~/fixtures/trackers";
import { getBackendUrl, getPgClient } from "~/setup";
import { assertTaggedError } from "~/support/assertions";

const WRONG_TOKEN = "wrong-token";
const ADMIN_TOKEN = "test-admin-token";
const ADMIN_ACCESS_TOKEN_HEADER = "Admin-Access-Token";
const trackersListQuery = { includeDisabled: false };

const adminAccessTokenHeaders = (token: string) => ({
	[ADMIN_ACCESS_TOKEN_HEADER]: token,
});

async function createApiKey(cookies: string) {
	const response = await fetch(`${getBackendUrl()}/auth/api-key/create`, {
		method: "POST",
		body: JSON.stringify({ name: "Delete user e2e key" }),
		headers: { Cookie: cookies, "Content-Type": "application/json" },
	});
	if (!response.ok) {
		throw new Error(`API key creation failed: ${await response.text()}`);
	}
	const data: { key: string } = await response.json();
	return data.key;
}

describe("Delete user admin token enforcement", () => {
	it("rejects deletion without an admin token", async () => {
		const error = await getBackendClient().runError((c) =>
			c.godMode.deleteUser({ path: { userId: UserId.make("any-id") } }),
		);
		assertTaggedError(error, "Unauthorized");
	});

	it("rejects deletion with an incorrect admin token", async () => {
		const error = await getBackendClient().runError(
			(c) => c.godMode.deleteUser({ path: { userId: UserId.make("any-id") } }),
			adminAccessTokenHeaders(WRONG_TOKEN),
		);
		assertTaggedError(error, "Unauthorized");
	});
});

describe("Delete user", () => {
	it("returns not found for an unknown user", async () => {
		const error = await getBackendClient().runError(
			(c) =>
				c.godMode.deleteUser({ path: { userId: UserId.make(`missing-${crypto.randomUUID()}`) } }),
			adminAccessTokenHeaders(ADMIN_TOKEN),
		);
		assertTaggedError(error, "NotFound");
	});

	it("deletes user data and invalidates existing credentials", async () => {
		const client = getBackendClient();
		const {
			email,
			cookies,
			userId: rawUserId,
			client: userClient,
		} = await createAuthenticatedClient();
		const userId = UserId.make(rawUserId);
		const { tracker } = await createTracker(userClient, { name: "Delete user tracker" });
		const apiKey = await createApiKey(cookies);

		await client.run((c) => c.trackers.list({ urlParams: trackersListQuery }), {
			Cookie: cookies,
		});
		await client.run((c) => c.trackers.list({ urlParams: trackersListQuery }), {
			"X-Api-Key": apiKey,
		});

		const deleted = await client.run(
			(c) => c.godMode.deleteUser({ path: { userId } }),
			adminAccessTokenHeaders(ADMIN_TOKEN),
		);
		expect(deleted.id).toBe(userId);

		const listed = await client.run(
			(c) =>
				c.godMode.listUsers({
					urlParams: { limit: 50, offset: 0, search: email },
				}),
			adminAccessTokenHeaders(ADMIN_TOKEN),
		);
		expect(listed.users).toHaveLength(0);

		const trackerRows = await getPgClient().query<{ id: string }>(
			`SELECT id FROM "tracker" WHERE id = $1`,
			[tracker.id],
		);
		expect(trackerRows.rowCount).toBe(0);

		const revokedSession = await client.runError(
			(c) => c.trackers.list({ urlParams: trackersListQuery }),
			{ Cookie: cookies },
		);
		assertTaggedError(revokedSession, "Unauthorized");

		const revokedApiKey = await client.runError(
			(c) => c.trackers.list({ urlParams: trackersListQuery }),
			{ "X-Api-Key": apiKey },
		);
		assertTaggedError(revokedApiKey, "Unauthorized");
	});
});
