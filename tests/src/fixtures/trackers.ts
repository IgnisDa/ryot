import { requirePresent, requireResponseData } from "../test-support/assertions";
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

	const { data, response } = await client.trackers.create({
		headers: { Cookie: cookies },
		body: { icon, name, slug, accentColor, description },
	});

	const tracker = requireResponseData(response, data, `Failed to create tracker '${name}'`);
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
	const { data, response } = await client.trackers.list({
		headers: { Cookie: cookies },
		params: { query: { includeDisabled: options.includeDisabled ?? false } },
	});

	return requireResponseData(response, data, "Failed to list trackers");
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
	const result = await input.client.trackers.update({
		body: { isDisabled: true },
		headers: { Cookie: input.cookies },
		params: { path: { trackerId: input.trackerId } },
	});

	return requireResponseData(
		result.response,
		result.data,
		`Failed to disable tracker '${input.trackerId}'`,
	);
}
