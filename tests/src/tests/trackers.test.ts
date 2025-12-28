import { describe, expect, it } from "bun:test";

import {
	createAuthenticatedClient,
	createTracker,
	disableTracker,
	listTrackers,
} from "../fixtures";
import { assertTaggedError } from "../test-support/assertions";

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

		const tracker = await client.run(
			(c) =>
				c.trackers.create({
					payload: {
						name,
						icon: "rocket",
						accentColor: "#FF5733",
						description: "Test tracker description",
					},
				}),
			{ Cookie: cookies },
		);

		expect(tracker.slug).toBe(slug);
		expect(tracker.isBuiltin).toBe(false);

		const duplicateError = await client.runError(
			(c) =>
				c.trackers.create({
					payload: { slug, icon: "rocket", name: `${name} Copy`, accentColor: "#FF5733" },
				}),
			{ Cookie: cookies },
		);

		assertTaggedError(duplicateError, "Conflict");
		expect(duplicateError.message).toBe("Tracker slug already exists");
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

		const tracker = await owner.client.run(
			(c) =>
				c.trackers.update({
					path: { trackerId: created.trackerId },
					payload: {
						icon: "flame",
						isDisabled: false,
						accentColor: "#123456",
						name: "Updated Tracker",
						description: "Updated description",
					},
				}),
			{ Cookie: owner.cookies },
		);

		expect(tracker.name).toBe("Updated Tracker");
		expect(tracker.icon).toBe("flame");
		expect(tracker.accentColor).toBe("#123456");
		expect(tracker.description).toBe("Updated description");

		const crossUserError = await otherUser.client.runError(
			(c) =>
				c.trackers.update({
					path: { trackerId: created.trackerId },
					payload: { isDisabled: false },
				}),
			{ Cookie: otherUser.cookies },
		);

		assertTaggedError(crossUserError, "NotFound");
		expect(crossUserError.message).toBe("Tracker not found");
	});

	it("reorders trackers while keeping omitted trackers at the end", async () => {
		const { client, cookies } = await createAuthenticatedClient();

		const initialTrackers = await listTrackers(client, cookies, { includeDisabled: true });
		const builtinTrackerIds = initialTrackers.filter((t) => t.isBuiltin).map((t) => t.id);

		const first = await createTracker(client, cookies, {
			name: `First ${crypto.randomUUID()}`,
		});
		const second = await createTracker(client, cookies, {
			name: `Second ${crypto.randomUUID()}`,
		});
		const third = await createTracker(client, cookies, {
			name: `Third ${crypto.randomUUID()}`,
		});

		const reorderedBody = await client.run(
			(c) => c.trackers.reorder({ payload: { trackerIds: [third.trackerId, first.trackerId] } }),
			{ Cookie: cookies },
		);

		expect(reorderedBody.trackerIds).toEqual([
			third.trackerId,
			first.trackerId,
			...builtinTrackerIds,
			second.trackerId,
		]);

		const trackers = await listTrackers(client, cookies);
		expect(trackers.map((tracker) => tracker.id)).toEqual([
			third.trackerId,
			first.trackerId,
			...builtinTrackerIds,
			second.trackerId,
		]);
	});
});
