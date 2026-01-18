import { TrackerId } from "@ryot/contract/schema/brands";

import { requirePresent } from "~/support/assertions";

import type { Client } from "./auth";

export interface CreateTrackerOptions {
	icon?: string;
	name?: string;
	slug?: string;
	accentColor?: string;
	description?: string;
}

export async function createTracker(client: Client, options: CreateTrackerOptions = {}) {
	const {
		icon = "rocket",
		name = "Test Tracker",
		accentColor = "#FF5733",
		slug = `tracker-${crypto.randomUUID()}`,
		description = "Test tracker description",
	} = options;

	const tracker = await client.run((c) =>
		c.trackers.create({ payload: { icon, name, slug, accentColor, description } }),
	);

	return {
		tracker,
		trackerId: requirePresent(tracker.id, `Failed to create tracker '${name}'`),
	};
}

export async function listTrackers(client: Client, options: { includeDisabled?: boolean } = {}) {
	return client.run((c) =>
		c.trackers.list({ urlParams: { includeDisabled: options.includeDisabled ?? false } }),
	);
}

export async function findBuiltinTracker(client: Client) {
	const trackers = await listTrackers(client, {
		includeDisabled: true,
	});
	const builtinTracker = trackers.find((tracker) => tracker.isBuiltin);
	return requirePresent(builtinTracker, "Built-in tracker not found");
}

export async function findBuiltinTrackerBySlug(client: Client, slug: string) {
	const trackers = await listTrackers(client, {
		includeDisabled: true,
	});
	const tracker = trackers.find((entry) => entry.isBuiltin && entry.slug === slug);
	return requirePresent(tracker, `Built-in tracker '${slug}' not found`);
}

export async function disableTracker(input: { trackerId: string; client: Client }) {
	return input.client.run((c) =>
		c.trackers.update({
			payload: { isDisabled: true },
			path: { trackerId: TrackerId.make(input.trackerId) },
		}),
	);
}
