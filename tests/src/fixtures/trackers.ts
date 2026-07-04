import { TrackerId } from "@ryot/contract/schema/brands";
import { Effect } from "effect";

import { requirePresent } from "~/support/assertions";

import type { Client } from "./auth";

export interface CreateTrackerOptions {
	icon?: string;
	name?: string;
	slug?: string;
	accentColor?: string;
	description?: string;
}

export const createTracker = (client: Client, options: CreateTrackerOptions = {}) =>
	Effect.gen(function* () {
		const {
			icon = "rocket",
			name = "Test Tracker",
			accentColor = "#FF5733",
			slug = `tracker-${crypto.randomUUID()}`,
			description = "Test tracker description",
		} = options;

		const tracker = yield* client.call((c) =>
			c.trackers.create({ payload: { icon, name, slug, accentColor, description } }),
		);

		return {
			tracker,
			trackerId: requirePresent(tracker.id, `Failed to create tracker '${name}'`),
		};
	});

export const listTrackers = (client: Client, options: { includeDisabled?: boolean } = {}) =>
	client.call((c) =>
		c.trackers.list({ urlParams: { includeDisabled: options.includeDisabled ?? false } }),
	);

export const findBuiltinTracker = (client: Client) =>
	Effect.gen(function* () {
		const trackers = yield* listTrackers(client, { includeDisabled: true });
		const builtinTracker = trackers.find((tracker) => tracker.isBuiltin);
		return requirePresent(builtinTracker, "Built-in tracker not found");
	});

export const findBuiltinTrackerBySlug = (client: Client, slug: string) =>
	Effect.gen(function* () {
		const trackers = yield* listTrackers(client, { includeDisabled: true });
		const tracker = trackers.find((entry) => entry.isBuiltin && entry.slug === slug);
		return requirePresent(tracker, `Built-in tracker '${slug}' not found`);
	});

export const disableTracker = (input: { trackerId: string; client: Client }) =>
	input.client.call((c) =>
		c.trackers.update({
			payload: { isDisabled: true },
			path: { trackerId: TrackerId.make(input.trackerId) },
		}),
	);
