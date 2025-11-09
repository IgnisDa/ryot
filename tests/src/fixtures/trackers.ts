import { requirePresent } from "../test-support/assertions";
import type { Client } from "./auth";

export interface CreateTrackerOptions {
	icon?: string;
	name?: string;
	slug?: string;
	accentColor?: string;
	description?: string;
}

export async function createTracker(
	client: Client,
	cookies: string,
	options: CreateTrackerOptions = {},
) {
	const {
		icon = "rocket",
		name = "Test Tracker",
		accentColor = "#FF5733",
		slug = `tracker-${crypto.randomUUID()}`,
		description = "Test tracker description",
	} = options;

	const tracker = await client.run(
		(c) => c.trackers.create({ payload: { icon, name, slug, accentColor, description } }),
		{ Cookie: cookies },
	);

	return {
		tracker,
		trackerId: requirePresent(tracker.id, `Failed to create tracker '${name}'`),
	};
}

export async function listTrackers(
	client: Client,
	cookies: string,
	options: { includeDisabled?: boolean } = {},
) {
	return client.run(
		(c) => c.trackers.list({ urlParams: { includeDisabled: options.includeDisabled ?? false } }),
		{ Cookie: cookies },
	);
}

export async function findBuiltinTracker(client: Client, cookies: string) {
	const trackers = await listTrackers(client, cookies, {
		includeDisabled: true,
	});
	const builtinTracker = trackers.find((tracker) => tracker.isBuiltin);
	return requirePresent(builtinTracker, "Built-in tracker not found");
}

export async function findBuiltinTrackerBySlug(client: Client, cookies: string, slug: string) {
	const trackers = await listTrackers(client, cookies, {
		includeDisabled: true,
	});
	const tracker = trackers.find((entry) => entry.isBuiltin && entry.slug === slug);
	return requirePresent(tracker, `Built-in tracker '${slug}' not found`);
}

export async function disableTracker(input: {
	trackerId: string;
	cookies: string;
	client: Client;
}) {
	return input.client.run(
		(c) =>
			c.trackers.update({
				payload: { isDisabled: true },
				path: { trackerId: input.trackerId },
			}),
		{ Cookie: input.cookies },
	);
}
