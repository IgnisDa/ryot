import { describe, expect, it } from "bun:test";

import { createAuthenticatedClient, createTracker, disableTracker } from "../fixtures";

describe("Trackers E2E", () => {
	it("lists only enabled trackers by default", async () => {
		const { client, cookies } = await createAuthenticatedClient();
		const enabledTracker = await createTracker(client, cookies, {
			name: `Enabled Tracker ${crypto.randomUUID()}`,
		});
		const disabledTracker = await createTracker(client, cookies, {
			name: `Disabled Tracker ${crypto.randomUUID()}`,
		});

		await disableTracker({
			client,
			cookies,
			trackerId: disabledTracker.trackerId,
		});

		const result = await client.GET("/trackers", {
			headers: { Cookie: cookies },
		});

		expect(result.response.status).toBe(200);
		expect(result.data?.data.map((tracker) => tracker.id)).toContain(enabledTracker.trackerId);
		expect(result.data?.data.map((tracker) => tracker.id)).not.toContain(disabledTracker.trackerId);
		expect(result.data?.data.every((tracker) => !tracker.isDisabled)).toBe(true);
	});

	it("includes disabled trackers when includeDisabled is true", async () => {
		const { client, cookies } = await createAuthenticatedClient();
		const enabledTracker = await createTracker(client, cookies, {
			name: `Enabled Tracker ${crypto.randomUUID()}`,
		});
		const disabledTracker = await createTracker(client, cookies, {
			name: `Disabled Tracker ${crypto.randomUUID()}`,
		});

		await disableTracker({
			client,
			cookies,
			trackerId: disabledTracker.trackerId,
		});

		const result = await client.GET("/trackers", {
			headers: { Cookie: cookies },
			params: { query: { includeDisabled: "true" } },
		});

		expect(result.response.status).toBe(200);
		expect(result.data?.data.map((tracker) => tracker.id)).toContain(enabledTracker.trackerId);
		expect(result.data?.data.map((tracker) => tracker.id)).toContain(disabledTracker.trackerId);

		const states = result.data?.data.map((tracker) => tracker.isDisabled) ?? [];
		const firstDisabledIndex = states.indexOf(true);
		expect(firstDisabledIndex).toBeGreaterThan(-1);
		expect(states.slice(firstDisabledIndex).every(Boolean)).toBe(true);
	});
});
