import { describe, expect, it } from "bun:test";

import {
	createAuthenticatedClient,
	createTracker,
	disableTracker,
	listTrackers,
} from "../fixtures";
import { requireResponseData } from "../test-support/assertions";

const normalizeSlug = (value: string) =>
	value
		.replaceAll("_", "-")
		.trim()
		.toLowerCase()
		.replace(/\s+/g, "-")
		.replace(/[^a-z0-9-]/g, "")
		.replace(/-+/g, "-")
		.replace(/^-+|-+$/g, "");

describe("Trackers E2E", () => {
	it("creates custom trackers with normalized slugs and rejects duplicate slugs", async () => {
		const { client, cookies } = await createAuthenticatedClient();
		const name = "My Cool Tracker";
		const slug = normalizeSlug(name);

		const { data, response } = await client.trackers.create({
			headers: { Cookie: cookies },
			body: {
				name,
				icon: "rocket",
				accentColor: "#FF5733",
				description: "Test tracker description",
			},
		});

		const tracker = requireResponseData(response, data, "Failed to create tracker");
		expect(response.status).toBe(201);
		expect(tracker.slug).toBe(slug);
		expect(tracker.isBuiltin).toBe(false);

		const duplicate = await client.trackers.create({
			headers: { Cookie: cookies },
			body: { slug, icon: "rocket", name: `${name} Copy`, accentColor: "#FF5733" },
		});

		expect(duplicate.response.status).toBe(409);
		expect(duplicate.error?.error.message).toBe("Tracker slug already exists");
	});

	it("lists only enabled trackers by default and includes disabled when requested", async () => {
		const { client, cookies } = await createAuthenticatedClient();
		const enabledTracker = await createTracker(client, cookies, {
			name: `Enabled Tracker ${crypto.randomUUID()}`,
		});
		const disabledTracker = await createTracker(client, cookies, {
			name: `Disabled Tracker ${crypto.randomUUID()}`,
		});

		await disableTracker({ client, cookies, trackerId: disabledTracker.trackerId });

		const enabledOnly = await listTrackers(client, cookies);
		expect(enabledOnly.map((tracker) => tracker.id)).toContain(enabledTracker.trackerId);
		expect(enabledOnly.map((tracker) => tracker.id)).not.toContain(disabledTracker.trackerId);
		expect(enabledOnly.every((tracker) => !tracker.isDisabled)).toBe(true);

		const withDisabled = await listTrackers(client, cookies, { includeDisabled: true });
		expect(withDisabled.map((tracker) => tracker.id)).toContain(enabledTracker.trackerId);
		expect(withDisabled.map((tracker) => tracker.id)).toContain(disabledTracker.trackerId);

		const states = withDisabled.map((tracker) => tracker.isDisabled);
		const firstDisabledIndex = states.indexOf(true);
		expect(firstDisabledIndex).toBeGreaterThan(-1);
		expect(states.slice(firstDisabledIndex).every(Boolean)).toBe(true);
	});

	it("updates tracker fields and rejects cross-user access without leaking existence", async () => {
		const owner = await createAuthenticatedClient();
		const otherUser = await createAuthenticatedClient();
		const created = await createTracker(owner.client, owner.cookies, {
			name: `Update Target ${crypto.randomUUID()}`,
		});

		const updated = await owner.client.trackers.update({
			headers: { Cookie: owner.cookies },
			params: { path: { trackerId: created.trackerId } },
			body: {
				icon: "flame",
				isDisabled: false,
				accentColor: "#123456",
				name: "Updated Tracker",
				description: "Updated description",
			},
		});

		const tracker = requireResponseData(updated.response, updated.data, "Failed to update tracker");
		expect(updated.response.status).toBe(200);
		expect(tracker.name).toBe("Updated Tracker");
		expect(tracker.icon).toBe("flame");
		expect(tracker.accentColor).toBe("#123456");
		expect(tracker.description).toBe("Updated description");

		const crossUser = await otherUser.client.trackers.update({
			body: { isDisabled: false },
			headers: { Cookie: otherUser.cookies },
			params: { path: { trackerId: created.trackerId } },
		});

		expect(crossUser.response.status).toBe(404);
		expect(crossUser.error?.error.message).toBe("Tracker not found");
	});

	it("reorders trackers while keeping omitted trackers at the end", async () => {
		const { client, cookies } = await createAuthenticatedClient();
		const first = await createTracker(client, cookies, {
			name: `First ${crypto.randomUUID()}`,
		});
		const second = await createTracker(client, cookies, {
			name: `Second ${crypto.randomUUID()}`,
		});
		const third = await createTracker(client, cookies, {
			name: `Third ${crypto.randomUUID()}`,
		});

		const reordered = await client.trackers.reorder({
			headers: { Cookie: cookies },
			body: { trackerIds: [third.trackerId, first.trackerId] },
		});

		const reorderedBody = requireResponseData(
			reordered.response,
			reordered.data,
			"Failed to reorder trackers",
		);
		expect(reordered.response.status).toBe(200);
		expect(reorderedBody.trackerIds).toEqual([third.trackerId, first.trackerId, second.trackerId]);

		const trackers = await listTrackers(client, cookies);
		expect(trackers.map((tracker) => tracker.id)).toEqual([
			third.trackerId,
			first.trackerId,
			second.trackerId,
		]);
	});
});
