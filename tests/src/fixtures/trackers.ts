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

	const { data, response } = await client.POST("/trackers", {
		headers: { Cookie: cookies },
		body: { icon, name, slug, accentColor, description },
	});

	if (response.status !== 200 || !data?.data?.id) {
		throw new Error(`Failed to create tracker '${name}'`);
	}

	return { trackerId: data.data.id, data: data.data };
}

export async function listTrackers(
	client: Client,
	cookies: string,
	options: { includeDisabled?: boolean } = {},
) {
	const includeDisabled = options.includeDisabled ? "true" : undefined;
	const { data, response } = await client.GET("/trackers", {
		headers: { Cookie: cookies },
		params: { query: { includeDisabled } },
	});

	if (response.status !== 200 || !data?.data) {
		throw new Error("Failed to list trackers");
	}

	return data.data;
}

export async function findBuiltinTracker(client: Client, cookies: string) {
	const trackers = await listTrackers(client, cookies, {
		includeDisabled: true,
	});
	const builtinTracker = trackers.find((tracker) => tracker.isBuiltin);

	if (!builtinTracker) {
		throw new Error("Built-in tracker not found");
	}

	return builtinTracker;
}

export async function findBuiltinTrackerBySlug(client: Client, cookies: string, slug: string) {
	const trackers = await listTrackers(client, cookies, {
		includeDisabled: true,
	});
	const tracker = trackers.find((entry) => entry.isBuiltin && entry.slug === slug);

	if (!tracker) {
		throw new Error(`Built-in tracker '${slug}' not found`);
	}

	return tracker;
}

export async function disableTracker(input: {
	trackerId: string;
	cookies: string;
	client: Client;
}) {
	const result = await input.client.PATCH("/trackers/{trackerId}", {
		body: { isDisabled: true },
		headers: { Cookie: input.cookies },
		params: { path: { trackerId: input.trackerId } },
	});

	if (result.response.status !== 200 || !result.data?.data) {
		throw new Error(`Failed to disable tracker '${input.trackerId}'`);
	}

	return result.data.data;
}
