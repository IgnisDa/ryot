import { Effect } from "effect";

import { createAuthenticatedClient, createTracker, disableTracker, listTrackers } from "~/fixtures";
import { assertTaggedError } from "~/support/assertions";
import { describe, expect, it } from "~/support/effect-test";

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
	it.live("creates custom trackers with normalized slugs and rejects duplicate slugs", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const name = "My Cool Tracker";
			const slug = normalizeSlug(name);

			const tracker = yield* client.call((c) =>
				c.trackers.create({
					payload: {
						name,
						icon: "rocket",
						accentColor: "#FF5733",
						description: "Test tracker description",
					},
				}),
			);

			expect(tracker.slug).toBe(slug);
			expect(tracker.isBuiltin).toBe(false);

			const duplicateError = yield* Effect.flip(
				client.call((c) =>
					c.trackers.create({
						payload: { slug, icon: "rocket", name: `${name} Copy`, accentColor: "#FF5733" },
					}),
				),
			);

			assertTaggedError(duplicateError, "Conflict");
			expect(duplicateError.message).toBe("Tracker slug already exists");
		}),
	);

	it.live("lists only enabled trackers by default and includes disabled when requested", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const enabledTracker = yield* createTracker(client, {
				name: `Enabled Tracker ${crypto.randomUUID()}`,
			});
			const disabledTracker = yield* createTracker(client, {
				name: `Disabled Tracker ${crypto.randomUUID()}`,
			});

			yield* disableTracker({ client, trackerId: disabledTracker.trackerId });

			const enabledOnly = yield* listTrackers(client);
			expect(enabledOnly.map((tracker) => tracker.id)).toContain(enabledTracker.trackerId);
			expect(enabledOnly.map((tracker) => tracker.id)).not.toContain(disabledTracker.trackerId);
			expect(enabledOnly.every((tracker) => !tracker.isDisabled)).toBe(true);

			const withDisabled = yield* listTrackers(client, { includeDisabled: true });
			expect(withDisabled.map((tracker) => tracker.id)).toContain(enabledTracker.trackerId);
			expect(withDisabled.map((tracker) => tracker.id)).toContain(disabledTracker.trackerId);

			const states = withDisabled.map((tracker) => tracker.isDisabled);
			const firstDisabledIndex = states.indexOf(true);
			expect(firstDisabledIndex).toBeGreaterThan(-1);
			expect(states.slice(firstDisabledIndex).every(Boolean)).toBe(true);
		}),
	);

	it.live("updates tracker fields and rejects cross-user access without leaking existence", () =>
		Effect.gen(function* () {
			const owner = yield* createAuthenticatedClient();
			const otherUser = yield* createAuthenticatedClient();
			const created = yield* createTracker(owner.client, {
				name: `Update Target ${crypto.randomUUID()}`,
			});

			const tracker = yield* owner.client.call((c) =>
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
			);

			expect(tracker.name).toBe("Updated Tracker");
			expect(tracker.icon).toBe("flame");
			expect(tracker.accentColor).toBe("#123456");
			expect(tracker.description).toBe("Updated description");

			const crossUserError = yield* Effect.flip(
				otherUser.client.call((c) =>
					c.trackers.update({
						path: { trackerId: created.trackerId },
						payload: { isDisabled: false },
					}),
				),
			);

			assertTaggedError(crossUserError, "NotFound");
			expect(crossUserError.message).toBe("Tracker not found");
		}),
	);

	it.live("reorders trackers while keeping omitted trackers at the end", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();

			const initialTrackers = yield* listTrackers(client, { includeDisabled: true });
			const builtinTrackerIds = initialTrackers.filter((t) => t.isBuiltin).map((t) => t.id);

			const first = yield* createTracker(client, {
				name: `First ${crypto.randomUUID()}`,
			});
			const second = yield* createTracker(client, {
				name: `Second ${crypto.randomUUID()}`,
			});
			const third = yield* createTracker(client, {
				name: `Third ${crypto.randomUUID()}`,
			});

			const reorderedBody = yield* client.call((c) =>
				c.trackers.reorder({ payload: { trackerIds: [third.trackerId, first.trackerId] } }),
			);

			expect(reorderedBody.trackerIds).toEqual([
				third.trackerId,
				first.trackerId,
				...builtinTrackerIds,
				second.trackerId,
			]);

			const trackers = yield* listTrackers(client);
			expect(trackers.map((tracker) => tracker.id)).toEqual([
				third.trackerId,
				first.trackerId,
				...builtinTrackerIds,
				second.trackerId,
			]);
		}),
	);
});
